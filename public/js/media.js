'use strict';
/* Kabootar — media: emoji/sticker/GIF dropdown, media viewer, audio player bar, round video recorder. */

/* =====================================================================
   EMOJI / STICKERS / GIFS dropdown (Web K .emoji-dropdown)
   ===================================================================== */
let emojiEl = null;
UI.closeEmoji = (instant) => {
  if (!emojiEl) return false;
  const e = emojiEl;
  emojiEl = null;
  if (e.classList.contains('emoji-dock')) {
    // docked panel (phones): it takes the keyboard's place, so it leaves without a fade
    e.remove();
    document.body.classList.remove('emoji-docked');
  } else {
    e.classList.add('hide');
    setTimeout(() => e.remove(), instant ? 0 : 150);
  }
  document.querySelector('.composer .emoji-btn')?.classList.remove('on');
  UI.onEmojiClosed?.();
  return true;
};
UI.emojiOpen = () => !!emojiEl;

App.loadStickers = async (force) => {
  if (S.stickers && !force) return S.stickers;
  try { S.stickers = (await api('GET', '/api/stickers')).packs; } catch { S.stickers = S.stickers || []; }
  return S.stickers;
};
App.loadGifs = async (force) => {
  if (S.gifs && !force) return S.gifs;
  try { S.gifs = (await api('GET', '/api/gifs')).gifs; } catch { S.gifs = S.gifs || []; }
  return S.gifs;
};
App.rememberSticker = (st) => {
  const list = [st, ...(S.settings.stickers_recent || []).filter((x) => x.id !== st.id)].slice(0, 20).map((x) => ({ id: x.id, url: x.url, emoji: x.emoji }));
  setSetting('stickers_recent', list);
};

