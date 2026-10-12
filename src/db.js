'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('private', 'group')),
  title       TEXT,
  private_key TEXT UNIQUE,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  last_read_id INTEGER NOT NULL DEFAULT 0,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  reply_to   INTEGER,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
`);

const MSG_SELECT = `
SELECT m.id, m.chat_id, m.sender_id, u.username AS sender_username, u.display_name AS sender_name,
       m.text, m.reply_to, m.created_at, m.edited_at, m.deleted,
       r.id AS reply_id, r.text AS reply_text, r.deleted AS reply_deleted,
       ru.display_name AS reply_sender_name
FROM messages m
JOIN users u ON u.id = m.sender_id
LEFT JOIN messages r ON r.id = m.reply_to
LEFT JOIN users ru ON ru.id = r.sender_id`;

const s = {
  insertUser: db.prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, display_name, last_seen FROM users WHERE id = ?'),
  updateDisplayName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
  searchUsers: db.prepare(`SELECT id, username, display_name, last_seen FROM users
    WHERE id != ? AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
    ORDER BY (username LIKE ? ESCAPE '\\') DESC, username LIMIT 20`),
  touchUser: db.prepare('UPDATE users SET last_seen = ? WHERE id = ?'),

  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.id, u.username, u.display_name, u.last_seen FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  insertChat: db.prepare('INSERT INTO chats (type, title, private_key, created_by, created_at) VALUES (?, ?, ?, ?, ?)'),
  chatById: db.prepare('SELECT * FROM chats WHERE id = ?'),
  chatByPrivateKey: db.prepare('SELECT * FROM chats WHERE private_key = ?'),
  deleteChat: db.prepare('DELETE FROM chats WHERE id = ?'),
  chatIdsForUser: db.prepare('SELECT chat_id FROM chat_members WHERE user_id = ?'),

  addMember: db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'),
  removeMember: db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  setRole: db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?'),
  membership: db.prepare('SELECT role, last_read_id FROM chat_members WHERE chat_id = ? AND user_id = ?'),
  memberIds: db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?'),
  members: db.prepare(`SELECT u.id, u.username, u.display_name, u.last_seen, m.role, m.last_read_id
    FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? ORDER BY m.joined_at, u.id`),
  oldestMember: db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? ORDER BY joined_at, user_id LIMIT 1'),
  contactIds: db.prepare(`SELECT DISTINCT m2.user_id AS id FROM chat_members m1
    JOIN chat_members m2 ON m2.chat_id = m1.chat_id WHERE m1.user_id = ? AND m2.user_id != ?`),
  markRead: db.prepare('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE chat_id = ? AND user_id = ?'),

  insertMessage: db.prepare('INSERT INTO messages (chat_id, sender_id, text, reply_to, created_at) VALUES (?, ?, ?, ?, ?)'),
  rawMessage: db.prepare('SELECT * FROM messages WHERE id = ?'),
  messageById: db.prepare(`${MSG_SELECT} WHERE m.id = ?`),
  messagesBefore: db.prepare(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`),
  lastMessage: db.prepare(`${MSG_SELECT} WHERE m.chat_id = ? ORDER BY m.id DESC LIMIT 1`),
  maxMessageId: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE chat_id = ?'),
  unreadCount: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND id > ? AND sender_id != ? AND deleted = 0'),
  editMessage: db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?'),
  // Soft delete, but the text itself is wiped so it is really gone.
  deleteMessage: db.prepare("UPDATE messages SET text = '', deleted = 1, edited_at = ? WHERE id = ?"),
};

const likeEscape = (q) => q.replace(/[\\%_]/g, (c) => '\\' + c);

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
  updateDisplayName: (id, name) => s.updateDisplayName.run(name, id),
  searchUsers: (selfId, q) => {
    const e = likeEscape(q);
    return s.searchUsers.all(selfId, `%${e}%`, `%${e}%`, `${e}%`);
  },
  touchUser: (id, now = Date.now()) => s.touchUser.run(now, id),

  insertSession: (hash, userId, now, exp) => s.insertSession.run(hash, userId, now, exp),
  sessionUser: (hash, now) => s.sessionUser.get(hash, now),
  deleteSession: (hash) => s.deleteSession.run(hash),
  deleteExpiredSessions: (now) => s.deleteExpiredSessions.run(now),

  insertChat: (type, title, key, by, now) => Number(s.insertChat.run(type, title, key, by, now).lastInsertRowid),
  chatById: (id) => s.chatById.get(id),
  chatByPrivateKey: (k) => s.chatByPrivateKey.get(k),
  deleteChat: (id) => s.deleteChat.run(id),
  chatIdsForUser: (uid) => s.chatIdsForUser.all(uid).map((r) => r.chat_id),

  addMember: (chatId, userId, role = 'member', now = Date.now()) => s.addMember.run(chatId, userId, role, now),
  removeMember: (chatId, userId) => s.removeMember.run(chatId, userId),
  setRole: (chatId, userId, role) => s.setRole.run(role, chatId, userId),
  membership: (chatId, userId) => s.membership.get(chatId, userId),
  memberIds: (chatId) => s.memberIds.all(chatId).map((r) => r.user_id),
  members: (chatId) => s.members.all(chatId),
  oldestMember: (chatId) => s.oldestMember.get(chatId)?.user_id,
  contactIds: (uid) => s.contactIds.all(uid, uid).map((r) => r.id),
  markRead: (chatId, userId, msgId) => s.markRead.run(msgId, chatId, userId),

  insertMessage: (chatId, senderId, text, replyTo, now) =>
    Number(s.insertMessage.run(chatId, senderId, text, replyTo, now).lastInsertRowid),
  rawMessage: (id) => s.rawMessage.get(id),
  messageById: (id) => s.messageById.get(id),
  messagesBefore: (chatId, before, limit) => s.messagesBefore.all(chatId, before, limit),
  lastMessage: (chatId) => s.lastMessage.get(chatId),
  maxMessageId: (chatId) => s.maxMessageId.get(chatId).n,
  unreadCount: (chatId, userId, lastRead) => s.unreadCount.get(chatId, lastRead, userId).n,
  editMessage: (id, text, now) => s.editMessage.run(text, now, id),
  deleteMessage: (id, now) => s.deleteMessage.run(now, id),
};
