'use strict';
/* Kabootar web client — core: DOM helpers, icons, API, formatting, state. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  append(e, children);
  return e;
}
function append(e, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

/* ---------- icons (Material-style paths) ---------- */
const ICONS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  back: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  smile: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  checks: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z',
  pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
  muted: 'M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z',
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  group: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  channel: 'M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z',
  bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
  image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  file: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
  poll: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  user: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  devices: 'M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z',
  down: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
  eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
  info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  personAdd: 'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  video: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  at: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10h5v-2h-5c-4.34 0-8-3.66-8-8s3.66-8 8-8 8 3.66 8 8v1.43c0 .79-.71 1.57-1.5 1.57s-1.5-.78-1.5-1.57V12c0-2.76-2.24-5-5-5s-5 2.24-5 5 2.24 5 5 5c1.38 0 2.64-.56 3.54-1.47.65.89 1.77 1.47 2.96 1.47 1.97 0 3.5-1.6 3.5-3.57V12c0-5.52-4.48-10-10-10zm0 13c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  unread: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z',
  key: 'M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
};
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', ICONS[name] || '');
  s.append(p);
  return s;
}
const ibtn = (name, title, onclick, cls) =>
  h('button', { class: 'ibtn' + (cls ? ' ' + cls : ''), title, 'aria-label': title, type: 'button', onclick }, icon(name, name === 'back' || name === 'send' ? 'flip' : ''));

/* ---------- state ---------- */
const store = (k, def) => { try { const v = localStorage.getItem('kb_' + k); return v == null ? def : JSON.parse(v); } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem('kb_' + k, JSON.stringify(v)); } catch {} };

const S = {
  token: store('token', null),
  me: null,
  config: { reactions: ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉'], max_upload_mb: 50 },
  chats: new Map(),
  msgs: new Map(), // chatId -> { list, hasMore, hasNewer }
  active: null,
  folder: 'all',
  archived: false,
  ws: null, wsReady: false, everConnected: false, retry: 0, manualClose: false,
  typing: new Map(), // chatId -> Map(userId -> { name, action, until })
  reply: null, edit: null,
  drafts: store('drafts', {}),
  pending: new Map(), // localId -> pending upload
  settings: Object.assign({ theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', notify: true, sound: true }, store('settings', {})),
  recentEmoji: store('recentEmoji', []),
};

/* ---------- API ---------- */
const ERRORS = {
  invalid_credentials: 'نام کاربری یا رمز عبور اشتباه است',
  username_taken: 'این نام کاربری قبلاً گرفته شده',
  rate_limited: 'خیلی سریع! کمی صبر کنید',
  user_not_found: 'کاربر پیدا نشد',
  not_found: 'پیدا نشد',
  forbidden: 'اجازه این کار را ندارید',
  already_member: 'از قبل عضو است',
  edit_window_expired: 'فقط تا ۴۸ ساعت می‌شود پیام را ویرایش کرد',
  file_too_large: 'فایل خیلی بزرگ است',
  invite_invalid: 'لینک دعوت نامعتبر است یا باطل شده',
  too_many_pinned: 'حداکثر ۵ گفتگو را می‌توانید سنجاق کنید',
  group_full: 'ظرفیت گروه پر است',
  cannot_leave_private: 'گفتگوی خصوصی را باید حذف کنید',
  network: 'اتصال به سرور برقرار نشد',
};
const VALIDATION_FA = [
  [/Username must be/, 'نام کاربری باید ۴ تا ۳۲ حرف انگلیسی/عدد/_ باشد و با حرف شروع شود'],
  [/Public link must be/, 'لینک عمومی باید ۵ تا ۳۲ حرف انگلیسی/عدد/_ باشد و با حرف شروع شود'],
  [/Password must be/, 'رمز عبور باید ۸ تا ۱۲۸ کاراکتر باشد'],
  [/reserved/, 'این نام رزرو شده است'],
  [/too long/, 'متن خیلی طولانی است'],
  [/empty/, 'متن خالی است'],
  [/Current password/, 'رمز فعلی اشتباه است'],
  [/poll needs/, 'نظرسنجی باید ۲ تا ۱۰ گزینه داشته باشد'],
  [/must be unique/, 'گزینه‌ها نباید تکراری باشند'],
  [/Avatar must be/, 'عکس پروفایل باید JPG، PNG، GIF یا WebP باشد'],
];
class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
function errorText(code, msg) {
  if (ERRORS[code]) return ERRORS[code];
  for (const [re, fa] of VALIDATION_FA) if (re.test(msg || '')) return fa;
  return msg || 'خطای ناشناخته';
}

async function api(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('network', ERRORS.network);
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && S.token && !url.startsWith('/api/auth/')) App.logout(true);
    const code = data.error?.code || 'error';
    throw new ApiError(code, errorText(code, data.error?.message));
  }
  return data;
}

function uploadFile(file, name, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', '/api/files?name=' + encodeURIComponent(name || file.name || 'file'));
    xhr.setRequestHeader('Authorization', 'Bearer ' + S.token);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.file);
      else reject(new ApiError(data.error?.code || 'error', errorText(data.error?.code, data.error?.message)));
    };
    xhr.onerror = () => reject(new ApiError('network', ERRORS.network));
    xhr.onabort = () => reject(new ApiError('aborted', 'لغو شد'));
    xhr.send(file);
  });
  promise.abort = () => xhr.abort();
  return promise;
}