UI.emojiDropdown = (anchor, handlers) => {
  if (emojiEl) { UI.closeEmoji(); return; }
  anchor.classList.add('on');
  const body = h('div', { class: 'ep-body' });
  const tabs = h('div', { class: 'ep-tabs' });
  const dock = handlers.dock || null;
  const pop = h('div', { class: dock ? 'emoji-dock' : 'emoji-pop', onmousedown: (e) => { if (!e.target.closest('input')) e.preventDefault(); } }, body, tabs);
  emojiEl = pop;
  let tab = store('emojiTab', 'emoji');
  const showTab = (t) => {
    tab = t; save('emojiTab', t);
    $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    body.replaceChildren();
    body.scrollTop = 0;
    if (t === 'emoji') renderEmoji();
    else if (t === 'stickers') renderStickers();
    else renderGifs();
  };
  for (const [t, ic, label] of [['emoji', 'smile', 'اموجی'], ['stickers', 'sticker', 'استیکر'], ['gif', 'gif', 'GIF']]) {
    tabs.append(h('button', { type: 'button', dataset: { t }, title: label, onclick: () => showTab(t) }, icon(ic)));
  }
  if (handlers.noStickers) $$('button', tabs).slice(1).forEach((b) => b.remove());

  function section(title, grid, id) { return h('div', { class: 'ep-sec', dataset: { sec: id } }, h('div', { class: 'ep-title' }, title), grid); }
  function catBar(items) {
    const bar = h('div', { class: 'ep-cats' });
    for (const it of items) bar.append(h('button', { type: 'button', title: it.title, dataset: { cat: it.id }, onclick: () => {
      const sec = body.querySelector(`[data-sec="${it.id}"]`);
      if (sec) body.scrollTop = sec.offsetTop - bar.offsetHeight;
    } }, it.node));
    return bar;
  }
  function renderEmoji() {
    const cats = Object.keys(EMOJI);
    body.append(catBar(cats.map((c) => ({ id: c, title: EMOJI[c][0], node: c === '🕘' ? icon('clock') : h('span', {}, c) }))));
    for (const cat of cats) {
      const list = cat === '🕘' ? S.recentEmoji : EMOJI[cat][1].split(' ');
      if (!list.length) continue;
      const grid = h('div', { class: 'emoji-grid' });
      for (const e of list) grid.append(h('button', { type: 'button', onclick: () => {
        S.recentEmoji = [e, ...S.recentEmoji.filter((x) => x !== e)].slice(0, 32);
        save('recentEmoji', S.recentEmoji);
        handlers.onEmoji(e);
      } }, e));
      body.append(section(EMOJI[cat][0], grid, cat));
    }
  }
  function stickerBtn(st) {
    return h('button', { type: 'button', class: 'st', title: st.emoji, onclick: () => { App.rememberSticker(st); handlers.onSticker(st); } },
      h('img', { src: st.url, alt: st.emoji || '', loading: 'lazy', draggable: 'false' }));
  }
  async function renderStickers() {
    body.append(h('div', { class: 'info-empty' }, 'در حال بارگذاری…'));
    const packs = await App.loadStickers();
    if (tab !== 'stickers' || !emojiEl) return;
    body.replaceChildren();
    const recent = S.settings.stickers_recent || [];
    body.append(catBar([
      ...(recent.length ? [{ id: 'recent', title: 'اخیر', node: icon('clock') }] : []),
      ...packs.map((p) => ({ id: 'p' + p.id, title: p.title, node: p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', {}, '?') })),
      { id: 'add', title: 'افزودن بسته', node: icon('plus') },
    ]));
    $('[data-cat="add"]', body)?.addEventListener('click', () => { UI.closeEmoji(); App.stickerSearchDialog(); });
    if (recent.length) body.append(section('اخیر', h('div', { class: 'st-grid' }, recent.map(stickerBtn)), 'recent'));
    for (const p of packs) body.append(section(p.title, h('div', { class: 'st-grid' }, p.stickers.map(stickerBtn)), 'p' + p.id));
    if (!packs.length) body.append(h('div', { class: 'info-empty' }, 'هیچ بسته‌ی استیکری نصب نیست'));
  }
  async function renderGifs() {
    const input = h('input', { type: 'search', placeholder: 'جستجوی GIF', autocomplete: 'off' });
    const grid = h('div', { class: 'gif-grid' });
    body.append(h('div', { class: 'ep-search' }, icon('search'), input), grid);
    const tile = (g, onClick) => {
      const isImg = g.mime === 'image/gif';
      const media = g.blob || isImg ? h('img', { src: g.blob || g.url, alt: '', loading: 'lazy' }) : h('video', { src: g.url, muted: true, loop: true, autoplay: true, playsinline: true });
      if (media.tagName === 'VIDEO') media.muted = true;
      const t = h('button', { type: 'button', class: 'gt', onclick: onClick }, media);
      if (g.width && g.height) t.style.aspectRatio = `${g.width} / ${g.height}`;
      return t;
    };
    const showSaved = async () => {
      const gifs = await App.loadGifs();
      if (input.value.trim()) return;
      grid.replaceChildren(...(gifs.length ? gifs.map((g) => tile(g, () => handlers.onGif({ file_id: g.file_id, meta: { width: g.width, height: g.height } })))
        : [h('div', { class: 'info-empty' }, 'هنوز GIFی ذخیره نکرده‌اید.\nروی هر GIF در گفتگو کلیک راست کنید و «ذخیره GIF» را بزنید.')]));
    };
    let t, seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = input.value.trim();
        const my = ++seq;
        if (!q) return showSaved();
        if (!S.config.gif_search) {
          const saved = (await App.loadGifs()).filter((g) => (g.name || '').toLowerCase().includes(q.toLowerCase()));
          grid.replaceChildren(h('div', { class: 'info-empty' }, 'جستجوی آنلاین GIF روی این سرور فعال نیست (TENOR_API_KEY).'), ...saved.map((g) => tile(g, () => handlers.onGif({ file_id: g.file_id }))));
          return;
        }
        grid.replaceChildren(h('div', { class: 'info-empty' }, 'در حال جستجو…'));
        try {
          const { results } = await api('GET', '/api/gifs/search?q=' + encodeURIComponent(q));
          if (my !== seq) return;
          grid.replaceChildren();
          for (const r of results) {
            const g = { ...r, blob: '' };
            const node = tile(g, () => handlers.onGif({ remote: r.id, meta: { width: r.width, height: r.height } }));
            grid.append(node);
            fetch('/api/gifs/preview/' + encodeURIComponent(r.id), { headers: { Authorization: 'Bearer ' + S.token } })
              .then((res) => res.blob()).then((b) => { $('img', node).src = URL.createObjectURL(b); }).catch(() => {});
          }
          if (!results.length) grid.append(h('div', { class: 'info-empty' }, 'چیزی پیدا نشد'));
        } catch (e) { grid.replaceChildren(h('div', { class: 'info-empty' }, e.message)); }
      }, 300);
    });
    showSaved();
    if (!dock) setTimeout(() => input.focus(), 30);
  }

  if (dock) {
    // Telegram Android: the panel sits under the composer, exactly where the keyboard was
    pop.style.height = (handlers.height || 300) + 'px';
    dock.after(pop);
    document.body.classList.add('emoji-docked');
    showTab(handlers.noStickers ? 'emoji' : tab);
    return pop;
  }
  document.body.append(pop);
  const a = anchor.getBoundingClientRect();
  const w = Math.min(420, innerWidth - 16), ht = Math.min(420, innerHeight - 140);
  pop.style.width = w + 'px';
  pop.style.height = ht + 'px';
  pop.style.left = Math.max(8, Math.min(a.right - w + 8, innerWidth - w - 8)) + 'px';
  pop.style.top = Math.max(8, a.top - ht - 10) + 'px';
  showTab(handlers.noStickers ? 'emoji' : tab);
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!emojiEl) return document.removeEventListener('mousedown', off);
    if (!emojiEl.contains(e.target) && !anchor.contains(e.target)) { UI.closeEmoji(); document.removeEventListener('mousedown', off); }
  }), 0);
};

