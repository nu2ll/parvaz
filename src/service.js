'use strict';
// All chat business logic, shared by the REST API and the WebSocket gateway.
const crypto = require('node:crypto');
const repo = require('./db');
const hub = require('./hub');
const auth = require('./auth');
const v = require('./validate');
const config = require('./config');
const { fileUrl, isImage, isVideo, isAudio } = require('./files');
const { HttpError } = require('./http-util');

const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
const MANAGERS = new Set(['owner', 'admin']);
const REACTIONS = ['👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '😢', '🎉', '🤩', '🙏', '👌', '💯', '😂', '🕊'];
const MAX_PINNED_CHATS = 5;
const err = (status, code, message) => new HttpError(status, code, message);
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
const isManager = (m) => !!m && MANAGERS.has(m.role);

// ---------- privacy ----------

const PRIVACY_KEYS = ['last_seen', 'photo', 'bio', 'forwards', 'calls', 'groups'];
const PRIVACY_VALUES = new Set(['everybody', 'contacts', 'nobody']);
function privacyOf(u) {
  let raw = u.privacy;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  raw = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of PRIVACY_KEYS) out[k] = PRIVACY_VALUES.has(raw[k]) ? raw[k] : 'everybody';
  if (u.show_last_seen === 0 && !PRIVACY_VALUES.has(raw.last_seen)) out.last_seen = 'nobody';
  return out;
}
// Does user `u` allow `viewerId` to see/do `key`? (blocked users get nothing)
function allows(u, key, viewerId) {
  if (!viewerId || viewerId === u.id) return true;
  if (repo.isBlocked(u.id, viewerId)) return false;
  const rule = privacyOf(u)[key];
  if (rule === 'everybody') return true;
  if (rule === 'contacts') return repo.isContact(u.id, viewerId) != null;
  return false;
}
function storyVisible(s, viewerId) {
  if (s.user_id === viewerId) return true;
  if (repo.isBlocked(s.user_id, viewerId)) return false;
  if (s.privacy === 'contacts') return repo.isContact(s.user_id, viewerId) != null;
  return true;
}
function storiesSummary(u, viewerId) {
  const list = repo.activeStories(u.id).filter((s) => storyVisible(s, viewerId));
  if (!list.length) return null;
  const unseen = viewerId === u.id ? 0 : list.filter((s) => !repo.storyViewed(s.id, viewerId)).length;
  return { count: list.length, unseen, last_at: list.at(-1).created_at };
}

// ---------- views ----------

function publicUser(u, viewerId) {
  if (!u) return null;
  const self = viewerId === u.id;
  const seen = allows(u, 'last_seen', viewerId);
  const contactName = !self && viewerId ? repo.isContact(viewerId, u.id) : null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    bio: allows(u, 'bio', viewerId) ? u.bio || '' : '',
    avatar: allows(u, 'photo', viewerId) ? fileUrl(u.avatar_file) || (u.is_system ? '/icon.svg' : null) : null,
    verified: !!u.verified,
    system: !!u.is_system,
    online: seen ? hub.isOnline(u.id) : false,
    last_seen: seen ? u.last_seen ?? null : null,
    last_seen_hidden: !seen,
    is_contact: contactName != null,
    contact_name: contactName,
    blocked: !self && viewerId ? repo.isBlocked(viewerId, u.id) : false,
    stories: storiesSummary(u, viewerId),
  };
}

function selfUser(u) {
  const privacy = privacyOf(u);
  return { ...publicUser(u, u.id), show_last_seen: privacy.last_seen !== 'nobody', privacy, twofa: !!repo.twofa(u.id)?.twofa_hash,
    is_admin: config.adminUsernames.includes(String(u.username).toLowerCase()) };
}

