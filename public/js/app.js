'use strict';
/* Kabootar web client — main app: auth, sidebar, chat view, composer, realtime. */

const App = {};
const el = {}; // cached DOM nodes
const narrow = () => matchMedia('(max-width: 760px)').matches;

/* =====================================================================
   AUTH
   ===================================================================== */
App.renderAuth = (mode = 'login') => {
  const box = $('#auth');
  box.hidden = false;
  $('#app').hidden = true;
  const login = mode === 'login';
  const user = UI.field('نام کاربری', { name: 'username', autocomplete: 'username', dir: 'ltr', required: true, maxlength: 32, placeholder: 'username' },
    login ? null : 'حروف انگلیسی، عدد و _ (حداقل ۴ حرف)');
  const name = login ? null : UI.field('نام نمایشی', { name: 'display_name', maxlength: 64 });
  const pass = UI.field('رمز عبور', { name: 'password', type: 'password', autocomplete: login ? 'current-password' : 'new-password', dir: 'ltr', required: true, minlength: 8, maxlength: 128 },
    login ? null : 'حداقل ۸ کاراکتر');
  const submit = h('button', { class: 'btn block', type: 'submit' }, login ? 'ورود' : 'ساخت حساب');
  const form = h('form', { autocomplete: 'on' }, user, name, pass, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const body = { username: user.input.value.trim(), password: pass.input.value };
      if (!login) body.display_name = name.input.value.trim() || body.username;
      const data = await api('POST', `/api/auth/${login ? 'login' : 'register'}`, body);
      S.token = data.token;
      save('token', S.token);
      S.me = data.user;
      await App.start();
    } catch (err) {
      toast(err.message);
    } finally {
      submit.disabled = false;
    }
  });
  box.replaceChildren(
    h('button', { class: 'ibtn theme-toggle', title: 'حالت شب', onclick: () => { S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); } }, icon('moon')),
    h('div', { class: 'auth-box' },
      h('img', { class: 'auth-logo', src: '/icon.svg', alt: '' }),
      h('h1', {}, 'کبوتر'),
      h('p', { class: 'sub' }, login ? 'برای ادامه وارد حساب خود شوید' : 'یک حساب جدید بسازید، فقط چند ثانیه طول می‌کشد'),
      form,
      h('button', { class: 'btn flat switch', type: 'button', onclick: () => App.renderAuth(login ? 'register' : 'login') },
        login ? 'حساب ندارید؟ ثبت‌نام' : 'حساب دارید؟ ورود')));
  setTimeout(() => user.input.focus(), 30);
};

App.logout = (expired) => {
  if (S.token && !expired) api('POST', '/api/auth/logout').catch(() => {});
  S.token = null;
  save('token', null);
  S.manualClose = true;
  if (S.ws) S.ws.close();
  Object.assign(S, { me: null, ws: null, wsReady: false, everConnected: false, active: null, reply: null, edit: null, archived: false });
  S.chats.clear(); S.msgs.clear(); S.typing.clear();
  for (const p of S.pending.values()) p.upload?.abort?.();
  S.pending.clear();
  document.body.classList.remove('chat-open');
  $('#info').hidden = true;
  document.title = 'کبوتر';
  App.renderAuth('login');
  if (expired) toast('نشست شما منقضی شد، دوباره وارد شوید');
};

App.start = async () => {
  if (!S.me) S.me = (await api('GET', '/api/me')).user;
  api('GET', '/api/config').then((c) => Object.assign(S.config, c)).catch(() => {});
  $('#auth').hidden = true;
  $('#app').hidden = false;
  App.buildShell();
  await App.loadChats();
  App.showEmpty();
  App.connect();
  App.route();
};

/* =====================================================================
   SHELL + SIDEBAR
   ===================================================================== */
App.buildShell = () => {
  const side = $('#sidebar');
  el.search = h('input', { type: 'search', placeholder: 'جستجو', autocomplete: 'off', 'aria-label': 'جستجو' });
  el.list = h('div', { class: 'list' });
  el.folders = h('div', { class: 'folders', role: 'tablist' });
  el.conn = h('div', { class: 'conn' });
  el.menuBtn = ibtn('menu', 'منو', () => App.mainMenu());
  side.replaceChildren(
    h('div', { class: 'side-head' }, el.menuBtn, h('div', { class: 'search-box' }, el.search, icon('search'))),
    el.folders, el.list, el.conn,
    h('button', { class: 'fab-new', title: 'گفتگوی جدید', onclick: (e) => App.newMenu(e.currentTarget) }, icon('edit')));
  let t;
  el.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(App.renderSidebar, 220); });
  el.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.search.value = ''; App.renderSidebar(); el.search.blur(); } });
  App.buildChatArea();
};

App.mainMenu = () => {
  const me = S.me;
  UI.menu([
    { icon: 'bookmark', label: 'پیام‌های ذخیره‌شده', onClick: () => App.openSaved() },
    { icon: 'group', label: 'گروه جدید', onClick: () => App.newChatDialog('group') },
    { icon: 'channel', label: 'کانال جدید', onClick: () => App.newChatDialog('channel') },
    { icon: 'archive', label: 'گفتگوهای بایگانی‌شده', onClick: () => { S.archived = true; App.renderSidebar(); } },
    { icon: 'settings', label: 'تنظیمات', onClick: () => App.settingsDialog() },
    'sep',
    { icon: 'moon', label: 'حالت شب', toggle: S.settings.theme === 'dark', keepOpen: true, onClick: (e) => {
      S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark';
      saveSettings(); applyTheme();
      e.currentTarget.querySelector('.switch').classList.toggle('on', S.settings.theme === 'dark');
    } },
    { icon: 'logout', label: 'خروج از حساب', danger: true, onClick: async () => { if (await UI.ask('خروج', 'از حساب خود خارج می‌شوید؟', 'خروج', true)) App.logout(false); } },
  ], {
    anchor: el.menuBtn,
    head: h('div', { class: 'menu-head', onclick: () => { UI.closeMenu(); App.settingsDialog(); } },
      userAvatar(me, 's40'), h('div', {}, h('div', { class: 'n' }, me.display_name), h('div', { class: 'u' }, '@' + me.username))),
  });
};

App.newMenu = (anchor) => UI.menu([
  { icon: 'channel', label: 'کانال جدید', onClick: () => App.newChatDialog('channel') },
  { icon: 'group', label: 'گروه جدید', onClick: () => App.newChatDialog('group') },
  { icon: 'user', label: 'پیام خصوصی جدید', onClick: () => App.newPrivateDialog() },
], { anchor, up: true });

App.loadChats = async () => {
  const { chats } = await api('GET', '/api/chats');
  S.chats.clear();
  for (const c of chats) S.chats.set(c.id, c);
  App.renderSidebar();
};

const FOLDERS = [
  ['all', 'همه', () => true],
  ['unread', 'خوانده‌نشده', (c) => c.unread > 0],
  ['private', 'شخصی', (c) => c.type === 'private'],
  ['group', 'گروه‌ها', (c) => c.type === 'group'],
  ['channel', 'کانال‌ها', (c) => c.type === 'channel'],
];
const activity = (c) => (c.last_message ? c.last_message.created_at : c.created_at);

App.sortedChats = (archived) => [...S.chats.values()]
  .filter((c) => !!c.archived === !!archived)
  .sort((a, b) => {
    if (!archived && (a.pinned_at || b.pinned_at)) {
      if (a.pinned_at && b.pinned_at) return b.pinned_at - a.pinned_at;
      return a.pinned_at ? -1 : 1;
    }
    return activity(b) - activity(a);
  });

