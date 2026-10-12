'use strict';
// Saved GIFs + optional GIF search through Tenor (set TENOR_API_KEY). The server proxies everything,
// so the browser never talks to a third party (keeps the strict CSP and users' IPs private).
const repo = require('./db');
const v = require('./validate');
const files = require('./files');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const KEY = process.env.TENOR_API_KEY || '';
const ALLOWED_HOSTS = new Set(['media.tenor.com', 'media1.tenor.com', 'c.tenor.com']);
const cache = new Map(); // result id -> { mp4, preview, width, height, exp }
const MAX_GIF_BYTES = 12 * 1024 * 1024;

function list(user) {
  return {
    gifs: repo.savedGifs(user.id).map((g) => ({ file_id: g.file_id, url: files.fileUrl(g.file_id), mime: g.mime, ...repo.gifMeta(g.file_id) })),
  };
}

function save(user, body) {
  const f = repo.fileById(v.fileId(body.file_id));
  if (!f || (f.owner_id !== user.id && !repo.fileVisible(user.id, f.id))) throw err(404, 'file_not_found', 'File not found');
  if (f.mime !== 'image/gif' && !files.isVideo(f.mime)) throw v.bad('Only GIFs and short videos can be saved');
  repo.saveGif(user.id, f.id);
  return list(user);
}

function unsave(user, fileIdRaw) {
  repo.unsaveGif(user.id, v.fileId(fileIdRaw));
  return list(user);
}

async function search(user, qRaw) {
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';
  if (!KEY) return { enabled: false, results: [] };
  if (q.length > 64) throw v.bad('Query too long');
  const url = new URL(q ? 'https://tenor.googleapis.com/v2/search' : 'https://tenor.googleapis.com/v2/featured');
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('key', KEY);
  url.searchParams.set('client_key', 'kabootar');
  url.searchParams.set('limit', '30');
  url.searchParams.set('media_filter', 'mp4,tinygif');
  url.searchParams.set('contentfilter', 'medium');
  let data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    data = await r.json();
  } catch {
    throw err(502, 'gif_search_failed', 'GIF search is unavailable right now');
  }
  const exp = Date.now() + 60 * 60_000;
  const results = [];
  for (const it of data.results || []) {
    const mp4 = it.media_formats?.mp4;
    const prev = it.media_formats?.tinygif;
    if (!mp4?.url || !prev?.url) continue;
    const id = String(it.id).replace(/[^\w-]/g, '').slice(0, 40);
    cache.set(id, { mp4: mp4.url, preview: prev.url, width: mp4.dims?.[0], height: mp4.dims?.[1], exp });
    results.push({ id, width: mp4.dims?.[0] || 0, height: mp4.dims?.[1] || 0 });
  }
  for (const [k, c] of cache) if (c.exp < Date.now()) cache.delete(k);
  return { enabled: true, results };
}

async function download(urlStr, max) {
  const u = new URL(urlStr);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw err(400, 'bad_gif', 'Unsupported GIF source');
  const r = await fetch(u, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!r.ok) throw err(502, 'gif_download_failed', 'Could not fetch the GIF');
  const len = Number(r.headers.get('content-length') || 0);
  if (len > max) throw err(413, 'file_too_large', 'GIF too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > max) throw err(413, 'file_too_large', 'GIF too large');
  return { buf, mime: (r.headers.get('content-type') || '').split(';')[0] };
}

async function preview(user, idRaw, res) {
  const c = cache.get(String(idRaw));
  if (!c) throw err(404, 'not_found', 'Expired, search again');
  const { buf } = await download(c.preview, 2 * 1024 * 1024);
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600' });
  res.end(buf);
}

async function remote(user, body) {
  const c = cache.get(String(body.result_id || ''));
  if (!c) throw err(404, 'not_found', 'Expired, search again');
  const { buf } = await download(c.mp4, MAX_GIF_BYTES);
  const file = files.saveBuffer(user.id, buf, 'video/mp4', 'gif.mp4');
  return { file, meta: { width: c.width, height: c.height } };
}

module.exports = { list, save, unsave, search, preview, remote, enabled: () => !!KEY };
