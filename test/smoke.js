'use strict';
// End-to-end smoke test: boots the server on a random port with an in-memory DB.
process.env.DB_PATH = ':memory:';
const net = require('node:net');
const { start } = require('../server');

let base, wsBase, passed = 0;
const ok = (cond, label) => {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
  console.log('  ✓', label);
};

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
}

function client(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase);
    const events = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      events.push(ev);
      for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
    };
    const api = {
      ws, events,
      send: (o) => ws.send(JSON.stringify(o)),
      waitFor(pred, ms = 2000) {
        const found = events.find(pred);
        if (found) { events.splice(events.indexOf(found), 1); return Promise.resolve(found); }
        return new Promise((res, rej) => {
          const w = { pred, resolve: (ev) => { clearTimeout(t); events.splice(events.indexOf(ev), 1); res(ev); } };
          const t = setTimeout(() => rej(new Error('timeout waiting for event')), ms);
          waiters.push(w);
        });
      },
      closed: new Promise((res) => (ws.onclose = (e) => res(e.code))),
    };
    ws.onopen = () => { api.send({ type: 'auth', token }); api.waitFor((e) => e.type === 'ready' || e.type === 'error').then((e) => e.type === 'ready' ? resolve(api) : reject(new Error(e.message))); };
    ws.onerror = () => {};
  });
}