App.renderSidebar = () => {
  if (!el.list) return;
  const q = el.search.value.trim();
  App.updateTitle();
  if (q) { el.folders.hidden = true; return App.renderSearch(q); }
  el.folders.hidden = S.archived;
  const list = el.list;
  const scroll = list.scrollTop;
  list.replaceChildren();
  if (S.archived) {
    list.append(h('div', { class: 'back-row' }, ibtn('back', 'بازگشت', () => { S.archived = false; App.renderSidebar(); }), 'بایگانی'));
    const chats = App.sortedChats(true);
    if (!chats.length) list.append(h('div', { class: 'empty-hint' }, 'بایگانی خالی است.\nگفتگوها را با کلیک راست بایگانی کنید.'));
    chats.forEach((c) => list.append(R.chatItem(c)));
    list.scrollTop = scroll;
    return;
  }
  // folders
  el.folders.replaceChildren();
  const all = App.sortedChats(false);
  for (const [key, label, fn] of FOLDERS) {
    const count = key === 'all' ? 0 : all.filter((c) => fn(c) && c.unread && !c.muted).length;
    el.folders.append(h('button', { class: 'folder' + (S.folder === key ? ' active' : ''), role: 'tab', onclick: () => { S.folder = key; App.renderSidebar(); } },
      label, count ? h('span', { class: 'count' }, fa(count)) : null));
  }
  const archivedChats = App.sortedChats(true);
  if (archivedChats.length && S.folder === 'all') {
    const unread = archivedChats.reduce((n, c) => n + (c.unread ? 1 : 0), 0);
    list.append(h('div', { class: 'ci archive-row', onclick: () => { S.archived = true; App.renderSidebar(); } },
      avatarEl({ archive: true }),
      h('div', { class: 'body' },
        h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't' }, 'بایگانی'))),
        h('div', { class: 'row' }, h('div', { class: 'preview' }, archivedChats.slice(0, 4).map(chatTitle).join('، ')), unread ? h('span', { class: 'badge muted' }, fa(unread)) : null))));
  }
  const fn = FOLDERS.find((f) => f[0] === S.folder)[2];
  const chats = all.filter(fn);
  if (!chats.length) {
    list.append(h('div', { class: 'empty-hint' }, S.folder === 'all'
      ? 'هنوز گفتگویی ندارید.\nبا دکمه ✎ پایین یک گفتگو، گروه یا کانال بسازید یا از جستجو کسی را پیدا کنید.'
      : 'گفتگویی در این بخش نیست'));
  }
  chats.forEach((c) => list.append(R.chatItem(c)));
  list.scrollTop = scroll;
};

App.updateTitle = () => {
  let n = 0;
  for (const c of S.chats.values()) if (c.unread && !c.muted) n++;
  document.title = n ? `(${fa(n)}) کبوتر` : 'کبوتر';
};

let searchSeq = 0;
App.renderSearch = async (q) => {
  const seq = ++searchSeq;
  const list = el.list;
  const local = [...S.chats.values()].filter((c) => chatTitle(c).toLowerCase().includes(q.toLowerCase()) || (c.username || '').toLowerCase().includes(q.replace(/^@/, '').toLowerCase()));
  const render = (res) => {
    if (seq !== searchSeq) return;
    list.replaceChildren();
    if (local.length) {
      list.append(h('div', { class: 'section-title' }, 'گفتگوها'));
      local.slice(0, 8).forEach((c) => list.append(R.chatItem(c)));
    }
    if (res) {
      const memberIds = new Set([...S.chats.values()].filter((c) => c.type === 'private').map((c) => c.peer.id));
      const users = res.users.filter((u) => !memberIds.has(u.id) || !local.some((c) => c.peer?.id === u.id));
      const chats = res.chats.filter((c) => !local.some((l) => l.id === c.id));
      if (users.length || chats.length) list.append(h('div', { class: 'section-title' }, 'جستجوی سراسری'));
      users.forEach((u) => list.append(h('div', { class: 'ci', onclick: () => App.openPrivateWith(u.username) }, userAvatar(u),
        h('div', { class: 'body' }, h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't', dir: 'auto' }, u.display_name))),
          h('div', { class: 'row' }, h('div', { class: 'preview', dir: 'ltr' }, '@' + u.username))))));
      chats.forEach((c) => list.append(h('div', { class: 'ci', onclick: () => App.joinDialog({ username: c.username }) },
        avatarEl({ name: c.title, avatar: c.avatar, seed: c.id * 7 + 3 }),
        h('div', { class: 'body' }, h('div', { class: 'row' }, h('div', { class: 'title' }, icon(c.type === 'channel' ? 'channel' : 'group'), h('span', { class: 't', dir: 'auto' }, c.title))),
          h('div', { class: 'row' }, h('div', { class: 'preview' }, `@${c.username} · ${membersText(c)}`))))));
      if (res.messages.length) {
        list.append(h('div', { class: 'section-title' }, 'پیام‌ها'));
        res.messages.forEach((m) => {
          const c = S.chats.get(m.chat_id);
          if (!c) return;
          list.append(h('div', { class: 'ci', onclick: () => App.openChat(c.id, { jump: m.id }) }, chatAvatar(c),
            h('div', { class: 'body' },
              h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't', dir: 'auto' }, chatTitle(c))), h('span', { class: 'time' }, fmtListTime(m.created_at))),
              h('div', { class: 'row' }, h('div', { class: 'preview', dir: 'auto' }, (c.type === 'group' ? m.sender.display_name + ': ' : '') + R.previewText(m))))));
        });
      }
      if (!local.length && !users.length && !chats.length && !res.messages.length) list.append(h('div', { class: 'empty-hint' }, 'چیزی پیدا نشد'));
    }
  };
  render(null);
  try { render(await api('GET', '/api/search?q=' + encodeURIComponent(q))); } catch (e) { toast(e.message); }
};

App.chatMenu = (c, e) => {
  const leaveLabel = c.type === 'channel' ? 'ترک کانال' : c.type === 'group' ? 'ترک گروه' : 'حذف گفتگو';
  UI.menu([
    !c.archived ? { icon: 'pin', label: c.pinned_at ? 'برداشتن سنجاق' : 'سنجاق کردن', onClick: () => App.chatSetting(c, { pinned: !c.pinned_at }) } : null,
    { icon: c.muted ? 'bell' : 'muted', label: c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن', onClick: () => App.chatSetting(c, { muted: !c.muted }) },
    { icon: 'archive', label: c.archived ? 'خروج از بایگانی' : 'بایگانی', onClick: () => App.chatSetting(c, { archived: !c.archived }) },
    c.unread ? { icon: 'checks', label: 'علامت خوانده‌شده', onClick: () => App.chatSetting(c, { read: true }) } : null,
    'sep',
    { icon: c.type === 'private' ? 'trash' : 'logout', label: leaveLabel, danger: true, onClick: () => App.leaveOrDelete(c) },
  ], { x: e.clientX, y: e.clientY });
};

App.chatSetting = async (c, body) => {
  try {
    const { chat } = await api('PATCH', `/api/chats/${c.id}/settings`, body);
    S.chats.set(chat.id, chat);
    App.renderSidebar();
    if (S.active === chat.id) App.renderChatChrome();
    if (body.archived) toast('گفتگو بایگانی شد');
  } catch (err) { toast(err.message); }
};

App.leaveOrDelete = async (c) => {
  const isPriv = c.type === 'private';
  const owner = c.role === 'owner';
  if (!isPriv && owner) {
    // owner can delete the whole group/channel or just leave
    const choice = await new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
      const m = UI.modal({
        title: c.type === 'channel' ? 'ترک کانال' : 'ترک گروه',
        body: h('p', {}, `شما مالک «${chatTitle(c)}» هستید. می‌خواهید فقط خارج شوید (مالکیت به یک ادمین یا قدیمی‌ترین عضو می‌رسد) یا آن را برای همه حذف کنید؟`),
        foot: [h('button', { class: 'btn danger', onclick: () => fin('delete') }, 'حذف برای همه'), h('button', { class: 'btn flat', onclick: () => fin('leave') }, 'فقط خروج'), h('button', { class: 'btn flat', onclick: () => fin(null) }, 'انصراف')],
        onClose: () => fin(null),
      });
    });
    if (!choice) return;
    try {
      if (choice === 'delete') await api('DELETE', `/api/chats/${c.id}`);
      else await api('POST', `/api/chats/${c.id}/leave`);
      App.removeChat(c.id);
    } catch (err) { toast(err.message); }
    return;
  }
  const ok = await UI.ask(isPriv ? 'حذف گفتگو' : 'ترک', isPriv ? (isSaved(c) ? 'همه پیام‌های ذخیره‌شده پاک می‌شوند.' : `گفتگو با ${chatTitle(c)} برای هر دو نفر حذف می‌شود.`) : `از «${chatTitle(c)}» خارج می‌شوید؟`, isPriv ? 'حذف' : 'خروج', true);
  if (!ok) return;
  try {
    if (isPriv) await api('DELETE', `/api/chats/${c.id}`);
    else await api('POST', `/api/chats/${c.id}/leave`);
    App.removeChat(c.id);
  } catch (err) { toast(err.message); }
};

