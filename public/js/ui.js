'use strict';
/* Kabootar web client — reusable UI: menus, modals, emoji picker, lightbox. */

const UI = {};

/* ---------- context / dropdown menu ---------- */
let openMenuEl = null;
UI.closeMenu = () => {
  if (!openMenuEl) return;
  openMenuEl.menu.remove();
  openMenuEl.backdrop.remove();
  openMenuEl = null;
};
// items: [{ icon, label, onClick, danger, toggle }|'sep'], opts: { x, y, anchor, quick: Node }
UI.menu = (items, opts = {}) => {
  UI.closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  if (opts.head) menu.append(opts.head);
  if (opts.quick) menu.append(opts.quick);
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { menu.append(h('div', { class: 'sep' })); continue; }
    menu.append(h('button', {
      class: 'mi' + (it.danger ? ' danger' : ''), role: 'menuitem', type: 'button',
      onclick: (e) => { e.stopPropagation(); if (!it.keepOpen) UI.closeMenu(); it.onClick && it.onClick(e); },
    }, it.icon ? icon(it.icon) : null, h('span', {}, it.label), it.toggle != null ? h('span', { class: 'switch toggle' + (it.toggle ? ' on' : '') }) : null));
  }
  const backdrop = h('div', { class: 'backdrop', onclick: UI.closeMenu, oncontextmenu: (e) => { e.preventDefault(); UI.closeMenu(); } });
  document.body.append(backdrop, menu);
  openMenuEl = { menu, backdrop };
  // position
  const r = menu.getBoundingClientRect();
  let x, y;
  if (opts.anchor) {
    const a = opts.anchor.getBoundingClientRect();
    x = opts.alignStart ? a.right - r.width : a.left;
    y = a.bottom + 4;
    if (opts.up) y = a.top - r.height - 4;
  } else { x = opts.x - r.width; y = opts.y; }
  x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
  if (y + r.height > innerHeight - 8) y = Math.max(8, (opts.y ?? innerHeight) - r.height);
  y = Math.max(8, Math.min(y, innerHeight - r.height - 8));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  return menu;
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { UI.closeMenu(); UI.closeEmoji(); } });

/* ---------- modal ---------- */
const modalStack = [];
UI.modal = ({ title, body, foot, wide, onClose, back }) => {
  const close = () => {
    wrap.remove();
    modalStack.splice(modalStack.indexOf(api), 1);
    onClose && onClose();
  };
  const head = h('div', { class: 'modal-head' },
    ibtn(back ? 'back' : 'close', back ? 'بازگشت' : 'بستن', () => (back ? back() : close())),
    h('h3', {}, title));
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footEl = foot ? h('div', { class: 'modal-foot' }, foot) : null;
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, head, bodyEl, footEl);
  const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap);
  const api = { close, el: box, body: bodyEl, head, setTitle: (t) => (head.querySelector('h3').textContent = t) };
  modalStack.push(api);
  setTimeout(() => box.querySelector('input:not([type=file]), textarea')?.focus(), 30);
  return api;
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length && !openMenuEl && !$('.emoji-pop') && !$('.lightbox')) modalStack.at(-1).close();
});

UI.ask = (title, text, okLabel = 'تأیید', danger = false) => new Promise((resolve) => {
  let done = false;
  const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
  const m = UI.modal({
    title,
    body: h('p', {}, text),
    foot: [
      h('button', { class: 'btn ' + (danger ? 'danger' : 'flat'), onclick: () => finish(true) }, okLabel),
      h('button', { class: 'btn flat', onclick: () => finish(false) }, 'انصراف'),
    ],
    onClose: () => { if (!done) { done = true; resolve(false); } },
  });
});

UI.field = (label, attrs = {}, hint) => {
  const input = attrs.multiline ? h('textarea', { rows: attrs.rows || 3, ...attrs, multiline: null }) : h('input', { type: 'text', ...attrs });
  const f = h('label', { class: 'field' }, input, h('span', {}, label), hint ? h('small', { class: 'hint' }, hint) : null);
  f.input = input;
  return f;
};

UI.prompt = (title, label, value = '', attrs = {}) => new Promise((resolve) => {
  let done = false;
  const f = UI.field(label, { value, ...attrs });
  const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
  f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(f.input.value.trim()); } });
  const m = UI.modal({
    title, body: f,
    foot: [h('button', { class: 'btn flat', onclick: () => finish(f.input.value.trim()) }, 'تأیید'), h('button', { class: 'btn flat', onclick: () => finish(null) }, 'انصراف')],
    onClose: () => { if (!done) { done = true; resolve(null); } },
  });
});

UI.switchRow = (iconName, label, sub, value, onChange) => {
  const sw = h('span', { class: 'switch' + (value ? ' on' : '') });
  const row = h('div', { class: 'set-row', role: 'switch', 'aria-checked': String(!!value) },
    icon(iconName), h('div', { class: 'body' }, h('div', { class: 'n' }, label), sub ? h('div', { class: 's' }, sub) : null), sw);
  row.addEventListener('click', async () => {
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    try { await onChange(next); } catch (e) { sw.classList.toggle('on', !next); toast(e.message); }
  });
  return row;
};
UI.row = (iconName, label, sub, onClick, cls) =>
  h('div', { class: 'set-row' + (cls ? ' ' + cls : ''), onclick: onClick }, icon(iconName), h('div', { class: 'body' }, h('div', { class: 'n' }, label), sub ? h('div', { class: 's' }, sub) : null));

