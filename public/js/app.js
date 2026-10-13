'use strict';
/* Kabootar web client — main app: auth, sidebar, chat view, composer, realtime. Layout & behaviour follow Telegram Web K. */

const App = {};
const el = {}; // cached DOM nodes
const narrow = () => matchMedia('(max-width: 760px)').matches;

/* =====================================================================
   AUTH (username + password, then optional two-step verification)
   ===================================================================== */
App.persistToken = async (token) => {
  S.token = token;
  if (typeof Lock !== 'undefined' && Lock.enabled()) await Lock.storeToken(token);
  else save('token', token);
};

App.renderAuth = (mode = 'login') => {
  const box = $('#auth');
  box.hidden = false;
  $('#app').hidden = true;
  const login = mode === 'login';
  const user = UI.field('نام کاربری', { name: 'username', autocomplete: 'username', dir: 'ltr', required: true, maxlength: 32 },
    login ? null : 'حروف انگلیسی، عدد و _ (حداقل ۴ حرف)');
  const name = login ? null : UI.field('نام نمایشی', { name: 'display_name', maxlength: 64, autocomplete: 'name' });
  const pass = UI.field('رمز عبور', { name: 'password', type: 'password', autocomplete: login ? 'current-password' : 'new-password', dir: 'ltr', required: true, minlength: 8, maxlength: 128 },
    login ? null : 'حداقل ۸ کاراکتر');
  const submit = h('button', { class: 'btn block', type: 'submit' }, login ? 'بعدی' : 'ساخت حساب');
  let keep = store('keepSignedIn', true);
  const keepRow = UI.checkRow('مرا به خاطر بسپار', keep, (v) => { keep = v; save('keepSignedIn', v); });
  const form = h('form', { autocomplete: 'on' }, user, name, pass, keepRow, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.classList.add('loading');
    try {
      const body = { username: user.input.value.trim(), password: pass.input.value };
      if (!login) body.display_name = name.input.value.trim() || body.username;
      const data = await api('POST', `/api/auth/${login ? 'login' : 'register'}`, body);
      if (data.twofa_required) return App.render2fa(data);
      await App.persistToken(data.token);
      S.me = data.user;
      await App.start();
    } catch (err) {
      toast(err.message);
      (login ? pass : user).classList.add('error');
    } finally {
      submit.disabled = false;
      submit.classList.remove('loading');
    }
  });
  box.replaceChildren(
    h('button', { class: 'ibtn theme-toggle', title: 'حالت شب', onclick: () => { setSetting('theme', darkMode() ? 'light' : 'dark'); } }, icon('moon')),
    h('div', { class: 'auth-box' },
      h('img', { class: 'auth-logo', src: '/icon.svg', alt: '' }),
      h('h1', {}, 'کبوتر'),
      h('p', { class: 'sub' }, login ? 'برای ادامه نام کاربری و رمز عبور خود را وارد کنید.' : 'یک حساب جدید بسازید، فقط چند ثانیه طول می‌کشد.'),
      form,
      h('button', { class: 'btn flat switch', type: 'button', onclick: () => App.renderAuth(login ? 'register' : 'login') },
        login ? 'حساب ندارید؟ ثبت‌نام' : 'حساب دارید؟ ورود')));
  setTimeout(() => user.input.focus(), 30);
};

App.render2fa = (data) => {
  const box = $('#auth');
  const pass = UI.field(data.hint ? `راهنما: ${data.hint}` : 'رمز عبور', { type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'بعدی');
  const form = h('form', {}, pass, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const r = await api('POST', '/api/auth/2fa', { login_token: data.login_token, password: pass.input.value });
      await App.persistToken(r.token);
      S.me = r.user;
      await App.start();
    } catch (err) {
      toast(err.message);
      pass.classList.add('error');
      if (err.code === 'login_expired' || err.code === 'rate_limited') App.renderAuth('login');
    } finally { submit.disabled = false; }
  });
  box.replaceChildren(
    h('div', { class: 'auth-box' },
      h('div', { class: 'auth-lock' }, icon('lock')),
      h('h1', {}, 'رمز عبور خود را وارد کنید'),
      h('p', { class: 'sub' }, 'حساب شما با تأیید دومرحله‌ای و یک رمز اضافه محافظت می‌شود.'),
      form,
      h('button', { class: 'btn flat switch', type: 'button', onclick: () => App.renderAuth('login') }, 'بازگشت')));
  setTimeout(() => pass.input.focus(), 30);
};

App.logout = (expired) => {
  if (S.token && !expired) api('POST', '/api/auth/logout').catch(() => {});
  S.token = null;
  save('token', null);
  if (typeof Lock !== 'undefined') Lock.forget();
  App.teardown();
  App.renderAuth('login');
  if (expired) toast('نشست شما منقضی شد، دوباره وارد شوید');
};
App.teardown = () => {
  S.manualClose = true;
  App.stopPoll?.();
  if (S.ws) S.ws.close();
  if (typeof Calls !== 'undefined') Calls.cleanup?.(true);
  Object.assign(S, { me: null, ws: null, wsReady: false, everConnected: false, active: null, topic: null, reply: null, edit: null, archived: false, select: null, stickers: null, gifs: null, stories: null, contacts: null });
  S.chats.clear(); S.msgs.clear(); S.typing.clear(); S.topics.clear();
  for (const p of S.pending.values()) p.upload?.abort?.();
  S.pending.clear();
  UI.closeMenu(); UI.closeEmoji(); UI.closeAllModals();
  document.body.classList.remove('chat-open', 'info-open');
  $('#info').hidden = true;
  document.title = 'کبوتر';
};

App.start = async () => {
  if (!S.me) S.me = (await api('GET', '/api/me')).user;
  api('GET', '/api/config').then((c) => Object.assign(S.config, c)).catch(() => {});
  try {
    const { settings } = await api('GET', '/api/me/settings');
    Object.assign(S.settings, settings);
    save('settings', S.settings);
    applyTheme();
  } catch {}
  $('#auth').hidden = true;
  $('#app').hidden = false;
  App.buildShell();
  await App.loadChats();
  App.showEmpty();
  App.connect();
  App.route();
  if (typeof Stories !== 'undefined') Stories.load();
};

/* =====================================================================
   SHELL + SIDEBAR
   ===================================================================== */
App.buildShell = () => {
  const side = $('#sidebar');
  el.search = h('input', { type: 'search', placeholder: 'جستجوی گفتگوها', autocomplete: 'off', 'aria-label': 'جستجو' });
  el.list = h('div', { class: 'list' });
  el.folders = h('div', { class: 'folders', role: 'tablist' });
  el.storiesBar = h('div', { class: 'stories-bar', hidden: true });
  el.conn = h('div', { class: 'conn' }); // kept for older code paths; status now lives in the title (Android)
  el.menuBtn = ibtn('more', 'منو', (e) => App.mainMenu(e.currentTarget), 'menu-btn');
  el.lockBtn = ibtn('lock', 'قفل', () => Lock.lockNow(), 'lock-btn');
  el.lockBtn.hidden = !(typeof Lock !== 'undefined' && Lock.enabled());
  el.searchIcon = ibtn('oSearch', 'جستجو', () => { el.rootChats.classList.remove('search-collapsed'); el.list.scrollTop = 0; el.search.focus(); }, 'search-ic');
  el.fabNew = h('button', { class: 'fab fab-new', title: 'پیام جدید', type: 'button', onclick: () => App.newMessageScreen() }, icon('oNewMsg', 'fab-ic'));
  el.fabCam = h('button', { class: 'fab-cam', title: 'استوری جدید', type: 'button', onclick: () => Stories.compose() }, icon('oCamera'));
  // Android: story avatars fold next to the title
  el.storyStack = h('button', { class: 'story-stack', type: 'button', title: 'استوری‌ها', hidden: true, onclick: () => { el.list.scrollTop = 0; App.setStoriesOpen(true); } });
  el.appTitle = h('div', { class: 'a-title' }, h('span', { class: 'tx' }, 'کبوتر'));
  el.listWrap = h('div', { class: 'list-wrap' }, el.folders, el.list);
  el.searchRow = h('div', { class: 'search-row' }, h('div', { class: 'search-box' }, icon('oSearch'), el.search,
    h('button', { class: 'clear', type: 'button', title: 'پاک کردن', onclick: () => { el.search.value = ''; App.renderSidebar(); el.search.focus(); } }, icon('close'))));
  el.rootChats = h('div', { class: 'root root-chats' },
    h('div', { class: 'a-head' }, el.storyStack, el.appTitle, h('div', { class: 'sp' }), el.lockBtn, el.searchIcon, el.menuBtn),
    el.storiesBar, el.searchRow, el.listWrap, h('div', { class: 'fabs' }, el.fabCam, el.fabNew));
  el.bottomNav = App.buildNav();
  el.mainTab = h('div', { class: 'stab main in' }, el.rootChats, el.bottomNav);
  side.replaceChildren(el.mainTab);
  App.side = new UI.Slider(side, el.mainTab);
  // the bottom bar only lives on the root screens (Android)
  const push = App.side.push.bind(App.side), pop = App.side.pop.bind(App.side);
  App.side.push = (o) => { const r = push(o); App.updateNav(); return r; };
  App.side.pop = (e) => { const r = pop(e); App.updateNav(); return r; };
  App.bindStoriesPull?.();
  let t;
  el.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(App.renderSidebar, 200); side.classList.toggle('searching', App.searching()); App.updateNav(); });
  el.search.addEventListener('focus', () => { side.classList.add('searching'); App.updateNav(); App.renderSidebar(); });
  el.search.addEventListener('blur', () => setTimeout(() => { side.classList.toggle('searching', App.searching()); App.updateNav(); }, 150));
  el.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') App.endSearch(); });
  // scrolling hides the search pill under the title (it comes back at the top / via the search icon)
  el.list.addEventListener('scroll', () => { if (!App.searching()) el.rootChats.classList.toggle('search-collapsed', el.list.scrollTop > 40); }, { passive: true });
  App.buildChatArea();
  App.buildInfo();
};

/* ---------- Android bottom navigation ---------- */
App.nav = 'chats';
App.buildNav = () => {
  const item = (id, ic, label) => h('button', { type: 'button', class: 'nb' + (id === 'chats' ? ' on' : ''), dataset: { id }, onclick: () => App.showRoot(id) },
    h('span', { class: 'nb-ic' }, ic, id === 'chats' ? h('span', { class: 'nb-badge', hidden: true }) : null), h('span', { class: 'nb-l' }, label));
  el.navAvatar = h('span', { class: 'nb-av' });
  return h('nav', { class: 'bottom-nav' },
    item('chats', icon('oChats'), 'گفتگوها'),
    item('contacts', icon('oUserCircle'), 'مخاطبین'),
    item('settings', icon('oSettings'), 'تنظیمات'),
    item('profile', el.navAvatar, 'پروفایل'));
};
App.updateNav = () => {
  if (!el.bottomNav) return;
  el.bottomNav.classList.toggle('hide', (App.side?.depth || 0) > 0 || (App.nav === 'chats' && App.searching()));
  let n = 0;
  for (const c of S.chats.values()) if (c.unread && !c.muted && !c.archived) n++;
  const b = el.bottomNav.querySelector('.nb-badge');
  if (b) { b.textContent = n > 99 ? '+۹۹' : fa(n); b.hidden = !n; }
  if (el.navAvatar && S.me && el.navAvatar.dataset.v !== (S.me.avatar || '') + S.me.display_name) {
    el.navAvatar.dataset.v = (S.me.avatar || '') + S.me.display_name;
    el.navAvatar.replaceChildren(userAvatar(S.me, 's24'));
  }
};
App.rootPaint = {};
App.showRoot = (id) => {
  if (App.side.depth) App.side.popAll();
  if (App.searching()) App.endSearch();
  if (App.nav === id) {
    if (id === 'chats') { el.list.scrollTo?.({ top: 0, behavior: 'smooth' }); }
    return;
  }
  App.nav = id;
  const roots = { chats: el.rootChats };
  if (id !== 'chats' && !el['root_' + id]) {
    const r = { contacts: App.buildContactsRoot, settings: App.buildSettingsRoot, profile: App.buildProfileRoot }[id]();
    el['root_' + id] = r;
    el.mainTab.insertBefore(r, el.bottomNav);
  }
  for (const k of ['contacts', 'settings', 'profile']) roots[k] = el['root_' + k];
  for (const [k, node] of Object.entries(roots)) {
    if (!node) continue;
    const on = k === id;
    node.hidden = !on;
    if (on) { node.classList.remove('root-in'); void node.offsetWidth; node.classList.add('root-in'); App.rootPaint[k]?.(); }
  }
  $$('.nb', el.bottomNav).forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  App.updateNav();
};
App.repaintMe = () => {
  App.settingsTab?.opts.onShow?.();
  for (const f of Object.values(App.rootPaint)) try { f(); } catch {}
  App.updateNav();
};

App.version = () => String(S.config.version || '3.6.0').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
App.searching = () => !!el.search?.value.trim() || document.activeElement === el.search;
App.endSearch = () => { el.search.value = ''; el.search.blur(); $('#sidebar').classList.remove('searching'); App.renderSidebar(); };

