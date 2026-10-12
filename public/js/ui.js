'use strict';
/* Kabootar web client — reusable UI (Telegram Web K look): menus, popups, fields, toggles, sliding tabs. */

const UI = {};

/* ---------- context / dropdown menu (Web K .btn-menu) ---------- */
let openMenuEl = null;
UI.closeMenu = () => {
  if (!openMenuEl) return;
  const { menu, backdrop, extra } = openMenuEl;
  openMenuEl = null;
  menu.classList.add('hide');
  extra?.classList.add('hide');
  backdrop.remove();
  setTimeout(() => { menu.remove(); extra?.remove(); }, 120);
};
// items: [{ icon, label, onClick, danger, toggle, sub, checked }|'sep'], opts: { x, y, anchor, head, reactions: Node, up, alignStart }
UI.menu = (items, opts = {}) => {
  UI.closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  if (opts.head) menu.append(opts.head);
  if (opts.quick) menu.append(opts.quick);
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { if (menu.lastChild && !menu.lastChild.classList?.contains('sep')) menu.append(h('div', { class: 'sep' })); continue; }
    menu.append(h('button', {
      class: 'mi' + (it.danger ? ' danger' : ''), role: 'menuitem', type: 'button',
      onclick: (e) => { e.stopPropagation(); if (!it.keepOpen) UI.closeMenu(); it.onClick && it.onClick(e); },
    }, it.icon ? icon(it.icon) : null, h('span', { class: 'ml' }, it.label),
    it.sub ? h('span', { class: 'ms' }, it.sub) : null,
    it.toggle != null ? h('span', { class: 'switch toggle' + (it.toggle ? ' on' : '') }) : null,
    it.checked ? icon('check', 'mc') : null));
  }
  if (menu.lastChild?.classList?.contains('sep')) menu.lastChild.remove();
  const backdrop = h('div', { class: 'backdrop', onmousedown: (e) => { e.preventDefault(); UI.closeMenu(); }, oncontextmenu: (e) => { e.preventDefault(); UI.closeMenu(); } });
  const extra = opts.reactions || null;
  document.body.append(backdrop, menu);
  if (extra) document.body.append(extra);
  openMenuEl = { menu, backdrop, extra };
  const r = menu.getBoundingClientRect();
  let x, y;
  if (opts.anchor) {
    const a = opts.anchor.getBoundingClientRect();
    x = opts.alignStart ? a.right - r.width : a.left;
    y = opts.up ? a.top - r.height - 6 : a.bottom + 6;
    menu.classList.add(opts.up ? 'from-bottom' : 'from-top');
  } else {
    x = opts.x - r.width; y = opts.y;
    if (x < 8) x = opts.x;
  }
  const extraH = extra ? 58 : 0;
  x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
  if (y + r.height > innerHeight - 8) y = Math.max(8 + extraH, (opts.y ?? innerHeight) - r.height);
  y = Math.max(8 + extraH, Math.min(y, innerHeight - r.height - 8));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  if (extra) {
    const er = extra.getBoundingClientRect();
    extra.style.left = Math.max(8, Math.min(x + r.width - (er.width || 300), innerWidth - (er.width || 300) - 8)) + 'px';
    extra.style.top = (y - 54) + 'px';
  }
  return menu;
};
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openMenuEl) return UI.closeMenu();
  if (UI.closeEmoji && UI.closeEmoji()) return;
});

/* ---------- popup (modal) ---------- */
const modalStack = [];
UI.modal = ({ title, body, foot, wide, onClose, back, cls, noHead }) => {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.add('hide');
    setTimeout(() => wrap.remove(), 160);
    modalStack.splice(modalStack.indexOf(api), 1);
    onClose && onClose();
  };
  const head = noHead ? null : h('div', { class: 'modal-head' },
    ibtn(back ? 'back' : 'close', back ? 'بازگشت' : 'بستن', () => (back ? back() : close())),
    h('h3', {}, title));
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footEl = foot ? h('div', { class: 'modal-foot' }, foot) : null;
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') + (cls ? ' ' + cls : ''), role: 'dialog', 'aria-modal': 'true' }, head, bodyEl, footEl);
  const wrap = h('div', { class: 'modal-wrap', onmousedown: (e) => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap);
  const api = { close, el: box, wrap, body: bodyEl, head, foot: footEl, setTitle: (t) => (head.querySelector('h3').textContent = t) };
  modalStack.push(api);
  setTimeout(() => box.querySelector('input:not([type=file]):not([type=search]), textarea')?.focus(), 30);
  return api;
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length && !openMenuEl && !$('.emoji-pop') && !$('.lightbox') && !$('.story-viewer')) modalStack.at(-1).close();
});
UI.closeAllModals = () => { while (modalStack.length) modalStack.at(-1).close(); };