function reactionsView(messageId, viewerId) {
  const map = new Map();
  for (const r of repo.reactionsFor(messageId)) {
    let e = map.get(r.emoji);
    if (!e) map.set(r.emoji, (e = { emoji: r.emoji, count: 0, mine: false, user_ids: [] }));
    e.count++;
    if (r.user_id === viewerId) e.mine = true;
    if (e.user_ids.length < 3) e.user_ids.push(r.user_id);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function pollView(row, viewerId) {
  let poll;
  try { poll = JSON.parse(row.poll); } catch { return null; }
  const counts = new Map(repo.pollCounts(row.id).map((c) => [c.option, c.n]));
  const options = poll.options.map((text, i) => ({ text, votes: counts.get(i) || 0 }));
  const myVote = repo.myVote(row.id, viewerId);
  return { question: poll.question, options, total: options.reduce((s, o) => s + o.votes, 0), my_vote: myVote ?? null };
}

function formatMessage(r, viewerId) {
  if (!r) return null;
  const out = {
    id: r.id,
    chat_id: r.chat_id,
    kind: r.kind,
    sender: { id: r.sender_id, username: r.sender_username, display_name: r.sender_name, avatar: fileUrl(r.sender_avatar) },
    text: r.text,
    media: r.file_id ? { id: r.file_id, url: fileUrl(r.file_id), mime: r.f_mime, size: r.f_size, name: r.f_name, ...parseMeta(r.meta) } : null,
    reply_to: r.reply_to ?? null,
    reply: null,
    topic_id: r.topic_id ?? null,
    grouped_id: r.grouped_id || null,
    forward: r.fwd_name ? { from_name: r.fwd_name, from_chat: r.fwd_chat || null, from_user_id: r.fwd_user_id || null } : null,
    reactions: reactionsView(r.id, viewerId),
    created_at: r.created_at,
    edited_at: r.edited_at ?? null,
  };
  if (r.reply_to) {
    out.reply = r.reply_id
      ? {
          id: r.reply_id,
          kind: r.reply_kind,
          sender_name: r.reply_sender_name,
          text: r.reply_kind === 'service' ? '' : truncate(r.reply_kind === 'poll' ? safePollQuestion(r.reply_text) : r.reply_text, 140),
          thumb: r.reply_file && isImage(r.reply_mime) ? fileUrl(r.reply_file) : null,
          deleted: false,
        }
      : { id: r.reply_to, deleted: true };
  }
  if (r.kind === 'service') {
    try { out.service = JSON.parse(r.text); } catch { out.service = { action: 'unknown' }; }
    out.text = '';
  }
  if (r.kind === 'poll') out.poll = pollView(r, viewerId);
  if (r.kind === 'sticker') {
    const m = parseMeta(r.meta);
    out.sticker = { id: m.sticker_id, pack_id: m.pack_id, emoji: m.emoji || '', url: m.url || fileUrl(r.file_id) };
    out.media = null;
  }
  if (r.kind === 'call') { out.call = parseMeta(r.meta); out.media = null; }
  if (r.kind !== 'text' && r.meta && parseMeta(r.meta).silent) out.silent = true;
  if (r.kind === 'text' && r.meta) {
    const m = parseMeta(r.meta);
    if (m.silent) out.silent = true;
    if (m.preview && m.preview.url) out.preview = { ...m.preview, image: m.preview.image_file ? fileUrl(m.preview.image_file) : null, image_file: undefined };
    if (m.story_id) {
      const st = repo.storyById(m.story_id);
      out.story = st
        ? { id: st.id, user_id: st.user_id, kind: st.kind, url: fileUrl(st.file_id), expired: st.expires_at < Date.now() }
        : { id: m.story_id, deleted: true };
    }
  }
  if (r.chat_type === 'channel') out.views = repo.views(r.chat_id, r.id);
  return out;
}
const safePollQuestion = (t) => t;

function parseMeta(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// width/height let clients reserve space before an image loads; duration fixes webm voice notes
function cleanMeta(m, extra = {}) {
  const out = { ...extra };
  if (m && typeof m === 'object') {
    for (const [k, max] of [['width', 20000], ['height', 20000], ['duration', 86400]]) {
      const n = Number(m[k]);
      if (Number.isFinite(n) && n > 0 && n <= max) out[k] = Math.round(n * 10) / 10;
    }
    if (Array.isArray(m.waveform)) out.waveform = m.waveform.slice(0, 64).map((x) => Math.max(0, Math.min(31, Math.round(Number(x) || 0))));
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

function requireMember(chatId, userId) {
  const chat = repo.chatById(chatId);
  const membership = chat && repo.membership(chatId, userId);
  if (!chat || !membership) throw err(404, 'not_found', 'Chat not found');
  return { chat, membership };
}

function canPost(chat, membership) {
  return chat.type !== 'channel' || isManager(membership);
}

function previewChat(chat) {
  return {
    id: chat.id,
    type: chat.type,
    title: chat.title,
    username: chat.username,
    description: chat.description,
    avatar: fileUrl(chat.avatar_file) || (chat.is_official ? '/icon.svg' : null),
    verified: !!chat.verified,
    member_count: repo.memberCount(chat.id),
  };
}

function buildChat(chat, userId) {
  const me = repo.membership(chat.id, userId);
  if (!me) return null;
  let title = chat.title;
  let avatar = fileUrl(chat.avatar_file) || (chat.is_official ? '/icon.svg' : null);
  let peer = null;
  if (chat.type === 'private') {
    const p = repo.userById(repo.otherMember(chat.id, userId) ?? userId); // chat with yourself = Saved Messages
    peer = publicUser(p, userId);
    title = peer.contact_name || p.display_name;
    avatar = peer.avatar;
  }
  const forum = chat.type === 'group' && !!chat.is_forum;
  const last = repo.lastMessage(chat.id);
  const pinned = chat.pinned_message_id ? repo.messageById(chat.pinned_message_id) : null;
  const manager = isManager(me);
  return {
    id: chat.id,
    type: chat.type,
    title,
    username: chat.type === 'private' ? peer.username : chat.username,
    description: chat.type === 'private' ? peer.bio : chat.description,
    avatar,
    peer,
    member_count: repo.memberCount(chat.id),
    role: me.role,
    can_post: canPost(chat, me) && !(peer && peer.system),
    verified: chat.type === 'private' ? !!peer.verified : !!chat.verified,
    official: !!chat.is_official || !!(peer && peer.system),
    can_manage: chat.type !== 'private' && manager,
    muted: !!me.muted,
    archived: !!me.archived,
    pinned_at: me.pinned_at ?? null,
    pinned_message: pinned ? formatMessage(pinned, userId) : null,
    invite_token: manager ? chat.invite_token : null,
    is_forum: forum,
    last_message: last ? formatMessage(last, userId) : null,
    unread: forum ? forumUnread(chat.id, userId) : repo.unreadCount(chat.id, userId, me.last_read_id),
    last_read_id: me.last_read_id,
    others_read_id: chat.type === 'channel' ? 0 : repo.othersReadMax(chat.id, userId),
    created_at: chat.created_at,
  };
}

function forumUnread(chatId, userId) {
  let n = 0;
  for (const tid of [0, ...repo.topics(chatId).map((t) => t.id)]) n += repo.topicUnread(chatId, tid, repo.topicRead(chatId, tid, userId), userId);
  return n;
}

// ---------- realtime fan-out ----------

function emitMessage(type, messageId) {
  const row = repo.messageById(messageId);
  if (!row) return;
  for (const uid of repo.memberIds(row.chat_id)) {
    if (hub.isOnline(uid)) hub.sendToUser(uid, { type, message: formatMessage(row, uid) });
  }
}

function emitToChat(chatId, event, exceptUserId) {
  hub.sendToUsers(repo.memberIds(chatId).filter((id) => id !== exceptUserId), event);
}

function pushChat(chatId, onlyUserIds) {
  const chat = repo.chatById(chatId);
  if (!chat) return;
  for (const uid of onlyUserIds || repo.memberIds(chatId)) {
    if (!hub.isOnline(uid)) continue;
    const view = buildChat(chat, uid);
    if (view) hub.sendToUser(uid, { type: 'chat', chat: view });
  }
}

function broadcastPresence(userId) {
  const u = repo.userById(userId);
  if (!u) return;
  for (const id of repo.contactIds(userId)) {
    const pu = publicUser(u, id);
    hub.sendToUser(id, { type: 'presence', user_id: userId, online: pu.online, last_seen: pu.last_seen, last_seen_hidden: pu.last_seen_hidden });
  }
}

function insertService(chatId, actorId, payload, topicId) {
  const chat = repo.chatById(chatId);
  const topic_id = chat && chat.is_forum ? topicId ?? 0 : null;
  return repo.insertMessage({ chat_id: chatId, sender_id: actorId, kind: 'service', text: JSON.stringify(payload), topic_id });
}

// ---------- accounts ----------

function ensureNameFree(name, { userId, chatId } = {}) {
  const u = repo.userByUsername(name);
  const c = repo.chatByUsername(name);
  if ((u && u.id !== userId) || (c && c.id !== chatId)) throw err(409, 'username_taken', 'This username is already taken');
}

async function register(body, meta) {
  const username = v.username(body.username);
  const displayName = v.displayName(body.display_name || username);
  const password = v.password(body.password);
  ensureNameFree(username);
  const hash = await auth.hashPassword(password);
  let id;
  try {
    id = repo.insertUser(username, displayName, hash, Date.now());
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw err(409, 'username_taken', 'This username is already taken');
    throw e;
  }
  // everyone starts with Saved Messages and the built-in sticker packs
  openPrivate({ id }, username);
  for (const pack of repo.builtinPacks()) repo.installPack(id, pack.id);
  try { require('./official').onRegister(id); } catch (e) { console.error('[official]', e); }
  return { token: auth.createSession(id, meta), user: selfUser(repo.userById(id)) };
}

async function login(body, meta) {
  const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const row = username && username.length <= 64 ? repo.userByUsername(username) : null;
  if (!row) {
    await auth.burnTime(password);
    throw err(401, 'invalid_credentials', 'Wrong username or password');
  }
  if (!(await auth.verifyPassword(password, row.password_hash))) throw err(401, 'invalid_credentials', 'Wrong username or password');
  const tf = repo.twofa(row.id);
  if (tf?.twofa_hash) {
    // Two-step verification: the account password alone is not enough.
    const loginToken = crypto.randomBytes(24).toString('base64url');
    pending2fa.set(loginToken, { userId: row.id, exp: Date.now() + 5 * 60_000, tries: 0 });
    return { twofa_required: true, login_token: loginToken, hint: tf.twofa_hint || '' };
  }
  const token = auth.createSession(row.id, meta);
  try { require('./official').onLogin(row.id, meta); } catch (e) { console.error('[official]', e); }
  return { token, user: selfUser(repo.userById(row.id)) };
}

const pending2fa = new Map();
setInterval(() => { const now = Date.now(); for (const [k, p] of pending2fa) if (p.exp < now) pending2fa.delete(k); }, 60_000).unref();
async function login2fa(body, meta) {
  const key = typeof body.login_token === 'string' ? body.login_token : '';
  const p = pending2fa.get(key);
  if (!p || p.exp < Date.now()) { pending2fa.delete(key); throw err(401, 'login_expired', 'Login session expired, start again'); }
  if (++p.tries > 5) { pending2fa.delete(key); throw err(429, 'rate_limited', 'Too many attempts'); }
  const tf = repo.twofa(p.userId);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!tf?.twofa_hash || !(await auth.verifyPassword(password, tf.twofa_hash))) throw err(401, 'invalid_2fa', 'Wrong password');
  pending2fa.delete(key);
  const token = auth.createSession(p.userId, meta);
  try { require('./official').onLogin(p.userId, meta); } catch (e) { console.error('[official]', e); }
  return { token, user: selfUser(repo.userById(p.userId)) };
}

function twofaStatus(user) {
  const tf = repo.twofa(user.id);
  return { enabled: !!tf?.twofa_hash, hint: tf?.twofa_hint || '' };
}
async function setTwofa(user, body) {
  const tf = repo.twofa(user.id);
  if (tf?.twofa_hash) {
    const cur = typeof body.current_password === 'string' ? body.current_password : '';
    if (!(await auth.verifyPassword(cur, tf.twofa_hash))) throw err(403, 'invalid_2fa', 'Wrong password');
  }
  const next = body.new_password;
  if (next == null || next === '') {
    if (!tf?.twofa_hash) throw v.bad('Two-step verification is not enabled');
    repo.setTwofa(user.id, null, '');
  } else {
    if (typeof next !== 'string' || next.length < 1 || next.length > 128) throw v.bad('Password must be 1-128 characters');
    const hint = body.hint == null ? '' : v.line(String(body.hint), 'hint', 64, true);
    if (hint && hint === next) throw v.bad('Hint must not be the password');
    repo.setTwofa(user.id, await auth.hashPassword(next), hint);
  }
  hub.sendToUser(user.id, { type: 'me', user: selfUser(repo.userById(user.id)) });
  return twofaStatus(user);
}

function setPrivacy(user, body) {
  if (!body || typeof body !== 'object') throw v.bad('privacy must be an object');
  const cur = privacyOf(repo.userById(user.id));
  for (const [k, val] of Object.entries(body)) {
    if (!PRIVACY_KEYS.includes(k)) throw v.bad(`Unknown privacy key: ${k}`);
    if (!PRIVACY_VALUES.has(val)) throw v.bad('Privacy value must be everybody, contacts or nobody');
    cur[k] = val;
  }
  repo.setPrivacy(user.id, cur);
  repo.updateUser(user.id, { show_last_seen: cur.last_seen === 'nobody' ? 0 : 1 });
  const fresh = repo.userById(user.id);
  hub.sendToUser(user.id, { type: 'me', user: selfUser(fresh) });
  for (const id of repo.contactIds(user.id)) hub.sendToUser(id, { type: 'user', user: publicUser(fresh, id) });
  broadcastPresence(user.id);
  return { privacy: cur };
}

function requireOwnImage(userId, fileIdRaw) {
  const id = v.fileId(fileIdRaw);
  const f = repo.fileById(id);
  if (!f || f.owner_id !== userId) throw err(404, 'file_not_found', 'File not found');
  if (!isImage(f.mime)) throw v.bad('Avatar must be a JPEG, PNG, GIF or WebP image');
  return id;
}

function updateProfile(user, body) {
  const fields = {};
  if (body.display_name !== undefined) fields.display_name = v.displayName(body.display_name);
  if (body.bio !== undefined) fields.bio = v.bio(body.bio);
  if (body.username !== undefined) {
    fields.username = v.username(body.username);
    ensureNameFree(fields.username, { userId: user.id });
  }
  if (body.avatar !== undefined) fields.avatar_file = body.avatar === null ? null : requireOwnImage(user.id, body.avatar);
  if (body.show_last_seen !== undefined) {
    fields.show_last_seen = body.show_last_seen ? 1 : 0;
    fields.privacy = JSON.stringify({ ...privacyOf(repo.userById(user.id)), last_seen: body.show_last_seen ? 'everybody' : 'nobody' });
  }
  try {
    repo.updateUser(user.id, fields);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw err(409, 'username_taken', 'This username is already taken');
    throw e;
  }
  const fresh = repo.userById(user.id);
  hub.sendToUser(user.id, { type: 'me', user: selfUser(fresh) });
  for (const id of repo.contactIds(user.id)) hub.sendToUser(id, { type: 'user', user: publicUser(fresh, id) });
  if (fields.show_last_seen !== undefined) broadcastPresence(user.id);
  return selfUser(fresh);
}

async function changePassword(user, body) {
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const next = v.password(body.new_password);
  if (!(await auth.verifyPassword(current, repo.passwordHash(user.id)))) throw err(403, 'invalid_credentials', 'Current password is wrong');
  repo.setPassword(user.id, await auth.hashPassword(next));
  terminateOtherSessions(user);
  return { ok: true };
}

// Synced per-account client settings (theme, chat background, text size, folders...).
// Server only enforces shape/size; the client owns the meaning of each key.
const SETTINGS_KEYS = new Set(['theme', 'background', 'text_size', 'send_key', 'folders', 'notify', 'sound', 'animations', 'stickers_recent', 'emoji_recent',
  'accent', 'time_format', 'large_emoji', 'autoplay_gif', 'autoplay_video', 'auto_download', 'notify_private', 'notify_group', 'notify_channel',
  'notify_preview', 'suggest_stickers', 'loop_stickers', 'bubble_radius', 'chat_list_two_line', 'stories_hidden', 'folders_sidebar']);
function getSettings(user) {
  return { settings: repo.getSettings(user.id) };
}
function updateSettings(user, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw v.bad('settings must be an object');
  const cur = repo.getSettings(user.id);
  for (const [k, val] of Object.entries(body)) {
    if (!SETTINGS_KEYS.has(k)) throw v.bad(`Unknown setting: ${k}`);
    if (val === null) delete cur[k];
    else cur[k] = val;
  }
  if (Array.isArray(cur.folders)) {
    if (cur.folders.length > 20) throw v.bad('Up to 20 folders');
    for (const f of cur.folders) {
      if (!f || typeof f !== 'object' || typeof f.title !== 'string' || !f.title.trim() || f.title.length > 24) throw v.bad('Folder title must be 1-24 characters');
    }
  }
  const json = JSON.stringify(cur);
  if (json.length > 32 * 1024) throw v.bad('Settings too large');
  repo.setSettings(user.id, cur);
  hub.sendToUser(user.id, { type: 'settings', settings: cur });
  return { settings: cur };
}

function listSessions(user) {
  return repo.sessionsForUser(user.id).map((s) => ({
    id: s.id, device: s.device, ip: s.ip, created_at: s.created_at, last_active: s.last_active,
    current: s.token_hash === user.token_hash,
  }));
}

function killSession(tokenHash) {
  auth.revoke(tokenHash);
  hub.closeSession(tokenHash);
}

function terminateSession(user, idRaw) {
  const id = v.id(idRaw, 'session_id');
  const s = repo.sessionsForUser(user.id).find((x) => x.id === id);
  if (!s) throw err(404, 'not_found', 'Session not found');
  killSession(s.token_hash);
  return { ok: true };
}

function terminateOtherSessions(user) {
  for (const s of repo.sessionsForUser(user.id)) if (s.token_hash !== user.token_hash) killSession(s.token_hash);
  return { ok: true };
}

function search(user, qRaw) {
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';
  if (!q) return { users: [], chats: [], messages: [] };
  if (q.length > 64) throw v.bad('Query too long');
  const name = q.replace(/^@/, '');
  return {
    users: repo.searchUsers(user.id, name).map((u) => publicUser(u, user.id)),
    chats: repo.searchPublicChats(name).map((c) => ({ ...previewChat(c), is_member: !!repo.membership(c.id, user.id) })),
    messages: q.length >= 2 ? repo.searchGlobal(user.id, q).map((m) => formatMessage(m, user.id)) : [],
  };
}

function resolve(user, nameRaw) {
  const name = v.lookupName(nameRaw);
  const u = repo.userByUsername(name);
  if (u) return { user: publicUser(repo.userById(u.id), user.id) };
  const c = repo.chatByUsername(name);
  if (c) return { chat: { ...previewChat(c), is_member: !!repo.membership(c.id, user.id) } };
  throw err(404, 'not_found', 'Nothing found with this username');
}

// ---------- chats ----------

function listChats(userId) {
  return repo
    .chatIdsForUser(userId)
    .map((id) => repo.chatById(id))
    .map((chat) => ({ chat, view: buildChat(chat, userId) }))
    // hide empty private chats that someone else opened with you
    .filter(({ chat, view }) => view && !(chat.type === 'private' && !view.last_message && chat.created_by !== userId && view.peer.id !== userId))
    .map(({ view }) => view);
}

function chatDetails(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  // channel subscribers are only visible to admins
  const showMembers = chat.type !== 'channel' || isManager(membership);
  return {
    chat: buildChat(chat, user.id),
    members: showMembers ? repo.members(chatId).map((m) => ({ ...publicUser(m, user.id), role: m.role })) : [],
  };
}

function openPrivate(user, usernameRaw) {
  const peer = repo.userByUsername(v.lookupName(usernameRaw));
  if (!peer) throw err(404, 'user_not_found', 'User not found');
  const [a, b] = [user.id, peer.id].sort((x, y) => x - y);
  const key = `${a}:${b}`;
  let chat = repo.chatByPrivateKey(key);
  if (!chat) {
    const id = repo.tx(() => {
      const id = repo.insertChat('private', null, '', null, key, user.id, Date.now());
      repo.addMember(id, user.id, 'member');
      if (peer.id !== user.id) repo.addMember(id, peer.id, 'member');
      return id;
    });
    chat = repo.chatById(id);
  }
  return buildChat(chat, user.id);
}

function resolveUsers(usernames, selfId) {
  if (usernames == null) return [];
  if (!Array.isArray(usernames)) throw v.bad('usernames must be an array');
  if (usernames.length > 200) throw v.bad('Too many members at once (max 200)');
  const seen = new Set();
  const users = [];
  for (const raw of usernames) {
    const name = v.lookupName(raw).toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const u = repo.userByUsername(name);
    if (!u) throw err(404, 'user_not_found', `User @${name} not found`);
    if (u.id !== selfId) users.push(u);
  }
  return users;
}

function createChat(user, type, body) {
  const title = v.title(body.title);
  const description = v.description(body.description);
  const username = body.username ? v.publicName(body.username) : null;
  if (username) ensureNameFree(username);
  const users = resolveUsers(body.usernames, user.id);
  checkCanAdd(user.id, users);
  const chatId = repo.tx(() => {
    const now = Date.now();
    const id = repo.insertChat(type, title, description, username, null, user.id, now);
    repo.addMember(id, user.id, 'owner', now);
    for (const u of users) repo.addMember(id, u.id, 'member', now);
    const sid = insertService(id, user.id, { action: 'created', title });
    repo.markRead(id, user.id, sid);
    return id;
  });
  pushChat(chatId);
  return buildChat(repo.chatById(chatId), user.id);
}

function checkCanAdd(adderId, users) {
  for (const u of users) {
    if (!allows(u, 'groups', adderId)) throw err(403, 'privacy_restricted', `@${u.username} does not allow being added to groups`);
  }
}

const createGroup = (user, body) => createChat(user, 'group', body);
const createChannel = (user, body) => createChat(user, 'channel', body);

function requireManager(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const ctx = requireMember(chatId, user.id);
  if (ctx.chat.type === 'private') throw err(400, 'not_a_group', 'Not available in private chats');
  if (!isManager(ctx.membership)) throw err(403, 'forbidden', 'Only admins can do this');
  return { chatId, ...ctx };
}

function updateChat(user, chatIdRaw, body) {
  const { chatId, chat } = requireManager(user, chatIdRaw);
  const next = { ...chat };
  const events = [];
  if (body.title !== undefined) {
    next.title = v.title(body.title);
    if (next.title !== chat.title) events.push({ action: 'title', title: next.title });
  }
  if (body.description !== undefined) next.description = v.description(body.description);
  if (body.username !== undefined) {
    next.username = body.username ? v.publicName(body.username) : null;
    if (next.username) ensureNameFree(next.username, { chatId });
  }
  if (body.avatar !== undefined) {
    next.avatar_file = body.avatar === null ? null : requireOwnImage(user.id, body.avatar);
    if (next.avatar_file !== chat.avatar_file) events.push({ action: next.avatar_file ? 'photo' : 'photo_removed' });
  }
  let forumChanged = false;
  if (body.is_forum !== undefined) {
    if (chat.type !== 'group') throw v.bad('Topics are only available in groups');
    next.is_forum = body.is_forum ? 1 : 0;
    forumChanged = next.is_forum !== chat.is_forum;
    if (forumChanged) events.push({ action: next.is_forum ? 'forum_on' : 'forum_off' });
  }
  const ids = repo.tx(() => {
    repo.updateChat(chatId, next);
    if (forumChanged) {
      repo.setForum(chatId, next.is_forum);
      if (next.is_forum) { repo.moveToGeneral(chatId); repo.seedGeneralReads(chatId); }
    }
    return chat.type === 'group' ? events.map((e) => insertService(chatId, user.id, e)) : [];
  });
  ids.forEach((id) => emitMessage('message', id));
  pushChat(chatId);
  return buildChat(repo.chatById(chatId), user.id);
}

function addMembers(user, chatIdRaw, body) {
  const { chatId, chat } = requireManager(user, chatIdRaw);
  const names = body.usernames ?? (body.username ? [body.username] : null);
  const users = resolveUsers(names, user.id).filter((u) => !repo.membership(chatId, u.id));
  if (!users.length) throw err(409, 'already_member', 'Everyone is already a member');
  checkCanAdd(user.id, users);
  if (repo.memberCount(chatId) + users.length > config.limits.groupMembers) throw err(400, 'group_full', 'Member limit reached');
  const sid = repo.tx(() => {
    for (const u of users) repo.addMember(chatId, u.id, 'member');
    return chat.type === 'group' ? insertService(chatId, user.id, { action: 'added', names: users.map((u) => u.display_name) }) : null;
  });
  if (sid) emitMessage('message', sid);
  pushChat(chatId);
  return buildChat(repo.chatById(chatId), user.id);
}

function removeMember(user, chatIdRaw, userIdRaw) {
  const { chatId, chat, membership } = requireManager(user, chatIdRaw);
  const targetId = v.id(userIdRaw, 'user_id');
  const target = repo.membership(chatId, targetId);
  if (!target) throw err(404, 'not_found', 'User is not a member');
  if (targetId === user.id) throw v.bad('Use leave instead');
  if (target.role === 'owner' || (target.role === 'admin' && membership.role !== 'owner')) throw err(403, 'forbidden', 'You cannot remove this member');
  const u = repo.userById(targetId);
  const sid = repo.tx(() => {
    repo.removeMember(chatId, targetId);
    return chat.type === 'group' ? insertService(chatId, user.id, { action: 'removed', name: u.display_name }) : null;
  });
  hub.sendToUser(targetId, { type: 'chat_removed', chat_id: chatId });
  if (sid) emitMessage('message', sid);
  pushChat(chatId);
  return { ok: true };
}

function setRole(user, chatIdRaw, userIdRaw, roleRaw) {
  const { chatId, membership } = requireManager(user, chatIdRaw);
  if (membership.role !== 'owner') throw err(403, 'forbidden', 'Only the owner can change admins');
  const targetId = v.id(userIdRaw, 'user_id');
  const role = roleRaw === 'admin' ? 'admin' : roleRaw === 'member' ? 'member' : null;
  if (!role) throw v.bad('role must be admin or member');
  const target = repo.membership(chatId, targetId);
  if (!target) throw err(404, 'not_found', 'User is not a member');
  if (target.role === 'owner') throw v.bad('Owner role cannot be changed');
  repo.setRole(chatId, targetId, role);
  pushChat(chatId);
  return { ok: true };
}

function leaveChat(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (chat.type === 'private') throw err(400, 'cannot_leave_private', 'Delete the chat instead');
  let sid = null;
  let deleted = false;
  repo.tx(() => {
    repo.removeMember(chatId, user.id);
    const next = repo.oldestMember(chatId);
    if (!next) {
      repo.deleteChat(chatId);
      deleted = true;
      return;
    }
    if (membership.role === 'owner') repo.setRole(chatId, next, 'owner');
    if (chat.type === 'group') sid = insertService(chatId, user.id, { action: 'left' });
  });
  hub.sendToUser(user.id, { type: 'chat_removed', chat_id: chatId });
  if (!deleted) {
    if (sid) emitMessage('message', sid);
    pushChat(chatId);
  }
  return { ok: true };
}

function deleteChat(user, chatIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (chat.type !== 'private' && membership.role !== 'owner') throw err(403, 'forbidden', 'Only the owner can delete this chat');
  const members = repo.memberIds(chatId);
  repo.deleteChat(chatId);
  hub.sendToUsers(members, { type: 'chat_removed', chat_id: chatId });
  return { ok: true };
}

function inviteLink(user, chatIdRaw, body) {
  const { chatId, chat } = requireManager(user, chatIdRaw);
  let token = chat.invite_token;
  if (!token || body.revoke) {
    token = crypto.randomBytes(12).toString('base64url');
    repo.setInvite(chatId, token);
    pushChat(chatId, repo.memberIds(chatId).filter((id) => isManager(repo.membership(chatId, id))));
  }
  return { invite_token: token };
}

function findJoinable(body) {
  if (body.invite) {
    const c = typeof body.invite === 'string' && body.invite.length <= 64 ? repo.chatByInvite(body.invite) : null;
    if (!c) throw err(404, 'invite_invalid', 'This invite link is invalid or was revoked');
    return c;
  }
  const c = body.username ? repo.chatByUsername(v.lookupName(body.username)) : null;
  if (!c) throw err(404, 'not_found', 'Chat not found');
  return c;
}

function joinPreview(user, body) {
  const c = findJoinable(body);
  return { chat: { ...previewChat(c), is_member: !!repo.membership(c.id, user.id) } };
}

function join(user, body) {
  const chat = findJoinable(body);
  if (!repo.membership(chat.id, user.id)) {
    if (repo.memberCount(chat.id) >= config.limits.groupMembers) throw err(400, 'group_full', 'Member limit reached');
    const sid = repo.tx(() => {
      // channels: new subscribers don't get a wall of unread history
      repo.addMember(chat.id, user.id, 'member', Date.now(), chat.type === 'channel' ? repo.maxMessageId(chat.id) : 0);
      return chat.type === 'group' ? insertService(chat.id, user.id, { action: 'joined' }) : null;
    });
    if (sid) emitMessage('message', sid);
    pushChat(chat.id);
  }
  return { chat: buildChat(repo.chatById(chat.id), user.id) };
}

function chatSettings(user, chatIdRaw, body) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { membership } = requireMember(chatId, user.id);
  if (body.muted !== undefined) repo.setMuted(chatId, user.id, !!body.muted);
  if (body.archived !== undefined) {
    repo.setArchived(chatId, user.id, !!body.archived);
    if (body.archived) repo.setPinned(chatId, user.id, null);
  }
  if (body.pinned !== undefined) {
    if (body.pinned && membership.pinned_at == null) {
      if (repo.pinnedCount(user.id) >= MAX_PINNED_CHATS) throw err(400, 'too_many_pinned', `You can pin up to ${MAX_PINNED_CHATS} chats`);
      repo.setPinned(chatId, user.id, Date.now());
      repo.setArchived(chatId, user.id, false);
    } else if (!body.pinned) repo.setPinned(chatId, user.id, null);
  }
  if (body.read) {
    repo.markRead(chatId, user.id, repo.maxMessageId(chatId));
    if (repo.chatById(chatId).is_forum) for (const tid of [0, ...repo.topics(chatId).map((t) => t.id)]) repo.markTopicRead(chatId, tid, user.id, repo.topicMax(chatId, tid));
  }
  pushChat(chatId, [user.id]);
  return { chat: buildChat(repo.chatById(chatId), user.id) };
}

function pinMessage(user, chatIdRaw, messageIdRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (chat.type !== 'private' && !isManager(membership)) throw err(403, 'forbidden', 'Only admins can pin messages');
  let sid = null;
  if (messageIdRaw == null) {
    repo.setPinnedMessage(chatId, null);
  } else {
    const msgId = v.id(messageIdRaw, 'message_id');
    const msg = repo.rawMessage(msgId);
    if (!msg || msg.chat_id !== chatId || msg.kind === 'service') throw err(404, 'not_found', 'Message not found');
    sid = repo.tx(() => {
      repo.setPinnedMessage(chatId, msgId);
      return chat.type !== 'channel' ? insertService(chatId, user.id, { action: 'pinned', message_id: msgId, text: truncate(msg.text, 60), kind: msg.kind }, msg.topic_id) : null;
    });
  }
  if (sid) emitMessage('message', sid);
  pushChat(chatId);
  return { ok: true };
}

// ---------- messages ----------

function history(user, chatIdRaw, q) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat } = requireMember(chatId, user.id);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 100);
  const fmt = (rows) => rows.map((m) => formatMessage(m, user.id));
  // forum groups: history of one topic (0 = General)
  const topicId = chat.is_forum && q.topic != null && q.topic !== '' ? (String(q.topic) === '0' ? 0 : v.id(q.topic, 'topic')) : null;
  const before = (b, n) => (topicId == null ? repo.messagesBefore(chatId, b, n) : repo.topicBefore(chatId, topicId, b, n));
  const after = (a, n) => (topicId == null ? repo.messagesAfter(chatId, a, n) : repo.topicAfter(chatId, topicId, a, n));
  if (q.around) {
    const around = v.id(q.around, 'around');
    const half = Math.floor(limit / 2);
    const older = before(around + 1, half + 1);
    const newer = after(around, half + 1);
    return {
      messages: fmt([...older.slice(0, half).reverse(), ...newer.slice(0, half)]),
      has_more: older.length > half,
      has_newer: newer.length > half,
    };
  }
  if (q.after) {
    const rows = after(v.id(q.after, 'after'), limit + 1);
    return { messages: fmt(rows.slice(0, limit)), has_more: false, has_newer: rows.length > limit };
  }
  const beforeId = q.before ? v.id(q.before, 'before') : Number.MAX_SAFE_INTEGER;
  const rows = before(beforeId, limit + 1);
  return { messages: fmt(rows.slice(0, limit).reverse()), has_more: rows.length > limit, has_newer: false };
}

