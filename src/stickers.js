'use strict';
// Sticker packs: built-in packs shipped in public/stickers/<pack>/pack.json + user-made packs from uploaded images.
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./db');
const v = require('./validate');
const config = require('./config');
const { fileUrl } = require('./files');
const { HttpError } = require('./http-util');

const err = (status, code, message) => new HttpError(status, code, message);
const MAX_STICKERS = 120;
const STICKER_MIME = new Set(['image/png', 'image/webp', 'image/gif', 'image/jpeg']);
const SHORT_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

function seedBuiltin() {
  const dir = path.join(config.publicDir, 'stickers');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const manifest = path.join(dir, name, 'pack.json');
    if (!fs.existsSync(manifest)) continue;
    let def;
    try { def = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { continue; }
    let pack = repo.packByName(def.short_name);
    let fresh = false;
    if (!pack) {
      repo.insertPack(null, def.short_name, def.title, 1);
      pack = repo.packByName(def.short_name);
      fresh = true;
    }
    const have = new Set(repo.stickersOf(pack.id).map((s) => s.url));
    def.stickers.forEach((st, i) => {
      const url = `/stickers/${name}/${st.file}`;
      if (!have.has(url)) repo.insertSticker(pack.id, null, url, st.emoji || '', i);
    });
    if (fresh) repo.installForAll(pack.id);
  }
}

const stickerView = (s) => ({ id: s.id, pack_id: s.pack_id, emoji: s.emoji, url: s.url || fileUrl(s.file_id) });

function packView(pack, userId, withStickers = true) {
  const stickers = repo.stickersOf(pack.id).map(stickerView);
  return {
    id: pack.id,
    short_name: pack.short_name,
    title: pack.title,
    builtin: !!pack.builtin,
    mine: pack.owner_id === userId,
    installed: repo.isInstalled(userId, pack.id),
    count: stickers.length,
    thumb: stickers[0]?.url || null,
    stickers: withStickers ? stickers : undefined,
  };
}

function list(user) {
  return { packs: repo.installedPacks(user.id).map((p) => packView(p, user.id)) };
}

function findPack(ref) {
  const pack = /^\d+$/.test(String(ref)) ? repo.packById(Number(ref)) : repo.packByName(String(ref));
  if (!pack) throw err(404, 'pack_not_found', 'Sticker pack not found');
  return pack;
}

function get(user, ref) {
  return { pack: packView(findPack(ref), user.id) };
}

function search(user, qRaw) {
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';
  if (!q) return { packs: repo.builtinPacks().map((p) => packView(p, user.id, false)) };
  if (q.length > 64) throw v.bad('Query too long');
  return { packs: repo.searchPacks(q).map((p) => packView(p, user.id, false)) };
}

function create(user, body) {
  const title = v.line(body.title ?? '', 'title', 64);
  const shortName = typeof body.short_name === 'string' ? body.short_name.trim() : '';
  if (!SHORT_RE.test(shortName)) throw v.bad('Short name must be 4-32 chars (letters, digits, _) and start with a letter');
  if (repo.packByName(shortName)) throw err(409, 'pack_name_taken', 'This short name is already taken');
  const id = repo.insertPack(user.id, shortName, title, 0);
  repo.installPack(user.id, id);
  return { pack: packView(repo.packById(id), user.id) };
}

function requireOwnPack(user, idRaw) {
  const pack = repo.packById(v.id(idRaw, 'pack_id'));
  if (!pack) throw err(404, 'pack_not_found', 'Sticker pack not found');
  if (pack.owner_id !== user.id) throw err(403, 'forbidden', 'Only the pack owner can do this');
  return pack;
}

function addSticker(user, packIdRaw, body) {
  const pack = requireOwnPack(user, packIdRaw);
  const f = repo.fileById(v.fileId(body.file_id));
  if (!f || f.owner_id !== user.id) throw err(404, 'file_not_found', 'File not found');
  if (!STICKER_MIME.has(f.mime)) throw v.bad('Stickers must be PNG, WebP, GIF or JPEG images');
  const n = repo.stickerCount(pack.id);
  if (n >= MAX_STICKERS) throw v.bad(`A pack can have up to ${MAX_STICKERS} stickers`);
  const emoji = typeof body.emoji === 'string' ? body.emoji.trim().slice(0, 16) : '';
  repo.insertSticker(pack.id, f.id, null, emoji, n);
  return { pack: packView(repo.packById(pack.id), user.id) };
}

function removeSticker(user, stickerIdRaw) {
  const st = repo.stickerById(v.id(stickerIdRaw, 'sticker_id'));
  if (!st) throw err(404, 'sticker_not_found', 'Sticker not found');
  if (st.owner_id !== user.id) throw err(403, 'forbidden', 'Only the pack owner can do this');
  repo.deleteSticker(st.id);
  return { pack: packView(repo.packById(st.pack_id), user.id) };
}

function removePack(user, idRaw) {
  const pack = requireOwnPack(user, idRaw);
  repo.deletePack(pack.id);
  return { ok: true };
}

function install(user, ref, on) {
  const pack = findPack(ref);
  if (on) repo.installPack(user.id, pack.id);
  else repo.uninstallPack(user.id, pack.id);
  return { pack: packView(pack, user.id) };
}

module.exports = { seedBuiltin, list, get, search, create, addSticker, removeSticker, removePack, install };
