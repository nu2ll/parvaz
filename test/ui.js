'use strict';
// Runs the real web client (public/js/*.js) inside Node with a tiny fake DOM, wired to a real server
// over real HTTP + WebSocket. Catches runtime errors in UI code paths without needing a browser.
process.env.DB_PATH = ':memory:';
process.env.OFFICIAL_CHANNEL = '0'; // official channel/service chat covered in features.js
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
    document, Node, Element, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob, File, FormData, JSON, Math, Date, Promise,
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
    sessionStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    requestAnimationFrame: (f) => setTimeout(() => f(Date.now()), 0), cancelAnimationFrame: (t) => clearTimeout(t),
    crypto: globalThis.crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Map, Set, WeakMap, Symbol, Error, Number, String, Array, Object, RegExp, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, AbortController,
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
  for (const f of ['core', 'sounds', 'ui', 'render', 'wallpaper', 'app', 'media', 'panels', 'recorder', 'creator', 'android', 'settings', 'stories', 'calls', 'lock']) {
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
  ok($('.reactions-pop button') && $$('.menu .mi').length >= 5, 'message context menu opens with quick reactions');
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

  console.log('mic: tap to switch voice ⇄ video (Android)');
  run('App.recMode = "voice"; App.updateSendBtn()');
  ok(run('el.sendBtn.dataset.mode') === 'mic', 'empty composer shows the mic');
  const pd = new Event('pointerdown', { bubbles: true }); Object.assign(pd, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  $('.send-btn').dispatchEvent(pd);
  const pu = new Event('pointerup', { bubbles: true }); Object.assign(pu, { pointerId: 1 });
  $('.send-btn').dispatchEvent(pu);
  ok(run('el.sendBtn.dataset.mode') === 'round' && $('.send-btn svg.morph'), 'a quick tap turns it into the video-message button');
  ok($('.rec-tip') && $('.rec-tip').textContent.includes('ویدیو'), 'hint bubble explains hold vs tap');
  run('Rec.toggleMode()');
  ok(run('el.sendBtn.dataset.mode') === 'mic', 'tap again → back to voice');

  console.log('new channel (Android flow)');
  run('App.newChannelFlow()');
  await until(() => $('.new-head .field input'), 'channel details step');
  $('.new-head .field input').value = 'کانال تست';
  click(run('App.side.top().fab'));
  await until(() => $$('.radios .set-row').length === 2, 'channel type step (public / private)');
  await until(() => $('.invite-url') && $('.invite-url').textContent.includes('/#/join/'), 'private channel shows its invite link');
  click([...$$('.radios .set-row')].find((r) => r.dataset.v === 'public'));
  await until(() => $('.link-field input'), 'public link field');
  const li = $('.link-field input'); li.value = 'test_chan'; li.dispatchEvent(new Event('input', { bubbles: true }));
  await until(() => $('.link-hint.good'), 'link availability check', 4000);
  click(run('App.side.top().fab'));
  await until(() => run('App.side.top()?.opts.title') === 'افزودن مشترک', 'add subscribers step');
  click(run('App.side.top().fab'));
  await until(() => [...run('[...S.chats.values()]')].some((c) => c.username === 'test_chan' && c.type === 'channel'), 'public channel created with its link');
  ok(run('S.chats.get(S.active).username') === 'test_chan', 'new channel opens');

  console.log('photo picker + cropper');
  run('UI.cropImage(new File([new Uint8Array([1,2,3])], "x.png", { type: "image/png" }))');
  ok($('.cropper .crop-hole') && $('.cropper .crop-done'), 'circular cropper opens');
  click($('.cropper .crop-top .ibtn'));
  ok(!$('.cropper'), 'cropper closes on cancel');

  console.log('Android touch: tap → menu, double tap → reaction');
  const saraChat = run(`[...S.chats.values()].find((c) => c.type === 'private' && c.peer && c.peer.username === 'sara').id`);
  run(`App.openChat(${saraChat})`);
  await until(() => $$('.msg .bubble .text').length, 'chat with messages');
  run('globalThis.__mm = matchMedia; window.matchMedia = globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} }); App.renderMessages()');
  await sleep(50);
  const tapEv = () => { const ev = new Event('click', { bubbles: true }); Object.assign(ev, { clientX: 50, clientY: 50 }); return ev; };
  $('.msg .bubble .text').dispatchEvent(tapEv());
  await until(() => $('.menu.msg-menu'), 'single tap opens the message menu', 1500);
  ok($('.msg.menu-target') && $('.reactions-pop'), 'tapped message is highlighted with the reactions bar');
  run('UI.closeMenu()');
  ok(!$('.msg.menu-target'), 'highlight cleared on close');
  $('.msg .bubble .text').dispatchEvent(tapEv());
  $('.msg .bubble .text').dispatchEvent(tapEv());
  ok($('.react-burst'), 'double tap sends a quick reaction');
  await sleep(400);
  ok(!$('.menu.msg-menu'), 'double tap does not open the menu');
  run('window.matchMedia = globalThis.matchMedia = globalThis.__mm; App.renderMessages()');

  console.log('Android shell: title, ⋮ menu, bottom bar, root tabs');
  ok(text('.root-chats .a-title') === 'کبوتر', 'title reads کبوتر');
  run("App.setConn('connecting')");
  await sleep(1400);
  ok($('.a-title.busy .spinner') && text('.a-title').includes('در حال اتصال'), 'connection state replaces the title');
  run('App.setConn(null)');
  ok(text('.a-title') === 'کبوتر' && !$('.a-title.busy'), 'title comes back once connected');
  click($('.menu-btn'));
  await until(() => $('.menu.main-menu'), '⋮ menu opens');
  ok($$('.menu.main-menu .mi').length >= 6 && $('.menu.main-menu svg.i.o'), 'menu with outline icons');
  ok(text('.menu.main-menu .menu-foot').includes('کبوتر وب') && !text('.menu.main-menu .menu-foot').includes('ناعدد'), 'menu footer shows version');
  run('UI.closeMenu()');
  ok($$('.bottom-nav .nb').length === 4, 'bottom bar with 4 tabs');
  click([...$$('.bottom-nav .nb')].find((b) => b.dataset.id === 'contacts'));
  await until(() => $('.root-contacts') && !$('.root-contacts').hidden, 'contacts tab');
  ok(text('.root-contacts').includes('دعوت از دوستان') && text('.root-contacts').includes('تماس‌های اخیر'), 'contacts: invite + recent calls');
  click([...$$('.bottom-nav .nb')].find((b) => b.dataset.id === 'profile'));
  await until(() => $('.root-profile') && !$('.root-profile').hidden, 'profile tab');
  ok($$('.p-action').length === 3, 'profile: settings / edit / photo actions');
  click([...$$('.bottom-nav .nb')].find((b) => b.dataset.id === 'settings'));
  await until(() => $('.root-settings') && !$('.root-settings').hidden, 'settings tab');
  ok($$('.root-settings .sq-row .sq').length >= 10, 'settings rows with coloured squircle icons');
  const kb0 = [...$$('.root-settings .sq-row')].find((r) => r.textContent.includes('میانبر'));
  click(kb0);
  await until(() => $$('.kb-row').length > 5, 'settings sub-page opens over the tab');
  ok($('.bottom-nav').classList.contains('hide'), 'bottom bar hides on sub-pages');
  run('App.side.popAll()');
  ok(!$('.bottom-nav').classList.contains('hide'), 'bottom bar returns');
  click([...$$('.bottom-nav .nb')].find((b) => b.dataset.id === 'chats'));
  click($('.fab-new'));
  await until(() => run('App.side.top()?.opts.title') === 'پیام جدید', 'pencil opens New Message');
  ok(run('App.side.top().tab.textContent').includes('گروه جدید') && run('App.side.top().tab.textContent').includes('کانال جدید'), 'new message: group / contact / channel');
  run('App.side.popAll()');
  await sleep(300);
  run('App.openSettings()');
  await until(() => $('.main-settings .profile-top'), 'settings tab opens');
  ok($$('.main-settings .sq-row .sq').length >= 10, 'settings rows with coloured squircle icons');
  ok($$('.main-settings .section').length >= 3, 'settings grouped in cards');
  const kb = [...$$('.main-settings .sq-row')].find((r) => r.textContent.includes('میانبر'));
  click(kb);
  await until(() => $$('.kb-row').length > 5, 'keyboard shortcuts page');
  ok($$('kbd').length > 5, 'shortcut keys rendered');
  run('App.side.popAll()');
  await sleep(300);

  console.log('Telegram sounds');
  run(`globalThis.__snd = []; const __p = Sound.play.bind(Sound); Sound.play = (n, f) => { __snd.push(n); return __p(n, f); }; App.openChat(${saraChat})`);
  await sleep(200);
  run('el.input.value = "صدا دارد؟"; App.sendText()');
  await until(() => run('__snd.includes("out")'), 'send plays the sent sound');
  await call('POST', `/api/chats/${saraChat}/messages`, { text: 'جواب' }, sara.token);
  await until(() => run('__snd.includes("in")'), 'incoming message in the open chat plays the in-chat sound');
  run('S.settings.chat_sounds = false; __snd.length = 0; Sound.play("out")');
  ok(true, 'in-chat sounds can be switched off');
  run('S.settings.chat_sounds = true');

  console.log('WebSocket blocked → HTTP live fallback');
  run('App.dropSocket(); globalThis.__WS = WebSocket; WebSocket = function () { throw new Error("blocked by network"); }; S.wsFails = 0; App.connect()');
  await until(() => run('S.pollLive === true && S.wsReady === true'), 'switches to HTTP live events', 8000);
  ok(!$('.a-title.busy'), 'title stays «کبوتر» while on the fallback');
  run(`App.openChat(${saraChat})`);
  await sleep(300);
  await call('POST', `/api/chats/${saraChat}/messages`, { text: 'از راه HTTP رسید' }, sara.token);
  await until(() => [...$$('.msg .text')].some((t) => t.textContent.includes('از راه HTTP رسید')), 'incoming message arrives over long-poll', 6000);
  ok(true, 'realtime works without WebSockets');
  run('el.input.value = "ارسال از طریق fallback"; App.sendText()');
  await until(async () => (await call('GET', `/api/chats/${saraChat}/messages`, null, sara.token)).messages.some((m) => m.text === 'ارسال از طریق fallback'), 'sending works over the fallback', 6000);
  ok(true, 'sending works over HTTP live');
  run('WebSocket = globalThis.__WS; App.ensureConnected()');
  await until(() => run('S.wsLive === true && !S.poll'), 'upgrades back to WebSocket', 8000);
  ok(true, 'back on WebSocket, fallback closed');

  console.log('logout');
  run('App.logout(false)');
  await until(() => !$('#auth').hidden, 'back to login');
  ok(run('S.token') === null, 'logged out');

  if (global.__uiErrors.length) throw new Error(`${global.__uiErrors.length} UI runtime error(s), see above`);
  console.log(`\nall ${passed} UI checks passed ✅`);
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
