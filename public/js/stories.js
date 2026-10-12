'use strict';
/* Kabootar — Stories: bar above the chat list, full-screen viewer, posting, viewers list. */

const Stories = {
  feed: null,
  async load() {
    try { this.feed = await api('GET', '/api/stories'); } catch { this.feed = this.feed || { me: null, users: [] }; }
    App.renderSidebar();
  },
  onEvent(ev) {
    if (ev.type === 'stories') {
      clearTimeout(this.t);
      this.t = setTimeout(() => this.load().then(() => App.loadChats().catch(() => {})), 300);
    } else if (ev.type === 'story_views' && this.viewer?.owner) {
      const s = this.viewer.list.find((x) => x.id === ev.story_id);
      if (s) { s.views = ev.views; this.viewer.paintFooter?.(); }
    }
  },
  renderBar(box) {
    if (!box) return;
    const f = this.feed;
    // like Web K: the strip only appears when there is something to watch
    const stack = typeof el !== 'undefined' ? el.storyStack : null;
    if (!f || S.settings.stories_hidden || S.archived || (!f.me && !f.users.length)) { box.hidden = true; if (stack) stack.hidden = true; return; }
    if (stack) {
      const top = [...f.users.filter((e) => e.unseen), ...f.users.filter((e) => !e.unseen), f.me].filter(Boolean).slice(0, 3);
      stack.replaceChildren(...top.map((e) => h('span', { class: 'ss' + (e.unseen ? ' unseen' : '') }, userAvatar(e.user, 's32'))));
      stack.hidden = false;
    }
    const items = [];
    const me = f.me;
    // Web K only shows your own circle when you have a live story (posting is in the menu → My Stories)
    // Android: "My story" is always first; a + badge when you have nothing live
    items.push(h('button', { type: 'button', class: 'story-item me', onclick: () => (me ? this.openEntry(me) : this.compose()) },
      h('span', { class: 'ring' + (me ? ' mine' : ' none') }, userAvatar(S.me, 's54')), !me ? h('span', { class: 'plus' }, icon('plus')) : null,
      h('span', { class: 'nm' }, 'استوری من')));
    for (const e of f.users) {
      items.push(h('button', { type: 'button', class: 'story-item', onclick: () => this.openEntry(e) },
        h('span', { class: 'ring' + (e.unseen ? ' unseen' : ' seen') }, userAvatar(e.user, 's54')), h('span', { class: 'nm', dir: 'auto' }, userName(e.user).split(' ')[0])));
    }
    box.replaceChildren(...items);
    box.hidden = false;
  },
  openMine() { if (this.feed?.me) this.openEntry(this.feed.me); else this.compose(); },
  openEntry(entry, storyId) {
    const order = [this.feed?.me, ...(this.feed?.users || [])].filter(Boolean);
    const idx = Math.max(0, order.findIndex((e) => e.user.id === entry.user.id));
    this.openViewer(order, idx, storyId);
  },
  openList(user, list, storyId) { this.openViewer([{ user, stories: list }], 0, storyId); },

  /* ---------- viewer (Web K .stories-viewer) ---------- */
  openViewer(entries, userIdx, storyId) {
    this.close();
    let ui = userIdx;
    let si = 0;
    let timer = null, started = 0, elapsed = 0, paused = false, dur = 6000;
    const bars = h('div', { class: 'sv-bars' });
    const head = h('div', { class: 'sv-head' });
    const media = h('div', { class: 'sv-media' });
    const cap = h('div', { class: 'sv-cap', dir: 'auto' });
    const foot = h('div', { class: 'sv-foot' });
    const bg = h('div', { class: 'sv-bg' });
    const card = h('div', { class: 'sv-card' }, media, h('div', { class: 'sv-top' }, bars, head), cap, foot,
      h('button', { class: 'sv-tap prev', type: 'button', 'aria-label': 'قبلی', onclick: () => go(-1) }),
      h('button', { class: 'sv-tap next', type: 'button', 'aria-label': 'بعدی', onclick: () => go(1) }));
    const root = h('div', { class: 'story-viewer' }, bg, card, ibtn('close', 'بستن', () => this.close(), 'sv-close'),
      h('button', { class: 'sv-arrow prev', type: 'button', onclick: () => jumpUser(-1) }, icon('chevron', 'flip')),
      h('button', { class: 'sv-arrow next', type: 'button', onclick: () => jumpUser(1) }, icon('chevron')));
    const cur = () => entries[ui]?.stories[si];
    const tick = () => {
      if (paused) return;
      const p = Math.min(1, (elapsed + Date.now() - started) / dur);
      const fill = bars.children[si]?.firstChild;
      if (fill) fill.style.width = p * 100 + '%';
      if (p >= 1) go(1);
    };
    const pause = (v) => {
      if (v === paused) return;
      paused = v;
      const vid = $('video', media);
      if (v) { elapsed += Date.now() - started; vid?.pause(); }
      else { started = Date.now(); vid?.play().catch(() => {}); }
    };
    const show = () => {
      const e = entries[ui];
      const s = cur();
      if (!e || !s) return this.close();
      const own = e.user.id === S.me.id;
      this.viewer.owner = own;
      this.viewer.list = e.stories;
      clearInterval(timer);
      elapsed = 0; paused = false;
      bars.replaceChildren(...e.stories.map((_, i) => { const b = h('i', {}, h('b')); if (i < si) b.firstChild.style.width = '100%'; return b; }));
      head.replaceChildren(userAvatar(e.user, 's32'),
        h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, own ? 'استوری من' : userName(e.user)), h('div', { class: 's' }, fmtListTime(s.created_at) + (own && s.privacy === 'contacts' ? ' · فقط مخاطبین' : ''))),
        ibtn('more', 'بیشتر', (ev) => { pause(true); this.storyMenu(e, s, ev.currentTarget, () => pause(false)); }));
      const m = s.kind === 'photo' ? h('img', { src: s.url, alt: '' }) : h('video', { src: s.url, autoplay: true, playsinline: true });
      media.replaceChildren(m);
      bg.style.backgroundImage = s.kind === 'photo' ? `url("${s.url}")` : '';
      cap.textContent = '';
      if (s.caption) cap.append(R.text(s.caption));
      cap.hidden = !s.caption;
      const startTimer = (ms) => { dur = ms; started = Date.now(); clearInterval(timer); timer = setInterval(tick, 50); };
      if (s.kind === 'video') {
        m.addEventListener('loadedmetadata', () => startTimer(Math.min(60, m.duration || 15) * 1000));
        startTimer((s.duration || 15) * 1000);
      } else startTimer(6000);
      if (!own && !s.seen) { s.seen = true; api('POST', `/api/stories/${s.id}/view`).catch(() => {}); e.unseen = Math.max(0, (e.unseen || 1) - 1); }
      this.viewer.paintFooter = () => paintFooter(e, s, own);
      paintFooter(e, s, own);
    };
    const paintFooter = (e, s, own) => {
      if (own) {
        foot.replaceChildren(h('button', { type: 'button', class: 'sv-views', onclick: () => { pause(true); this.viewsDialog(s, () => pause(false)); } }, icon('eye'), fa(s.views || 0) + ' بازدید'));
        return;
      }
      const chat = [...S.chats.values()].find((c) => c.type === 'private' && c.peer.id === e.user.id);
      const input = h('input', { type: 'text', placeholder: 'پاسخ خصوصی…', dir: 'auto' });
      input.addEventListener('focus', () => pause(true));
      input.addEventListener('blur', () => { if (!input.value) pause(false); });
      input.addEventListener('keydown', async (ev) => {
        if (ev.key !== 'Enter' || !input.value.trim()) return;
        ev.preventDefault();
        try {
          const c = chat || (await api('POST', '/api/chats/private', { username: e.user.username })).chat;
          if (!S.chats.has(c.id)) S.chats.set(c.id, c);
          await api('POST', `/api/chats/${c.id}/messages`, { text: input.value.trim(), story_id: s.id });
          input.value = '';
          input.blur();
          toast('پاسخ ارسال شد');
        } catch (er) { toast(er.message); }
      });
      const heart = h('button', { type: 'button', class: 'sv-react' + (s.my_reaction ? ' on' : ''), onclick: async () => {
        const next = s.my_reaction ? null : '❤️';
        try { await api('POST', `/api/stories/${s.id}/react`, { emoji: next }); s.my_reaction = next; heart.classList.toggle('on', !!next); heart.replaceChildren(icon(next ? 'heart' : 'heartO')); } catch (er) { toast(er.message); }
      } }, icon(s.my_reaction ? 'heart' : 'heartO'));
      foot.replaceChildren(h('div', { class: 'sv-reply' }, input), heart);
    };
    const go = (d) => {
      const e = entries[ui];
      const n = si + d;
      if (n >= 0 && n < e.stories.length) { si = n; return show(); }
      jumpUser(d);
    };
    const jumpUser = (d) => {
      const n = ui + d;
      if (n < 0 || n >= entries.length) { if (d > 0) return this.close(); si = 0; return show(); }
      ui = n;
      si = d > 0 ? 0 : 0;
      const firstUnseen = entries[ui].stories.findIndex((s) => !s.seen);
      if (d > 0 && firstUnseen > 0) si = firstUnseen;
      show();
    };
    // hold to pause
    card.addEventListener('pointerdown', (e) => { if (e.target.closest('input, button.sv-react, .sv-head button, .sv-views')) return; this.holdT = setTimeout(() => pause(true), 180); });
    card.addEventListener('pointerup', () => { clearTimeout(this.holdT); if (paused && document.activeElement?.tagName !== 'INPUT') setTimeout(() => pause(false), 10); });
    const onKey = (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') go(1);
      else if (e.key === 'ArrowRight') go(-1);
      else if (e.key === ' ') { e.preventDefault(); pause(!paused); }
    };
    document.addEventListener('keydown', onKey);
    this.viewer = { root, close: () => { clearInterval(timer); document.removeEventListener('keydown', onKey); } };
    document.body.append(root);
    if (storyId != null) { const i = entries[ui].stories.findIndex((s) => s.id === storyId); if (i >= 0) si = i; }
    else { const i = entries[ui].stories.findIndex((s) => !s.seen); if (i > 0) si = i; }
    show();
  },
  close() {
    if (!this.viewer) return;
    const v = this.viewer;
    this.viewer = null;
    v.close();
    v.root.classList.add('hide');
    setTimeout(() => v.root.remove(), 180);
    App.renderSidebar();
  },
  storyMenu(entry, s, anchor, resume) {
    const own = entry.user.id === S.me.id;
    UI.menu([
      own ? { icon: 'pin', label: s.pinned ? 'برداشتن از پروفایل' : 'نگه داشتن در پروفایل', onClick: async () => { try { const r = await api('PATCH', `/api/stories/${s.id}`, { pinned: !s.pinned }); s.pinned = r.story.pinned; toast(s.pinned ? 'در پروفایل ماند' : 'از پروفایل برداشته شد'); } catch (e) { toast(e.message); } resume(); } } : null,
      { icon: 'download', label: 'دانلود', onClick: () => { const a = h('a', { href: s.url, download: 'story' }); document.body.append(a); a.click(); a.remove(); resume(); } },
      own ? { icon: 'trash', label: 'حذف استوری', danger: true, onClick: async () => {
        if (!(await UI.ask('حذف استوری', 'این استوری حذف شود؟', 'حذف', true))) return resume();
        try { await api('DELETE', `/api/stories/${s.id}`); this.close(); this.load(); } catch (e) { toast(e.message); }
      } } : null,
    ], { anchor, alignStart: true });
    const m = $('.menu');
    const bd = $('.backdrop');
    bd?.addEventListener('mousedown', resume, { once: true });
    return m;
  },
  async viewsDialog(s, onClose) {
    try {
      const { views } = await api('GET', `/api/stories/${s.id}/views`);
      UI.modal({
        title: `${fa(views.length)} بازدید`, onClose,
        body: views.length ? h('div', { class: 'picker-list' }, views.map((v) => h('div', { class: 'pick' }, userAvatar(v.user, 's42'),
          h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, userName(v.user)), h('div', { class: 's' }, fmtListTime(v.viewed_at))),
          v.reaction ? h('span', { class: 'rx' }, v.reaction) : null))) : h('div', { class: 'info-empty' }, 'هنوز کسی ندیده'),
      });
    } catch (e) { toast(e.message); onClose(); }
  },

  /* ---------- posting ---------- */
  compose() {
    const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime' });
    inp.addEventListener('change', () => { const f = inp.files[0]; if (f) this.composeFile(f); });
    inp.click();
  },
  composeFile(file) {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const preview = h('div', { class: 'story-compose-preview' }, isVideo ? h('video', { src: url, autoplay: true, muted: true, loop: true, playsinline: true }) : h('img', { src: url, alt: '' }));
    const caption = UI.field('متن (اختیاری)', { multiline: true, rows: 1, maxlength: 1024 });
    let privacy = 'everybody', period = 24, pinned = false;
    const send = h('button', { class: 'btn flat' }, 'انتشار');
    const m = UI.modal({
      title: 'استوری جدید', cls: 'story-compose',
      body: [preview, caption,
        h('div', { class: 'section-caption' }, 'چه کسانی ببینند'),
        UI.radios([['everybody', 'همه‌ی کسانی که با من گفتگو دارند'], ['contacts', 'فقط مخاطبین من']], privacy, (v) => (privacy = v)),
        h('div', { class: 'section-caption' }, 'مدت نمایش'),
        h('div', { class: 'chips-select' }, (S.config.story_periods || [6, 12, 24, 48]).map((p) => {
          const b = h('button', { type: 'button', class: 'chip-sel' + (p === period ? ' on' : ''), onclick: () => { period = p; $$('.chip-sel', b.parentNode).forEach((x) => x.classList.toggle('on', x === b)); } }, `${fa(p)} ساعت`);
          return b;
        })),
        UI.checkRow('نگه داشتن در پروفایل بعد از انقضا', false, (v) => (pinned = v))],
      foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), send],
      onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
    });
    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        const meta = await new Promise((resolve) => {
          if (isVideo) { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }); v.onerror = () => resolve({}); v.src = url; setTimeout(() => resolve({}), 3000); }
          else { const i = new Image(); i.onload = () => resolve({ width: i.naturalWidth, height: i.naturalHeight }); i.onerror = () => resolve({}); i.src = url; }
        });
        toast('در حال آپلود استوری…');
        const up = await uploadFile(file, file.name);
        await api('POST', '/api/stories', { file_id: up.id, caption: caption.input.value.trim(), privacy, period, pinned, meta });
        m.close();
        toast('استوری منتشر شد');
        this.load();
      } catch (e) { toast(e.message); send.disabled = false; }
    });
  },
};

App.openStoriesOf = async (userId, storyId) => {
  const fromFeed = userId === S.me.id ? Stories.feed?.me : Stories.feed?.users.find((e) => e.user.id === userId);
  if (fromFeed) return Stories.openEntry(fromFeed, storyId);
  try {
    const r = await api('GET', `/api/users/${userId}/stories`);
    const list = r.stories.length ? r.stories : r.pinned;
    if (!list.length) return toast('استوری‌ای نیست');
    Stories.openList(r.user, list, storyId);
  } catch (e) { toast(e.message); }
};