/* ---------- formatting ---------- */
const fa = (n) => Number(n).toLocaleString('fa-IR');
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtListTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return fmtTime(ts);
  if (now - d < 6 * 864e5) return d.toLocaleDateString('fa-IR', { weekday: 'short' });
  return d.toLocaleDateString('fa-IR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}
function fmtDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return 'امروز';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'دیروز';
  return d.toLocaleDateString('fa-IR', { month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function fmtSize(b) {
  if (b < 1024) return fa(b) + ' بایت';
  if (b < 1048576) return fa((b / 1024).toFixed(1)) + ' کیلوبایت';
  if (b < 1073741824) return fa((b / 1048576).toFixed(1)) + ' مگابایت';
  return fa((b / 1073741824).toFixed(2)) + ' گیگابایت';
}
function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return fa(m) + ':' + (s < 10 ? '۰' : '') + fa(s);
}
function lastSeenText(u) {
  if (!u) return '';
  if (u.online) return 'آنلاین';
  if (u.last_seen_hidden || !u.last_seen) return 'آخرین بازدید به تازگی';
  const diff = Date.now() - u.last_seen;
  if (diff < 60e3) return 'آخرین بازدید چند لحظه پیش';
  if (diff < 3600e3) return `آخرین بازدید ${fa(Math.floor(diff / 60e3))} دقیقه پیش`;
  const d = new Date(u.last_seen);
  if (sameDay(d, new Date())) return `آخرین بازدید امروز ساعت ${fmtTime(u.last_seen)}`;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return `آخرین بازدید دیروز ساعت ${fmtTime(u.last_seen)}`;
  return `آخرین بازدید ${d.toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' })}`;
}
const membersText = (c) => c.type === 'channel' ? `${fa(c.member_count)} مشترک` : `${fa(c.member_count)} عضو`;
const hash = (x) => { let n = 0; for (const ch of String(x)) n = (n * 31 + ch.codePointAt(0)) | 0; return Math.abs(n); };

/* ---------- avatars ---------- */
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] || '?')][0] || '?';
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
  return (first + (second || '')).toUpperCase();
}
function isSaved(c) { return c && c.type === 'private' && c.peer && S.me && c.peer.id === S.me.id; }
function chatTitle(c) { return isSaved(c) ? 'پیام‌های ذخیره‌شده' : c.title; }

// entity: { name, avatar, seed, saved, online }
function avatarEl(ent, size = '') {
  const a = h('div', { class: `avatar ${size}` });
  if (ent.saved) { a.classList.add('gs'); a.append(icon('bookmark')); return a; }
  if (ent.archive) { a.append(icon('archive')); return a; }
  a.classList.add('g' + (Math.abs(ent.seed || 0) % 7));
  if (ent.avatar) {
    const img = h('img', { src: ent.avatar, alt: '', loading: 'lazy', draggable: 'false' });
    img.onerror = () => { img.remove(); a.textContent = initials(ent.name); };
    a.append(img);
  } else a.textContent = initials(ent.name);
  if (ent.online) a.classList.add('online');
  return a;
}
function chatAvatar(c, size) {
  if (isSaved(c)) return avatarEl({ saved: true }, size);
  return avatarEl({
    name: chatTitle(c), avatar: c.avatar, seed: c.type === 'private' ? c.peer.id : c.id * 7 + 3,
    online: c.type === 'private' && c.peer.online,
  }, size);
}
const userAvatar = (u, size) => avatarEl({ name: u.display_name, avatar: u.avatar, seed: u.id, online: u.online && u.id !== S.me?.id }, size);

/* ---------- toast ---------- */
function toast(msg) {
  let t = $('#toast');
  if (!t) document.body.append((t = h('div', { id: 'toast', class: 'toast', role: 'status' })));
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
}

async function copyText(text, msg = 'کپی شد') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  $('meta[name=theme-color]')?.setAttribute('content', S.settings.theme === 'dark' ? '#212121' : '#ffffff');
}
function saveSettings() { save('settings', S.settings); }
applyTheme();
