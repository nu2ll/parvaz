'use strict';
// Kabootar web client: vanilla JS, no build step. All user content is rendered via textContent (XSS-safe).

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false || c === '') continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const ERRORS = {
  invalid_credentials: 'نام کاربری یا رمز عبور اشتباه است',
  username_taken: 'این نام کاربری قبلاً گرفته شده',
  rate_limited: 'درخواست‌ها زیاد است، کمی صبر کنید',
  user_not_found: 'کاربر پیدا نشد',
  not_found: 'پیدا نشد',
  forbidden: 'اجازه این کار را ندارید',
  already_member: 'این کاربر از قبل عضو گروه است',
  edit_window_expired: 'فقط تا ۴۸ ساعت می‌شود پیام را ویرایش کرد',
};

const state = {
  token: localStorage.getItem('kabootar_token'),
  me: null,
  chats: new Map(),
  messages: new Map(), // chatId -> sorted array
  hasMore: new Map(),
  active: null,
  ws: null,
  wsReady: false,
  everConnected: false,
  retry: 0,
  manualClose: false,
  typing: new Map(), // chatId -> Map(userId -> {name, until})
  replyTo: null,
  editing: null,
  lastTypingSent: 0,
  loadingOlder: false,
};

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function api(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && state.token && !url.startsWith('/api/auth/')) logout(true);
    const code = data.error?.code || 'error';
    throw new ApiError(code, ERRORS[code] || data.error?.message || 'خطای ناشناخته');
  }
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- formatting ----------
const COLORS = ['#e17076', '#7bc862', '#e5ca77', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];
function setAvatar(node, name, seed) {
  node.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
  node.style.background = COLORS[Math.abs(seed || 0) % COLORS.length];
}
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function fmtTime(ts, compact) {
  const d = new Date(ts);
  if (!compact || sameDay(d, new Date())) return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });
}
function lastSeen(ts) {
  if (!ts) return 'آخرین بازدید: خیلی وقت پیش';
  const d = new Date(ts);
  return sameDay(d, new Date()) ? `آخرین بازدید ساعت ${fmtTime(ts)}` : `آخرین بازدید ${fmtTime(ts, true)}`;
}
const isSaved = (c) => c.type === 'private' && c.peer && c.peer.id === state.me.id;
const chatTitle = (c) => (isSaved(c) ? 'پیام‌های ذخیره‌شده' : c.title);
const chatSeed = (c) => (c.type === 'private' ? c.peer.id : c.id + 3);
const activity = (c) => (c.last_message ? c.last_message.created_at : c.created_at);

// ---------- auth ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const login = mode === 'login';
  $('#auth-title').textContent = login ? 'ورود به کبوتر' : 'ساخت حساب جدید';
  $('#field-display').hidden = login;
  $('#auth-submit').textContent = login ? 'ورود' : 'ثبت‌نام';
  $('#auth-toggle').textContent = login ? 'حساب ندارید؟ ثبت‌نام کنید' : 'حساب دارید؟ وارد شوید';
  $('#auth-form [name=password]').autocomplete = login ? 'current-password' : 'new-password';
}
$('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { username: String(f.get('username')).trim(), password: String(f.get('password')) };
  if (authMode === 'register') body.display_name = String(f.get('display_name') || '').trim() || body.username;
  try {
    const data = await api('POST', `/api/auth/${authMode}`, body);
    state.token = data.token;
    localStorage.setItem('kabootar_token', data.token);
    state.me = data.user;
    e.target.reset();
    await startApp();
  } catch (err) {
    toast(err.message);
  }
});

function logout(expired) {
  if (state.token && !expired) api('POST', '/api/auth/logout').catch(() => {});
  state.token = null;
  localStorage.removeItem('kabootar_token');
  state.manualClose = true;
  if (state.ws) state.ws.close();
  Object.assign(state, { me: null, ws: null, wsReady: false, everConnected: false, active: null, replyTo: null, editing: null });
  state.chats.clear(); state.messages.clear(); state.hasMore.clear(); state.typing.clear();
  document.body.classList.remove('chat-open');
  $('#main').hidden = true;
  $('#auth').hidden = false;
  document.title = 'کبوتر';
  if (expired) toast('نشست شما منقضی شد، دوباره وارد شوید');
}
$('#logout').addEventListener('click', () => confirm('از حساب خارج می‌شوید؟') && logout(false));

