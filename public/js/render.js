'use strict';
/* Kabootar web client — rendering of messages, previews and chat list rows. Everything goes through textContent (XSS-safe). */

const R = {};

/* ---------- rich text: **bold** __italic__ ~~strike~~ ||spoiler|| `code` ```pre``` links @mentions #hashtags ---------- */
R.text = (text) => {
  const frag = document.createDocumentFragment();
  const re = /```([\s\S]+?)```|`([^`\n]+)`/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(R.inline(text.slice(last, m.index), 0));
    if (m[1] != null) {
      let body = m[1].replace(/\n$/, '');
      let lang = '';
      const lm = /^([a-zA-Z0-9+#_-]{1,20})\n/.exec(body);
      if (lm) { lang = lm[1]; body = body.slice(lm[0].length); } else body = body.replace(/^\n/, '');
      frag.append(h('pre', {}, h('div', { class: 'pre-head' }, h('span', {}, lang || 'کد'),
        h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); copyText(body); } }, icon('copy'))), h('code', {}, body)));
    } else frag.append(h('code', { onclick: (e) => { e.stopPropagation(); copyText(m[2]); } }, m[2]));
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(R.inline(text.slice(last), 0));
  return frag;
};
R.inline = (text, depth) => {
  const frag = document.createDocumentFragment();
  if (depth > 3) { frag.append(R.linkify(text)); return frag; }
  const re = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\|\|([\s\S]+?)\|\|/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(R.linkify(text.slice(last, m.index)));
    const inner = m[1] ?? m[2] ?? m[3] ?? m[4];
    let el;
    if (m[1] != null) el = h('b');
    else if (m[2] != null) el = h('i');
    else if (m[3] != null) el = h('s');
    else {
      el = h('span', { class: 'spoiler', title: 'نمایش', onclick: (e) => { e.stopPropagation(); el.classList.add('shown'); } });
      el.append(h('span', {}, R.inline(inner, depth + 1)));
      frag.append(el);
      last = re.lastIndex;
      continue;
    }
    el.append(R.inline(inner, depth + 1));
    frag.append(el);
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(R.linkify(text.slice(last)));
  return frag;
};
R.linkify = (text) => {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s]+)|(@[a-zA-Z][a-zA-Z0-9_]{3,31})|(#[\p{L}\p{N}_]{2,64})/gu;
  let last = 0, m;
  while ((m = re.exec(text))) {
    let token = m[0];
    if (m[1]) {
      const trail = /[.,:;!?،؛)\]}"'»]+$/.exec(token);
      if (trail) token = token.slice(0, -trail[0].length);
    }
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) {
      let href = null;
      try { const u = new URL(token); if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href; } catch {}
      frag.append(href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', dir: 'ltr', onclick: (e) => e.stopPropagation() }, token) : token);
    } else if (m[2]) {
      frag.append(h('span', { class: 'mention', dir: 'ltr', onclick: (e) => { e.stopPropagation(); App.openByUsername(token.slice(1)); } }, token));
    } else {
      frag.append(h('span', { class: 'hashtag', onclick: (e) => { e.stopPropagation(); App.searchInChat(token); } }, token));
    }
    last = m.index + token.length;
    re.lastIndex = last;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
};
R.stripMarkup = (t) => String(t || '').replace(/```([\s\S]+?)```|`([^`\n]+)`/g, '$1$2').replace(/\*\*|__|~~/g, '').replace(/\|\|([\s\S]+?)\|\|/g, '▒▒▒▒');
R.isBigEmoji = (t) => {
  if (!t || t.length > 24) return false;
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u.test(t)) return false;
  const n = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
  return n >= 1 && n <= 3 && !/^[\d#*\s]+$/.test(t);
};

/* ---------- labels ---------- */
const KIND_LABEL = { photo: '🖼 عکس', video: '🎬 ویدیو', voice: '🎤 پیام صوتی', audio: '🎵 فایل صوتی', file: '📎 فایل', poll: '📊 نظرسنجی',
  sticker: 'استیکر', gif: 'GIF', video_note: '📹 پیام ویدیویی', call: '📞 تماس', location: '📍 موقعیت مکانی', contact: '👤 مخاطب' };
R.callLabel = (m) => {
  const c = m.call || {};
  const out = m.sender.id === S.me?.id;
  const video = c.video ? 'تصویری' : 'صوتی';
  if (c.reason === 'ended') return out ? `تماس ${video} خروجی` : `تماس ${video} ورودی`;
  if (c.reason === 'declined') return out ? `تماس ${video} رد شد` : `تماس ${video} ردشده`;
  if (c.reason === 'busy') return 'تماس ناموفق (مشغول)';
  return out ? `تماس ${video} لغوشده` : `تماس ${video} ازدست‌رفته`;
};
R.kindLabel = (m) => {
  if (m.kind === 'file' && m.media) return '📎 ' + m.media.name;
  if (m.kind === 'audio' && m.media) return '🎵 ' + m.media.name;
  if (m.kind === 'poll') return '📊 ' + (m.poll?.question || m.text);
  if (m.kind === 'sticker') return (m.sticker?.emoji || '') + ' استیکر';
  if (m.kind === 'call') return '📞 ' + R.callLabel(m);
  if (m.kind === 'contact' && m.contact) return '👤 ' + (m.contact.name || 'مخاطب');
  if (m.media?.spoiler && (m.kind === 'photo' || m.kind === 'video')) return KIND_LABEL[m.kind] + ' (اسپویلر)';
  return KIND_LABEL[m.kind] || '';
};
R.previewText = (m) => {
  if (m.kind === 'service') return R.serviceText(m, S.chats.get(m.chat_id));
  const t = R.stripMarkup(m.text).replace(/\s+/g, ' ').trim();
  if (m.kind === 'text') return t;
  const label = R.kindLabel(m);
  return t && m.kind !== 'poll' ? `${label.split(' ')[0]} ${t}` : label;
};
R.serviceText = (m, chat) => {
  const a = m.service || {};
  const who = m.sender.id === S.me?.id ? 'شما' : m.sender.display_name;
  switch (a.action) {
    case 'created': return chat?.type === 'channel' ? 'کانال ساخته شد' : `${who} گروه «${a.title}» را ساخت`;
    case 'added': return `${who} ${(a.names || []).join('، ')} را اضافه کرد`;
    case 'removed': return `${who} ${a.name} را از گروه حذف کرد`;
    case 'joined': return `${who} با لینک دعوت به گروه پیوست`;
    case 'left': return `${who} گروه را ترک کرد`;
    case 'title': return `${who} نام گروه را به «${a.title}» تغییر داد`;
    case 'photo': return `${who} عکس گروه را عوض کرد`;
    case 'photo_removed': return `${who} عکس گروه را حذف کرد`;
    case 'pinned': return `${who} پیامی را سنجاق کرد: «${a.text ? R.stripMarkup(a.text) : (KIND_LABEL[a.kind] || 'پیام')}»`;
    case 'forum_on': return `${who} تاپیک‌ها را فعال کرد`;
    case 'forum_off': return `${who} تاپیک‌ها را غیرفعال کرد`;
    case 'topic_created': return `${who} تاپیک «${a.title}» را ساخت`;
    case 'topic_edited': return `${who} نام تاپیک را به «${a.title}» تغییر داد`;
    case 'topic_closed': return `${who} تاپیک را بست`;
    case 'topic_reopened': return `${who} تاپیک را دوباره باز کرد`;
    default: return 'رویداد';
  }
};
R.typingText = (chatId, topicId) => {
  const m = S.typing.get(chatId);
  if (!m) return '';
  const now = Date.now();
  const list = [...m.values()].filter((t) => t.until > now && (topicId == null || (t.topic || 0) === topicId));
  if (!list.length) return '';
  const verb = { typing: 'در حال نوشتن', recording: 'در حال ضبط صدا', uploading: 'در حال ارسال فایل', recording_round: 'در حال ضبط ویدیو', choosing_sticker: 'در حال انتخاب استیکر' }[list[0].action] || 'در حال نوشتن';
  const c = S.chats.get(chatId);
  if (c?.type === 'group') return list.length > 1 ? `${fa(list.length)} نفر ${verb}…` : `${list[0].name} ${verb}…`;
  return verb + '…';
};
R.chatStatus = (c, topicId) => {
  const typing = R.typingText(c.id, topicId);
  if (typing) return { text: typing, accent: true, typing: true };
  if (isSaved(c)) return { text: '' };
  if (c.type === 'private' && c.peer.system) return { text: 'اعلان‌های سرویس' };
  if (c.type === 'private') return { text: c.peer.blocked ? 'مسدود شده' : lastSeenText(c.peer), accent: c.peer.online };
  return { text: membersText(c) };
};
// Telegram's verified badge: blue rosette with a white check
R.verified = (cls = '') => {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'verified ' + cls);
  s.setAttribute('aria-label', 'تأییدشده');
  const a = document.createElementNS(SVGNS, 'path');
  a.setAttribute('class', 'vb-bg');
  a.setAttribute('d', 'M12 1.6l2.36 1.73 2.92-.08.9 2.78 2.38 1.7-.9 2.78.9 2.78-2.38 1.7-.9 2.78-2.92-.08L12 19.1l-2.36-1.73-2.92.08-.9-2.78-2.38-1.7.9-2.78-.9-2.78 2.38-1.7.9-2.78 2.92.08z');
  a.setAttribute('transform', 'translate(0 1.65)');
  const b = document.createElementNS(SVGNS, 'path');
  b.setAttribute('class', 'vb-check');
  b.setAttribute('d', 'M10.6 15.4l-3.3-3.3 1.4-1.4 1.9 1.9 4.7-4.7 1.4 1.4z');
  s.append(a, b);
  return s;
};
R.typingDots = () => h('span', { class: 'tdots' }, h('i'), h('i'), h('i'));
const nameColor = (id) => 'c' + (Math.abs(id) % 7);