App.removeChat = (id) => {
  S.chats.delete(id);
  S.msgs.delete(id);
  if (S.active === id) App.showEmpty();
  App.renderSidebar();
};

/* =====================================================================
   CHAT AREA
   ===================================================================== */
App.buildChatArea = () => {
  const chat = $('#chat');
  el.head = h('header', { class: 'chat-head' });
  el.pinned = h('div', { class: 'pinned-bar', hidden: true });
  el.searchBar = h('div', { class: 'chat-search', hidden: true });
  el.searchResults = h('div', { class: 'search-results', hidden: true });
  el.inner = h('div', { class: 'messages-inner' });
  el.messages = h('div', { class: 'messages' }, el.inner);
  el.fab = h('button', { class: 'fab-down hide', title: 'رفتن به پایین', onclick: () => App.toBottom() }, icon('down'));
  el.bottom = h('div', { class: 'bottom' });
  el.empty = h('div', { class: 'chat-empty' }, 'یک گفتگو را انتخاب کنید تا پیام‌ها نمایش داده شوند');
  chat.replaceChildren(el.empty, el.head, el.pinned, el.searchBar, el.searchResults, el.messages, el.fab, el.bottom);
  el.messages.addEventListener('scroll', App.onScroll, { passive: true });
  new ResizeObserver(() => { if (App.stick) el.messages.scrollTop = el.messages.scrollHeight; }).observe(el.inner);
  // drag & drop
  let depth = 0, zone = null;
  chat.addEventListener('dragenter', (e) => {
    if (!S.active || !e.dataTransfer?.types?.includes('Files') || !S.chats.get(S.active)?.can_post) return;
    e.preventDefault(); depth++;
    if (!zone) chat.append((zone = h('div', { class: 'drop-zone' }, 'فایل‌ها را اینجا رها کنید')));
  });
  chat.addEventListener('dragover', (e) => { if (zone) e.preventDefault(); });
  chat.addEventListener('dragleave', () => { if (zone && --depth <= 0) { zone.remove(); zone = null; depth = 0; } });
  chat.addEventListener('drop', (e) => {
    if (!zone) return;
    e.preventDefault(); zone.remove(); zone = null; depth = 0;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) App.sendFilesDialog(files, false);
  });
};

App.showEmpty = () => {
  App.saveDraft();
  S.active = null;
  App.stopRecording(false);
  document.body.classList.remove('chat-open');
  el.empty.hidden = false;
  for (const k of ['head', 'pinned', 'searchBar', 'searchResults', 'messages', 'bottom']) el[k].hidden = true;
  el.fab.classList.add('hide');
  $('#info').hidden = true;
  App.renderSidebar();
};

App.openSaved = async () => {
  const saved = [...S.chats.values()].find(isSaved);
  if (saved) return App.openChat(saved.id);
  App.openPrivateWith(S.me.username);
};

App.openPrivateWith = async (username) => {
  try {
    const { chat } = await api('POST', '/api/chats/private', { username });
    S.chats.set(chat.id, chat);
    el.search.value = '';
    App.openChat(chat.id);
  } catch (err) { toast(err.message); }
};

App.openChat = async (id, opts = {}) => {
  const c = S.chats.get(id);
  if (!c) return;
  if (S.active !== id) {
    App.saveDraft();
    App.stopRecording(false);
    S.reply = null;
    S.edit = null;
    App.closeChatSearch();
    if (narrow() && !document.body.classList.contains('chat-open')) history.pushState({ chat: id }, '');
  }
  S.active = id;
  if (c.archived && !S.archived && !el.search.value) S.archived = false;
  document.body.classList.add('chat-open');
  el.empty.hidden = true;
  el.head.hidden = el.messages.hidden = el.bottom.hidden = false;
  App.renderSidebar();
  App.renderChatChrome();
  App.sepId = null;
  const st = S.msgs.get(id);
  if (!st || opts.jump || st.stale) {
    el.inner.replaceChildren(h('div', { class: 'loading-more' }, 'در حال بارگذاری…'));
    try {
      if (opts.jump) await App.loadAround(id, opts.jump);
      else await App.loadInitial(id);
    } catch (err) { toast(err.message); return; }
    if (S.active !== id) return;
  }
  const fresh = S.chats.get(id);
  if (fresh.unread > 0) {
    const first = S.msgs.get(id).list.find((m) => m.id > fresh.last_read_id && m.sender.id !== S.me.id);
    App.sepId = first ? first.id : null;
  }
  App.renderMessages();
  if (opts.jump) App.scrollToMsg(opts.jump, true);
  else if (App.sepId) {
    const sep = $('.unread-sep', el.inner);
    App.stick = false;
    sep?.scrollIntoView({ block: 'start' });
  } else App.scrollBottom();
  App.onScroll();
  App.markRead();
  if (!narrow() && fresh.can_post) setTimeout(() => el.input?.focus(), 0);
  if (!$('#info').hidden) App.openInfo(id);
};

App.closeChat = () => {
  if (history.state?.chat) history.back();
  else App.showEmpty();
};
window.addEventListener('popstate', () => { if (document.body.classList.contains('chat-open') && narrow()) App.showEmpty(); });

App.loadInitial = async (id) => {
  const c = S.chats.get(id);
  // lots of unread: open at the first unread message instead of the bottom
  if (c && c.unread > 30 && c.last_read_id) return App.loadAround(id, c.last_read_id + 1);
  const r = await api('GET', `/api/chats/${id}/messages?limit=50`);
  S.msgs.set(id, { list: r.messages, hasMore: r.has_more, hasNewer: false });
};
App.loadAround = async (id, msgId) => {
  const r = await api('GET', `/api/chats/${id}/messages?around=${msgId}&limit=60`);
  S.msgs.set(id, { list: r.messages, hasMore: r.has_more, hasNewer: r.has_newer });
};

/* ---------- header / pinned / bottom ---------- */
App.renderChatChrome = () => {
  const c = S.chats.get(S.active);
  if (!c) return;
  App.renderHeader(c);
  App.renderPinned(c);
  App.renderBottom(c);
};