// Telegram-style confirm: title, text, [CANCEL] [ACTION]; options: { checkbox: label } -> resolves { ok, checked }
UI.ask = (title, text, okLabel = 'تأیید', danger = false, opts = {}) => new Promise((resolve) => {
  let done = false, checked = !!opts.checked;
  const box = opts.checkbox ? UI.checkRow(opts.checkbox, checked, (v) => (checked = v)) : null;
  const finish = (v) => { if (!done) { done = true; m.close(); resolve(opts.checkbox ? { ok: v, checked } : v); } };
  const m = UI.modal({
    title, cls: 'confirm',
    body: [h('p', {}, text), box],
    foot: [
      h('button', { class: 'btn flat', onclick: () => finish(false) }, 'انصراف'),
      h('button', { class: 'btn flat ' + (danger ? 'danger' : ''), onclick: () => finish(true) }, okLabel),
    ],
    onClose: () => { if (!done) { done = true; resolve(opts.checkbox ? { ok: false, checked } : false); } },
  });
});

/* Web K input-field: outlined box, label floats on focus / value */
UI.field = (label, attrs = {}, hint) => {
  const a = { ...attrs };
  const multi = a.multiline; delete a.multiline;
  if (a.placeholder == null) a.placeholder = ' ';
  const input = multi ? h('textarea', { rows: a.rows || 3, ...a }) : h('input', { type: 'text', ...a });
  const f = h('label', { class: 'field' + (a.placeholder.trim() ? ' has-ph' : '') }, input, h('span', {}, label), hint ? h('small', { class: 'hint' }, hint) : null);
  f.input = input;
  f.setHint = (t, bad) => { let s = f.querySelector('.hint'); if (!s) f.append((s = h('small', { class: 'hint' }))); s.textContent = t; f.classList.toggle('error', !!bad); };
  if (a.type === 'password') {
    const eye = ibtn('eye', 'نمایش رمز', (e) => { e.preventDefault(); input.type = input.type === 'password' ? 'text' : 'password'; eye.classList.toggle('on', input.type === 'text'); }, 'eye');
    f.append(eye);
    f.classList.add('with-eye');
  }
  return f;
};

UI.prompt = (title, label, value = '', attrs = {}) => new Promise((resolve) => {
  let done = false;
  const f = UI.field(label, { value, ...attrs });
  const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
  f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(f.input.value.trim()); } });
  const m = UI.modal({
    title, body: f,
    foot: [h('button', { class: 'btn flat', onclick: () => finish(null) }, 'انصراف'), h('button', { class: 'btn flat', onclick: () => finish(f.input.value.trim()) }, 'تأیید')],
    onClose: () => { if (!done) { done = true; resolve(null); } },
  });
});

/* ---------- rows (Web K .row) ---------- */
UI.switchRow = (iconName, label, sub, value, onChange) => {
  const sw = h('span', { class: 'switch' + (value ? ' on' : '') });
  const row = h('div', { class: 'set-row', role: 'switch', 'aria-checked': String(!!value) },
    iconName ? icon(iconName) : null, h('div', { class: 'body' }, h('div', { class: 'n' }, label), sub ? h('div', { class: 's' }, sub) : null), sw);
  row.addEventListener('click', async () => {
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    row.setAttribute('aria-checked', String(next));
    try { await onChange(next); } catch (e) { sw.classList.toggle('on', !next); toast(e.message); }
  });
  return row;
};
UI.row = (iconName, label, sub, onClick, cls, end) =>
  h('div', { class: 'set-row' + (cls ? ' ' + cls : '') + (onClick ? ' clickable' : ''), onclick: onClick },
    iconName ? icon(iconName) : null,
    h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, label), sub ? h('div', { class: 's', dir: 'auto' }, sub) : null),
    end != null ? h('span', { class: 'end' }, end) : null);