// Telegram Android ⋮ menu
App.mainMenu = (anchor = el.menuBtn) => {
  const archived = App.sortedChats(true);
  const archivedUnread = archived.filter((c) => c.unread).length;
  UI.menu([
    { icon: darkMode() ? 'oSun' : 'oMoon', label: darkMode() ? 'حالت روز' : 'حالت شب', onClick: () => setSetting('theme', darkMode() ? 'light' : 'dark') },
    'sep',
    { icon: 'oGroup', label: 'گروه جدید', onClick: () => App.newChatDialog('group') },
    { icon: 'oChannel', label: 'کانال جدید', onClick: () => App.newChatDialog('channel') },
    { icon: 'oBookmark', label: 'پیام‌های ذخیره‌شده', onClick: () => App.openSaved() },
    archived.length ? { icon: 'oArchive', label: 'گفتگوهای بایگانی‌شده', badge: archivedUnread ? fa(archivedUnread) : null, onClick: () => App.openArchive() } : null,
    { icon: 'oStories', label: 'استوری‌های من', onClick: () => Stories.openMine() },
    { icon: 'oPhone', label: 'تماس‌ها', onClick: () => App.openCalls() },
    'sep',
    typeof Lock !== 'undefined' && Lock.enabled() ? { icon: 'oLock', label: 'قفل کردن', onClick: () => Lock.lockNow() } : null,
    App.installPrompt ? { icon: 'oInstall', label: 'نصب برنامه', onClick: () => { App.installPrompt.prompt(); App.installPrompt = null; } } : null,
    { icon: 'oHelp', label: 'امکانات کبوتر', onClick: () => App.openByUsername('kabootar') },
  ], { anchor, cls: 'main-menu', onClose: () => anchor.classList.remove('open') });
  anchor.classList.add('open');
  $('.menu.main-menu')?.append(h('div', { class: 'menu-foot' }, `کبوتر وب ${App.version()}`));
};
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); App.installPrompt = e; });

App.newMenu = (anchor) => {
  anchor.classList.add('open');
  UI.menu([
    { icon: 'oChannel', label: 'کانال جدید', onClick: () => App.newChatDialog('channel') },
    { icon: 'oGroup', label: 'گروه جدید', onClick: () => App.newChatDialog('group') },
    { icon: 'oUser', label: 'گفتگوی خصوصی جدید', onClick: () => App.newPrivateDialog() },
  ], { anchor, up: true, cls: 'fab-menu', onClose: () => anchor.classList.remove('open') });
};

App.loadChats = async () => {
  const { chats } = await api('GET', '/api/chats');
  S.chats.clear();
  for (const c of chats) S.chats.set(c.id, c);
  App.renderSidebar();
};

const DEFAULT_FOLDERS = [
  { id: 'unread', title: 'خوانده‌نشده', types: ['contacts', 'non_contacts', 'groups', 'channels'], no_read: true },
  { id: 'private', title: 'شخصی', types: ['contacts', 'non_contacts'] },
  { id: 'group', title: 'گروه‌ها', types: ['groups'] },
  { id: 'channel', title: 'کانال‌ها', types: ['channels'] },
];
App.folders = () => (Array.isArray(S.settings.folders) ? S.settings.folders : DEFAULT_FOLDERS);
App.chatKind = (c) => (c.type === 'private' ? (isSaved(c) || c.peer?.is_contact ? 'contacts' : 'non_contacts') : c.type === 'group' ? 'groups' : 'channels');
App.folderMatch = (f, c) => {
  if (!f || f.id === 'all') return true;
  if (f.exclude?.includes(c.id)) return false;
  if (f.include?.includes(c.id)) return true;
  if (!(f.types || []).includes(App.chatKind(c))) return false;
  if (f.no_muted && c.muted) return false;
  if (f.no_read && !c.unread) return false;
  return true;
};
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
  if (App.archiveTab) App.renderArchive();
  if (App.searching()) {
    el.folders.hidden = true;
    el.listWrap.classList.remove('has-folders');
    el.storiesBar.hidden = true;
    return q ? App.renderSearch(q) : App.renderSearchHome();
  }
  if (typeof Stories !== 'undefined') Stories.renderBar(el.storiesBar);
  const list = el.list;
  const scroll = list.scrollTop;
  list.replaceChildren();
  // folders
  const folders = App.folders();
  el.folders.hidden = !folders.length;
  el.listWrap.classList.toggle('has-folders', !!folders.length);
  el.folders.replaceChildren();
  if (!folders.some((f) => f.id === S.folder)) S.folder = 'all';
  const all = App.sortedChats(false);
  for (const f of [{ id: 'all', title: 'همه گفتگوها' }, ...folders]) {
    const count = all.filter((c) => App.folderMatch(f.id === 'all' ? null : f, c) && c.unread && !c.muted).length;
    el.folders.append(h('button', { class: 'folder' + (S.folder === f.id ? ' active' : ''), role: 'tab', dataset: { id: f.id },
      onclick: () => { S.folder = f.id; App.renderSidebar(); },
      oncontextmenu: (e) => { e.preventDefault(); App.folderMenu(f, e); } },
    h('span', { class: 'tl' }, f.emoji ? f.emoji + ' ' : '', f.id === 'all' ? 'همه' : f.title, count ? h('span', { class: 'count' }, fa(count)) : null)));
  }
  const archivedChats = App.sortedChats(true);
  if (archivedChats.length && S.folder === 'all') {
    const unread = archivedChats.reduce((n, c) => n + (c.unread ? 1 : 0), 0);
    list.append(h('div', { class: 'ci archive-row', onclick: () => App.openArchive() },
      avatarEl({ archive: true }),
      h('div', { class: 'body' },
        h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't' }, 'گفتگوهای بایگانی‌شده'))),
        h('div', { class: 'row' }, h('div', { class: 'preview' }, archivedChats.slice(0, 6).flatMap((c, i) => [i ? '، ' : '', c.unread ? h('b', { class: 'hl', dir: 'auto' }, chatTitle(c)) : chatTitle(c)])), unread ? h('span', { class: 'badge muted' }, fa(unread)) : null))));
  }
  const f = S.folder === 'all' ? null : folders.find((x) => x.id === S.folder);
  const chats = all.filter((c) => App.folderMatch(f, c));
  if (!chats.length) {
    list.append(h('div', { class: 'empty-hint' }, S.folder === 'all'
      ? 'هنوز گفتگویی ندارید.\nبا دکمه ✎ پایین یک گفتگو، گروه یا کانال بسازید یا از جستجو کسی را پیدا کنید.'
      : 'گفتگویی در این پوشه نیست'));
  }
  chats.forEach((c) => list.append(R.chatItem(c)));
  list.scrollTop = scroll;
  el.mainTab.classList.toggle('empty', !chats.length);
};

App.folderMenu = (f, e) => {
  UI.menu([
    { icon: 'checks', label: 'علامت همه به‌عنوان خوانده‌شده', onClick: () => App.sortedChats(false).filter((c) => App.folderMatch(f.id === 'all' ? null : f, c) && c.unread).forEach((c) => App.chatSetting(c, { read: true })) },
    { icon: 'edit', label: 'ویرایش پوشه‌ها', onClick: () => App.openSettings('folders') },
  ], { x: e.clientX, y: e.clientY });
};

App.openArchive = () => {
  const list = h('div', { class: 'list' });
  App.archiveTab = App.side.push({ title: 'بایگانی', body: list, onClose: () => { App.archiveTab = null; } });
  App.archiveTab.list = list;
  App.renderArchive();
};
App.renderArchive = () => {
  const tab = App.archiveTab;
  if (!tab) return;
  const chats = App.sortedChats(true);
  tab.list.replaceChildren(...(chats.length ? chats.map((c) => R.chatItem(c)) : [h('div', { class: 'empty-hint' }, 'بایگانی خالی است.\nگفتگوها را با کلیک راست بایگانی کنید.')]));
};

// mobile back button carries the unread counter of the other chats (Web K)
App.backBtn = (c) => {
  const b = ibtn('back', 'بازگشت', () => (c.is_forum && narrow() ? App.showEmpty() : App.closeChat()), 'back');
  b.append(h('span', { class: 'back-badge', hidden: true }));
  return b;
};
App.paintBackBadge = () => {
  const b = el.head?.querySelector('.back-badge');
  if (!b) return;
  let n = 0;
  for (const c of S.chats.values()) if (c.unread && !c.muted && c.id !== S.active && !c.archived) n++;
  b.textContent = n > 99 ? '+۹۹' : fa(n);
  b.hidden = !n;
};
App.updateTitle = () => {
  App.paintBackBadge();
  App.updateNav?.();
  let n = 0;
  for (const c of S.chats.values()) if (c.unread && !c.muted) n++;
  document.title = n ? `(${fa(n)}) کبوتر` : 'کبوتر';
  if (navigator.setAppBadge && document.hidden !== undefined) { try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch {} }
};

App.personRow = (u, onClick, extra) => h('div', { class: 'ci', onclick: onClick }, userAvatar(u),
  h('div', { class: 'body' }, h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't', dir: 'auto' }, userName(u)), u.verified ? R.verified() : null)),
    h('div', { class: 'row' }, h('div', { class: 'preview' + (u.online ? ' online' : ''), dir: 'auto' }, extra || (u.online ? 'آنلاین' : '@' + u.username)))));

App.renderSearchHome = () => {
  const list = el.list;
  list.replaceChildren();
  const people = App.sortedChats(false).filter((c) => c.type === 'private' && !isSaved(c)).slice(0, 12);
  if (people.length) {
    list.append(h('div', { class: 'section-title' }, 'افراد'),
      h('div', { class: 'people-row' }, people.map((c) => h('button', { type: 'button', class: 'person', onclick: () => { App.endSearch(); App.openChat(c.id); } },
        chatAvatar(c), h('span', { dir: 'auto' }, (chatTitle(c) || '').split(' ')[0])))));
  }
  const recent = store('recentSearch', []).map((id) => S.chats.get(id)).filter(Boolean);
  if (recent.length) {
    list.append(h('div', { class: 'section-title with-action' }, 'اخیر', h('button', { type: 'button', onclick: () => { save('recentSearch', []); App.renderSearchHome(); } }, 'پاک کردن')));
    recent.forEach((c) => list.append(R.chatItem(c)));
  }
  if (!people.length && !recent.length) list.append(h('div', { class: 'empty-hint' }, 'نام کسی، گروه یا کانالی را جستجو کنید'));
};
App.rememberSearch = (id) => save('recentSearch', [id, ...store('recentSearch', []).filter((x) => x !== id)].slice(0, 10));

