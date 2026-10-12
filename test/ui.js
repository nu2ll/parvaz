'use strict';
// Runs the real web client (public/js/*.js) inside Node with a tiny fake DOM, wired to a real server
// over real HTTP + WebSocket. Catches runtime errors in UI code paths without needing a browser.
process.env.DB_PATH = ':memory:';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Document, Element, Event, Node, serialize } = require('./fakedom');
const { start } = require('../server');

let passed = 0;
const ok = (cond, label) => { if (!cond) throw new Error('FAIL: ' + label); passed++; console.log('  ✓', label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(25); }
  throw new Error('timeout: ' + label);
}

(async () => {
  global.__uiErrors = [];
  process.on('unhandledRejection', (e) => { global.__uiErrors.push(e); console.error('[unhandled]', e); });
  const server = await start(0, '127.0.0.1');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body, token) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  // a second user driven by plain API calls
  const sara = await call('POST', '/api/auth/register', { username: 'sara', display_name: 'سارا', password: 'supersecret2' });
  const reza = await call('POST', '/api/auth/register', { username: 'reza', display_name: 'رضا', password: 'supersecret3' });

  // ---------- fake browser ----------
  const document = new Document();
  global.__doc = document;
  const meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.append(meta);
  for (const [tag, id, cls] of [['div', 'auth', 'auth'], ['div', 'app', 'app']]) {
    const e = document.createElement(tag); e.id = id; e.className = cls; e.hidden = true; document.body.append(e);
  }
  for (const [id, cls] of [['sidebar', 'sidebar'], ['chat', 'chat'], ['info', 'info']]) {
    const e = document.createElement(id === 'chat' ? 'main' : 'aside'); e.id = id; e.className = cls; if (id === 'info') e.hidden = true; document.getElementById('app').append(e);
  }
  const ls = new Map();
  const listeners = {};
  const win = {
    document, Node, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob, File, FormData, JSON, Math, Date, Promise,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    matchMedia: (q) => ({ matches: /max-width/.test(q) ? false : /min-width/.test(q) ? true : false, addEventListener() {} }),
    innerWidth: 1280, innerHeight: 800,
    location: { hash: '', pathname: '/', origin: base, protocol: 'http:', host: `127.0.0.1:${port}` },
    history: { state: null, pushState(s) { this.state = s; }, replaceState(s) { this.state = s; }, back() {} },
    navigator: { onLine: true, clipboard: { writeText: async (t) => { win.__clipboard = t; } } },
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
    removeEventListener() {},
    getSelection: () => ({ removeAllRanges() {} }),
    focus() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    Image: class { set src(v) { setTimeout(() => this.onload && this.onload()); } get naturalWidth() { return 800; } get naturalHeight() { return 600; } },
    createImageBitmap: async () => { throw new Error('no canvas'); },
    fetch: (u, o) => fetch(new URL(u, base), o),
    WebSocket: class extends WebSocket { constructor(u) { super(u); } },
    XMLHttpRequest: class {
      constructor() { this.upload = {}; this.headers = {}; }
      open(m, u) { this.m = m; this.u = u; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      abort() { this.aborted = true; this.onabort && this.onabort(); }
      async send(body) {
        try {
          const r = await fetch(new URL(this.u, base), { method: this.m, headers: this.headers, body: Buffer.from(await body.arrayBuffer()) });
          this.status = r.status; this.responseText = await r.text();
          this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 });
          if (!this.aborted) this.onload();
        } catch (e) { this.onerror && this.onerror(e); }
      }
    },
  };
  win.window = win;
  document.addEventListener = (t, fn) => (listeners['doc:' + t] ||= []).push(fn);
  const ctx = vm.createContext(win);
  for (const f of ['core', 'ui', 'render', 'app', 'panels']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  }
  const run = (code) => vm.runInContext(code, ctx);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const text = (s) => $(s)?.textContent || '';
  const click = (node) => node.dispatchEvent(new Event('click', { bubbles: true }));
  // SNAPSHOT_DIR=... writes static HTML snapshots of the live UI (for visual review)
  const dump = (name) => {
    const dir = process.env.SNAPSHOT_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    fs.writeFileSync(path.join(dir, name + '.html'), `<!doctype html><html lang="fa" dir="rtl" data-theme="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head>${serialize(document.body)}</html>`);
  };

  console.log('auth screen');
  await until(() => !$('#auth').hidden, 'auth visible');
  await sleep(20);
  ok($('#auth form') && text('#auth h1') === 'کبوتر', 'login screen renders');
  click([...$$('#auth button')].find((b) => b.textContent.includes('ثبت‌نام')));
  const inputs = $$('#auth input');
  ok(inputs.length === 3, 'register form has username, name, password');
  inputs[0].value = 'arown'; inputs[1].value = 'آروون'; inputs[2].value = 'supersecret9';
  $('#auth form').dispatchEvent(new Event('submit'));
  await until(() => !$('#app').hidden, 'app visible after register');
  ok(run('S.me.username') === 'arown', 'registered + logged in from UI');
  await until(() => run('S.wsReady'), 'websocket connected');
  ok(true, 'realtime socket authenticated');
  ok($$('.ci').length === 1 && text('.ci .t') === 'پیام‌های ذخیره‌شده', 'chat list shows Saved Messages');
  ok($$('.folder').length === 5, 'folder tabs render');

  console.log('incoming message + unread');
  const pc = await call('POST', '/api/chats/private', { username: 'arown' }, sara.token);
  await call('POST', `/api/chats/${pc.chat.id}/messages`, { text: 'سلام آروون! **خوبی؟** https://example.com @sara' }, sara.token);
  await until(() => $$('.ci').length === 2, 'new chat appears in sidebar');
  ok(text('.ci .badge') === '۱', 'unread badge shows ۱');
  ok(run('document.title') === '(۱) کبوتر', 'tab title shows unread count');

  console.log('open chat');
  await run(`App.openChat(${pc.chat.id})`);
  await until(() => $$('.msg').length === 1, 'message rendered');
  ok($('.msg .text b')?.textContent === 'خوبی؟', 'bold markdown rendered');
  ok($('.msg .text a')?.getAttribute('href') === 'https://example.com/', 'links rendered safely');
  ok($('.msg .text .mention')?.textContent === '@sara', 'mention rendered');
  ok(text('.chat-head .t') === 'سارا', 'header shows peer');
  await until(() => !$('.ci .badge'), 'unread cleared after opening');
  ok(true, 'marked as read');

  console.log('composer');
  const input = run('el.input');
  input.value = 'سلام سارا 👋';
  input.dispatchEvent(new Event('input'));
  await run('App.sendText()');
  await until(() => $$('.msg.mine').length === 1, 'own message echoed');
  ok($('.msg.mine .ticks') != null, 'sent tick shown');
  const hist = await call('GET', `/api/chats/${pc.chat.id}/messages`, null, sara.token);
  ok(hist.messages.at(-1).text === 'سلام سارا 👋', 'server stored the message');
  await call('POST', `/api/chats/${pc.chat.id}/read`, { message_id: hist.messages.at(-1).id }, sara.token);
  await until(() => $('.msg.mine .ticks path')?.getAttribute('d')?.startsWith('M18 7'), 'double tick after read');
  ok(true, 'read receipt turns into ✓✓');

  // reply + edit + big emoji
  const firstMsg = run(`S.msgs.get(${pc.chat.id}).list[0]`);
  run('App.startReply(S.msgs.get(' + pc.chat.id + ').list[0])');
  ok(!run('el.bar.hidden') && run('el.bar.textContent').includes('پاسخ به سارا'), 'reply bar shows');
  input.value = '😂';
  await run('App.sendText()');
  await until(() => $$('.msg.mine').length === 2, 'reply arrives');
  ok($$('.msg.mine')[1].querySelector('.quote') != null, 'reply quote rendered');
  const mine = run(`S.msgs.get(${pc.chat.id}).list.find(m => m.text === 'سلام سارا 👋')`);
  run(`App.startEdit(S.msgs.get(${pc.chat.id}).list.find(m => m.id === ${mine.id}))`);
  ok(run('el.bar.textContent').includes('ویرایش پیام'), 'edit bar shows');
  input.value = 'سلام سارا جان';
  await run('App.sendText()');
  await until(() => [...$$('.msg.mine .text')].some((t) => t.textContent.includes('سارا جان') && t.textContent.includes('ویرایش‌شده')), 'edit rendered');
  ok(true, 'edit applied with "edited" label');

  console.log('reactions, menus, pin');
  run(`App.react(S.msgs.get(${pc.chat.id}).list[0], '🔥')`);
  await until(() => $('.react.mine')?.textContent.includes('🔥'), 'reaction chip');
  ok(true, 'reaction toggled from UI');
  run(`App.messageMenu(S.chats.get(${pc.chat.id}), S.msgs.get(${pc.chat.id}).list[0], { clientX: 400, clientY: 300 })`);
  ok($('.menu .quick') && $$('.menu .mi').length >= 5, 'message context menu opens with quick reactions');
  click([...$$('.menu .mi')].find((b) => b.textContent.includes('سنجاق')));
  await until(() => !run('el.pinned.hidden'), 'pinned bar');
  ok(run('el.pinned.textContent').includes('سلام آروون'), 'pinned bar shows message');
  ok([...$$('.service')].some((s) => s.textContent.includes('سنجاق کرد')), 'pin service message rendered');

  console.log('upload + voice');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  await run(`App.upload(new File([new Uint8Array([${[...png].join(',')}])], 'pic.png', { type: 'image/png' }), { caption: 'عکس تست' })`);
  await until(() => $('.msg.mine .photo img'), 'photo bubble');
  ok(!$('.pending'), 'pending upload replaced by real message');
  await run(`App.upload(new File([new Uint8Array(3000)], 'voice.webm', { type: 'audio/webm' }), { voice: true, duration: 4.2 })`);
  await until(() => $('.msg.mine .voice .wave'), 'voice bubble');
  ok(run('document.querySelector(".msg.mine .voice .vt").textContent') === '۰:۰۴', 'voice duration shown');
  run('App.sendFilesDialog([new File([new Uint8Array(10)], "doc.pdf", { type: "application/pdf" })], true)');
  ok($('.modal') && run('document.querySelector(".modal h3").textContent') === 'ارسال فایل', 'send-file dialog');
  click([...$$('.modal .btn')].find((b) => b.textContent === 'ارسال'));
  await until(() => $('.msg.mine .filecard'), 'file card');
  ok(run('document.querySelector(".msg.mine .filecard .fn").textContent') === 'doc.pdf', 'document message rendered');

  console.log('group + poll + info panel');
  run(`App.newChatDialog('group')`);
  const gInputs = $$('.modal input, .modal textarea');
  gInputs[0].value = 'تیم کبوتر';
  // pick sara from search
  const search = [...$$('.modal input')].find((i) => i.getAttribute('type') === 'search');
  search.value = 'sara';
  search.dispatchEvent(new Event('input'));
  await until(() => [...$$('.modal .pick')].some((p) => p.textContent.includes('سارا')), 'picker result');
  click([...$$('.modal .pick')].find((p) => p.textContent.includes('سارا')));
  ok($('.modal .chip') != null, 'selected member chip');
  click([...$$('.modal .btn')].find((b) => b.textContent === 'ساخت'));
  await until(() => run('S.chats.get(S.active)?.type') === 'group', 'group opened');
  ok(text('.chat-head .st') === '۲ عضو', 'group header shows member count');
  const gid = run('S.active');
  run(`App.pollDialog(S.chats.get(${gid}))`);
  const pInputs = $$('.modal input');
  pInputs[0].value = 'ناهار؟'; pInputs[1].value = 'پیتزا'; pInputs[2].value = 'کباب';
  click([...$$('.modal .btn')].find((b) => b.textContent === 'ساخت'));
  await until(() => $('.poll .popt'), 'poll rendered');
  click($$('.poll .popt')[1]);
  await until(() => $('.poll .pct'), 'voted');
  ok(text('.poll .pf span') === '۱ رأی', 'poll counts my vote');
  dump('group');
  await run(`App.openInfo(${gid})`);
  await until(() => !$('#info').hidden && $('#info .info-tabs'), 'info panel');
  ok([...$$('#info .pick')].length === 2 && text('#info .role').includes('مالک'), 'members list with owner badge');
  click([...$$('#info .info-tabs button')].find((b) => b.textContent === 'رسانه'));
  await until(() => $('#info .info-empty') || $('#info .media-grid'), 'media tab');
  ok(true, 'shared media tab loads');
  await run(`App.inviteDialog(S.chats.get(${gid}))`);
  ok(run('document.querySelector(".modal input").value').includes('/#/join/'), 'invite link generated');
  run('UI.closeMenu(); while (document.querySelector(".modal-wrap")) document.querySelector(".modal-wrap").remove()');

  dump('group-info');
  console.log('channel + join via link');
  const ch = await call('POST', '/api/chats/channel', { title: 'اخبار', username: 'kabootar_news' }, reza.token);
  await call('POST', `/api/chats/${ch.chat.id}/messages`, { text: 'پست اول' }, reza.token);
  await run(`App.openByUsername('kabootar_news')`);
  await until(() => [...$$('.modal .btn')].some((b) => b.textContent.includes('عضویت')), 'join dialog');
  click([...$$('.modal .btn')].find((b) => b.textContent.includes('عضویت')));
  await until(() => run('S.chats.get(S.active)?.type') === 'channel', 'channel opened');
  ok($('.bottom-action button') && !run('el.input'), 'subscriber sees mute button instead of composer');
  ok(text('.msg .meta').includes('۱'), 'channel post shows views');

  console.log('sidebar features');
  run(`S.folder = 'channel'; App.renderSidebar()`);
  ok($$('.ci').length === 1 && text('.ci .t') === 'اخبار', 'channels folder filters');
  run(`S.folder = 'all'; App.renderSidebar()`);
  await run(`App.chatSetting(S.chats.get(${pc.chat.id}), { pinned: true })`);
  ok(run('document.querySelector(".ci").dataset.id') === String(pc.chat.id), 'pinned chat moves to top');
  await run(`App.chatSetting(S.chats.get(${ch.chat.id}), { archived: true })`);
  ok($('.archive-row') != null, 'archive row appears');
  run(`el.search.value = 'سار'; App.renderSidebar()`);
  await until(() => [...$$('.section-title')].some((s) => s.textContent === 'گفتگوها'), 'search results');
  ok(true, 'sidebar search works');
  run(`el.search.value = ''; App.renderSidebar()`);
  run('App.mainMenu()');
  ok($('.menu .menu-head')?.textContent.includes('آروون'), 'main menu with profile');
  run('UI.closeMenu()');

  console.log('settings + sessions + forward');
  run('App.settingsDialog()');
  ok($$('.modal .set-row').length >= 6, 'settings dialog renders');
  run('while (document.querySelector(".modal-wrap")) document.querySelector(".modal-wrap").remove()');
  await run('App.sessionsDialog()');
  ok(text('.modal .pick .n').includes('(این دستگاه)'), 'sessions list marks current device');
  run('while (document.querySelector(".modal-wrap")) document.querySelector(".modal-wrap").remove()');
  await run(`App.openChat(${pc.chat.id})`);
  run(`App.forwardDialog([S.msgs.get(${pc.chat.id}).list[0].id])`);
  click([...$$('.modal .pick')].find((p) => p.textContent.includes('ذخیره‌شده')));
  await until(() => isSaved(), 'forward to saved');
  function isSaved() { return run('isSaved(S.chats.get(S.active))') && $('.msg .fwd'); }
  ok(text('.msg .fwd').includes('سارا'), 'forwarded message shows origin');

  run(`App.openChat(${pc.chat.id})`);
  await sleep(100);
  dump('private');
  run(`S.settings.theme = 'dark'; applyTheme()`);
  dump('private-dark');
  run(`S.settings.theme = 'light'; applyTheme()`);
  console.log('typing + presence + delete');
  await run(`App.openChat(${pc.chat.id})`);
  const sws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => (sws.onopen = r));
  sws.send(JSON.stringify({ type: 'auth', token: sara.token }));
  await sleep(150);
  sws.send(JSON.stringify({ type: 'typing', chat_id: pc.chat.id }));
  await until(() => text('.chat-head .st').includes('در حال نوشتن'), 'typing in header');
  ok(true, 'typing indicator shows in header');
  await until(() => run(`S.chats.get(${pc.chat.id}).peer.online`), 'presence online');
  ok(true, 'peer shown online');
  const toDelete = run(`S.msgs.get(${pc.chat.id}).list.find(m => m.text === '😂').id`);
  await call('POST', '/api/messages/delete', { message_ids: [toDelete] }, sara.token);
  await until(() => !run(`S.msgs.get(${pc.chat.id}).list.some(m => m.id === ${toDelete})`), 'deleted');
  ok(![...$$('.msg .text')].some((t) => t.textContent.startsWith('😂')), 'deleted message disappears');
  sws.close();

  console.log('logout');
  run('App.logout(false)');
  await until(() => !$('#auth').hidden, 'back to login');
  ok(run('S.token') === null, 'logged out');

  if (global.__uiErrors.length) throw new Error(`${global.__uiErrors.length} UI runtime error(s), see above`);
  console.log(`\nall ${passed} UI checks passed ✅`);
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