App.renderHeader = (c = S.chats.get(S.active)) => {
  if (!c) return;
  const st = R.chatStatus(c);
  el.moreBtn = ibtn('more', 'بیشتر', (e) => App.headerMenu(c, e.currentTarget));
  el.head.replaceChildren(
    ibtn('back', 'بازگشت', App.closeChat, 'back'),
    h('div', { class: 'who', onclick: () => App.toggleInfo() },
      chatAvatar(c, 's40'),
      h('div', { style: null, class: 'wt' },
        h('div', { class: 't', dir: 'auto' }, chatTitle(c)),
        st.text ? h('div', { class: 'st' + (st.accent ? ' accent' : '') }, st.text) : null)),
    ibtn('search', 'جستجو در گفتگو', () => App.openChatSearch()),
    el.moreBtn);
  $('.wt', el.head).style.minWidth = '0';
};

App.headerMenu = (c, anchor) => {
  UI.menu([
    { icon: 'info', label: c.type === 'private' ? 'مشاهده پروفایل' : c.type === 'channel' ? 'اطلاعات کانال' : 'اطلاعات گروه', onClick: () => App.openInfo(c.id) },
    { icon: 'search', label: 'جستجو', onClick: () => App.openChatSearch() },
    !isSaved(c) ? { icon: c.muted ? 'bell' : 'muted', label: c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن', onClick: () => App.chatSetting(c, { muted: !c.muted }) } : null,
    c.can_manage ? { icon: 'edit', label: 'ویرایش', onClick: () => App.editChatDialog(c) } : null,
    c.can_manage ? { icon: 'personAdd', label: c.type === 'channel' ? 'افزودن مشترک' : 'افزودن عضو', onClick: () => App.addMembersDialog(c) } : null,
    c.can_manage ? { icon: 'link', label: 'لینک دعوت', onClick: () => App.inviteDialog(c) } : null,
    'sep',
    { icon: c.type === 'private' ? 'trash' : 'logout', label: c.type === 'private' ? 'حذف گفتگو' : c.type === 'channel' ? 'ترک کانال' : 'ترک گروه', danger: true, onClick: () => App.leaveOrDelete(c) },
  ], { anchor, alignStart: true });
};

App.renderPinned = (c = S.chats.get(S.active)) => {
  const p = c?.pinned_message;
  el.pinned.hidden = !p;
  if (!p) return;
  const canUnpin = c.type === 'private' || c.can_manage;
  el.pinned.replaceChildren(
    h('div', { class: 'line' }),
    h('div', { class: 'body', onclick: () => App.jumpTo(c.id, p.id) },
      h('div', { class: 'lbl' }, 'پیام سنجاق‌شده'),
      h('div', { class: 'txt', dir: 'auto' }, R.previewText(p))),
    canUnpin ? ibtn('close', 'برداشتن سنجاق', (e) => { e.stopPropagation(); App.pin(c, null); }) : null);
};

App.renderBottom = (c = S.chats.get(S.active)) => {
  if (!c) return;
  if (c.can_post) {
    if (el.bottom.dataset.mode === 'composer' && el.bottom.dataset.chat === String(c.id)) { App.renderComposerBar(); return; }
    el.bottom.dataset.mode = 'composer';
    el.bottom.dataset.chat = String(c.id);
    App.buildComposer(c);
    return;
  }
  el.bottom.dataset.mode = 'action';
  el.bottom.dataset.chat = String(c.id);
  el.input = null;
  el.bottom.replaceChildren(h('div', { class: 'bottom-action' },
    h('button', { type: 'button', onclick: () => App.chatSetting(c, { muted: !c.muted }) }, c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن')));
};

/* ---------- messages rendering ---------- */
App.stick = true;
const sameGroup = (a, b) => a && b && a.kind !== 'service' && b.kind !== 'service' && a.sender.id === b.sender.id &&
  sameDay(new Date(a.created_at), new Date(b.created_at)) && Math.abs(b.created_at - a.created_at) < 5 * 60e3;
App.flags = (list, i) => ({ first: !sameGroup(list[i - 1], list[i]), last: !sameGroup(list[i], list[i + 1]) });
App.els = new Map();

App.renderMessages = () => {
  const c = S.chats.get(S.active);
  const st = S.msgs.get(S.active);
  if (!c || !st) return;
  const frag = document.createDocumentFragment();
  App.els = new Map();
  if (st.hasMore) frag.append(h('div', { class: 'loading-more', id: 'older' }, 'در حال بارگذاری پیام‌های قدیمی‌تر…'));
  else if (!st.list.length) frag.append(h('div', { class: 'service' }, c.type === 'channel' ? 'هنوز پستی منتشر نشده' : isSaved(c) ? 'پیام‌ها، عکس‌ها و فایل‌ها را اینجا ذخیره کنید.\nبرای ذخیره، هر پیامی را به اینجا بازارسال کنید.' : 'هنوز پیامی نیست. سلام کنید 👋'));
  let lastDay = '';
  st.list.forEach((m, i) => {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { frag.append(h('div', { class: 'day' }, fmtDay(m.created_at))); lastDay = day; }
    if (m.id === App.sepId) frag.append(h('div', { class: 'unread-sep' }, 'پیام‌های خوانده‌نشده'));
    const node = R.message(c, m, App.flags(st.list, i));
    App.els.set(m.id, node);
    frag.append(node);
  });
  if (st.hasNewer) frag.append(h('div', { class: 'loading-more', id: 'newer' }, 'در حال بارگذاری…'));
  for (const p of S.pending.values()) if (p.chatId === c.id) frag.append(App.pendingNode(p));
  el.inner.replaceChildren(frag);
};

App.pendingNode = (p) => {
  const node = R.message(S.chats.get(p.chatId), p.msg, { first: true, last: true });
  p.node = node;
  p.bar = $('.up-progress i', node);
  if (p.bar) p.bar.style.width = Math.round(p.progress * 100) + '%';
  return node;
};

App.isLiveEnd = (id) => { const st = S.msgs.get(id); return st && !st.hasNewer; };

App.insertMessage = (m) => {
  const st = S.msgs.get(m.chat_id);
  if (!st || st.hasNewer) return false;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i >= 0) { App.replaceMessage(m); return true; }
  const lastMsg = st.list.at(-1);
  st.list.push(m);
  if (lastMsg && lastMsg.id > m.id) st.list.sort((a, b) => a.id - b.id);
  if (m.chat_id !== S.active) return true;
  const c = S.chats.get(m.chat_id);
  const idx = st.list.indexOf(m);
  if (idx !== st.list.length - 1 || $('.service', el.inner) && st.list.length === 1) { App.renderMessages(); return true; }
  // re-render previous message (its tail/grouping may change), then append
  const prev = st.list[idx - 1];
  if (prev && App.els.has(prev.id)) {
    const fresh = R.message(c, prev, App.flags(st.list, idx - 1));
    App.els.get(prev.id).replaceWith(fresh);
    App.els.set(prev.id, fresh);
  }
  const node = R.message(c, m, App.flags(st.list, idx));
  node.classList.add('appear');
  App.els.set(m.id, node);
  const anchor = $('.pending', el.inner) || $('#newer', el.inner);
  const frag = document.createDocumentFragment();
  if (!prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()) frag.append(h('div', { class: 'day' }, fmtDay(m.created_at)));
  frag.append(node);
  if (anchor) el.inner.insertBefore(frag, anchor);
  else el.inner.append(frag);
  return true;
};

App.replaceMessage = (m) => {
  const st = S.msgs.get(m.chat_id);
  if (!st) return;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i < 0) return;
  st.list[i] = m;
  if (m.chat_id !== S.active) return;
  const old = App.els.get(m.id);
  if (!old) return;
  const node = R.message(S.chats.get(m.chat_id), m, App.flags(st.list, i));
  old.replaceWith(node);
  App.els.set(m.id, node);
};

App.removeMessages = (chatId, ids) => {
  const st = S.msgs.get(chatId);
  if (!st) return;
  const set = new Set(ids);
  st.list = st.list.filter((m) => !set.has(m.id));
  if (chatId === S.active) {
    const top = el.messages.scrollTop;
    App.renderMessages();
    el.messages.scrollTop = top;
  }
};

App.updateTicks = (c) => {
  if (c.id !== S.active) return;
  for (const t of $$('.ticks', el.inner)) {
    const read = c.others_read_id >= Number(t.dataset.id);
    t.replaceChildren(icon(read ? 'checks' : 'check'));
  }
};

/* ---------- scrolling ---------- */
App.atBottom = () => el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 80;
App.scrollBottom = () => { App.stick = true; el.messages.scrollTop = el.messages.scrollHeight; };
App.toBottom = async () => {
  const st = S.msgs.get(S.active);
  if (st?.hasNewer) {
    await App.loadInitial(S.active);
    App.sepId = null;
    App.renderMessages();
  }
  App.scrollBottom();
  App.markRead();
  App.onScroll();
};
App.scrollToMsg = (id, flash) => {
  const node = App.els.get(id);
  if (!node) return false;
  App.stick = false;
  node.scrollIntoView({ block: 'center' });
  if (flash) { node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash'); }
  return true;
};
App.jumpTo = async (chatId, msgId) => {
  if (chatId !== S.active) return App.openChat(chatId, { jump: msgId });
  if (App.scrollToMsg(msgId, true)) return;
  try {
    await App.loadAround(chatId, msgId);
    App.sepId = null;
    App.renderMessages();
    if (!App.scrollToMsg(msgId, true)) toast('این پیام حذف شده است');
    App.onScroll();
  } catch (err) { toast(err.message); }
};

let loadingOlder = false, loadingNewer = false;
App.onScroll = async () => {
  const box = el.messages;
  const id = S.active;
  const st = S.msgs.get(id);
  if (!st) return;
  App.stick = App.atBottom() && !st.hasNewer;
  const c = S.chats.get(id);
  const showFab = !App.atBottom() || st.hasNewer;
  el.fab.classList.toggle('hide', !showFab);
  el.fab.querySelector('.badge')?.remove();
  if (showFab && c?.unread) el.fab.append(h('span', { class: 'badge' }, fa(c.unread)));
  if (App.atBottom() && !st.hasNewer) App.markRead();

  if (box.scrollTop < 400 && st.hasMore && !loadingOlder) {
    loadingOlder = true;
    try {
      const first = st.list[0];
      const r = await api('GET', `/api/chats/${id}/messages?before=${first.id}&limit=50`);
      if (S.active !== id) return;
      const prevH = box.scrollHeight, prevT = box.scrollTop;
      st.list = [...r.messages, ...st.list];
      st.hasMore = r.has_more;
      App.renderMessages();
      box.scrollTop = box.scrollHeight - prevH + prevT;
    } catch (err) { toast(err.message); } finally { loadingOlder = false; }
  }
  if (st.hasNewer && box.scrollHeight - box.scrollTop - box.clientHeight < 400 && !loadingNewer) {
    loadingNewer = true;
    try {
      const lastMsg = st.list.at(-1);
      const r = await api('GET', `/api/chats/${id}/messages?after=${lastMsg.id}&limit=50`);
      if (S.active !== id) return;
      const prevT = box.scrollTop;
      st.list = [...st.list, ...r.messages];
      st.hasNewer = r.has_newer;
      App.renderMessages();
      box.scrollTop = prevT;
    } catch (err) { toast(err.message); } finally { loadingNewer = false; }
  }
};

App.markRead = () => {
  const c = S.chats.get(S.active);
  const st = S.msgs.get(S.active);
  if (!c || !st || document.hidden || st.hasNewer) return;
  const lastMsg = st.list.at(-1);
  if (!lastMsg) return;
  const changed = c.unread > 0;
  c.unread = 0;
  if (lastMsg.id > (c.last_read_id || 0)) {
    c.last_read_id = lastMsg.id;
    if (S.wsReady) App.wsSend({ type: 'read', chat_id: c.id, message_id: lastMsg.id });
    else api('POST', `/api/chats/${c.id}/read`, { message_id: lastMsg.id }).catch(() => {});
  }
  if (changed) App.renderSidebar();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.active && App.atBottom()) App.markRead(); });

/* =====================================================================
   COMPOSER
   ===================================================================== */
App.buildComposer = (c) => {
  el.input = h('textarea', { rows: 1, placeholder: c.type === 'channel' ? 'انتشار پست…' : 'پیام', dir: 'auto', 'aria-label': 'پیام' });
  el.bar = h('div', { class: 'bar', hidden: true });
  el.emojiBtn = ibtn('smile', 'اموجی', () => UI.emojiPicker(el.emojiBtn, (e) => App.insertText(e)));
  el.attachBtn = ibtn('attach', 'پیوست', () => App.attachMenu());
  el.row = h('div', { class: 'row' }, el.emojiBtn, el.input, el.attachBtn);
  el.composer = h('div', { class: 'composer' }, el.bar, el.row);
  el.sendBtn = h('button', { class: 'send-btn', type: 'button', 'aria-label': 'ارسال', onclick: () => App.onSendBtn() });
  el.fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  el.fileInput.addEventListener('change', () => {
    const files = [...el.fileInput.files];
    el.fileInput.value = '';
    if (files.length) App.sendFilesDialog(files, el.fileInput.dataset.asFile === '1');
  });
  el.bottom.replaceChildren(h('div', { class: 'composer-wrap' }, el.composer, el.sendBtn, el.fileInput));
  el.input.value = S.drafts[c.id] || '';
  App.autoGrow();
  App.updateSendBtn();
  App.renderComposerBar();

  let draftTimer;
  el.input.addEventListener('input', () => {
    App.autoGrow();
    App.updateSendBtn();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(App.saveDraft, 500);
    App.sendTyping('typing');
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !narrow()) { e.preventDefault(); App.sendText(); }
    else if (e.key === 'Escape' && (S.reply || S.edit)) { e.preventDefault(); App.cancelBar(); }
    else if (e.key === 'ArrowUp' && !el.input.value && !S.edit) {
      const st = S.msgs.get(S.active);
      const mine = st?.list.slice().reverse().find((m) => m.sender.id === S.me.id && App.canEdit(c, m));
      if (mine) { e.preventDefault(); App.startEdit(mine); }
    }
  });
  el.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); App.sendFilesDialog(files, false); }
  });
};