let searchSeq = 0;
App.renderSearch = async (q) => {
  const seq = ++searchSeq;
  const list = el.list;
  const ql = q.toLowerCase().replace(/^@/, '');
  const local = [...S.chats.values()].filter((c) => chatTitle(c).toLowerCase().includes(q.toLowerCase()) || (c.username || '').toLowerCase().includes(ql));
  const open = (c, jump) => { App.rememberSearch(c.id); App.openChat(c.id, jump ? { jump } : {}); };
  const render = (res) => {
    if (seq !== searchSeq) return;
    list.replaceChildren();
    if (local.length) {
      list.append(h('div', { class: 'section-title' }, 'گفتگوها'));
      local.slice(0, 8).forEach((c) => { const n = R.chatItem(c); n.onclick = () => open(c); list.append(n); });
    }
    if (res) {
      const users = res.users.filter((u) => !local.some((c) => c.peer?.id === u.id));
      const chats = res.chats.filter((c) => !local.some((l) => l.id === c.id));
      if (users.length || chats.length) list.append(h('div', { class: 'section-title' }, 'جستجوی سراسری'));
      users.forEach((u) => list.append(App.personRow(u, () => App.openPrivateWith(u.username), '@' + u.username)));
      chats.forEach((c) => list.append(h('div', { class: 'ci', onclick: () => App.joinDialog({ username: c.username }) },
        avatarEl({ name: c.title, avatar: c.avatar, seed: c.id * 7 + 3 }),
        h('div', { class: 'body' }, h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't', dir: 'auto' }, c.title), c.verified ? R.verified() : null)),
          h('div', { class: 'row' }, h('div', { class: 'preview' }, `@${c.username} · ${membersText(c)}`))))));
      if (res.messages.length) {
        list.append(h('div', { class: 'section-title' }, 'پیام‌ها'));
        res.messages.forEach((m) => {
          const c = S.chats.get(m.chat_id);
          if (!c) return;
          list.append(h('div', { class: 'ci', onclick: () => open(c, m.id) }, chatAvatar(c),
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
    !isSaved(c) ? { icon: c.muted ? 'bell' : 'muted', label: c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن', onClick: () => App.chatSetting(c, { muted: !c.muted }) } : null,
    { icon: 'archive', label: c.archived ? 'خروج از بایگانی' : 'بایگانی', onClick: () => App.chatSetting(c, { archived: !c.archived }) },
    c.unread ? { icon: 'checks', label: 'علامت خوانده‌شده', onClick: () => App.chatSetting(c, { read: true }) } : null,
    App.folders().length ? { icon: 'folder', label: 'افزودن به پوشه', onClick: () => App.addToFolderDialog(c) } : null,
    'sep',
    { icon: c.type === 'private' ? 'trash' : 'logout', label: leaveLabel, danger: true, onClick: () => App.leaveOrDelete(c) },
  ], { x: e.clientX, y: e.clientY });
};

App.addToFolderDialog = (c) => {
  const folders = App.folders().map((f) => ({ ...f }));
  const rows = folders.map((f) => UI.checkRow(f.title, App.folderMatch(f, c), (v) => {
    f.include = (f.include || []).filter((x) => x !== c.id);
    f.exclude = (f.exclude || []).filter((x) => x !== c.id);
    (v ? f.include : f.exclude).push(c.id);
  }));
  const m = UI.modal({
    title: 'افزودن به پوشه', body: rows,
    foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), h('button', { class: 'btn flat', onclick: () => { setSetting('folders', folders); m.close(); App.renderSidebar(); } }, 'ذخیره')],
  });
};

App.chatSetting = async (c, body) => {
  try {
    const { chat } = await api('PATCH', `/api/chats/${c.id}/settings`, body);
    S.chats.set(chat.id, chat);
    App.renderSidebar();
    if (S.active === chat.id) App.renderChatChrome();
    if (body.archived) toast('گفتگو بایگانی شد', { label: 'برگرداندن', onClick: () => App.chatSetting(chat, { archived: false }) });
  } catch (err) { toast(err.message); }
};

App.leaveOrDelete = async (c) => {
  const isPriv = c.type === 'private';
  const owner = c.role === 'owner';
  if (!isPriv && owner) {
    const choice = await new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
      const m = UI.modal({
        title: c.type === 'channel' ? 'ترک کانال' : 'ترک گروه', cls: 'confirm',
        body: h('p', {}, `شما مالک «${chatTitle(c)}» هستید. می‌خواهید فقط خارج شوید (مالکیت به یک ادمین یا قدیمی‌ترین عضو می‌رسد) یا آن را برای همه حذف کنید؟`),
        foot: [h('button', { class: 'btn flat', onclick: () => fin(null) }, 'انصراف'), h('button', { class: 'btn flat', onclick: () => fin('leave') }, 'فقط خروج'), h('button', { class: 'btn flat danger', onclick: () => fin('delete') }, 'حذف برای همه')],
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
  for (const k of [...S.msgs.keys()]) if (k === id || String(k).startsWith(id + ':')) S.msgs.delete(k);
  S.topics.delete(id);
  if (S.active === id) App.showEmpty();
  App.renderSidebar();
};

/* =====================================================================
   FORUM TOPICS (sidebar tab, like Web K)
   ===================================================================== */
App.loadTopics = async (chatId) => {
  const { topics } = await api('GET', `/api/chats/${chatId}/topics`);
  S.topics.set(chatId, new Map(topics.map((t) => [t.id, t])));
  return S.topics.get(chatId);
};
App.topicIcon = (t, size = '') => {
  if (t.general) return h('span', { class: 'topic-ic general ' + size }, icon('hash'));
  if (t.icon_emoji) return h('span', { class: 'topic-ic emoji ' + size }, t.icon_emoji);
  return h('span', { class: 'topic-ic t' + ((t.icon_color ?? 0) % 6) + ' ' + size }, h('span', {}, [...(t.title || '?')][0]));
};
App.sortedTopics = (chatId) => [...(S.topics.get(chatId)?.values() || [])].sort((a, b) => {
  if (a.pinned_at || b.pinned_at) return (b.pinned_at || 0) - (a.pinned_at || 0);
  return (b.last_message?.created_at || b.created_at) - (a.last_message?.created_at || a.created_at);
});
App.openForum = async (chatId) => {
  const c = S.chats.get(chatId);
  if (!c) return;
  if (App.forumTab && App.forumTab.chatId === chatId) return;
  if (App.forumTab) App.side.pop(App.forumTab);
  const list = h('div', { class: 'list topics' });
  const tab = App.side.push({
    title: chatTitle(c), body: list, cls: 'forum-tab',
    actions: [ibtn('search', 'جستجو', () => { App.openTopic(chatId, 0).then(() => App.openChatSearch()); }), ibtn('more', 'بیشتر', (e) => App.forumMenu(c, e.currentTarget))],
    fab: { icon: 'plus', title: 'تاپیک جدید', onClick: () => App.topicDialog(c) },
    onClose: () => { App.forumTab = null; if (S.active === chatId && narrow()) App.showEmpty(); },
  });
  tab.chatId = chatId;
  tab.list = list;
  App.forumTab = tab;
  list.replaceChildren(h('div', { class: 'empty-hint' }, 'در حال بارگذاری…'));
  try { await App.loadTopics(chatId); } catch (e) { toast(e.message); return; }
  App.renderTopics(chatId);
};
App.forumMenu = (c, anchor) => UI.menu([
  { icon: 'info', label: 'اطلاعات گروه', onClick: () => App.openInfo(c.id) },
  { icon: c.muted ? 'bell' : 'muted', label: c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن', onClick: () => App.chatSetting(c, { muted: !c.muted }) },
  { icon: 'checks', label: 'علامت همه به‌عنوان خوانده‌شده', onClick: () => App.chatSetting(c, { read: true }).then(() => App.loadTopics(c.id)).then(() => App.renderTopics(c.id)) },
  'sep',
  { icon: 'logout', label: 'ترک گروه', danger: true, onClick: () => App.leaveOrDelete(c) },
], { anchor, alignStart: true });
App.renderTopics = (chatId) => {
  const tab = App.forumTab;
  if (!tab || tab.chatId !== chatId) return;
  const c = S.chats.get(chatId);
  tab.setTitle(chatTitle(c));
  const rows = App.sortedTopics(chatId).map((t) => {
    const last = t.last_message;
    const typing = R.typingText(chatId, t.id);
    const preview = h('div', { class: 'preview', dir: 'auto' });
    if (typing) preview.append(h('span', { class: 'typing' }, typing));
    else if (last) {
      if (last.kind !== 'service') preview.append(h('b', {}, (last.sender.id === S.me.id ? 'شما' : last.sender.display_name.split(' ')[0]) + ': '));
      preview.append(R.previewText(last));
    }
    const row = h('div', { class: 'ci topic' + (S.active === chatId && S.topic === t.id ? ' active' : ''), onclick: () => App.openTopic(chatId, t.id) },
      App.topicIcon(t),
      h('div', { class: 'body' },
        h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't', dir: 'auto' }, t.general ? 'عمومی' : t.title), t.closed ? icon('lock') : null),
          h('span', { class: 'time' }, last ? fmtListTime(last.created_at) : '')),
        h('div', { class: 'row' }, preview, t.unread ? h('span', { class: 'badge' + (c.muted ? ' muted' : '') }, fa(t.unread)) : t.pinned_at ? icon('pin', 'pin') : null)));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); App.topicMenu(c, t, e); });
    return row;
  });
  tab.list.replaceChildren(...rows);
};
App.topicMenu = (c, t, e) => {
  if (t.general) return;
  const canEdit = c.can_manage || t.created_by === S.me.id;
  UI.menu([
    c.can_manage ? { icon: 'pin', label: t.pinned_at ? 'برداشتن سنجاق' : 'سنجاق کردن', onClick: () => App.topicUpdate(t, { pinned: !t.pinned_at }) } : null,
    canEdit ? { icon: 'edit', label: 'ویرایش تاپیک', onClick: () => App.topicDialog(c, t) } : null,
    canEdit ? { icon: t.closed ? 'unlock' : 'lock', label: t.closed ? 'باز کردن تاپیک' : 'بستن تاپیک', onClick: () => App.topicUpdate(t, { closed: !t.closed }) } : null,
    canEdit ? 'sep' : null,
    canEdit ? { icon: 'trash', label: 'حذف تاپیک', danger: true, onClick: async () => {
      if (await UI.ask('حذف تاپیک', `تاپیک «${t.title}» و همه پیام‌هایش حذف می‌شود.`, 'حذف', true)) api('DELETE', `/api/topics/${t.id}`).catch((er) => toast(er.message));
    } } : null,
  ], { x: e.clientX, y: e.clientY });
};
App.topicUpdate = (t, body) => api('PATCH', `/api/topics/${t.id}`, body).then((r) => App.onTopic(r.topic)).catch((e) => toast(e.message));
const TOPIC_EMOJI = ['💬', '📌', '📣', '💡', '🐞', '🎉', '📚', '🎮', '🎵', '⚽', '🍕', '✈️', '💼', '🛠️', '❓', '🔥', '❤️', '🕊️'];
App.topicDialog = (c, t) => {
  const title = UI.field('نام تاپیک', { maxlength: 128, value: t?.title || '' });
  let emoji = t?.icon_emoji || null, color = t?.icon_color ?? Math.floor(Math.random() * 6);
  const preview = h('div', { class: 'topic-preview' });
  const paint = () => preview.replaceChildren(App.topicIcon({ title: title.input.value || 'ت', icon_emoji: emoji, icon_color: color }, 'big'));
  title.input.addEventListener('input', paint);
  const colors = h('div', { class: 'topic-colors' }, [0, 1, 2, 3, 4, 5].map((i) => h('button', { type: 'button', class: 'topic-ic t' + i, onclick: () => { color = i; emoji = null; paint(); } })));
  const emojis = h('div', { class: 'emoji-grid small' }, TOPIC_EMOJI.map((e) => h('button', { type: 'button', onclick: () => { emoji = e; paint(); } }, e)));
  paint();
  const ok = h('button', { class: 'btn flat' }, t ? 'ذخیره' : 'ساخت');
  const m = UI.modal({ title: t ? 'ویرایش تاپیک' : 'تاپیک جدید', body: [preview, title, h('div', { class: 'section-caption' }, 'آیکون'), colors, emojis],
    foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), ok] });
  ok.addEventListener('click', async () => {
    const name = title.input.value.trim();
    if (!name) return toast('یک نام بنویسید');
    try {
      const r = t ? await api('PATCH', `/api/topics/${t.id}`, { title: name, icon_emoji: emoji, icon_color: color })
        : await api('POST', `/api/chats/${c.id}/topics`, { title: name, icon_emoji: emoji, icon_color: color });
      App.onTopic(r.topic);
      m.close();
      if (!t) App.openTopic(c.id, r.topic.id);
    } catch (e) { toast(e.message); }
  });
};
App.onTopic = (t) => {
  let map = S.topics.get(t.chat_id);
  if (!map) S.topics.set(t.chat_id, (map = new Map()));
  map.set(t.id, t);
  App.renderTopics(t.chat_id);
  if (S.active === t.chat_id && S.topic === t.id) App.renderChatChrome();
};
App.openTopic = async (chatId, topicId) => {
  if (!S.topics.get(chatId)) { try { await App.loadTopics(chatId); } catch (e) { return toast(e.message); } }
  await App.openChat(chatId, { topic: topicId });
  App.renderTopics(chatId);
};

/* =====================================================================
   CHAT AREA
   ===================================================================== */
// messages are cached per chat, or per topic in forum groups
App.mkey = (chatId = S.active, topicId = S.topic) => (S.chats.get(chatId)?.is_forum ? `${chatId}:${topicId ?? 0}` : chatId);
App.msgKeyOf = (m) => App.mkey(m.chat_id, m.topic_id ?? 0);
App.isActiveKey = (key) => S.active != null && App.mkey() === key;

App.buildChatArea = () => {
  const chat = $('#chat');
  el.head = h('header', { class: 'chat-head' });
  el.pinned = h('div', { class: 'pinned-bar', hidden: true });
  el.audioBar = h('div', { class: 'audio-bar', hidden: true });
  el.searchBar = h('div', { class: 'chat-search', hidden: true });
  el.searchResults = h('div', { class: 'search-results', hidden: true });
  el.inner = h('div', { class: 'messages-inner' });
  el.messages = h('div', { class: 'messages' }, el.inner);
  el.fab = h('button', { class: 'fab-down hide', title: 'رفتن به پایین', onclick: () => App.toBottom() }, icon('down'));
  el.bottom = h('div', { class: 'bottom' });
  el.empty = h('div', { class: 'chat-empty' }, h('span', {}, 'یک گفتگو را انتخاب کنید تا پیام‌ها نمایش داده شوند'));
  el.topbars = h('div', { class: 'topbars' }, el.pinned, el.audioBar);
  chat.replaceChildren(el.empty, el.head, el.topbars, el.searchBar, el.searchResults, el.messages, el.fab, el.bottom);
  Wallpaper.mount(chat);
  el.messages.addEventListener('scroll', App.onScroll, { passive: true });
  new ResizeObserver(() => { if (App.stick) el.messages.scrollTop = el.messages.scrollHeight; }).observe(el.inner);
  // drag & drop: two drop zones like Web K (as media / as files)
  let depth = 0, zone = null;
  chat.addEventListener('dragenter', (e) => {
    if (!S.active || !e.dataTransfer?.types?.includes('Files') || !S.chats.get(S.active)?.can_post) return;
    e.preventDefault(); depth++;
    if (!zone) {
      chat.append((zone = h('div', { class: 'drop-zones' },
        h('div', { class: 'drop-zone', dataset: { as: 'file' } }, icon('file'), h('b', {}, 'فایل‌ها را اینجا رها کنید'), h('span', {}, 'ارسال بدون فشرده‌سازی')),
        h('div', { class: 'drop-zone', dataset: { as: 'media' } }, icon('image'), h('b', {}, 'عکس‌ها را اینجا رها کنید'), h('span', {}, 'ارسال سریع')))));
    }
  });
  chat.addEventListener('dragover', (e) => { if (!zone) return; e.preventDefault(); $$('.drop-zone', zone).forEach((z) => z.classList.toggle('over', z.contains(e.target))); });
  chat.addEventListener('dragleave', () => { if (zone && --depth <= 0) { zone.remove(); zone = null; depth = 0; } });
  chat.addEventListener('drop', (e) => {
    if (!zone) return;
    e.preventDefault();
    const asFile = e.target.closest?.('.drop-zone')?.dataset.as === 'file';
    zone.remove(); zone = null; depth = 0;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) App.sendFilesDialog(files, asFile);
  });
};

App.showEmpty = () => {
  App.saveDraft();
  S.active = null;
  S.topic = null;
  App.exitSelect(true);
  App.stopRecording(false);
  document.body.classList.remove('chat-open');
  el.empty.hidden = false;
  for (const k of ['head', 'topbars', 'searchBar', 'searchResults', 'messages', 'bottom']) el[k].hidden = true;
  el.fab.classList.add('hide');
  App.closeInfo();
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
    if (App.searching()) App.endSearch();
    App.openChat(chat.id);
  } catch (err) { toast(err.message); }
};
App.openUser = async (userId) => {
  if (userId === S.me.id) return App.openSaved();
  const existing = [...S.chats.values()].find((c) => c.type === 'private' && c.peer.id === userId);
  if (existing) return App.openChat(existing.id);
  try { const { user } = await api('GET', `/api/users/${userId}`); App.openPrivateWith(user.username); } catch (e) { toast(e.message); }
};

