'use strict';
// End-to-end test: boots the server on a random port with an in-memory DB and drives it like real clients.
process.env.DB_PATH = ':memory:';
const net = require('node:net');
const { start } = require('../server');

let base, wsBase, passed = 0;
const ok = (cond, label) => {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
  console.log('  ✓', label);
};

async function call(method, path, body, token, raw) {
  const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  let payload;
  if (raw) { payload = raw.data; headers['Content-Type'] = raw.type; }
  else if (body != null) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: res.headers, data };
}

function client(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase);
    const events = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      const w = waiters.find((w) => w.pred(ev));
      if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); } else events.push(ev);
    };
    const api = {
      ws, events,
      send: (o) => ws.send(JSON.stringify(o)),
      waitFor(pred, ms = 2000) {
        const i = events.findIndex(pred);
        if (i >= 0) return Promise.resolve(events.splice(i, 1)[0]);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout waiting for event')), ms);
          waiters.push({ pred, resolve: (ev) => { clearTimeout(t); res(ev); } });
        });
      },
      drain() { events.length = 0; },
      closed: new Promise((res) => (ws.onclose = (e) => res(e.code))),
    };
    ws.onopen = () => {
      api.send({ type: 'auth', token });
      api.waitFor((e) => e.type === 'ready' || e.type === 'error').then((e) => (e.type === 'ready' ? resolve(api) : reject(new Error(e.message))));
    };
    ws.onerror = () => {};
  });
}