function kindForFile(mime, o = {}) {
  if (o.asFile) return isAudio(mime) && !o.voice ? 'audio' : 'file';
  if (mime === 'image/gif') return 'gif';
  if (isImage(mime)) return 'photo';
  if (isVideo(mime)) return o.round ? 'video_note' : o.gif ? 'gif' : 'video';
  if (isAudio(mime)) return o.voice ? 'voice' : 'audio';
  return 'file';
}

function checkPrivatePeer(chat, userId) {
  if (chat.type !== 'private') return null;
  const peerId = repo.otherMember(chat.id, userId);
  if (!peerId) return null; // Saved Messages
  if (repo.userById(peerId)?.is_system) throw err(403, 'forbidden', 'You cannot reply to service notifications');
  if (repo.isBlocked(userId, peerId)) throw err(403, 'you_blocked', 'Unblock this user to send messages');
  if (repo.isBlocked(peerId, userId)) throw err(403, 'blocked', 'This user restricted who can message them');
  return peerId;
}

function resolveTopic(chat, membership, raw) {
  if (!chat.is_forum) return null;
  if (raw == null || raw === 0 || raw === '0') return 0;
  const t = repo.topicById(v.id(raw, 'topic_id'));
  if (!t || t.chat_id !== chat.id) throw err(404, 'topic_not_found', 'Topic not found');
  if (t.closed && !isManager(membership)) throw err(403, 'topic_closed', 'This topic is closed');
  return t.id;
}

