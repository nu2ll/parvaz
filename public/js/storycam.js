'use strict';
/* Kabootar v3.9: posting a story like Telegram Android.
   Camera screen: live viewfinder, tap the shutter = photo, hold = video (up to 60s, ring fills),
   flip camera, gallery (the phone's own gallery inside the app). Then the editor: full-screen
   preview, caption, "who can see it" + duration + keep on profile, send. The upload runs in the
   background with a progress ring on "My story", like Telegram. */
const StoryCam = {
  cur: null,
  open() {
    if (this.cur) return;
    const video = h('video', { class: 'scam-view', autoplay: true, muted: true, playsinline: true });
    video.muted = true;
    const ring = h('i', { class: 'ring' });
    const shutter = h('button', { type: 'button', class: 'scam-shutter', 'aria-label': 'عکس یا ویدیو' }, ring, h('b'));
    const flip = h('button', { type: 'button', class: 'scam-btn', title: 'چرخاندن دوربین' }, icon('flipCam'));
    const gal = h('button', { type: 'button', class: 'scam-gal', title: 'گالری' }, icon('oImage'));
    const close = h('button', { type: 'button', class: 'scam-btn scam-close', title: 'بستن' }, icon('close'));
    const timer = h('div', { class: 'scam-timer', hidden: true });
    const hint = h('div', { class: 'scam-hint' }, 'برای عکس بزنید، برای ویدیو نگه دارید');
    const noCam = h('div', { class: 'scam-nocam', hidden: true },
      h('div', { class: 'ic' }, icon('oCamera')), h('b', {}, 'دسترسی به دوربین'),
      h('span', {}, 'برای گرفتن عکس و ویدیو برای استوری، به کبوتر اجازه‌ی دوربین بدهید. یا از گالری انتخاب کنید.'),
      h('button', { type: 'button', class: 'btn', onclick: () => this.startCam(cur) }, 'اجازه دادن'));
    const flash = h('div', { class: 'scam-flash' });
    const root = h('div', { class: 'scam' }, video, noCam, flash,
      h('div', { class: 'scam-top' }, close, timer, h('span', { class: 'sp' })),
      h('div', { class: 'scam-bottom' }, gal, shutter, flip), hint);
    const cur = this.cur = { root, video, ring, timer, hint, noCam, flash, shutter, facing: 'environment', stream: null, rec: null };
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('in'));
    close.addEventListener('click', () => this.close());
    flip.addEventListener('click', () => { if (cur.rec) return; cur.facing = cur.facing === 'user' ? 'environment' : 'user'; this.startCam(cur); });
    gal.addEventListener('click', () => this.gallery(cur));
    this.bindShutter(cur);
    this.startCam(cur);
    this.galThumb(gal);
  },
  close() {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    this.stopRec(cur, true);
    this.stopCam(cur);
    cur.editor?.destroy?.();
    cur.root.classList.remove('in');
    cur.root.classList.add('out');
    setTimeout(() => cur.root.remove(), 220);
  },
  stopCam(cur) {
    if (cur?.stream) { cur.stream.getTracks().forEach((t) => t.stop()); cur.stream = null; }
    if (cur?.video) cur.video.srcObject = null;
  },
  async startCam(cur) {
    this.stopCam(cur);
    if (!navigator.mediaDevices?.getUserMedia) { cur.noCam.hidden = false; return; }
    // ask in the sensor's own (landscape) shape and never crop: asking 1080×1920 made phones crop = zoomed picture
    const video = { facingMode: cur.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, resizeMode: 'none' };
    let s = null;
    try { s = await navigator.mediaDevices.getUserMedia({ video, audio: true }); }
    catch { try { s = await navigator.mediaDevices.getUserMedia({ video, audio: false }); } catch { s = null; } }
    if (this.cur !== cur || cur.editing) { s?.getTracks().forEach((t) => t.stop()); return; }
    if (!s) { cur.noCam.hidden = false; return; }
    cur.noCam.hidden = true;
    cur.stream = s;
    cur.video.srcObject = s;
    cur.video.classList.toggle('mirror', cur.facing === 'user');
    cur.video.play?.().catch(() => {});
  },
  // last photo of the gallery on the gallery button (Telegram)
  galThumb(btn) {
    if (!Native.ok || Native.mediaState() === 'ask') return;
    const first = Native.recent(1)[0];
    if (first) btn.replaceChildren(h('img', { src: '/__media/thumb/' + first.id, alt: '' }));
  },

  /* ---------- shutter: tap = photo, hold = video ---------- */
  bindShutter(cur) {
    let holdT = 0, down = false;
    const sh = cur.shutter;
    sh.addEventListener('pointerdown', (e) => {
      if (!cur.stream) return;
      e.preventDefault();
      down = true;
      sh.classList.add('press');
      holdT = setTimeout(() => { holdT = 0; if (down) this.startRec(cur); }, 320);
    });
    const up = () => {
      if (!down) return;
      down = false;
      sh.classList.remove('press');
      if (holdT) { clearTimeout(holdT); holdT = 0; this.photo(cur); }
      else if (cur.rec) this.stopRec(cur);
    };
    sh.addEventListener('pointerup', up);
    sh.addEventListener('pointerleave', up);
    sh.addEventListener('pointercancel', up);
    sh.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  photo(cur) {
    const v = cur.video;
    if (!v.videoWidth) return;
    const cv = document.createElement('canvas');
    cv.width = v.videoWidth; cv.height = v.videoHeight;
    const ctx = cv.getContext('2d');
    if (cur.facing === 'user') { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    cur.flash.classList.remove('go'); void cur.flash.offsetWidth; cur.flash.classList.add('go');
    Native.haptic?.('tap');
    cv.toBlob((b) => { if (b && this.cur === cur) this.edit(new File([b], 'story.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.92);
  },
  startRec(cur) {
    if (!cur.stream || typeof MediaRecorder === 'undefined') return this.photo(cur);
    const types = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    let rec;
    try { rec = new MediaRecorder(cur.stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined); } catch { return this.photo(cur); }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
      const secs = (Date.now() - cur.recStart) / 1000;
      if (cur.cancelRec || this.cur !== cur) return;
      const blob = new Blob(chunks, { type });
      if (blob.size < 2000 || secs < 0.6) return; // too short: Telegram ignores it too
      this.edit(new File([blob], 'story.' + (type.includes('mp4') ? 'mp4' : 'webm'), { type }), { duration: secs });
    };
    cur.cancelRec = false;
    cur.rec = rec;
    cur.recStart = Date.now();
    rec.start(250);
    Native.haptic?.('long');
    cur.root.classList.add('recording');
    cur.timer.hidden = false;
    const tick = () => {
      if (cur.rec !== rec) return;
      const s = (Date.now() - cur.recStart) / 1000;
      cur.timer.textContent = fmtDur(Math.floor(s));
      cur.ring.style.setProperty('--p', Math.min(1, s / 60).toFixed(4));
      if (s >= 60) return this.stopRec(cur);
      cur.raf = requestAnimationFrame(tick);
    };
    tick();
  },
  stopRec(cur, cancel) {
    if (!cur?.rec) return;
    const rec = cur.rec;
    cur.rec = null;
    cur.cancelRec = !!cancel;
    cancelAnimationFrame(cur.raf);
    cur.root.classList.remove('recording');
    cur.timer.hidden = true;
    cur.ring.style.removeProperty('--p');
    try { rec.stop(); } catch {}
  },

  /* ---------- gallery ---------- */
  gallery(cur) {
    if (!Native.ok) {
      const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime' });
      inp.addEventListener('change', () => { const f = inp.files[0]; if (f) this.edit(f); });
      inp.click();
      return;
    }
    const grid = h('div', { class: 'scam-grid' });
    const sheet = h('div', { class: 'scam-sheet' }, h('div', { class: 'grip' }), h('div', { class: 'st-head' }, ibtn('close', 'بستن', () => hide()), h('b', {}, 'گالری')), grid);
    cur.root.append(sheet);
    requestAnimationFrame(() => sheet.classList.add('in'));
    const hide = () => { sheet.classList.remove('in'); setTimeout(() => sheet.remove(), 220); };
    cur.hideSheet = hide;
    const fill = () => {
      const state = Native.mediaState();
      if (state === 'ask') {
        grid.replaceChildren(h('div', { class: 'att-perm' }, h('div', { class: 'ic' }, icon('oImage')), h('div', { class: 'tt' }, 'دسترسی به گالری'),
          h('div', { class: 'st' }, 'برای گذاشتن عکس و ویدیو در استوری، به کبوتر اجازه‌ی دسترسی به گالری را بدهید.'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await Native.requestMedia(); fill(); } }, 'اجازه دادن')));
        return;
      }
      const items = Native.recent(200);
      if (!items.length) { grid.replaceChildren(h('div', { class: 'att-empty' }, 'عکس یا ویدیویی پیدا نشد')); return; }
      grid.replaceChildren(...items.map((it) => {
        const t = h('button', { type: 'button', class: 'att-tile' }, h('img', { src: '/__media/thumb/' + it.id, alt: '', loading: 'lazy', decoding: 'async' }),
          it.video ? h('span', { class: 'dur' }, fmtDur(Math.round(it.duration || 0))) : null);
        t.addEventListener('click', async () => {
          t.classList.add('loading');
          try {
            const r = await fetch('/__media/file/' + it.id);
            if (!r.ok) throw new Error('فایل باز نشد');
            const b = await r.blob();
            const type = (it.mime || b.type || (it.video ? 'video/mp4' : 'image/jpeg')).split(';')[0];
            hide();
            this.edit(new File([b], it.name || (it.video ? 'story.mp4' : 'story.jpg'), { type }), it.video ? { duration: it.duration } : {});
          } catch (e) { t.classList.remove('loading'); toast(e.message); }
        });
        return t;
      }));
    };
    fill();
  },

  /* ---------- editor ---------- */
  edit(file, extra = {}) {
    const cur = this.cur || (this.open(), this.cur);
    if (!cur) return;
    if (!/^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime))$/.test(file.type)) return toast('این نوع فایل برای استوری قابل استفاده نیست');
    cur.editing = true;
    this.stopCam(cur);
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const media = isVideo ? h('video', { class: 'sed-media', src: url, autoplay: true, loop: true, playsinline: true }) : h('img', { class: 'sed-media', src: url, alt: '' });
    const bg = h('div', { class: 'sed-bg' });
    if (!isVideo) bg.style.backgroundImage = `url("${url}")`;
    const prefs = { privacy: 'everybody', period: 24, pinned: false, ...store('storyPrefs', {}) };
    const periods = S.config.story_periods || [6, 12, 24, 48];
    if (!periods.includes(prefs.period)) prefs.period = 24;
    const cap = h('textarea', { rows: 1, placeholder: 'افزودن کپشن…', maxlength: 1024, dir: 'auto' });
    cap.addEventListener('input', () => { cap.style.height = 'auto'; cap.style.height = Math.min(cap.scrollHeight, 110) + 'px'; });
    const privBtn = h('button', { type: 'button', class: 'sed-priv' });
    const paintPriv = () => privBtn.replaceChildren(icon(prefs.privacy === 'contacts' ? 'contacts' : 'globe'),
      h('span', {}, prefs.privacy === 'contacts' ? 'مخاطبین' : 'همه'), h('i', {}, '·'), h('span', {}, `${fa(prefs.period)} ساعت`));
    paintPriv();
    privBtn.addEventListener('click', () => this.privacySheet(cur, prefs, paintPriv));
    let muted = false;
    const mute = isVideo ? ibtn('volume', 'صدا', () => { muted = !muted; media.muted = muted; mute.replaceChildren(icon(muted ? 'muted' : 'volume')); }, 'sed-mute') : null;
    const send = h('button', { type: 'button', class: 'sed-send', 'aria-label': 'انتشار' }, icon('send', 'flip'));
    const back = h('button', { type: 'button', class: 'scam-btn', title: 'بازگشت' }, icon('back', 'flip'));
    const ed = h('div', { class: 'sed' }, bg, media,
      h('div', { class: 'sed-top' }, back, h('span', { class: 'sp' }), mute),
      h('div', { class: 'sed-bottom' }, h('div', { class: 'sed-cap' }, cap), h('div', { class: 'sed-bar' }, privBtn, h('span', { class: 'sp' }), send)));
    cur.root.append(ed);
    cur.root.classList.add('editing');
    requestAnimationFrame(() => ed.classList.add('in'));
    const destroy = () => { ed.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
    cur.editor = { destroy };
    back.addEventListener('click', () => {
      cur.editing = false;
      cur.editor = null;
      cur.root.classList.remove('editing');
      ed.classList.remove('in');
      try { media.pause?.(); } catch {}
      setTimeout(() => { ed.remove(); URL.revokeObjectURL(url); }, 200);
      this.startCam(cur);
    });
    send.addEventListener('click', () => {
      save('storyPrefs', prefs);
      const caption = cap.value.trim();
      try { media.pause?.(); } catch {}
      cur.editor = null;
      this.close();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      Stories.publish(file, { caption, privacy: prefs.privacy, period: prefs.period, pinned: prefs.pinned, duration: extra.duration });
    });
  },
  privacySheet(cur, prefs, done) {
    const chips = h('div', { class: 'chips-select' });
    const paintChips = () => chips.replaceChildren(...(S.config.story_periods || [6, 12, 24, 48]).map((p) =>
      h('button', { type: 'button', class: 'chip-sel' + (p === prefs.period ? ' on' : ''), onclick: () => { prefs.period = p; paintChips(); } }, `${fa(p)} ساعت`)));
    paintChips();
    const opt = (v, ic, title, sub) => h('button', { type: 'button', class: 'sp-opt' + (prefs.privacy === v ? ' on' : ''), onclick: (e) => {
      prefs.privacy = v;
      $$('.sp-opt', sheet).forEach((x) => x.classList.toggle('on', x === e.currentTarget));
    } }, h('span', { class: 'sq' }, icon(ic)), h('span', { class: 'tx' }, h('b', {}, title), h('small', {}, sub)), h('span', { class: 'rd' }));
    const sheet = h('div', { class: 'scam-sheet sp-sheet' }, h('div', { class: 'grip' }),
      h('div', { class: 'sp-title' }, 'چه کسانی این استوری را ببینند؟'),
      opt('everybody', 'globe', 'همه', 'همه‌ی کسانی که با شما گفتگو دارند'),
      opt('contacts', 'contacts', 'مخاطبین من', 'فقط کسانی که در مخاطبین شما هستند'),
      h('div', { class: 'sp-cap' }, 'مدت نمایش'), chips,
      UI.checkRow('نگه داشتن در پروفایل بعد از پایان مدت', !!prefs.pinned, (v) => { prefs.pinned = v; }),
      h('button', { type: 'button', class: 'btn block sp-done', onclick: () => hide() }, 'تأیید'));
    const shade = h('div', { class: 'scam-shade', onclick: () => hide() });
    cur.root.append(shade, sheet);
    requestAnimationFrame(() => { sheet.classList.add('in'); shade.classList.add('in'); });
    const hide = () => { done(); sheet.classList.remove('in'); shade.classList.remove('in'); setTimeout(() => { sheet.remove(); shade.remove(); }, 220); };
  },
};
window.StoryCam = StoryCam;

/* ---------- background upload with a ring on "My story" ---------- */
Stories.compose = () => StoryCam.open();
Stories.composeFile = (file) => { StoryCam.open(); StoryCam.edit(file); };
Stories.uploading = null;
Stories.paintUpload = () => {
  const p = Stories.uploading ? Stories.uploading.p : 0;
  for (const n of $$('.story-item.me .ring, .story-stack .ss.me')) {
    n.classList.toggle('uploading', !!Stories.uploading);
    n.style.setProperty('--p', p.toFixed(3));
  }
};
Stories.publish = async (file, o) => {
  if (Stories.uploading) return toast('یک استوری در حال ارسال است');
  Stories.uploading = { p: 0 };
  App.setStoriesOpen?.(true);
  Stories.renderBar(el.storiesBar);
  Stories.paintUpload();
  try {
    const meta = await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const done = (m) => { URL.revokeObjectURL(url); resolve(m); };
      if (file.type.startsWith('video/')) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : o.duration || 0 });
        v.onerror = () => done({ duration: o.duration || 0 });
        v.src = url;
        setTimeout(() => done({ duration: o.duration || 0 }), 3000);
      } else {
        const i = new Image();
        i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight });
        i.onerror = () => done({});
        i.src = url;
      }
    });
    if (meta.duration) meta.duration = Math.min(60, Math.round(meta.duration * 10) / 10);
    const up = await uploadFile(file, file.name, (p) => { if (Stories.uploading) { Stories.uploading.p = p * 0.95; Stories.paintUpload(); } });
    await api('POST', '/api/stories', { file_id: up.id, caption: o.caption || '', privacy: o.privacy, period: o.period, pinned: !!o.pinned, meta });
    Stories.uploading = null;
    await Stories.load();
  } catch (e) {
    Stories.uploading = null;
    Stories.renderBar(el.storiesBar);
    toast(e.message || 'استوری ارسال نشد');
  }
  Stories.paintUpload();
};
(() => {
  const origBack = window.KabootarBack;
  window.KabootarBack = () => {
    const cur = StoryCam.cur;
    if (cur) {
      const sheet = cur.root.querySelector('.scam-sheet.in');
      if (sheet) { const shade = cur.root.querySelector('.scam-shade.in'); if (shade) shade.click(); else cur.hideSheet?.(); return true; }
      const back = cur.root.querySelector('.sed .sed-top .scam-btn');
      if (back) { back.click(); return true; }
      StoryCam.close();
      return true;
    }
    return origBack ? origBack() : false;
  };
})();
