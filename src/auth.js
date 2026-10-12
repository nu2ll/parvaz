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

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  repo.insertSession(hashToken(token), userId, now, now + config.sessionTtlMs);
  return token;
}

function userFromToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const user = repo.sessionUser(tokenHash, Date.now());
  return user ? { ...user, token_hash: tokenHash } : null;
}

function authenticate(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const user = m && userFromToken(m[1]);
  if (!user) throw new HttpError(401, 'unauthorized', 'Missing or invalid token');
  return user;
}

const revoke = (tokenHash) => repo.deleteSession(tokenHash);

setInterval(() => repo.deleteExpiredSessions(Date.now()), 60 * 60 * 1000).unref();

module.exports = { hashPassword, verifyPassword, burnTime, createSession, userFromToken, authenticate, revoke };
