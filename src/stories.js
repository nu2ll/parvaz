'use strict';
// Stories: photo/video posts that disappear after 6-48 hours. Visible to people you chat with
// (privacy "everybody") or only to your contacts. Owners see who viewed and reacted.
const repo = require('./db');
const hub = require('./hub');
const v = require('./validate');
const service = require('./service');
const { fileUrl, isImage, isVideo } = require('./files');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const PERIODS = [6, 12, 24, 48];
const parse = (raw) => { try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };

function storyView(s, viewerId) {
  const own = s.user_id === viewerId;
  const seen = own ? true : !!repo.storyViewed(s.id, viewerId);
  return {
    id: s.id,
    user_id: s.user_id,
    kind: s.kind,
    url: fileUrl(s.file_id),
    mime: s.mime,
    caption: s.caption,
    ...parse(s.meta),
    created_at: s.created_at,
    expires_at: s.expires_at,
    expired: s.expires_at < Date.now(),
    pinned: !!s.pinned,
    seen,
    my_reaction: own ? null : repo.storyViewed(s.id, viewerId)?.reaction || null,
    privacy: own ? s.privacy : undefined,
    views: own ? repo.storyViewCount(s.id) : undefined,
  };
}

// people whose stories appear in your feed / who see yours
function audience(userId) {
  const ids = new Set(repo.privatePeers(userId));
  for (const id of repo.contactOf(userId)) ids.add(id); // people who saved you as a contact
  for (const u of repo.contacts(userId)) ids.add(u.id);
  ids.delete(userId);
  return [...ids];
}

function userEntry(u, viewerId) {
  const list = repo.activeStories(u.id).filter((s) => service.storyVisible(s, viewerId));
  if (!list.length) return null;
  const stories = list.map((s) => storyView(s, viewerId));
  return { user: service.publicUser(u, viewerId), stories, unseen: stories.filter((s) => !s.seen).length, last_at: list.at(-1).created_at };
}

function feed(user) {
  const out = [];
  const mine = userEntry(repo.userById(user.id), user.id);
  for (const id of audience(user.id)) {
    const u = repo.userById(id);
    const e = u && userEntry(u, user.id);
    if (e) out.push(e);
  }
  out.sort((a, b) => (b.unseen > 0) - (a.unseen > 0) || b.last_at - a.last_at);
  return { me: mine, users: out };
}

function ofUser(user, uidRaw) {
  const u = repo.userById(v.id(uidRaw, 'user_id'));
  if (!u) throw err(404, 'user_not_found', 'User not found');
  const active = repo.activeStories(u.id).filter((s) => service.storyVisible(s, user.id)).map((s) => storyView(s, user.id));
  const pinned = repo.pinnedStories(u.id).filter((s) => service.storyVisible(s, user.id)).map((s) => storyView(s, user.id));
  return { user: service.publicUser(u, user.id), stories: active, pinned };
}

function notify(userId) {
  hub.sendToUsers([userId, ...audience(userId)], { type: 'stories', user_id: userId });
}

function create(user, body) {
  const f = repo.fileById(v.fileId(body.file_id));
  if (!f || f.owner_id !== user.id) throw err(404, 'file_not_found', 'File not found');
  const kind = isImage(f.mime) ? 'photo' : isVideo(f.mime) ? 'video' : null;
  if (!kind) throw v.bad('A story must be a photo or a video');
  const caption = v.multiline(body.caption, 'Caption', 1024);
  const privacy = body.privacy === 'contacts' ? 'contacts' : 'everybody';
  const hours = PERIODS.includes(Number(body.period)) ? Number(body.period) : 24;
  const meta = {};
  for (const k of ['width', 'height', 'duration']) {
    const n = Number(body.meta?.[k]);
    if (Number.isFinite(n) && n > 0 && n < 100000) meta[k] = Math.round(n * 10) / 10;
  }
  const now = Date.now();
  const id = repo.insertStory({ user_id: user.id, file_id: f.id, kind, caption, privacy, meta: JSON.stringify(meta), created_at: now, expires_at: now + hours * 3600_000 });
  if (body.pinned) repo.pinStory(id, true);
  notify(user.id);
  return { story: storyView(repo.storyById(id), user.id) };
}

function loadVisible(user, idRaw) {
  const s = repo.storyById(v.id(idRaw, 'story_id'));
  if (!s || !service.storyVisible(s, user.id) || (s.expires_at < Date.now() && !s.pinned && s.user_id !== user.id)) {
    throw err(404, 'story_not_found', 'Story not found');
  }
  return s;
}

function remove(user, idRaw) {
  const s = loadVisible(user, idRaw);
  if (s.user_id !== user.id) throw err(403, 'forbidden', 'Not your story');
  repo.deleteStory(s.id);
  notify(user.id);
  return { ok: true };
}

function pin(user, idRaw, body) {
  const s = loadVisible(user, idRaw);
  if (s.user_id !== user.id) throw err(403, 'forbidden', 'Not your story');
  repo.pinStory(s.id, !!body.pinned);
  return { story: storyView(repo.storyById(s.id), user.id) };
}

function view(user, idRaw) {
  const s = loadVisible(user, idRaw);
  if (s.user_id !== user.id && !repo.storyViewed(s.id, user.id)) {
    repo.viewStory(s.id, user.id);
    hub.sendToUser(s.user_id, { type: 'story_views', story_id: s.id, views: repo.storyViewCount(s.id) });
  }
  return { ok: true };
}

function react(user, idRaw, emoji) {
  const s = loadVisible(user, idRaw);
  if (s.user_id === user.id) throw v.bad('You cannot react to your own story');
  if (emoji != null && !service.REACTIONS.includes(emoji)) throw v.bad('Unsupported reaction');
  repo.reactStory(s.id, user.id, emoji || null);
  hub.sendToUser(s.user_id, { type: 'story_views', story_id: s.id, views: repo.storyViewCount(s.id) });
  return { story: storyView(repo.storyById(s.id), user.id) };
}

function views(user, idRaw) {
  const s = loadVisible(user, idRaw);
  if (s.user_id !== user.id) throw err(403, 'forbidden', 'Only the author sees viewers');
  return { views: repo.storyViews(s.id).map((r) => ({ user: service.publicUser(r, user.id), viewed_at: r.viewed_at, reaction: r.reaction })) };
}

module.exports = { feed, ofUser, create, remove, pin, view, react, views, PERIODS };