async function startApp() {
  if (!state.me) state.me = (await api('GET', '/api/me')).user;
  $('#auth').hidden = true;
  $('#main').hidden = false;
  $('#me-name').textContent = state.me.display_name;
  $('#me-user').textContent = '@' + state.me.username;
  setAvatar($('#me-avatar'), state.me.display_name, state.me.id);
  showEmpty();
  await loadChats();
  connect();
}

// ---------- chats ----------
async function loadChats() {
  const { chats } = await api('GET', '/api/chats');
  state.chats.clear();
  for (const c of chats) state.chats.set(c.id, c);
  renderChatList();
  if (state.active) state.chats.has(state.active) ? renderHeader() : showEmpty();
}

function typingText(chatId) {
  const m = state.typing.get(chatId);
  if (!m) return '';
  const now = Date.now();
  const names = [...m.values()].filter((t) => t.until > now).map((t) => t.name);
  if (!names.length) return '';
  return state.chats.get(chatId)?.type === 'group' ? `${names.join('، ')} در حال نوشتن…` : 'در حال نوشتن…';
}

function renderChatList() {
  const list = $('#chat-list');
  list.replaceChildren();
  const chats = [...state.chats.values()].sort((a, b) => activity(b) - activity(a));
  if (!chats.length) list.append(h('div', { class: 'hint' }, 'هنوز گفتگویی ندارید. از جستجو یک کاربر پیدا کنید یا یک گروه بسازید.'));
  let total = 0;
  for (const c of chats) {
    total += c.unread || 0;
    const av = h('span', { class: 'avatar' + (c.type === 'private' && c.peer.online && !isSaved(c) ? ' online' : '') });
    setAvatar(av, chatTitle(c), chatSeed(c));
    const last = c.last_message;
    let preview = last ? (last.deleted ? 'پیام حذف شد' : last.text) : c.type === 'group' ? 'گروه ساخته شد' : 'گفتگوی جدید';
    if (last && !last.deleted && c.type === 'group') preview = `${last.sender.id === state.me.id ? 'شما' : last.sender.display_name}: ${preview}`;
    const typing = typingText(c.id);
    list.append(
      h('div', { class: 'item' + (c.id === state.active ? ' active' : ''), onclick: () => openChat(c.id) },
        av,
        h('div', { class: 'body' },
          h('div', { class: 'top' },
            h('span', { class: 'name', dir: 'auto' }, (c.type === 'group' ? '👥 ' : '') + chatTitle(c)),
            h('span', { class: 'time' }, last ? fmtTime(last.created_at, true) : '')),
          h('div', { class: 'bottom' },
            h('span', { class: 'preview' + (typing ? ' accent' : ''), dir: 'auto' }, typing || preview.split('\n')[0]),
            c.unread ? h('span', { class: 'badge' }, c.unread > 99 ? '99+' : String(c.unread)) : null)))
    );
  }
  document.title = total ? `(${total}) کبوتر` : 'کبوتر';
}

function showEmpty() {
  state.active = null;
  document.body.classList.remove('chat-open');
  $('#empty').hidden = false;
  for (const id of ['#chat-head', '#messages', '#composer', '#reply-bar']) $(id).hidden = true;
  renderChatList();
}

function renderHeader() {
  const c = state.chats.get(state.active);
  if (!c) return;
  $('#chat-title').textContent = chatTitle(c);
  setAvatar($('#chat-avatar'), chatTitle(c), chatSeed(c));
  const typing = typingText(c.id);
  let status = '';
  if (typing) status = typing;
  else if (c.type === 'group') status = `${c.member_count.toLocaleString('fa-IR')} عضو`;
  else if (!isSaved(c)) status = c.peer.online ? 'آنلاین' : lastSeen(c.peer.last_seen);
  const st = $('#chat-status');
  st.textContent = status;
  st.classList.toggle('accent', !!typing || (c.type === 'private' && c.peer.online && !isSaved(c)));
  $('#add-member').hidden = !(c.type === 'group' && (c.role === 'owner' || c.role === 'admin'));
  $('#leave').hidden = c.type !== 'group';
}