/* ---------- chat list row ---------- */
// cached rows: rebuilt only when the chat (or its typing/draft/selection state) actually changed
R.rowCache = { main: new Map(), archive: new Map() };
R.chatItemCached = (c, ctx = 'main') => {
  const cache = R.rowCache[ctx];
  const sig = JSON.stringify(c) + '|' + (R.typingText(c.id) || '') + '|' + (S.drafts[c.id] || '') + '|' + (c.id === S.active) + '|' + (S.settings.time_format || '') + '|' + new Date().toDateString();
  const hit = cache.get(c.id);
  if (hit && hit.sig === sig) return hit.el;
  const el = R.chatItem(c);
  cache.set(c.id, { sig, el });
  return el;
};
R.chatItem = (c) => {
  const last = c.last_message;
  const draft = S.drafts[c.id];
  const typing = R.typingText(c.id);
  const preview = h('div', { class: 'preview', dir: 'auto' });
  if (typing) preview.append(h('span', { class: 'typing' }, typing.replace(/…$/, ''), R.typingDots()));
  else if (draft && c.id !== S.active) preview.append(h('span', { class: 'draft' }, 'پیش‌نویس: '), R.stripMarkup(draft).slice(0, 80));
  else if (last) {
    if (last.kind !== 'service' && c.type === 'group') preview.append(h('b', {}, (last.sender.id === S.me.id ? 'شما' : last.sender.display_name.split(' ')[0]) + ': '));
    const thumb = (last.kind === 'photo' || last.kind === 'video' || last.kind === 'gif') && last.media && !last.media.spoiler && last.kind === 'photo' ? h('img', { class: 'pthumb', src: last.media.url, alt: '' }) : null;
    if (last.kind === 'sticker' && last.sticker?.url) preview.append(h('img', { class: 'pthumb sticker', src: last.sticker.url, alt: '' }));
    if (thumb) preview.append(thumb);
    preview.append(R.previewText(last));
  } else preview.append(c.type === 'private' ? (isSaved(c) ? 'پیام‌ها را اینجا ذخیره کنید' : 'گفتگو را شروع کنید') : '');

  const timeEl = h('span', { class: 'time' });
  if (last && last.sender.id === S.me.id && last.kind !== 'service' && c.type !== 'channel' && !isSaved(c)) {
    timeEl.append(icon(c.others_read_id >= last.id ? 'checks' : 'check'));
  }
  timeEl.append(last ? fmtListTime(last.created_at) : '');

  const end = c.unread
    ? h('span', { class: 'badge' + (c.muted ? ' muted' : '') }, c.unread > 999 ? '+۹۹۹' : fa(c.unread))
    : c.pinned_at && !S.archived ? icon('pin', 'pin') : null;

  const el = h('div', { class: 'ci' + (c.id === S.active ? ' active' : ''), dataset: { id: c.id }, onclick: () => App.openChat(c.id) },
    chatAvatar(c),
    h('div', { class: 'body' },
      h('div', { class: 'row' },
        h('div', { class: 'title' },
          h('span', { class: 't', dir: 'auto' }, chatTitle(c)),
          c.verified ? R.verified() : null,
          c.muted ? icon('muted', 'mute-ic') : null),
        timeEl),
      h('div', { class: 'row' }, preview, end)));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); App.chatMenu(c, e); });
  UI.longPress(el, (e) => App.chatMenu(c, e));
  return el;
};

