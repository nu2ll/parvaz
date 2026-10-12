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
    frag.append(m[1] != null ? h('pre', {}, m[1].replace(/^\n|\n$/g, '')) : h('code', {}, m[2]));
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
const KIND_LABEL = { photo: '🖼 عکس', video: '🎬 ویدیو', voice: '🎤 پیام صوتی', audio: '🎵 فایل صوتی', file: '📎 فایل', poll: '📊 نظرسنجی' };
R.kindLabel = (m) => {
  if (m.kind === 'file' && m.media) return '📎 ' + m.media.name;
  if (m.kind === 'audio' && m.media) return '🎵 ' + m.media.name;
  if (m.kind === 'poll') return '📊 ' + (m.poll?.question || m.text);
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
    default: return 'رویداد';
  }
};
R.typingText = (chatId) => {
  const m = S.typing.get(chatId);
  if (!m) return '';
  const now = Date.now();
  const list = [...m.values()].filter((t) => t.until > now);
  if (!list.length) return '';
  const verb = { typing: 'در حال نوشتن', recording: 'در حال ضبط صدا', uploading: 'در حال ارسال فایل' }[list[0].action] || 'در حال نوشتن';
  const c = S.chats.get(chatId);
  if (c?.type === 'group') return list.length > 1 ? `${fa(list.length)} نفر ${verb}…` : `${list[0].name} ${verb}…`;
  return verb + '…';
};
R.chatStatus = (c) => {
  const typing = R.typingText(c.id);
  if (typing) return { text: typing, accent: true };
  if (isSaved(c)) return { text: '' };
  if (c.type === 'private') return { text: lastSeenText(c.peer), accent: c.peer.online };
  return { text: membersText(c) };
};
const nameColor = (id) => 'c' + (Math.abs(id) % 7);

/* ---------- chat list row ---------- */
R.chatItem = (c) => {
  const last = c.last_message;
  const draft = S.drafts[c.id];
  const typing = R.typingText(c.id);
  const preview = h('div', { class: 'preview', dir: 'auto' });
  if (typing) preview.append(h('span', { class: 'typing' }, typing));
  else if (draft && c.id !== S.active) preview.append(h('span', { class: 'draft' }, 'پیش‌نویس: '), R.stripMarkup(draft).slice(0, 80));
  else if (last) {
    if (last.kind !== 'service' && c.type === 'group') preview.append(h('b', {}, (last.sender.id === S.me.id ? 'شما' : last.sender.display_name.split(' ')[0]) + ': '));
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
          c.type === 'group' ? icon('group') : c.type === 'channel' ? icon('channel') : null,
          h('span', { class: 't', dir: 'auto' }, chatTitle(c)),
          c.muted ? icon('muted') : null),
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
  return h('span', { class: 'ticks', dataset: { id: m.id } }, icon(read ? 'checks' : 'check'));
};
R.meta = (c, m, overlay) =>
  h('span', { class: 'meta' + (overlay ? ' overlay' : '') },
    m.edited_at ? 'ویرایش‌شده' : null,
    m.views != null ? [fa(m.views), icon('eye', 'eye')] : null,
    fmtTime(m.created_at),
    R.ticks(c, m));

function waveBars(seed, n = 34) {
  const out = [];
  let x = seed || 7;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const v = 0.25 + ((x >> 8) % 1000) / 1000 * 0.75;
    out.push(h('i', { dataset: { h: v } }));
  }
  out.forEach((b) => (b.style.height = Math.round(Number(b.dataset.h) * 26) + 'px'));
  return out;
}

R.audioPlayer = (m) => {
  const voice = m.kind === 'voice';
  const audio = h('audio', { src: m.media.url, preload: 'metadata' });
  const playBtn = h('button', { class: 'play', type: 'button', 'aria-label': 'پخش' }, icon('play'));
  const bars = waveBars(hash(m.media.id));
  const wave = h('div', { class: 'wave' }, bars);
  const known = m.media.duration;
  const tm = h('div', { class: 'vt' }, voice ? fmtDur(known || 0) : fmtSize(m.media.size));
  const dur = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : known || 0);
  const paint = () => {
    const p = dur() ? audio.currentTime / dur() : 0;
    const on = Math.round(p * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    tm.textContent = audio.paused && !audio.currentTime ? (voice ? fmtDur(dur()) : fmtSize(m.media.size)) : `${fmtDur(audio.currentTime)} / ${fmtDur(dur())}`;
  };
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); R.stopOthers(audio); });
  audio.addEventListener('pause', () => playBtn.replaceChildren(icon('play')));
  audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); });
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.paused ? audio.play().catch(() => toast('پخش ممکن نشد')) : audio.pause(); });
  wave.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = wave.getBoundingClientRect();
    if (dur()) { audio.currentTime = ((e.clientX - r.left) / r.width) * dur(); if (audio.paused) audio.play().catch(() => {}); }
  });
  return h('div', { class: 'voice' + (voice ? '' : ' audio') }, playBtn,
    h('div', { class: 'vb' }, voice ? wave : h('div', { class: 'an', dir: 'auto' }, m.media.name), tm), audio);
};
R.stopOthers = (current) => $$('audio').forEach((a) => { if (a !== current && !a.paused) a.pause(); });

function boxSize(media, maxW = 420, maxH = 440) {
  let w = media.width || 320, hgt = media.height || 240;
  const k = Math.min(1, maxW / w, maxH / hgt);
  w = Math.max(120, Math.round(w * k));
  hgt = Math.max(80, Math.round(hgt * k));
  return [w, hgt];
}