async function openChat(id) {
  if (!state.chats.has(id)) return;
  state.active = id;
  state.replyTo = null;
  state.editing = null;
  updateReplyBar();
  document.body.classList.add('chat-open');
  $('#empty').hidden = true;
  for (const sel of ['#chat-head', '#messages', '#composer']) $(sel).hidden = false;
  renderChatList();
  renderHeader();
  $('#messages').replaceChildren();
  if (!state.messages.has(id)) {
    state.messages.set(id, []);
    try { await loadHistory(id); } catch (err) { toast(err.message); }
  }
  if (state.active !== id) return;
  renderMessages(true);
  markActiveRead();
  if (matchMedia('(min-width: 761px)').matches) $('#input').focus();
}
$('#back').addEventListener('click', showEmpty);

function mergeMessages(chatId, msgs) {
  const map = new Map((state.messages.get(chatId) || []).map((m) => [m.id, m]));
  for (const m of msgs) map.set(m.id, m);
  state.messages.set(chatId, [...map.values()].sort((a, b) => a.id - b.id));
}

async function loadHistory(chatId, before) {
  const q = new URLSearchParams({ limit: '50' });
  if (before) q.set('before', before);
  const { messages, has_more } = await api('GET', `/api/chats/${chatId}/messages?${q}`);
  mergeMessages(chatId, messages);
  // first page decides hasMore; older pages update it as we scroll up
  if (before || !state.hasMore.has(chatId)) state.hasMore.set(chatId, has_more);
}

$('#messages').addEventListener('scroll', async (e) => {
  const box = e.target;
  const id = state.active;
  if (box.scrollTop > 80 || !id || !state.hasMore.get(id) || state.loadingOlder) return;
  state.loadingOlder = true;
  try {
    const first = (state.messages.get(id) || [])[0];
    const prevHeight = box.scrollHeight;
    const prevTop = box.scrollTop;
    await loadHistory(id, first?.id);
    if (state.active === id) {
      renderMessages(false, true);
      box.scrollTop = box.scrollHeight - prevHeight + prevTop;
    }
  } catch (err) {
    toast(err.message);
  } finally {
    state.loadingOlder = false;
  }
});

function readByOthers(c, m) {
  return !isSaved(c) && (c.others_read_id || 0) >= m.id;
}

function renderMessage(c, m) {
  const mine = m.sender.id === state.me.id;
  const bubble = h('div', { class: 'bubble' });
  if (c.type === 'group' && !mine) bubble.append(h('div', { class: 'sender', dir: 'auto' }, m.sender.display_name));
  if (m.reply) {
    bubble.append(h('div', { class: 'quote', onclick: () => scrollToMsg(m.reply.id) },
      h('div', { class: 'q-name', dir: 'auto' }, m.reply.sender_name || ''),
      h('div', { class: 'q-text', dir: 'auto' }, m.reply.deleted ? 'پیام حذف شد' : m.reply.text)));
  }
  bubble.append(h('div', { class: 'text' + (m.deleted ? ' deleted' : ''), dir: 'auto' }, m.deleted ? 'این پیام حذف شد' : m.text));
  const meta = h('div', { class: 'meta' }, m.edited_at && !m.deleted ? 'ویرایش‌شده' : null, fmtTime(m.created_at));
  if (mine && !m.deleted && !isSaved(c)) {
    const read = readByOthers(c, m);
    meta.append(h('span', { class: 'ticks' + (read ? ' read' : ''), title: read ? 'خوانده شد' : 'ارسال شد' }, read ? '✓✓' : '✓'));
  }
  bubble.append(meta);
  const canDelete = mine || (c.type === 'group' && (c.role === 'owner' || c.role === 'admin'));
  const actions = m.deleted ? null : h('div', { class: 'actions' },
    h('button', { title: 'پاسخ', 'aria-label': 'پاسخ', onclick: () => startReply(m) }, '↩'),
    mine ? h('button', { title: 'ویرایش', 'aria-label': 'ویرایش', onclick: () => startEdit(m) }, '✎') : null,
    canDelete ? h('button', { title: 'حذف', 'aria-label': 'حذف', onclick: () => removeMessage(m) }, '🗑') : null);
  return h('div', { class: 'msg' + (mine ? ' mine' : ''), id: 'm' + m.id, ondblclick: () => !m.deleted && startReply(m) }, bubble, actions);
}