/* ---------- messages ---------- */
R.ticks = (c, m) => {
  if (m.sender.id !== S.me.id || c.type === 'channel' || isSaved(c) || m.pending) return null;
  const read = (c.others_read_id || 0) >= m.id;
  return h('span', { class: 'ticks' + (read ? ' read' : ''), dataset: { id: m.id } }, icon(read ? 'checks' : 'check'));
};
R.meta = (c, m, overlay) =>
  h('span', { class: 'meta' + (overlay ? ' overlay' : '') },
    m.edited_at ? h('span', { class: 'edited' }, 'ویرایش‌شده') : null,
    m.views != null ? [fa(m.views), icon('eye', 'eye')] : null,
    fmtTime(m.created_at),
    R.ticks(c, m));

const TAIL_PATH = 'M6 17H0V0c.193 2.84.876 5.767 2.05 8.782.904 2.325 2.446 4.485 4.625 6.48A1 1 0 016 17z';
R.tail = () => {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 11 20');
  s.setAttribute('class', 'tail');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', TAIL_PATH);
  s.append(p);
  return s;
};

function waveBars(seed, n = 34, wave) {
  const out = [];
  let x = seed || 7;
  for (let i = 0; i < n; i++) {
    let v;
    if (wave?.length) v = 0.15 + (wave[Math.floor((i / n) * wave.length)] / 31) * 0.85;
    else { x = (x * 1103515245 + 12345) & 0x7fffffff; v = 0.25 + ((x >> 8) % 1000) / 1000 * 0.75; }
    const b = h('i', { dataset: { h: v } });
    b.style.height = Math.max(3, Math.round(v * 23)) + 'px';
    out.push(b);
  }
  return out;
}

