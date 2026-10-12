'use strict';
// 1:1 voice/video calls. The server only does signaling (SDP/ICE relayed over the WebSocket);
// media flows peer-to-peer over WebRTC (optionally through your TURN server).
const repo = require('./db');
const hub = require('./hub');
const v = require('./validate');
const service = require('./service');
const config = require('./config');
const { HttpError, rateLimit } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const RING_MS = 45_000;
const live = new Map(); // callId -> call
const busy = new Map(); // userId -> callId

function iceServers() {
  if (process.env.ICE_SERVERS) {
    try { const list = JSON.parse(process.env.ICE_SERVERS); if (Array.isArray(list)) return list; } catch {}
  }
  const list = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean) }];
  if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  return list;
}

function callView(c, viewerId) {
  const peerId = c.caller_id === viewerId ? c.callee_id : c.caller_id;
  return {
    id: c.id,
    chat_id: c.chat_id,
    video: !!c.video,
    outgoing: c.caller_id === viewerId,
    state: c.state,
    reason: c.reason,
    created_at: c.created_at,
    started_at: c.started_at,
    ended_at: c.ended_at,
    duration: c.started_at && c.ended_at ? Math.round((c.ended_at - c.started_at) / 1000) : 0,
    peer: service.publicUser(repo.userById(peerId), viewerId),
  };
}

function history(user) {
  return { calls: repo.callsFor(user.id).map((c) => callView(c, user.id)) };
}

function finish(c, reason) {
  if (c.done) return;
  c.done = true;
  clearTimeout(c.timer);
  live.delete(c.id);
  for (const uid of [c.callerId, c.calleeId]) if (busy.get(uid) === c.id) busy.delete(uid);
  const ended = Date.now();
  const duration = c.startedAt ? Math.round((ended - c.startedAt) / 1000) : 0;
  const state = c.startedAt ? 'ended' : reason === 'declined' ? 'declined' : reason === 'busy' ? 'busy' : 'missed';
  repo.updateCall(c.id, { state, reason, started_at: c.startedAt, ended_at: ended });
  // a call log entry in the private chat, like Telegram
  if (repo.chatById(c.chatId)) {
    const mid = repo.tx(() => {
      const id = repo.insertMessage({
        chat_id: c.chatId, sender_id: c.callerId, kind: 'call', text: '',
        meta: JSON.stringify({ call_id: c.id, video: c.video, duration, reason: state }),
      });
      repo.markRead(c.chatId, c.callerId, id);
      return id;
    });
    service.emitMessage('message', mid);
  }
  hub.sendToUsers([c.callerId, c.calleeId], { type: 'call_ended', call_id: c.id, reason: state, duration });
}

function request(ws, m) {
  rateLimit(`call:${ws.user.id}`, 10, 60_000);
  const chatId = v.id(m.chat_id, 'chat_id');
  const { chat } = service.requireMember(chatId, ws.user.id);
  if (chat.type !== 'private') throw v.bad('Calls are available in private chats');
  const peerId = service.checkPrivatePeer(chat, ws.user.id);
  if (!peerId) throw v.bad('You cannot call yourself');
  const peer = repo.userById(peerId);
  if (!service.allows(peer, 'calls', ws.user.id)) throw err(403, 'privacy_restricted', 'This user does not accept calls from you');
  if (busy.has(ws.user.id)) throw err(409, 'already_in_call', 'You are already in a call');
  const video = !!m.video;
  const id = repo.insertCall({ chat_id: chatId, caller_id: ws.user.id, callee_id: peerId, video, state: 'ringing' });
  const c = { id, chatId, callerId: ws.user.id, calleeId: peerId, video, callerWs: ws, calleeWs: null, startedAt: null };
  live.set(id, c);
  busy.set(ws.user.id, id);
  if (busy.has(peerId)) { finish(c, 'busy'); return { call_id: id, state: 'ended', reason: 'busy' }; }
  if (!hub.isOnline(peerId)) { finish(c, 'missed'); return { call_id: id, state: 'ended', reason: 'unavailable' }; }
  busy.set(peerId, id);
  const caller = service.publicUser(repo.userById(ws.user.id), peerId);
  hub.sendToUser(peerId, { type: 'call_incoming', call: { id, chat_id: chatId, video, from: caller } });
  c.timer = setTimeout(() => finish(c, 'missed'), RING_MS);
  return { call_id: id, state: 'ringing', ice_servers: iceServers() };
}

function getCall(ws, m) {
  const c = live.get(Number(m.call_id));
  if (!c || (c.callerId !== ws.user.id && c.calleeId !== ws.user.id)) throw err(404, 'call_not_found', 'Call not found');
  return c;
}

function accept(ws, m) {
  const c = getCall(ws, m);
  if (c.calleeId !== ws.user.id || c.startedAt) throw v.bad('Cannot accept this call');
  c.startedAt = Date.now();
  c.calleeWs = ws;
  clearTimeout(c.timer);
  repo.updateCall(c.id, { state: 'active', started_at: c.startedAt });
  c.callerWs.send({ type: 'call_accepted', call_id: c.id });
  // stop ringing on the callee's other devices
  for (const other of hub.all()) {
    if (other !== ws && other.user?.id === c.calleeId) other.send({ type: 'call_ended', call_id: c.id, reason: 'answered_elsewhere' });
  }
  return { ok: true, ice_servers: iceServers() };
}

function signal(ws, m) {
  const c = getCall(ws, m);
  const raw = JSON.stringify(m.data ?? null);
  if (raw.length > 64 * 1024) throw v.bad('Signal too large');
  const other = ws === c.callerWs ? c.calleeWs : ws === c.calleeWs ? c.callerWs : null;
  if (!other) return { ok: false };
  other.send({ type: 'call_signal', call_id: c.id, data: m.data });
  return { ok: true };
}

function hangup(ws, m) {
  const c = getCall(ws, m);
  if (!c.startedAt) finish(c, ws.user.id === c.calleeId ? 'declined' : 'cancelled');
  else finish(c, 'ended');
  return { ok: true };
}

function onSocketClose(ws) {
  for (const c of [...live.values()]) {
    if (c.callerWs === ws || c.calleeWs === ws) finish(c, c.startedAt ? 'ended' : 'cancelled');
  }
}

module.exports = { request, accept, signal, hangup, onSocketClose, history, iceServers, _live: live };
