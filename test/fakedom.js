'use strict';
// A deliberately small DOM implementation: just enough to run the Kabootar web client in Node
// against the real server, so UI code paths are exercised in CI without a browser.

class Event {
  constructor(type, init = {}) { Object.assign(this, { type, bubbles: !!init.bubbles, defaultPrevented: false, _stop: false }, init); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
}

class Node {
  constructor() { this.childNodes = []; this.parentNode = null; this._listeners = {}; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes.at(-1) || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === global.__doc; }
  _adopt(n) {
    if (typeof n === 'string') n = new Text(n);
    if (n.nodeType === 11) { const kids = [...n.childNodes]; kids.forEach((k) => (k.parentNode = null)); n.childNodes = []; return kids; }
    if (n.parentNode) n.remove();
    return [n];
  }
  append(...nodes) { for (const n of nodes) for (const k of this._adopt(n)) { k.parentNode = this; this.childNodes.push(k); } }
  appendChild(n) { this.append(n); return n; }
  prepend(...nodes) { const list = nodes.flatMap((n) => this._adopt(n)); list.forEach((k) => (k.parentNode = this)); this.childNodes.unshift(...list); }
  insertBefore(n, ref) {
    if (!ref) return this.append(n);
    const list = this._adopt(n);
    const i = this.childNodes.indexOf(ref);
    list.forEach((k) => (k.parentNode = this));
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, ...list);
    return n;
  }
  replaceChildren(...nodes) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...nodes); }
  remove() { if (!this.parentNode) return; const p = this.parentNode; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; }
  replaceWith(n) {
    const p = this.parentNode;
    if (!p) return;
    const list = this._adopt(n);
    const i = p.childNodes.indexOf(this);
    p.childNodes.splice(i, 1, ...list);
    list.forEach((k) => (k.parentNode = p));
    this.parentNode = null;
  }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    let n = this;
    while (n) {
      ev.currentTarget = n;
      for (const fn of [...(n._listeners[ev.type] || [])]) {
        try { fn.call(n, ev); } catch (e) { global.__uiErrors.push(e); console.error('[ui handler error]', e); }
      }
      const prop = n['on' + ev.type];
      if (typeof prop === 'function' && n.nodeType === 1) { try { prop.call(n, ev); } catch (e) { global.__uiErrors.push(e); } }
      if (!ev.bubbles || ev._stop) break;
      n = n.parentNode;
    }
    return !ev.defaultPrevented;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this.append(new Text(String(v))); }
}
class Text extends Node { constructor(t) { super(); this.nodeType = 3; this.data = t; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
class Fragment extends Node { constructor() { super(); this.nodeType = 11; } }

class ClassList {
  constructor(el) { this.el = el; }
  _get() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _set(a) { this.el.setAttribute('class', a.join(' ')); }
  add(...c) { const a = this._get(); for (const x of c) if (!a.includes(x)) a.push(x); this._set(a); }
  remove(...c) { this._set(this._get().filter((x) => !c.includes(x))); }
  contains(c) { return this._get().includes(c); }
  toggle(c, force) { const has = this.contains(c); const want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); return want; }
}

function parseSimple(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]|:not\(([^)]+\]?)\)/g;
  let m, rest = sel;
  while ((m = re.exec(sel))) {
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push([m[4], m[5]]);
    else if (m[6]) out.nots.push(parseSimple(m[6]));
    rest = rest.replace(m[0], '');
  }
  if (rest.trim()) throw new Error('fakedom: unsupported selector ' + sel);
  return out;
}
function matchSimple(el, s) {
  if (el.nodeType !== 1) return false;
  if (s.tag && el.tagName.toLowerCase() !== s.tag) return false;
  if (s.id && el.getAttribute('id') !== s.id) return false;
  for (const c of s.classes) if (!el.classList.contains(c)) return false;
  for (const [k, v] of s.attrs) { const a = el.getAttribute(k); if (a == null || (v !== undefined && a !== v)) return false; }
  for (const n of s.nots) if (matchSimple(el, n)) return false;
  return true;
}
function matches(el, selector) {
  return selector.split(',').some((group) => {
    const parts = group.trim().split(/\s+/).map(parseSimple);
    if (!matchSimple(el, parts.at(-1))) return false;
    let n = el.parentNode, i = parts.length - 2;
    while (i >= 0 && n) { if (n.nodeType === 1 && matchSimple(n, parts[i])) i--; n = n.parentNode; }
    return i < 0;
  });
}
function* walk(root) { for (const c of root.childNodes) { if (c.nodeType === 1) { yield c; yield* walk(c); } } }

