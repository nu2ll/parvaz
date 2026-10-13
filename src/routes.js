'use strict';
const service = require('./service');
const auth = require('./auth');
const hub = require('./hub');
const files = require('./files');
const social = require('./social');
const topics = require('./topics');
const stickers = require('./stickers');
const gifs = require('./gifs');
const stories = require('./stories');
const calls = require('./calls');
const official = require('./official');
const scheduled = require('./scheduled');
const { readJson, rateLimit, HttpError } = require('./http-util');

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, ...opts });
}

function match(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    try {
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    } catch {
      throw new HttpError(400, 'bad_path', 'Malformed URL');
    }
    return { route: r, params };
  }
  if (pathMatched) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
  return null;
}

const body = (ctx) => readJson(ctx.req);
const meta = (ctx) => ({ ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
const qp = (ctx, k) => ctx.url.searchParams.get(k);

// ---- public ----
route('GET', '/api/health', () => ({ ok: true, time: Date.now() }), { public: true });
route('GET', '/api/config', () => ({
  reactions: service.REACTIONS,
  max_upload_mb: require('./config').limits.fileBytes / 1048576,
  gif_search: gifs.enabled(),
  story_periods: stories.PERIODS,
  version: require('../package.json').version,
}), { public: true });

route('POST', '/api/auth/register', async (ctx) => {
  rateLimit(`register:${ctx.ip}`, 10, 10 * 60_000);
  return service.register(await body(ctx), meta(ctx));
}, { public: true, status: 201 });

route('POST', '/api/auth/login', async (ctx) => {
  rateLimit(`login:${ctx.ip}`, 20, 60_000);
  const b = await body(ctx);
  if (typeof b.username === 'string') rateLimit(`login-user:${b.username.toLowerCase().slice(0, 64)}`, 10, 5 * 60_000);
  return service.login(b, meta(ctx));
}, { public: true });
route('POST', '/api/auth/2fa', async (ctx) => {
  rateLimit(`login2fa:${ctx.ip}`, 20, 5 * 60_000);
  return service.login2fa(await body(ctx), meta(ctx));
}, { public: true });

// ---- account ----
route('POST', '/api/auth/logout', (ctx) => {
  auth.revoke(ctx.user.token_hash);
  hub.closeSession(ctx.user.token_hash);
  return { ok: true };
});
route('GET', '/api/me', (ctx) => ({ user: service.selfUser(ctx.user) }));
route('PATCH', '/api/me', async (ctx) => ({ user: service.updateProfile(ctx.user, await body(ctx)) }));
route('POST', '/api/me/password', async (ctx) => {
  rateLimit(`password:${ctx.user.id}`, 5, 10 * 60_000);
  return service.changePassword(ctx.user, await body(ctx));
});
route('GET', '/api/me/settings', (ctx) => service.getSettings(ctx.user));
route('PATCH', '/api/me/settings', async (ctx) => {
  rateLimit(`settings:${ctx.user.id}`, 60, 60_000);
  return service.updateSettings(ctx.user, await body(ctx));
});
route('GET', '/api/me/2fa', (ctx) => service.twofaStatus(ctx.user));
route('POST', '/api/me/2fa', async (ctx) => {
  rateLimit(`2fa:${ctx.user.id}`, 10, 10 * 60_000);
  return service.setTwofa(ctx.user, await body(ctx));
});
route('PATCH', '/api/me/privacy', async (ctx) => service.setPrivacy(ctx.user, await body(ctx)));
route('GET', '/api/check-username', (ctx) => social.checkUsername(ctx.user, qp(ctx, 'username'), qp(ctx, 'chat_id')));
route('GET', '/api/sessions', (ctx) => ({ sessions: service.listSessions(ctx.user) }));
route('DELETE', '/api/sessions/:id', (ctx) => service.terminateSession(ctx.user, ctx.params.id));
route('POST', '/api/sessions/terminate-others', (ctx) => service.terminateOtherSessions(ctx.user));

route('GET', '/api/search', (ctx) => {
  rateLimit(`search:${ctx.user.id}`, 60, 60_000);
  return service.search(ctx.user, qp(ctx, 'q'));
});
route('GET', '/api/resolve/:name', (ctx) => service.resolve(ctx.user, ctx.params.name));

route('POST', '/api/files', (ctx) => {
  rateLimit(`upload:${ctx.user.id}`, 60, 10 * 60_000);
  return files.upload(ctx.user, ctx.req, ctx.url);
}, { status: 201 });

// ---- contacts, blocks, profiles ----
route('GET', '/api/contacts', (ctx) => social.listContacts(ctx.user));
route('POST', '/api/contacts', async (ctx) => social.addContact(ctx.user, await body(ctx)));
route('DELETE', '/api/contacts/:uid', (ctx) => social.removeContact(ctx.user, ctx.params.uid));
route('GET', '/api/blocked', (ctx) => social.listBlocked(ctx.user));
route('POST', '/api/blocked', async (ctx) => social.block(ctx.user, await body(ctx)));
route('DELETE', '/api/blocked/:uid', (ctx) => social.unblock(ctx.user, ctx.params.uid));
route('GET', '/api/users/:id', (ctx) => social.profile(ctx.user, ctx.params.id));
route('GET', '/api/users/:id/stories', (ctx) => stories.ofUser(ctx.user, ctx.params.id));

// ---- stickers & GIFs ----
route('GET', '/api/stickers', (ctx) => stickers.list(ctx.user));
route('GET', '/api/stickers/search', (ctx) => stickers.search(ctx.user, qp(ctx, 'q')));
route('POST', '/api/stickers/packs', async (ctx) => {
  rateLimit(`packs:${ctx.user.id}`, 10, 60 * 60_000);
  return stickers.create(ctx.user, await body(ctx));
}, { status: 201 });
route('GET', '/api/stickers/packs/:ref', (ctx) => stickers.get(ctx.user, ctx.params.ref));
route('DELETE', '/api/stickers/packs/:id', (ctx) => stickers.removePack(ctx.user, ctx.params.id));
route('POST', '/api/stickers/packs/:id/stickers', async (ctx) => stickers.addSticker(ctx.user, ctx.params.id, await body(ctx)));
route('POST', '/api/stickers/packs/:ref/install', (ctx) => stickers.install(ctx.user, ctx.params.ref, true));
route('DELETE', '/api/stickers/packs/:ref/install', (ctx) => stickers.install(ctx.user, ctx.params.ref, false));
route('DELETE', '/api/stickers/:id', (ctx) => stickers.removeSticker(ctx.user, ctx.params.id));
route('GET', '/api/gifs', (ctx) => gifs.list(ctx.user));
route('POST', '/api/gifs', async (ctx) => gifs.save(ctx.user, await body(ctx)));
route('DELETE', '/api/gifs/:file', (ctx) => gifs.unsave(ctx.user, ctx.params.file));
route('GET', '/api/gifs/search', (ctx) => {
  rateLimit(`gifsearch:${ctx.user.id}`, 60, 60_000);
  return gifs.search(ctx.user, qp(ctx, 'q'));
});
route('GET', '/api/gifs/preview/:id', async (ctx) => { await gifs.preview(ctx.user, ctx.params.id, ctx.res); return undefined; }, { raw: true });
route('POST', '/api/gifs/remote', async (ctx) => {
  rateLimit(`gifremote:${ctx.user.id}`, 30, 60_000);
  return gifs.remote(ctx.user, await body(ctx));
});

// ---- stories ----
route('GET', '/api/stories', (ctx) => stories.feed(ctx.user));
route('POST', '/api/stories', async (ctx) => {
  rateLimit(`story:${ctx.user.id}`, 30, 60 * 60_000);
  return stories.create(ctx.user, await body(ctx));
}, { status: 201 });
route('DELETE', '/api/stories/:id', (ctx) => stories.remove(ctx.user, ctx.params.id));
route('PATCH', '/api/stories/:id', async (ctx) => stories.pin(ctx.user, ctx.params.id, await body(ctx)));
route('POST', '/api/stories/:id/view', (ctx) => stories.view(ctx.user, ctx.params.id));
route('POST', '/api/stories/:id/react', async (ctx) => stories.react(ctx.user, ctx.params.id, (await body(ctx)).emoji ?? null));
route('GET', '/api/stories/:id/views', (ctx) => stories.views(ctx.user, ctx.params.id));

// ---- live events over HTTP (fallback when WebSockets are blocked) ----
const live = require('./live');
route('POST', '/api/live', (ctx) => { rateLimit(`live:${ctx.user.id}`, 30, 60_000); return live.open(ctx.user, ctx.ip); });
route('GET', '/api/live/:sid', (ctx) => live.poll(ctx.user, ctx.params.sid, qp(ctx, 'ack')));
route('POST', '/api/live/:sid/send', async (ctx) => { rateLimit(`livesend:${ctx.user.id}`, 300, 60_000); return live.send(ctx.user, ctx.params.sid, await body(ctx)); });
route('DELETE', '/api/live/:sid', (ctx) => live.close(ctx.user, ctx.params.sid));

// ---- admin (ADMIN_USERNAMES) ----
route('POST', '/api/admin/verify', async (ctx) => official.verify(ctx.user, await body(ctx)));

// ---- scheduled messages ----
route('GET', '/api/chats/:id/scheduled', (ctx) => scheduled.list(ctx.user, ctx.params.id));
route('POST', '/api/chats/:id/scheduled', async (ctx) => {
  rateLimit(`schedule:${ctx.user.id}`, 30, 60_000);
  return scheduled.create(ctx.user, ctx.params.id, await body(ctx));
}, { status: 201 });
route('DELETE', '/api/scheduled/:id', (ctx) => scheduled.remove(ctx.user, ctx.params.id));
route('POST', '/api/scheduled/:id/send', (ctx) => scheduled.sendNow(ctx.user, ctx.params.id));

// ---- calls ----
route('GET', '/api/calls', (ctx) => calls.history(ctx.user));
route('GET', '/api/calls/config', () => ({ ice_servers: calls.iceServers() }));

// ---- chats ----
route('GET', '/api/chats', (ctx) => ({ chats: service.listChats(ctx.user.id) }));
route('POST', '/api/chats/private', async (ctx) => ({ chat: service.openPrivate(ctx.user, (await body(ctx)).username) }));
route('POST', '/api/chats/group', async (ctx) => {
  rateLimit(`create:${ctx.user.id}`, 20, 60 * 60_000);
  return { chat: service.createGroup(ctx.user, await body(ctx)) };
}, { status: 201 });
route('POST', '/api/chats/channel', async (ctx) => {
  rateLimit(`create:${ctx.user.id}`, 20, 60 * 60_000);
  return { chat: service.createChannel(ctx.user, await body(ctx)) };
}, { status: 201 });
route('GET', '/api/chats/:id', (ctx) => service.chatDetails(ctx.user, ctx.params.id));
route('PATCH', '/api/chats/:id', async (ctx) => ({ chat: service.updateChat(ctx.user, ctx.params.id, await body(ctx)) }));
route('DELETE', '/api/chats/:id', (ctx) => service.deleteChat(ctx.user, ctx.params.id));
route('POST', '/api/chats/:id/members', async (ctx) => ({ chat: service.addMembers(ctx.user, ctx.params.id, await body(ctx)) }));
route('DELETE', '/api/chats/:id/members/:uid', (ctx) => service.removeMember(ctx.user, ctx.params.id, ctx.params.uid));
route('PATCH', '/api/chats/:id/members/:uid', async (ctx) => service.setRole(ctx.user, ctx.params.id, ctx.params.uid, (await body(ctx)).role));
route('POST', '/api/chats/:id/leave', (ctx) => service.leaveChat(ctx.user, ctx.params.id));
route('POST', '/api/chats/:id/invite', async (ctx) => service.inviteLink(ctx.user, ctx.params.id, await body(ctx)));
route('PATCH', '/api/chats/:id/settings', async (ctx) => service.chatSettings(ctx.user, ctx.params.id, await body(ctx)));
route('POST', '/api/chats/:id/pin', async (ctx) => service.pinMessage(ctx.user, ctx.params.id, (await body(ctx)).message_id ?? null));
route('GET', '/api/chats/:id/messages', (ctx) =>
  service.history(ctx.user, ctx.params.id, { before: qp(ctx, 'before'), after: qp(ctx, 'after'), around: qp(ctx, 'around'), limit: qp(ctx, 'limit'), topic: qp(ctx, 'topic') }));
route('POST', '/api/chats/:id/messages', async (ctx) => {
  rateLimit(`send:${ctx.user.id}`, 30, 10_000);
  return { message: service.sendMessage(ctx.user, { ...(await body(ctx)), chat_id: ctx.params.id }) };
}, { status: 201 });
route('GET', '/api/chats/:id/search', (ctx) => service.searchInChat(ctx.user, ctx.params.id, qp(ctx, 'q')));
route('GET', '/api/chats/:id/media', (ctx) => service.chatMedia(ctx.user, ctx.params.id, qp(ctx, 'type'), qp(ctx, 'before')));
route('POST', '/api/chats/:id/read', async (ctx) => { const b = await body(ctx); return service.markRead(ctx.user, ctx.params.id, b.message_id, b.topic_id); });
route('GET', '/api/chats/:id/topics', (ctx) => topics.list(ctx.user, ctx.params.id));
route('POST', '/api/chats/:id/topics', async (ctx) => {
  rateLimit(`topic:${ctx.user.id}`, 30, 60 * 60_000);
  return topics.create(ctx.user, ctx.params.id, await body(ctx));
}, { status: 201 });
route('PATCH', '/api/topics/:id', async (ctx) => topics.update(ctx.user, ctx.params.id, await body(ctx)));
route('DELETE', '/api/topics/:id', (ctx) => topics.remove(ctx.user, ctx.params.id));

route('POST', '/api/join/preview', async (ctx) => service.joinPreview(ctx.user, await body(ctx)));
route('POST', '/api/join', async (ctx) => {
  rateLimit(`join:${ctx.user.id}`, 30, 60 * 60_000);
  return service.join(ctx.user, await body(ctx));
});

// ---- messages ----
route('POST', '/api/messages/forward', async (ctx) => {
  rateLimit(`send:${ctx.user.id}`, 30, 10_000);
  return service.forwardMessages(ctx.user, await body(ctx));
});
route('POST', '/api/messages/delete', async (ctx) => service.deleteMessages(ctx.user, (await body(ctx)).message_ids));
route('PATCH', '/api/messages/:id', async (ctx) => ({ message: service.editMessage(ctx.user, ctx.params.id, (await body(ctx)).text) }));
route('DELETE', '/api/messages/:id', (ctx) => service.deleteMessages(ctx.user, [ctx.params.id]));
route('POST', '/api/messages/:id/react', async (ctx) => {
  rateLimit(`react:${ctx.user.id}`, 60, 60_000);
  return { message: service.react(ctx.user, ctx.params.id, (await body(ctx)).emoji ?? null) };
});
route('POST', '/api/messages/:id/vote', async (ctx) => ({ message: service.vote(ctx.user, ctx.params.id, (await body(ctx)).option ?? null) }));

module.exports = { match };