App.openChat = async (id, opts = {}) => {
  const c = S.chats.get(id);
  if (!c) return;
  if (c.is_forum && opts.topic == null) {
    // forum groups open their topic list; on wide screens we also show General
    App.openForum(id);
    if (narrow()) return;
    opts = { ...opts, topic: S.active === id && S.topic != null ? S.topic : 0 };
  }
  const topic = c.is_forum ? opts.topic ?? 0 : null;
  if (S.active !== id || S.topic !== topic) {
    App.saveDraft();
    App.stopRecording(false);
    App.exitSelect(true);
    S.reply = null;
    S.edit = null;
    App.closeChatSearch();
    if (narrow() && !document.body.classList.contains('chat-open')) history.pushState({ chat: id }, '');
    el.bottom.dataset.mode = '';
  }
  if (!c.is_forum && App.forumTab) App.side.pop(App.forumTab);
  S.active = id;
  S.topic = topic;
  if (App.searching() && !opts.keepSearch) { el.search.value = ''; $('#sidebar').classList.remove('searching'); }
  document.body.classList.add('chat-open');
  el.empty.hidden = true;
  el.head.hidden = el.messages.hidden = el.bottom.hidden = el.topbars.hidden = false;
  App.renderSidebar();
  App.scheduledCount = 0;
  App.renderChatChrome();
  App.loadScheduledCount();
  App.sepId = null;
  const key = App.mkey();
  const st = S.msgs.get(key);
  if (!st || opts.jump || st.stale) {
    el.inner.replaceChildren(h('div', { class: 'loading-more' }, 'در حال بارگذاری…'));
    try {
      if (opts.jump) await App.loadAround(id, opts.jump);
      else await App.loadInitial(id);
    } catch (err) { toast(err.message); return; }
    if (S.active !== id || S.topic !== topic) return;
  }
  const fresh = S.chats.get(id);
  const t = topic != null ? S.topics.get(id)?.get(topic) : null;
  const unread = t ? t.unread : fresh.unread;
  const lastRead = t ? t.last_read_id : fresh.last_read_id;
  if (unread > 0) {
    const first = S.msgs.get(key).list.find((m) => m.id > lastRead && m.sender.id !== S.me.id);
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
  if (document.body.classList.contains('info-open') && App.infoChat !== id) App.openInfo(id);
};

App.closeChat = () => {
  if (history.state?.chat) history.back();
  else App.showEmpty();
};
window.addEventListener('popstate', () => { if (document.body.classList.contains('chat-open') && narrow()) App.showEmpty(); });

App.historyUrl = (id, params) => {
  const c = S.chats.get(id);
  const topic = c?.is_forum ? `&topic=${S.topic ?? 0}` : '';
  return `/api/chats/${id}/messages?${params}${topic}`;
};
App.loadInitial = async (id) => {
  const c = S.chats.get(id);
  const t = c?.is_forum ? S.topics.get(id)?.get(S.topic ?? 0) : null;
  const unread = t ? t.unread : c?.unread;
  const lastRead = t ? t.last_read_id : c?.last_read_id;
  if (c && unread > 30 && lastRead) return App.loadAround(id, lastRead + 1);
  const r = await api('GET', App.historyUrl(id, 'limit=50'));
  S.msgs.set(App.mkey(id), { list: r.messages, hasMore: r.has_more, hasNewer: false });
};
App.loadAround = async (id, msgId) => {
  const r = await api('GET', App.historyUrl(id, `around=${msgId}&limit=60`));
  S.msgs.set(App.mkey(id), { list: r.messages, hasMore: r.has_more, hasNewer: r.has_newer });
};

/* ---------- header / pinned / bottom ---------- */
App.renderChatChrome = () => {
  setTimeout(() => App.paintBackBadge(), 0);
  const c = S.chats.get(S.active);
  if (!c) return;
  App.renderHeader(c);
  App.renderPinned(c);
  App.renderBottom(c);
};

App.activeTopic = () => (S.topic != null ? S.topics.get(S.active)?.get(S.topic) : null);

App.renderHeader = (c = S.chats.get(S.active)) => {
  if (!c) return;
  const t = App.activeTopic();
  const st = R.chatStatus(c, c.is_forum ? S.topic ?? 0 : undefined);
  if (S.select) return App.renderSelectHeader();
  el.moreBtn = ibtn('more', 'بیشتر', (e) => App.headerMenu(c, e.currentTarget));
  const canCall = c.type === 'private' && !isSaved(c) && !c.peer.blocked && !c.peer.system;
  const title = t ? (t.general ? 'عمومی' : t.title) : chatTitle(c);
  const status = t ? (st.typing ? st.text : chatTitle(c)) : st.text;
  el.head.replaceChildren(
    App.backBtn(c),
    h('div', { class: 'who', onclick: () => App.toggleInfo() },
      t ? App.topicIcon(t, 's40') : chatAvatar(c, 's42'),
      h('div', { class: 'wt' },
        h('div', { class: 't', dir: 'auto' }, h('span', { class: 'tt' }, title), !t && c.verified ? R.verified() : null, c.muted ? icon('muted', 'mute-ic') : null),
        status ? h('div', { class: 'st' + (st.accent ? ' accent' : '') }, status, st.typing ? R.typingDots() : null) : null)),
    h('div', { class: 'head-actions' },
      canCall ? ibtn('phone', 'تماس', () => App.startCall(c, false), 'call-btn') : null,
      ibtn('search', 'جستجو در گفتگو', () => App.openChatSearch()),
      el.moreBtn));
  if (App.connState && el.appTitle?.classList.contains('busy')) App.setConn(App.connState);
};

App.headerMenu = (c, anchor) => {
  const priv = c.type === 'private' && !isSaved(c);
  const p = c.peer;
  UI.menu([
    priv && !p.blocked && !p.system ? { icon: 'video', label: 'تماس تصویری', onClick: () => App.startCall(c, true) } : null,
    { icon: 'info', label: c.type === 'private' ? 'مشاهده پروفایل' : c.type === 'channel' ? 'اطلاعات کانال' : 'اطلاعات گروه', onClick: () => App.openInfo(c.id) },
    !isSaved(c) ? { icon: c.muted ? 'bell' : 'muted', label: c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن', onClick: () => App.chatSetting(c, { muted: !c.muted }) } : null,
    { icon: 'select', label: 'انتخاب پیام‌ها', onClick: () => App.enterSelect() },
    App.scheduledCount ? { icon: 'clock', label: 'پیام‌های زمان‌بندی‌شده', sub: fa(App.scheduledCount), onClick: () => App.scheduledDialog(c) } : null,
    c.is_forum ? { icon: 'topic', label: 'فهرست تاپیک‌ها', onClick: () => App.openForum(c.id) } : null,
    c.is_forum ? { icon: 'plus', label: 'تاپیک جدید', onClick: () => App.topicDialog(c) } : null,
    priv && !p.system ? { icon: 'personAdd', label: p.is_contact ? 'ویرایش مخاطب' : 'افزودن به مخاطبین', onClick: () => App.contactDialog(p) } : null,
    c.can_manage ? { icon: 'edit', label: 'ویرایش', onClick: () => App.editChatDialog(c) } : null,
    c.can_manage ? { icon: 'personAdd', label: c.type === 'channel' ? 'افزودن مشترک' : 'افزودن عضو', onClick: () => App.addMembersDialog(c) } : null,
    c.can_manage ? { icon: 'link', label: 'لینک دعوت', onClick: () => App.inviteDialog(c) } : null,
    'sep',
    S.me.is_admin && !isSaved(c) ? { icon: 'shield', label: c.verified ? 'برداشتن تیک آبی' : 'دادن تیک آبی', onClick: () => App.setVerified(c, !c.verified) } : null,
    priv && !p.system ? { icon: 'block', label: p.blocked ? 'رفع مسدودی' : 'مسدود کردن کاربر', danger: !p.blocked, onClick: () => App.toggleBlock(p) } : null,
    { icon: c.type === 'private' ? 'trash' : 'logout', label: c.type === 'private' ? 'حذف گفتگو' : c.type === 'channel' ? 'ترک کانال' : 'ترک گروه', danger: true, onClick: () => App.leaveOrDelete(c) },
  ], { anchor, alignStart: true });
};

App.renderPinned = (c = S.chats.get(S.active)) => {
  const p = c?.pinned_message;
  const show = !!p && (!c.is_forum || (p.topic_id ?? 0) === (S.topic ?? 0));
  el.pinned.hidden = !show;
  if (!show) return;
  const canUnpin = c.type === 'private' || c.can_manage;
  const thumb = p.media && p.kind === 'photo' && !p.media.spoiler ? h('img', { class: 'pthumb', src: p.media.url, alt: '' }) : null;
  el.pinned.replaceChildren(
    h('div', { class: 'line' }),
    thumb,
    h('div', { class: 'body', onclick: () => App.jumpTo(c.id, p.id) },
      h('div', { class: 'lbl' }, 'پیام سنجاق‌شده'),
      h('div', { class: 'txt', dir: 'auto' }, R.previewText(p))),
    canUnpin ? ibtn('close', 'برداشتن سنجاق', (e) => { e.stopPropagation(); App.pin(c, null); }) : null);
};

App.renderBottom = (c = S.chats.get(S.active)) => {
  if (!c) return;
  const key = `${c.id}:${S.topic ?? ''}`;
  if (S.select) return App.renderSelectBar();
  const t = App.activeTopic();
  if (c.type === 'private' && c.peer.blocked) {
    el.bottom.dataset.mode = 'blocked';
    el.input = null;
    el.bottom.replaceChildren(h('div', { class: 'bottom-action' }, h('button', { type: 'button', class: 'danger', onclick: () => App.toggleBlock(c.peer) }, 'رفع مسدودی')));
    return;
  }
  if (c.can_post && !(t && t.closed && !c.can_manage)) {
    if (el.bottom.dataset.mode === 'composer' && el.bottom.dataset.chat === key) { App.renderComposerBar(); return; }
    el.bottom.dataset.mode = 'composer';
    el.bottom.dataset.chat = key;
    App.buildComposer(c);
    return;
  }
  el.bottom.dataset.mode = 'action';
  el.bottom.dataset.chat = key;
  el.input = null;
  el.bottom.replaceChildren(h('div', { class: 'bottom-action' },
    t && t.closed ? h('button', { type: 'button', disabled: true }, 'این تاپیک بسته شده')
      : h('button', { type: 'button', onclick: () => App.chatSetting(c, { muted: !c.muted }) }, c.muted ? 'فعال کردن اعلان' : 'بی‌صدا کردن')));
};

/* ---------- messages rendering ---------- */
App.stick = true;
const sameGroup = (a, b) => a && b && a.kind !== 'service' && b.kind !== 'service' && a.sender.id === b.sender.id &&
  sameDay(new Date(a.created_at), new Date(b.created_at)) && Math.abs(b.created_at - a.created_at) < 5 * 60e3;
App.flags = (list, i) => ({ first: !sameGroup(list[i - 1], list[i]), last: !sameGroup(list[i], list[i + 1]) });
App.els = new Map();

// collapse consecutive messages of one album into a single item
App.units = (list) => {
  const out = [];
  for (const m of list) {
    const prev = out.at(-1);
    if (m.grouped_id && prev && prev.grouped_id === m.grouped_id && prev.sender.id === m.sender.id && !m.pending) {
      prev.group = prev.group || [prev.msg];
      prev.group.push(m);
      continue;
    }
    out.push({ msg: m, grouped_id: m.grouped_id, sender: m.sender, kind: m.kind, created_at: m.created_at, id: m.id });
  }
  return out;
};

App.renderMessages = () => {
  const c = S.chats.get(S.active);
  const st = S.msgs.get(App.mkey());
  if (!c || !st) return;
  const frag = document.createDocumentFragment();
  App.els = new Map();
  if (st.hasMore) frag.append(h('div', { class: 'loading-more', id: 'older' }, 'در حال بارگذاری پیام‌های قدیمی‌تر…'));
  else if (!st.list.length) frag.append(App.emptyPlaceholder(c));
  const units = App.units(st.list);
  let lastDay = '';
  units.forEach((u, i) => {
    const m = u.msg;
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { frag.append(h('div', { class: 'day' }, h('span', {}, fmtDay(m.created_at)))); lastDay = day; }
    const ids = u.group ? u.group.map((x) => x.id) : [m.id];
    if (App.sepId && ids.includes(App.sepId)) frag.append(h('div', { class: 'unread-sep' }, h('span', {}, 'پیام‌های خوانده‌نشده')));
    const node = R.message(c, m, { ...App.flags(units, i), group: u.group });
    ids.forEach((id) => App.els.set(id, node));
    frag.append(node);
  });
  if (st.hasNewer) frag.append(h('div', { class: 'loading-more', id: 'newer' }, 'در حال بارگذاری…'));
  for (const p of S.pending.values()) if (p.key === App.mkey()) frag.append(App.pendingNode(p));
  el.inner.replaceChildren(frag);
};
App.emptyPlaceholder = (c) => {
  if (isSaved(c)) return h('div', { class: 'empty-chat' }, h('div', { class: 'ec-ic' }, icon('bookmark')), h('b', {}, 'پیام‌های ذخیره‌شده'),
    h('p', {}, '• پیام‌ها را برای نگه‌داشتن اینجا بازارسال کنید\n• فایل‌ها و عکس‌ها را اینجا ذخیره کنید\n• از هر دستگاهی به آن‌ها دسترسی دارید'));
  if (c.type === 'private') {
    const sticker = S.stickers?.[0]?.stickers?.[0];
    return h('div', { class: 'empty-chat greet' }, h('b', {}, 'هنوز پیامی نیست…'), h('p', {}, 'یک پیام بفرستید یا روی استیکر زیر بزنید تا سلام کنید.'),
      h('button', { type: 'button', class: 'greet-st', onclick: async () => { const packs = await App.loadStickers(); const st = packs[0]?.stickers?.[0]; if (st) App.sendSticker(st); } },
        h('img', { src: sticker?.url || '/stickers/kabootar/01.svg', alt: '' })));
  }
  return h('div', { class: 'service' }, h('span', {}, c.type === 'channel' ? 'هنوز پستی منتشر نشده' : 'هنوز پیامی نیست. سلام کنید 👋'));
};

App.pendingNode = (p) => {
  const node = R.message(S.chats.get(p.chatId), p.msg, { first: true, last: true });
  p.node = node;
  p.bar = $('.up-progress i', node);
  if (p.bar) p.bar.style.width = Math.round(p.progress * 100) + '%';
  return node;
};

App.isLiveEnd = (key) => { const st = S.msgs.get(key); return st && !st.hasNewer; };

App.insertMessage = (m) => {
  const key = App.msgKeyOf(m);
  const st = S.msgs.get(key);
  if (!st || st.hasNewer) return false;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i >= 0) { App.replaceMessage(m); return true; }
  const lastMsg = st.list.at(-1);
  st.list.push(m);
  if (lastMsg && lastMsg.id > m.id) st.list.sort((a, b) => a.id - b.id);
  if (!App.isActiveKey(key)) return true;
  const c = S.chats.get(m.chat_id);
  const idx = st.list.indexOf(m);
  const prev = st.list[idx - 1];
  const joinsAlbum = m.grouped_id && prev && prev.grouped_id === m.grouped_id;
  if (idx !== st.list.length - 1 || joinsAlbum || st.list.length === 1) {
    const atBottom = App.atBottom();
    App.renderMessages();
    if (atBottom) App.scrollBottom();
    return true;
  }
  // re-render the previous message (its tail/grouping may change), then append
  const units = App.units(st.list);
  const ui = units.length - 1;
  if (prev && App.els.has(prev.id) && ui > 0) {
    const pu = units[ui - 1];
    const fresh = R.message(c, pu.msg, { ...App.flags(units, ui - 1), group: pu.group });
    App.els.get(prev.id).replaceWith(fresh);
    (pu.group ? pu.group.map((x) => x.id) : [pu.msg.id]).forEach((id) => App.els.set(id, fresh));
  }
  const node = R.message(c, m, App.flags(units, ui));
  node.classList.add('appear');
  App.els.set(m.id, node);
  const anchor = $('.pending', el.inner) || $('#newer', el.inner);
  const frag = document.createDocumentFragment();
  if (!prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()) frag.append(h('div', { class: 'day' }, h('span', {}, fmtDay(m.created_at))));
  frag.append(node);
  if (anchor) el.inner.insertBefore(frag, anchor);
  else el.inner.append(frag);
  return true;
};

App.replaceMessage = (m) => {
  const key = App.msgKeyOf(m);
  const st = S.msgs.get(key);
  if (!st) return;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i < 0) return;
  st.list[i] = m;
  if (!App.isActiveKey(key)) return;
  const old = App.els.get(m.id);
  if (!old) return;
  if (m.grouped_id) { const top = el.messages.scrollTop; App.renderMessages(); el.messages.scrollTop = top; return; }
  const units = App.units(st.list);
  const ui = units.findIndex((u) => u.msg.id === m.id);
  const node = R.message(S.chats.get(m.chat_id), m, App.flags(units, ui));
  old.replaceWith(node);
  App.els.set(m.id, node);
};

