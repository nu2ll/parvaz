'use strict';
const { HttpError } = require('./http-util');
const config = require('./config');

const bad = (msg) => new HttpError(400, 'validation', msg);
const CONTROL = /[-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

function username(v) {
  if (typeof v !== 'string' || !USERNAME_RE.test(v.trim())) {
    throw bad('Username must be 4-32 chars (letters, digits, _) and start with a letter');
  }
  return v.trim();
}

function password(v) {
  if (typeof v !== 'string' || v.length < 8 || v.length > 128) {
    throw bad('Password must be 8-128 characters');
  }
  return v;
}

function displayName(v) {
  if (typeof v !== 'string') throw bad('display_name must be a string');
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 64) throw bad('display_name must be 1-64 characters');
  return s;
}

function title(v) {
  if (typeof v !== 'string') throw bad('title must be a string');
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 128) throw bad('title must be 1-128 characters');
  return s;
}

function messageText(v) {
  if (typeof v !== 'string') throw bad('text must be a string');
  const s = v.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (!s) throw bad('Message is empty');
  if (s.length > config.limits.messageLength) {
    throw bad(`Message too long (max ${config.limits.messageLength} chars)`);
  }
  return s;
}

function id(v, name = 'id') {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`${name} must be a positive integer`);
  return n;
}

function lookupName(v, name = 'username') {
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim().replace(/^@/, '');
  if (!s || s.length > 64) throw bad(`${name} is invalid`);
  return s;
}

module.exports = { username, password, displayName, title, messageText, id, lookupName };
