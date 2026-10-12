'use strict';
// End-to-end tests for v3 features: privacy, contacts, blocks, 2FA, topics, stickers, GIFs, albums, stories, calls.
process.env.DB_PATH = ':memory:';
const { start } = require('../server');

let base, wsBase, passed = 0;
const ok = (cond, label) => { if (!cond) throw new Error('FAIL: ' + label); passed++; console.log('  ✓', label); };
async function call(method, path, body, token, raw) {
  const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  let payload;
  if (raw) { payload = raw.data; headers['Content-Type'] = raw.type; }
  else if (body != null) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
function client(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase);
    const events = [], waiters = [];
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      const w = waiters.find((w) => w.pred(ev));
      if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); } else events.push(ev);
    };
    const api = {
      ws, events, send: (o) => ws.send(JSON.stringify(o)),
      waitFor(pred, ms = 2000) {
        const i = events.findIndex(pred);
        if (i >= 0) return Promise.resolve(events.splice(i, 1)[0]);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout waiting for event')), ms);
          waiters.push({ pred, resolve: (ev) => { clearTimeout(t); res(ev); } });
        });
      },
    };
    ws.onopen = () => { api.send({ type: 'auth', token }); api.waitFor((e) => e.type === 'ready').then(() => resolve(api), reject); };
  });
}
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const gif = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
const upload = async (token, data, type, name) => (await call('POST', '/api/files?name=' + name, null, token, { data, type })).data.file;

