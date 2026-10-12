'use strict';
const { HttpError } = require('./http-util');
const config = require('./config');

const bad = (msg) => new HttpError(400, 'validation', msg);
const CONTROL = /[-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const PUBLIC_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
const RESERVED = new Set(['admin', 'administrator', 'support', 'kabootar', 'system', 'root', 'join', 'files', 'api']);

function username(v) {
  if (typeof v !== 'string' || !USERNAME_RE.test(v.trim().replace(/^@/, ''))) {
    throw bad('Username must be 4-32 chars (letters, digits, _) and start with a letter');
  }
  const s = v.trim().replace(/^@/, '');
  if (RESERVED.has(s.toLowerCase())) throw new HttpError(409, 'username_taken', 'This username is reserved');
  return s;
}

function publicName(v) {
  if (typeof v !== 'string' || !PUBLIC_RE.test(v.trim().replace(/^@/, ''))) {
    throw bad('Public link must be 5-32 chars (letters, digits, _) and start with a letter');
  }
  const s = v.trim().replace(/^@/, '');
  if (RESERVED.has(s.toLowerCase())) throw new HttpError(409, 'username_taken', 'This username is reserved');
  return s;
}

function password(v) {
  if (typeof v !== 'string' || v.length < 8 || v.length > 128) throw bad('Password must be 8-128 characters');
  return v;
}

function line(v, name, max, allowEmpty = false) {
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if ((!s && !allowEmpty) || s.length > max) throw bad(`${name} must be ${allowEmpty ? 0 : 1}-${max} characters`);
  return s;
}

function multiline(v, name, max, allowEmpty = true) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!s && !allowEmpty) throw bad(`${name} is empty`);
  if (s.length > max) throw bad(`${name} too long (max ${max} chars)`);
  return s;
}

const displayName = (v) => line(v, 'display_name', 64);
const title = (v) => line(v, 'title', 128);
const bio = (v) => multiline(v, 'bio', 170);
const description = (v) => multiline(v, 'description', 255);
const messageText = (v) => multiline(v, 'Message', config.limits.messageLength, false);
const caption = (v) => multiline(v, 'Caption', config.limits.messageLength, true);

function id(v, name = 'id') {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`${name} must be a positive integer`);
  return n;
}

function ids(v, name = 'ids', max = 100) {
  if (!Array.isArray(v) || !v.length) throw bad(`${name} must be a non-empty array`);
  if (v.length > max) throw bad(`Too many ${name} (max ${max})`);
  return [...new Set(v.map((x) => id(x, name)))];
}

function lookupName(v, name = 'username') {
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim().replace(/^@/, '');
  if (!s || s.length > 64) throw bad(`${name} is invalid`);
  return s;
}

function fileId(v) {
  if (typeof v !== 'string' || !/^[a-f0-9]{32}$/.test(v)) throw bad('file_id is invalid');
  return v;
}

function poll(v) {
  if (!v || typeof v !== 'object') throw bad('poll must be an object');
  const question = line(v.question ?? '', 'Poll question', 255);
  if (!Array.isArray(v.options)) throw bad('poll.options must be an array');
  const options = v.options.map((o) => line(o ?? '', 'Poll option', 100));
  if (options.length < 2 || options.length > 10) throw bad('A poll needs 2-10 options');
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw bad('Poll options must be unique');
  return { question, options };
}

module.exports = {
  username, publicName, password, displayName, title, bio, description, messageText, caption,
  id, ids, lookupName, fileId, poll, bad, line, multiline,
};