function renderMessages(scrollToBottom, keepScroll) {
  const box = $('#messages');
  const c = state.chats.get(state.active);
  if (!c) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const frag = document.createDocumentFragment();
  const msgs = state.messages.get(c.id) || [];
  if (state.hasMore.get(c.id)) frag.append(h('div', { class: 'hint' }, 'برای دیدن پیام‌های قدیمی‌تر بالا بروید'));
  else if (!msgs.length) frag.append(h('div', { class: 'hint' }, 'هنوز پیامی نیست. اولین پیام را بفرستید 👋'));
  let lastDay = '';
  for (const m of msgs) {
    const day = new Date(m.created_at).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
    if (day !== lastDay) { frag.append(h('div', { class: 'day' }, h('span', {}, day))); lastDay = day; }
    frag.append(renderMessage(c, m));
  }
  box.replaceChildren(frag);
  if (!keepScroll && (scrollToBottom || nearBottom)) box.scrollTop = box.scrollHeight;
}

function scrollToMsg(id) {
  const n = document.getElementById('m' + id);
  if (!n) return toast('پیام اصلی در تاریخچه بارگذاری‌شده نیست');
  n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  n.classList.add('flash');
  setTimeout(() => n.classList.remove('flash'), 1200);
}

// ---------- composer ----------
function autoGrow() {
  const i = $('#input');
  i.style.height = 'auto';
  i.style.height = Math.min(i.scrollHeight, 160) + 'px';
}
function updateReplyBar() {
  const m = state.editing || state.replyTo;
  $('#reply-bar').hidden = !m;
  if (!m) return;
  $('#reply-label').textContent = state.editing ? 'ویرایش پیام' : `پاسخ به ${m.sender.display_name}`;
  $('#reply-text').textContent = m.text;
}
function startReply(m) {
  if (state.editing) $('#input').value = '';
  state.editing = null;
  state.replyTo = m;
  updateReplyBar();
  $('#input').focus();
}
function startEdit(m) {
  state.replyTo = null;
  state.editing = m;
  $('#input').value = m.text;
  autoGrow();
  updateReplyBar();
  $('#input').focus();
}
function cancelReply() {
  if (state.editing) { $('#input').value = ''; autoGrow(); }
  state.replyTo = null;
  state.editing = null;
  updateReplyBar();
}
$('#reply-cancel').addEventListener('click', cancelReply);

async function sendCurrent() {
  const input = $('#input');
  const text = input.value.trim();
  const chatId = state.active;
  if (!text || !chatId) return;
  if (text.length > 4096) return toast('پیام خیلی طولانی است (حداکثر ۴۰۹۶ کاراکتر)');
  const editing = state.editing;
  const reply = state.replyTo;
  state.editing = null;
  state.replyTo = null;
  input.value = '';
  autoGrow();
  updateReplyBar();
  state.lastTypingSent = 0;
  try {
    if (state.wsReady) {
      if (editing) wsSend({ type: 'edit', message_id: editing.id, text });
      else wsSend({ type: 'send', chat_id: chatId, text, reply_to: reply ? reply.id : null });
    } else {
      // fallback to REST when the socket is down
      const { message } = editing
        ? await api('PATCH', `/api/messages/${editing.id}`, { text })
        : await api('POST', `/api/chats/${chatId}/messages`, { text, reply_to: reply ? reply.id : null });
      handleIncoming(message);
    }
  } catch (err) {
    toast(err.message);
    input.value = text;
    autoGrow();
  }
}
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendCurrent(); });
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendCurrent(); }
  else if (e.key === 'Escape') cancelReply();
});
$('#input').addEventListener('input', () => {
  autoGrow();
  const now = Date.now();
  if (state.active && !state.editing && $('#input').value.trim() && now - state.lastTypingSent > 3000) {
    state.lastTypingSent = now;
    wsSend({ type: 'typing', chat_id: state.active });
  }
});

async function removeMessage(m) {
  if (!confirm('این پیام برای همه حذف شود؟')) return;
  try {
    if (state.wsReady) wsSend({ type: 'delete', message_id: m.id });
    else handleIncoming((await api('DELETE', `/api/messages/${m.id}`)).message);
  } catch (err) {
    toast(err.message);
  }
}

