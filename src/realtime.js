'use strict';
// WebSocket gateway: /ws
// 1) client connects, 2) first frame must be {"type":"auth","token":"..."} within 10s,
// 3) then it can send: send | edit | delete | read | typing | ping
const repo = require('./db');
const auth = require('./auth');
const hub = require('./hub');
const service = require('./service');
const config = require('./config');
const { acceptUpgrade, rejectUpgrade } = require('./ws');
const { HttpError, rateLimit } = require('./http-util');

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;

const handlers = {
  send: (ws, m) => {
    rateLimit(`send:${ws.user.id}`, 30, 10_000);
    service.sendMessage(ws.user, m.chat_id, m.text, m.reply_to);
  },
  edit: (ws, m) => service.editMessage(ws.user, m.message_id, m.text),
  delete: (ws, m) => service.deleteMessage(ws.user, m.message_id),
  read: (ws, m) => service.markRead(ws.user, m.chat_id, m.message_id),
  typing: (ws, m) => {
    rateLimit(`typing:${ws.user.id}`, 20, 10_000);
    service.typing(ws.user, m.chat_id);
  },
  ping: (ws) => ws.send({ type: 'pong', time: Date.now() }),
};

function onAuthenticated(ws, user) {
  ws.user = user;
  ws.tokenHash = user.token_hash;
  const cameOnline = hub.add(user.id, ws);
  ws.send({ type: 'ready', user: service.publicUser(user) });
  if (cameOnline) service.broadcastPresence(user.id, true);
}

function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
  if (config.allowedOrigins.length && !config.allowedOrigins.includes(req.headers.origin)) {
    return rejectUpgrade(socket, 403, 'Forbidden');
  }
  const ws = acceptUpgrade(req, socket, head);
  if (!ws) return;

  const authTimer = setTimeout(() => !ws.user && ws.close(4001), AUTH_TIMEOUT_MS);
  let frames = 0;
  let windowStart = Date.now();

  ws.on('binary', () => ws.close(1003));
  ws.on('message', (raw) => {
    // crude flood protection: 60 frames / 10s per connection
    const now = Date.now();
    if (now - windowStart > 10_000) { windowStart = now; frames = 0; }
    if (++frames > 60) return ws.close(1008);

    let msg;
    try { msg = JSON.parse(raw); } catch { msg = null; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return ws.send({ type: 'error', code: 'bad_json', message: 'Expected a JSON object with a "type"' });
    }

    if (!ws.user) {
      const user = msg.type === 'auth' ? auth.userFromToken(msg.token) : null;
      if (!user) {
        ws.send({ type: 'error', code: 'unauthorized', message: 'Authenticate first with a valid token' });
        return ws.close(4001);
      }
      clearTimeout(authTimer);
      return onAuthenticated(ws, user);
    }

    const handler = handlers[msg.type];
    if (!handler) return ws.send({ type: 'error', code: 'unknown_type', message: `Unknown type "${msg.type}"`, ref: msg.ref });
    try {
      handler(ws, msg);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[ws]', err);
      ws.send({
        type: 'error',
        code: err instanceof HttpError ? err.code : 'internal',
        message: err instanceof HttpError ? err.message : 'Internal error',
        ref: msg.ref,
      });
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (!ws.user) return;
    if (hub.remove(ws.user.id, ws)) {
      repo.touchUser(ws.user.id);
      service.broadcastPresence(ws.user.id, false);
    }
  });
}

function startHeartbeat() {
  const timer = setInterval(() => {
    for (const ws of hub.all()) {
      if (!ws.isAlive) ws.terminate();
      else ws.ping();
    }
  }, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { handleUpgrade, startHeartbeat };