App.removeMessages = (chatId, ids) => {
  const set = new Set(ids);
  for (const [key, st] of S.msgs) {
    if (key !== chatId && !String(key).startsWith(chatId + ':')) continue;
    const before = st.list.length;
    st.list = st.list.filter((m) => !set.has(m.id));
    if (st.list.length !== before && App.isActiveKey(key)) {
      const top = el.messages.scrollTop;
      App.renderMessages();
      el.messages.scrollTop = top;
    }
  }
  if (S.select) { ids.forEach((id) => S.select.delete(id)); App.renderSelectBar(); }
};

App.updateTicks = (c) => {
  if (c.id !== S.active) return;
  for (const t of $$('.ticks', el.inner)) {
    const read = c.others_read_id >= Number(t.dataset.id);
    t.classList.toggle('read', read);
    t.replaceChildren(icon(read ? 'checks' : 'check'));
  }
};

/* ---------- scrolling ---------- */
App.atBottom = () => el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 80;
App.scrollBottom = () => { App.stick = true; el.messages.scrollTop = el.messages.scrollHeight; };
App.toBottom = async () => {
  const st = S.msgs.get(App.mkey());
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
  const key = App.mkey();
  const st = S.msgs.get(key);
  if (!st) return;
  App.stick = App.atBottom() && !st.hasNewer;
  const c = S.chats.get(id);
  const t = App.activeTopic();
  const unread = t ? t.unread : c?.unread;
  const showFab = !App.atBottom() || st.hasNewer;
  el.fab.classList.toggle('hide', !showFab);
  el.fab.querySelector('.badge')?.remove();
  if (showFab && unread) el.fab.append(h('span', { class: 'badge' }, fa(unread)));
  if (App.atBottom() && !st.hasNewer) App.markRead();

  if (box.scrollTop < 400 && st.hasMore && !loadingOlder) {
    loadingOlder = true;
    try {
      const first = st.list[0];
      const r = await api('GET', App.historyUrl(id, `before=${first.id}&limit=50`));
      if (App.mkey() !== key) return;
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
      const r = await api('GET', App.historyUrl(id, `after=${lastMsg.id}&limit=50`));
      if (App.mkey() !== key) return;
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
  const st = S.msgs.get(App.mkey());
  if (!c || !st || document.hidden || st.hasNewer) return;
  const lastMsg = st.list.at(-1);
  if (!lastMsg) return;
  if (c.is_forum) {
    const t = App.activeTopic();
    if (!t) return;
    const changed = t.unread > 0;
    if (changed) { c.unread = Math.max(0, (c.unread || 0) - t.unread); t.unread = 0; }
    if (lastMsg.id > (t.last_read_id || 0)) {
      t.last_read_id = lastMsg.id;
      const body = { type: 'read', chat_id: c.id, message_id: lastMsg.id, topic_id: S.topic ?? 0 };
      if (!App.wsSend(body)) api('POST', `/api/chats/${c.id}/read`, body).catch(() => {});
    }
    if (changed) { App.renderSidebar(); App.renderTopics(c.id); }
    return;
  }
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
App.draftKey = () => App.mkey();
App.buildComposer = (c) => {
  el.input = h('textarea', { rows: 1, placeholder: c.type === 'channel' ? 'انتشار پست…' : 'پیام', dir: 'auto', 'aria-label': 'پیام' });
  el.bar = h('div', { class: 'bar', hidden: true });
  el.suggest = h('div', { class: 'sticker-suggest', hidden: true });
  el.emojiBtn = h('button', { class: 'ibtn emoji-btn', type: 'button', title: 'اموجی، استیکر و GIF', onclick: () => App.toggleEmoji() }, icon('smile'));
  el.attachBtn = ibtn('attach', 'پیوست', () => App.attachMenu());
  el.attachBtn.classList.add('attach-btn');
  el.row = h('div', { class: 'row' }, el.attachBtn, el.input, el.emojiBtn);
  el.fmt = h('div', { class: 'fmt-bar', hidden: true }, [
    ['b', '**', 'پررنگ'], ['i', '__', 'کج'], ['s', '~~', 'خط‌خورده'], ['code', '`', 'تک‌فاصله'], ['spoiler', '||', 'اسپویلر'],
  ].map(([cls, mark, label]) => h('button', { type: 'button', class: 'f-' + cls, title: label, onmousedown: (e) => { e.preventDefault(); App.wrapSelection(mark); } }, cls === 'spoiler' ? '▒' : cls === 'code' ? '</>' : cls.toUpperCase())),
  h('button', { type: 'button', class: 'f-link', title: 'لینک', onmousedown: async (e) => { e.preventDefault(); App.insertLink(); } }, icon('link')));
  el.composer = h('div', { class: 'composer' }, el.bar, el.fmt, el.row, R.tail());
  el.sendBtn = h('button', { class: 'send-btn', type: 'button', 'aria-label': 'ارسال', onclick: (e) => App.onSendBtn(e) });
  el.sendBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); App.sendBtnMenu(e); });
  UI.longPress(el.sendBtn, (e) => { if (el.input?.value.trim()) App.sendBtnMenu(e); });
  Rec.bind(el.sendBtn);
  el.fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  el.fileInput.addEventListener('change', () => {
    const files = [...el.fileInput.files];
    el.fileInput.value = '';
    if (files.length) App.sendFilesDialog(files, el.fileInput.dataset.asFile === '1');
  });
  el.bottom.replaceChildren(el.suggest, h('div', { class: 'composer-wrap' }, el.composer, el.sendBtn, el.fileInput));
  el.input.value = S.drafts[App.draftKey()] || '';
  App.recMode = store('recMode', 'voice');
  App.autoGrow();
  App.updateSendBtn();
  App.renderComposerBar();

  let draftTimer;
  el.input.addEventListener('input', () => {
    App.autoGrow();
    App.updateSendBtn();
    App.suggestStickers();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(App.saveDraft, 500);
    App.sendTyping('typing');
  });
  el.input.addEventListener('keydown', (e) => {
    const ctrlSend = S.settings.send_key === 'ctrl';
    if (e.key === 'Enter' && !e.isComposing && !narrow() && (ctrlSend ? e.ctrlKey || e.metaKey : !e.shiftKey && !e.ctrlKey)) { e.preventDefault(); App.sendText(); }
    else if (e.key === 'Escape' && (S.reply || S.edit)) { e.preventDefault(); App.cancelBar(); }
    else if (e.key === 'ArrowUp' && !el.input.value && !S.edit) {
      const st = S.msgs.get(App.mkey());
      const mine = st?.list.slice().reverse().find((m) => m.sender.id === S.me.id && App.canEdit(c, m));
      if (mine) { e.preventDefault(); App.startEdit(mine); }
    } else if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === 'k') App.insertLink(); else App.wrapSelection(k === 'b' ? '**' : '__');
    }
  });
  const fmtCheck = () => { el.fmt.hidden = !(el.input && el.input.selectionEnd > el.input.selectionStart && document.activeElement === el.input); };
  el.input.addEventListener('select', fmtCheck);
  el.input.addEventListener('keyup', fmtCheck);
  el.input.addEventListener('mouseup', fmtCheck);
  el.input.addEventListener('blur', () => setTimeout(fmtCheck, 100));
  el.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); App.sendFilesDialog(files, false); }
  });
};

App.wrapSelection = (mark) => {
  const i = el.input;
  if (!i) return;
  const s = i.selectionStart, e = i.selectionEnd;
  const sel = i.value.slice(s, e);
  const wrapped = sel.startsWith(mark) && sel.endsWith(mark) && sel.length > mark.length * 2 ? sel.slice(mark.length, -mark.length) : mark + sel + mark;
  i.value = i.value.slice(0, s) + wrapped + i.value.slice(e);
  i.setSelectionRange(s, s + wrapped.length);
  i.focus();
  App.autoGrow(); App.updateSendBtn();
};
App.insertLink = async () => {
  const i = el.input;
  if (!i) return;
  const s = i.selectionStart, e = i.selectionEnd;
  const url = await UI.prompt('افزودن لینک', 'آدرس (https://…)', 'https://', { dir: 'ltr' });
  if (!url) return;
  const label = i.value.slice(s, e);
  const ins = label ? `${label} (${url})` : url;
  i.value = i.value.slice(0, s) + ins + i.value.slice(e);
  i.focus();
  App.autoGrow(); App.updateSendBtn();
};

App.toggleEmoji = () => {
  UI.emojiDropdown(el.emojiBtn, {
    onEmoji: (e) => App.insertText(e, true),
    onSticker: (st) => { App.sendSticker(st); if (narrow()) UI.closeEmoji(); },
    onGif: (g) => { App.sendGif(g); UI.closeEmoji(); },
  });
  if ($('.emoji-pop')) App.sendTyping('choosing_sticker');
};

