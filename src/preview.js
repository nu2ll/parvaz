'use strict';
// Link previews (Telegram "webpage" blocks): the server fetches the page's Open Graph tags and
// the preview image itself, so the browser never contacts third parties (strict CSP stays intact).
// Private / loopback / link-local addresses are refused to prevent SSRF.
const dns = require('node:dns').promises;
const net = require('node:net');
const repo = require('./db');
const config = require('./config');
const files = require('./files');

const MAX_HTML = 512 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const cache = new Map(); // url -> { at, data }
const URL_RE = /https?:\/\/[^\s<>"']+/i;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}

async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return null;
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) return null;
  return u;
}

// fetch with manual redirects, validating every hop
async function get(raw, max, accept) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await safeUrl(url);
    if (!u) return null;
    const r = await fetch(u, {
      redirect: 'manual', signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KabootarBot/1.0; +link-preview)', Accept: accept, 'Accept-Language': 'fa,en;q=0.8' },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), u).href; continue; }
    if (!r.ok || !r.body) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > max) { if (accept.startsWith('text')) break; return null; }
      chunks.push(chunk);
    }
    return { url: u.href, type, buf: Buffer.concat(chunks), headers: r.headers };
  }
  return null;
}

const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
}).replace(/\s+/g, ' ').trim();

function parse(html, base) {
  const head = html.slice(0, 200_000);
  const metas = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (/(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const val = (/content\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1];
    if (key && val != null && !(key.toLowerCase() in metas)) metas[key.toLowerCase()] = decode(val);
  }
  const title = metas['og:title'] || metas['twitter:title'] || decode((/<title[^>]*>([^<]{1,300})<\/title>/i.exec(head) || [])[1]);
  const description = metas['og:description'] || metas['twitter:description'] || metas.description || '';
  let image = metas['og:image'] || metas['og:image:url'] || metas['twitter:image'] || '';
  try { image = image ? new URL(image, base).href : ''; } catch { image = ''; }
  let site = metas['og:site_name'] || '';
  try { if (!site) site = new URL(base).hostname.replace(/^www\./, ''); } catch {}
  if (!title && !description) return null;
  return { site: site.slice(0, 64), title: title.slice(0, 200), description: description.slice(0, 400), image };
}

async function build(rawUrl, ownerId) {
  const hit = cache.get(rawUrl);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
  let data = null;
  try {
    const page = await get(rawUrl, MAX_HTML, 'text/html,application/xhtml+xml');
    if (page && /html|xml/.test(page.type)) {
      const p = parse(page.buf.toString('utf8'), page.url);
      if (p) {
        data = { url: rawUrl, site: p.site, title: p.title, description: p.description, image_file: null };
        if (p.image) {
          const img = await get(p.image, MAX_IMAGE, 'image/*').catch(() => null);
          if (img && files.isImage(img.type)) data.image_file = files.saveBuffer(ownerId, img.buf, img.type, 'preview').id;
        }
      }
    }
  } catch {}
  cache.set(rawUrl, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

// fire-and-forget: fill in the preview, then push message_updated to everyone in the chat
function attach(messageId, text, ownerId, isEdit) {
  if (!config.linkPreviews) return;
  const m = URL_RE.exec(text || '');
  const row = repo.rawMessage(messageId);
  let meta = {};
  try { meta = JSON.parse(row?.meta || '{}') || {}; } catch {}
  if (meta.no_preview) return;
  if (!m) {
    if (isEdit && meta.preview) { delete meta.preview; repo.setMeta(messageId, JSON.stringify(meta)); require('./service').emitMessage('message_updated', messageId); }
    return;
  }
  const url = m[0].replace(/[.,:;!?،؛)\]}"'»]+$/, '');
  if (meta.preview?.url === url) return;
  build(url, ownerId).then((data) => {
    const fresh = repo.rawMessage(messageId);
    if (!fresh) return;
    let cur = {};
    try { cur = JSON.parse(fresh.meta || '{}') || {}; } catch {}
    if (data) cur.preview = data; else delete cur.preview;
    repo.setMeta(messageId, Object.keys(cur).length ? JSON.stringify(cur) : null);
    if (data || isEdit) require('./service').emitMessage('message_updated', messageId);
  }).catch(() => {});
}

module.exports = { attach, _privateIp: privateIp, _parse: parse, _safeUrl: safeUrl };
