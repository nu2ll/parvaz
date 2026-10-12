'use strict';
// All chat business logic. Used by both the REST API and the WebSocket gateway.
const repo = require('./db');
const hub = require('./hub');
const auth = require('./auth');
const v = require('./validate');
const config = require('./config');
const { HttpError } = require('./http-util');

const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const MANAGERS = new Set(['owner', 'admin']);
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    last_seen: u.last_seen ?? null,
    online: hub.isOnline(u.id),
  };
}

function formatMessage(r) {
  return {
    id: r.id,
    chat_id: r.chat_id,
    sender: { id: r.sender_id, username: r.sender_username, display_name: r.sender_name },
    text: r.deleted ? '' : r.text,
    reply_to: r.reply_to ?? null,
    reply: r.reply_to && r.reply_id
      ? {
          id: r.reply_id,
          sender_name: r.reply_sender_name,
          text: r.reply_deleted ? '' : truncate(r.reply_text, 120),
          deleted: !!r.reply_deleted,
        }
      : null,
    created_at: r.created_at,
    edited_at: r.edited_at ?? null,
    deleted: !!r.deleted,
  };
}

// Non-members get 404 (not 403) so chat ids can't be probed.
function requireMember(chatId, userId) {
  const chat = repo.chatById(chatId);
  const membership = chat && repo.membership(chatId, userId);
  if (!chat || !membership) throw new HttpError(404, 'not_found', 'Chat not found');
  return { chat, membership };
}

function buildChat(chat, userId) {
  const members = repo.members(chat.id);
  const me = members.find((m) => m.id === userId);
  if (!me) return null;
  const others = members.filter((m) => m.id !== userId);
  let title = chat.title;
  let peer = null;
  if (chat.type === 'private') {
    const p = others[0] || me; // chat with yourself = "Saved Messages"
    peer = publicUser(p);
    title = p.display_name;
  }
  const last = repo.lastMessage(chat.id);
  return {
    id: chat.id,
    type: chat.type,
    title,
    peer,
    member_count: members.length,
    role: me.role,
    last_message: last ? formatMessage(last) : null,
    unread: repo.unreadCount(chat.id, userId, me.last_read_id),
    last_read_id: me.last_read_id,
    others_read_id: others.reduce((mx, m) => Math.max(mx, m.last_read_id), 0),
    created_at: chat.created_at,
  };
}

function emitToChat(chatId, event, exceptUserId) {
  hub.sendToUsers(repo.memberIds(chatId).filter((id) => id !== exceptUserId), event);
}

function pushChatToMembers(chatId) {
  const chat = repo.chatById(chatId);
  if (!chat) return;
  for (const uid of repo.memberIds(chatId)) {
    if (!hub.isOnline(uid)) continue;
    const view = buildChat(chat, uid);
    if (view) hub.sendToUser(uid, { type: 'chat', chat: view });
  }
}

function broadcastPresence(userId, online) {
  const u = repo.userById(userId);
  if (!u) return;
  hub.sendToUsers(repo.contactIds(userId), { type: 'presence', user_id: userId, online, last_seen: u.last_seen });
}

// ---------- accounts ----------

async function register(body) {
  const username = v.username(body.username);
  const displayName = v.displayName(body.display_name ?? username);
  const password = v.password(body.password);
  if (repo.userByUsername(username)) throw new HttpError(409, 'username_taken', 'Username is already taken');
  const hash = await auth.hashPassword(password);
  let id;
  try {
    id = repo.insertUser(username, displayName, hash, Date.now());
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'username_taken', 'Username is already taken');
    throw err;
  }
  const user = repo.userById(id);
  return { token: auth.createSession(id), user: publicUser(user) };
}

async function login(body) {
  const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const row = username && username.length <= 64 ? repo.userByUsername(username) : null;
  if (!row) {
    await auth.burnTime(password);
    throw new HttpError(401, 'invalid_credentials', 'Wrong username or password');
  }
  if (!(await auth.verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, 'invalid_credentials', 'Wrong username or password');
  }
  return { token: auth.createSession(row.id), user: publicUser(row) };
}