(async () => {
  const server = await start(0, '127.0.0.1');
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;

  console.log('accounts');
  ok((await call('POST', '/api/auth/register', { username: 'ali', password: 'supersecret1' })).status === 400, 'too-short username rejected');
  const a = await call('POST', '/api/auth/register', { username: 'ali_r', display_name: 'علی', password: 'supersecret1' });
  ok(a.status === 201 && a.data.token, 'register ali_r');
  const s = await call('POST', '/api/auth/register', { username: 'sara', display_name: 'سارا', password: 'supersecret2' });
  const r = await call('POST', '/api/auth/register', { username: 'reza', display_name: 'رضا', password: 'supersecret3' });
  ok((await call('POST', '/api/auth/register', { username: 'SARA', password: 'whatever123' })).status === 409, 'usernames are case-insensitive');
  ok((await call('POST', '/api/auth/register', { username: 'admin', password: 'whatever123' })).status === 409, 'reserved username blocked');
  ok((await call('POST', '/api/auth/login', { username: 'sara', password: 'nope-nope' })).status === 401, 'wrong password rejected');
  const sl = await call('POST', '/api/auth/login', { username: 'sara', password: 'supersecret2' });
  ok(sl.status === 200, 'login works');
  const A = a.data.token, S = sl.data.token, R = r.data.token, S0 = s.data.token;
  const aliId = a.data.user.id, saraId = s.data.user.id, rezaId = r.data.user.id;
  const saved = (await call('GET', '/api/chats', null, A)).data.chats;
  ok(saved.length === 1 && saved[0].peer.id === aliId, 'new account starts with Saved Messages');

  console.log('profile, privacy, sessions');
  const pr = await call('PATCH', '/api/me', { bio: 'سلام، من علی‌ام', display_name: 'علی رضایی' }, A);
  ok(pr.data.user.bio === 'سلام، من علی‌ام' && pr.data.user.display_name === 'علی رضایی', 'update name + bio');
  ok((await call('PATCH', '/api/me', { username: 'sara' }, A)).status === 409, 'cannot steal a username');
  const sess = await call('GET', '/api/sessions', null, S);
  ok(sess.data.sessions.length === 2 && sess.data.sessions.filter((x) => x.current).length === 1, 'two sessions listed, one current');
  const other = sess.data.sessions.find((x) => !x.current);
  ok((await call('DELETE', `/api/sessions/${other.id}`, null, S)).status === 200, 'terminate other session');
  ok((await call('GET', '/api/me', null, S0)).status === 401, 'terminated session is dead');

  console.log('uploads');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const up = await call('POST', '/api/files?name=' + encodeURIComponent('عکس.png'), undefined, A, { data: png, type: 'image/png' });
  ok(up.status === 201 && /^[a-f0-9]{32}$/.test(up.data.file.id), 'upload a photo');
  const fileRes = await fetch(base + up.data.file.url);
  ok(fileRes.status === 200 && fileRes.headers.get('content-type') === 'image/png' && fileRes.headers.get('x-content-type-options') === 'nosniff', 'photo served inline, nosniff');
  const ranged = await fetch(base + up.data.file.url, { headers: { Range: 'bytes=0-7' } });
  ok(ranged.status === 206 && (await ranged.arrayBuffer()).byteLength === 8, 'range requests work (video/voice seeking)');
  const html = await call('POST', '/api/files?name=x.html', undefined, A, { data: Buffer.from('<script>alert(1)</script>'), type: 'text/html' });
  const htmlRes = await fetch(base + html.data.file.url);
  ok(htmlRes.headers.get('content-type') === 'application/octet-stream' && /attachment/.test(htmlRes.headers.get('content-disposition')), 'html upload forced to download (no XSS)');
  ok((await call('PATCH', '/api/me', { avatar: html.data.file.id }, A)).status === 400, 'non-image avatar rejected');
  ok((await call('PATCH', '/api/me', { avatar: up.data.file.id }, A)).data.user.avatar === up.data.file.url, 'set avatar');
  ok((await call('POST', '/api/files', undefined, null, { data: png, type: 'image/png' })).status === 401, 'upload needs login');

  console.log('private chat + realtime');
  const found = await call('GET', '/api/search?q=sa', null, A);
  ok(found.data.users.length === 1 && found.data.users[0].username === 'sara', 'global search finds sara');
  const pc = await call('POST', '/api/chats/private', { username: '@sara' }, A);
  const chatId = pc.data.chat.id;
  ok(pc.data.chat.type === 'private' && pc.data.chat.title === 'سارا', 'open private chat');
  ok((await call('GET', `/api/chats/${chatId}/messages`, null, R)).status === 404, 'outsider cannot read chat');

  const wa = await client(A);
  const ws = await client(S);
  ok((await wa.waitFor((e) => e.type === 'presence' && e.online)).user_id === saraId, 'presence: sara online');

  wa.send({ type: 'send', chat_id: chatId, text: 'سلام سارا! **بولد** و @sara 👋' });
  const got = await ws.waitFor((e) => e.type === 'message');
  ok(got.message.text.includes('سلام سارا') && got.message.sender.avatar === up.data.file.url, 'message arrives instantly with sender avatar');
  ws.send({ type: 'typing', chat_id: chatId, action: 'recording' });
  ok((await wa.waitFor((e) => e.type === 'typing')).action === 'recording', 'typing/recording indicator');
  ws.send({ type: 'read', chat_id: chatId, message_id: got.message.id });
  ok((await wa.waitFor((e) => e.type === 'read')).message_id === got.message.id, 'read receipt ✓✓');

  ws.send({ type: 'react', message_id: got.message.id, emoji: '❤️', ref: 1 });
  const re1 = await wa.waitFor((e) => e.type === 'message_updated');
  ok(re1.message.reactions[0].emoji === '❤️' && re1.message.reactions[0].count === 1 && !re1.message.reactions[0].mine, 'reaction delivered');
  ok((await ws.waitFor((e) => e.type === 'ack' && e.ref === 1)).result.reactions[0].mine, 'ack with result');
  ws.send({ type: 'react', message_id: got.message.id, emoji: '❤️' });
  ok((await wa.waitFor((e) => e.type === 'message_updated')).message.reactions.length === 0, 'same reaction again removes it');
  ws.send({ type: 'react', message_id: got.message.id, emoji: '💩', ref: 2 });
  ok((await ws.waitFor((e) => e.type === 'error' && e.ref === 2)).code === 'validation', 'unknown reaction rejected');

  const photo = await call('POST', `/api/chats/${chatId}/messages`, { file_id: up.data.file.id, text: 'کپشن', reply_to: got.message.id }, A);
  ok(photo.data.message.kind === 'photo' && photo.data.message.media.mime === 'image/png' && photo.data.message.reply.id === got.message.id, 'send photo with caption + reply');
  ok((await call('POST', `/api/chats/${chatId}/messages`, { file_id: up.data.file.id }, S)).status === 404, "can't send someone else's file");
  const voiceUp = await call('POST', '/api/files?name=voice.webm', undefined, S, { data: Buffer.alloc(2000, 1), type: 'audio/webm;codecs=opus' });
  const voice = await call('POST', `/api/chats/${chatId}/messages`, { file_id: voiceUp.data.file.id, voice: true, meta: { duration: 3.4, evil: 1 } }, S);
  ok(voice.data.message.kind === 'voice' && voice.data.message.media.duration === 3.4 && voice.data.message.media.evil === undefined, 'voice message with sanitized duration');

  ok((await call('PATCH', `/api/messages/${got.message.id}`, { text: 'ویرایش شد' }, A)).data.message.edited_at, 'edit message');
  ok((await call('PATCH', `/api/messages/${got.message.id}`, { text: 'hack' }, S)).status === 403, "can't edit others' messages");
  ok((await call('POST', `/api/chats/${chatId}/pin`, { message_id: got.message.id }, S)).status === 200, 'pin message (private: anyone)');
  const afterPin = (await call('GET', '/api/chats', null, A)).data.chats.find((c) => c.id === chatId);
  ok(afterPin.pinned_message.id === got.message.id, 'pinned message on chat');
  ok(afterPin.last_message.kind === 'service' && afterPin.last_message.service.action === 'pinned', 'pin service message');

  const srch = await call('GET', `/api/chats/${chatId}/search?q=${encodeURIComponent('ویرایش')}`, null, S);
  ok(srch.data.messages.length === 1, 'search inside chat');
  const media = await call('GET', `/api/chats/${chatId}/media?type=media`, null, S);
  ok(media.data.messages.length === 1 && media.data.messages[0].kind === 'photo', 'shared media list');
  const around = await call('GET', `/api/chats/${chatId}/messages?around=${photo.data.message.id}&limit=2`, null, A);
  ok(around.data.messages.some((m) => m.id === photo.data.message.id), 'jump-to-message (around)');

  console.log('settings: pin / mute / archive');
  ok((await call('PATCH', `/api/chats/${chatId}/settings`, { pinned: true, muted: true }, A)).data.chat.pinned_at && true, 'pin + mute chat');
  const arch = await call('PATCH', `/api/chats/${chatId}/settings`, { archived: true }, A);
  ok(arch.data.chat.archived && arch.data.chat.pinned_at === null, 'archive unpins');

  console.log('groups');
  wa.drain(); ws.drain();
  const g = await call('POST', '/api/chats/group', { title: 'تیم کبوتر', usernames: ['sara'] }, A);
  const gid = g.data.chat.id;
  ok(g.status === 201 && g.data.chat.member_count === 2 && g.data.chat.role === 'owner', 'create group');
  ok((await ws.waitFor((e) => e.type === 'chat' && e.chat.id === gid)).chat.title === 'تیم کبوتر', 'sara notified');
  ok((await call('POST', `/api/chats/${gid}/members`, { username: 'reza' }, S)).status === 403, 'member cannot add people');
  ok((await call('POST', `/api/chats/${gid}/members`, { usernames: ['reza'] }, A)).data.chat.member_count === 3, 'owner adds reza');
  const svc = await ws.waitFor((e) => e.type === 'message' && e.message.kind === 'service' && e.message.service.action === 'added');
  ok(svc.message.service.names[0] === 'رضا', 'service message: added');
  ok((await call('PATCH', `/api/chats/${gid}/members/${saraId}`, { role: 'admin' }, A)).status === 200, 'promote sara to admin');
  ok((await call('DELETE', `/api/chats/${gid}/members/${aliId}`, null, S)).status === 403, 'admin cannot kick owner');
  const poll = await call('POST', `/api/chats/${gid}/messages`, { poll: { question: 'ناهار چی؟', options: ['پیتزا', 'کباب', 'سالاد'] } }, S);
  ok(poll.data.message.kind === 'poll' && poll.data.message.poll.options.length === 3, 'create poll');
  const v1 = await call('POST', `/api/messages/${poll.data.message.id}/vote`, { option: 1 }, R);
  ok(v1.data.message.poll.my_vote === 1 && v1.data.message.poll.total === 1, 'vote');
  ok((await call('POST', `/api/messages/${poll.data.message.id}/vote`, { option: 7 }, A)).status === 400, 'invalid vote rejected');
  ok((await call('POST', `/api/messages/${poll.data.message.id}/vote`, { option: 1 }, A)).data.message.poll.options[1].votes === 2, 'second vote counted');
  const inv = await call('POST', `/api/chats/${gid}/invite`, {}, S);
  ok(inv.data.invite_token, 'admin creates invite link');
  ok((await call('POST', `/api/chats/${gid}/invite`, {}, R)).status === 403, 'member cannot see invite link');
  ok((await call('DELETE', `/api/chats/${gid}/members/${rezaId}`, null, S)).status === 200, 'admin kicks reza');
  ok((await call('POST', '/api/join/preview', { invite: inv.data.invite_token }, R)).data.chat.title === 'تیم کبوتر', 'invite preview');
  const joined = await call('POST', '/api/join', { invite: inv.data.invite_token }, R);
  ok(joined.data.chat.id === gid && joined.data.chat.role === 'member', 'rejoin via invite link');
  ok((await call('POST', '/api/join', { invite: 'nope' }, R)).status === 404, 'bad invite rejected');

  const fw = await call('POST', '/api/messages/forward', { to_chat_id: gid, message_ids: [photo.data.message.id] }, S);
  ok(fw.data.messages[0].forward.from_name === 'علی رضایی' && fw.data.messages[0].kind === 'photo', 'forward keeps original author + media');
  ok((await call('POST', '/api/messages/forward', { to_chat_id: gid, message_ids: [photo.data.message.id] }, R)).status === 404, "can't forward from a chat you're not in");
  ok((await call('POST', '/api/messages/delete', { message_ids: [fw.data.messages[0].id] }, R)).status === 403, "member can't delete others' messages");
  wa.drain();
  ok((await call('POST', '/api/messages/delete', { message_ids: [fw.data.messages[0].id] }, S)).status === 200, 'admin deletes message');
  ok((await wa.waitFor((e) => e.type === 'messages_deleted')).message_ids[0] === fw.data.messages[0].id, 'delete propagates');

  console.log('channels');
  const ch = await call('POST', '/api/chats/channel', { title: 'اخبار کبوتر', username: 'kabootar_news', description: 'کانال رسمی' }, A);
  const cid = ch.data.chat.id;
  ok(ch.status === 201 && ch.data.chat.type === 'channel' && ch.data.chat.username === 'kabootar_news', 'create public channel');
  ok((await call('POST', '/api/chats/channel', { title: 'x', username: 'ali_r' }, S)).status === 409, 'channel username cannot clash with a user');
  await call('POST', `/api/chats/${cid}/messages`, { text: 'پست اول' }, A);
  const rs = await call('GET', '/api/resolve/kabootar_news', null, R);
  ok(rs.data.chat && !rs.data.chat.is_member, 'resolve @channel');
  const sub = await call('POST', '/api/join', { username: 'kabootar_news' }, R);
  ok(sub.data.chat.unread === 0 && sub.data.chat.can_post === false, 'subscribe: no unread backlog, cannot post');
  ok((await call('POST', `/api/chats/${cid}/messages`, { text: 'spam' }, R)).status === 403, 'subscriber cannot post');
  const post = await call('POST', `/api/chats/${cid}/messages`, { text: 'پست دوم' }, A);
  await call('POST', `/api/chats/${cid}/read`, { message_id: post.data.message.id }, R);
  const hist = await call('GET', `/api/chats/${cid}/messages`, null, A);
  ok(hist.data.messages.at(-1).views === 2, 'channel views counter');
  ok((await call('GET', `/api/chats/${cid}`, null, R)).data.members.length === 0, 'subscribers list hidden from subscribers');
  ok((await call('GET', `/api/search?q=kabootar`, null, S)).data.chats.length === 1, 'public channel shows in search');

  console.log('leave / delete');
  ok((await call('POST', `/api/chats/${gid}/leave`, null, A)).status === 200, 'owner leaves group');
  const det = await call('GET', `/api/chats/${gid}`, null, S);
  ok(det.data.members.find((m) => m.username === 'sara').role === 'owner', 'ownership passes to an admin');
  ok((await call('DELETE', `/api/chats/${cid}`, null, R)).status === 403, 'subscriber cannot delete channel');
  ok((await call('DELETE', `/api/chats/${cid}`, null, A)).status === 200, 'owner deletes channel');
  ok((await call('GET', `/api/chats/${cid}`, null, R)).status === 404, 'channel is gone for everyone');

  console.log('security');
  const bad = await new Promise((res) => {
    const w = new WebSocket(wsBase);
    w.onopen = () => w.send(JSON.stringify({ type: 'auth', token: 'x'.repeat(43) }));
    w.onclose = (e) => res(e.code);
  });
  ok(bad === 4001, 'bad WS token kicked');
  const page = await fetch(base + '/');
  ok(page.status === 200 && page.headers.get('content-security-policy').includes("script-src 'self'"), 'web client served with strict CSP');
  const trav = await new Promise((res) => {
    const c = net.connect(port, '127.0.0.1', () => c.write('GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let d = ''; c.on('data', (x) => (d += x)); c.on('end', () => res(d.split('\r\n')[0]));
  });
  ok(!trav.includes('200'), 'path traversal blocked');
  ok((await fetch(base + '/files/../../etc/passwd')).status === 404, 'file path traversal blocked');
  const pw = await call('POST', '/api/me/password', { current_password: 'supersecret2', new_password: 'newsecret22' }, S);
  ok(pw.status === 200, 'change password');
  ok((await call('POST', '/api/auth/login', { username: 'sara', password: 'newsecret22' })).status === 200, 'login with new password');
  const lo = await call('POST', '/api/auth/logout', null, S);
  ok(lo.status === 200 && (await ws.closed) === 4001, 'logout revokes token and kicks sockets');
  await call('PATCH', '/api/me', { show_last_seen: false }, R);
  const hidden = (await call('GET', '/api/resolve/reza', null, A)).data.user;
  ok(hidden.last_seen_hidden && hidden.last_seen === null, 'last-seen privacy respected');

  wa.ws.close();
  console.log(`\nall ${passed} checks passed ✅`);
  server.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
