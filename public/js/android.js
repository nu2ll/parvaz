'use strict';
/* Kabootar: Telegram Android behaviour on phones.
   - the page never zooms (pinch / double-tap / iOS gesture) and text isn't selectable by accident
     (no Chrome "Tap to search" sheet); copying is in the message menu like Android
   - tap a message → menu with reactions, double tap → quick reaction, long press → select
   - swipe the chat away to go back (with parallax on the chat list)
   - stories: folded into the header by default, pull the list down to open, scroll to fold */

const touchUI = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const isRtl = () => document.documentElement.dir === 'rtl';

/* ---------- no zoom ---------- */
(() => {
  const own = (t) => t?.closest?.('.cropper, .lightbox, .story-viewer');
  document.addEventListener('gesturestart', (e) => { if (!own(e.target)) e.preventDefault(); });
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1 && !own(e.target)) e.preventDefault(); }, { passive: false });
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    // stop double-tap zoom on old browsers that ignore touch-action
    if (now - lastEnd < 300 && !e.target.closest?.('input, textarea, [contenteditable], .msg')) e.preventDefault();
    lastEnd = now;
  }, { passive: false });
})();

/* ---------- message taps (Android) ---------- */
const PASSIVE_TARGETS = 'a, button, input, textarea, audio, video, img.emoji-img, .photo, .album, .sticker-box, .voice, .filecard, .quote, .spoiler, .reactions, .poll, .webpage, .round, .video-note, .fwd-from, .sender, .sel-box, .call-card, .story-reply';
App.androidTaps = (row, bubble, c, m, group) => {
  if (!touchUI()) return false;
  let timer = null, lastTap = 0;
  bubble.addEventListener('click', (e) => {
    if (S.select || e.target.closest(PASSIVE_TARGETS)) return;
    const now = Date.now();
    if (now - lastTap < 280) {
      clearTimeout(timer); lastTap = 0;
      const emo = S.config.reactions?.includes('❤️') ? '❤️' : S.config.reactions?.[0];
      if (emo && m.kind !== 'service') { App.react(m, emo); App.burst(bubble, emo); navigator.vibrate?.(8); }
      return;
    }
    lastTap = now;
    const p = { clientX: e.clientX, clientY: e.clientY };
    timer = setTimeout(() => { lastTap = 0; App.messageMenu(c, m, { ...p, preventDefault() {}, row }, group); }, 260);
  });
  UI.longPress(bubble, () => {
    if (S.select) return;
    navigator.vibrate?.(15);
    App.enterSelect(group ? group.map((x) => x.id) : [m.id]);
  });
  return true;
};
// little reaction pop over the bubble (double tap)
App.burst = (bubble, emo) => {
  const b = h('span', { class: 'react-burst' }, emo);
  bubble.append(b);
  setTimeout(() => b.remove(), 700);
};

/* ---------- swipe back (chat → list) ---------- */
(() => {
  let st = null;
  const chatEl = () => $('#chat');
  document.addEventListener('touchstart', (e) => {
    if (!document.body.classList.contains('chat-open') || innerWidth > 760 || e.touches.length !== 1) return;
    const chat = chatEl();
    if (!chat?.contains(e.target) || e.target.closest('.composer, .emoji-pop, input, textarea, .rec-ui, .round-rec, .call-ui, .lightbox, .modal-wrap, .menu')) return;
    const t = e.touches[0];
    st = { x: t.clientX, y: t.clientY, dx: 0, on: false, t0: Date.now() };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!st) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    const back = isRtl() ? -dx : dx; // the chat leaves towards where it came from
    if (!st.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
      if (back < 14 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      st.on = true;
      document.body.classList.add('swiping');
    }
    st.dx = Math.max(0, back);
    const w = innerWidth;
    chatEl().style.transform = `translateX(${(isRtl() ? -1 : 1) * st.dx}px)`;
    const side = $('#sidebar');
    if (side) side.style.transform = `translateX(${(isRtl() ? 1 : -1) * (w * 0.25) * (1 - st.dx / w)}px)`;
    document.body.style.setProperty('--dim', String(0.3 * (1 - st.dx / w)));
  }, { passive: true });
  const end = () => {
    if (!st) return;
    const s = st;
    st = null;
    if (!s.on) return;
    const speed = s.dx / Math.max(1, Date.now() - s.t0);
    const go = s.dx > innerWidth * 0.33 || speed > 0.6;
    const chat = chatEl(), side = $('#sidebar');
    document.body.classList.add('swipe-settle');
    chat.style.transform = go ? `translateX(${(isRtl() ? -1 : 1) * innerWidth}px)` : '';
    if (side) side.style.transform = go ? 'none' : '';
    document.body.style.setProperty('--dim', go ? '0' : '0.3');
    setTimeout(() => {
      document.body.classList.remove('swiping', 'swipe-settle');
      chat.style.transform = '';
      if (side) side.style.transform = '';
      document.body.style.removeProperty('--dim');
      if (go) { document.body.classList.add('no-anim-once'); App.closeChat(); setTimeout(() => document.body.classList.remove('no-anim-once'), 50); }
    }, 220);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();

/* ---------- stories: folded by default, pull down to open ---------- */
App.storiesState = { open: false };
App.setStoriesOpen = (open) => {
  App.storiesState.open = open;
  const tab = el.mainTab;
  if (!tab) return;
  tab.classList.remove('stories-pulling');
  tab.style.removeProperty('--pull');
  tab.classList.toggle('stories-collapsed', !open);
  tab.classList.toggle('stories-open', open);
};
App.bindStoriesPull = () => {
  const list = el.list, tab = el.mainTab;
  if (!list || !tab) return;
  App.setStoriesOpen(false);
  const has = () => el.storiesBar && !el.storiesBar.hidden;
  let st = null;
  list.addEventListener('touchstart', (e) => {
    if (!has() || App.storiesState.open || list.scrollTop > 0 || e.touches.length !== 1) return;
    st = { y: e.touches[0].clientY, p: 0 };
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!st) return;
    const dy = e.touches[0].clientY - st.y;
    if (dy <= 0) { if (st.p) { tab.style.setProperty('--pull', '0'); } return; }
    st.p = Math.min(1, dy / 140);
    tab.classList.add('stories-pulling');
    tab.classList.remove('stories-collapsed');
    tab.style.setProperty('--pull', st.p.toFixed(3));
  }, { passive: true });
  const end = () => {
    if (!st) return;
    const p = st.p;
    st = null;
    if (!p) return;
    App.setStoriesOpen(p > 0.4);
    if (p > 0.4) navigator.vibrate?.(8);
  };
  list.addEventListener('touchend', end);
  list.addEventListener('touchcancel', end);
  // scrolling the list folds them back; mouse wheel up at the top opens them (desktop)
  let lastTop = 0;
  list.addEventListener('scroll', () => {
    if (App.storiesState.open && list.scrollTop > lastTop && list.scrollTop > 6) App.setStoriesOpen(false);
    lastTop = list.scrollTop;
  }, { passive: true });
  list.addEventListener('wheel', (e) => {
    if (!has()) return;
    if (e.deltaY < -20 && list.scrollTop <= 0 && !App.storiesState.open) App.setStoriesOpen(true);
    else if (e.deltaY > 0 && App.storiesState.open) App.setStoriesOpen(false);
  }, { passive: true });
};
