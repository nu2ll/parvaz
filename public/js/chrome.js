'use strict';
/* Kabootar v4: the chat screen is laid out like the new Telegram for Android.
   The message list fills the whole screen and scrolls UNDER floating glass pieces:
   top = back circle · name pill · actions pill, then the pinned-message pill;
   bottom = one rounded glass card (reply / edit preview inside it, emoji, text, attach) with the
   send / mic circle in its corner; the "down" button floats on the side with its counter on top. */
(() => {
  const origBuild = App.buildChatArea;
  App.buildChatArea = () => {
    origBuild();
    const chat = $('#chat');
    // header pieces go into one overlay at the top
    el.topWrap = h('div', { class: 'chat-top' });
    chat.insertBefore(el.topWrap, el.head);
    el.topWrap.append(el.head, el.topbars, el.searchBar);
    chat.classList.add('overlay-chrome');
    // the list keeps its content clear of the overlays (their size changes: pinned bar, reply, long text…)
    const sync = () => {
      const top = el.topWrap.hidden ? 0 : el.topWrap.offsetHeight || 0;
      const bottom = el.bottom.hidden ? 0 : el.bottom.offsetHeight || 0;
      const before = chat.style.getPropertyValue('--bottom-h');
      chat.style.setProperty('--top-h', top + 'px');
      chat.style.setProperty('--bottom-h', bottom + 'px');
      if (before !== bottom + 'px' && App.stick && el.messages) el.messages.scrollTop = el.messages.scrollHeight;
    };
    App.syncChrome = sync;
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => requestAnimationFrame(sync));
      ro.observe(el.topWrap);
      ro.observe(el.bottom);
    }
    sync();
  };
  // the top overlay follows the chat (hidden on the empty screen)
  const origEmpty = App.showEmpty;
  App.showEmpty = (...a) => { const r = origEmpty(...a); if (el.topWrap) el.topWrap.hidden = true; return r; };
  const origOpen = App.openChat;
  App.openChat = (...a) => { if (el.topWrap) el.topWrap.hidden = false; const r = origOpen(...a); App.syncChrome?.(); return r; };
  const origChrome = App.renderChatChrome;
  App.renderChatChrome = (...a) => { const r = origChrome(...a); requestAnimationFrame(() => App.syncChrome?.()); return r; };
})();