const SPEEDS = [1, 1.5, 2];
R.audioPlayer = (m) => {
  const voice = m.kind === 'voice';
  const audio = h('audio', { src: m.media.url, preload: 'metadata' });
  const playBtn = h('button', { class: 'play', type: 'button', 'aria-label': 'پخش' }, icon('play'));
  const bars = waveBars(hash(m.media.id), 34, m.media.waveform);
  const wave = h('div', { class: 'wave' }, bars);
  const known = m.media.duration;
  const tm = h('div', { class: 'vt' }, voice ? fmtDur(known || 0) : fmtSize(m.media.size));
  const dur = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : known || 0);
  const speedBtn = voice ? h('button', { class: 'speed', type: 'button', onclick: (e) => {
    e.stopPropagation();
    const i = (SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length;
    audio.playbackRate = SPEEDS[i];
    speedBtn.textContent = fa(SPEEDS[i]) + '×';
    speedBtn.classList.toggle('on', SPEEDS[i] !== 1);
  } }, '۱×') : null;
  const paint = () => {
    const p = dur() ? audio.currentTime / dur() : 0;
    const on = Math.round(p * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    tm.textContent = audio.paused && !audio.currentTime ? (voice ? fmtDur(dur()) : fmtSize(m.media.size)) : `${fmtDur(audio.currentTime)} / ${fmtDur(dur())}`;
  };
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); R.stopOthers(audio); if (typeof Player !== 'undefined') Player.attach(audio, m); });
  audio.addEventListener('pause', () => playBtn.replaceChildren(icon('play')));
  audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); if (typeof Player !== 'undefined') Player.ended(audio, m); });
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.paused ? audio.play().catch(() => toast('پخش ممکن نشد')) : audio.pause(); });
  wave.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = wave.getBoundingClientRect();
    if (dur()) { audio.currentTime = ((r.right - e.clientX) / r.width) * dur(); if (audio.paused) audio.play().catch(() => {}); }
  });
  const box = h('div', { class: 'voice' + (voice ? '' : ' audio'), dataset: { mid: m.id } }, playBtn,
    h('div', { class: 'vb' }, voice ? wave : h('div', { class: 'an', dir: 'auto' }, m.media.name.replace(/\.[^.]+$/, '')), h('div', { class: 'vrow' }, tm, speedBtn)), audio);
  box.audio = audio;
  return box;
};
R.stopOthers = (current) => $$('audio, video.round-v').forEach((a) => { if (a !== current && !a.paused && !a.muted) a.pause(); });

function boxSize(media, maxW = 420, maxH = 440) {
  let w = media.width || 320, hgt = media.height || 240;
  const k = Math.min(1, maxW / w, maxH / hgt);
  w = Math.max(140, Math.round(w * k));
  hgt = Math.max(90, Math.round(hgt * k));
  return [w, hgt];
}
const maxMediaW = () => Math.min(420, innerWidth * 0.72);

R.spoilerWrap = (node, m) => {
  if (!m.media?.spoiler) return node;
  node.classList.add('is-spoiler');
  const cover = h('div', { class: 'spoiler-cover' }, h('span', {}, 'نمایش اسپویلر'));
  node.append(cover);
  node.addEventListener('click', (e) => {
    if (!node.classList.contains('is-spoiler')) return;
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    node.classList.remove('is-spoiler');
    cover.remove();
  }, true);
  return node;
};

