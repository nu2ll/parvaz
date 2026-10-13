'use strict';
/* Kabootar — local passcode lock. The session token is encrypted (AES-GCM, key = PBKDF2(passcode)),
   so while locked nothing on this device can talk to the server. Also boots the app. */

const Lock = {
  key: null,
  data: () => store('lock', null),
  enabled() { return !!this.data(); },
  supported: () => !!(window.crypto && crypto.subtle),
  b64: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  unb64: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  async derive(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async encryptToken(key, token) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token || ''));
    return { iv: this.b64(iv), ct: this.b64(ct) };
  },
  async set(pass) {
    if (!this.supported()) throw new Error('برای کد قفل اتصال امن (HTTPS) لازم است');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await this.derive(pass, salt);
    const enc = await this.encryptToken(key, S.token);
    save('lock', { salt: this.b64(salt), ...enc, autolock: this.data()?.autolock ?? 60 });
    save('token', null); // only the encrypted copy remains on disk
    this.key = key;
  },
  async storeToken(token) {
    const d = this.data();
    if (!d || !this.key) return save('token', token);
    save('lock', { ...d, ...(await this.encryptToken(this.key, token)) });
  },
  async unlock(pass) {
    const d = this.data();
    const key = await this.derive(pass, this.unb64(d.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.unb64(d.iv) }, key, this.unb64(d.ct)); // throws on wrong passcode
    this.key = key;
    return new TextDecoder().decode(pt);
  },
  async disable() {
    if (S.token) save('token', S.token);
    save('lock', null);
    this.key = null;
  },
  forget() { save('lock', null); this.key = null; },
  autolock() { return this.data()?.autolock ?? 0; },
  setAutolock(min) { const d = this.data(); if (d) save('lock', { ...d, autolock: min }); },

  lockNow() {
    if (!this.enabled()) return;
    App.teardown();
    S.token = null;
    this.key = null;
    this.showLockScreen();
  },
  showLockScreen() {
    setTimeout(() => App.bootDone?.(), 0);
    const box = $('#auth');
    box.hidden = false;
    $('#app').hidden = true;
    const pass = UI.field('کد قفل', { type: 'password', dir: 'ltr', inputmode: 'numeric', autocomplete: 'current-password' });
    const submit = h('button', { class: 'btn block', type: 'submit' }, 'باز کردن');
    const form = h('form', {}, pass, submit);
    let fails = store('lockFails', 0);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const until = store('lockUntil', 0);
      if (Date.now() < until) return toast(`چند لحظه صبر کنید (${fa(Math.ceil((until - Date.now()) / 1000))} ثانیه)`);
      submit.disabled = true;
      try {
        const token = await this.unlock(pass.input.value);
        save('lockFails', 0);
        S.token = token;
        await App.start();
      } catch {
        fails++;
        save('lockFails', fails);
        if (fails >= 5) { save('lockUntil', Date.now() + 30_000 * (fails - 4)); }
        pass.classList.add('error');
        pass.input.value = '';
        toast('کد قفل اشتباه است');
      } finally { submit.disabled = false; }
    });
    box.replaceChildren(h('div', { class: 'auth-box' },
      h('div', { class: 'auth-lock' }, icon('lock')),
      h('h1', {}, 'کبوتر قفل است'),
      h('p', { class: 'sub' }, 'برای ادامه کد قفل را وارد کنید.'),
      form,
      h('button', { class: 'btn flat switch', type: 'button', onclick: async () => {
        if (!(await UI.ask('کد را فراموش کرده‌اید؟', 'از حساب روی این دستگاه خارج می‌شوید و باید دوباره وارد شوید. پیام‌ها روی سرور می‌مانند.', 'خروج', true))) return;
        this.forget(); save('token', null); S.token = null; App.renderAuth('login');
      } }, 'کد را فراموش کرده‌اید؟')));
    setTimeout(() => pass.input.focus(), 30);
  },
};

// auto-lock after inactivity
let lastActivity = Date.now();
for (const t of ['mousemove', 'keydown', 'touchstart', 'wheel']) document.addEventListener(t, () => (lastActivity = Date.now()), { passive: true });
setInterval(() => {
  const min = Lock.autolock();
  if (Lock.enabled() && min && S.token && Date.now() - lastActivity > min * 60_000) Lock.lockNow();
}, 15_000);

// PWA: a tiny service worker makes Kabootar installable
if (navigator.serviceWorker && /KabootarAndroid/.test(navigator.userAgent)) navigator.serviceWorker.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
else if (navigator.serviceWorker && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

App.boot();
