'use strict';
/* Kabootar v3.9: Telegram Android fixes layered on top (emoji dock, taps, stories bar, reactions). */
(() => {
  const phone = () => narrow() && typeof touchUI === 'function' && touchUI();

  /* ---------- keyboard height (the emoji panel takes exactly its place) ---------- */
  let base = innerHeight;
  const kbH = () => Math.max(240, Math.min(420, Number(store('kbHeight', 0)) || Math.round(innerHeight * 0.4)));
  const onResize = () => {
    const vh = window.visualViewport ? visualViewport.height : innerHeight;
    const typing = document.activeElement === el.input;
    if (!typing) base = Math.max(base, vh);
    else if (base - vh > 150) {
      save('kbHeight', Math.round(base - vh));
      if (UI.emojiOpen?.() && document.body.classList.contains('emoji-docked')) UI.closeEmoji(true);
    }
  };
  addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  addEventListener('orientationchange', () => { base = 0; setTimeout(() => { base = innerHeight; }, 400); });

  const origToggle = App.toggleEmoji;
  App.toggleEmoji = () => {
    if (!phone() || !el.bottom) return origToggle();
    if (UI.emojiOpen()) {            // keyboard icon: back to typing
      UI.closeEmoji(true);
      el.input?.focus();
      return;
    }
    UI.emojiDropdown(el.emojiBtn, {
      dock: el.bottom, height: kbH(),
      onEmoji: (e) => App.insertText(e, true),
      onSticker: (st) => { App.sendSticker(st); },
      onGif: (g) => { App.sendGif(g); UI.closeEmoji(true); },
    });
    el.input?.blur();                // the keyboard goes away, the panel is already where it was
    el.emojiBtn?.replaceChildren(icon('keyboard'));
    App.sendTyping('choosing_sticker');
  };
  UI.onEmojiClosed = () => { if (el.emojiBtn) el.emojiBtn.replaceChildren(icon('smile')); };
  document.addEventListener('focusin', (e) => {
    if (e.target === el.input && document.body.classList.contains('emoji-docked')) setTimeout(() => UI.closeEmoji(true), 260);
  });

  // the panel never stays behind on the chat list (the GIF panel in the screenshot)
  for (const fn of ['showEmpty', 'openChat', 'closeChat', 'teardown']) {
    const o = App[fn];
    if (typeof o === 'function') App[fn] = function (...a) { UI.closeEmoji?.(true); return o.apply(this, a); };
  }
  const origBack = window.KabootarBack;
  window.KabootarBack = () => { if (UI.emojiOpen?.()) { UI.closeEmoji(true); return true; } return origBack ? origBack() : false; };

  /* ---------- messages: tap beside the bubble = menu, hold anywhere = select ---------- */
  const origTaps = App.androidTaps;
  App.androidTaps = (row, bubble, c, m, group) => {
    const r = origTaps ? origTaps(row, bubble, c, m, group) : false;
    if (!r) return r;
    row.addEventListener('click', (e) => {
      if (S.select || bubble.contains(e.target) || e.target.closest('.av-slot .avatar') || m.kind === 'service') return;
      App.messageMenu(c, m, { clientX: e.clientX, clientY: e.clientY, preventDefault() {}, row }, group);
    });
    UI.longPress(row, (e) => {
      if (S.select || (e.target && bubble.contains(e.target)) || m.kind === 'service') return;
      Native.haptic?.('long');
      App.enterSelect(group ? group.map((x) => x.id) : [m.id]);
    });
    return r;
  };
  // Android fires "contextmenu" on a long press: on phones a hold selects, it doesn't open the menu
  document.addEventListener('contextmenu', (e) => {
    if (typeof touchUI === 'function' && touchUI() && e.target.closest?.('.messages .msg')) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ---------- reactions: every Telegram reaction, expandable like Telegram ---------- */
  const origMenu = App.messageMenu;
  App.messageMenu = (...a) => {
    const r = origMenu(...a);
    const pop = $('.reactions-pop');
    if (pop && !pop.querySelector('.rx-more')) {
      const more = h('button', { type: 'button', class: 'rx-more', title: 'همه‌ی واکنش‌ها', onclick: (e) => { e.stopPropagation(); pop.classList.toggle('all'); } }, icon('chevron'));
      pop.append(more);
    }
    return r;
  };

  /* ---------- stories: "my story" is always first, with a + when you have none ---------- */
  Stories.renderBar = function (box) {
    if (!box) return;
    const f = this.feed || { me: null, users: [] };
    const stack = el.storyStack;
    if (S.settings.stories_hidden || S.archived || !S.me) { box.hidden = true; if (stack) stack.hidden = true; return; }
    const me = f.me;
    if (stack) {
      const top = [...f.users.filter((e) => e.unseen), ...f.users.filter((e) => !e.unseen)].slice(0, 2);
      const mine = h('span', { class: 'ss me' + (me ? ' mine' : ' none') }, userAvatar(S.me, 's32'), me ? null : h('span', { class: 'ss-plus' }, icon('plus')));
      stack.replaceChildren(mine, ...top.map((e) => h('span', { class: 'ss' + (e.unseen ? ' unseen' : '') }, userAvatar(e.user, 's32'))));
      stack.hidden = false;
    }
    const items = [h('button', { type: 'button', class: 'story-item me', onclick: () => (me ? this.openEntry(me) : this.compose()) },
      h('span', { class: 'ring' + (me ? ' mine' : ' none') }, userAvatar(S.me, 's54')), !me ? h('span', { class: 'plus' }, icon('plus')) : null,
      h('span', { class: 'nm' }, 'استوری من'))];
    for (const e of f.users) {
      items.push(h('button', { type: 'button', class: 'story-item', onclick: () => this.openEntry(e) },
        h('span', { class: 'ring' + (e.unseen ? ' unseen' : ' seen') }, userAvatar(e.user, 's54')), h('span', { class: 'nm', dir: 'auto' }, userName(e.user).split(' ')[0])));
    }
    box.replaceChildren(...items);
    box.hidden = false;
  };
})();
