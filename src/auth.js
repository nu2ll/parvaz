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

// Telegram-style session info: { model, app, platform } from the User-Agent.
// The Android app sends "KabootarAndroid/3.8.0 (Xiaomi; Redmi Note 10; Android 13)".
function sessionInfo(uaRaw) {
  const ua = String(uaRaw || '').slice(0, 400);
  const app = /KabootarAndroid\/([\d.]+)(?:\s*\(([^;)]*);\s*([^;)]*);\s*Android\s*([\d.]+)\))?/.exec(ua);
  const androidV = (/Android\s+([\d.]+)/.exec(ua) || [])[1] || '';
  // model from the WebView/Chrome UA: "Android 13; M2101K7AG Build/..." ("K" = hidden by Chrome)
  let uaModel = (/Android\s+[\d.]+;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i.exec(ua) || [])[1] || '';
  const hidden = /^K$/.test(uaModel.trim()); // Chrome's reduced UA: "Android 10; K" (fake version)
  if (hidden || /^(wv|Linux|U|Mobile)$/i.test(uaModel.trim())) uaModel = '';
  uaModel = uaModel.trim();
  if (app) {
    const brand = (app[2] || '').trim(), model = (app[3] || '').trim();
    const full = model ? (brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${cap(brand)} ${model}` : model) : uaModel || 'Android';
    return { model: full, app: `Kabootar Android ${app[1]}`, platform: 'android', os: `Android ${app[4] || androidV}`.trim() };
  }
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? (/iPad/.test(ua) ? 'iPadOS' : 'iOS') : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = [[/Edg\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/Firefox\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+)[\d.]* .*Safari\//, 'Safari']].map(([re, n]) => { const m = re.exec(ua); return m && `${n} ${m[1]}`; }).find(Boolean);
  if (!br && /node|undici|curl|python/i.test(ua)) return { model: 'API', app: 'Kabootar API', platform: 'api', os: '' };
  const osFull = os === 'Android' && androidV && !hidden ? `Android ${androidV}` : os;
  const platform = { Android: 'android', iOS: 'ios', iPadOS: 'ios', Windows: 'windows', macOS: 'mac', Linux: 'linux', ChromeOS: 'linux' }[os] || 'web';
  return { model: [br || 'Browser', uaModel || osFull].filter(Boolean).join(', '), app: 'Kabootar Web', platform, os: osFull };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function describeDevice(ua) {
  const i = sessionInfo(ua);
  return i.app === 'Kabootar Web' ? i.model : `${i.model} · ${i.app}`;
}

function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const ua = String(meta.userAgent || '').slice(0, 400);
  repo.insertSession(hashToken(token), userId, describeDevice(ua), String(meta.ip || '').slice(0, 64), now, now + config.sessionTtlMs, ua);
  return token;
}

function userFromToken(token, ip, uaRaw) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const user = repo.sessionUser(tokenHash, now);
  if (!user) return null;
  if (now - user.last_active > 5 * 60_000) repo.touchSession(user.session_id, String(ip || '').slice(0, 64), now);
  // the same login used from a newer app version / updated browser: keep the device name current
  const ua = uaRaw == null ? null : String(uaRaw).slice(0, 400);
  if (ua && ua !== user.session_ua) repo.setSessionUa(user.session_id, ua, describeDevice(ua));
  delete user.session_ua;
  return { ...user, token_hash: tokenHash };
}

function authenticate(req, ip) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const user = m && userFromToken(m[1], ip, req.headers['user-agent']);
  if (!user) throw new HttpError(401, 'unauthorized', 'Missing or invalid token');
  return user;
}

const revoke = (tokenHash) => repo.deleteSession(tokenHash);

setInterval(() => repo.deleteExpiredSessions(Date.now()), 60 * 60 * 1000).unref();

module.exports = { hashPassword, verifyPassword, burnTime, createSession, userFromToken, authenticate, revoke, hashToken, describeDevice, sessionInfo };
