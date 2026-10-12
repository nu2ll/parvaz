'use strict';
// Forum topics inside groups (Telegram "Topics"). Topic 0 is the built-in "General" topic.
const repo = require('./db');
const hub = require('./hub');
const v = require('./validate');
const service = require('./service');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const COLORS = 6; // 0..5, same palette idea as Telegram's topic icons

function requireForum(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const ctx = service.requireMember(chatId, user.id);
  if (!ctx.chat.is_forum) throw err(400, 'not_a_forum', 'Topics are not enabled in this group');
  return { chatId, ...ctx };
}

function topicView(chatId, t, userId) {
  const id = t ? t.id : 0;
  const last = repo.topicLast(chatId, id);
  const lastRead = repo.topicRead(chatId, id, userId);
  return {
    id,
    chat_id: chatId,
    title: t ? t.title : 'General',
    general: !t,
    icon_color: t ? t.icon_color : -1,
    icon_emoji: t ? t.icon_emoji : null,
    closed: t ? !!t.closed : false,
    pinned_at: t ? t.pinned_at ?? null : null,
    created_by: t ? t.created_by : null,
    created_at: t ? t.created_at : 0,
    last_message: last ? service.formatMessage(last, userId) : null,
    last_read_id: lastRead,
    unread: repo.topicUnread(chatId, id, lastRead, userId),
  };
}

function emitTopic(chatId, topicId) {
  const t = topicId ? repo.topicById(topicId) : null;
  for (const uid of repo.memberIds(chatId)) {
    if (hub.isOnline(uid)) hub.sendToUser(uid, { type: 'topic', chat_id: chatId, topic: topicView(chatId, t, uid) });
  }
}

function list(user, chatIdRaw) {
  const { chatId } = requireForum(user, chatIdRaw);
  const topics = [topicView(chatId, null, user.id), ...repo.topics(chatId).map((t) => topicView(chatId, t, user.id))];
  return { topics };
}

function cleanEmoji(e) {
  if (e == null || e === '') return null;
  if (typeof e !== 'string' || e.length > 16 || !/\p{Extended_Pictographic}/u.test(e)) throw v.bad('icon_emoji must be a single emoji');
  return e;
}

function create(user, chatIdRaw, body) {
  const { chatId, membership } = requireForum(user, chatIdRaw);
  if (membership.role === 'member' && body.admins_only) throw err(403, 'forbidden', 'Only admins can do this');
  const title = v.line(body.title ?? '', 'title', 128);
  const color = Number.isInteger(body.icon_color) && body.icon_color >= 0 && body.icon_color < COLORS ? body.icon_color : Math.floor(Math.random() * COLORS);
  const emoji = cleanEmoji(body.icon_emoji);
  const { id, sid } = repo.tx(() => {
    const id = repo.insertTopic(chatId, title, color, emoji, user.id);
    repo.seedTopicReads(chatId, id, 0);
    const sid = service.insertService(chatId, user.id, { action: 'topic_created', title, icon_color: color, icon_emoji: emoji }, id);
    repo.markTopicRead(chatId, id, user.id, sid);
    return { id, sid };
  });
  service.emitMessage('message', sid);
  emitTopic(chatId, id);
  return { topic: topicView(chatId, repo.topicById(id), user.id) };
}

function loadTopic(user, topicIdRaw) {
  const t = repo.topicById(v.id(topicIdRaw, 'topic_id'));
  if (!t) throw err(404, 'topic_not_found', 'Topic not found');
  const ctx = service.requireMember(t.chat_id, user.id);
  return { t, ...ctx };
}

function update(user, topicIdRaw, body) {
  const { t, membership } = loadTopic(user, topicIdRaw);
  const manager = service.isManager(membership);
  if (!manager && t.created_by !== user.id) throw err(403, 'forbidden', 'Only admins or the topic creator can edit it');
  const next = { ...t };
  const events = [];
  if (body.title !== undefined) { next.title = v.line(body.title, 'title', 128); if (next.title !== t.title) events.push({ action: 'topic_edited', title: next.title }); }
  if (body.icon_emoji !== undefined) next.icon_emoji = cleanEmoji(body.icon_emoji);
  if (body.icon_color !== undefined && Number.isInteger(body.icon_color) && body.icon_color >= 0 && body.icon_color < COLORS) next.icon_color = body.icon_color;
  if (body.closed !== undefined) { next.closed = body.closed ? 1 : 0; if (next.closed !== t.closed) events.push({ action: next.closed ? 'topic_closed' : 'topic_reopened' }); }
  if (body.pinned !== undefined) {
    if (!manager) throw err(403, 'forbidden', 'Only admins can pin topics');
    next.pinned_at = body.pinned ? Date.now() : null;
  }
  const ids = repo.tx(() => {
    repo.updateTopic(t.id, next);
    return events.map((e) => service.insertService(t.chat_id, user.id, e, t.id));
  });
  ids.forEach((id) => service.emitMessage('message', id));
  emitTopic(t.chat_id, t.id);
  return { topic: topicView(t.chat_id, repo.topicById(t.id), user.id) };
}

function remove(user, topicIdRaw) {
  const { t, membership } = loadTopic(user, topicIdRaw);
  if (!service.isManager(membership) && t.created_by !== user.id) throw err(403, 'forbidden', 'Only admins can delete topics');
  repo.tx(() => {
    repo.deleteTopicMessages(t.chat_id, t.id);
    repo.deleteTopic(t.id);
  });
  hub.sendToUsers(repo.memberIds(t.chat_id), { type: 'topic_deleted', chat_id: t.chat_id, topic_id: t.id });
  service.pushChat(t.chat_id);
  return { ok: true };
}

module.exports = { list, create, update, remove, topicView };