/* ---------- emoji picker ---------- */
const EMOJI = {
  '🕘': null,
  '😀': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖',
  '👍': '👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🦾 🧠 👀 👁️ 👅 👄 💋 🫶 🧑 👶 👦 👧 👨 👩 🧔 👴 👵 🙋 🙆 🙅 🤷 🤦 💁 🙇',
  '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☯️ ♾️ ✅ ❌ ⭕ 🛑 ⛔ 💯 💢 ♨️ 💤 🔥 ✨ ⭐ 🌟 💫 ⚡ 💥 💦 💨 🎉 🎊 🎈 🎁 🏆 🥇 🎯',
  '🐱': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🦖 🐙 🐬 🐳 🦈 🕊️ 🌸 🌹 🌺 🌻 🌼 🌷 🌱 🌲 🌴 🌵 🍀 🍁 🍂 🌍 🌙 ☀️ ⛅ 🌈 ❄️ ☃️',
  '🍕': '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥦 🍞 🥐 🧀 🥚 🍳 🥞 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🍤 🍙 🍚 🍦 🍰 🎂 🧁 🍫 🍬 🍭 🍩 🍪 ☕ 🍵 🧃 🥤 🧋',
  '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🎣 🎽 🛹 ⛸️ 🎿 🏂 🏋️ 🤸 🚴 🏊 🧘 🎮 🕹️ 🎲 🧩 ♟️ 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🚗 🚕 🚌 🏎️ 🚓 🚑 🚒 ✈️ 🚀 🛸 🚁 ⛵ 🚢 🏠 🏢 🏰 🗼 🗽 🕌 ⛪ 🏝️ 🏔️',
  '💡': '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 💿 📷 📹 🎥 📞 ☎️ 📺 📻 ⏰ ⌛ 📡 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 ⚖️ 🔧 🔨 ⚙️ 🔫 💣 🔪 🛡️ 🔮 💊 💉 🧬 🔬 🔭 🧹 🧺 🧻 🚽 🛁 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🎁 📦 📫 📮 ✉️ 📝 📁 📅 📌 📎 ✂️ 🔒 🔓',
};
let emojiEl = null;
UI.closeEmoji = () => { if (emojiEl) { emojiEl.remove(); emojiEl = null; } };
UI.emojiPicker = (anchor, onPick) => {
  if (emojiEl) return UI.closeEmoji();
  const grid = h('div', { class: 'emoji-grid' });
  const tabs = h('div', { class: 'emoji-tabs' });
  const show = (cat) => {
    $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.cat === cat));
    grid.replaceChildren();
    const list = cat === '🕘' ? S.recentEmoji : EMOJI[cat].split(' ');
    if (!list.length) grid.append(h('div', { class: 'info-empty' }, 'هنوز اموجی‌ای استفاده نکرده‌اید'));
    for (const e of list) grid.append(h('button', { type: 'button', onclick: () => {
      S.recentEmoji = [e, ...S.recentEmoji.filter((x) => x !== e)].slice(0, 32);
      save('recentEmoji', S.recentEmoji);
      onPick(e);
    } }, e));
  };
  for (const cat of Object.keys(EMOJI)) tabs.append(h('button', { type: 'button', dataset: { cat }, onclick: () => show(cat) }, cat));
  emojiEl = h('div', { class: 'emoji-pop', onmousedown: (e) => e.preventDefault() }, tabs, grid);
  document.body.append(emojiEl);
  const a = anchor.getBoundingClientRect();
  const w = 340, ht = 330;
  emojiEl.style.left = Math.max(8, Math.min(a.right - w, innerWidth - w - 8)) + 'px';
  emojiEl.style.top = Math.max(8, a.top - ht - 8) + 'px';
  show(S.recentEmoji.length ? '🕘' : '😀');
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (emojiEl && !emojiEl.contains(e.target) && !anchor.contains(e.target)) { UI.closeEmoji(); document.removeEventListener('mousedown', off); }
    if (!emojiEl) document.removeEventListener('mousedown', off);
  }), 0);
};

/* ---------- lightbox ---------- */
UI.lightbox = (m) => {
  const isVideo = m.kind === 'video';
  const media = isVideo ? h('video', { src: m.media.url, controls: true, autoplay: true, playsinline: true }) : h('img', { src: m.media.url, alt: '' });
  const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const lb = h('div', { class: 'lightbox' },
    h('div', { class: 'lb-head' },
      userAvatar(m.sender, 's40'),
      h('div', { class: 'body' }, h('div', { class: 'n' }, m.sender.display_name), h('div', { class: 's' }, fmtDay(m.created_at) + ' ' + fmtTime(m.created_at))),
      h('a', { class: 'ibtn', href: m.media.url, download: m.media.name, title: 'دانلود' }, icon('download')),
      ibtn('forward', 'بازارسال', () => { close(); App.forwardDialog([m.id]); }),
      ibtn('close', 'بستن', close)),
    h('div', { class: 'lb-main', onclick: (e) => { if (e.target.classList.contains('lb-main')) close(); } }, media),
    m.text ? h('div', { class: 'lb-cap', dir: 'auto' }, m.text) : null);
  document.body.append(lb);
  document.addEventListener('keydown', onKey);
};

/* long-press helper for touch devices (iOS doesn't fire contextmenu) */
UI.longPress = (el, cb) => {
  let t = null, sx = 0, sy = 0;
  el.addEventListener('touchstart', (e) => {
    const p = e.touches[0]; sx = p.clientX; sy = p.clientY;
    t = setTimeout(() => { t = null; cb({ clientX: sx, clientY: sy, preventDefault() {}, target: e.target }); }, 480);
  }, { passive: true });
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  el.addEventListener('touchmove', (e) => { const p = e.touches[0]; if (Math.hypot(p.clientX - sx, p.clientY - sy) > 10) cancel(); }, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
};
