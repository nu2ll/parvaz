'use strict';
// Contacts, blocked users, public profiles.
const repo = require('./db');
const hub = require('./hub');
const v = require('./validate');
const service = require('./service');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);

function findUser(body) {
  let u = null;
  if (body.user_id != null) u = repo.userById(v.id(body.user_id, 'user_id'));
  else if (body.username != null) {
    const row = repo.userByUsername(v.lookupName(body.username));
    u = row && repo.userById(row.id);
  }
  if (!u) throw err(404, 'user_not_found', 'User not found');
  return u;
}

// private chat between two users changes title/peer flags when contacts or blocks change
function refreshPrivate(a, b) {
  const [x, y] = [a, b].sort((p, q) => p - q);
  const chat = repo.chatByPrivateKey(`${x}:${y}`);
  if (chat) service.pushChat(chat.id);
}

function listContacts(user) {
  return { contacts: repo.contacts(user.id).map((u) => service.publicUser(u, user.id)) };
}

function addContact(user, body) {
  const target = findUser(body);
  if (target.id === user.id) throw v.bad('You cannot add yourself');
  const name = v.displayName(body.name == null || body.name === '' ? target.display_name : body.name);
  repo.upsertContact(user.id, target.id, name);
  refreshPrivate(user.id, target.id);
  service.broadcastPresence(user.id); // "contacts only" privacy may now include them
  const fresh = repo.userById(target.id);
  hub.sendToUser(target.id, { type: 'user', user: service.publicUser(repo.userById(user.id), target.id) });
  return { user: service.publicUser(fresh, user.id) };
}

function removeContact(user, uidRaw) {
  const uid = v.id(uidRaw, 'user_id');
  repo.deleteContact(user.id, uid);
  refreshPrivate(user.id, uid);
  service.broadcastPresence(user.id);
  hub.sendToUser(uid, { type: 'user', user: service.publicUser(repo.userById(user.id), uid) });
  return { ok: true };
}

function listBlocked(user) {
  return { users: repo.blocked(user.id).map((u) => ({ ...service.publicUser(u, user.id), blocked_at: u.blocked_at })) };
}

function block(user, body) {
  const target = findUser(body);
  if (target.id === user.id) throw v.bad('You cannot block yourself');
  repo.block(user.id, target.id);
  refreshPrivate(user.id, target.id);
  service.broadcastPresence(user.id);
  hub.sendToUser(target.id, { type: 'user', user: service.publicUser(repo.userById(user.id), target.id) });
  return { ok: true };
}

function unblock(user, uidRaw) {
  const uid = v.id(uidRaw, 'user_id');
  repo.unblock(user.id, uid);
  refreshPrivate(user.id, uid);
  service.broadcastPresence(user.id);
  const me = repo.userById(user.id);
  if (me) hub.sendToUser(uid, { type: 'user', user: service.publicUser(me, uid) });
  return { ok: true };
}

function profile(user, uidRaw) {
  const u = repo.userById(v.id(uidRaw, 'user_id'));
  if (!u) throw err(404, 'user_not_found', 'User not found');
  return { user: service.publicUser(u, user.id), common_chats: u.id === user.id ? 0 : repo.commonChats(user.id, u.id) };
}

function checkUsername(user, raw) {
  let name;
  try { name = v.username(String(raw || '')); } catch (e) { return { valid: false, available: false, reason: e.code === 'username_taken' ? 'reserved' : 'invalid' }; }
  const u = repo.userByUsername(name);
  const c = repo.chatByUsername(name);
  return { valid: true, available: (!u || u.id === user.id) && !c };
}

module.exports = { listContacts, addContact, removeContact, listBlocked, block, unblock, profile, checkUsername };