function updateProfile(user, body) {
  const name = v.displayName(body.display_name);
  repo.updateDisplayName(user.id, name);
  const fresh = repo.userById(user.id);
  hub.sendToUsers([user.id, ...repo.contactIds(user.id)], { type: 'user', user: publicUser(fresh) });
  return publicUser(fresh);
}

function searchUsers(user, q) {
  const query = typeof q === 'string' ? q.trim().replace(/^@/, '') : '';
  if (!query) return [];
  if (query.length > 64) throw new HttpError(400, 'validation', 'Query too long');
  return repo.searchUsers(user.id, query).map(publicUser);
}

// ---------- chats ----------

function listChats(userId) {
  return repo
    .chatIdsForUser(userId)
    .map((id) => repo.chatById(id))
    .map((chat) => buildChat(chat, userId))
    // hide empty private chats that someone else opened with you
    .filter((c) => c && !(c.type === 'private' && !c.last_message && repo.chatById(c.id).created_by !== userId))
    .sort((a, b) => (b.last_message?.created_at ?? b.created_at) - (a.last_message?.created_at ?? a.created_at));
}

function chatDetails(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat } = requireMember(chatId, user.id);
  return {
    chat: buildChat(chat, user.id),
    members: repo.members(chatId).map((m) => ({ ...publicUser(m), role: m.role })),
  };
}

function openPrivate(user, usernameRaw) {
  const peer = repo.userByUsername(v.lookupName(usernameRaw));
  if (!peer) throw new HttpError(404, 'user_not_found', 'User not found');
  const [a, b] = [user.id, peer.id].sort((x, y) => x - y);
  const key = `${a}:${b}`;
  let chat = repo.chatByPrivateKey(key);
  if (!chat) {
    const id = repo.tx(() => {
      const id = repo.insertChat('private', null, key, user.id, Date.now());
      repo.addMember(id, user.id, 'member');
      if (peer.id !== user.id) repo.addMember(id, peer.id, 'member');
      return id;
    });
    chat = repo.chatById(id);
  }
  return buildChat(chat, user.id);
}

function resolveUsers(usernames, selfId) {
  if (usernames == null) return [];
  if (!Array.isArray(usernames)) throw new HttpError(400, 'validation', 'usernames must be an array');
  if (usernames.length > 200) throw new HttpError(400, 'validation', 'Too many members at once (max 200)');
  const seen = new Set();
  const users = [];
  for (const raw of usernames) {
    const name = v.lookupName(raw).toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const u = repo.userByUsername(name);
    if (!u) throw new HttpError(404, 'user_not_found', `User @${name} not found`);
    if (u.id !== selfId) users.push(u);
  }
  return users;
}

function createGroup(user, titleRaw, usernames) {
  const title = v.title(titleRaw);
  const users = resolveUsers(usernames, user.id);
  const chatId = repo.tx(() => {
    const now = Date.now();
    const id = repo.insertChat('group', title, null, user.id, now);
    repo.addMember(id, user.id, 'owner', now);
    for (const u of users) repo.addMember(id, u.id, 'member', now);
    return id;
  });
  pushChatToMembers(chatId);
  return buildChat(repo.chatById(chatId), user.id);
}

function addMember(user, chatIdRaw, usernameRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (chat.type !== 'group') throw new HttpError(400, 'not_a_group', 'Members can only be added to groups');
  if (!MANAGERS.has(membership.role)) throw new HttpError(403, 'forbidden', 'Only group admins can add members');
  const target = repo.userByUsername(v.lookupName(usernameRaw));
  if (!target) throw new HttpError(404, 'user_not_found', 'User not found');
  if (repo.membership(chatId, target.id)) throw new HttpError(409, 'already_member', 'User is already in this group');
  if (repo.memberIds(chatId).length >= config.limits.groupMembers) {
    throw new HttpError(400, 'group_full', `Groups are limited to ${config.limits.groupMembers} members`);
  }
  repo.addMember(chatId, target.id, 'member');
  pushChatToMembers(chatId);
  return buildChat(chat, user.id);
}