R.visual = (c, m, w, ht) => {
  // photo / video / gif as a tile (used alone and inside albums)
  const open = (e) => { e.stopPropagation(); if (S.select) return App.toggleSelect(m); UI.lightbox(m); };
  let box;
  if (m.kind === 'photo') {
    box = h('div', { class: 'photo', onclick: open }, h('img', { src: m.media.url, alt: '', loading: 'lazy', draggable: 'false' }));
  } else if (m.kind === 'gif') {
    const isImg = m.media.mime === 'image/gif';
    const auto = S.settings.autoplay_gif !== false;
    const media = isImg ? h('img', { src: m.media.url, alt: '', loading: 'lazy', draggable: 'false' })
      : h('video', { src: m.media.url, muted: true, loop: true, playsinline: true, autoplay: auto, preload: 'auto' });
    if (!isImg) media.muted = true;
    box = h('div', { class: 'photo gif', onclick: (e) => {
      e.stopPropagation();
      if (S.select) return App.toggleSelect(m);
      if (!isImg && media.paused) { media.play().catch(() => {}); return; }
      UI.lightbox(m);
    } }, media, h('span', { class: 'badge-gif' }, 'GIF'));
  } else {
    const auto = S.settings.autoplay_video !== false && (m.media.size || 0) < 12 * 1048576;
    const v = h('video', { src: m.media.url, muted: true, playsinline: true, preload: 'metadata', loop: auto, autoplay: auto });
    v.muted = true;
    box = h('div', { class: 'photo vid', onclick: open }, v,
      h('span', { class: 'vdur' }, fmtDur(m.media.duration || 0)),
      h('span', { class: 'vplay' }, icon('play')));
  }
  if (w) { box.style.width = w + 'px'; box.style.height = ht + 'px'; }
  return R.spoilerWrap(box, m);
};

R.media = (c, m) => {
  if (m.kind === 'sticker') {
    const img = h('img', { src: m.sticker?.url || '', alt: m.sticker?.emoji || '', draggable: 'false', loading: 'lazy' });
    return h('div', { class: 'sticker-box', title: m.sticker?.emoji || '', onclick: (e) => { e.stopPropagation(); if (S.select) return App.toggleSelect(m); App.stickerPackOf(m); } }, img);
  }
  if (m.kind === 'call') return R.callCard(c, m);
  if (m.kind === 'location' && m.location) return R.locationCard(m);
  if (m.kind === 'contact' && m.contact) return R.contactCard(m);
  if (!m.media) return null;
  if (m.kind === 'photo' || m.kind === 'video' || m.kind === 'gif') {
    const [w, ht] = boxSize(m.media, maxMediaW());
    return R.visual(c, m, w, ht);
  }
  if (m.kind === 'video_note') return R.round(m);
  if (m.kind === 'voice' || m.kind === 'audio') return R.audioPlayer(m);
  const ext = (m.media.name.split('.').pop() || '').slice(0, 4).toUpperCase();
  return h('div', { class: 'filecard' },
    h('a', { class: 'ficon e' + (hash(ext) % 5), href: m.media.url, download: m.media.name, title: 'دانلود', onclick: (e) => e.stopPropagation() }, h('span', { class: 'ext' }, ext), icon('download')),
    h('div', { class: 'fb' }, h('div', { class: 'fn', title: m.media.name }, m.media.name), h('div', { class: 'fs' }, fmtSize(m.media.size))));
};

R.round = (m) => {
  const v = h('video', { class: 'round-v', src: m.media.url, muted: true, loop: true, playsinline: true, autoplay: S.settings.autoplay_video !== false, preload: 'metadata' });
  v.muted = true;
  const ring = document.createElementNS(SVGNS, 'svg');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.setAttribute('class', 'round-ring');
  const circ = document.createElementNS(SVGNS, 'circle');
  circ.setAttribute('cx', '50'); circ.setAttribute('cy', '50'); circ.setAttribute('r', '48');
  ring.append(circ);
  const tm = h('span', { class: 'vdur' }, fmtDur(m.media.duration || 0));
  const muteIc = h('span', { class: 'round-mute' }, icon('muted'));
  const box = h('div', { class: 'round', onclick: (e) => {
    e.stopPropagation();
    if (S.select) return App.toggleSelect(m);
    if (v.muted) { R.stopOthers(v); v.muted = false; v.loop = false; v.currentTime = 0; v.play().catch(() => {}); box.classList.add('playing'); }
    else if (v.paused) v.play().catch(() => {});
    else v.pause();
  } }, v, ring, tm, muteIc);
  v.addEventListener('timeupdate', () => {
    if (v.muted) return;
    const d = Number.isFinite(v.duration) ? v.duration : m.media.duration || 1;
    circ.style.strokeDashoffset = String(301.6 * (1 - v.currentTime / d));
    tm.textContent = fmtDur(d - v.currentTime);
  });
  v.addEventListener('ended', () => { v.muted = true; v.loop = true; box.classList.remove('playing'); circ.style.strokeDashoffset = '301.6'; tm.textContent = fmtDur(m.media.duration || 0); v.play().catch(() => {}); });
  return box;
};

