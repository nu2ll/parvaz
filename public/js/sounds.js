'use strict';
/* Kabootar: Telegram-like sound effects, synthesised with WebAudio (no audio files to load).
   out        message sent (in-chat)                  in        message received in the open chat
   notify     new message in another chat             reaction  someone reacted to your message
   recStart / recSend / recCancel                     voice / video message recording
   ringback (loop), ringtone (loop), connected, busy, callEnd   calls
   Settings → Notifications: "in-app sounds" (sound) and "in-chat sounds" (chat_sounds). */

const Sound = {
  ctx: null,
  loops: new Map(),
  get ac() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  },
  // one enveloped voice: freq (or [from, to] sweep), start offset, length, peak gain, wave
  voice(ctx, t0, { f, d = 0, len = 0.12, g = 0.08, type = 'sine', attack = 0.008 }) {
    const o = ctx.createOscillator(), gain = ctx.createGain();
    o.type = type;
    const t = t0 + d;
    if (Array.isArray(f)) { o.frequency.setValueAtTime(f[0], t); o.frequency.exponentialRampToValueAtTime(f[1], t + len); }
    else o.frequency.setValueAtTime(f, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(g, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(gain).connect(this.out(ctx));
    o.start(t); o.stop(t + len + 0.02);
  },
  noise(ctx, t0, { d = 0, len = 0.15, g = 0.05, freq = 1800 }) {
    const n = Math.floor(ctx.sampleRate * len);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buf; filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 0.8;
    gain.gain.value = g;
    src.connect(filt).connect(gain).connect(this.out(ctx));
    src.start(t0 + d);
  },
  out(ctx) {
    if (!this.master || this.master.context !== ctx) { this.master = ctx.createGain(); this.master.gain.value = 1; this.master.connect(ctx.destination); }
    return this.master;
  },
  patterns: {
    // short "pop-swoosh" like Telegram's sent sound
    out: (S, c, t) => { S.voice(c, t, { f: [520, 1250], len: 0.09, g: 0.07 }); S.noise(c, t, { len: 0.07, g: 0.025, freq: 3200 }); },
    // soft two-drop "blop" for messages arriving in the open chat
    in: (S, c, t) => { S.voice(c, t, { f: [980, 620], len: 0.1, g: 0.07 }); S.voice(c, t, { f: 1320, d: 0.07, len: 0.12, g: 0.035 }); },
    // Telegram "note": bright three-note chime
    notify: (S, c, t) => {
      for (const [f, d] of [[1175, 0], [1568, 0.11], [2093, 0.22]]) {
        S.voice(c, t, { f, d, len: 0.42, g: 0.06, type: 'triangle' });
        S.voice(c, t, { f: f * 2, d, len: 0.2, g: 0.012 });
      }
    },
    reaction: (S, c, t) => { S.voice(c, t, { f: [700, 1400], len: 0.12, g: 0.05, type: 'triangle' }); },
    recStart: (S, c, t) => { S.voice(c, t, { f: [600, 1000], len: 0.11, g: 0.07 }); },
    recSend: (S, c, t) => { S.voice(c, t, { f: [1000, 640], len: 0.11, g: 0.07 }); },
    recCancel: (S, c, t) => { S.noise(c, t, { len: 0.22, g: 0.07, freq: 900 }); S.voice(c, t, { f: [420, 180], len: 0.2, g: 0.04, type: 'triangle' }); },
    connected: (S, c, t) => { S.voice(c, t, { f: 660, len: 0.12, g: 0.06 }); S.voice(c, t, { f: 990, d: 0.13, len: 0.16, g: 0.06 }); },
    callEnd: (S, c, t) => { for (const [f, d] of [[880, 0], [660, 0.16], [440, 0.32]]) S.voice(c, t, { f, d, len: 0.14, g: 0.06 }); },
    busy: (S, c, t) => { for (const d of [0, 0.5, 1.0]) S.voice(c, t, { f: 425, d, len: 0.25, g: 0.06, attack: 0.02 }); },
    ringback: (S, c, t) => { S.voice(c, t, { f: 425, len: 1.0, g: 0.05, attack: 0.03 }); S.voice(c, t, { f: 450, len: 1.0, g: 0.02, attack: 0.03 }); },
    ringtone: (S, c, t) => {
      for (const [f, d] of [[784, 0], [988, 0.18], [1175, 0.36], [988, 0.54], [784, 0.9], [988, 1.08], [1175, 1.26], [1568, 1.44]]) S.voice(c, t, { f, d, len: 0.22, g: 0.06, type: 'triangle' });
    },
  },
  periods: { ringback: 4000, ringtone: 3200 },
  enabled(name) {
    const st = typeof S !== 'undefined' ? S.settings || {} : {};
    if (['out', 'in', 'recStart', 'recSend', 'recCancel', 'reaction'].includes(name)) return st.chat_sounds !== false;
    if (name === 'notify') return st.sound !== false;
    return true; // call tones always play
  },
  play(name, force) {
    if (!force && !this.enabled(name)) return;
    const ctx = this.ac;
    const p = this.patterns[name];
    if (!ctx || !p) return;
    try { p(this, ctx, ctx.currentTime + 0.01); } catch {}
  },
  loop(name) {
    this.stop(name);
    this.play(name, true);
    this.loops.set(name, setInterval(() => this.play(name, true), this.periods[name] || 3000));
  },
  stop(name) {
    if (name == null) { for (const k of [...this.loops.keys()]) this.stop(k); return; }
    clearInterval(this.loops.get(name));
    this.loops.delete(name);
  },
};
// browsers only allow audio after a gesture: unlock on the first tap / key
['pointerdown', 'keydown', 'touchstart'].forEach((t) => document.addEventListener(t, () => { if (Sound.ctx?.state === 'suspended') Sound.ctx.resume(); else if (!Sound.ctx) Sound.ac; }, { once: true, passive: true }));