UI.checkRow = (label, value, onChange, sub) => {
  const box = h('span', { class: 'checkbox' + (value ? ' on' : '') }, icon('check'));
  const row = h('div', { class: 'set-row check-row', role: 'checkbox', 'aria-checked': String(!!value) }, box,
    h('div', { class: 'body' }, h('div', { class: 'n' }, label), sub ? h('div', { class: 's' }, sub) : null));
  row.addEventListener('click', () => {
    const next = !box.classList.contains('on');
    box.classList.toggle('on', next);
    row.setAttribute('aria-checked', String(next));
    onChange && onChange(next);
  });
  return row;
};
// radio group: options [[value, label, sub]]
UI.radios = (options, value, onChange) => {
  const wrap = h('div', { class: 'radios', role: 'radiogroup' });
  const paint = (v) => $$('.set-row', wrap).forEach((r) => { const on = r.dataset.v === String(v); r.classList.toggle('on', on); r.setAttribute('aria-checked', String(on)); });
  for (const [v, label, sub] of options) {
    wrap.append(h('div', { class: 'set-row radio-row', role: 'radio', dataset: { v: String(v) }, onclick: () => { paint(v); onChange(v); } },
      h('span', { class: 'radio' }), h('div', { class: 'body' }, h('div', { class: 'n' }, label), sub ? h('div', { class: 's' }, sub) : null)));
  }
  paint(value);
  return wrap;
};
UI.range = (min, max, step, value, onInput, fmt = (v) => fa(v)) => {
  const out = h('span', { class: 'range-val' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, class: 'range' });
  const paint = () => { const p = ((input.value - min) / (max - min)) * 100; input.style.setProperty?.('--p', p + '%'); out.textContent = fmt(Number(input.value)); };
  input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
  paint();
  return { el: h('div', { class: 'range-row' }, input, out), input };
};
// section: caption + rows (+ optional footer caption), separated by a gray band like Web K
UI.section = (caption, rows, footer) =>
  h('div', { class: 'section' }, caption ? h('div', { class: 'section-caption' }, caption) : null, rows, footer ? h('div', { class: 'section-foot' }, footer) : null);

// horizontal tabs with sliding underline (Web K .menu-horizontal)
UI.tabs = (tabs, active, onPick, cls = '') => {
  const bar = h('div', { class: 'htabs ' + cls, role: 'tablist' });
  const paint = (k) => $$('button', bar).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  for (const [k, label, badge] of tabs) {
    bar.append(h('button', { type: 'button', role: 'tab', dataset: { k }, onclick: () => { paint(k); onPick(k); } }, h('span', { class: 'tl' }, label, badge ? h('span', { class: 'count' }, badge) : null), h('i')));
  }
  paint(active);
  bar.select = paint;
  return bar;
};

