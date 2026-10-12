'use strict';
// File uploads (photos, videos, voice, documents) stored on disk next to the database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const repo = require('./db');
const { HttpError, sendJson } = require('./http-util');

fs.mkdirSync(config.uploadsDir, { recursive: true });

// Only these are ever served inline; everything else is forced to download.
const INLINE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/x-m4a',
]);
const isImage = (mime) => /^image\/(jpeg|png|gif|webp)$/.test(mime);
const isVideo = (mime) => /^video\/(mp4|webm|quicktime)$/.test(mime);
const isAudio = (mime) => INLINE.has(mime) && mime.startsWith('audio/');

function cleanMime(raw) {
  const m = String(raw || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(m) ? m : 'application/octet-stream';
}

function cleanName(raw) {
  let n = String(raw || '').replace(/[-\u001f\u007f/\\]/g, '').trim();
  if (!n) n = 'file';
  return n.slice(0, 120);
}

const fileUrl = (id) => (id ? `/files/${id}` : null);

function upload(user, req, url) {
  const len = Number(req.headers['content-length']);
  if (len && len > config.limits.fileBytes) {
    req.resume();
    throw new HttpError(413, 'file_too_large', `File too large (max ${config.limits.fileBytes / 1024 / 1024} MB)`);
  }
  const mime = cleanMime(req.headers['content-type']);
  const name = cleanName(url.searchParams.get('name'));
  const id = crypto.randomBytes(16).toString('hex');
  const tmp = path.join(config.uploadsDir, `.${id}.part`);
  const out = fs.createWriteStream(tmp, { flags: 'wx' });

  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(tmp, { force: true }, () => {});
      req.resume();
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.limits.fileBytes) fail(new HttpError(413, 'file_too_large', 'File too large'));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(400, 'aborted', 'Upload aborted')));
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (!size) return fail(new HttpError(400, 'empty_file', 'File is empty'));
      fs.rename(tmp, path.join(config.uploadsDir, id), (err) => {
        if (err) return fail(err);
        repo.insertFile(id, user.id, mime, size, name, Date.now());
        resolve({ file: { id, url: fileUrl(id), mime, size, name } });
      });
    });
    req.pipe(out);
  });
}

function serve(req, res, id) {
  const row = /^[a-f0-9]{32}$/.test(id) ? repo.fileById(id) : null;
  const file = row && path.join(config.uploadsDir, row.id);
  if (!row) return sendJson(res, 404, { error: { code: 'not_found', message: 'File not found' } });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: { code: 'not_found', message: 'File not found' } });
    const inline = INLINE.has(row.mime);
    const headers = {
      'Content-Type': inline ? row.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "default-src 'none'; media-src 'self'; img-src 'self'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      } else {
        start = Math.max(0, st.size - Number(range[2]));
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

// store an in-memory buffer (server-side downloads such as GIF search results)
function saveBuffer(ownerId, buf, mimeRaw, nameRaw) {
  const id = crypto.randomBytes(16).toString('hex');
  const mime = cleanMime(mimeRaw);
  const name = cleanName(nameRaw);
  fs.writeFileSync(path.join(config.uploadsDir, id), buf, { flag: 'wx' });
  repo.insertFile(id, ownerId, mime, buf.length, name, Date.now());
  return { id, url: fileUrl(id), mime, size: buf.length, name };
}

module.exports = { upload, serve, fileUrl, isImage, isVideo, isAudio, saveBuffer };
