'use strict';
// Tracks live WebSocket connections per user (a user can have many devices/tabs).
const sockets = new Map(); // userId -> Set<WebSocketConnection>

function add(userId, ws) {
  let set = sockets.get(userId);
  const first = !set;
  if (!set) sockets.set(userId, (set = new Set()));
  set.add(ws);
  return first; // true => user just came online
}

function remove(userId, ws) {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(ws);
  if (set.size) return false;
  sockets.delete(userId);
  return true; // true => user just went offline
}

const isOnline = (userId) => sockets.has(userId);

function sendToUsers(userIds, event) {
  const data = JSON.stringify(event);
  for (const id of userIds) {
    const set = sockets.get(id);
    if (set) for (const ws of set) ws.send(data);
  }
}

const sendToUser = (userId, event) => sendToUsers([userId], event);

function all() {
  const out = [];
  for (const set of sockets.values()) for (const ws of set) out.push(ws);
  return out;
}

function closeSession(tokenHash) {
  for (const ws of all()) if (ws.tokenHash === tokenHash) ws.close(4001);
}

module.exports = { add, remove, isOnline, sendToUser, sendToUsers, all, closeSession };