/* =====================================================================
   MEDIA VIEWER (Web K .media-viewer)
   ===================================================================== */
UI.lightbox = (m, list) => {
  if (!list) {
    const st = S.msgs.get(App.mkey ? App.mkey() : S.active);
    list = st ? st.list.filter((x) => (x.kind === 'photo' || x.kind === 'video' || x.kind === 'gif') && x.media) : [];
    if (!list.some((x) => x.id === m.id)) list = [m];
  }
  let idx = Math.max(0, list.findIndex((x) => x.id === m.id));
  let zoom = 1, panX = 0, panY = 0;
  const main = h('div', { class: 'lb-main' });
  const who = h('div', { class: 'lb-who' });
  const cap = h('div', { class: 'lb-cap', dir: 'auto' });
  const counter = h('span', { class: 'lb-count' });
  const prev = h('button', { class: 'lb-nav prev', type: 'button', 'aria-label': 'قبلی', onclick: (e) => { e.stopPropagation(); go(-1); } }, icon('chevron', 'flip'));
  const next = h('button', { class: 'lb-nav next', type: 'button', 'aria-label': 'بعدی', onclick: (e) => { e.stopPropagation(); go(1); } }, icon('chevron'));
  const applyZoom = () => { const media = main.firstChild; if (media) media.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; lb.classList.toggle('zoomed', zoom > 1); };
  const show = () => {
    const cur = list[idx];
    zoom = 1; panX = panY = 0;
    main.querySelector('video')?.pause?.();
    const media = cur.kind === 'photo' || (cur.kind === 'gif' && cur.media.mime === 'image/gif')
      ? h('img', { src: cur.media.url, alt: '', draggable: 'false' })
      : h('video', { src: cur.media.url, controls: cur.kind !== 'gif', autoplay: true, playsinline: true, loop: cur.kind === 'gif', muted: cur.kind === 'gif' });
    main.replaceChildren(media);
    who.replaceChildren(userAvatar(cur.sender, 's40'),
      h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, cur.sender.display_name), h('div', { class: 's' }, fmtDay(cur.created_at) + '، ' + fmtTime(cur.created_at))));
    cap.textContent = '';
    if (cur.text) cap.append(R.text(cur.text));
    cap.hidden = !cur.text;
    counter.textContent = list.length > 1 ? `${fa(idx + 1)} از ${fa(list.length)}` : '';
    prev.hidden = idx <= 0;
    next.hidden = idx >= list.length - 1;
  };
  const go = (d) => { const n = idx + d; if (n < 0 || n >= list.length) return; idx = n; show(); };
  const close = () => { lb.classList.add('hide'); main.querySelector('video')?.pause?.(); setTimeout(() => lb.remove(), 180); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(-1); // RTL: right = older
    else if (e.key === 'ArrowLeft') go(1);
  };
  const cur = () => list[idx];
  const lb = h('div', { class: 'lightbox' },
    h('div', { class: 'lb-head' }, who, counter,
      h('div', { class: 'lb-actions' },
        ibtn('zoomIn', 'بزرگ‌نمایی', () => { zoom = zoom > 1 ? 1 : 2; panX = panY = 0; applyZoom(); }),
        ibtn('forward', 'بازارسال', () => { close(); App.forwardDialog([cur().id]); }),
        h('a', { class: 'ibtn', title: 'دانلود', onclick: (e) => { e.currentTarget.href = cur().media.url; e.currentTarget.download = cur().media.name || 'media'; } }, icon('download')),
        cur().id && (cur().sender.id === S.me?.id || S.chats.get(cur().chat_id)?.can_manage) ? ibtn('trash', 'حذف', () => { const id = cur().id; close(); App.deleteMessages([id]); }) : null,
        ibtn('close', 'بستن', close))),
    main, prev, next, cap);
  main.addEventListener('click', (e) => { if (e.target === main) close(); });
  main.addEventListener('dblclick', () => { zoom = zoom > 1 ? 1 : 2.5; panX = panY = 0; applyZoom(); });
  main.addEventListener('wheel', (e) => { if (!e.ctrlKey && zoom === 1 && !e.metaKey) return; e.preventDefault(); zoom = Math.max(1, Math.min(5, zoom * (e.deltaY < 0 ? 1.15 : 0.87))); if (zoom === 1) panX = panY = 0; applyZoom(); }, { passive: false });
  let drag = null;
  main.addEventListener('pointerdown', (e) => { if (zoom > 1) { drag = { x: e.clientX - panX, y: e.clientY - panY }; e.preventDefault(); } });
  main.addEventListener('pointermove', (e) => { if (drag) { panX = e.clientX - drag.x; panY = e.clientY - drag.y; applyZoom(); } });
  main.addEventListener('pointerup', () => (drag = null));
  document.body.append(lb);
  document.addEventListener('keydown', onKey);
  show();
};

