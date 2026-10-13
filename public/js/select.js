'use strict';
/* Kabootar v3.9: selection like Telegram Android.
   - chat list: hold a chat to select it, tap others to add; top bar with pin / mute / archive / delete / ⋮
   - messages: hold to select and keep the finger down to drag over more messages (auto-scrolls);
     top bar: ✕, live count, copy, forward, delete; bottom: reply (one message) and forward
   - pages close with a slide (profile), never just disappear */
const isPhone = () => narrow() && typeof touchUI === 'function' && touchUI();

/* =====================================================================
   CHAT LIST SELECTION
   ===================================================================== */
const ChatSel = {
  set: null,
  last: 0,
  enter(id) {
    this.set = new Set([id]);
    document.body.classList.add('chats-selecting');
    Native.haptic?.('long');
    this.paint();
  },
  exit() {
    if (!this.set) return false;
    this.set = null;
    document.body.classList.remove('chats-selecting');
    this.paint();
    return true;
  },
  toggle(id) {
    if (!this.set) return this.enter(id);
    if (this.set.has(id)) this.set.delete(id); else this.set.add(id);
    Native.haptic?.('tap');
    if (!this.set.size) return this.exit();
    this.paint();
  },
  chats() { return this.set ? [...this.set].map((id) => S.chats.get(id)).filter(Boolean) : []; },
  rows() { return [...$$('.ci[data-id]', el.list || document), ...(App.archiveTab ? $$('.ci[data-id]', App.archiveTab.list) : [])]; },
  paint() {
    const on = !!this.set;
    for (const r of this.rows()) {
      const sel = on && this.set.has(Number(r.dataset.id));
      r.classList.toggle('csel', sel);
      if (sel && !r.querySelector('.csel-check')) r.append(h('span', { class: 'csel-check' }, icon('check')));
    }
    this.head();
    App.updateNav?.();
  },
  head() {
    if (!el.rootChats) return;
    let hd = this.hd;
    if (!this.set) { if (hd) { hd.classList.add('out'); setTimeout(() => hd.remove(), 180); this.hd = null; } return; }
    const list = this.chats();
    const n = list.length;
    const allPinned = n && list.every((c) => c.pinned_at), allMuted = n && list.every((c) => c.muted);
    const anyUnread = list.some((c) => c.unread);
    const inArchive = !!App.archiveTab;
    const canPin = !inArchive && n <= 5;
    if (!hd) {
      hd = this.hd = h('div', { class: 'csel-head' });
      (App.archiveTab ? App.archiveTab.tab : el.rootChats).append(hd);
    }
    const count = h('div', { class: 'csel-n' }, h('span', {}, fa(n)));
    if (this.prevN != null && this.prevN !== n) count.firstChild.classList.add(n > this.prevN ? 'up' : 'down');
    this.prevN = n;
    hd.replaceChildren(
      ibtn('close', 'لغو', () => this.exit()), count, h('div', { class: 'sp' }),
      canPin ? ibtn('pin', allPinned ? 'برداشتن سنجاق' : 'سنجاق کردن', () => this.apply((c) => ({ pinned: !allPinned }))) : null,
      list.some((c) => !isSaved(c)) ? ibtn(allMuted ? 'bell' : 'muted', allMuted ? 'فعال کردن اعلان' : 'بی‌صدا کردن', () => this.apply((c) => (isSaved(c) ? null : { muted: !allMuted }))) : null,
      ibtn('archive', inArchive ? 'خروج از بایگانی' : 'بایگانی', () => this.apply(() => ({ archived: !inArchive }))),
      ibtn('trash', 'حذف', () => this.remove(), 'danger'),
      ibtn('more', 'بیشتر', (e) => UI.menu([
        anyUnread ? { icon: 'checks', label: 'علامت خوانده‌شده', onClick: () => this.apply((c) => (c.unread ? { read: true } : null)) } : null,
        n === 1 && App.folders().length ? { icon: 'folder', label: 'افزودن به پوشه', onClick: () => { const c = list[0]; this.exit(); App.addToFolderDialog(c); } } : null,
        { icon: 'select', label: 'انتخاب همه', onClick: () => { for (const r of this.rows()) this.set.add(Number(r.dataset.id)); this.paint(); } },
      ], { anchor: e.currentTarget })));
  },
  async apply(fn) {
    const list = this.chats();
    this.exit();
    for (const c of list) {
      const body = fn(c);
      if (body) await App.chatSetting(c, body);
    }
  },
  async remove() {
    const list = this.chats();
    if (list.length === 1) { this.exit(); return App.leaveOrDelete(list[0]); }
    const ok = await UI.ask(`حذف ${fa(list.length)} گفتگو`, 'گفتگوهای خصوصی برای هر دو طرف حذف می‌شوند و از گروه‌ها و کانال‌ها خارج می‌شوید.', 'حذف', true);
    if (!ok) return;
    this.exit();
    for (const c of list) {
      try {
        if (c.type === 'private') await api('DELETE', `/api/chats/${c.id}`);
        else await api('POST', `/api/chats/${c.id}/leave`);
        App.removeChat(c.id);
      } catch (e) { toast(e.message); }
    }
  },
};
window.ChatSel = ChatSel;

