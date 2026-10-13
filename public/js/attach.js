'use strict';
/* Telegram Android attach sheet.
   Bottom sheet with the phone gallery (camera tile first, multi-select with numbers, caption + send),
   and the floating tab pill: Gallery · File · Location · Poll · Contact · Music.
   In the Android app the gallery comes straight from the phone (KabootarNative); in a browser
   the gallery tile opens the system picker. Drag the sheet down to close, up to expand. */
const Attach = {
  cur: null,
  TABS: [
    { id: 'gallery', icon: 'oImage', label: 'گالری' },
    { id: 'file', icon: 'oFile', label: 'فایل' },
    { id: 'location', icon: 'oLocation', label: 'موقعیت' },
    { id: 'poll', icon: 'oPoll', label: 'نظرسنجی', when: (c) => c.type !== 'private' },
    { id: 'contact', icon: 'oContact', label: 'مخاطب' },
    { id: 'music', icon: 'oMusic', label: 'موزیک' },
  ],

  open(c) {
    if (this.cur) this.close(true);
    const body = h('div', { class: 'att-body' });
    const tabs = h('div', { class: 'att-tabs' });
    const caption = h('input', { class: 'cap', type: 'text', placeholder: 'افزودن کپشن…', maxlength: 1024, dir: 'auto' });
    const count = h('span', { class: 'n' });
    const sendBar = h('div', { class: 'att-sendbar', hidden: true }, caption,
      h('button', { class: 'go', type: 'button', title: 'ارسال', onclick: () => this.sendSelected() }, icon('send', 'flip'), count));
    caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendSelected(); } });
    const head = h('div', { class: 'att-head' }, h('div', { class: 'att-handle' }, h('i')), h('div', { class: 'att-title' }));
    const sheet = h('div', { class: 'att-sheet' }, head, body, tabs, sendBar);
    const wrap = h('div', { class: 'att-wrap' }, sheet);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) this.close(); });
    document.body.append(wrap);
    this.cur = { c, wrap, sheet, body, tabs, sendBar, caption, count, head, tab: null, sel: [], stream: null };
    el.attachBtn?.classList.add('open');
    this.renderTabs();
    this.show('gallery');
    this.drag(sheet);
    raf(() => raf(() => wrap.classList.add('show')));
  },

  close(now) {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    this.stopCamera(cur);
    el.attachBtn?.classList.remove('open');
    if (now) { cur.wrap.remove(); return; }
    cur.wrap.classList.remove('show');
    cur.sheet.style.transform = '';
    setTimeout(() => cur.wrap.remove(), 320);
  },

  renderTabs() {
    const cur = this.cur;
    cur.tabs.replaceChildren(...this.TABS.filter((t) => !t.when || t.when(cur.c)).map((t) =>
      h('button', { class: 'att-tab' + (cur.tab === t.id ? ' on' : ''), type: 'button', 'data-tab': t.id, onclick: () => this.show(t.id) }, icon(t.icon), h('span', {}, t.label))));
  },

  show(tab) {
    const cur = this.cur;
    if (!cur) return;
    // actions, not pages
    if (tab === 'poll') { const c = cur.c; this.close(); return App.pollDialog(c); }
    if (tab === 'music') { this.close(); return this.pick('audio/*', false); }
    if (cur.tab === tab) return;
    cur.tab = tab;
    if (tab !== 'gallery') this.stopCamera(cur);
    $$('.att-tab', cur.tabs).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    cur.body.scrollTop = 0;
    cur.sheet.classList.remove('full');
    cur.body.replaceChildren();
    if (tab === 'gallery') this.gallery();
    else if (tab === 'file') this.files();
    else if (tab === 'location') this.location();
    else if (tab === 'contact') this.contacts();
    this.paintSel();
  },

  // system picker → the usual send dialog (compress / album / spoiler)
  pick(accept, asFile, capture) {
    const inp = h('input', { type: 'file', accept, multiple: !capture });
    if (capture) inp.setAttribute('capture', capture);
    inp.addEventListener('change', () => {
      const files = [...inp.files];
      if (files.length) App.sendFilesDialog(files, asFile);
    });
    inp.click();
  },

  /* ---------- gallery ---------- */
  gallery() {
    const cur = this.cur;
    const grid = h('div', { class: 'att-grid' });
    const cam = h('button', { class: 'att-tile att-cam', type: 'button', title: 'دوربین', onclick: () => { this.close(); this.pick('image/*', false, 'environment'); } }, icon('oCamera', 'ic'));
    grid.append(cam);
    cur.body.append(grid);
    if (!Native.ok) {
      grid.append(h('button', { class: 'att-tile att-pick', type: 'button', onclick: () => { this.close(); this.pick('image/*,video/*', false); } },
        icon('oImage'), h('span', {}, 'انتخاب از گالری')));
      return;
    }
    const state = Native.mediaState();
    if (state === 'ask' || state === 'denied') {
      cur.body.append(h('div', { class: 'att-perm' },
        h('div', { class: 'ic' }, icon('oImage')),
        h('div', { class: 'tt' }, 'دسترسی به گالری'),
        h('div', { class: 'st' }, 'برای فرستادن عکس و ویدیو، به کبوتر اجازه‌ی دسترسی به گالری را بدهید.'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await Native.requestMedia(); if (this.cur === cur) { cur.tab = null; this.show('gallery'); } } }, 'اجازه دادن')));
      return;
    }
    this.startCamera(cam);
    const items = Native.recent(200);
    if (!items.length) grid.append(h('div', { class: 'att-empty' }, 'عکس یا ویدیویی پیدا نشد'));
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const num = h('span', { class: 'sel' });
      const tile = h('button', { class: 'att-tile', type: 'button' },
        h('img', { src: '/__media/thumb/' + it.id, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }),
        it.video ? h('span', { class: 'dur' }, attDur(it.duration || 0)) : null, num);
      tile.addEventListener('click', () => this.toggle(it, tile));
      it.tile = tile;
      frag.append(tile);
    }
    grid.append(frag);
    if (state === 'partial') cur.body.append(h('button', { class: 'att-more', type: 'button', onclick: async () => { await Native.requestMedia(); if (this.cur === cur) { cur.tab = null; this.show('gallery'); } } }, 'انتخاب عکس‌های بیشتر'));
  },
  toggle(it, tile) {
    const cur = this.cur;
    const i = cur.sel.indexOf(it);
    if (i >= 0) cur.sel.splice(i, 1);
    else { if (cur.sel.length >= 100) return toast('حداکثر ۱۰۰ مورد'); cur.sel.push(it); }
    Native.haptic('tap');
    this.paintSel();
  },
  paintSel() {
    const cur = this.cur;
    if (!cur) return;
    const n = cur.sel.length;
    cur.sel.forEach((it, i) => { it.tile?.classList.add('on'); const s = it.tile?.querySelector('.sel'); if (s) s.textContent = fa(i + 1); });
    $$('.att-tile.on', cur.body).forEach((t) => { if (!cur.sel.some((it) => it.tile === t)) { t.classList.remove('on'); t.querySelector('.sel').textContent = ''; } });
    cur.sheet.classList.toggle('has-sel', n > 0);
    cur.sendBar.hidden = !n;
    cur.tabs.hidden = !!n;
    cur.count.textContent = n ? fa(n) : '';
    $('.att-title', cur.head).textContent = n ? `${fa(n)} مورد انتخاب شد` : '';
  },
  async sendSelected() {
    const cur = this.cur;
    if (!cur || !cur.sel.length) return;
    const items = cur.sel.slice();
    const caption = cur.caption.value;
    this.close();
    try {
      const files = await Promise.all(items.map(async (it) => {
        const r = await fetch('/__media/file/' + it.id);
        if (!r.ok) throw new Error('فایل باز نشد');
        const b = await r.blob();
        return new File([b], it.name || `${it.video ? 'VID' : 'IMG'}_${it.id}.${it.video ? 'mp4' : 'jpg'}`, { type: it.mime || b.type });
      }));
      App.sendFilesNow(files, { caption, compress: true, group: files.length > 1 });
    } catch (e) { toast(e.message || 'ارسال نشد'); }
  },
  // live viewfinder in the camera tile (only when the camera is already allowed: no surprise prompts)
  async startCamera(tile) {
    const cur = this.cur;
    if (!Native.has('camera') || !navigator.mediaDevices?.getUserMedia || S.settings.lite) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 360 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: false });
      if (this.cur !== cur || cur.tab !== 'gallery') { stream.getTracks().forEach((t) => t.stop()); return; }
      cur.stream = stream;
      const v = h('video', { autoplay: true, muted: true, playsinline: true });
      v.srcObject = stream;
      tile.prepend(v);
      v.play?.().catch(() => {});
    } catch {}
  },
  stopCamera(cur) {
    if (cur?.stream) { cur.stream.getTracks().forEach((t) => t.stop()); cur.stream = null; }
  },

  /* ---------- file ---------- */
  files() {
    const cur = this.cur;
    const row = (ic, color, title, sub, fn) => h('button', { class: 'att-row', type: 'button', onclick: () => { this.close(); fn(); } },
      h('span', { class: 'sq', style: `background:${color}` }, icon(ic)), h('span', { class: 'tx' }, h('b', {}, title), h('small', {}, sub)));
    cur.body.append(h('div', { class: 'att-list' },
      row('oFile', '#4fa9f1', 'فایل‌ها', 'فرستادن هر نوع فایل از حافظه', () => this.pick('', true)),
      row('oImage', '#3dbd5d', 'گالری', 'عکس و ویدیو بدون فشرده‌سازی', () => this.pick('image/*,video/*', true)),
      row('oMusic', '#f68136', 'موزیک', 'فرستادن فایل صوتی', () => this.pick('audio/*', false))));
  },

  /* ---------- location ---------- */
  location() {
    const cur = this.cur;
    const map = h('div', { class: 'att-map' }, h('div', { class: 'att-map-wait' }, h('span', { class: 'spinner' })));
    const sub = h('small', {}, 'در حال پیدا کردن موقعیت…');
    let pos = null;
    const send = h('button', { class: 'att-row', type: 'button', disabled: true, onclick: () => {
      if (!pos) return;
      const c = cur.c;
      this.close();
      Attach.sendBody(c, { location: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } });
    } }, h('span', { class: 'sq', style: 'background:#3dbd5d' }, icon('oGps')), h('span', { class: 'tx' }, h('b', {}, 'ارسال موقعیت فعلی من'), sub));
    cur.body.append(map, h('div', { class: 'att-list' }, send));
    if (!navigator.geolocation) { sub.textContent = 'این دستگاه موقعیت‌یاب ندارد'; return; }
    navigator.geolocation.getCurrentPosition((p) => {
      if (this.cur !== cur) return;
      pos = p;
      send.disabled = false;
      sub.textContent = `دقت ${fa(Math.round(p.coords.accuracy || 0))} متر`;
      map.replaceChildren(R.mapTiles(p.coords.latitude, p.coords.longitude, map.clientWidth || 340, 210, 16));
    }, (err) => {
      if (this.cur !== cur) return;
      sub.textContent = err.code === 1 ? 'اجازه‌ی موقعیت مکانی داده نشد' : 'موقعیت پیدا نشد، GPS را روشن کنید';
      map.replaceChildren(h('div', { class: 'att-map-wait' }, icon('oLocation')));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  },

  /* ---------- contact ---------- */
  contacts() {
    const cur = this.cur;
    const input = h('input', { type: 'search', class: 'att-search', placeholder: 'جستجوی مخاطبین', autocomplete: 'off' });
    const list = h('div', { class: 'att-list' });
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const items = (S.contacts || []).filter((u) => !q || userName(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
      list.replaceChildren(...(items.length ? items.map((u) => App.personRow(u, async () => {
        const c = cur.c;
        if (!(await UI.ask('ارسال مخاطب', `${userName(u)} برای این گفتگو فرستاده شود؟`, 'ارسال'))) return;
        this.close();
        Attach.sendBody(c, { contact_user_id: u.id });
      }, '@' + u.username)) : [h('div', { class: 'empty-hint' }, S.contacts ? 'مخاطبی پیدا نشد' : 'در حال بارگذاری…')]));
    };
    input.addEventListener('input', paint);
    input.addEventListener('focus', () => cur.sheet.classList.add('full'));
    cur.body.append(input, list);
    paint();
    App.loadContacts?.(true).then(() => { if (this.cur === cur) paint(); }).catch(() => {});
  },

  async sendBody(c, extra) {
    const body = { type: 'send', chat_id: c.id, ...extra, ...App.topicFields(c) };
    if (S.reply?.id && S.active === c.id) body.reply_to = S.reply.id;
    try {
      if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message);
      if (body.reply_to) { S.reply = null; App.renderComposerBar(); }
      Sound.play?.('out');
    } catch (e) { toast(e.message); }
  },

  /* ---------- drag: down closes, up expands ---------- */
  drag(sheet) {
    let y0 = null, dy = 0, t0 = 0;
    sheet.addEventListener('touchstart', (e) => {
      if (e.target.closest('.att-tabs, .att-sendbar, input')) return;
      const b = e.target.closest('.att-body');
      if (b && b.scrollTop > 0) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy < 0) {
        if (dy < -30 && !sheet.classList.contains('full')) { sheet.classList.add('full'); y0 = null; }
        return;
      }
      sheet.classList.add('dragging');
      sheet.style.transform = `translate3d(0,${dy}px,0)`;
    }, { passive: true });
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      sheet.classList.remove('dragging');
      const fast = dy > 50 && Date.now() - t0 < 250;
      if (fast || dy > sheet.offsetHeight * 0.28) {
        if (sheet.classList.contains('full') && !fast && dy < sheet.offsetHeight * 0.5) { sheet.classList.remove('full'); sheet.style.transform = ''; }
        else this.close();
      } else sheet.style.transform = '';
    };
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
  },
};
window.Attach = Attach;
function attDur(sec) {
  sec = Math.round(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

App.attachMenu = () => {
  const c = S.chats.get(S.active);
  if (!c?.can_post) return;
  if (touchUI() || Native.ok) return Attach.open(c);
  UI.menu([
    { icon: 'oImage', label: 'عکس یا ویدیو', onClick: () => Attach.pick('image/*,video/*', false) },
    { icon: 'oFile', label: 'فایل', onClick: () => Attach.pick('', true) },
    { icon: 'oLocation', label: 'موقعیت مکانی', onClick: () => { Attach.open(c); Attach.show('location'); } },
    { icon: 'oContact', label: 'مخاطب', onClick: () => { Attach.open(c); Attach.show('contact'); } },
    c.type !== 'private' ? { icon: 'oPoll', label: 'نظرسنجی', onClick: () => App.pollDialog(c) } : null,
  ], { anchor: el.attachBtn, up: true, cls: 'attach-menu', onClose: () => el.attachBtn.classList.remove('open') });
  el.attachBtn.classList.add('open');
};