class Element extends Node {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.classList = new ClassList(this);
    this.style = new Proxy({ setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] || ''; } }, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => ((t[k] = v), true) });
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) ?? undefined,
      set: (_, k, v) => { self.setAttribute('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), String(v)); return true; },
      ownKeys: () => Object.keys(self.attributes).filter((a) => a.startsWith('data-')).map((a) => a.slice(5)),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
    this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 600;
    this.value = ''; this.checked = false; this.disabled = false; this.files = [];
    this.selectionStart = 0; this.selectionEnd = 0;
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { v ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get type() { return this.getAttribute('type') || ''; }
  set type(v) { this.setAttribute('type', v); }
  get accept() { return this.getAttribute('accept') || ''; }
  set accept(v) { this.setAttribute('accept', v); }
  get src() { return this.getAttribute('src') || ''; }
  set src(v) { this.setAttribute('src', v); if (this.tagName === 'IMG' || this.tagName === 'VIDEO' || this.tagName === 'AUDIO') setTimeout(() => this.dispatchEvent(new Event(this.tagName === 'IMG' ? 'load' : 'loadedmetadata'))); }
  get autocomplete() { return this.getAttribute('autocomplete') || ''; }
  set autocomplete(v) { this.setAttribute('autocomplete', v); }
  get offsetWidth() { return 100; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'src' && /^(IMG|VIDEO|AUDIO)$/.test(this.tagName)) setTimeout(() => this.dispatchEvent(new Event(this.tagName === 'IMG' ? 'load' : 'loadedmetadata')));
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; }
  querySelector(s) { for (const e of walk(this)) if (matches(e, s)) return e; return null; }
  querySelectorAll(s) { return [...walk(this)].filter((e) => matches(e, s)); }
  closest(s) { let n = this; while (n && n.nodeType === 1) { if (matches(n, s)) return n; n = n.parentNode; } return null; }
  matches(s) { return matches(this, s); }
  getBoundingClientRect() { return { left: 100, top: 100, right: 300, bottom: 140, width: 200, height: 40 }; }
  scrollIntoView() {} focus() { global.__doc.activeElement = this; } blur() {} select() {}
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  click() { this.dispatchEvent(new Event('click', { bubbles: true })); }
  // media
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  get paused() { return this._paused ?? true; } set paused(v) { this._paused = v; }
}

class Document extends Element {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.documentElement = new Element('html');
    this.head = new Element('head');
    this.body = new Element('body');
    this.documentElement.append(this.head, this.body);
    this.childNodes = [this.documentElement];
    this.documentElement.parentNode = this;
    this.hidden = false;
    this.title = '';
    this.activeElement = null;
  }
  get hidden() { return this._hidden; } set hidden(v) { this._hidden = v; }
  get title() { return this._title; } set title(v) { this._title = v; }
  createElement(t) { return new Element(t); }
  createElementNS(ns, t) { return new Element(t); }
  createTextNode(t) { return new Text(t); }
  createDocumentFragment() { return new Fragment(); }
  getElementById(id) { return this.querySelector('#' + id); }
  execCommand() { return true; }
}

module.exports = { Event, Node, Text, Element, Document, Fragment };

// ---- serializer (used to render static screenshots of the live UI) ----
const VOID = new Set(['img', 'input', 'meta', 'link', 'br', 'hr', 'path']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function serialize(n) {
  if (n.nodeType === 3) return esc(n.data);
  if (n.nodeType === 11 || n.nodeType === 9) return n.childNodes.map(serialize).join('');
  const tag = n.tagName.toLowerCase();
  const attrs = { ...n.attributes };
  const style = Object.entries(n.style).filter(([k, v]) => typeof v !== 'function' && v !== '').map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v}`).join(';');
  if (style) attrs.style = style;
  if (tag === 'input' && n.value) attrs.value = n.value;
  if (tag === 'svg') attrs.xmlns = 'http://www.w3.org/2000/svg';
  const a = Object.entries(attrs).filter(([k]) => !k.startsWith('on')).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  if (tag === 'textarea') return `<textarea${a}>${esc(n.value)}</textarea>`;
  if (VOID.has(tag)) return `<${tag}${a}${tag === 'path' ? '/' : ''}>`;
  return `<${tag}${a}>${n.childNodes.map(serialize).join('')}</${tag}>`;
}
module.exports.serialize = serialize;