App.autoGrow = () => {
  if (!el.input) return;
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 220) + 'px';
};
App.insertText = (t) => {
  const i = el.input;
  if (!i) return;
  const s = i.selectionStart ?? i.value.length, e = i.selectionEnd ?? i.value.length;
  i.value = i.value.slice(0, s) + t + i.value.slice(e);
  i.selectionStart = i.selectionEnd = s + t.length;
  i.focus();
  App.autoGrow();
  App.updateSendBtn();
};
App.updateSendBtn = () => {
  if (!el.sendBtn) return;
  const hasText = !!el.input?.value.trim() || !!S.edit;
  const mode = S.rec ? 'rec' : hasText ? 'send' : 'mic';
  if (el.sendBtn.dataset.mode === mode) return;
  el.sendBtn.dataset.mode = mode;
  el.sendBtn.classList.toggle('recording', mode === 'rec');
  el.sendBtn.replaceChildren(icon(mode === 'mic' ? 'mic' : S.edit ? 'check' : 'send', mode !== 'mic' && !S.edit ? 'flip' : ''));
  el.sendBtn.title = mode === 'mic' ? 'ضبط پیام صوتی' : 'ارسال';
};
App.onSendBtn = () => {
  if (S.rec) return App.stopRecording(true);
  if (el.input?.value.trim() || S.edit) return App.sendText();
  App.startRecording();
};