App.autoGrow = () => {
  if (!el.input) return;
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 220) + 'px';
};
App.insertText = (t, keepFocus) => {
  const i = el.input;
  if (!i) return;
  const s = i.selectionStart ?? i.value.length, e = i.selectionEnd ?? i.value.length;
  i.value = i.value.slice(0, s) + t + i.value.slice(e);
  i.selectionStart = i.selectionEnd = s + t.length;
  if (!keepFocus || !narrow()) i.focus();
  App.autoGrow();
  App.updateSendBtn();
  App.suggestStickers();
};
App.updateSendBtn = (morph) => {
  if (!el.sendBtn) return;
  const hasText = !!el.input?.value.trim() || !!S.edit;
  const mode = S.rec ? (S.rec.locked ? 'rec' : 'hold') : hasText ? 'send' : App.recMode === 'round' ? 'round' : 'mic';
  if (el.sendBtn.dataset.mode === mode) return;
  const prev = el.sendBtn.dataset.mode;
  el.sendBtn.dataset.mode = mode;
  el.sendBtn.classList.toggle('recording', mode === 'rec' || mode === 'hold');
  el.sendBtn.classList.toggle('holding', mode === 'hold');
  const name = mode === 'mic' ? 'mic' : mode === 'round' ? 'camera' : mode === 'hold' ? (S.rec.kind === 'round' ? 'camera' : 'mic') : S.edit ? 'check' : 'send';
  const ic = icon(name, (name === 'send' ? 'flip ' : '') + (morph || (prev && prev !== mode && mode !== 'hold') ? 'morph' : ''));
  el.sendBtn.replaceChildren(ic);
  el.sendBtn.title = mode === 'mic' ? 'برای ضبط صدا نگه دارید، برای ویدیو بزنید' : mode === 'round' ? 'برای ضبط ویدیو نگه دارید، برای صدا بزنید' : 'ارسال';
};
App.onSendBtn = (e) => {
  if (Date.now() < Rec.ignoreClickUntil) return;
  if (S.rec) return Rec.stop(true);
  if (el.input?.value.trim() || S.edit) return App.sendText();
  // keyboard activation (Enter / Space) starts a locked recording; pointers are handled by Rec.bind
  if (e && e.detail === 0) Rec.start(App.recMode === 'round' ? 'round' : 'voice');
};
App.sendBtnMenu = (e) => {
  if (S.rec) return;
  if (el.input?.value.trim() && !S.edit) {
    const c = S.chats.get(S.active);
    return UI.menu([
      !isSaved(c) ? { icon: 'muted', label: 'ارسال بدون صدا', onClick: () => App.sendText({ silent: true }) } : null,
      { icon: 'clock', label: isSaved(c) ? 'یادآوری' : 'زمان‌بندی پیام', onClick: () => App.scheduleDialog() },
      { icon: 'link', label: 'ارسال بدون پیش‌نمایش لینک', onClick: () => App.sendText({ no_preview: true }) },
    ], { anchor: el.sendBtn, up: true });
  }
  Rec.toggleMode();
};

App.saveDraft = () => {
  if (!S.active || !el.input || el.bottom.dataset.chat !== `${S.active}:${S.topic ?? ''}` || S.edit) return;
  const key = App.draftKey();
  const v = el.input.value;
  const had = !!S.drafts[key];
  if (v.trim()) S.drafts[key] = v; else delete S.drafts[key];
  save('drafts', S.drafts);
  if (had !== !!v.trim()) App.renderSidebar();
};

App.renderComposerBar = () => {
  if (!el.bar) return;
  const m = S.edit || S.reply;
  el.bar.hidden = !m;
  App.updateSendBtn();
  if (!m) return;
  const thumb = m.media && (m.kind === 'photo') ? h('img', { class: 'pthumb', src: m.media.url, alt: '' }) : m.kind === 'sticker' ? h('img', { class: 'pthumb', src: m.sticker.url, alt: '' }) : null;
  el.bar.replaceChildren(
    h('span', { class: 'ic' }, icon(S.edit ? 'edit' : 'reply')),
    thumb,
    h('div', { class: 'body', onclick: () => App.jumpTo(m.chat_id, m.id) },
      h('div', { class: 'lbl' }, S.edit ? 'ویرایش پیام' : `پاسخ به ${m.sender.display_name}`),
      h('div', { class: 'txt', dir: 'auto' }, R.previewText(m))),
    ibtn('close', 'لغو', App.cancelBar));
};
App.startReply = (m) => {
  const c = S.chats.get(m.chat_id);
  if (!c?.can_post || !el.input) return;
  if (S.edit) { S.edit = null; el.input.value = S.drafts[App.draftKey()] || ''; }
  S.reply = m;
  App.renderComposerBar();
  el.input?.focus();
};
App.canEdit = (c, m) => m.sender.id === S.me.id && !m.forward && !['poll', 'service', 'sticker', 'call', 'video_note', 'voice'].includes(m.kind) && Date.now() - m.created_at < 48 * 3600e3 && c.can_post;
App.startEdit = (m) => {
  if (!el.input) return;
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
  if (S.edit && el.input) { el.input.value = S.drafts[App.draftKey()] || ''; App.autoGrow(); }
  S.reply = null;
  S.edit = null;
  App.renderComposerBar();
};

App.wsSend = (obj) => {
  if (S.ws && S.wsLive && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; }
  if (S.pollLive && S.poll?.sid) {
    const sid = S.poll.sid;
    api('POST', `/api/live/${sid}/send`, obj).then((r) => {
      if (obj.ref != null && wsPending.has(obj.ref)) App.onEvent({ type: 'ack', ref: obj.ref, result: r.result });
    }).catch((e) => {
      if (obj.ref != null && wsPending.has(obj.ref)) App.onEvent({ type: 'error', ref: obj.ref, code: e.code, message: e.message });
      else if (obj.type === 'send' || obj.type === 'edit') toast(e.message);
    });
    return true;
  }
  return false;
};

/* ---------- HTTP live events (fallback transport when WebSockets are blocked) ---------- */
App.startPoll = () => {
  if (S.poll || !S.token || !S.me || S.manualClose || S.wsLive) return;
  S.poll = { sid: null, ack: 0, fails: 0, alive: true, running: false };
  App.pollLoop(S.poll);
};
App.stopPoll = () => {
  const p = S.poll;
  if (!p) return;
  p.alive = false;
  S.poll = null;
  S.pollLive = false;
  S.wsReady = !!S.wsLive;
  try { p.ctrl?.abort(); } catch {}
  if (p.sid) api('DELETE', `/api/live/${p.sid}`).catch(() => {});
};
App.pollLoop = async (p) => {
  if (p.running) return;
  p.running = true;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    while (p.alive && S.poll === p && S.token) {
      try {
        if (!p.sid) {
          const r = await api('POST', '/api/live', {});
          if (!p.alive) return;
          p.sid = r.sid;
          p.ack = 0;
          for (const x of r.events) App.onEvent({ ...x.ev, __poll: true });
        }
        p.ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const guard = setTimeout(() => { try { p.ctrl?.abort(); } catch {} }, 32000);
        const r = await api('GET', `/api/live/${p.sid}?ack=${p.ack}`, undefined, { signal: p.ctrl?.signal });
        clearTimeout(guard);
        if (!p.alive) return;
        p.fails = 0;
        App.lastRx = Date.now();
        if (!S.pollLive) { S.pollLive = true; S.wsReady = true; App.setConn(null); }
        for (const x of r.events) {
          p.ack = Math.max(p.ack, x.seq);
          if (x.ev.type === '__closed') { if (x.ev.code === 4001) api('GET', '/api/me').catch(() => {}); p.sid = null; continue; }
          App.onEvent(x.ev);
        }
      } catch (e) {
        if (!p.alive) return;
        if (e.code === 'live_gone') { p.sid = null; continue; }
        p.fails++;
        if (p.fails >= 2 && S.pollLive) { S.pollLive = false; S.wsReady = !!S.wsLive; }
        if (!S.wsReady) App.setConn(navigator.onLine === false ? 'offline' : 'connecting');
        await pause(Math.min(8000, 700 * p.fails));
      }
    }
  } finally { p.running = false; }
};
// request/response over the socket (matched by ref)
let wsRef = 1;
const wsPending = new Map();
App.wsRequest = (obj, ms = 15000) => new Promise((resolve, reject) => {
  const ref = 'r' + wsRef++;
  if (!App.wsSend({ ...obj, ref })) return reject(new ApiError('network', ERRORS.network));
  const t = setTimeout(() => { wsPending.delete(ref); reject(new ApiError('timeout', 'پاسخی از سرور نیامد')); }, ms);
  wsPending.set(ref, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
});

let lastTyping = 0;
App.sendTyping = (action, force) => {
  const now = Date.now();
  const c = S.chats.get(S.active);
  if (!c || c.type === 'channel' || isSaved(c) || S.edit || now - lastTyping < 3500) return;
  if (action === 'typing' && !el.input?.value.trim() && !force) return;
  lastTyping = now;
  App.wsSend({ type: 'typing', chat_id: c.id, action, topic_id: c.is_forum ? S.topic ?? 0 : undefined });
};

App.topicFields = (c) => (c?.is_forum ? { topic_id: S.topic ?? 0 } : {});
App.afterSend = () => { App.sepId = null; App.scrollBottom(); Wallpaper.animate(); Sound.play('out'); };

App.sendText = async (extra = {}) => {
  const c = S.chats.get(S.active);
  if (!c || !el.input) return;
  const text = el.input.value.trim();
  const editing = S.edit, reply = S.reply;
  if (!text && !(editing && editing.kind !== 'text')) return;
  el.input.value = '';
  App.autoGrow();
  el.suggest.hidden = true;
  S.edit = null; S.reply = null;
  delete S.drafts[App.draftKey()];
  save('drafts', S.drafts);
  App.renderComposerBar();
  App.sepId = null;
  lastTyping = 0;
  try {
    if (editing) {
      if (text === editing.text) return;
      if (!App.wsSend({ type: 'edit', message_id: editing.id, text })) App.replaceMessage((await api('PATCH', `/api/messages/${editing.id}`, { text })).message);
      el.input.value = S.drafts[App.draftKey()] || '';
      return;
    }
    // Telegram-style: split very long text into several messages
    const parts = [];
    for (let i = 0; i < text.length; i += 4096) parts.push(text.slice(i, i + 4096));
    for (const [n, part] of parts.entries()) {
      const body = { type: 'send', chat_id: c.id, text: part, reply_to: n === 0 && reply ? reply.id : null, ...App.topicFields(c), ...extra };
      if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message);
    }
    App.afterSend();
  } catch (err) {
    toast(err.message);
    el.input.value = text;
    App.autoGrow();
  }
  App.updateSendBtn();
};

App.sendSticker = async (st) => {
  const c = S.chats.get(S.active);
  if (!c?.can_post) return;
  const body = { type: 'send', chat_id: c.id, sticker_id: st.id, reply_to: S.reply?.id || null, ...App.topicFields(c) };
  if (S.reply) { S.reply = null; App.renderComposerBar(); }
  if (el.input && el.suggest) { el.suggest.hidden = true; if (R.isBigEmoji(el.input.value.trim())) { el.input.value = ''; App.autoGrow(); App.updateSendBtn(); } }
  try { if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message); App.afterSend(); } catch (e) { toast(e.message); }
};
App.sendGif = async (g) => {
  const c = S.chats.get(S.active);
  if (!c?.can_post) return;
  try {
    let fileId = g.file_id, meta = g.meta;
    if (g.remote) { const r = await api('POST', '/api/gifs/remote', { result_id: g.remote }); fileId = r.file.id; meta = r.meta; }
    const body = { type: 'send', chat_id: c.id, file_id: fileId, gif: true, meta, reply_to: S.reply?.id || null, ...App.topicFields(c) };
    if (S.reply) { S.reply = null; App.renderComposerBar(); }
    if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message);
    App.afterSend();
  } catch (e) { toast(e.message); }
};
// Web K "stickers helper": typing a single emoji suggests matching stickers
App.suggestStickers = () => {
  if (!el.suggest || !el.input) return;
  const t = el.input.value.trim();
  if (S.settings.suggest_stickers === false || !t || !R.isBigEmoji(t) || [...t.matchAll(/\p{Extended_Pictographic}/gu)].length !== 1) { el.suggest.hidden = true; return; }
  const base = t.replace(/\ufe0f/g, '');
  const matches = (S.stickers || []).flatMap((p) => p.stickers).filter((s) => s.emoji && s.emoji.replace(/\ufe0f/g, '') === base);
  if (!matches.length) { el.suggest.hidden = true; if (!S.stickers) App.loadStickers().then(() => App.suggestStickers()); return; }
  el.suggest.replaceChildren(...matches.slice(0, 12).map((st) => h('button', { type: 'button', onclick: () => { App.rememberSticker(st); App.sendSticker(st); } }, h('img', { src: st.url, alt: '' }))));
  el.suggest.hidden = false;
};

App.attachMenu = () => {
  const c = S.chats.get(S.active);
  UI.menu([
    { icon: 'oImage', label: 'عکس یا ویدیو', onClick: () => { el.fileInput.accept = 'image/*,video/*'; el.fileInput.dataset.asFile = '0'; el.fileInput.click(); } },
    { icon: 'oFile', label: 'فایل', onClick: () => { el.fileInput.accept = ''; el.fileInput.dataset.asFile = '1'; el.fileInput.click(); } },
    c.type !== 'private' ? { icon: 'oPoll', label: 'نظرسنجی', onClick: () => App.pollDialog(c) } : null,
  ], { anchor: el.attachBtn, up: true, cls: 'attach-menu', onClose: () => el.attachBtn.classList.remove('open') });
  el.attachBtn.classList.add('open');
};

/* ---------- uploads ---------- */
function mediaMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let done = false;
    const fin = (meta) => { if (!done) { done = true; resolve({ ...meta, url }); } };
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => fin({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => fin({});
      img.src = url;
    } else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      const v = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
      v.preload = 'metadata';
      v.onloadedmetadata = () => fin({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined });
      v.onerror = () => fin({});
      v.src = url;
      setTimeout(() => fin({}), 3000);
    } else fin({});
  });
}
const guessKind = (file, o = {}) => {
  if (o.voice) return 'voice';
  if (o.round) return 'video_note';
  if (o.asFile) return 'file';
  if (file.type === 'image/gif') return 'gif';
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) return 'photo';
  if (/^video\/(mp4|webm|quicktime)$/.test(file.type)) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
};

