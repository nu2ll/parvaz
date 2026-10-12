'use strict';
// The official @kabootar channel (verified), the "کبوتر" service account that sends welcome and
// new-login notices (like Telegram's 777000), and blue-tick management for admins.
const repo = require('./db');
const hub = require('./hub');
const v = require('./validate');
const config = require('./config');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const svc = () => require('./service');
const SYSTEM_NAMES = ['kabootar_service', 'kabootar_official', 'kb_service_' + Math.floor(Date.now() / 1000)];

const WELCOME_POST = `🕊 به کانال رسمی **کبوتر** خوش آمدید!

اخبار، به‌روزرسانی‌ها و ترفندهای کبوتر را اینجا دنبال کنید.

✨ امکانات تازه:
• ظاهر کامل به سبک تلگرام وب، حالت شب و رنگ‌های دلخواه
• استیکر، GIF، آلبوم عکس و پیام ویدیویی دایره‌ای
• استوری، تماس صوتی و تصویری
• تاپیک در گروه‌ها، پوشه‌های گفتگو
• تأیید دومرحله‌ای و کد قفل`;

let systemId = null;
let officialId = null;

function systemUser() {
  if (systemId) return repo.userById(systemId);
  let u = repo.systemUser();
  if (!u) {
    const name = SYSTEM_NAMES.find((n) => !repo.userByUsername(n) && !repo.chatByUsername(n));
    // '!' is never a valid scrypt hash, so nobody can log in as the service account
    const id = repo.insertUser(name, 'کبوتر', '!disabled', Date.now());
    repo.markSystem(id);
    repo.updateUser(id, { bio: 'اعلان‌های رسمی کبوتر' });
    u = repo.userById(id);
  }
  systemId = u.id;
  return u;
}

function officialChat() {
  if (officialId) { const c = repo.chatById(officialId); if (c) return c; }
  let c = repo.officialChat() || repo.chatByUsername('kabootar');
  const sys = systemUser();
  if (!c) {
    const id = repo.tx(() => {
      const now = Date.now();
      const id = repo.insertChat('channel', 'کبوتر', 'کانال رسمی پیام‌رسان کبوتر 🕊', 'kabootar', null, sys.id, now);
      repo.addMember(id, sys.id, 'owner', now);
      repo.markOfficial(id);
      repo.insertMessage({ chat_id: id, sender_id: sys.id, kind: 'service', text: JSON.stringify({ action: 'created', title: 'کبوتر' }) });
      const mid = repo.insertMessage({ chat_id: id, sender_id: sys.id, kind: 'text', text: WELCOME_POST });
      repo.markRead(id, sys.id, mid);
      return id;
    });
    c = repo.chatById(id);
  } else if (!c.is_official) repo.markOfficial(c.id);
  officialId = c.id;
  return repo.chatById(c.id);
}

const isAdminName = (name) => config.adminUsernames.includes(String(name || '').toLowerCase());
const isAdmin = (user) => !!user && isAdminName(user.username);

// subscribe once (people may leave later and stay out), promote configured admins
function joinOfficial(userId) {
  if (!config.officialChannel) return;
  const c = officialChat();
  const u = repo.userById(userId);
  if (!u || u.is_system) return;
  const m = repo.membership(c.id, userId);
  if (!m && !repo.raw.prepare('SELECT official_joined FROM users WHERE id = ?').get(userId)?.official_joined) {
    repo.addMember(c.id, userId, 'member', Date.now(), repo.maxMessageId(c.id) - 1);
  }
  repo.markJoinedOfficial(userId);
  if (isAdminName(u.username)) {
    if (!repo.membership(c.id, userId)) repo.addMember(c.id, userId, 'admin', Date.now(), repo.maxMessageId(c.id));
    else if (repo.membership(c.id, userId).role === 'member') repo.setRole(c.id, userId, 'admin');
  }
}

// a message from the service account in your private chat with it
function notify(userId, text) {
  const sys = systemUser();
  const chat = svc().openPrivate({ id: sys.id }, repo.userById(userId).username);
  const id = repo.tx(() => {
    const id = repo.insertMessage({ chat_id: chat.id, sender_id: sys.id, kind: 'text', text });
    repo.markRead(chat.id, sys.id, id);
    return id;
  });
  svc().emitMessage('message', id);
  return id;
}

function setup() {
  systemUser();
  if (!config.officialChannel) return;
  officialChat();
  for (const id of repo.notJoinedOfficial()) joinOfficial(id);
  // admins listed in ADMIN_USERNAMES are promoted on every boot (in case the variable changed)
  for (const name of config.adminUsernames) {
    const u = repo.userByUsername(name);
    if (u) { repo.raw.prepare('UPDATE users SET official_joined = 0 WHERE id = ?').run(u.id); joinOfficial(u.id); }
  }
}

function onRegister(userId) {
  if (!config.officialChannel) return;
  joinOfficial(userId);
  const u = repo.userById(userId);
  notify(userId, `سلام ${u.display_name}! 👋\nبه **کبوتر** خوش آمدید.\n\nاین گفتگو برای اعلان‌های رسمی است؛ مثل ورود از دستگاه جدید. اخبار کبوتر را هم در کانال رسمی @kabootar دنبال کنید.`);
}

function onLogin(userId, meta = {}) {
  if (!config.officialChannel) return;
  joinOfficial(userId);
  const auth = require('./auth');
  const device = auth.describeDevice ? auth.describeDevice(meta.userAgent) : '';
  let when = '';
  try { when = new Date().toLocaleString('fa-IR', { timeZone: process.env.TZ || 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }); } catch { when = new Date().toISOString(); }
  notify(userId, `🔐 **ورود جدید به حساب شما**\n\n📱 دستگاه: ${device || 'ناشناخته'}\n🌐 IP: ${meta.ip || 'نامشخص'}\n🕒 زمان: ${when}\n\nاگر این شما نبودید، از «تنظیمات ← دستگاه‌ها» آن نشست را ببندید و رمزتان را عوض کنید.`);
}

// ---- admin: blue ticks ----
function requireAdmin(user) {
  if (!isAdmin(user)) throw err(403, 'forbidden', 'Only Kabootar admins can do this');
}
function verify(user, body) {
  requireAdmin(user);
  const on = !!body.verified;
  if (body.chat_id != null) {
    const c = repo.chatById(v.id(body.chat_id, 'chat_id'));
    if (!c || c.type === 'private') throw err(404, 'not_found', 'Chat not found');
    repo.setChatVerified(c.id, on);
    svc().pushChat(c.id);
    return { ok: true, chat_id: c.id, verified: on };
  }
  const target = body.user_id != null ? repo.userById(v.id(body.user_id, 'user_id')) : repo.userByUsername(v.lookupName(body.username || ''));
  if (!target) throw err(404, 'user_not_found', 'User not found');
  repo.setUserVerified(target.id, on);
  const fresh = repo.userById(target.id);
  hub.sendToUser(target.id, { type: 'me', user: svc().selfUser(fresh) });
  for (const id of repo.contactIds(target.id)) hub.sendToUser(id, { type: 'user', user: svc().publicUser(fresh, id) });
  for (const chatId of repo.chatIdsForUser(target.id)) if (repo.chatById(chatId)?.type === 'private') svc().pushChat(chatId);
  return { ok: true, user_id: target.id, verified: on };
}

module.exports = { setup, onRegister, onLogin, notify, verify, isAdmin, systemUser, officialChat };
