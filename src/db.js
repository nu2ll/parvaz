'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA_VERSION = 2;

function open() {
  if (config.dbPath === ':memory:') return new DatabaseSync(':memory:');
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  let db = new DatabaseSync(config.dbPath);
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasTables && ver < SCHEMA_VERSION) {
    // v1 database: keep it as a backup and start a fresh v2 database.
    db.close();
    const backup = `${config.dbPath}.v1-backup-${Date.now()}`;
    fs.renameSync(config.dbPath, backup);
    for (const ext of ['-wal', '-shm']) if (fs.existsSync(config.dbPath + ext)) fs.renameSync(config.dbPath + ext, backup + ext);
    console.warn(`[db] old v1 database moved to ${backup}`);
    db = new DatabaseSync(config.dbPath);
  }
  return db;
}

const db = open();

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name   TEXT NOT NULL,
  bio            TEXT NOT NULL DEFAULT '',
  avatar_file    TEXT,
  password_hash  TEXT NOT NULL,
  show_last_seen INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT NOT NULL CHECK (type IN ('private', 'group', 'channel')),
  title             TEXT,
  description       TEXT NOT NULL DEFAULT '',
  username          TEXT UNIQUE COLLATE NOCASE,
  avatar_file       TEXT,
  private_key       TEXT UNIQUE,
  invite_token      TEXT UNIQUE,
  pinned_message_id INTEGER,
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  last_read_id INTEGER NOT NULL DEFAULT 0,
  muted        INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  pinned_at    INTEGER,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL DEFAULT 'text',
  text       TEXT NOT NULL DEFAULT '',
  file_id    TEXT REFERENCES files(id),
  reply_to   INTEGER,
  fwd_name   TEXT,
  fwd_chat   TEXT,
  poll       TEXT,
  meta       TEXT,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_kind ON messages(chat_id, kind, id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option     INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

PRAGMA user_version = ${SCHEMA_VERSION};
`);

const USER_COLS = 'id, username, display_name, bio, avatar_file, show_last_seen, created_at, last_seen';

const MSG_SELECT = `
SELECT m.id, m.chat_id, m.sender_id, m.kind, m.text, m.file_id, m.reply_to, m.fwd_name, m.fwd_chat, m.poll, m.meta,
       m.created_at, m.edited_at,
       u.username AS sender_username, u.display_name AS sender_name, u.avatar_file AS sender_avatar,
       c.type AS chat_type,
       f.mime AS f_mime, f.size AS f_size, f.name AS f_name,
       r.id AS reply_id, r.kind AS reply_kind, r.text AS reply_text, r.file_id AS reply_file, rf.mime AS reply_mime,
       ru.display_name AS reply_sender_name
FROM messages m
JOIN users u ON u.id = m.sender_id
JOIN chats c ON c.id = m.chat_id
LEFT JOIN files f ON f.id = m.file_id
LEFT JOIN messages r ON r.id = m.reply_to
LEFT JOIN files rf ON rf.id = r.file_id
LEFT JOIN users ru ON ru.id = r.sender_id`;

const p = (sql) => db.prepare(sql);
const s = {
  insertUser: p('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  userByUsername: p('SELECT * FROM users WHERE username = ?'),
  userById: p(`SELECT ${USER_COLS} FROM users WHERE id = ?`),
  passwordHash: p('SELECT password_hash FROM users WHERE id = ?'),
  setPassword: p('UPDATE users SET password_hash = ? WHERE id = ?'),
  searchUsers: p(`SELECT ${USER_COLS} FROM users
    WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
    ORDER BY (username LIKE ? ESCAPE '\\') DESC, username LIMIT 20`),
  touchUser: p('UPDATE users SET last_seen = ? WHERE id = ?'),

  insertSession: p(`INSERT INTO sessions (token_hash, user_id, device, ip, created_at, last_active, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  sessionUser: p(`SELECT s.id AS session_id, s.last_active, ${USER_COLS.split(', ').map((c) => 'u.' + c).join(', ')}
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
  touchSession: p('UPDATE sessions SET last_active = ?, ip = ? WHERE id = ?'),
  sessionsForUser: p('SELECT id, token_hash, device, ip, created_at, last_active FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_active DESC'),
  deleteSession: p('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: p('DELETE FROM sessions WHERE expires_at <= ?'),

  insertFile: p('INSERT INTO files (id, owner_id, mime, size, name, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  fileById: p('SELECT * FROM files WHERE id = ?'),

  insertChat: p('INSERT INTO chats (type, title, description, username, private_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  chatById: p('SELECT * FROM chats WHERE id = ?'),
  chatByPrivateKey: p('SELECT * FROM chats WHERE private_key = ?'),
  chatByUsername: p('SELECT * FROM chats WHERE username = ?'),
  chatByInvite: p('SELECT * FROM chats WHERE invite_token = ?'),
  searchPublicChats: p(`SELECT * FROM chats WHERE username IS NOT NULL
    AND (username LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') ORDER BY (username LIKE ? ESCAPE '\\') DESC LIMIT 10`),
  deleteChat: p('DELETE FROM chats WHERE id = ?'),
  memberRows: p('SELECT chat_id FROM chat_members WHERE user_id = ?'),

  addMember: p('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at, last_read_id) VALUES (?, ?, ?, ?, ?)'),
  removeMember: p('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  setRole: p('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?'),
  membership: p('SELECT role, last_read_id, muted, archived, pinned_at FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  memberIds: p('SELECT user_id FROM chat_members WHERE chat_id = ?'),
  memberCount: p('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ?'),
  otherMember: p('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ? LIMIT 1'),
  members: p(`SELECT ${USER_COLS.split(', ').map((c) => 'u.' + c).join(', ')}, m.role, m.last_read_id
    FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at, u.id LIMIT 500`),
  oldestMember: p(`SELECT user_id FROM chat_members WHERE chat_id = ?
    ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at, user_id LIMIT 1`),
  contactIds: p(`SELECT DISTINCT m2.user_id AS id FROM chat_members m1
    JOIN chats c ON c.id = m1.chat_id AND c.type != 'channel'
    JOIN chat_members m2 ON m2.chat_id = m1.chat_id WHERE m1.user_id = ? AND m2.user_id != ?`),
  markRead: p('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE chat_id = ? AND user_id = ?'),
  othersReadMax: p('SELECT COALESCE(MAX(last_read_id), 0) AS n FROM chat_members WHERE chat_id = ? AND user_id != ?'),
  setMuted: p('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?'),
  setArchived: p('UPDATE chat_members SET archived = ? WHERE chat_id = ? AND user_id = ?'),
  setPinned: p('UPDATE chat_members SET pinned_at = ? WHERE chat_id = ? AND user_id = ?'),
  pinnedCount: p('SELECT COUNT(*) AS n FROM chat_members WHERE user_id = ? AND pinned_at IS NOT NULL AND archived = 0'),

  updateChat: p('UPDATE chats SET title = ?, description = ?, username = ?, avatar_file = ? WHERE id = ?'),
  setInvite: p('UPDATE chats SET invite_token = ? WHERE id = ?'),
  setPinnedMessage: p('UPDATE chats SET pinned_message_id = ? WHERE id = ?'),
  clearPinnedIf: p('UPDATE chats SET pinned_message_id = NULL WHERE id = ? AND pinned_message_id = ?'),

  insertMessage: p(`INSERT INTO messages (chat_id, sender_id, kind, text, file_id, reply_to, fwd_name, fwd_chat, poll, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  rawMessage: p('SELECT m.*, c.type AS chat_type, c.title AS chat_title FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.id = ?'),
  messageById: p(`${MSG_SELECT} WHERE m.id = ?`),
  messagesBefore: p(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`),
  messagesAfter: p(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`),
  lastMessage: p(`${MSG_SELECT} WHERE m.chat_id = ? ORDER BY m.id DESC LIMIT 1`),
  maxMessageId: p('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE chat_id = ?'),
  unreadCount: p('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id > ? AND sender_id != ?'),
  editMessage: p('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?'),
  deleteMessage: p('DELETE FROM messages WHERE id = ?'),
  searchInChat: p(`${MSG_SELECT} WHERE m.chat_id = ? AND m.kind != 'service' AND m.text LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 50`),
  searchGlobal: p(`${MSG_SELECT} JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
    WHERE m.kind != 'service' AND m.text LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 30`),
  mediaInChat: p(`${MSG_SELECT} WHERE m.chat_id = ? AND m.kind IN (SELECT value FROM json_each(?)) AND m.id < ? ORDER BY m.id DESC LIMIT ?`),
  views: p('SELECT COUNT(*) AS n FROM chat_members WHERE chat_id = ? AND last_read_id >= ?'),

  reactionsFor: p('SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY created_at'),
  reactionOf: p('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?'),
  setReaction: p(`INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`),
  removeReaction: p('DELETE FROM reactions WHERE message_id = ? AND user_id = ?'),

  pollCounts: p('SELECT option, COUNT(*) AS n FROM poll_votes WHERE message_id = ? GROUP BY option'),
  myVote: p('SELECT option FROM poll_votes WHERE message_id = ? AND user_id = ?'),
  setVote: p(`INSERT INTO poll_votes (message_id, user_id, option) VALUES (?, ?, ?)
    ON CONFLICT (message_id, user_id) DO UPDATE SET option = excluded.option`),
  removeVote: p('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?'),
};

const likeEscape = (q) => q.replace(/[\\%_]/g, (c) => '\\' + c);

function updateUser(id, fields) {
  const allowed = ['display_name', 'bio', 'username', 'avatar_file', 'show_last_seen'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}

module.exports = {
  raw: db,
  close: () => db.close(),
  tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  insertUser: (username, displayName, hash, now) => Number(s.insertUser.run(username, displayName, hash, now).lastInsertRowid),
  userByUsername: (u) => s.userByUsername.get(u),
  userById: (id) => s.userById.get(id),
  passwordHash: (id) => s.passwordHash.get(id)?.password_hash,
  setPassword: (id, hash) => s.setPassword.run(hash, id),
  updateUser,
  searchUsers: (selfId, q) => {
    const e = likeEscape(q);
    return s.searchUsers.all(selfId, `%${e}%`, `%${e}%`, `${e}%`);
  },
  touchUser: (id, now = Date.now()) => s.touchUser.run(now, id),

  insertSession: (hash, userId, device, ip, now, exp) => Number(s.insertSession.run(hash, userId, device, ip, now, now, exp).lastInsertRowid),
  sessionUser: (hash, now) => s.sessionUser.get(hash, now),
  touchSession: (id, ip, now = Date.now()) => s.touchSession.run(now, ip, id),
  sessionsForUser: (uid) => s.sessionsForUser.all(uid, Date.now()),
  deleteSession: (hash) => s.deleteSession.run(hash),
  deleteExpiredSessions: (now) => s.deleteExpiredSessions.run(now),

  insertFile: (id, owner, mime, size, name, now) => s.insertFile.run(id, owner, mime, size, name, now),
  fileById: (id) => s.fileById.get(id),

  insertChat: (type, title, description, username, key, by, now) =>
    Number(s.insertChat.run(type, title, description || '', username || null, key, by, now).lastInsertRowid),
  chatById: (id) => s.chatById.get(id),
  chatByPrivateKey: (k) => s.chatByPrivateKey.get(k),
  chatByUsername: (u) => s.chatByUsername.get(u),
  chatByInvite: (t) => s.chatByInvite.get(t),
  searchPublicChats: (q) => {
    const e = likeEscape(q);
    return s.searchPublicChats.all(`%${e}%`, `%${e}%`, `${e}%`);
  },
  deleteChat: (id) => s.deleteChat.run(id),
  chatIdsForUser: (uid) => s.memberRows.all(uid).map((r) => r.chat_id),

  addMember: (chatId, userId, role = 'member', now = Date.now(), lastRead = 0) => s.addMember.run(chatId, userId, role, now, lastRead),
  removeMember: (chatId, userId) => s.removeMember.run(chatId, userId),
  setRole: (chatId, userId, role) => s.setRole.run(role, chatId, userId),
  membership: (chatId, userId) => s.membership.get(chatId, userId),
  memberIds: (chatId) => s.memberIds.all(chatId).map((r) => r.user_id),
  memberCount: (chatId) => s.memberCount.get(chatId).n,
  otherMember: (chatId, userId) => s.otherMember.get(chatId, userId)?.user_id,
  members: (chatId) => s.members.all(chatId),
  oldestMember: (chatId) => s.oldestMember.get(chatId)?.user_id,
  contactIds: (uid) => s.contactIds.all(uid, uid).map((r) => r.id),
  markRead: (chatId, userId, msgId) => s.markRead.run(msgId, chatId, userId),
  othersReadMax: (chatId, userId) => s.othersReadMax.get(chatId, userId).n,
  setMuted: (chatId, userId, v) => s.setMuted.run(v ? 1 : 0, chatId, userId),
  setArchived: (chatId, userId, v) => s.setArchived.run(v ? 1 : 0, chatId, userId),
  setPinned: (chatId, userId, at) => s.setPinned.run(at, chatId, userId),
  pinnedCount: (userId) => s.pinnedCount.get(userId).n,

  updateChat: (id, c) => s.updateChat.run(c.title, c.description || '', c.username || null, c.avatar_file || null, id),
  setInvite: (id, token) => s.setInvite.run(token, id),
  setPinnedMessage: (id, msgId) => s.setPinnedMessage.run(msgId, id),
  clearPinnedIf: (id, msgId) => s.clearPinnedIf.run(id, msgId),

  insertMessage: (m) =>
    Number(
      s.insertMessage.run(m.chat_id, m.sender_id, m.kind || 'text', m.text || '', m.file_id || null, m.reply_to || null,
        m.fwd_name || null, m.fwd_chat || null, m.poll || null, m.meta || null, m.created_at || Date.now()).lastInsertRowid
    ),
  rawMessage: (id) => s.rawMessage.get(id),
  messageById: (id) => s.messageById.get(id),
  messagesBefore: (chatId, before, limit) => s.messagesBefore.all(chatId, before, limit),
  messagesAfter: (chatId, after, limit) => s.messagesAfter.all(chatId, after, limit),
  lastMessage: (chatId) => s.lastMessage.get(chatId),
  maxMessageId: (chatId) => s.maxMessageId.get(chatId).n,
  unreadCount: (chatId, userId, lastRead) => s.unreadCount.get(chatId, lastRead, userId).n,
  editMessage: (id, text, now) => s.editMessage.run(text, now, id),
  deleteMessage: (id) => s.deleteMessage.run(id),
  searchInChat: (chatId, q) => s.searchInChat.all(chatId, `%${likeEscape(q)}%`),
  searchGlobal: (userId, q) => s.searchGlobal.all(userId, `%${likeEscape(q)}%`),
  mediaInChat: (chatId, kinds, before, limit) => s.mediaInChat.all(chatId, JSON.stringify(kinds), before, limit),
  views: (chatId, msgId) => s.views.get(chatId, msgId).n,

  reactionsFor: (msgId) => s.reactionsFor.all(msgId),
  reactionOf: (msgId, userId) => s.reactionOf.get(msgId, userId)?.emoji,
  setReaction: (msgId, userId, emoji) => s.setReaction.run(msgId, userId, emoji, Date.now()),
  removeReaction: (msgId, userId) => s.removeReaction.run(msgId, userId),

  pollCounts: (msgId) => s.pollCounts.all(msgId),
  myVote: (msgId, userId) => s.myVote.get(msgId, userId)?.option,
  setVote: (msgId, userId, option) => s.setVote.run(msgId, userId, option),
  removeVote: (msgId, userId) => s.removeVote.run(msgId, userId),
};