(() => {
  // a hold on a chat (long press, or Android's own contextmenu for it) selects instead of opening the menu
  const origChatMenu = App.chatMenu;
  App.chatMenu = (c, e) => {
    if (!isPhone()) return origChatMenu(c, e);
    const now = Date.now();
    if (now - ChatSel.last < 650) return; // long press + contextmenu arrive together
    ChatSel.last = now;
    if (!ChatSel.set) ChatSel.enter(c.id); else ChatSel.toggle(c.id);
  };
  // the finger lifting after a hold is not a tap (it would undo the selection right away)
  let downAt = 0;
  document.addEventListener('touchstart', () => { downAt = Date.now(); }, { passive: true, capture: true });
  const liftAfterHold = () => typeof touchUI === 'function' && touchUI() && Date.now() - downAt > 450;
  document.addEventListener('click', (e) => {
    if (S.select && e.target.closest?.('.messages .msg') && liftAfterHold()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // while selecting, a tap adds / removes the chat instead of opening it
  document.addEventListener('click', (e) => {
    if (!ChatSel.set) return;
    const row = e.target.closest?.('.ci');
    if (!row || !row.closest('#sidebar')) return;
    e.preventDefault();
    e.stopPropagation();
    if (row.dataset.id && !liftAfterHold()) ChatSel.toggle(Number(row.dataset.id));
  }, true);
  const origRender = App.renderSidebar;
  App.renderSidebar = (...a) => { const r = origRender(...a); if (ChatSel.set) ChatSel.paint(); return r; };
  const origArchive = App.renderArchive;
  App.renderArchive = (...a) => { const r = origArchive(...a); if (ChatSel.set) ChatSel.paint(); return r; };
  const origUpdateNav = App.updateNav;
  App.updateNav = (...a) => { const r = origUpdateNav?.(...a); el.bottomNav?.classList.toggle('hide-sel', !!ChatSel.set); return r; };
  const origOpen = App.openChat;
  App.openChat = (...a) => { ChatSel.exit(); return origOpen(...a); };
  const origBack = window.KabootarBack;
  window.KabootarBack = () => (ChatSel.exit() ? true : origBack ? origBack() : false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ChatSel.set && !$('.modal-wrap') && !$('.menu')) ChatSel.exit(); });
})();

/* =====================================================================
   MESSAGE SELECTION
   ===================================================================== */
(() => {
  const selectedMsgs = () => {
    const st = S.msgs.get(App.mkey());
    return (st?.list || []).filter((m) => S.select?.has(m.id)).sort((a, b) => a.id - b.id);
  };
  let prevN = null;
  App.renderSelectHeader = () => {
    const n = S.select?.size || 0;
    const c = S.chats.get(S.active);
    if (!c) return;
    const msgs = selectedMsgs();
    const canDelete = msgs.length && msgs.every((m) => m.sender.id === S.me.id || c.type === 'private' || c.can_manage);
    const texts = msgs.filter((m) => m.text && m.kind !== 'poll');
    const count = h('div', { class: 'sel-n' }, h('span', {}, fa(n)));
    if (prevN != null && prevN !== n) count.firstChild.classList.add(n > prevN ? 'up' : 'down');
    prevN = n;
    el.head.classList.add('sel-head');
    el.head.replaceChildren(
      ibtn('close', 'لغو انتخاب', () => App.exitSelect(), 'sel-x'), count, h('div', { class: 'sp' }),
      texts.length ? ibtn('copy', 'کپی', () => { copyText(texts.map((m) => R.stripMarkup(m.text).replace(/▒+/g, '')).join('\n\n')); App.exitSelect(); }) : null,
      msgs.some((m) => m.kind !== 'call') ? ibtn('forward', 'بازارسال', () => { const ids = [...S.select]; App.exitSelect(); App.forwardDialog(ids); }) : null,
      canDelete ? ibtn('trash', 'حذف', async () => { if (await App.deleteMessages([...S.select])) App.exitSelect(); }, 'danger') : null);
  };
  App.renderSelectBar = () => {
    if (!S.select) return;
    const c = S.chats.get(S.active);
    const msgs = selectedMsgs();
    el.bottom.dataset.mode = 'select';
    el.input = null;
    el.bottom.replaceChildren(h('div', { class: 'select-bar tg-sel' },
      msgs.length === 1 && c?.can_post ? h('button', { type: 'button', class: 'sb-btn', onclick: () => { const m = msgs[0]; App.exitSelect(); App.startReply(m); } }, icon('reply'), 'پاسخ') : h('span'),
      h('button', { type: 'button', class: 'sb-btn', disabled: !msgs.length, onclick: () => { const ids = [...S.select]; App.exitSelect(); App.forwardDialog(ids); } }, icon('forward'), 'بازارسال')));
  };
  const origExit = App.exitSelect;
  App.exitSelect = (silent) => { prevN = null; el.head?.classList.remove('sel-head'); App.dragSelecting = false; drag = null; return origExit(silent); };

  /* ---------- drag to select (keep the finger down after the hold) ---------- */
  let touch = null, drag = null, raf = 0;
  const idsOf = (row) => (row.dataset.ids ? row.dataset.ids.split(',').map(Number) : [Number(row.dataset.id)]);
  const paintRows = () => {
    for (const r of $$('.msg[data-id]', el.inner)) r.classList.toggle('selected', idsOf(r).every((id) => S.select.has(id)));
  };
  const rowAt = (y) => {
    const box = el.messages.getBoundingClientRect();
    const n = document.elementFromPoint?.(box.left + box.width / 2, Math.max(box.top + 2, Math.min(box.bottom - 2, y)));
    return n?.closest?.('.msg[data-id]') || null;
  };
  const update = () => {
    if (!drag || !S.select) return;
    const rows = $$('.msg[data-id]', el.inner);
    const r = rowAt(drag.y);
    if (!r) return;
    const ai = rows.findIndex((x) => idsOf(x).includes(drag.anchor));
    const bi = rows.indexOf(r);
    if (ai < 0 || bi < 0) return;
    const [a, b] = ai < bi ? [ai, bi] : [bi, ai];
    const next = new Set(drag.base);
    for (let i = a; i <= b; i++) for (const id of idsOf(rows[i])) next.add(id);
    if (next.size === S.select.size && [...next].every((id) => S.select.has(id))) return;
    S.select = next;
    Native.haptic?.('tick');
    paintRows();
    App.renderSelectHeader();
    App.renderSelectBar();
  };
  const autoScroll = () => {
    cancelAnimationFrame(raf);
    if (!drag) return;
    const box = el.messages.getBoundingClientRect();
    const edge = 80;
    let v = 0;
    if (drag.y < box.top + edge) v = -Math.ceil((box.top + edge - drag.y) / 6);
    else if (drag.y > box.bottom - edge) v = Math.ceil((drag.y - (box.bottom - edge)) / 6);
    if (v) { el.messages.scrollTop += v; update(); }
    raf = requestAnimationFrame(autoScroll);
  };
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touch = null; return; }
    const t = e.touches[0];
    touch = { y: t.clientY, inMsgs: !!e.target.closest?.('.messages') };
  }, { passive: true, capture: true });
  const stop = () => { touch = null; if (drag) { drag = null; App.dragSelecting = false; cancelAnimationFrame(raf); } };
  document.addEventListener('touchend', stop, true);
  document.addEventListener('touchcancel', stop, true);
  const origEnter = App.enterSelect;
  App.enterSelect = (ids = []) => {
    const r = origEnter(ids);
    if (touch?.inMsgs && isPhone() && ids.length) {
      drag = { base: new Set(S.select), anchor: ids[0], y: touch.y };
      App.dragSelecting = true;
    }
    return r;
  };
  document.addEventListener('touchmove', (e) => {
    if (!drag || !S.select) return;
    e.preventDefault(); // the list doesn't scroll under the finger while selecting
    drag.y = e.touches[0].clientY;
    update();
    autoScroll();
  }, { passive: false });

  /* ---------- the profile page slides away instead of vanishing ---------- */
  const origClose = App.closeInfo;
  App.closeInfo = (noAnim) => {
    const info = $('#info');
    if (noAnim !== true && info && !info.hidden && narrow() && S.settings.animations !== false && document.body.classList.contains('info-open')) {
      const ghost = info.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.classList.add('info-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      document.body.append(ghost);
      setTimeout(() => ghost.remove(), 320);
    }
    return origClose();
  };
})();
