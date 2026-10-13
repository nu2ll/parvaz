'use strict';
// HTTP long-poll transport ("live over HTTP"). Some networks and VPNs break or silently kill
// WebSockets; the client then switches here and keeps the exact same event stream:
//   POST   /api/live            → { sid, events: [ready] }
//   GET    /api/live/:sid?ack=n → waits up to 25s, returns { events: [{seq, ev}] }
//   POST   /api/live/:sid/send  → same frames as the socket (send, typing, read, react, calls…)
//   DELETE /api/live/:sid       → closes it (the socket came back)
// A poll session registers in the hub like a socket, so presence, calls and pushes just work.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const hub = require('./hub');
const repo = require('./db');
const service = require('./service');
const { HttpError } = require('./http-util');

const HOLD_MS = 20_000;
const IDLE_MS = 70_000; // no poll for this long → session is gone (user offline)
const MAX_QUEUE = 2000;
const sessions = new Map(); // sid -> PollSocket

class PollSocket extends EventEmitter {
  constructor(user, ip) {
    super();
    this.sid = crypto.randomBytes(18).toString('base64url');
    this.user = user;
    this.tokenHash = user.token_hash;
    this.ip = ip;
    this.isAlive = true;
    this.closed = false;
    this.queue = []; // [{ seq, ev }]
    this.seq = 0;
    this.waiter = null;
    this.lastPoll = Date.now();
    this.transport = 'poll';
  }
  send(data) {
    if (this.closed) return;
    const ev = typeof data === 'string' ? JSON.parse(data) : data;
    this.queue.push({ seq: ++this.seq, ev });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.flush();
  }
  flush() {
    if (!this.waiter || !this.queue.length) return;
    const w = this.waiter;
    this.waiter = null;
    clearTimeout(w.timer);
    w.resolve({ events: this.queue.slice() });
  }
  ping() { this.isAlive = true; }
  close(code = 1000) {
    if (this.closed) return;
    this.send({ type: '__closed', code });
    this.flush();
    this.finish();
  }
  terminate() { this.finish(); }
  finish() {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this.sid);
    if (this.waiter) { clearTimeout(this.waiter.timer); this.waiter.resolve({ events: this.queue.slice() }); this.waiter = null; }
    this.emit('close');
  }
}

const notFound = () => new HttpError(404, 'live_gone', 'Live session expired');
function own(user, sid) {
  const s = sessions.get(String(sid));
  if (!s || s.closed || s.user.id !== user.id || s.tokenHash !== user.token_hash) throw notFound();
  s.lastPoll = Date.now();
  return s;
}

function open(user, ip) {
  const s = new PollSocket(user, ip);
  sessions.set(s.sid, s);
  const cameOnline = hub.add(user.id, s);
  s.on('close', () => {
    require('./calls').onSocketClose(s);
    if (hub.remove(user.id, s)) { repo.touchUser(user.id); service.broadcastPresence(user.id); }
  });
  const ready = { type: 'ready', user: service.selfUser(user) };
  if (cameOnline) service.broadcastPresence(user.id);
  return { sid: s.sid, hold_ms: HOLD_MS, events: [{ seq: 0, ev: ready }] };
}

function poll(user, sid, ack) {
  const s = own(user, sid);
  const a = Number(ack) || 0;
  if (a) s.queue = s.queue.filter((x) => x.seq > a);
  if (s.queue.length) return { events: s.queue.slice() };
  if (s.waiter) { clearTimeout(s.waiter.timer); s.waiter.resolve({ events: [] }); }
  return new Promise((resolve) => {
    s.waiter = { resolve, timer: setTimeout(() => { if (s.waiter?.resolve === resolve) s.waiter = null; resolve({ events: [] }); }, HOLD_MS) };
  });
}

function send(user, sid, msg) {
  const s = own(user, sid);
  if (!msg || typeof msg.type !== 'string') throw new HttpError(400, 'bad_json', 'Expected a JSON object with a "type"');
  const result = require('./realtime').dispatch(s, msg);
  return { ok: true, result: result === undefined ? null : result };
}

function close(user, sid) {
  try { own(user, sid).finish(); } catch {}
  return { ok: true };
}

// sessions whose client stopped polling are dropped (and the user goes offline)
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) if (!s.waiter && now - s.lastPoll > IDLE_MS) s.finish();
}, 15_000).unref();

module.exports = { open, poll, send, close, _sessions: sessions };
