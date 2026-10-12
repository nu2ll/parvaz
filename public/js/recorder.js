'use strict';
/* Kabootar: Telegram Android style recording on the mic button.
   Tap  → switch between voice and video (round) message, with a hint bubble.
   Hold → record; slide up to lock, slide towards the input to cancel; release to send.
   Locked: trash · [● waves 0:07,76] · pause · send (Web K layout). */

const Rec = { HOLD_MS: 220, ignoreClickUntil: 0, pending: null };
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fmtRec = (ms) => {
  const s = Math.floor(ms / 1000);
  return faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`);
};
Rec.elapsed = (r = S.rec) => (r ? (r.paused ? r.pausedAt : Date.now()) - r.start - r.pausedTotal : 0);

Rec.tip = (text) => {
  const wrap = el.sendBtn?.parentNode;
  if (!wrap) return;
  wrap.querySelector('.rec-tip')?.remove();
  const tip = h('div', { class: 'rec-tip' }, text);
  wrap.append(tip);
  setTimeout(() => tip.classList.add('hide'), 1900);
  setTimeout(() => tip.remove(), 2200);
};

Rec.toggleMode = () => {
  App.recMode = App.recMode === 'round' ? 'voice' : 'round';
  save('recMode', App.recMode);
  App.updateSendBtn(true);
  navigator.vibrate?.(8);
  Rec.tip(App.recMode === 'round' ? 'برای ضبط ویدیو نگه دارید، برای صدا بزنید.' : 'برای ضبط صدا نگه دارید، برای ویدیو بزنید.');
};

// pointer gestures on the send / mic button
Rec.bind = (btn) => {
  btn.style.touchAction = 'none';
  let st = null;
  btn.addEventListener('pointerdown', (e) => {
    const mode = btn.dataset.mode;
    if ((mode !== 'mic' && mode !== 'round') || e.button > 0) return;
    e.preventDefault();
    st = { x: e.clientX, y: e.clientY, started: false };
    try { btn.setPointerCapture(e.pointerId); } catch {}
    st.timer = setTimeout(() => {
      if (!st) return;
      st.started = true;
      Rec.start(App.recMode === 'round' ? 'round' : 'voice', { hold: true });
    }, Rec.HOLD_MS);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!st?.started) return;
    const r = S.rec;
    if (!r || r.locked) return;
    const dx = e.clientX - st.x, dy = Math.min(0, e.clientY - st.y);
    const toInput = document.documentElement.dir === 'rtl' ? dx : -dx; // the input sits on the other side of the button
    r.ui?.style.setProperty('--slide', Math.max(0, toInput) + 'px');
    r.ui?.style.setProperty('--lift', dy + 'px');
    if (dy < -70) Rec.lock();
    else if (toInput > 120) { st = null; Rec.ignoreClickUntil = Date.now() + 500; Rec.stop(false); navigator.vibrate?.(15); }
  });
  const up = () => {
    if (!st) return;
    clearTimeout(st.timer);
    const s = st;
    st = null;
    Rec.ignoreClickUntil = Date.now() + 500;
    if (!s.started) return Rec.toggleMode();
    if (!S.rec) { if (Rec.pending) Rec.pending.released = true; return; }
    if (S.rec.locked) return;
    Rec.stop(true);
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', () => {
    if (st?.started && S.rec && !S.rec.locked) Rec.stop(false);
    if (st) clearTimeout(st.timer);
    st = null;
  });
};

Rec.lock = () => {
  const r = S.rec;
  if (!r || r.locked) return;
  r.locked = true;
  navigator.vibrate?.(10);
  r.ui.classList.add('locked');
  r.ui.style.removeProperty('--slide');
  App.updateSendBtn();
};

Rec.buildUi = (r) => {
  const tm = h('span', { class: 'tm' }, fmtRec(0));
  const wave = h('div', { class: 'rec-wave' });
  const pauseBtn = ibtn('pause', 'توقف موقت', () => Rec.togglePause(), 'rec-pause');
  const ui = h('div', { class: 'rec-ui' + (r.locked ? ' locked' : '') + (r.kind === 'round' ? ' round' : '') },
    ibtn('trash', 'حذف', () => Rec.stop(false), 'rec-trash'),
    h('div', { class: 'rec-pill' }, h('span', { class: 'dot' }), wave, tm),
    h('div', { class: 'rec-hint' }, icon('chevron', 'flip'), 'برای لغو بکشید'),
    pauseBtn,
    h('div', { class: 'rec-lock' }, icon('lock'), icon('down', 'up')));
  Object.assign(r, { ui, tm, wave, pauseBtn });
  el.row.hidden = true;
  el.composer.append(ui);
};

Rec.tick = () => {
  const r = S.rec;
  if (!r) return;
  const ms = Rec.elapsed(r);
  r.tm.textContent = fmtRec(ms);
  if (r.analyser && !r.paused) {
    r.analyser.getByteTimeDomainData(r.buf);
    let peak = 0;
    for (const v of r.buf) peak = Math.max(peak, Math.abs(v - 128));
    const lvl = Math.min(31, Math.round((peak / 128) * 31 * 1.6));
    if (ms - (r.lastLevel || 0) >= 100) {
      r.lastLevel = ms;
      r.levels.push(lvl);
      const bar = h('i');
      bar.style.height = Math.max(3, lvl * 0.7) + 'px';
      r.wave.append(bar);
      if (r.wave.childNodes.length > 70) r.wave.firstChild.remove();
    }
    el.sendBtn?.style.setProperty('--lvl', String(1 + lvl / 60));
  }
  if (r.kind === 'round') {
    r.ring?.style.setProperty('--p', Math.min(100, (ms / 60000) * 100) + '%');
    if (ms >= 60000) return Rec.stop(true);
  }
  if (Date.now() - (r.typingAt || 0) > 4000) { r.typingAt = Date.now(); App.sendTyping(r.kind === 'round' ? 'recording_round' : 'recording', true); }
};

Rec.start = async (kind, { hold = false } = {}) => {
  if (S.rec || Rec.pending) return;
  const c = S.chats.get(S.active);
  if (!c?.can_post) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('مرورگر شما ضبط را پشتیبانی نمی‌کند (HTTPS لازم است)');
  const pending = (Rec.pending = { released: false });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(kind === 'round'
      ? { video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: true }
      : { audio: true });
  } catch {
    Rec.pending = null;
    return toast(kind === 'round' ? 'دسترسی به دوربین داده نشد' : 'دسترسی به میکروفون داده نشد');
  } finally { if (Rec.pending === pending && !stream) Rec.pending = null; }
  Rec.pending = null;
  // released while the permission prompt was open: don't start a stuck recording
  if (hold && pending.released) { stream.getTracks().forEach((t) => t.stop()); return Rec.tip('دکمه را نگه دارید تا ضبط شود.'); }
  const types = kind === 'round' ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const r = { kind, rec, stream, chunks: [], start: Date.now(), pausedTotal: 0, paused: false, locked: !hold, chatId: S.active, replyTo: S.reply?.id || null, levels: [] };
  rec.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
  rec.start(250);
  try {
    r.actx = new (window.AudioContext || window.webkitAudioContext)();
    r.analyser = r.actx.createAnalyser();
    r.analyser.fftSize = 256;
    r.actx.createMediaStreamSource(stream).connect(r.analyser);
    r.buf = new Uint8Array(r.analyser.frequencyBinCount);
  } catch {}
  S.rec = r;
  Rec.buildUi(r);
  if (kind === 'round') {
    const video = h('video', { muted: true, autoplay: true, playsinline: true });
    video.muted = true;
    video.srcObject = stream;
    r.ring = h('div', { class: 'rr-ring' });
    r.overlay = h('div', { class: 'round-rec live' }, h('div', { class: 'rr-circle' }, video, r.ring));
    document.body.append(r.overlay);
  }
  navigator.vibrate?.(12);
  r.timer = setInterval(Rec.tick, 50);
  App.updateSendBtn();
};

Rec.togglePause = () => {
  const r = S.rec;
  if (!r) return;
  try {
    if (!r.paused) { r.rec.pause(); r.paused = true; r.pausedAt = Date.now(); }
    else { r.rec.resume(); r.pausedTotal += Date.now() - r.pausedAt; r.paused = false; }
  } catch { return; }
  r.ui.classList.toggle('paused', r.paused);
  r.pauseBtn.replaceChildren(icon(r.paused ? (r.kind === 'round' ? 'camera' : 'mic') : 'pause'));
  r.pauseBtn.title = r.paused ? 'ادامه ضبط' : 'توقف موقت';
};

Rec.stop = (send) => {
  const r = S.rec;
  if (!r) return;
  S.rec = null;
  clearInterval(r.timer);
  const duration = Rec.elapsed(r) / 1000;
  r.ui?.remove();
  r.overlay?.remove();
  if (el.row) el.row.hidden = false;
  el.sendBtn?.style.removeProperty('--lvl');
  App.updateSendBtn();
  r.rec.onstop = () => {
    r.stream.getTracks().forEach((t) => t.stop());
    r.actx?.close?.();
    if (!send) return;
    if (duration < (r.kind === 'round' ? 1 : 0.7)) return Rec.tip(r.kind === 'round' ? 'برای ضبط ویدیو نگه دارید، برای صدا بزنید.' : 'برای ضبط صدا نگه دارید، برای ویدیو بزنید.');
    if (r.chatId !== S.active) return;
    const fallback = r.kind === 'round' ? 'video/webm' : 'audio/webm';
    const type = (r.rec.mimeType || fallback).split(';')[0];
    if (r.kind === 'round') {
      const file = new File([new Blob(r.chunks, { type })], `round-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
      App.upload(file, { round: true, duration, replyTo: r.replyTo, meta: { width: 480, height: 480 } });
    } else {
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([new Blob(r.chunks, { type })], `voice-${Date.now()}.${ext}`, { type });
      const wf = [];
      for (let i = 0; i < 48; i++) {
        const slice = r.levels.slice(Math.floor((i * r.levels.length) / 48), Math.floor(((i + 1) * r.levels.length) / 48));
        wf.push(slice.length ? Math.max(...slice) : 0);
      }
      App.upload(file, { voice: true, duration, replyTo: r.replyTo, meta: { waveform: r.levels.length ? wf : null } });
    }
    if (r.replyTo) { S.reply = null; App.renderComposerBar(); }
  };
  try { if (r.rec.state === 'paused') r.rec.resume(); r.rec.stop(); } catch { r.stream.getTracks().forEach((t) => t.stop()); }
};

// keep the old entry points working
App.startRecording = () => Rec.start('voice');
App.recordRound = () => Rec.start('round');
App.stopRecording = (send) => Rec.stop(send);
