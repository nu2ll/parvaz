'use strict';
// Scheduled messages (Web K: right-click the send button → "Schedule message").
const repo = require('./db');
const v = require('./validate');
const hub = require('./hub');
const service = require('./service');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const MAX_AHEAD = 365 * 24 * 3600_000;

const view = (r) => {
  let body = {};
  try { body = JSON.parse(r.body); } catch {}
  return { id: r.id, chat_id: r.chat_id, send_at: r.send_at, created_at: r.created_at, text: body.text || '', topic_id: body.topic_id ?? null, silent: !!body.silent };
};

function list(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  service.requireMember(chatId, user.id);
  return { scheduled: repo.scheduledFor(chatId, user.id).map(view) };
}

function create(user, chatIdRaw, body) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = service.requireMember(chatId, user.id);
  if (chat.type === 'channel' && !service.isManager(membership)) throw err(403, 'forbidden', 'Only admins can post in this channel');
  service.checkPrivatePeer(chat, user.id);
  const at = Number(body.send_at);
  if (!Number.isFinite(at) || at < Date.now() + 5_000 || at > Date.now() + MAX_AHEAD) throw v.bad('send_at must be in the future (max one year)');
  if (repo.scheduledCount(chatId, user.id) >= 100) throw v.bad('Too many scheduled messages');
  const text = v.messageText(body.text);
  const id = repo.insertScheduled(chatId, user.id, { text, topic_id: body.topic_id ?? null, silent: !!body.silent, reply_to: body.reply_to ?? null }, Math.round(at));
  const out = view(repo.scheduledById(id));
  hub.sendToUser(user.id, { type: 'scheduled', chat_id: chatId });
  return { scheduled: out };
}

function remove(user, idRaw) {
  const row = repo.scheduledById(v.id(idRaw, 'id'));
  if (!row || row.sender_id !== user.id) throw err(404, 'not_found', 'Not found');
  repo.deleteScheduled(row.id);
  hub.sendToUser(user.id, { type: 'scheduled', chat_id: row.chat_id });
  return { ok: true };
}

function sendNow(user, idRaw) {
  const row = repo.scheduledById(v.id(idRaw, 'id'));
  if (!row || row.sender_id !== user.id) throw err(404, 'not_found', 'Not found');
  dispatch(row);
  return { ok: true };
}

function dispatch(row) {
  repo.deleteScheduled(row.id);
  const u = repo.userById(row.sender_id);
  if (!u) return;
  let body = {};
  try { body = JSON.parse(row.body); } catch { return; }
  try { service.sendMessage(u, { ...body, chat_id: row.chat_id }); }
  catch (e) { if (!(e instanceof HttpError)) console.error('[scheduled]', e); }
  hub.sendToUser(u.id, { type: 'scheduled', chat_id: row.chat_id });
}

function start(intervalMs = 2000) {
  const t = setInterval(() => { for (const row of repo.dueScheduled()) dispatch(row); }, intervalMs);
  t.unref();
  return t;
}

module.exports = { list, create, remove, sendNow, start };