(async () => {
  const server = await start(0, '127.0.0.1');
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;

  console.log('auth');
  const ali = await call('POST', '/api/auth/register', { username: 'ali', display_name: 'علی', password: 'supersecret1' });
  ok(ali.status === 400, 'rejects too-short username (ali)');
  const a = await call('POST', '/api/auth/register', { username: 'ali_r', display_name: 'علی', password: 'supersecret1' });
  ok(a.status === 201 && a.data.token, 'register ali_r');
  const s = await call('POST', '/api/auth/register', { username: 'sara', display_name: 'سارا', password: 'supersecret2' });
  ok(s.status === 201, 'register sara');
  ok((await call('POST', '/api/auth/register', { username: 'SARA', password: 'whatever123' })).status === 409, 'duplicate username is case-insensitive');
  ok((await call('POST', '/api/auth/register', { username: 'reza', password: 'short' })).status === 400, 'weak password rejected');
  ok((await call('POST', '/api/auth/login', { username: 'sara', password: 'nope-nope' })).status === 401, 'wrong password rejected');
  ok((await call('POST', '/api/auth/login', { username: 'ghost', password: 'nope-nope' })).status === 401, 'unknown user rejected');
  const sl = await call('POST', '/api/auth/login', { username: 'sara', password: 'supersecret2' });
  ok(sl.status === 200 && sl.data.token, 'login sara');
  const r = await call('POST', '/api/auth/register', { username: 'reza', display_name: 'رضا', password: 'supersecret3' });
  const A = a.data.token, S = sl.data.token, R = r.data.token;
  ok((await call('GET', '/api/me')).status === 401, '/api/me needs a token');
  ok((await call('GET', '/api/me', null, A)).data.user.username === 'ali_r', '/api/me works');

  console.log('search + private chat');
  const found = await call('GET', '/api/users/search?q=sa', null, A);
  ok(found.data.users.length === 1 && found.data.users[0].username === 'sara', 'search finds sara');
  ok((await call('GET', '/api/users/search?q=%25', null, A)).data.users.length === 0, 'LIKE wildcards are escaped');
  const pc = await call('POST', '/api/chats/private', { username: '@sara' }, A);
  ok(pc.status === 200 && pc.data.chat.type === 'private' && pc.data.chat.title === 'سارا', 'open private chat');
  const chatId = pc.data.chat.id;
  ok((await call('POST', '/api/chats/private', { username: 'ali_r' }, S)).data.chat.id === chatId, 'same private chat from both sides');
  ok((await call('GET', `/api/chats/${chatId}/messages`, null, R)).status === 404, 'outsider cannot read chat');

  console.log('realtime');
  const wa = await client(A);
  const ws = await client(S);
  ok(true, 'both clients authenticated over WebSocket');
  const pres = await wa.waitFor((e) => e.type === 'presence' && e.online);
  ok(pres.user_id === s.data.user.id, 'ali sees sara come online');

  wa.send({ type: 'send', chat_id: chatId, text: 'سلام سارا! 👋' });
  const got = await ws.waitFor((e) => e.type === 'message');
  ok(got.message.text === 'سلام سارا! 👋' && got.message.sender.username === 'ali_r', 'sara receives message instantly');
  ok((await wa.waitFor((e) => e.type === 'message')).message.id === got.message.id, 'sender devices get it too');

  ws.send({ type: 'typing', chat_id: chatId });
  ok((await wa.waitFor((e) => e.type === 'typing')).user.id === s.data.user.id, 'typing indicator delivered');

  const list = await call('GET', '/api/chats', null, S);
  ok(list.data.chats[0].unread === 1, 'sara has 1 unread');
  ws.send({ type: 'read', chat_id: chatId, message_id: got.message.id });
  ok((await wa.waitFor((e) => e.type === 'read')).message_id === got.message.id, 'read receipt delivered to ali');
  ok((await call('GET', '/api/chats', null, S)).data.chats[0].unread === 0, 'unread cleared');

  ws.send({ type: 'send', chat_id: chatId, text: 'سلام!', reply_to: got.message.id });
  const reply = await wa.waitFor((e) => e.type === 'message' && e.message.reply_to);
  ok(reply.message.reply.text === 'سلام سارا! 👋', 'reply carries quoted message');

  wa.send({ type: 'edit', message_id: got.message.id, text: 'سلام سارا جان' });
  const ed = await ws.waitFor((e) => e.type === 'message_updated');
  ok(ed.message.text === 'سلام سارا جان' && ed.message.edited_at, 'edit propagates');
  ws.send({ type: 'edit', message_id: got.message.id, text: 'hacked', ref: 7 });
  const er = await ws.waitFor((e) => e.type === 'error');
  ok(er.code === 'forbidden' && er.ref === 7, "can't edit someone else's message");

  ws.send({ type: 'send', chat_id: chatId, text: 'x'.repeat(5000), ref: 8 });
  ok((await ws.waitFor((e) => e.type === 'error' && e.ref === 8)).code === 'validation', 'overlong message rejected');
  wa.send({ type: 'send', chat_id: 9999, text: 'hi', ref: 9 });
  ok((await wa.waitFor((e) => e.type === 'error' && e.ref === 9)).code === 'not_found', 'cannot post to unknown chat');

  wa.send({ type: 'delete', message_id: got.message.id });
  const del = await ws.waitFor((e) => e.type === 'message_updated' && e.message.deleted);
  ok(del.message.text === '', 'delete wipes text for everyone');

  const rest = await call('POST', `/api/chats/${chatId}/messages`, { text: 'via REST' }, S);
  ok(rest.status === 201 && (await wa.waitFor((e) => e.type === 'message')).message.text === 'via REST', 'REST send is pushed over WS');

  const hist = await call('GET', `/api/chats/${chatId}/messages?limit=2`, null, A);
  ok(hist.data.messages.length === 2 && hist.data.has_more === true, 'history pagination');
  const older = await call('GET', `/api/chats/${chatId}/messages?limit=2&before=${hist.data.messages[0].id}`, null, A);
  ok(older.data.messages.length === 1 && !older.data.has_more, 'older page');

  console.log('groups');
  const g = await call('POST', '/api/chats/group', { title: 'تیم کبوتر', usernames: ['sara'] }, A);
  ok(g.status === 201 && g.data.chat.member_count === 2 && g.data.chat.role === 'owner', 'create group');
  ok((await ws.waitFor((e) => e.type === 'chat')).chat.title === 'تیم کبوتر', 'sara notified about new group');
  ok((await call('POST', `/api/chats/${g.data.chat.id}/members`, { username: 'reza' }, S)).status === 403, 'non-admin cannot add members');
  ok((await call('POST', `/api/chats/${g.data.chat.id}/members`, { username: 'reza' }, A)).data.chat.member_count === 3, 'owner adds reza');
  ok((await call('POST', `/api/chats/${g.data.chat.id}/leave`, null, A)).status === 200, 'owner leaves');
  const det = await call('GET', `/api/chats/${g.data.chat.id}`, null, S);
  ok(det.data.members.find((m) => m.username === 'sara').role === 'owner', 'ownership passes to next member');

  console.log('security');
  const bad = await new Promise((res) => {
    const w = new WebSocket(wsBase);
    w.onopen = () => w.send(JSON.stringify({ type: 'auth', token: 'x'.repeat(43) }));
    w.onclose = (e) => res(e.code);
  });
  ok(bad === 4001, 'bad WS token is kicked (4001)');
  const page = await fetch(base + '/');
  ok(page.status === 200 && page.headers.get('content-security-policy').includes("script-src 'self'"), 'web client served with CSP');
  const trav = await new Promise((res) => {
    const c = net.connect(port, '127.0.0.1', () => c.write('GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let d = ''; c.on('data', (x) => (d += x)); c.on('end', () => res(d.split('\r\n')[0]));
  });
  ok(!trav.includes('200'), 'path traversal blocked (' + trav + ')');
  const lo = await call('POST', '/api/auth/logout', null, S);
  ok(lo.status === 200 && (await ws.closed) === 4001, 'logout revokes token and kicks sockets');
  ok((await call('GET', '/api/me', null, S)).status === 401, 'revoked token no longer works');
  const off = await wa.waitFor((e) => e.type === 'presence' && !e.online);
  ok(off.last_seen > 0, 'ali sees sara go offline with last_seen');

  wa.ws.close();
  console.log(`\nall ${passed} checks passed ✅`);
  server.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