App.upload = async (file, { caption = '', asFile = false, voice = false, round = false, duration, replyTo = null, grouped = null, spoiler = false, meta: extraMeta = null } = {}) => {
  const chatId = S.active;
  const c = S.chats.get(chatId);
  if (!c?.can_post) return;
  const topic = App.topicFields(c);
  if (file.size > S.config.max_upload_mb * 1048576) return toast(`حداکثر حجم فایل ${fa(S.config.max_upload_mb)} مگابایت است`);
  const meta = await mediaMeta(file);
  if (duration) meta.duration = duration;
  if (extraMeta?.waveform) meta.waveform = extraMeta.waveform;
  const kind = guessKind(file, { asFile, voice, round });
  const localId = 'p' + Date.now() + Math.random().toString(36).slice(2, 7);
  const key = App.mkey();
  const p = {
    localId, chatId, key, progress: 0,
    msg: {
      id: localId, localId, pending: true, chat_id: chatId, topic_id: topic.topic_id ?? null, kind, text: caption, sender: S.me, reactions: [], created_at: Date.now(),
      media: { url: meta.url, mime: file.type, size: file.size, name: file.name, width: meta.width, height: meta.height, duration: meta.duration, waveform: meta.waveform },
    },
  };
  S.pending.set(localId, p);
  if (App.mkey() === key) { el.inner.append(App.pendingNode(p)); App.scrollBottom(); }
  const typingTimer = setInterval(() => { lastTyping = 0; if (S.active === chatId) App.sendTyping(voice ? 'recording' : round ? 'recording_round' : 'uploading', true); }, 4000);
  try {
    p.upload = uploadFile(file, file.name, (x) => { p.progress = x; if (p.bar) p.bar.style.width = Math.round(x * 100) + '%'; });
    const f = await p.upload;
    if (!S.pending.has(localId)) return;
    const body = {
      type: 'send', chat_id: chatId, file_id: f.id, text: caption, voice, video_note: round, as_file: asFile, reply_to: replyTo,
      grouped_id: grouped, spoiler, meta: { width: meta.width || extraMeta?.width, height: meta.height || extraMeta?.height, duration: meta.duration, waveform: meta.waveform }, ...topic,
    };
    if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${chatId}/messages`, body)).message);
    if (!voice && !round) Sound.play('out');
    if (S.active === chatId) Wallpaper.animate();
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

/* ---------- voice recording (with a real waveform, like Telegram) ---------- */
/* =====================================================================
   MESSAGE ACTIONS
   ===================================================================== */
App.messageMenu = (c, m, e, group) => {
  if (S.select) return;
  const mine = m.sender.id === S.me.id;
  const canDelete = mine || c.type === 'private' || c.can_manage;
  const canPin = c.type === 'private' || c.can_manage;
  const pinned = c.pinned_message?.id === m.id;
  const saved = [...S.chats.values()].find(isSaved);
  const myReaction = m.reactions?.find((r) => r.mine)?.emoji;
  const ids = group ? group.map((x) => x.id) : [m.id];
  const capMsg = group ? group.find((x) => x.text) || m : m;
  const reactions = m.kind !== 'service' ? h('div', { class: 'reactions-pop' }, S.config.reactions.map((emo) =>
    h('button', { type: 'button', class: emo === myReaction ? 'on' : '', onclick: () => { UI.closeMenu(); App.react(m, emo); } }, emo))) : null;
  const isGif = m.kind === 'gif' && m.media;
  UI.menu([
    c.can_post ? { icon: 'reply', label: 'پاسخ', onClick: () => App.startReply(m) } : null,
    App.canEdit(c, capMsg) ? { icon: 'edit', label: 'ویرایش', onClick: () => App.startEdit(capMsg) } : null,
    capMsg.text && m.kind !== 'poll' ? { icon: 'copy', label: 'کپی متن', onClick: () => copyText(R.stripMarkup(capMsg.text).replace(/▒+/g, '')) } : null,
    c.username && c.type !== 'private' ? { icon: 'link', label: 'کپی لینک پیام', onClick: () => copyText(`${location.origin}/#/@${c.username}/${m.id}`, 'لینک کپی شد') } : null,
    canPin ? { icon: 'pin', label: pinned ? 'برداشتن سنجاق' : 'سنجاق کردن', onClick: () => App.pin(c, pinned ? null : m.id) } : null,
    m.kind !== 'call' ? { icon: 'forward', label: 'بازارسال', onClick: () => App.forwardDialog(ids) } : null,
    saved && saved.id !== c.id && m.kind !== 'call' ? { icon: 'bookmark', label: 'ذخیره در پیام‌های ذخیره‌شده', onClick: () => App.forward(ids, saved.id, true) } : null,
    isGif ? { icon: 'gif', label: 'ذخیره GIF', onClick: () => api('POST', '/api/gifs', { file_id: m.media.id }).then((r) => { S.gifs = r.gifs; toast('GIF ذخیره شد'); }).catch((er) => toast(er.message)) } : null,
    m.kind === 'sticker' ? { icon: 'sticker', label: 'مشاهده بسته‌ی استیکر', onClick: () => App.stickerPackOf(m) } : null,
    m.media ? { icon: 'download', label: 'دانلود', onClick: () => { for (const x of group || [m]) { const a = h('a', { href: x.media.url, download: x.media.name }); document.body.append(a); a.click(); a.remove(); } } } : null,
    { icon: 'select', label: 'انتخاب', onClick: () => App.enterSelect(ids) },
    canDelete ? 'sep' : null,
    canDelete ? { icon: 'trash', label: 'حذف', danger: true, onClick: () => App.deleteMessages(ids) } : null,
  ], { x: e.clientX, y: e.clientY, reactions, cls: 'msg-menu',
    onClose: () => e.row?.classList.remove('menu-target') });
  e.row?.classList.add('menu-target');
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
  if (!ok) return false;
  try { await api('POST', '/api/messages/delete', { message_ids: ids }); return true; } catch (e) { toast(e.message); return false; }
};
App.forward = async (ids, toChatId, quiet, topicId) => {
  try {
    await api('POST', '/api/messages/forward', { to_chat_id: toChatId, message_ids: ids, to_topic_id: topicId ?? undefined });
    if (quiet) toast('در پیام‌های ذخیره‌شده ذخیره شد');
    else App.openChat(toChatId, topicId != null ? { topic: topicId } : {});
  } catch (e) { toast(e.message); }
};

/* ---------- select mode (Web K) ---------- */
App.enterSelect = (ids = []) => {
  S.select = new Set(ids);
  document.body.classList.add('selecting');
  App.renderHeader();
  App.renderSelectBar();
  App.renderMessages();
};
App.exitSelect = (silent) => {
  if (!S.select) return;
  S.select = null;
  document.body.classList.remove('selecting');
  if (silent) return;
  el.bottom.dataset.mode = '';
  App.renderChatChrome();
  App.renderMessages();
};
App.toggleSelect = (m, group) => {
  if (!S.select || m.kind === 'service') return;
  const ids = group ? group.map((x) => x.id) : [m.id];
  const on = !ids.every((id) => S.select.has(id));
  ids.forEach((id) => (on ? S.select.add(id) : S.select.delete(id)));
  const node = App.els.get(m.id);
  node?.classList.toggle('selected', ids.every((id) => S.select.has(id)));
  if (!S.select.size) return App.exitSelect();
  App.renderSelectHeader();
  App.renderSelectBar();
};
App.renderSelectHeader = () => {
  const n = S.select?.size || 0;
  el.head.replaceChildren(ibtn('close', 'لغو انتخاب', () => App.exitSelect()), h('div', { class: 'who' }, h('div', { class: 'wt' }, h('div', { class: 't' }, n ? `${fa(n)} پیام انتخاب شد` : 'پیام‌ها را انتخاب کنید'))));
};
App.renderSelectBar = () => {
  if (!S.select) return;
  const c = S.chats.get(S.active);
  const st = S.msgs.get(App.mkey());
  const ids = [...S.select];
  const msgs = (st?.list || []).filter((m) => S.select.has(m.id));
  const canDelete = msgs.length && msgs.every((m) => m.sender.id === S.me.id || c.type === 'private' || c.can_manage);
  el.bottom.dataset.mode = 'select';
  el.input = null;
  el.bottom.replaceChildren(h('div', { class: 'select-bar' },
    h('button', { type: 'button', class: 'sb-btn', onclick: () => App.exitSelect() }, icon('close'), 'لغو'),
    h('span', { class: 'sb-count' }, fa(ids.length) + ' پیام'),
    h('button', { type: 'button', class: 'sb-btn', disabled: !ids.length, onclick: () => { const x = ids; App.exitSelect(); App.forwardDialog(x); } }, icon('forward'), 'بازارسال'),
    canDelete ? h('button', { type: 'button', class: 'sb-btn danger', onclick: async () => { if (await App.deleteMessages(ids)) App.exitSelect(); } }, icon('trash'), 'حذف') : null));
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.select && !$('.modal-wrap') && !$('.menu')) App.exitSelect(); });

/* =====================================================================
   IN-CHAT SEARCH (Web K: search bar in the header + results with up/down)
   ===================================================================== */
App.openChatSearch = (initial = '') => {
  const c = S.chats.get(S.active);
  if (!c) return;
  const input = h('input', { type: 'search', placeholder: `جستجو در ${chatTitle(c)}`, value: initial });
  const counter = h('span', { class: 'cs-count' });
  let results = [], pos = -1;
  const goto = (i) => {
    if (!results.length) return;
    pos = Math.max(0, Math.min(results.length - 1, i));
    counter.textContent = `${fa(pos + 1)} از ${fa(results.length)}`;
    App.jumpTo(c.id, results[pos].id);
  };
  el.searchBar.replaceChildren(icon('search'), input, counter,
    ibtn('arrowUp', 'قدیمی‌تر', () => goto(pos + 1)), ibtn('down', 'جدیدتر', () => goto(pos - 1)),
    ibtn('close', 'بستن', App.closeChatSearch));
  el.searchBar.hidden = false;
  let t;
  const run = async () => {
    const q = input.value.trim();
    if (!q) { el.searchResults.hidden = true; counter.textContent = ''; return; }
    try {
      const { messages } = await api('GET', `/api/chats/${c.id}/search?q=${encodeURIComponent(q)}`);
      if (input.value.trim() !== q) return;
      results = c.is_forum ? messages.filter((m) => (m.topic_id ?? 0) === (S.topic ?? 0)) : messages;
      pos = -1;
      counter.textContent = results.length ? `${fa(results.length)} نتیجه` : 'بدون نتیجه';
      el.searchResults.hidden = false;
      el.searchResults.replaceChildren(...(results.length ? results.map((m, i) =>
        h('div', { class: 'sr', onclick: () => { el.searchResults.hidden = true; goto(i); } },
          userAvatar(m.sender, 's40'),
          h('div', { class: 'body' },
            h('div', { class: 'n' }, h('span', { dir: 'auto' }, m.sender.display_name), h('small', {}, fmtListTime(m.created_at))),
            h('div', { class: 'x', dir: 'auto' }, R.previewText(m))))) : [h('div', { class: 'info-empty' }, 'نتیجه‌ای پیدا نشد')]));
    } catch (e) { toast(e.message); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') App.closeChatSearch();
    else if (e.key === 'Enter') { e.preventDefault(); el.searchResults.hidden = true; goto(pos + 1); }
  });
  input.focus();
  if (initial) run();
};
App.closeChatSearch = () => { if (el.searchBar) { el.searchBar.hidden = true; el.searchResults.hidden = true; } };
App.searchInChat = (q) => { if (S.active) App.openChatSearch(q); };

/* =====================================================================
   REALTIME
   ===================================================================== */