App.saveDraft = () => {
  if (!S.active || !el.input || el.bottom.dataset.chat !== String(S.active) || S.edit) return;
  const v = el.input.value;
  const had = !!S.drafts[S.active];
  if (v.trim()) S.drafts[S.active] = v; else delete S.drafts[S.active];
  save('drafts', S.drafts);
  if (had !== !!v.trim()) App.renderSidebar();
};

App.renderComposerBar = () => {
  if (!el.bar) return;
  const m = S.edit || S.reply;
  el.bar.hidden = !m;
  App.updateSendBtn();
  if (!m) return;
  el.bar.replaceChildren(
    h('span', { class: 'ic' }, icon(S.edit ? 'edit' : 'reply')),
    h('div', { class: 'body' },
      h('div', { class: 'lbl' }, S.edit ? 'ویرایش پیام' : `پاسخ به ${m.sender.display_name}`),
      h('div', { class: 'txt', dir: 'auto' }, R.previewText(m))),
    ibtn('close', 'لغو', App.cancelBar));
};
App.startReply = (m) => {
  const c = S.chats.get(m.chat_id);
  if (!c?.can_post) return;
  if (S.edit) { S.edit = null; el.input.value = S.drafts[S.active] || ''; }
  S.reply = m;
  App.renderComposerBar();
  el.input?.focus();
};
App.canEdit = (c, m) => m.sender.id === S.me.id && !m.forward && m.kind !== 'poll' && m.kind !== 'service' && Date.now() - m.created_at < 48 * 3600e3 && c.can_post;
App.startEdit = (m) => {
  App.saveDraft();
  S.reply = null;
  S.edit = m;
  el.input.value = m.text;
  App.autoGrow();
  App.renderComposerBar();
  el.input.focus();
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
};
App.cancelBar = () => {
  if (S.edit) { el.input.value = S.drafts[S.active] || ''; App.autoGrow(); }
  S.reply = null;
  S.edit = null;
  App.renderComposerBar();
};

App.wsSend = (obj) => { if (S.ws && S.wsReady) { S.ws.send(JSON.stringify(obj)); return true; } return false; };

let lastTyping = 0;
App.sendTyping = (action) => {
  const now = Date.now();
  const c = S.chats.get(S.active);
  if (!c || c.type === 'channel' || isSaved(c) || S.edit || now - lastTyping < 3500) return;
  if (action === 'typing' && !el.input?.value.trim()) return;
  lastTyping = now;
  App.wsSend({ type: 'typing', chat_id: c.id, action });
};

App.sendText = async () => {
  const c = S.chats.get(S.active);
  if (!c || !el.input) return;
  const text = el.input.value.trim();
  const editing = S.edit, reply = S.reply;
  if (!text && !(editing && editing.kind !== 'text')) return;
  el.input.value = '';
  App.autoGrow();
  S.edit = null; S.reply = null;
  delete S.drafts[c.id];
  save('drafts', S.drafts);
  App.renderComposerBar();
  App.sepId = null;
  lastTyping = 0;
  try {
    if (editing) {
      if (text === editing.text) return;
      if (!App.wsSend({ type: 'edit', message_id: editing.id, text })) App.replaceMessage((await api('PATCH', `/api/messages/${editing.id}`, { text })).message);
      el.input.value = S.drafts[c.id] || '';
      return;
    }
    // Telegram-style: split very long text into several messages
    const parts = [];
    for (let i = 0; i < text.length; i += 4096) parts.push(text.slice(i, i + 4096));
    for (const [n, part] of parts.entries()) {
      const body = { type: 'send', chat_id: c.id, text: part, reply_to: n === 0 && reply ? reply.id : null };
      if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message);
    }
    App.scrollBottom();
  } catch (err) {
    toast(err.message);
    el.input.value = text;
    App.autoGrow();
  }
  App.updateSendBtn();
};

App.attachMenu = () => {
  const c = S.chats.get(S.active);
  UI.menu([
    { icon: 'image', label: 'عکس یا ویدیو', onClick: () => { el.fileInput.accept = 'image/*,video/*'; el.fileInput.dataset.asFile = '0'; el.fileInput.click(); } },
    { icon: 'file', label: 'فایل', onClick: () => { el.fileInput.accept = ''; el.fileInput.dataset.asFile = '1'; el.fileInput.click(); } },
    c.type !== 'private' ? { icon: 'poll', label: 'نظرسنجی', onClick: () => App.pollDialog(c) } : null,
  ], { anchor: el.attachBtn, up: true });
};

