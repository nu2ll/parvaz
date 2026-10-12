'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config');
const auth = require('./src/auth');
const routes = require('./src/routes');
const realtime = require('./src/realtime');
const files = require('./src/files');
const { HttpError, sendJson, clientIp } = require('./src/http-util');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
};

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw new HttpError(400, 'bad_path', 'Malformed URL');
  }
  const file = path.normalize(path.join(config.publicDir, rel));
  if (!file.startsWith(config.publicDir + path.sep)) throw new HttpError(404, 'not_found', 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function sendError(res, err) {
  if (res.headersSent) return res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: { code: err.code, message: err.message } });
  console.error('[http]', err);
  sendJson(res, 500, { error: { code: 'internal', message: 'Internal server error' } });
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const m = routes.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, 'not_found', 'Endpoint not found');
        const ctx = { req, res, url, params: m.params, ip: clientIp(req) };
        if (!m.route.public) ctx.user = auth.authenticate(req, ctx.ip);
        const result = await m.route.handler(ctx);
        return sendJson(res, m.route.status || 200, result ?? { ok: true });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
      const fm = /^\/files\/([^/]+)$/.exec(url.pathname);
      if (fm) return files.serve(req, res, fm[1]);
      serveStatic(req, res, url.pathname);
    } catch (err) {
      sendError(res, err);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    try {
      realtime.handleUpgrade(req, socket, head);
    } catch (err) {
      console.error('[upgrade]', err);
      socket.destroy();
    }
  });

  server.requestTimeout = 15 * 60_000; // big uploads on slow mobile links
  server.headersTimeout = 15_000;
  const stopHeartbeat = realtime.startHeartbeat();
  server.on('close', stopHeartbeat);
  return server;
}

function start(port = config.port, host = config.host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (require.main === module) {
  start()
    .then((server) => {
      const { port } = server.address();
      console.log(`🕊️  Kabootar is up on http://localhost:${port}`);
      console.log(`   database: ${config.dbPath}`);
      if (config.onRailway && !config.hasPersistentVolume) {
        console.warn('⚠️  No Railway Volume attached: chats will be wiped on every deploy. Add a Volume (any mount path).');
      }
      const shutdown = () => {
        console.log('shutting down...');
        server.close();
        require('./src/db').close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start:', err.message);
      process.exit(1);
    });
}

module.exports = { start, createServer };
