'use strict';
/* Kabootar web client — core: DOM helpers, icons, API, formatting, state. */

// tolerate null/false children in native append-style calls (conditional UI pieces)
if (typeof Element !== 'undefined') for (const k of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
  const orig = Element.prototype[k];
  if (orig && !orig.__kb) { const f = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); }; f.__kb = true; Element.prototype[k] = f; }
}
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
  place: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z',
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
  pAndroid: 'M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.64.64 0 0 0-.83.22l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.67a.64.64 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z',
  pApple: 'M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z',
  pWindows: 'M3 5.6l7.4-1v7.1H3V5.6zm0 12.8l7.4 1v-7H3v6zm8.3 1.2L21 21v-8.4h-9.7v7zm0-15.2v7.1H21V3l-9.7 1.4z',
  hand: 'M21 7c0-1.38-1.12-2.5-2.5-2.5-.17 0-.34.02-.5.05V4c0-1.38-1.12-2.5-2.5-2.5-.23 0-.46.03-.67.09C14.46.66 13.56 0 12.5 0c-1.23 0-2.25.89-2.46 2.06C9.87 2.02 9.69 2 9.5 2 8.12 2 7 3.12 7 4.5v5.89c-.34-.31-.76-.54-1.22-.66L5.01 9.5c-.83-.23-1.7.09-2.19.83-.38.57-.4 1.31-.05 1.9l3.07 5.21C7.24 20.13 9.87 22 13 22h1c4.03 0 7-3.4 7-7.5V7zm-2 7.5c0 3.08-2.24 5.5-5 5.5h-1c-2.33 0-4.29-1.39-5.43-3.43L4.6 11.5l.67.18c.32.09.59.31.73.62L7 15h2V4.5c0-.28.22-.5.5-.5s.5.22.5.5V11h2V2.5c0-.28.22-.5.5-.5s.5.22.5.5V11h2V4c0-.28.22-.5.5-.5s.5.22.5.5v7h2V7c0-.28.22-.5.5-.5s.5.22.5.5v7.5z',
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
  phone: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  callEnd: 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z',
  micOff: 'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z',
  videoOff: 'M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z',
  screen: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74z',
  flipCam: 'M20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 11.5V13H9v2.5L5.5 12 9 8.5V11h6V8.5l3.5 3.5-3.5 3.5z',
  sticker: 'M18.5 2h-13A3.5 3.5 0 0 0 2 5.5v13A3.5 3.5 0 0 0 5.5 22H14l8-8V5.5A3.5 3.5 0 0 0 18.5 2zM14 20v-3.5a2.5 2.5 0 0 1 2.5-2.5H20l-6 6zM8.5 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM12 16.5c-2.33 0-4.31-1.46-5.11-3.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5z',
  gif: 'M11.5 9H13v6h-1.5zM9 9H6c-.6 0-1 .5-1 1v4c0 .5.4 1 1 1h3c.6 0 1-.5 1-1v-2H8.5v1.5h-2v-3H10V10c0-.5-.4-1-1-1zm10 1.5V9h-4.5v6H16v-2h2v-1.5h-2v-1z',
  contacts: 'M20 0H4v2h16V0zM4 24h16v-2H4v2zM20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 2.75c1.24 0 2.25 1.01 2.25 2.25s-1.01 2.25-2.25 2.25S9.75 10.24 9.75 9 10.76 6.75 12 6.75zM17 17H7v-1.5c0-1.67 3.33-2.5 5-2.5s5 .83 5 2.5V17z',
  palette: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  data: 'M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  chevron: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  block: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z',
  select: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  timer: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  story: 'M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2zm1 0v2.06A8 8 0 0 1 19.94 11H22A10 10 0 0 0 13 2zm-2 6v3H8v2h3v3h2v-3h3v-2h-3V8h-2z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  heartO: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  zoomIn: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm2.5-4h-2v2H9v-2H7V9h2V7h1v2h2v1z',
  globe: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z',
  topic: 'M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z',
  hash: 'M20 10V8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4zm-6 4h-4v-4h4v4z',
  unlock: 'M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z',
  callIn: 'M20 5.41L18.59 4 7 15.59V9H5v10h10v-2H8.41z',
  callOut: 'M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  textSize: 'M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z',
  keyboard: 'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  minimize: 'M6 19h12v2H6z',
  arrowUp: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  install: 'M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zm-1-4l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z',
  saved: 'M19 3H5c-1.1 0-2 .9-2 2v14l4-4h12c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
  bot: 'M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z',
  addCircle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  closeCircle: 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  stop: 'M6 6h12v12H6z',
  help: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
};
// thin outline icons used by Web K 2.x menus (stroked, not filled)
const ICONS_O = {
  oBookmark: 'M6.8 3.6h10.4c.66 0 1.2.54 1.2 1.2v15.6L12 16.6l-6.4 3.8V4.8c0-.66.54-1.2 1.2-1.2z',
  oArchive: 'M4.2 4.4h15.6v4.2H4.2z M5.6 8.6v9.6c0 .9.7 1.6 1.6 1.6h9.6c.9 0 1.6-.7 1.6-1.6V8.6 M12 11.2v5.6 M9.4 14.4l2.6 2.6 2.6-2.6',
  oStories: 'M12 3.2a8.8 8.8 0 1 1-8.3 5.9 M5.1 6.6a8.8 8.8 0 0 1 2.2-2.1 M12 7.4a4.6 4.6 0 1 1 0 9.2a4.6 4.6 0 1 1 0-9.2z',
  oUser: 'M12 11.8a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8z M4.6 20.4c.5-3.4 3.6-5.6 7.4-5.6s6.9 2.2 7.4 5.6',
  oSettings: 'M19.20 12.00 L21.12 13.81 L20.59 15.56 L17.99 16.00 L17.09 17.09 L17.17 19.73 L15.56 20.59 L13.40 19.06 L12.00 19.20 L10.19 21.12 L8.44 20.59 L8.00 17.99 L6.91 17.09 L4.27 17.17 L3.41 15.56 L4.94 13.40 L4.80 12.00 L2.88 10.19 L3.41 8.44 L6.01 8.00 L6.91 6.91 L6.83 4.27 L8.44 3.41 L10.60 4.94 L12.00 4.80 L13.81 2.88 L15.56 3.41 L16.00 6.01 L17.09 6.91 L19.73 6.83 L20.59 8.44 L19.06 10.60Z M12 8.6a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8z',
  oMoon: 'M19.8 14.6A8.2 8.2 0 0 1 9.4 4.2a8.2 8.2 0 1 0 10.4 10.4z M16 3.6v3 M14.5 5.1h3 M19.6 8.4v2 M18.6 9.4h2',
  oSun: 'M12 7.6a4.4 4.4 0 1 1 0 8.8a4.4 4.4 0 1 1 0-8.8z M12 2.6v2 M12 19.4v2 M2.6 12h2 M19.4 12h2 M5.4 5.4l1.4 1.4 M17.2 17.2l1.4 1.4 M5.4 18.6l1.4-1.4 M17.2 6.8l1.4-1.4',
  oAnim: 'M4.5 19.5l10-10 M13 8l3 3 M17 3.5v2.5 M15.75 4.75h2.5 M20 8v2 M19 9h2 M9 3.5v2 M8 4.5h2',
  oChannel: 'M3.6 9.6h3l9.2-5.2v15.2L6.6 14.4h-3z M6.6 14.4l1.6 5.2h2.6l-1.4-4.4 M18.6 9.2a3.4 3.4 0 0 1 0 5.6',
  oGroup: 'M9 11.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z M2.6 20.2c.4-3.4 3-5.6 6.4-5.6s6 2.2 6.4 5.6 M15.8 4.4a3.6 3.6 0 0 1 0 6.6 M17.8 14.9c1.9.8 3.3 2.6 3.6 5.3',
  oPhone: 'M5.2 3.8h3.3l1.6 4.2-2.1 1.5a11.6 11.6 0 0 0 6.5 6.5l1.5-2.1 4.2 1.6v3.3c0 .9-.7 1.6-1.6 1.6A16.4 16.4 0 0 1 3.6 5.4c0-.9.7-1.6 1.6-1.6z',
  oEdit: 'M4 20h4.2L19 9.2 14.8 5 4 15.8z M12.9 6.9l4.2 4.2',
  oLogout: 'M14.6 4H18c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2h-3.4 M9.6 7.6L5.2 12l4.4 4.4 M5.4 12h10',
  oHelp: 'M12 3.2a8.8 8.8 0 1 1 0 17.6 8.8 8.8 0 0 1 0-17.6z M9.5 9.6a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.6 M12 17v.2',
  oInstall: 'M12 4v11 M7.6 10.8L12 15.2l4.4-4.4 M4.6 15.6v2.6c0 1 .8 1.8 1.8 1.8h11.2c1 0 1.8-.8 1.8-1.8v-2.6',
  oLock: 'M6.4 10.4h11.2c.9 0 1.6.7 1.6 1.6v7c0 .9-.7 1.6-1.6 1.6H6.4c-.9 0-1.6-.7-1.6-1.6v-7c0-.9.7-1.6 1.6-1.6z M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8',
  oSearch: 'M10.6 4a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2z M15.5 15.5L20.2 20.2',
  oQr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2.5v2.5H14z M17.5 17.5H20V20h-2.5z M14 19v1 M19 14h1',
  oPlus: 'M12 4.5v15 M4.5 12h15',
  oChats: 'M4 5.5h10.5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H8.5L5 17.5v-3H4c-.83 0-1.5-.67-1.5-1.5V7c0-.83.67-1.5 1.5-1.5z M16 9h3.5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-1v3l-3.5-3h-4.5c-.83 0-1.5-.67-1.5-1.5V16',
  oUserCircle: 'M12 3.2a8.8 8.8 0 1 1 0 17.6 8.8 8.8 0 0 1 0-17.6z M12 12.6a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2z M6.4 18.2c1.2-2 3.2-3.1 5.6-3.1s4.4 1.1 5.6 3.1',
  oSort: 'M4 6.5h16 M4 11.5h10 M4 16.5h6 M15.5 20l2.2-6 2.3 6 M16.2 18.2h3',
  oInvite: 'M10 11a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z M3.5 20c.4-3.4 3-5.6 6.5-5.6 1.2 0 2.3.3 3.2.7 M18 14v6 M15 17h6',
  oNewMsg: 'M12 3.5c4.97 0 9 3.6 9 8s-4.03 8-9 8c-1.2 0-2.3-.2-3.4-.6L4 20.5l1.3-3.8C4.1 15.3 3 13.5 3 11.5c0-4.4 4.03-8 9-8z M12 8.2v6.6 M8.7 11.5h6.6',
  oBell: 'M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.6L5 16.2h14l-1.5-3.6V9A5.5 5.5 0 0 0 12 3.5z M9.8 19a2.3 2.3 0 0 0 4.4 0',
  oBellOff: 'M8 5.2A5.5 5.5 0 0 1 17.5 9v3.6l1 2.4 M6.5 9v3.6L5 16.2h11.2 M9.8 19a2.3 2.3 0 0 0 4.4 0 M4 4l16 16',
  oChat: 'M12 4c4.7 0 8.5 3.2 8.5 7.2s-3.8 7.2-8.5 7.2c-1 0-2-.15-2.9-.43L4.5 19.6l1.3-3.7C4.3 14.6 3.5 13 3.5 11.2 3.5 7.2 7.3 4 12 4z',
  oLeave: 'M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14 M10.5 12H20 M16.8 8.5L20.3 12l-3.5 3.5',
  oShare: 'M13.5 5.5l7 6.5-7 6.5v-3.8c-4.7 0-7.6 1.4-10 4.8.9-5 3.7-9.3 10-9.9V5.5z',
  oLocation: 'M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 12 3.3a6.5 6.5 0 0 1 6.5 6.5C18.5 14.8 12 21 12 21z M12 12.3a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  oMusic: 'M9 18.5V6l10-2v12 M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  oContact: 'M5.5 3.5h13A1.5 1.5 0 0 1 20 5v14a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5z M12 12a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z M7.5 17.2c.6-2 2.4-3.2 4.5-3.2s3.9 1.2 4.5 3.2',
  oGps: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M12 1.5v3 M12 19.5v3 M1.5 12h3 M19.5 12h3',
  oImage: 'M5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5v-13C4 4.67 4.67 4 5.5 4z M4 16l4.6-4.6 3.9 3.9 2.6-2.6L20 17.6 M15.2 9.2a1.4 1.4 0 1 1 0-.01',
  oFile: 'M6.5 3.5h7l5 5v11a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19.5v-14.5A1.5 1.5 0 0 1 6.5 3.5z M13.5 3.5V8.5h5',
  oPoll: 'M5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5v-13C4 4.67 4.67 4 5.5 4z M8.5 16.5v-4 M12 16.5v-8.5 M15.5 16.5v-6',
  oCamera: 'M4.5 7.5h3l1.6-2.4h5.8l1.6 2.4h3c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-15c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5z M12 9.6a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8z',
  oTrash: 'M5 7h14 M9.5 7V5.2c0-.4.3-.7.7-.7h3.6c.4 0 .7.3.7.7V7 M6.8 7l.9 12c.1.8.7 1.4 1.5 1.4h5.6c.8 0 1.4-.6 1.5-1.4l.9-12 M10.2 10.6v6 M13.8 10.6v6',
  oRotate: 'M5 12a7 7 0 1 0 2.1-5 M5 4.5v3.2h3.2',
  oMirror: 'M12 3.5v17 M9 7L4 17h5z M15 7l5 10h-5z',
};
const SVGNS = 'http://www.w3.org/2000/svg';
// phones with few cores / little memory get the "lite" look: no blur, fewer shadows, shorter animations
try {
  const weak = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 3);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch) document.documentElement.classList.add('touch');
  if (weak) document.documentElement.classList.add('lite');
  if (/KabootarAndroid/.test(navigator.userAgent)) document.documentElement.classList.add('in-app');
} catch {}
function icon(name, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const outline = name in ICONS_O;
  s.setAttribute('class', 'i' + (outline ? ' o' : '') + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', outline ? ICONS_O[name] : ICONS[name] || '');
  s.append(p);
  return s;
}
const ibtn = (name, title, onclick, cls) =>
  h('button', { class: 'ibtn' + (cls ? ' ' + cls : ''), title, 'aria-label': title, type: 'button', onclick }, icon(name, name === 'send' || name === 'chevron' ? 'flip' : ''));
const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

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
  settings: Object.assign({
    theme: 'system', accent: 'default', text_size: 16, background: null, time_format: '24', send_key: 'enter', animations: true,
    large_emoji: true, autoplay_gif: true, autoplay_video: true, auto_download: { photo: true, video: true, file: true },
    notify: true, sound: true, notify_private: true, notify_group: true, notify_channel: true, notify_preview: true,
    suggest_stickers: true, loop_stickers: true, folders: null, stories_hidden: false, stickers_recent: [],
  }, store('settings', {})),
  recentEmoji: store('recentEmoji', []),
  topic: null, // active forum topic id (0 = General) or null
  topics: new Map(), // chatId -> Map(topicId -> topic)
  contacts: null,
  stickers: null, // installed packs
  gifs: null,
  stories: null, // feed
  select: null, // Set of selected message ids (select mode)
  calls: null,
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
  blocked: 'این کاربر پیام‌های شما را محدود کرده',
  you_blocked: 'اول این کاربر را از مسدودی دربیاورید',
  privacy_restricted: 'تنظیمات حریم خصوصی این کاربر اجازه نمی‌دهد',
  invalid_2fa: 'رمز تأیید دومرحله‌ای اشتباه است',
  login_expired: 'زمان ورود تمام شد، دوباره تلاش کنید',
  topic_closed: 'این تاپیک بسته شده',
  topic_not_found: 'تاپیک پیدا نشد',
  not_a_forum: 'تاپیک‌ها در این گروه فعال نیست',
  sticker_not_found: 'استیکر پیدا نشد',
  pack_not_found: 'بسته‌ی استیکر پیدا نشد',
  pack_name_taken: 'این نام کوتاه قبلاً گرفته شده',
  story_not_found: 'استوری پیدا نشد یا منقضی شده',
  already_in_call: 'شما الان در تماس هستید',
  call_not_found: 'تماس پیدا نشد',
  gif_search_failed: 'جستجوی GIF الان در دسترس نیست',
  file_not_found: 'فایل پیدا نشد',
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
  [/Short name must be/, 'نام کوتاه باید ۴ تا ۳۲ حرف انگلیسی/عدد/_ باشد'],
  [/Stickers must be/, 'استیکر باید عکس PNG، WebP، GIF یا JPEG باشد'],
  [/story must be/, 'استوری باید عکس یا ویدیو باشد'],
  [/Hint must not/, 'راهنما نباید خود رمز باشد'],
  [/Topics are only/, 'تاپیک فقط در گروه‌ها فعال می‌شود'],
  [/Calls are available/, 'تماس فقط در گفتگوی خصوصی ممکن است'],
  [/cannot call yourself/, 'نمی‌توانید با خودتان تماس بگیرید'],
];
class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
function errorText(code, msg) {
  if (ERRORS[code]) return ERRORS[code];
  for (const [re, fa] of VALIDATION_FA) if (re.test(msg || '')) return fa;
  return msg || 'خطای ناشناخته';
}