const GROUP_RE = /^[A-Za-z0-9_-]{6,40}$/;
const GROUPABLE = new Set(['photo', 'video', 'file', 'audio', 'gif']);

function validReplyTo(raw, chatId) {
  if (raw == null) return null;
  const replyTo = v.id(raw, 'reply_to');
  const target = repo.rawMessage(replyTo);
  if (!target || target.chat_id !== chatId) throw v.bad('reply_to must point to a message in the same chat');
  return replyTo;
}

function sendMessage(user, body) {
  const chatId = v.id(body.chat_id, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (!canPost(chat, membership)) throw err(403, 'forbidden', 'Only admins can post in this channel');
  const peerId = checkPrivatePeer(chat, user.id);
  const msg = { chat_id: chatId, sender_id: user.id, reply_to: validReplyTo(body.reply_to, chatId), topic_id: resolveTopic(chat, membership, body.topic_id) };
  if (body.sticker_id != null) {
    const st = repo.stickerById(v.id(body.sticker_id, 'sticker_id'));
    if (!st) throw err(404, 'sticker_not_found', 'Sticker not found');
    const meta = { sticker_id: st.id, pack_id: st.pack_id, emoji: st.emoji, url: st.url || fileUrl(st.file_id) };
    Object.assign(msg, { kind: 'sticker', file_id: st.file_id || null, text: '', meta: JSON.stringify(meta) });
  } else if (body.poll) {
    if (chat.type === 'private') throw v.bad('Polls are available in groups and channels');
    const poll = v.poll(body.poll);
    Object.assign(msg, { kind: 'poll', text: poll.question, poll: JSON.stringify(poll) });
  } else if (body.file_id) {
    const f = repo.fileById(v.fileId(body.file_id));
    // your own uploads, or (for GIFs) anything you can already see, e.g. a saved GIF
    const reusable = body.gif && f && (repo.fileVisible(user.id, f.id) || repo.savedGifs(user.id).some((g) => g.file_id === f.id));
    if (!f || (f.owner_id !== user.id && !reusable)) throw err(404, 'file_not_found', 'File not found');
    const kind = kindForFile(f.mime, { voice: !!body.voice, asFile: !!body.as_file, gif: !!body.gif, round: !!body.video_note });
    const spoiler = body.spoiler && (kind === 'photo' || kind === 'video' || kind === 'gif') ? { spoiler: true } : {};
    let meta = cleanMeta(body.meta, spoiler);
    if (!meta && kind === 'gif' && f.owner_id !== user.id) meta = cleanMeta(repo.gifMeta(f.id));
    const grouped = body.grouped_id != null && GROUPABLE.has(kind) && GROUP_RE.test(String(body.grouped_id)) ? String(body.grouped_id) : null;
    Object.assign(msg, { kind, file_id: f.id, text: v.caption(body.text), meta, grouped_id: grouped });
  } else {
    Object.assign(msg, { kind: 'text', text: v.messageText(body.text) });
    const meta = {};
    if (body.story_id != null) {
      const st = repo.storyById(v.id(body.story_id, 'story_id'));
      if (!st || st.user_id !== peerId || !storyVisible(st, user.id)) throw err(404, 'story_not_found', 'Story not found');
      meta.story_id = st.id;
    }
    if (body.silent) meta.silent = true;
    if (body.no_preview) meta.no_preview = true;
    if (Object.keys(meta).length) msg.meta = JSON.stringify(meta);
  }
  if (body.silent && msg.kind !== 'text') {
    const m = parseMeta(msg.meta);
    msg.meta = JSON.stringify({ ...m, silent: true });
  }
  const id = repo.tx(() => {
    const id = repo.insertMessage(msg);
    repo.markRead(chatId, user.id, id); // your own messages count as read
    if (msg.topic_id != null) repo.markTopicRead(chatId, msg.topic_id, user.id, id);
    return id;
  });
  emitMessage('message', id);
  if (msg.kind === 'text' && !body.no_preview) require('./preview').attach(id, msg.text, user.id);
  return formatMessage(repo.messageById(id), user.id);
}

function forwardMessages(user, body) {
  const toId = v.id(body.to_chat_id, 'to_chat_id');
  const ids = v.ids(body.message_ids, 'message_ids').sort((a, b) => a - b);
  const target = requireMember(toId, user.id);
  if (!canPost(target.chat, target.membership)) throw err(403, 'forbidden', 'You cannot post in this chat');
  checkPrivatePeer(target.chat, user.id);
  const toTopic = resolveTopic(target.chat, target.membership, body.to_topic_id);
  const groups = new Map();
  const sources = ids.map((id) => {
    const m = repo.rawMessage(id);
    if (!m || !repo.membership(m.chat_id, user.id) || m.kind === 'service') throw err(404, 'not_found', 'Message not found');
    return m;
  });
  const newIds = repo.tx(() =>
    sources.map((m) => {
      const sender = repo.userById(m.sender_id);
      const saved = m.chat_type === 'private' && m.sender_id === user.id && m.fwd_name == null && repo.otherMember(m.chat_id, user.id) == null;
      const fromName = m.fwd_name || (m.chat_type === 'channel' ? m.chat_title : sender.display_name);
      const fromChat = m.fwd_name ? m.fwd_chat : m.chat_type === 'channel' ? m.chat_title : null;
      // the original author can hide the link to their account (privacy: forwards)
      const fromUser = m.fwd_name ? m.fwd_user_id : m.chat_type !== 'channel' && allows(sender, 'forwards', user.id) ? sender.id : null;
      let grouped = null;
      if (m.grouped_id) {
        if (!groups.has(m.grouped_id)) groups.set(m.grouped_id, crypto.randomBytes(8).toString('hex'));
        grouped = groups.get(m.grouped_id);
      }
      const keepPlain = m.kind === 'sticker' || saved; // stickers and your own saved notes are re-sent, not "forwarded"
      const id = repo.insertMessage({
        chat_id: toId, sender_id: user.id, kind: m.kind, text: m.text, file_id: m.file_id, poll: m.poll, meta: m.kind === 'text' ? null : m.meta,
        fwd_name: keepPlain ? null : fromName, fwd_chat: keepPlain ? null : fromChat, fwd_user_id: keepPlain ? null : fromUser,
        topic_id: toTopic, grouped_id: grouped,
      });
      repo.markRead(toId, user.id, id);
      if (toTopic != null) repo.markTopicRead(toId, toTopic, user.id, id);
      return id;
    })
  );
  newIds.forEach((id) => emitMessage('message', id));
  return { messages: newIds.map((id) => formatMessage(repo.messageById(id), user.id)) };
}

function loadVisibleMessage(user, messageIdRaw) {
  const id = v.id(messageIdRaw, 'message_id');
  const msg = repo.rawMessage(id);
  const membership = msg && repo.membership(msg.chat_id, user.id);
  if (!msg || !membership) throw err(404, 'not_found', 'Message not found');
  return { id, msg, membership };
}

function editMessage(user, messageIdRaw, textRaw) {
  const { id, msg } = loadVisibleMessage(user, messageIdRaw);
  if (msg.sender_id !== user.id) throw err(403, 'forbidden', 'You can only edit your own messages');
  if (['service', 'poll', 'sticker', 'call', 'video_note', 'voice'].includes(msg.kind)) throw v.bad('This message cannot be edited');
  if (msg.fwd_name) throw v.bad('Forwarded messages cannot be edited');
  if (Date.now() - msg.created_at > EDIT_WINDOW_MS) throw err(403, 'edit_window_expired', 'Messages can only be edited for 48 hours');
  const text = msg.kind === 'text' ? v.messageText(textRaw) : v.caption(textRaw);
  repo.editMessage(id, text, Date.now());
  emitMessage('message_updated', id);
  if (msg.kind === 'text') require('./preview').attach(id, text, user.id, true);
  return formatMessage(repo.messageById(id), user.id);
}

function deleteMessages(user, idsRaw) {
  const ids = v.ids(idsRaw, 'message_ids');
  const byChat = new Map();
  for (const id of ids) {
    const { msg, membership } = loadVisibleMessage(user, id);
    const allowed = msg.sender_id === user.id || msg.chat_type === 'private' || isManager(membership);
    if (!allowed) throw err(403, 'forbidden', 'You cannot delete this message');
    if (!byChat.has(msg.chat_id)) byChat.set(msg.chat_id, []);
    byChat.get(msg.chat_id).push(id);
  }
  repo.tx(() => {
    for (const [chatId, list] of byChat) for (const id of list) {
      repo.deleteMessage(id);
      repo.clearPinnedIf(chatId, id);
    }
  });
  for (const [chatId, list] of byChat) {
    emitToChat(chatId, { type: 'messages_deleted', chat_id: chatId, message_ids: list });
    pushChat(chatId);
  }
  return { ok: true, deleted: ids.length };
}

function react(user, messageIdRaw, emoji) {
  const { id, msg } = loadVisibleMessage(user, messageIdRaw);
  if (msg.kind === 'service') throw v.bad('Cannot react to this message');
  if (emoji == null || emoji === '') repo.removeReaction(id, user.id);
  else {
    if (!REACTIONS.includes(emoji)) throw v.bad('Unsupported reaction');
    if (repo.reactionOf(id, user.id) === emoji) repo.removeReaction(id, user.id);
    else repo.setReaction(id, user.id, emoji);
  }
  emitMessage('message_updated', id);
  return formatMessage(repo.messageById(id), user.id);
}

function vote(user, messageIdRaw, optionRaw) {
  const { id, msg } = loadVisibleMessage(user, messageIdRaw);
  if (msg.kind !== 'poll') throw v.bad('Not a poll');
  if (optionRaw == null) repo.removeVote(id, user.id);
  else {
    const n = JSON.parse(msg.poll).options.length;
    const option = Number(optionRaw);
    if (!Number.isInteger(option) || option < 0 || option >= n) throw v.bad('Invalid option');
    repo.setVote(id, user.id, option);
  }
  emitMessage('message_updated', id);
  return formatMessage(repo.messageById(id), user.id);
}

function markRead(user, chatIdRaw, messageIdRaw, topicRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const messageId = v.id(messageIdRaw, 'message_id');
  const { chat, membership } = requireMember(chatId, user.id);
  const target = Math.min(messageId, repo.maxMessageId(chatId));
  if (chat.is_forum) {
    let topicId = topicRaw != null && topicRaw !== '' ? (String(topicRaw) === '0' ? 0 : v.id(topicRaw, 'topic_id')) : null;
    if (topicId == null) topicId = repo.rawMessage(target)?.topic_id ?? 0;
    const tTarget = Math.min(messageId, repo.topicMax(chatId, topicId));
    if (tTarget > repo.topicRead(chatId, topicId, user.id)) {
      repo.markTopicRead(chatId, topicId, user.id, tTarget);
      repo.markRead(chatId, user.id, tTarget);
      hub.sendToUser(user.id, { type: 'topic_read', chat_id: chatId, topic_id: topicId, message_id: tTarget });
      emitToChat(chatId, { type: 'read', chat_id: chatId, user_id: user.id, message_id: tTarget, topic_id: topicId }, user.id);
      pushChat(chatId, [user.id]);
    }
    return { last_read_id: tTarget };
  }
  if (target > membership.last_read_id) {
    repo.markRead(chatId, user.id, target);
    const event = { type: 'read', chat_id: chatId, user_id: user.id, message_id: target };
    // in channels only your own devices care
    if (chat.type === 'channel') hub.sendToUser(user.id, event);
    else emitToChat(chatId, event);
  }
  return { last_read_id: Math.max(target, membership.last_read_id) };
}

const ACTIONS = new Set(['typing', 'recording', 'uploading', 'recording_round', 'choosing_sticker']);
function typing(user, chatIdRaw, actionRaw, topicRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  const { chat, membership } = requireMember(chatId, user.id);
  if (!canPost(chat, membership) || chat.type === 'channel') return;
  try { checkPrivatePeer(chat, user.id); } catch { return; }
  const action = ACTIONS.has(actionRaw) ? actionRaw : 'typing';
  const topic_id = chat.is_forum ? Number(topicRaw) || 0 : null;
  emitToChat(chatId, { type: 'typing', chat_id: chatId, topic_id, action, user: { id: user.id, display_name: user.display_name } }, user.id);
}

function searchInChat(user, chatIdRaw, qRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  requireMember(chatId, user.id);
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';
  if (!q) return { messages: [] };
  if (q.length > 64) throw v.bad('Query too long');
  return { messages: repo.searchInChat(chatId, q).map((m) => formatMessage(m, user.id)) };
}

const MEDIA_TYPES = { media: ['photo', 'video'], file: ['file'], music: ['audio'], voice: ['voice', 'video_note'], gif: ['gif'] };
function chatMedia(user, chatIdRaw, typeRaw, beforeRaw) {
  const chatId = v.id(chatIdRaw, 'chat_id');
  requireMember(chatId, user.id);
  const before = beforeRaw ? v.id(beforeRaw, 'before') : Number.MAX_SAFE_INTEGER;
  if (typeRaw === 'link') return { messages: repo.linksInChat(chatId, before, 60).map((m) => formatMessage(m, user.id)) };
  const kinds = MEDIA_TYPES[typeRaw] || MEDIA_TYPES.media;
  return { messages: repo.mediaInChat(chatId, kinds, before, 60).map((m) => formatMessage(m, user.id)) };
}

module.exports = {
  REACTIONS, publicUser, selfUser, formatMessage, broadcastPresence, privacyOf, allows, storyVisible, emitMessage, pushChat, emitToChat,
  requireMember, isManager, insertService, checkPrivatePeer, forumUnread, openPrivate, buildChat,
  login2fa, twofaStatus, setTwofa, setPrivacy,
  register, login, updateProfile, changePassword, listSessions, getSettings, updateSettings, terminateSession, terminateOtherSessions,
  search, resolve,
  listChats, chatDetails, openPrivate, createGroup, createChannel, updateChat, addMembers, removeMember, setRole,
  leaveChat, deleteChat, inviteLink, joinPreview, join, chatSettings, pinMessage,
  history, sendMessage, forwardMessages, editMessage, deleteMessages, react, vote, markRead, typing, searchInChat, chatMedia,
};
