'use strict';
/* Kabootar: bridge to the Android app (KabootarNative). In a normal browser every call is a no-op.
   The app gives the web UI what a WebView can't do alone:
   - real notifications from a background service (works with the app closed), reply / mark read from the notification
   - status bar + navigation bar colours that follow the theme
   - the phone gallery inside the attach sheet (like Telegram), haptics, splash screen hand-off */
const Native = (() => {
  const n = () => window.KabootarNative;
  const call = (fn, ...a) => { try { const b = n(); return b && typeof b[fn] === 'function' ? b[fn](...a) : undefined; } catch (e) { return undefined; } };
  const api = {
    get ok() { return !!n(); },
    ready() { call('ready'); },
    session(token) { call('setSession', token || ''); },
    syncPrefs() {
      if (!n() || !S.token) return;
      call('setPrefs', JSON.stringify({
        notify: S.settings.app_notify !== false,
        preview: S.settings.notify_preview !== false,
        private: S.settings.notify_private !== false,
        group: S.settings.notify_group !== false,
        channel: S.settings.notify_channel !== false,
        background: S.settings.bg_service !== false,
      }));
    },
    bars(top, bottom, lightTop, lightBottom) { call('setBars', top, bottom, !!lightTop, !!lightBottom); },
    haptic(kind = 'tap') { if (n()) call('haptic', kind); else navigator.vibrate?.(kind === 'long' ? 15 : 8); },
    mediaState() { return call('mediaPermission') || 'none' },
    requestMedia() {
      return new Promise((resolve) => {
        if (!n()) return resolve('none');
        window.KabootarOnMedia = (s) => { window.KabootarOnMedia = null; resolve(s); };
        call('requestMedia');
      });
    },
    recent(limit = 150) { try { return JSON.parse(call('recentMedia', limit) || '[]'); } catch { return []; } },
    has(perm) { return call('hasPermission', perm) === true; },
    batteryOk() { return call('isIgnoringBattery') !== false; },
    openBattery() { call('openBatterySettings'); },
    openNotifySettings() { call('openNotificationSettings'); },
    clearNotifications(chatId) { call('clearChat', Number(chatId) || 0); },
    takeLaunchChat() { return Number(call('takeLaunchChat')) || 0; },
  };
  return api;
})();
window.Native = Native;

// status / navigation bar colours = the screen behind them (Telegram Android)
// full-screen black screens (stories, photo viewer, story camera, calls) get black bars like Telegram
const DARK_OVERLAY = '.story-viewer, .lightbox, .scam, .call-ui:not(.mini)';
App.syncBars = () => {
  if (!Native.ok) return;
  if (document.querySelector(DARK_OVERLAY)) return Native.bars('#000000', '#000000', false, false);
  const css = getComputedStyle(document.documentElement);
  const surface = (css.getPropertyValue('--surface') || '').trim() || '#ffffff';
  const light = document.documentElement.dataset.theme !== 'dark';
  const hex = toHex(surface) || (light ? '#ffffff' : '#212121');
  Native.bars(hex, hex, light, light);
};
function toHex(c) {
  c = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('');
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : null;
}

// notification tapped → open that chat (native calls this; also checked once after start)
window.KabootarOpenChat = (id) => {
  id = Number(id);
  if (!id || !S.me) { App.pendingOpen = id; return; }
  UI.closeAllModals?.();
  if (S.chats.has(id)) App.openChat(id); else App.loadChats().then(() => S.chats.has(id) && App.openChat(id)).catch(() => {});
};

// overlays come and go as body children: follow them
if (typeof MutationObserver !== 'undefined' && document.body) {
  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => App.syncBars?.(), 16); }).observe(document.body, { childList: true });
}

// status bar / navigation bar sizes (the app draws under them like Telegram)
(() => {
  try {
    const raw = window.KabootarNative?.insets?.();
    if (raw) { const v = JSON.parse(raw); const st = document.documentElement.style; st.setProperty('--sat', (v.top || 0) + 'px'); st.setProperty('--sab', (v.bottom || 0) + 'px'); }
  } catch {}
  addEventListener('kbinsets', () => App.syncChrome?.());
})();