function markActiveRead() {
  const c = state.chats.get(state.active);
  if (!c || document.hidden) return;
  const msgs = state.messages.get(c.id) || [];
  const last = msgs[msgs.length - 1];
  if (!last) return;
  const hadUnread = c.unread > 0;
  c.unread = 0;
  if (last.id > (c.last_read_id || 0)) {
    c.last_read_id = last.id;
    if (state.wsReady) wsSend({ type: 'read', chat_id: c.id, message_id: last.id });
    else api('POST', `/api/chats/${c.id}/read`, { message_id: last.id }).catch(() => {});
  }
  if (hadUnread) renderChatList();
}
document.addEventListener('visibilitychange', markActiveRead);
window.addEventListener('focus', markActiveRead);

// ---------- search & groups ----------
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { $('#search-results').hidden = true; $('#chat-list').hidden = false; return; }
  searchTimer = setTimeout(() => doSearch(q), 250);
});
async function doSearch(q) {
  try {
    const { users } = await api('GET', '/api/users/search?q=' + encodeURIComponent(q));
    if ($('#search').value.trim() !== q) return;
    const box = $('#search-results');
    box.replaceChildren();
    box.hidden = false;
    $('#chat-list').hidden = true;
    if (!users.length) box.append(h('div', { class: 'hint' }, 'کاربری پیدا نشد'));
    for (const u of users) {
      const av = h('span', { class: 'avatar' + (u.online ? ' online' : '') });
      setAvatar(av, u.display_name, u.id);
      box.append(h('div', { class: 'item', onclick: () => startPrivate(u.username) }, av,
        h('div', { class: 'body' },
          h('div', { class: 'top' }, h('span', { class: 'name', dir: 'auto' }, u.display_name)),
          h('div', { class: 'bottom' }, h('span', { class: 'preview', dir: 'ltr' }, '@' + u.username)))));
    }
  } catch (err) {
    toast(err.message);
  }
}
async function startPrivate(username) {
  try {
    const { chat } = await api('POST', '/api/chats/private', { username });
    state.chats.set(chat.id, chat);
    $('#search').value = '';
    $('#search-results').hidden = true;
    $('#chat-list').hidden = false;
    openChat(chat.id);
  } catch (err) {
    toast(err.message);
  }
}

$('#new-group').addEventListener('click', () => $('#group-dialog').showModal());
$('#group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dlg = $('#group-dialog');
  if (e.submitter && e.submitter.value === 'cancel') { dlg.close(); e.target.reset(); return; }
  const f = new FormData(e.target);
  const usernames = String(f.get('members') || '').split(/[,،\s]+/).map((s) => s.replace(/^@/, '').trim()).filter(Boolean);
  try {
    const { chat } = await api('POST', '/api/chats/group', { title: String(f.get('title')).trim(), usernames });
    state.chats.set(chat.id, chat);
    dlg.close();
    e.target.reset();
    openChat(chat.id);
  } catch (err) {
    toast(err.message);
  }
});

$('#add-member').addEventListener('click', async () => {
  const username = prompt('نام کاربری عضو جدید:');
  if (!username || !state.active) return;
  try {
    const { chat } = await api('POST', `/api/chats/${state.active}/members`, { username: username.trim() });
    state.chats.set(chat.id, chat);
    renderHeader();
    toast('عضو اضافه شد');
  } catch (err) {
    toast(err.message);
  }
});

$('#leave').addEventListener('click', async () => {
  const id = state.active;
  if (!id || !confirm('از این گروه خارج می‌شوید؟')) return;
  try {
    await api('POST', `/api/chats/${id}/leave`);
    removeChat(id);
  } catch (err) {
    toast(err.message);
  }
});

function removeChat(id) {
  state.chats.delete(id);
  state.messages.delete(id);
  if (state.active === id) showEmpty();
  else renderChatList();
}

// ---------- realtime ----------
function setConn(text) { $('#conn').textContent = text; }
function wsSend(obj) { if (state.ws && state.wsReady) state.ws.send(JSON.stringify(obj)); }