R.callCard = (c, m) => {
  const cl = m.call || {};
  const out = m.sender.id === S.me.id;
  const bad = cl.reason !== 'ended';
  return h('div', { class: 'call-card' + (bad ? ' missed' : '') },
    h('div', { class: 'cb' },
      h('div', { class: 'ct' }, R.callLabel(m)),
      h('div', { class: 'cs' }, icon(out ? 'callOut' : 'callIn', 'arrow'), fmtTime(m.created_at), cl.duration ? ' · ' + fmtDur(cl.duration) : '')),
    h('button', { class: 'ibtn accent', type: 'button', title: 'تماس دوباره', onclick: (e) => { e.stopPropagation(); App.startCall(c, !!cl.video); } }, icon(cl.video ? 'video' : 'phone')));
};

R.poll = (c, m) => {
  const p = m.poll;
  if (!p) return null;
  const voted = p.my_vote != null;
  const max = Math.max(1, ...p.options.map((o) => o.votes));
  const opts = p.options.map((o, i) => {
    const pct = p.total ? Math.round((o.votes / p.total) * 100) : 0;
    const row = h('div', { class: 'popt', onclick: (e) => { e.stopPropagation(); if (!voted) App.vote(m, i); } },
      voted ? h('span', { class: 'pct' }, fa(pct) + '٪') : h('span', { class: 'rad' }),
      h('span', { class: 'ot', dir: 'auto' }, o.text),
      voted ? h('span', { class: 'bar' }) : null,
      voted && p.my_vote === i ? h('span', { class: 'ck' }, icon('check')) : null);
    if (voted) row.querySelector('.bar').style.width = `calc((100% - 48px) * ${o.votes / max})`;
    return row;
  });
  return h('div', { class: 'poll' },
    h('div', { class: 'q', dir: 'auto' }, p.question),
    h('div', { class: 'pt' }, 'نظرسنجی ناشناس'),
    opts,
    h('div', { class: 'pf' },
      h('span', {}, p.total ? `${fa(p.total)} رأی` : 'هنوز رأیی نیامده'),
      voted ? h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); App.vote(m, null); } }, 'پس گرفتن رأی') : null));
};

R.reactions = (m) => {
  if (!m.reactions?.length) return null;
  return h('div', { class: 'reactions' }, m.reactions.map((r) =>
    h('button', { type: 'button', class: 'react' + (r.mine ? ' mine' : ''), onclick: (e) => { e.stopPropagation(); App.react(m, r.emoji); } },
      h('span', { class: 'e' }, r.emoji), fa(r.count))));
};

R.webpage = (m) => {
  const p = m.preview;
  const big = p.image && !p.description;
  return h('a', { class: 'webpage' + (big ? ' big' : ''), href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'wp-body' },
      p.site ? h('div', { class: 'wp-site', dir: 'auto' }, p.site) : null,
      p.title ? h('div', { class: 'wp-title', dir: 'auto' }, p.title) : null,
      p.description ? h('div', { class: 'wp-desc', dir: 'auto' }, p.description) : null),
    p.image ? h('img', { class: 'wp-img', src: p.image, alt: '', loading: 'lazy' }) : null);
};

R.quote = (m) => {
  const r = m.reply;
  if (!r) return null;
  const label = r.deleted ? 'پیام حذف شده' : r.text ? R.stripMarkup(r.text) : (KIND_LABEL[r.kind] || 'پیام');
  return h('div', { class: 'quote ' + (r.sender_name ? nameColor(hash(r.sender_name)) : ''), onclick: (e) => { e.stopPropagation(); if (!r.deleted) App.jumpTo(m.chat_id, r.id); } },
    r.thumb ? h('img', { src: r.thumb, alt: '' }) : null,
    h('div', { class: 'qb' }, h('div', { class: 'qn', dir: 'auto' }, r.deleted ? 'پیام' : r.sender_name || ''), h('div', { class: 'qt', dir: 'auto' }, label)));
};
R.storyQuote = (m) => {
  const st = m.story;
  if (!st) return null;
  return h('div', { class: 'quote story-q', onclick: (e) => { e.stopPropagation(); if (!st.deleted && !st.expired) App.openStoriesOf(st.user_id, st.id); } },
    !st.deleted && st.kind === 'photo' ? h('img', { src: st.url, alt: '' }) : h('span', { class: 'sq-ic' }, icon('story')),
    h('div', { class: 'qb' }, h('div', { class: 'qn' }, 'استوری'), h('div', { class: 'qt' }, st.deleted ? 'استوری حذف شده' : st.expired ? 'استوری منقضی شده' : 'پاسخ به استوری')));
};