/* =====================================================================
   AUDIO PLAYER BAR (Web K pinned audio)
   ===================================================================== */
const Player = {
  audio: null, msg: null,
  attach(audio, m) {
    this.audio = audio; this.msg = m;
    if (!el.audioBar) return;
    const toggle = h('button', { class: 'ibtn accent', type: 'button', onclick: () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()) }, icon('pause'));
    const sync = () => toggle.replaceChildren(icon(audio.paused ? 'play' : 'pause'));
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    const rate = h('button', { class: 'rate', type: 'button', onclick: () => {
      const next = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length];
      audio.playbackRate = next; rate.textContent = fa(next) + '×';
    } }, fa(audio.playbackRate || 1) + '×');
    el.audioBar.replaceChildren(toggle,
      h('div', { class: 'body', onclick: () => App.jumpTo(m.chat_id, m.id) },
        h('div', { class: 'n', dir: 'auto' }, m.kind === 'voice' ? m.sender.display_name : (m.media.name || '').replace(/\.[^.]+$/, '')),
        h('div', { class: 's' }, m.kind === 'voice' ? 'پیام صوتی' : 'موسیقی')),
      rate, ibtn('close', 'بستن', () => { audio.pause(); this.hide(); }));
    el.audioBar.hidden = false;
  },
  hide() { if (el.audioBar) el.audioBar.hidden = true; this.audio = null; },
  ended(audio, m) {
    // like Telegram: keep playing the next voice message
    if (m.kind !== 'voice') return this.hide();
    const nodes = $$('.voice:not(.audio)', el.inner || document);
    const i = nodes.findIndex((n) => n.audio === audio);
    const nxt = i >= 0 ? nodes[i + 1] : null;
    if (nxt?.audio) nxt.audio.play().catch(() => {});
    else this.hide();
  },
};

/* =====================================================================
   ROUND VIDEO MESSAGES (video notes)
   ===================================================================== */
