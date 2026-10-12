'use strict';
/* Kabootar — chat wallpaper: Telegram-style 4-colour animated gradient + doodle pattern, solid colours, or your own photo. */

const Wallpaper = {
  // first one is Telegram's default light wallpaper
  GRADIENTS: [
    ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'],
    ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'],
    ['#b2e2f8', '#7cb6ec', '#c2e0fa', '#93c5f2'],
    ['#ffd3b5', '#ffaaa6', '#ffc2a3', '#ffe1c7'],
    ['#e2c9f6', '#a99ef2', '#c7b6f5', '#9a8ee6'],
    ['#c4f0d9', '#7fd1b9', '#a8e6cf', '#d7f5e6'],
    ['#f7e5a3', '#e3b55b', '#f1d27a', '#e6c27a'],
    ['#5ab3d9', '#2d6fa3', '#4fa3c7', '#a3d9ec'],
  ],
  DARK_DEFAULT: ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'],
  COLORS: ['#9bc4a0', '#8fb7d9', '#e6c39a', '#c9a7d6', '#e3a3a3', '#a4d0cf', '#d6d6d6', '#7a8a9a', '#3b4a5a', '#1f2a36', '#2b2b2b', '#0f0f0f'],
  // the 8 control-point positions Telegram cycles through
  POS: [[0.8, 0.1], [0.6, 0.2], [0.35, 0.25], [0.25, 0.6], [0.2, 0.9], [0.4, 0.8], [0.65, 0.75], [0.75, 0.4]],
  phase: 0,
  el: null,

  current() {
    const bg = S.settings.background;
    if (bg && bg.type) return bg;
    return darkMode() ? { type: 'gradient', colors: this.DARK_DEFAULT, pattern: true } : { type: 'gradient', colors: this.GRADIENTS[0], pattern: true };
  },

  mount(chat) {
    this.canvas = h('canvas', { class: 'wp-canvas', width: 50, height: 50 });
    this.image = h('div', { class: 'wp-image' });
    this.pattern = h('div', { class: 'wp-pattern' });
    this.el = h('div', { class: 'wallpaper', 'aria-hidden': 'true' }, this.image, this.canvas, this.pattern);
    chat.prepend(this.el);
    this.apply();
    return this.el;
  },

  apply() {
    if (!this.el) return;
    const bg = this.current();
    const dark = darkMode();
    const el = this.el;
    el.className = 'wallpaper ' + bg.type + (bg.pattern ? ' with-pattern' : '') + (dark ? ' dark' : '') + (bg.blur ? ' blur' : '');
    el.style.background = bg.type === 'color' ? bg.color : '';
    this.image.style.backgroundImage = bg.type === 'image' && bg.url ? `url("${bg.url}")` : '';
    if (bg.type === 'gradient') this.draw(bg.colors, this.phase);
  },

  hexToRgb(hx) {
    const n = parseInt(String(hx).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  points(phase) {
    const out = [];
    const base = Math.floor(phase), t = phase - base;
    for (let i = 0; i < 4; i++) {
      const a = this.POS[(base + i * 2) % 8], b = this.POS[(base + 1 + i * 2) % 8];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  },

  // Port of Telegram's gradient renderer: each pixel = colours weighted by (0.9 - distance)^4
  draw(colors, phase, canvas = this.canvas) {
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return;
    const w = canvas.width, hgt = canvas.height;
    const img = ctx.createImageData(w, hgt);
    const pts = this.points(phase);
    const rgb = colors.map((c) => this.hexToRgb(c));
    let o = 0;
    for (let y = 0; y < hgt; y++) {
      const dy = y / hgt;
      for (let x = 0; x < w; x++) {
        const dx = x / w;
        let sum = 0, r = 0, g = 0, b = 0;
        for (let i = 0; i < 4; i++) {
          const px = pts[i][0] - dx, py = pts[i][1] - dy;
          let d = Math.max(0, 0.9 - Math.sqrt(px * px + py * py));
          d = d * d * d * d;
          sum += d;
          r += d * rgb[i][0]; g += d * rgb[i][1]; b += d * rgb[i][2];
        }
        img.data[o++] = r / sum; img.data[o++] = g / sum; img.data[o++] = b / sum; img.data[o++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  // the gradient "breathes" one step whenever you send a message (like Telegram)
  animate() {
    const bg = this.current();
    if (bg.type !== 'gradient' || S.settings.animations === false || !this.canvas?.getContext) return;
    const from = this.phase, to = from + 1, t0 = Date.now(), dur = 320;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.phase = from + (to - from) * e;
      this.draw(bg.colors, this.phase);
      if (k < 1) raf(step); else this.phase = to % 8;
    };
    raf(step);
  },

  preview(bg, size = 100) {
    const tile = h('div', { class: 'wp-tile ' + bg.type + (bg.pattern ? ' with-pattern' : '') });
    if (bg.type === 'gradient') {
      const cv = h('canvas', { width: 40, height: 40 });
      tile.append(cv);
      this.draw(bg.colors, 0, cv);
    } else if (bg.type === 'color') tile.style.background = bg.color;
    else if (bg.type === 'image') tile.style.backgroundImage = `url("${bg.url}")`;
    tile.append(h('i', { class: 'wp-pat' }));
    return tile;
  },
};