/* ---------- uploads ---------- */
function mediaMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (meta) => { resolve({ ...meta, url }); };
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    } else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      const v = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
      v.preload = 'metadata';
      v.onloadedmetadata = () => done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined });
      v.onerror = () => done({});
      v.src = url;
      setTimeout(() => done({}), 3000);
    } else done({});
  });
}
const guessKind = (file, asFile, voice) => {
  if (voice) return 'voice';
  if (asFile) return 'file';
  if (/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return 'photo';
  if (/^video\/(mp4|webm|quicktime)$/.test(file.type)) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
};

App.upload = async (file, { caption = '', asFile = false, voice = false, duration, replyTo = null } = {}) => {
  const chatId = S.active;
  const c = S.chats.get(chatId);
  if (!c?.can_post) return;
  if (file.size > S.config.max_upload_mb * 1048576) return toast(`حداکثر حجم فایل ${fa(S.config.max_upload_mb)} مگابایت است`);
  const meta = await mediaMeta(file);
  if (duration) meta.duration = duration;
  const kind = guessKind(file, asFile, voice);
  const localId = 'p' + Date.now() + Math.random().toString(36).slice(2, 7);
  const p = {
    localId, chatId, progress: 0,
    msg: {
      id: localId, localId, pending: true, chat_id: chatId, kind, text: caption, sender: S.me, reactions: [], created_at: Date.now(),
      media: { url: meta.url, mime: file.type, size: file.size, name: file.name, width: meta.width, height: meta.height, duration: meta.duration },
    },
  };
  S.pending.set(localId, p);
  if (S.active === chatId) { el.inner.append(App.pendingNode(p)); App.scrollBottom(); }
  const typingTimer = setInterval(() => { lastTyping = 0; if (S.active === chatId) App.sendTyping(voice ? 'recording' : 'uploading'); }, 4000);
  try {
    p.upload = uploadFile(file, file.name, (x) => { p.progress = x; if (p.bar) p.bar.style.width = Math.round(x * 100) + '%'; });
    const f = await p.upload;
    if (!S.pending.has(localId)) return;
    const body = {
      type: 'send', chat_id: chatId, file_id: f.id, text: caption, voice, as_file: asFile, reply_to: replyTo,
      meta: { width: meta.width, height: meta.height, duration: meta.duration },
    };
    if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${chatId}/messages`, body)).message);
  } catch (err) {
    if (err.code !== 'aborted') toast(err.message);
  } finally {
    clearInterval(typingTimer);
    S.pending.delete(localId);
    p.node?.remove();
    setTimeout(() => URL.revokeObjectURL(meta.url), 30000);
  }
};
App.cancelPending = (localId) => {
  const p = S.pending.get(localId);
  if (!p) return;
  p.upload?.abort?.();
  S.pending.delete(localId);
  p.node?.remove();
};

/* ---------- voice recording ---------- */
App.startRecording = async () => {
  if (S.rec) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند (HTTPS لازم است)');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('دسترسی به میکروفون داده نشد'); }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);
  const chatId = S.active;
  S.rec = { rec, stream, chunks, start: Date.now(), chatId, replyTo: S.reply?.id || null };
  const tm = h('span', { class: 'tm' }, fmtDur(0));
  const ui = h('div', { class: 'rec-ui' }, h('span', { class: 'dot' }), tm, h('button', { class: 'cancel', type: 'button', onclick: () => App.stopRecording(false) }, 'لغو'));
  el.row.hidden = true;
  el.composer.append(ui);
  S.rec.ui = ui;
  S.rec.timer = setInterval(() => {
    tm.textContent = fmtDur((Date.now() - S.rec.start) / 1000);
    lastTyping = 0;
    if ((Date.now() - S.rec.start) % 4000 < 250) App.sendTyping('recording');
  }, 250);
  App.updateSendBtn();
};
App.stopRecording = (send) => {
  const r = S.rec;
  if (!r) return;
  S.rec = null;
  clearInterval(r.timer);
  r.ui.remove();
  if (el.row) el.row.hidden = false;
  App.updateSendBtn();
  const duration = (Date.now() - r.start) / 1000;
  r.rec.onstop = () => {
    r.stream.getTracks().forEach((t) => t.stop());
    if (!send || duration < 0.7 || r.chatId !== S.active) return;
    const type = (r.rec.mimeType || 'audio/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([new Blob(r.chunks, { type })], `voice-${Date.now()}.${ext}`, { type });
    App.upload(file, { voice: true, duration, replyTo: r.replyTo });
    if (r.replyTo) { S.reply = null; App.renderComposerBar(); }
  };
  try { r.rec.stop(); } catch { r.stream.getTracks().forEach((t) => t.stop()); }
};

/* =====================================================================
   MESSAGE ACTIONS
   ===================================================================== */
App.messageMenu = (c, m, e) => {
  const mine = m.sender.id === S.me.id;
  const canDelete = mine || c.type === 'private' || c.can_manage;
  const canPin = c.type === 'private' || c.can_manage;
  const pinned = c.pinned_message?.id === m.id;
  const saved = [...S.chats.values()].find(isSaved);
  const myReaction = m.reactions?.find((r) => r.mine)?.emoji;
  const quick = h('div', { class: 'quick' }, S.config.reactions.map((emo) =>
    h('button', { type: 'button', class: emo === myReaction ? 'on' : '', onclick: () => { UI.closeMenu(); App.react(m, emo); } }, emo)));
  UI.menu([
    c.can_post ? { icon: 'reply', label: 'پاسخ', onClick: () => App.startReply(m) } : null,
    App.canEdit(c, m) ? { icon: 'edit', label: 'ویرایش', onClick: () => App.startEdit(m) } : null,
    m.text && m.kind !== 'poll' ? { icon: 'copy', label: 'کپی متن', onClick: () => copyText(m.text) } : null,
    c.username && c.type !== 'private' ? { icon: 'link', label: 'کپی لینک پیام', onClick: () => copyText(`${location.origin}/#/@${c.username}/${m.id}`, 'لینک کپی شد') } : null,
    canPin ? { icon: 'pin', label: pinned ? 'برداشتن سنجاق' : 'سنجاق کردن', onClick: () => App.pin(c, pinned ? null : m.id) } : null,
    { icon: 'forward', label: 'بازارسال', onClick: () => App.forwardDialog([m.id]) },
    saved && saved.id !== c.id ? { icon: 'bookmark', label: 'ذخیره در پیام‌های ذخیره‌شده', onClick: () => App.forward([m.id], saved.id, true) } : null,
    m.media ? { icon: 'download', label: 'دانلود', onClick: () => { const a = h('a', { href: m.media.url, download: m.media.name }); document.body.append(a); a.click(); a.remove(); } } : null,
    canDelete ? 'sep' : null,
    canDelete ? { icon: 'trash', label: 'حذف', danger: true, onClick: () => App.deleteMessages([m.id]) } : null,
  ], { x: e.clientX, y: e.clientY, quick: m.kind !== 'service' ? quick : null });
};

App.react = (m, emoji) => {
  if (!App.wsSend({ type: 'react', message_id: m.id, emoji })) {
    api('POST', `/api/messages/${m.id}/react`, { emoji }).then((r) => App.onMessageUpdated(r.message)).catch((e) => toast(e.message));
  }
};
App.vote = (m, option) => {
  if (!App.wsSend({ type: 'vote', message_id: m.id, option })) {
    api('POST', `/api/messages/${m.id}/vote`, { option }).then((r) => App.onMessageUpdated(r.message)).catch((e) => toast(e.message));
  }
};
App.pin = async (c, messageId) => {
  try { await api('POST', `/api/chats/${c.id}/pin`, { message_id: messageId }); } catch (e) { toast(e.message); }
};
App.deleteMessages = async (ids) => {
  const ok = await UI.ask('حذف پیام', ids.length > 1 ? `${fa(ids.length)} پیام برای همه حذف می‌شوند.` : 'این پیام برای همه حذف می‌شود.', 'حذف', true);
  if (!ok) return;
  try { await api('POST', '/api/messages/delete', { message_ids: ids }); } catch (e) { toast(e.message); }
};
App.forward = async (ids, toChatId, quiet) => {
  try {
    await api('POST', '/api/messages/forward', { to_chat_id: toChatId, message_ids: ids });
    if (quiet) toast('در پیام‌های ذخیره‌شده ذخیره شد');
    else App.openChat(toChatId);
  } catch (e) { toast(e.message); }
};

/* =====================================================================
   IN-CHAT SEARCH
   ===================================================================== */
App.openChatSearch = (initial = '') => {
  const c = S.chats.get(S.active);
  if (!c) return;
  const input = h('input', { type: 'search', placeholder: `جستجو در ${chatTitle(c)}`, value: initial });
  el.searchBar.replaceChildren(input, ibtn('close', 'بستن', App.closeChatSearch));
  el.searchBar.hidden = false;
  let t;
  const run = async () => {
    const q = input.value.trim();
    if (!q) { el.searchResults.hidden = true; return; }
    try {
      const { messages } = await api('GET', `/api/chats/${c.id}/search?q=${encodeURIComponent(q)}`);
      if (input.value.trim() !== q) return;
      el.searchResults.hidden = false;
      el.searchResults.replaceChildren(...(messages.length ? messages.map((m) =>
        h('div', { class: 'sr', onclick: () => { el.searchResults.hidden = true; App.jumpTo(c.id, m.id); } },
          userAvatar(m.sender, 's40'),
          h('div', { class: 'body' },
            h('div', { class: 'n' }, h('span', { dir: 'auto' }, m.sender.display_name), h('small', {}, fmtListTime(m.created_at))),
            h('div', { class: 'x', dir: 'auto' }, R.previewText(m))))) : [h('div', { class: 'info-empty' }, 'نتیجه‌ای پیدا نشد')]));
    } catch (e) { toast(e.message); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') App.closeChatSearch(); });
  input.focus();
  if (initial) run();
};
App.closeChatSearch = () => { if (el.searchBar) { el.searchBar.hidden = true; el.searchResults.hidden = true; } };
App.searchInChat = (q) => { if (S.active) App.openChatSearch(q); };

/* =====================================================================
   REALTIME
   ===================================================================== */
App.connect = () => {
  if (!S.token) return;
  S.manualClose = false;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  S.ws = ws;
  el.conn.textContent = 'در حال اتصال…';
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: S.token }));
  ws.onmessage = (e) => { let ev; try { ev = JSON.parse(e.data); } catch { return; } App.onEvent(ev); };
  ws.onclose = (e) => {
    if (S.ws !== ws) return;
    S.ws = null;
    S.wsReady = false;
    if (S.manualClose || !S.token) return;
    if (e.code === 4001) { api('GET', '/api/me').then(() => setTimeout(App.connect, 1000)).catch(() => {}); return; }
    const delay = Math.min(15000, 800 * 2 ** S.retry++);
    el.conn.textContent = navigator.onLine === false ? 'منتظر شبکه…' : 'اتصال قطع شد، تلاش دوباره…';
    setTimeout(App.connect, delay);
  };
};
window.addEventListener('online', () => { if (S.token && !S.ws) { S.retry = 0; App.connect(); } });