async function api(method, url, body, opts = {}) {
  const headers = {};
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined && body !== null ? JSON.stringify(body) : undefined, signal: opts.signal, cache: 'no-store' });
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
  const h12 = S.settings.time_format === '12';
  return new Date(ts).toLocaleTimeString('fa-IR', { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12 });
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
const userName = (u) => (u ? u.contact_name || u.display_name : '');
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
  if (ent.stories) a.classList.add('has-stories', ent.stories.unseen ? 'unseen' : 'seen');
  return a;
}
function chatAvatar(c, size) {
  if (isSaved(c)) return avatarEl({ saved: true }, size);
  return avatarEl({
    name: chatTitle(c), avatar: c.avatar, seed: c.type === 'private' ? c.peer.id : c.id * 7 + 3,
    online: c.type === 'private' && c.peer.online,
    stories: c.type === 'private' && c.peer.stories && !S.settings.stories_hidden ? c.peer.stories : null,
  }, size);
}
const userAvatar = (u, size, withStories) => avatarEl({ name: userName(u), avatar: u.avatar, seed: u.id, online: u.online && u.id !== S.me?.id, stories: withStories ? u.stories : null }, size);

/* ---------- toast ---------- */
// Telegram Android doesn't pop "copied" / "saved" / "session ended" notes at the bottom: those are
// silent now. Only real problems (errors, "allow the microphone", "type a name") are still shown.
const QUIET_TOAST = /(کپی شد|ذخیره شد|منتشر شد|خاتمه یافت|خاتمه یافتند|پاک شد|اضافه شد|حذف شد|ادمین شد|برکنار شد|داده شد|برداشته شد|فعال شد|خاموش شد|مسدود شد|رفع مسدودی شد|بایگانی شد|زمان‌بندی شد|ارسال شد|تنظیم شد|در پروفایل ماند|منقضی شد، دوباره وارد شوید|در حال آپلود…|در حال آپلود استوری…|مرتب بر اساس نام|مرتب بر اساس آخرین بازدید)$/;
function toast(msg, action) {
  if (msg == null || msg === '' || QUIET_TOAST.test(String(msg).trim())) return;
  let t = $('#toast');
  if (!t) document.body.append((t = h('div', { id: 'toast', class: 'toast', role: 'status' })));
  t.textContent = msg;
  if (action) t.append(h('button', { type: 'button', onclick: () => { t.classList.remove('show'); action.onClick(); } }, action.label));
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

const ACCENTS = {
  default: null, blue: '#3390ec', purple: '#8774e1', green: '#4fae4e', orange: '#f68136', pink: '#e8578d', cyan: '#3ab9c6', red: '#e15052', gold: '#c6a23a',
};
const darkMode = () => S.settings.theme === 'dark' || (S.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
function applyTheme() {
  const dark = darkMode();
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const accent = ACCENTS[S.settings.accent];
  if (root.style.setProperty) {
    if (accent) root.style.setProperty('--accent', accent); else root.style.removeProperty?.('--accent');
    root.style.setProperty('--msg-size', (Number(S.settings.text_size) || 16) + 'px');
  }
  root.dataset.anim = S.settings.animations === false ? 'off' : 'on';
  $('meta[name=theme-color]')?.setAttribute('content', dark ? '#212121' : '#ffffff');
  if (typeof Wallpaper !== 'undefined') Wallpaper.apply();
  if (typeof App !== 'undefined' && App.syncBars) App.syncBars();
}
let settingsTimer = null, settingsDirty = {};
function saveSettings(keys) {
  save('settings', S.settings);
  if (!keys || !S.token) return;
  for (const k of [].concat(keys)) settingsDirty[k] = S.settings[k] ?? null;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const body = settingsDirty;
    settingsDirty = {};
    api('PATCH', '/api/me/settings', body).catch(() => {});
  }, 600);
}
function setSetting(key, value) {
  S.settings[key] = value;
  saveSettings(key);
  if (typeof Native !== 'undefined') Native.syncPrefs();
  if (['theme', 'accent', 'text_size', 'animations', 'background'].includes(key)) applyTheme();
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.settings.theme === 'system') applyTheme(); }); } catch {}
applyTheme();