// Web K style connection status: a thin bar under the search, shown only if the problem lasts
// Android: connection problems replace the "کبوتر" title (and the chat's status line)
App.setConn = (state) => {
  App.connState = state;
  clearTimeout(App.connTimer);
  const paint = (text) => {
    if (el.appTitle) el.appTitle.replaceChildren(...(text ? [h('span', { class: 'spinner' }), h('span', { class: 'tx' }, text)] : [h('span', { class: 'tx' }, 'کبوتر')]));
    el.appTitle?.classList.toggle('busy', !!text);
    const st = el.head?.querySelector('.who .st');
    if (text && st) { st.replaceChildren(text); st.classList.add('conn-st'); }
    else if (!text && S.active && el.head?.querySelector('.conn-st')) App.renderHeader();
  };
  if (!state) { paint(null); clearInterval(App.pollTimer); App.pollTimer = null; return; }
  const text = { offline: 'منتظر شبکه…', connecting: 'در حال اتصال…', updating: 'در حال به‌روزرسانی…' }[state];
  App.connTimer = setTimeout(() => paint(text), state === 'updating' ? 600 : 1200);
  // while the socket is down keep the list fresh over plain HTTP, so nothing needs a refresh
  if (state !== 'updating' && !App.pollTimer) App.pollTimer = setInterval(() => {
    if (S.wsReady || !S.token || document.hidden) return;
    App.loadChats().catch(() => {});
    if (S.active) App.loadInitial(S.active).then(() => { App.renderMessages(); }).catch(() => {});
  }, 15000);
};
App.dropSocket = () => {
  const ws = S.ws;
  S.ws = null;
  S.wsLive = false;
  S.wsReady = !!S.pollLive;
  clearTimeout(App.probeTimer); App.probeTimer = null;
  clearTimeout(App.openTimer);
  for (const p of wsPending.values()) p.reject(new ApiError('network', ERRORS.network));
  wsPending.clear();
  if (ws) { ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null; try { ws.close(); } catch {} }
};
App.scheduleReconnect = (delay) => {
  clearTimeout(App.retryTimer);
  App.retryTimer = setTimeout(() => App.connect(), delay);
};
App.connect = () => {
  if (!S.token || !S.me) return;
  clearTimeout(App.retryTimer);
  App.dropSocket();
  S.manualClose = false;
  let ws;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); }
  catch { App.startPoll(); return App.scheduleReconnect(30000); }
  S.ws = ws;
  if (!S.pollLive) App.setConn(navigator.onLine === false ? 'offline' : 'connecting');
  // a socket that never becomes ready (captive portals, frozen proxies) is retried
  App.openTimer = setTimeout(() => { if (S.ws === ws && !S.wsLive) { App.dropSocket(); App.scheduleReconnect(S.pollLive ? 30000 : 1000); } }, 25000);
  // if the socket isn't up quickly, switch to HTTP live events right away (VPNs, filtered networks)
  clearTimeout(App.fallbackTimer);
  App.fallbackTimer = setTimeout(() => { if (!S.wsLive && !S.manualClose) App.startPoll(); }, 6000);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: S.token }));
  ws.onmessage = (e) => {
    App.lastRx = Date.now();
    if (App.probeTimer) { clearTimeout(App.probeTimer); App.probeTimer = null; }
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    App.onEvent(ev);
  };
  ws.onerror = () => {};
  ws.onclose = (e) => {
    if (S.ws !== ws) return;
    App.dropSocket();
    if (S.manualClose || !S.token) return;
    if (e.code === 4001) { api('GET', '/api/me').then(() => App.scheduleReconnect(800)).catch(() => {}); return; }
    S.wsFails = (S.wsFails || 0) + 1;
    if (S.wsFails >= 2) App.startPoll();
    if (S.pollLive) return App.scheduleReconnect(30000); // HTTP is carrying us; try upgrading now and then
    App.setConn(navigator.onLine === false ? 'offline' : 'connecting');
    App.scheduleReconnect(document.hidden ? Math.min(30000, 1000 * 2 ** S.retry++) : Math.min(5000, 400 * 2 ** S.retry++));
  };
};
// Mobile browsers freeze background tabs and silently kill sockets. When the page comes back,
// check the socket right away instead of waiting for a (frozen) timer: no refresh needed.
App.probe = (force) => {
  if (!S.ws || !S.wsLive || App.probeTimer) return;
  if (!force && Date.now() - (App.lastRx || 0) < 20000) return; // traffic seen recently: it's alive
  App.wsSend({ type: 'ping' });
  // a ping over a slow VPN can take a while; only give up after 15s of total silence
  App.probeTimer = setTimeout(() => {
    App.probeTimer = null;
    if (Date.now() - (App.lastRx || 0) < 15000) return;
    App.dropSocket();
    App.connect();
  }, 15000);
};
App.ensureConnected = () => {
  if (!S.token || !S.me || S.manualClose) return;
  const ws = S.ws;
  if (S.poll && !S.poll.running) App.pollLoop(S.poll);
  if (!ws || ws.readyState >= 2) { S.retry = 0; App.connect(); }
  else if (ws.readyState === 1 && S.wsLive) App.probe(document.visibilityState === 'visible' && Date.now() - (App.hiddenAt || Date.now()) > 30000);
};
document.addEventListener('visibilitychange', () => { if (document.hidden) App.hiddenAt = Date.now(); });
window.addEventListener('online', () => { S.retry = 0; App.ensureConnected(); });
window.addEventListener('offline', () => App.setConn('offline'));
window.addEventListener('focus', () => App.ensureConnected());
window.addEventListener('pageshow', () => App.ensureConnected());
document.addEventListener('visibilitychange', () => { if (!document.hidden) App.ensureConnected(); });
setInterval(() => { if (!document.hidden) App.probe(); }, 25000);

App.onEvent = async (ev) => {
  if ((ev.type === 'ack' || ev.type === 'error') && ev.ref != null && wsPending.has(ev.ref)) {
    const p = wsPending.get(ev.ref);
    wsPending.delete(ev.ref);
    if (ev.type === 'ack') p.resolve(ev.result);
    else p.reject(new ApiError(ev.code, errorText(ev.code, ev.message)));
    return;
  }
  if (ev.type.startsWith('call_') && typeof Calls !== 'undefined') return Calls.onEvent(ev);
  switch (ev.type) {
    case 'pong':
      clearTimeout(App.probeTimer); App.probeTimer = null;
      break;
    case 'ready': {
      if (ev.__poll) S.pollLive = true;
      else { S.wsLive = true; S.wsFails = 0; clearTimeout(App.fallbackTimer); if (S.poll) App.stopPoll(); }
      S.wsReady = true;
      S.retry = 0;
      clearTimeout(App.openTimer);
      S.me = ev.user;
      App.lastRx = Date.now();
      App.setConn(S.everConnected ? 'updating' : null);
      if (S.everConnected) try {
        // resync everything that may have happened while we were offline
        for (const st of S.msgs.values()) st.stale = true;
        await App.loadChats().catch(() => {});
        if (S.active && S.chats.has(S.active)) {
          if (S.chats.get(S.active).is_forum) await App.loadTopics(S.active).catch(() => {});
          await App.loadInitial(S.active).catch(() => {});
          App.renderChatChrome();
          App.renderMessages();
          App.scrollBottom();
          App.markRead();
        } else if (S.active) App.showEmpty();
        if (typeof Stories !== 'undefined') Stories.load();
        if (App.forumTab) App.loadTopics(App.forumTab.chatId).then(() => App.renderTopics(App.forumTab?.chatId)).catch(() => {});
      } catch (err) { console.error('[resync]', err); }
      App.setConn(null);
      S.everConnected = true;
      break;
    }
    case 'message': App.onMessage(ev.message); break;
    case 'message_updated': App.onMessageUpdated(ev.message); break;
    case 'messages_deleted': App.removeMessages(ev.chat_id, ev.message_ids); break;
    case 'chat': {
      const prev = S.chats.get(ev.chat.id);
      S.chats.set(ev.chat.id, ev.chat);
      if (prev && prev.is_forum !== ev.chat.is_forum) {
        for (const k of [...S.msgs.keys()]) if (k === ev.chat.id || String(k).startsWith(ev.chat.id + ':')) S.msgs.delete(k);
        if (S.active === ev.chat.id) { S.active = null; App.openChat(ev.chat.id); }
        if (!ev.chat.is_forum && App.forumTab?.chatId === ev.chat.id) App.side.pop(App.forumTab);
      }
      if (S.active === ev.chat.id) {
        if (!prev || prev.can_post !== ev.chat.can_post || prev.peer?.blocked !== ev.chat.peer?.blocked) el.bottom.dataset.mode = '';
        App.renderChatChrome();
        if (prev && prev.others_read_id !== ev.chat.others_read_id) App.updateTicks(ev.chat);
        if (ev.chat.unread && App.atBottom() && !ev.chat.is_forum) App.markRead();
      }
      App.renderSidebar();
      if (App.forumTab?.chatId === ev.chat.id) App.renderTopics(ev.chat.id);
      if (App.infoChat === ev.chat.id) App.openInfo(ev.chat.id, true);
      break;
    }
    case 'chat_removed':
      if (S.chats.has(ev.chat_id)) App.removeChat(ev.chat_id);
      if (App.forumTab?.chatId === ev.chat_id) App.side.pop(App.forumTab);
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
    case 'topic_read': {
      const t = S.topics.get(ev.chat_id)?.get(ev.topic_id);
      if (t) {
        t.last_read_id = Math.max(t.last_read_id || 0, ev.message_id);
        if (!t.last_message || ev.message_id >= t.last_message.id) t.unread = 0;
        App.renderTopics(ev.chat_id);
      }
      break;
    }
    case 'topic': App.onTopic(ev.topic); break;
    case 'topic_deleted': {
      S.topics.get(ev.chat_id)?.delete(ev.topic_id);
      S.msgs.delete(`${ev.chat_id}:${ev.topic_id}`);
      if (S.active === ev.chat_id && S.topic === ev.topic_id) App.openTopic(ev.chat_id, 0);
      App.renderTopics(ev.chat_id);
      break;
    }
    case 'typing': {
      if (ev.user.id === S.me.id) break;
      let m = S.typing.get(ev.chat_id);
      if (!m) S.typing.set(ev.chat_id, (m = new Map()));
      m.set(ev.user.id, { name: ev.user.display_name, action: ev.action, topic: ev.topic_id ?? null, until: Date.now() + 5500 });
      App.refreshTyping(ev.chat_id);
      setTimeout(() => App.refreshTyping(ev.chat_id), 5600);
      break;
    }
    case 'presence':
    case 'user': {
      const id = ev.user ? ev.user.id : ev.user_id;
      for (const c of S.chats.values()) {
        if (c.type !== 'private' || c.peer.id !== id) continue;
        if (ev.user) { Object.assign(c.peer, ev.user); c.title = ev.user.contact_name || ev.user.display_name; c.avatar = ev.user.avatar; c.username = ev.user.username; c.description = ev.user.bio; }
        else Object.assign(c.peer, { online: ev.online, last_seen: ev.last_seen, last_seen_hidden: ev.last_seen_hidden });
      }
      App.renderSidebar();
      if (S.active) App.renderHeader();
      break;
    }
    case 'me':
      S.me = ev.user;
      App.renderSidebar();
      App.repaintMe();
      for (const c of S.chats.values()) if (isSaved(c)) Object.assign(c.peer, ev.user);
      break;
    case 'scheduled':
      if (S.active === ev.chat_id) App.loadScheduledCount();
      break;
    case 'settings':
      Object.assign(S.settings, ev.settings);
      save('settings', S.settings);
      applyTheme();
      App.renderSidebar();
      break;
    case 'stories':
    case 'story_views':
      if (typeof Stories !== 'undefined') Stories.onEvent(ev);
      break;
    case 'error':
      toast(errorText(ev.code, ev.message));
      break;
  }
};

App.refreshTyping = (chatId) => {
  App.renderSidebar();
  if (App.forumTab?.chatId === chatId) App.renderTopics(chatId);
  if (S.active === chatId && !S.select) App.renderHeader();
};

App.onMessage = async (m) => {
  let c = S.chats.get(m.chat_id);
  if (!c) {
    try { const d = await api('GET', `/api/chats/${m.chat_id}`); S.chats.set(d.chat.id, d.chat); c = d.chat; } catch { return; }
    App.renderSidebar();
    App.notify(c, m);
    return;
  }
  const mine = m.sender.id === S.me.id;
  const isNew = !c.last_message || m.id > c.last_message.id;
  if (isNew) c.last_message = m;
  S.typing.get(m.chat_id)?.delete(m.sender.id);
  const key = App.msgKeyOf(m);
  const viewing = App.isActiveKey(key);
  const wasBottom = viewing && App.atBottom();
  App.insertMessage(m);
  // forum topics keep their own unread/last message
  const t = c.is_forum ? S.topics.get(c.id)?.get(m.topic_id ?? 0) : null;
  if (t && (!t.last_message || m.id >= t.last_message.id)) t.last_message = m;
  if (mine) {
    c.last_read_id = Math.max(c.last_read_id || 0, m.id);
    if (t) t.last_read_id = Math.max(t.last_read_id || 0, m.id);
    if (viewing) { App.sepId = null; App.scrollBottom(); }
  } else if (isNew) {
    if (viewing && !document.hidden && wasBottom && App.isLiveEnd(key)) {
      if (t) { t.unread = (t.unread || 0) + 1; c.unread = (c.unread || 0) + 1; }
      App.scrollBottom();
      App.markRead();
    } else {
      c.unread = (c.unread || 0) + 1;
      if (t) t.unread = (t.unread || 0) + 1;
      if (viewing) App.onScroll();
    }
    App.notify(c, m);
  }
  App.renderSidebar();
  if (c.is_forum) App.renderTopics(c.id);
  if (S.active === m.chat_id && !S.select) App.renderHeader();
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
App.beep = () => Sound.play('notify', true);
App.notify = (c, m) => {
  if (c.muted || m.sender.id === S.me.id || m.kind === 'service') return;
  const silent = !!m.silent;
  const typeKey = c.type === 'private' ? 'notify_private' : c.type === 'group' ? 'notify_group' : 'notify_channel';
  if (S.settings[typeKey] === false) return;
  const visible = !document.hidden && App.isActiveKey(App.msgKeyOf(m));
  if (visible) { if (!silent) Sound.play('in'); return; }
  if (!silent && !document.hidden) Sound.play('notify');
  if (!S.settings.notify || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const preview = S.settings.notify_preview !== false;
    const n = new Notification(chatTitle(c), {
      body: preview ? (c.type === 'group' ? m.sender.display_name + ': ' : '') + R.previewText(m) : 'پیام جدید',
      tag: 'chat-' + c.id, icon: (preview && c.avatar) || '/icon.svg', silent: !S.settings.sound || silent,
    });
    n.onclick = () => { window.focus(); App.openChat(c.id, c.is_forum ? { topic: m.topic_id ?? 0 } : {}); n.close(); };
  } catch {}
};

/* =====================================================================
   ROUTING: #/@username, #/@channel/123, #/join/<token>, #/addstickers/<name>
   ===================================================================== */
App.route = async () => {
  const hsh = decodeURIComponent(location.hash || '');
  let m;
  if ((m = /^#\/join\/([\w-]{8,64})$/.exec(hsh))) App.joinDialog({ invite: m[1] });
  else if ((m = /^#\/addstickers\/([a-zA-Z][\w]{3,31})$/.exec(hsh))) App.stickerPackDialog(m[1]);
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
  if (typeof Lock !== 'undefined' && Lock.enabled()) return Lock.showLockScreen();
  if (!store('keepSignedIn', true) && !SESSION_ALIVE) { save('token', null); S.token = null; }
  if (!S.token) return App.renderAuth('login');
  try {
    await App.start();
  } catch (err) {
    if (S.token) { toast(err.message); App.renderAuth('login'); }
  }
};
// "keep me signed in" off = forget the session when the browser is closed
const SESSION_ALIVE = (() => { try { return sessionStorage.getItem('kb_alive') === '1'; } catch { return true; } })();
try { sessionStorage.setItem('kb_alive', '1'); } catch {}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && S.active && !$('.modal-wrap')) { e.preventDefault(); App.openChatSearch(); }
});
