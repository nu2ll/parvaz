'use strict';
const service = require('./service');
const auth = require('./auth');
const hub = require('./hub');
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

// ---- public ----
route('GET', '/api/health', () => ({ ok: true, time: Date.now() }), { public: true });

route('POST', '/api/auth/register', async (ctx) => {
  rateLimit(`register:${ctx.ip}`, 10, 10 * 60_000);
  return service.register(await body(ctx));
}, { public: true, status: 201 });

route('POST', '/api/auth/login', async (ctx) => {
  rateLimit(`login:${ctx.ip}`, 20, 60_000);
  const b = await body(ctx);
  if (typeof b.username === 'string') rateLimit(`login-user:${b.username.toLowerCase().slice(0, 64)}`, 10, 5 * 60_000);
  return service.login(b);
}, { public: true });

// ---- authenticated ----
route('POST', '/api/auth/logout', (ctx) => {
  auth.revoke(ctx.user.token_hash);
  hub.closeSession(ctx.user.token_hash);
  return { ok: true };
});

route('GET', '/api/me', (ctx) => ({ user: service.publicUser(ctx.user) }));
route('PATCH', '/api/me', async (ctx) => ({ user: service.updateProfile(ctx.user, await body(ctx)) }));

route('GET', '/api/users/search', (ctx) => {
  rateLimit(`search:${ctx.user.id}`, 60, 60_000);
  return { users: service.searchUsers(ctx.user, ctx.url.searchParams.get('q')) };
});

route('GET', '/api/chats', (ctx) => ({ chats: service.listChats(ctx.user.id) }));
route('POST', '/api/chats/private', async (ctx) => ({ chat: service.openPrivate(ctx.user, (await body(ctx)).username) }));
route('POST', '/api/chats/group', async (ctx) => {
  rateLimit(`group:${ctx.user.id}`, 20, 60 * 60_000);
  const b = await body(ctx);
  return { chat: service.createGroup(ctx.user, b.title, b.usernames) };
}, { status: 201 });
route('GET', '/api/chats/:id', (ctx) => service.chatDetails(ctx.user, ctx.params.id));
route('POST', '/api/chats/:id/members', async (ctx) => ({ chat: service.addMember(ctx.user, ctx.params.id, (await body(ctx)).username) }));
route('POST', '/api/chats/:id/leave', (ctx) => service.leaveChat(ctx.user, ctx.params.id));
route('GET', '/api/chats/:id/messages', (ctx) =>
  service.history(ctx.user, ctx.params.id, ctx.url.searchParams.get('before'), ctx.url.searchParams.get('limit')));
route('POST', '/api/chats/:id/messages', async (ctx) => {
  rateLimit(`send:${ctx.user.id}`, 30, 10_000);
  const b = await body(ctx);
  return { message: service.sendMessage(ctx.user, ctx.params.id, b.text, b.reply_to) };
}, { status: 201 });
route('POST', '/api/chats/:id/read', async (ctx) => service.markRead(ctx.user, ctx.params.id, (await body(ctx)).message_id));
route('PATCH', '/api/messages/:id', async (ctx) => ({ message: service.editMessage(ctx.user, ctx.params.id, (await body(ctx)).text) }));
route('DELETE', '/api/messages/:id', (ctx) => ({ message: service.deleteMessage(ctx.user, ctx.params.id) }));

module.exports = { match };