// album layout: rows of 1-3 tiles whose widths follow aspect ratios (Telegram-like mosaic)
const ALBUM_ROWS = { 1: [1], 2: [2], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [2, 3, 3], 9: [3, 3, 3], 10: [2, 2, 3, 3] };
R.albumGrid = (c, list) => {
  const W = Math.min(400, maxMediaW());
  const rows = ALBUM_ROWS[Math.min(list.length, 10)] || [3];
  const grid = h('div', { class: 'album' });
  grid.style.width = W + 'px';
  let i = 0;
  for (const n of rows) {
    const items = list.slice(i, i + n);
    i += n;
    const ar = items.map((m) => Math.max(0.5, Math.min(2.2, (m.media.width || 4) / (m.media.height || 3))));
    const sum = ar.reduce((a, b) => a + b, 0);
    const gap = 2 * (items.length - 1);
    const rowH = Math.max(70, Math.min(260, (W - gap) / sum));
    const row = h('div', { class: 'arow' });
    items.forEach((m, k) => {
      const tw = Math.floor(((W - gap) * ar[k]) / sum);
      const t = R.visual(c, m, tw, Math.round(rowH));
      t.dataset.id = m.id;
      if (S.select) t.classList.toggle('sel', S.select.has(m.id));
      row.append(t);
    });
    grid.append(row);
  }
  return grid;
};

R.isMineSide = (c, m) => c.type !== 'channel' && m.sender.id === S.me.id;

// flags: { first, last }; for albums pass group = [messages]
R.message = (c, m, flags = {}) => {
  if (m.kind === 'service') {
    const a = m.service || {};
    return h('div', { class: 'service' + (a.action === 'pinned' ? ' clickable' : ''), dataset: { id: m.id },
      onclick: a.action === 'pinned' ? () => App.jumpTo(c.id, a.message_id) : null }, h('span', {}, R.serviceText(m, c)));
  }
  const group = flags.group && flags.group.length > 1 ? flags.group : null;
  const capMsg = group ? group.find((x) => x.text) || null : null;
  const textMsg = group ? capMsg : m;
  const mine = R.isMineSide(c, m);
  const isGroup = c.type === 'group';
  const visual = (k) => k === 'photo' || k === 'video' || k === 'gif';
  const mediaOnly = (group || visual(m.kind)) && !(textMsg && textMsg.text) && !m.reply && !m.forward;
  const big = m.kind === 'text' && !m.reply && !m.forward && S.settings.large_emoji !== false && R.isBigEmoji(m.text);
  const sticker = m.kind === 'sticker' || m.kind === 'video_note';
  const noBg = big || sticker;
  const bubble = h('div', { class: 'bubble' + (mediaOnly ? ' media-only' : '') + (noBg ? ' no-bg' : '') + (sticker ? ' ' + m.kind : '') + (group ? ' is-album' : '') });

  if (isGroup && !mine && flags.first && !noBg) {
    bubble.append(h('div', { class: 'sender ' + nameColor(m.sender.id), dir: 'auto', onclick: (e) => { e.stopPropagation(); App.openUser(m.sender.id); } }, m.sender.display_name));
  }
  if (m.forward) {
    const f = m.forward;
    bubble.append(h('div', { class: 'fwd' }, 'بازارسال از ', h('b', { dir: 'auto', class: f.from_user_id ? 'link' : '', onclick: f.from_user_id ? (e) => { e.stopPropagation(); App.openUser(f.from_user_id); } : null }, f.from_name)));
  }
  const q = R.quote(m) || R.storyQuote(m);
  if (q) bubble.append(q);
  if (group) bubble.append(R.albumGrid(c, group));
  else {
    const media = R.media(c, m);
    if (media) bubble.append(media);
  }
  if (m.kind === 'poll') bubble.append(R.poll(c, m));
  const webpage = m.preview && !group ? R.webpage(m) : null;

  const metaMsg = group ? group.at(-1) : m;
  const reactMsg = group ? group.find((x) => x.reactions?.length) || m : m;
  const metaOverlay = (mediaOnly || sticker) && !reactMsg.reactions?.length;
  const text = textMsg ? textMsg.text : '';
  if (text && m.kind !== 'poll') {
    const t = h('div', { class: 'text' + (big ? ' big-emoji e' + Math.min(3, [...text.matchAll(/\p{Extended_Pictographic}/gu)].length) : ''), dir: 'auto' }, R.text(text));
    if (webpage) {
      bubble.append(h('div', { class: 'text-wrap' }, t), webpage, h('div', { class: 'text-wrap' }, R.meta(c, metaMsg)));
    } else {
      t.append(R.meta(c, metaMsg));
      bubble.append(h('div', { class: 'text-wrap' }, t));
    }
  } else if (metaOverlay) {
    bubble.append(R.meta(c, metaMsg, true));
  } else if (!reactMsg.reactions?.length) {
    bubble.append(h('div', { class: 'text-wrap' }, R.meta(c, metaMsg)));
  }
  const rx = R.reactions(reactMsg);
  if (rx) {
    if (!(text && m.kind !== 'poll')) rx.append(R.meta(c, metaMsg));
    bubble.append(rx);
  }
  if (m.pending) {
    const prog = h('div', { class: 'up-progress' }, h('i'));
    bubble.append(prog, h('button', { class: 'cancel', type: 'button', onclick: () => App.cancelPending(m.localId) }, 'لغو ارسال'));
  }
  if (flags.last && !noBg && !mediaOnly) bubble.append(R.tail());

  const avSlot = isGroup && !mine ? h('div', { class: 'av-slot' }, flags.last ? (() => {
    const a = userAvatar(m.sender, 's34');
    a.addEventListener('click', () => App.openUser(m.sender.id));
    return a;
  })() : null) : null;

  const ids = group ? group.map((x) => x.id) : [m.id];
  const selected = S.select && ids.every((id) => S.select.has(id));
  const el = h('div', {
    class: 'msg' + (mine ? ' mine' : '') + (flags.first ? ' first' : '') + (flags.last ? ' last' : '') + (m.pending ? ' pending' : '') + (selected ? ' selected' : '') + (noBg ? ' nobg' : ''),
    dataset: { id: m.id },
  }, S.select ? h('span', { class: 'sel-box' }, icon('check')) : null, avSlot, bubble);
  if (!m.pending) {
    el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('a, audio')) return;
      e.preventDefault();
      if (S.select) return;
      App.messageMenu(c, m, e, group);
    });
    if (!(App.androidTaps && App.androidTaps(el, bubble, c, m, group))) UI.longPress(bubble, (e) => App.messageMenu(c, m, e, group));
    if (c.can_post) UI.swipeReply(el, bubble, () => App.startReply(m));
    el.addEventListener('click', (e) => { if (S.select && !e.target.closest('.album .photo')) { e.preventDefault(); App.toggleSelect(m, group); } });
    el.addEventListener('dblclick', (e) => { if (S.select || (typeof touchUI === 'function' && touchUI())) return; if (!e.target.closest('a, button, video, .photo') && c.can_post) { getSelection()?.removeAllRanges(); App.startReply(m); } });
  }
  return el;
};