R.media = (c, m) => {
  if (!m.media) return null;
  if (m.kind === 'photo') {
    const [w, ht] = boxSize(m.media, Math.min(420, innerWidth * 0.72));
    const box = h('div', { class: 'photo', onclick: (e) => { e.stopPropagation(); UI.lightbox(m); } },
      h('img', { src: m.media.url, alt: '', loading: 'lazy', draggable: 'false' }));
    box.style.width = w + 'px';
    box.style.aspectRatio = `${w} / ${ht}`;
    return box;
  }
  if (m.kind === 'video') {
    const v = h('video', { src: m.media.url, controls: true, preload: 'metadata', playsinline: true });
    const [w, ht] = boxSize(m.media, Math.min(420, innerWidth * 0.72));
    if (m.media.width) { v.style.width = w + 'px'; v.style.aspectRatio = `${w} / ${ht}`; }
    v.addEventListener('play', () => R.stopOthers(null));
    return h('div', { class: 'vid', onclick: (e) => e.stopPropagation() }, v);
  }
  if (m.kind === 'voice' || m.kind === 'audio') return R.audioPlayer(m);
  return h('div', { class: 'filecard' },
    h('a', { class: 'ficon', href: m.media.url, download: m.media.name, title: 'دانلود', onclick: (e) => e.stopPropagation() }, icon('download')),
    h('div', { class: 'fb' }, h('div', { class: 'fn', title: m.media.name }, m.media.name), h('div', { class: 'fs' }, fmtSize(m.media.size))));
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
      h('span', { class: 'e' }, r.emoji), r.count > 1 || true ? fa(r.count) : null)));
};

R.quote = (m) => {
  const r = m.reply;
  if (!r) return null;
  const label = r.deleted ? 'پیام حذف شده' : r.text ? R.stripMarkup(r.text) : (KIND_LABEL[r.kind] || 'پیام');
  return h('div', { class: 'quote', onclick: (e) => { e.stopPropagation(); if (!r.deleted) App.jumpTo(m.chat_id, r.id); } },
    r.thumb ? h('img', { src: r.thumb, alt: '' }) : null,
    h('div', { class: 'qb' }, h('div', { class: 'qn', dir: 'auto' }, r.deleted ? 'پیام' : r.sender_name || ''), h('div', { class: 'qt', dir: 'auto' }, label)));
};

// flags: { first, last, showAvatar }
R.message = (c, m, flags = {}) => {
  if (m.kind === 'service') {
    const a = m.service || {};
    return h('div', { class: 'service' + (a.action === 'pinned' ? ' clickable' : ''), dataset: { id: m.id },
      onclick: a.action === 'pinned' ? () => App.jumpTo(c.id, a.message_id) : null }, R.serviceText(m, c));
  }
  const mine = c.type !== 'channel' && m.sender.id === S.me.id;
  const isGroup = c.type === 'group';
  const mediaOnly = (m.kind === 'photo' || m.kind === 'video') && !m.text;
  const big = m.kind === 'text' && !m.reply && !m.forward && R.isBigEmoji(m.text);
  const bubble = h('div', { class: 'bubble' + (mediaOnly ? ' media-only' : '') + (big ? ' no-bg' : '') });

  if (isGroup && !mine && flags.first && !big) {
    bubble.append(h('div', { class: 'sender ' + nameColor(m.sender.id), dir: 'auto', onclick: (e) => { e.stopPropagation(); App.openByUsername(m.sender.username); } }, m.sender.display_name));
  }
  if (m.forward) bubble.append(h('div', { class: 'fwd' }, 'بازارسال از ', h('b', { dir: 'auto' }, m.forward.from_name)));
  const q = R.quote(m);
  if (q) bubble.append(q);
  const media = R.media(c, m);
  if (media) bubble.append(media);
  if (m.kind === 'poll') bubble.append(R.poll(c, m));

  const metaOverlay = mediaOnly && !m.reactions?.length;
  if (m.text && m.kind !== 'poll') {
    const t = h('div', { class: 'text' + (big ? ' big-emoji' : ''), dir: 'auto' }, R.text(m.text));
    t.append(R.meta(c, m));
    bubble.append(h('div', { class: 'text-wrap' }, t));
  } else if (metaOverlay) {
    bubble.append(R.meta(c, m, true));
  } else if (!m.reactions?.length) {
    bubble.append(h('div', { class: 'text-wrap' }, R.meta(c, m)));
  }
  const rx = R.reactions(m);
  if (rx) {
    if (!(m.text && m.kind !== 'poll')) rx.append(R.meta(c, m));
    if (mediaOnly) rx.style.margin = '6px 8px 6px';
    bubble.append(rx);
  }
  if (m.pending) {
    const prog = h('div', { class: 'up-progress' }, h('i'));
    bubble.append(prog, h('button', { class: 'cancel', type: 'button', onclick: () => App.cancelPending(m.localId) }, 'لغو ارسال'));
  }

  const avSlot = isGroup && !mine ? h('div', { class: 'av-slot' }, flags.last ? (() => {
    const a = userAvatar(m.sender, 's34');
    a.style.cursor = 'pointer';
    a.addEventListener('click', () => App.openByUsername(m.sender.username));
    return a;
  })() : null) : null;

  const el = h('div', {
    class: 'msg' + (mine ? ' mine' : '') + (flags.first ? ' first' : '') + (flags.last ? ' last' : '') + (m.pending ? ' pending' : ''),
    dataset: { id: m.id },
  }, avSlot, bubble);
  if (!m.pending) {
    el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('a, video, audio')) return;
      e.preventDefault();
      App.messageMenu(c, m, e);
    });
    UI.longPress(bubble, (e) => App.messageMenu(c, m, e));
    el.addEventListener('dblclick', (e) => { if (!e.target.closest('a, button, video, .photo') && c.can_post) { getSelection()?.removeAllRanges(); App.startReply(m); } });
  }
  return el;
};
