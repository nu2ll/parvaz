'use strict';
const service = require('./service');
const auth = require('./auth');
const hub = require('./hub');
const files = require('./files');
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
route('GET', '/api/config', () => ({ reactions: service.REACTIONS, max_upload_mb: require('./config').limits.fileBytes / 1048576 }), { public: true });

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
  service.history(ctx.user, ctx.params.id, { before: qp(ctx, 'before'), after: qp(ctx, 'after'), around: qp(ctx, 'around'), limit: qp(ctx, 'limit') }));
route('POST', '/api/chats/:id/messages', async (ctx) => {
  rateLimit(`send:${ctx.user.id}`, 30, 10_000);
  return { message: service.sendMessage(ctx.user, { ...(await body(ctx)), chat_id: ctx.params.id }) };
}, { status: 201 });
route('GET', '/api/chats/:id/search', (ctx) => service.searchInChat(ctx.user, ctx.params.id, qp(ctx, 'q')));
route('GET', '/api/chats/:id/media', (ctx) => service.chatMedia(ctx.user, ctx.params.id, qp(ctx, 'type'), qp(ctx, 'before')));
route('POST', '/api/chats/:id/read', async (ctx) => service.markRead(ctx.user, ctx.params.id, (await body(ctx)).message_id));

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
