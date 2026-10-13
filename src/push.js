'use strict';
// Notifications for the Android app (and anything else that can't keep a socket open).
// The app's background service long-polls:
//   GET /api/push?since=<seq>  → waits up to 25s → { seq, items: [{ seq, type, ... }] }
// It does NOT count as "online" (no presence), it only receives what a notification needs:
// new messages from others (muted chats skipped) and "read" so a notification can be cleared
// when you read the chat on another device.
const repo = require('./db');

const HOLD_MS = 25_000;
const KEEP_MS = 15 * 60_000; // a queue lives this long after the last poll
const MAX_ITEMS = 100;
const users = new Map(); // userId -> { seq, items, waiters:Set, lastPoll }

const KIND = {
  photo: '🖼 عکس', video: '📹 ویدیو', gif: 'GIF', voice: '🎤 پیام صوتی', video_note: '📹 پیام ویدیویی', audio: '🎵 موزیک',
  file: '📎 فایل', sticker: 'استیکر', poll: '📊 نظرسنجی', location: '📍 موقعیت مکانی', contact: '👤 مخاطب', call: '📞 تماس',
};

function preview(row) {
  let meta = {};
  try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch {}
  const text = String(row.text || '').replace(/\s+/g, ' ').trim();
  if (row.kind === 'text') return text.slice(0, 300);
  if (row.kind === 'sticker') return `${meta.emoji || ''} استیکر`.trim();
  if (row.kind === 'poll') return `📊 ${text}`;
  if (row.kind === 'file' && row.f_name) return `📎 ${row.f_name}`;
  if (row.kind === 'audio' && row.f_name) return `🎵 ${row.f_name}`;
  const label = KIND[row.kind] || 'پیام';
  return text ? `${label}، ${text.slice(0, 200)}` : label;
}

function slot(userId) { return users.get(userId); }

function enqueue(userId, item) {
  const u = slot(userId);
  if (!u) return;
  item.seq = ++u.seq;
  u.items.push(item);
  if (u.items.length > MAX_ITEMS) u.items.splice(0, u.items.length - MAX_ITEMS);
  for (const w of u.waiters) w();
}

// called after a new message is stored (service.emitMessage)
function onMessage(row, chatView) {
  if (!row || row.kind === 'service' || !users.size) return;
  let meta = {};
  try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch {}
  for (const uid of repo.memberIds(row.chat_id)) {
    if (uid === row.sender_id || !users.has(uid)) continue;
    const me = repo.membership(row.chat_id, uid);
    if (!me || me.muted) continue;
    const chat = chatView(row.chat_id, uid);
    if (!chat) continue;
    enqueue(uid, {
      type: 'message',
      chat_id: row.chat_id,
      chat_type: chat.type,
      chat_title: chat.title,
      chat_avatar: chat.avatar,
      topic_id: row.topic_id ?? null,
      message_id: row.id,
      sender_id: row.sender_id,
      sender_name: row.sender_name,
      sender_avatar: row.sender_avatar ? `/files/${row.sender_avatar}` : null,
      text: preview(row),
      silent: !!meta.silent,
      unread: chat.unread,
      date: row.created_at,
    });
  }
}

function onRead(userId, chatId, messageId) {
  enqueue(userId, { type: 'read', chat_id: chatId, message_id: messageId });
}

function poll(user, sinceRaw) {
  const since = Math.max(0, Number(sinceRaw) || 0);
  let u = slot(user.id);
  if (!u) users.set(user.id, (u = { seq: 0, items: [], waiters: new Set(), lastPoll: Date.now(), boot: Date.now().toString(36) }));
  u.lastPoll = Date.now();
  // the client's cursor belongs to an older server run → start over from "now"
  const fresh = since > u.seq;
  const pick = () => (fresh ? [] : u.items.filter((i) => i.seq > since));
  const now = pick();
  if (now.length || fresh) return { seq: u.seq, items: now };
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      u.waiters.delete(wake);
      u.lastPoll = Date.now();
      resolve({ seq: u.seq, items: pick() });
    };
    const wake = () => setImmediate(finish);
    const timer = setTimeout(finish, HOLD_MS);
    u.waiters.add(wake);
  });
}

// forget users whose app stopped polling a while ago
setInterval(() => {
  const cut = Date.now() - KEEP_MS;
  for (const [id, u] of users) if (!u.waiters.size && u.lastPoll < cut) users.delete(id);
}, 60_000).unref();

module.exports = { poll, onMessage, onRead, preview, _users: users };