function connect() {
  if (!state.token) return;
  state.manualClose = false;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  setConn('در حال اتصال…');
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: state.token }));
  ws.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handleEvent(ev);
  };
  ws.onclose = (e) => {
    if (state.ws !== ws) return;
    state.ws = null;
    state.wsReady = false;
    if (state.manualClose || !state.token) return;
    if (e.code === 4001) return void api('GET', '/api/me').then(() => setTimeout(connect, 1000)).catch(() => {});
    const delay = Math.min(30000, 1000 * 2 ** state.retry++);
    setConn('اتصال قطع شد، تلاش دوباره…');
    setTimeout(connect, delay);
  };
}

async function handleEvent(ev) {
  switch (ev.type) {
    case 'ready': {
      state.wsReady = true;
      state.retry = 0;
      setConn('');
      if (state.everConnected) {
        // resync after reconnect: refresh chat list and the open chat, drop stale caches
        for (const id of [...state.messages.keys()]) if (id !== state.active) state.messages.delete(id);
        await loadChats().catch(() => {});
        if (state.active) {
          state.messages.set(state.active, []);
          state.hasMore.delete(state.active);
          await loadHistory(state.active).catch(() => {});
          renderMessages(true);
          markActiveRead();
        }
      }
      state.everConnected = true;
      break;
    }
    case 'message':
    case 'message_updated':
      handleIncoming(ev.message);
      break;
    case 'typing': {
      if (ev.user.id === state.me.id) break;
      let m = state.typing.get(ev.chat_id);
      if (!m) state.typing.set(ev.chat_id, (m = new Map()));
      m.set(ev.user.id, { name: ev.user.display_name, until: Date.now() + 5000 });
      refreshTyping(ev.chat_id);
      setTimeout(() => refreshTyping(ev.chat_id), 5100);
      break;
    }
    case 'read': {
      const c = state.chats.get(ev.chat_id);
      if (!c) break;
      if (ev.user_id === state.me.id) {
        c.last_read_id = Math.max(c.last_read_id || 0, ev.message_id);
        if (c.last_message && ev.message_id >= c.last_message.id) c.unread = 0;
        renderChatList();
      } else {
        c.others_read_id = Math.max(c.others_read_id || 0, ev.message_id);
        if (state.active === c.id) renderMessages(false, true);
      }
      break;
    }
    case 'presence':
    case 'user': {
      const id = ev.user ? ev.user.id : ev.user_id;
      for (const c of state.chats.values()) {
        if (c.type !== 'private' || c.peer.id !== id) continue;
        if (ev.user) { Object.assign(c.peer, ev.user); c.title = ev.user.display_name; }
        else { c.peer.online = ev.online; c.peer.last_seen = ev.last_seen; }
      }
      renderChatList();
      if (state.active) renderHeader();
      break;
    }
    case 'chat': {
      state.chats.set(ev.chat.id, { ...state.chats.get(ev.chat.id), ...ev.chat });
      renderChatList();
      if (state.active === ev.chat.id) renderHeader();
      break;
    }
    case 'chat_removed':
      removeChat(ev.chat_id);
      break;
    case 'error':
      toast(ERRORS[ev.code] || ev.message || 'خطا');
      break;
  }
}

function refreshTyping(chatId) {
  renderChatList();
  if (state.active === chatId) renderHeader();
}

function handleIncoming(m) {
  const c = state.chats.get(m.chat_id);
  if (!c) { loadChats().catch(() => {}); return; }
  const isNew = !c.last_message || m.id > c.last_message.id;
  const mine = m.sender.id === state.me.id;
  if (state.messages.has(m.chat_id)) mergeMessages(m.chat_id, [m]);
  if (isNew) {
    c.last_message = m;
    if (!mine) {
      state.typing.get(m.chat_id)?.delete(m.sender.id);
      if (!(state.active === m.chat_id && !document.hidden)) c.unread = (c.unread || 0) + 1;
    }
  } else if (c.last_message.id === m.id) {
    c.last_message = m;
  }
  renderChatList();
  if (state.active === m.chat_id) {
    renderHeader();
    renderMessages(isNew && mine);
    if (isNew && !mine) markActiveRead();
  }
}

// ---------- boot ----------
(async function boot() {
  setAuthMode('login');
  if (!state.token) { $('#auth').hidden = false; return; }
  try {
    await startApp();
  } catch (err) {
    if (state.token) toast(err.message);
    $('#auth').hidden = false;
  }
})();