App.onEvent = async (ev) => {
  switch (ev.type) {
    case 'ready': {
      S.wsReady = true;
      S.retry = 0;
      el.conn.textContent = '';
      S.me = ev.user;
      if (S.everConnected) {
        // resync everything that may have happened while we were offline
        for (const st of S.msgs.values()) st.stale = true;
        await App.loadChats().catch(() => {});
        if (S.active && S.chats.has(S.active)) {
          await App.loadInitial(S.active).catch(() => {});
          App.renderChatChrome();
          App.renderMessages();
          App.scrollBottom();
          App.markRead();
        } else if (S.active) App.showEmpty();
      }
      S.everConnected = true;
      break;
    }
    case 'message': App.onMessage(ev.message); break;
    case 'message_updated': App.onMessageUpdated(ev.message); break;
    case 'messages_deleted': App.removeMessages(ev.chat_id, ev.message_ids); break;
    case 'chat': {
      const prev = S.chats.get(ev.chat.id);
      S.chats.set(ev.chat.id, ev.chat);
      if (S.active === ev.chat.id) {
        if (!prev || prev.can_post !== ev.chat.can_post) el.bottom.dataset.mode = '';
        App.renderChatChrome();
        if (prev && prev.others_read_id !== ev.chat.others_read_id) App.updateTicks(ev.chat);
        if (ev.chat.unread && App.atBottom()) App.markRead();
      }
      App.renderSidebar();
      if (!$('#info').hidden && S.active === ev.chat.id) App.openInfo(ev.chat.id, true);
      break;
    }
    case 'chat_removed':
      if (S.chats.has(ev.chat_id)) App.removeChat(ev.chat_id);
      break;
    case 'read': {
      const c = S.chats.get(ev.chat_id);
      if (!c) break;
      if (ev.user_id === S.me.id) {
        c.last_read_id = Math.max(c.last_read_id || 0, ev.message_id);
        if (!c.last_message || ev.message_id >= c.last_message.id) c.unread = 0;
      } else if (ev.message_id > (c.others_read_id || 0)) {
        c.others_read_id = ev.message_id;
        App.updateTicks(c);
      }
      App.renderSidebar();
      break;
    }
    case 'typing': {
      if (ev.user.id === S.me.id) break;
      let m = S.typing.get(ev.chat_id);
      if (!m) S.typing.set(ev.chat_id, (m = new Map()));
      m.set(ev.user.id, { name: ev.user.display_name, action: ev.action, until: Date.now() + 5500 });
      App.refreshTyping(ev.chat_id);
      setTimeout(() => App.refreshTyping(ev.chat_id), 5600);
      break;
    }
    case 'presence':
    case 'user': {
      const id = ev.user ? ev.user.id : ev.user_id;
      for (const c of S.chats.values()) {
        if (c.type !== 'private' || c.peer.id !== id) continue;
        if (ev.user) { Object.assign(c.peer, ev.user); c.title = ev.user.display_name; c.avatar = ev.user.avatar; c.username = ev.user.username; c.description = ev.user.bio; }
        else Object.assign(c.peer, { online: ev.online, last_seen: ev.last_seen, last_seen_hidden: ev.last_seen_hidden });
      }
      App.renderSidebar();
      if (S.active) App.renderHeader();
      break;
    }
    case 'me':
      S.me = ev.user;
      break;
    case 'error':
      toast(errorText(ev.code, ev.message));
      break;
  }
};

App.refreshTyping = (chatId) => {
  App.renderSidebar();
  if (S.active === chatId) App.renderHeader();
};

App.onMessage = async (m) => {
  let c = S.chats.get(m.chat_id);
  if (!c) {
    try { const d = await api('GET', `/api/chats/${m.chat_id}`); S.chats.set(d.chat.id, d.chat); c = d.chat; } catch { return; }
    App.renderSidebar();
    App.notify(c, m);
    return;
  }
  const mine = m.sender.id === S.me.id && c.type !== 'channel' || (c.type === 'channel' && m.sender.id === S.me.id);
  const isNew = !c.last_message || m.id > c.last_message.id;
  if (isNew) c.last_message = m;
  S.typing.get(m.chat_id)?.delete(m.sender.id);
  const wasBottom = S.active === m.chat_id && App.atBottom();
  App.insertMessage(m);
  if (mine) {
    c.last_read_id = Math.max(c.last_read_id || 0, m.id);
    if (S.active === m.chat_id) { App.sepId = null; App.scrollBottom(); }
  } else if (isNew) {
    if (S.active === m.chat_id && !document.hidden && wasBottom && App.isLiveEnd(m.chat_id)) {
      App.scrollBottom();
      App.markRead();
    } else {
      c.unread = (c.unread || 0) + 1;
      if (S.active === m.chat_id) App.onScroll();
    }
    App.notify(c, m);
  }
  App.renderSidebar();
  if (S.active === m.chat_id) App.renderHeader();
};

App.onMessageUpdated = (m) => {
  const c = S.chats.get(m.chat_id);
  if (!c) return;
  if (c.last_message?.id === m.id) c.last_message = m;
  if (c.pinned_message?.id === m.id) { c.pinned_message = m; if (S.active === c.id) App.renderPinned(c); }
  App.replaceMessage(m);
  App.renderSidebar();
};

/* ---------- notifications ---------- */
let audioCtx = null;
App.beep = () => {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.09]]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.08, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d); o.stop(t + d + 0.18);
    }
  } catch {}
};
App.notify = (c, m) => {
  if (c.muted || m.sender.id === S.me.id || m.kind === 'service') return;
  const visible = !document.hidden && S.active === c.id;
  if (visible) return;
  if (S.settings.sound && !document.hidden) App.beep();
  if (!S.settings.notify || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(chatTitle(c), {
      body: (c.type === 'group' ? m.sender.display_name + ': ' : '') + R.previewText(m),
      tag: 'chat-' + c.id, icon: c.avatar || '/icon.svg', silent: !S.settings.sound,
    });
    n.onclick = () => { window.focus(); App.openChat(c.id); n.close(); };
  } catch {}
};

/* =====================================================================
   ROUTING: #/@username, #/@channel/123, #/join/<token>
   ===================================================================== */
App.route = async () => {
  const hsh = decodeURIComponent(location.hash || '');
  let m;
  if ((m = /^#\/join\/([\w-]{8,64})$/.exec(hsh))) App.joinDialog({ invite: m[1] });
  else if ((m = /^#\/@([a-zA-Z][\w]{3,31})(?:\/(\d+))?$/.exec(hsh))) App.openByUsername(m[1], m[2] ? Number(m[2]) : null);
  else return;
  history.replaceState(history.state, '', location.pathname);
};
window.addEventListener('hashchange', () => { if (S.me) App.route(); });

App.openByUsername = async (name, msgId) => {
  if (!name) return;
  if (S.me && name.toLowerCase() === S.me.username.toLowerCase()) return App.openSaved();
  try {
    const r = await api('GET', '/api/resolve/' + encodeURIComponent(name));
    if (r.user) {
      const existing = [...S.chats.values()].find((c) => c.type === 'private' && c.peer.id === r.user.id);
      if (existing) return App.openChat(existing.id);
      return App.openPrivateWith(r.user.username);
    }
    if (r.chat.is_member && S.chats.has(r.chat.id)) return App.openChat(r.chat.id, msgId ? { jump: msgId } : {});
    App.joinDialog({ username: r.chat.username });
  } catch (err) { toast(err.message); }
};

/* ---------- boot ---------- */
App.boot = async () => {
  applyTheme();
  if (!S.token) return App.renderAuth('login');
  try {
    await App.start();
  } catch (err) {
    if (S.token) { toast(err.message); App.renderAuth('login'); }
  }
};