function leaveChat(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (chat.type !== 'group') throw new HttpError(400, 'cannot_leave_private', 'You cannot leave a private chat');
  repo.tx(() => {
    repo.removeMember(chatId, user.id);
    const next = repo.oldestMember(chatId);
    if (!next) repo.deleteChat(chatId);
    else if (membership.role === 'owner') repo.setRole(chatId, next, 'owner');
  });
  hub.sendToUser(user.id, { type: 'chat_removed', chat_id: chatId });
  pushChatToMembers(chatId);
  return { ok: true };
}

// ---------- messages ----------

function history(user, chatIdRaw, beforeRaw, limitRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  requireMember(chatId, user.id);
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 100);
  const before = beforeRaw ? v.id(beforeRaw, 'before') : Number.MAX_SAFE_INTEGER;
  const rows = repo.messagesBefore(chatId, before, limit + 1);
  return {
    messages: rows.slice(0, limit).reverse().map(formatMessage),
    has_more: rows.length > limit,
  };
}

function sendMessage(user, chatIdRaw, textRaw, replyToRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const text = v.messageText(textRaw);
  requireMember(chatId, user.id);
  let replyTo = null;
  if (replyToRaw != null) {
    replyTo = v.id(replyToRaw, 'reply_to');
    const target = repo.rawMessage(replyTo);
    if (!target || target.chat_id !== chatId) {
      throw new HttpError(400, 'validation', 'reply_to must point to a message in the same chat');
    }
  }
  const id = repo.tx(() => {
    const id = repo.insertMessage(chatId, user.id, text, replyTo, Date.now());
    repo.markRead(chatId, user.id, id); // your own messages count as read
    return id;
  });
  const message = formatMessage(repo.messageById(id));
  emitToChat(chatId, { type: 'message', message });
  return message;
}

function loadOwnedMessage(user, messageIdRaw) {
  const id = v.id(messageIdRaw, 'message_id');
  const msg = repo.rawMessage(id);
  const membership = msg && repo.membership(msg.chat_id, user.id);
  if (!msg || !membership) throw new HttpError(404, 'not_found', 'Message not found');
  return { id, msg, membership };
}

function editMessage(user, messageIdRaw, textRaw) {
  const { id, msg } = loadOwnedMessage(user, messageIdRaw);
  const text = v.messageText(textRaw);
  if (msg.sender_id !== user.id) throw new HttpError(403, 'forbidden', 'You can only edit your own messages');
  if (msg.deleted) throw new HttpError(400, 'message_deleted', 'Message was deleted');
  if (Date.now() - msg.created_at > EDIT_WINDOW_MS) throw new HttpError(403, 'edit_window_expired', 'Messages can only be edited for 48 hours');
  repo.editMessage(id, text, Date.now());
  const message = formatMessage(repo.messageById(id));
  emitToChat(msg.chat_id, { type: 'message_updated', message });
  return message;
}

function deleteMessage(user, messageIdRaw) {
  const { id, msg, membership } = loadOwnedMessage(user, messageIdRaw);
  const chat = repo.chatById(msg.chat_id);
  const canModerate = chat.type === 'group' && MANAGERS.has(membership.role);
  if (msg.sender_id !== user.id && !canModerate) throw new HttpError(403, 'forbidden', 'You cannot delete this message');
  if (!msg.deleted) repo.deleteMessage(id, Date.now());
  const message = formatMessage(repo.messageById(id));
  emitToChat(msg.chat_id, { type: 'message_updated', message });
  return message;
}

function markRead(user, chatIdRaw, messageIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const messageId = v.id(messageIdRaw, 'message_id');
  const { membership } = requireMember(chatId, user.id);
  const target = Math.min(messageId, repo.maxMessageId(chatId));
  if (target > membership.last_read_id) {
    repo.markRead(chatId, user.id, target);
    emitToChat(chatId, { type: 'read', chat_id: chatId, user_id: user.id, message_id: target });
  }
  return { last_read_id: Math.max(target, membership.last_read_id) };
}

function typing(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  requireMember(chatId, user.id);
  emitToChat(chatId, { type: 'typing', chat_id: chatId, user: { id: user.id, display_name: user.display_name } }, user.id);
}

module.exports = {
  publicUser, formatMessage, broadcastPresence,
  register, login, updateProfile, searchUsers,
  listChats, chatDetails, openPrivate, createGroup, addMember, leaveChat,
  history, sendMessage, editMessage, deleteMessage, markRead, typing,
};
