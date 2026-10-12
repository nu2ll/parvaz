'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const repo = require('./db');
const config = require('./config');
const { HttpError } = require('./http-util');

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const key = await scrypt(password, salt, expected.length, PARAMS);
  return crypto.timingSafeEqual(key, expected);
}

// Used when the username does not exist, so login timing doesn't leak which usernames exist.
let dummyHash;
async function burnTime(password) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

// Tokens are random; only their SHA-256 is stored, so a leaked DB can't be used to log in.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function describeDevice(ua) {
  ua = String(ua || '');
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node|undici/i.test(ua) ? 'API' : '';
  return [br, os].filter(Boolean).join(' · ') || 'Unknown device';
}

function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  repo.insertSession(hashToken(token), userId, describeDevice(meta.userAgent), String(meta.ip || '').slice(0, 64), now, now + config.sessionTtlMs);
  return token;
}

function userFromToken(token, ip) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const user = repo.sessionUser(tokenHash, now);
  if (!user) return null;
  if (now - user.last_active > 5 * 60_000) repo.touchSession(user.session_id, String(ip || '').slice(0, 64), now);
  return { ...user, token_hash: tokenHash };
}

function authenticate(req, ip) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const user = m && userFromToken(m[1], ip);
  if (!user) throw new HttpError(401, 'unauthorized', 'Missing or invalid token');
  return user;
}

const revoke = (tokenHash) => repo.deleteSession(tokenHash);

setInterval(() => repo.deleteExpiredSessions(Date.now()), 60 * 60 * 1000).unref();

module.exports = { hashPassword, verifyPassword, burnTime, createSession, userFromToken, authenticate, revoke, hashToken, describeDevice };
