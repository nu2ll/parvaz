'use strict';
const os = require('node:os');
const path = require('node:path');

const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const env = process.env;

// Railway auto-detection: zero manual variables needed on Railway.
const onRailway = !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
const railwayVolume = env.RAILWAY_VOLUME_MOUNT_PATH; // set automatically when a Volume is attached
const railwayOrigins = [env.RAILWAY_PUBLIC_DOMAIN, env.RAILWAY_STATIC_URL]
  .filter(Boolean)
  .map((d) => (d.startsWith('http') ? d : `https://${d}`));

const dbPath =
  env.DB_PATH || (railwayVolume ? path.join(railwayVolume, 'chat.db') : path.join(__dirname, '..', 'data', 'chat.db'));

const uploadsDir =
  env.UPLOADS_DIR ||
  (dbPath === ':memory:'
    ? path.join(os.tmpdir(), `kabootar-uploads-${process.pid}`)
    : path.join(path.dirname(dbPath), 'uploads'));

module.exports = {
  onRailway,
  // users allowed to post in the official channel and to grant blue ticks, e.g. ADMIN_USERNAMES=Null,arown
  adminUsernames: list(env.ADMIN_USERNAMES).map((u) => u.replace(/^@/, '').toLowerCase()),
  officialChannel: env.OFFICIAL_CHANNEL !== '0',
  linkPreviews: env.LINK_PREVIEWS !== '0',
  hasPersistentVolume: !onRailway || !!railwayVolume || !!env.DB_PATH,
  port: Number(env.PORT) || 8080,
  host: env.HOST || '0.0.0.0',
  dbPath,
  uploadsDir,
  publicDir: path.join(__dirname, '..', 'public'),
  sessionTtlMs: (Number(env.SESSION_TTL_DAYS) || 60) * 24 * 60 * 60 * 1000,
  // e.g. ALLOWED_ORIGINS=https://chat.example.com  (empty = allow any origin). On Railway: auto.
  allowedOrigins: env.ALLOWED_ORIGINS ? list(env.ALLOWED_ORIGINS) : onRailway ? railwayOrigins : [],
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === '1' : onRailway,
  limits: {
    messageLength: 4096,
    groupMembers: 10000,
    wsFrameBytes: 1024 * 1024,
    httpBodyBytes: 256 * 1024,
    fileBytes: (Number(env.MAX_UPLOAD_MB) || 50) * 1024 * 1024,
  },
};