/* ---------- sliding tabs (Web K sidebar-slider) ---------- */
// Each pushed tab: { title, body, actions:[nodes], fab: {icon, onClick}, onClose, cls, closeIcon }
UI.Slider = class {
  constructor(container, base) {
    this.c = container;
    this.base = base;
    this.stack = [];
  }
  get depth() { return this.stack.length; }
  top() { return this.stack.at(-1) || null; }
  push(opts) {
    const head = h('div', { class: 'stab-head' },
      ibtn(opts.closeIcon || 'back', 'بازگشت', () => this.pop()),
      h('h2', { dir: 'auto' }, opts.title || ''), h('div', { class: 'actions' }, opts.actions || []));
    const body = h('div', { class: 'stab-body' }, opts.body || []);
    const tab = h('div', { class: 'stab ' + (opts.cls || '') }, head, body);
    let fab = null;
    if (opts.fab) {
      fab = h('button', { class: 'fab' + (opts.fab.hidden ? ' hide' : ''), type: 'button', title: opts.fab.title || '', onclick: opts.fab.onClick }, icon(opts.fab.icon, opts.fab.icon === 'back' ? 'flip' : ''));
      tab.append(fab);
    }
    const prev = this.top()?.tab || this.base;
    this.c.append(tab);
    raf(() => { tab.classList.add('in'); prev?.classList.add('behind'); });
    const entry = { tab, head, body, fab, opts, setTitle: (t) => ($('h2', head).textContent = t), close: () => this.pop(entry) };
    this.stack.push(entry);
    return entry;
  }
  pop(entry) {
    const e = entry || this.top();
    if (!e) return false;
    const i = this.stack.indexOf(e);
    if (i < 0) return false;
    // popping a tab also pops everything above it
    const removed = this.stack.splice(i);
    const prev = this.top()?.tab || this.base;
    prev?.classList.remove('behind');
    for (const r of removed.reverse()) {
      r.tab.classList.remove('in');
      r.tab.classList.add('out');
      setTimeout(() => r.tab.remove(), 260);
      try { r.opts.onClose && r.opts.onClose(); } catch (err) { console.error(err); }
    }
    this.top()?.opts.onShow?.();
    return true;
  }
  popAll() { if (this.stack.length) this.pop(this.stack[0]); }
};

/* ---------- emoji data ---------- */
const EMOJI = {
  '🕘': ['اخیر', null],
  '😀': ['شکلک‌ها', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊'],
  '👍': ['مردم', '👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 💋 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 🥷 👷 🫅 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 👯 🧖 🧗 🤺 🏇 ⛷️ 🏂 🏌️ 🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 🛀 🛌 👭 👫 👬 💏 💑 👪'],
  '🐱': ['حیوانات و طبیعت', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🦭 🐊 🐅 🐆 🦓 🦍 🦧 🦣 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦤 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 🌎 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 🫧 ☔ ☂️ 🌊'],
  '🍕': ['غذا و نوشیدنی', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️ 🥣 🥡 🥢 🧂'],
  '⚽': ['فعالیت‌ها', '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩'],
  '🚗': ['سفر و مکان‌ها', '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🪝 ⛽ 🚧 🚦 🚥 🚏 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🛤️ 🛣️ 🗾 🎑 🏞️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁'],
  '💡': ['اشیا', '⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🛌 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🎎 🏮 🎐 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷️ 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 🗑️ 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 🗂️ 🗞️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓'],
  '❤️': ['نمادها', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧️ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ⏏️ ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 🟰 ♾️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾ ◽ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄'],
  '🏳️': ['پرچم‌ها', '🏳️ 🏴 🏁 🚩 🏳️‍🌈 🇮🇷 🇦🇫 🇹🇯 🇹🇷 🇦🇪 🇸🇦 🇮🇶 🇦🇿 🇦🇲 🇬🇪 🇵🇰 🇮🇳 🇨🇳 🇯🇵 🇰🇷 🇷🇺 🇺🇦 🇩🇪 🇫🇷 🇬🇧 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇵🇱 🇬🇷 🇺🇸 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇦🇺 🇳🇿 🇪🇬 🇿🇦 🇳🇬 🇰🇪 🇲🇦 🇶🇦 🇰🇼 🇴🇲 🇧🇭 🇯🇴 🇱🇧 🇸🇾 🇮🇩 🇲🇾 🇹🇭 🇻🇳 🇵🇭 🇸🇬'],
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

/* ripple effect on rows/buttons (Web K c-ripple) */
document.addEventListener('pointerdown', (e) => {
  if (document.documentElement.dataset.anim === 'off') return;
  const t = e.target?.closest?.('.ci, .set-row.clickable, .mi, .btn, .pick, .htabs button, .fab, .stab-head .ibtn');
  if (!t || !t.getBoundingClientRect) return;
  const r = t.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const rip = h('span', { class: 'ripple' });
  rip.style.width = rip.style.height = size + 'px';
  rip.style.left = (e.clientX - r.left - size / 2) + 'px';
  rip.style.top = (e.clientY - r.top - size / 2) + 'px';
  t.classList.add('rippled');
  t.append(rip);
  setTimeout(() => rip.remove(), 600);
});