(async () => {
  const server = await start(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
  wsBase = base.replace('http', 'ws') + '/ws';
  const reg = async (u, n) => (await call('POST', '/api/auth/register', { username: u, display_name: n, password: 'supersecret1' })).data;
  const A = await reg('amir', 'امیر'), B = await reg('bahar', 'بهار'), C = await reg('cyrus', 'کوروش');
  const pc = (await call('POST', '/api/chats/private', { username: 'bahar' }, A.token)).data.chat;
  await call('POST', `/api/chats/${pc.id}/messages`, { text: 'سلام' }, A.token);

  console.log('contacts + privacy');
  let r = await call('POST', '/api/contacts', { username: 'bahar', name: 'بهار جان' }, A.token);
  ok(r.status === 200 && r.data.user.contact_name === 'بهار جان', 'add contact with custom name');
  ok((await call('GET', '/api/contacts', null, A.token)).data.contacts.length === 1, 'contacts list');
  const chats = (await call('GET', '/api/chats', null, A.token)).data.chats;
  ok(chats.find((c) => c.id === pc.id).title === 'بهار جان', 'private chat title uses contact name');
  r = await call('PATCH', '/api/me/privacy', { last_seen: 'contacts', photo: 'nobody', groups: 'contacts' }, B.token);
  ok(r.status === 200 && r.data.privacy.last_seen === 'contacts', 'privacy updated');
  let prof = (await call('GET', `/api/users/${B.user.id}`, null, A.token)).data.user;
  ok(prof.last_seen_hidden === true, 'last seen hidden from non-contacts');
  await call('POST', '/api/contacts', { username: 'amir' }, B.token);
  prof = (await call('GET', `/api/users/${B.user.id}`, null, A.token)).data.user;
  ok(prof.last_seen_hidden === false, 'visible to contacts');
  r = await call('POST', '/api/chats/group', { title: 'g', usernames: ['bahar'] }, C.token);
  ok(r.status === 403 && r.data.error.code === 'privacy_restricted', 'groups privacy blocks strangers adding you');
  ok((await call('PATCH', '/api/me/privacy', { last_seen: 'friends' }, B.token)).status === 400, 'invalid privacy value rejected');
  ok((await call('GET', '/api/check-username?username=amir', null, B.token)).data.available === false, 'username availability check');

  console.log('blocks');
  await call('POST', '/api/blocked', { user_id: A.user.id }, B.token);
  r = await call('POST', `/api/chats/${pc.id}/messages`, { text: 'hi?' }, A.token);
  ok(r.status === 403 && r.data.error.code === 'blocked', 'blocked user cannot message');
  prof = (await call('GET', `/api/users/${B.user.id}`, null, A.token)).data.user;
  ok(prof.last_seen_hidden && prof.avatar === null, 'blocked user sees nothing');
  ok((await call('GET', '/api/blocked', null, B.token)).data.users.length === 1, 'blocked list');
  await call('DELETE', `/api/blocked/${A.user.id}`, null, B.token);
  ok((await call('POST', `/api/chats/${pc.id}/messages`, { text: 'hi again' }, A.token)).status === 201, 'unblock restores messaging');

  console.log('two-step verification');
  r = await call('POST', '/api/me/2fa', { new_password: 'kabootar-2fa', hint: 'pigeon' }, C.token);
  ok(r.data.enabled === true && r.data.hint === 'pigeon', '2FA enabled');
  r = await call('POST', '/api/auth/login', { username: 'cyrus', password: 'supersecret1' });
  ok(r.data.twofa_required && r.data.login_token && !r.data.token && r.data.hint === 'pigeon', 'login asks for 2FA password');
  ok((await call('POST', '/api/auth/2fa', { login_token: r.data.login_token, password: 'wrong' })).status === 401, 'wrong 2FA password rejected');
  const r2 = await call('POST', '/api/auth/2fa', { login_token: r.data.login_token, password: 'kabootar-2fa' });
  ok(r2.status === 200 && r2.data.token && r2.data.user.twofa === true, '2FA login completes');
  ok((await call('POST', '/api/me/2fa', { current_password: 'nope', new_password: '' }, C.token)).status === 403, 'disabling 2FA needs its password');
  ok((await call('POST', '/api/me/2fa', { current_password: 'kabootar-2fa', new_password: '' }, C.token)).data.enabled === false, '2FA disabled');

  console.log('topics');
  const g = (await call('POST', '/api/chats/group', { title: 'انجمن', usernames: ['cyrus'] }, A.token)).data.chat;
  await call('POST', `/api/chats/${g.id}/messages`, { text: 'قبل از تاپیک' }, A.token);
  r = await call('PATCH', `/api/chats/${g.id}`, { is_forum: true }, A.token);
  ok(r.data.chat.is_forum === true, 'topics enabled in group');
  r = await call('POST', `/api/chats/${g.id}/topics`, { title: 'باگ‌ها', icon_emoji: '🐞' }, A.token);
  ok(r.status === 201 && r.data.topic.title === 'باگ‌ها', 'topic created');
  const tid = r.data.topic.id;
  await call('POST', `/api/chats/${g.id}/messages`, { text: 'باگ اول', topic_id: tid }, A.token);
  await call('POST', `/api/chats/${g.id}/messages`, { text: 'در عمومی' }, A.token);
  const tlist = (await call('GET', `/api/chats/${g.id}/topics`, null, C.token)).data.topics;
  ok(tlist.length === 2 && tlist[0].general && tlist.find((t) => t.id === tid).unread === 2, 'topic list with unread (General + topic)');
  const th = (await call('GET', `/api/chats/${g.id}/messages?topic=${tid}`, null, C.token)).data.messages;
  ok(th.length === 2 && th.every((m) => m.topic_id === tid), 'topic history is filtered');
  const gh = (await call('GET', `/api/chats/${g.id}/messages?topic=0`, null, C.token)).data.messages;
  ok(gh.some((m) => m.text === 'قبل از تاپیک') && !gh.some((m) => m.text === 'باگ اول'), 'old messages moved to General');
  await call('POST', `/api/chats/${g.id}/read`, { message_id: th.at(-1).id, topic_id: tid }, C.token);
  const cg = (await call('GET', `/api/chats/${g.id}`, null, C.token)).data.chat;
  ok(cg.unread === gh.filter((m) => m.sender.id !== C.user.id && m.kind !== 'zz').length, 'chat unread = sum of topic unread');
  await call('PATCH', `/api/topics/${tid}`, { closed: true }, A.token);
  ok((await call('POST', `/api/chats/${g.id}/messages`, { text: 'x', topic_id: tid }, C.token)).status === 403, 'closed topic blocks members');

  console.log('stickers + gifs + albums');
  const st = (await call('GET', '/api/stickers', null, A.token)).data.packs;
  ok(st.length >= 1 && st[0].short_name === 'kabootar' && st[0].stickers.length === 16, 'built-in sticker pack installed');
  r = await call('POST', `/api/chats/${pc.id}/messages`, { sticker_id: st[0].stickers[3].id }, A.token);
  ok(r.data.message.kind === 'sticker' && r.data.message.sticker.url.endsWith('04.svg'), 'send sticker');
  r = await call('POST', '/api/stickers/packs', { title: 'پک من', short_name: 'amir_pack' }, A.token);
  ok(r.status === 201 && r.data.pack.mine, 'create own pack');
  const pf = await upload(A.token, png, 'image/png', 's.png');
  r = await call('POST', `/api/stickers/packs/${r.data.pack.id}/stickers`, { file_id: pf.id, emoji: '😀' }, A.token);
  ok(r.data.pack.count === 1, 'add sticker to pack');
  ok((await call('POST', '/api/stickers/packs/amir_pack/install', null, B.token)).data.pack.installed, 'someone else installs the pack');
  const gf = await upload(A.token, gif, 'image/gif', 'a.gif');
  r = await call('POST', `/api/chats/${pc.id}/messages`, { file_id: gf.id, meta: { width: 200, height: 150 } }, A.token);
  ok(r.data.message.kind === 'gif', 'GIF upload becomes a GIF message');
  ok((await call('POST', '/api/gifs', { file_id: gf.id }, B.token)).data.gifs.length === 1, 'recipient saves the GIF');
  r = await call('POST', `/api/chats/${pc.id}/messages`, { file_id: gf.id, gif: true }, B.token);
  ok(r.status === 201 && r.data.message.media.width === 200, 'saved GIF can be re-sent');
  const p1 = await upload(A.token, png, 'image/png', '1.png'), p2 = await upload(A.token, png, 'image/png', '2.png');
  await call('POST', `/api/chats/${pc.id}/messages`, { file_id: p1.id, grouped_id: 'album123', spoiler: true }, A.token);
  r = await call('POST', `/api/chats/${pc.id}/messages`, { file_id: p2.id, grouped_id: 'album123', text: 'کپشن' }, A.token);
  ok(r.data.message.grouped_id === 'album123', 'album grouping kept');
  const hist = (await call('GET', `/api/chats/${pc.id}/messages`, null, B.token)).data.messages;
  ok(hist.find((m) => m.media?.id === p1.id).media.spoiler === true, 'media spoiler flag');
  r = await call('POST', '/api/messages/forward', { to_chat_id: g.id, message_ids: hist.filter((m) => m.grouped_id).map((m) => m.id) }, A.token);
  ok(r.status === 200 && r.data.messages.length === 2 && r.data.messages[0].grouped_id && r.data.messages[0].grouped_id !== 'album123', 'forwarded album keeps a fresh group id');
  ok((await call('GET', `/api/chats/${pc.id}/media?type=gif`, null, A.token)).data.messages.length === 2, 'GIFs shared-media tab');

  console.log('stories');
  const sf = await upload(B.token, png, 'image/png', 'story.png');
  r = await call('POST', '/api/stories', { file_id: sf.id, caption: 'استوری', period: 12 }, B.token);
  ok(r.status === 201 && r.data.story.kind === 'photo', 'post story');
  const sid = r.data.story.id;
  let feed = (await call('GET', '/api/stories', null, A.token)).data;
  ok(feed.users.length === 1 && feed.users[0].unseen === 1, 'story shows in peers feed as unseen');
  const chatsA = (await call('GET', '/api/chats', null, A.token)).data.chats;
  ok(chatsA.find((c) => c.id === pc.id).peer.stories.unseen === 1, 'chat list peer has story ring');
  await call('POST', `/api/stories/${sid}/view`, null, A.token);
  await call('POST', `/api/stories/${sid}/react`, { emoji: '❤️' }, A.token);
  feed = (await call('GET', '/api/stories', null, A.token)).data;
  ok(feed.users[0].unseen === 0, 'viewed story no longer unseen');
  const views = (await call('GET', `/api/stories/${sid}/views`, null, B.token)).data.views;
  ok(views.length === 1 && views[0].reaction === '❤️', 'author sees viewers and reactions');
  ok((await call('GET', `/api/stories/${sid}/views`, null, A.token)).status === 403, 'viewers list is private');
  r = await call('POST', `/api/chats/${pc.id}/messages`, { text: 'چه عکس قشنگی', story_id: sid }, A.token);
  ok(r.data.message.story?.id === sid, 'reply to story');
  ok((await call('GET', '/api/stories', null, C.token)).data.users.length === 0, 'strangers do not see the story');
  ok((await call('DELETE', `/api/stories/${sid}`, null, B.token)).status === 200, 'delete story');

  console.log('calls');
  const wa = await client(A.token), wb = await client(B.token);
  wa.send({ type: 'call_request', chat_id: pc.id, video: true, ref: 1 });
  const ack = await wa.waitFor((e) => e.type === 'ack' && e.ref === 1);
  ok(ack.result.state === 'ringing' && ack.result.ice_servers.length, 'call rings');
  const inc = await wb.waitFor((e) => e.type === 'call_incoming');
  ok(inc.call.video === true && inc.call.from.id === A.user.id, 'callee gets incoming call');
  wb.send({ type: 'call_accept', call_id: inc.call.id });
  await wa.waitFor((e) => e.type === 'call_accepted');
  wa.send({ type: 'call_signal', call_id: inc.call.id, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  const sig = await wb.waitFor((e) => e.type === 'call_signal');
  ok(sig.data.sdp.type === 'offer', 'signaling relayed');
  wb.send({ type: 'call_hangup', call_id: inc.call.id });
  const end = await wa.waitFor((e) => e.type === 'call_ended');
  ok(end.reason === 'ended', 'hangup ends call for both');
  const cm = await wa.waitFor((e) => e.type === 'message' && e.message.kind === 'call');
  ok(cm.message.call.reason === 'ended', 'call log message in chat');
  wa.send({ type: 'call_request', chat_id: pc.id, ref: 2 });
  const inc2 = await wb.waitFor((e) => e.type === 'call_incoming');
  wb.send({ type: 'call_hangup', call_id: inc2.call.id });
  ok((await wa.waitFor((e) => e.type === 'call_ended')).reason === 'declined', 'declined call');
  ok((await call('GET', '/api/calls', null, A.token)).data.calls.length === 2, 'call history');
  await call('PATCH', '/api/me/privacy', { calls: 'nobody' }, B.token);
  wa.send({ type: 'call_request', chat_id: pc.id, ref: 3 });
  ok((await wa.waitFor((e) => e.type === 'error' && e.ref === 3)).code === 'privacy_restricted', 'calls privacy respected');
  wa.ws.close(); wb.ws.close();

  console.log(`\nall ${passed} feature checks passed ✅`);
  server.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