/* ---------- location + contact messages ---------- */
// OpenStreetMap tiles: 2×2 around the point so it always sits in the middle of the box
R.mapTiles = (lat, lng, W, H, z = 15) => {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(x) - (x % 1 < 0.5 ? 1 : 0), ty = Math.floor(y) - (y % 1 < 0.5 ? 1 : 0);
  const px = (x - tx) * 256, py = (y - ty) * 256;
  const tiles = h('div', { class: 'map-tiles', style: `left:${Math.round(W / 2 - px)}px;top:${Math.round(H / 2 - py)}px` });
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const X = (((tx + i) % n) + n) % n, Y = ty + j;
    tiles.append(h('img', { src: `https://tile.openstreetmap.org/${z}/${X}/${Y}.png`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', style: `left:${i * 256}px;top:${j * 256}px`, referrerpolicy: 'no-referrer' }));
  }
  return h('div', { class: 'map-box', style: `width:${W}px;height:${H}px` }, tiles, h('span', { class: 'map-pin' }, icon('place')));
};
R.locationCard = (m) => {
  const { lat, lng } = m.location;
  const W = Math.min(300, maxMediaW()), H = 160;
  const open = (e) => {
    e.stopPropagation();
    if (S.select) return App.toggleSelect(m);
    const url = typeof Native !== 'undefined' && Native.ok ? `geo:${lat},${lng}?q=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, '_blank', 'noopener');
  };
  return h('div', { class: 'loc-card', onclick: open, role: 'button', title: 'باز کردن در نقشه' }, R.mapTiles(lat, lng, W, H),
    m.location.title ? h('div', { class: 'loc-title' }, m.location.title) : null);
};
R.contactCard = (m) => {
  const u = { id: m.contact.user_id, display_name: m.contact.name || 'مخاطب', username: m.contact.username || '', avatar: m.contact.avatar };
  const mine = S.me && u.id === S.me.id;
  return h('div', { class: 'contact-card' },
    h('div', { class: 'cc-top' }, userAvatar(u), h('div', { class: 'cc-tx' }, h('b', {}, u.display_name), u.username ? h('small', {}, '@' + u.username) : null)),
    mine || !u.username ? null : h('button', { class: 'cc-btn', type: 'button', onclick: (e) => { e.stopPropagation(); if (S.select) return App.toggleSelect(m); App.openPrivateWith(u.username); } }, 'ارسال پیام'));
};
