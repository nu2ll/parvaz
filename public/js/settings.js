'use strict';
/* Kabootar — Settings, as sliding sidebar pages (Telegram Web K layout). */

const PRIVACY_LABELS = { everybody: 'همه', contacts: 'مخاطبین من', nobody: 'هیچ‌کس' };

// Web K 2.2 settings: centered profile, rounded cards, coloured squircle icons
const SQ = { red: '#ef5b5b', green: '#4fbe5a', blue: '#3d9cf5', slate: '#7d8e9c', gray: '#8a949e', pink: '#f2477a', purple: '#8e6cf1', orange: '#f5a524', teal: '#2bb5a8' };
const crow = (ic, color, label, sub, onClick, end, cls) => {
  const r = UI.row(null, label, sub, onClick, 'sq-row' + (cls ? ' ' + cls : ''), end);
  r.prepend(h('span', { class: 'sq', style: { background: SQ[color] || color } }, icon(ic)));
  return r;
};
// the settings screen body, shared by the root tab (bottom bar) and the pushed page
App.settingsView = () => {
  const body = h('div', { class: 'settings' });
  let expanded = false;
  let devices = null;
  const paint = () => {
    const me2 = S.me;
    const name = h('div', { class: 't', dir: 'auto' }, me2.display_name, me2.verified ? R.verified() : null);
    const top = expanded && me2.avatar
      ? h('div', { class: 'info-photo settings-photo', onclick: () => { expanded = false; paint(); } }, h('img', { src: me2.avatar, alt: '' }),
        h('div', { class: 'ip-over' }, name, h('div', { class: 'st' }, 'آنلاین')))
      : h('div', { class: 'profile-top' }, h('div', { class: 'pt-av', onclick: () => { if (me2.avatar) { expanded = true; paint(); } else App.settingsPage('profile'); } }, userAvatar(me2, 's120')),
        name, h('div', { class: 'st' }, 'آنلاین'));
    const setPhoto = h('div', { class: 'set-row clickable accent set-photo', onclick: (e) => App.setProfilePhoto(e.currentTarget) }, icon('oCamera'), h('div', { class: 'body' }, h('div', { class: 'n' }, me2.avatar ? 'تغییر عکس پروفایل' : 'تنظیم عکس پروفایل')));
    body.replaceChildren(
      top,
      UI.section(null, setPhoto),
      UI.section(null, [
        crow('at', 'blue', me2.username, 'نام کاربری', () => App.settingsPage('profile'), null, 'ltr-n'),
        crow('info', 'slate', me2.bio || 'افزودن بیوگرافی', 'بیوگرافی', () => App.settingsPage('profile'), null, 'multi'),
      ]),
      UI.section(null, [
        crow('bell', 'red', 'اعلان‌ها و صداها', null, () => App.settingsPage('notifications')),
        crow('data', 'green', 'داده و حافظه', null, () => App.settingsPage('data')),
        crow('key', 'slate', 'حریم خصوصی و امنیت', null, () => App.settingsPage('privacy')),
        crow('settings', 'gray', 'تنظیمات عمومی', null, () => App.settingsPage('general')),
        crow('folder', 'blue', 'پوشه‌های گفتگو', null, () => App.settingsPage('folders')),
        crow('heart', 'pink', 'استیکرها و اموجی‌ها', null, () => App.settingsPage('stickers')),
        crow('devices', 'blue', 'دستگاه‌ها', null, () => App.settingsPage('sessions'), devices != null ? fa(devices) : null),
        crow('globe', 'purple', 'زبان', null, () => App.settingsPage('language'), 'فارسی'),
        crow('keyboard', 'orange', 'میانبرهای صفحه‌کلید', null, () => App.settingsPage('shortcuts')),
      ]),
      UI.section(null, [
        crow('phone', 'green', 'تماس‌ها', null, () => App.openCalls()),
        crow('bookmark', 'blue', 'پیام‌های ذخیره‌شده', null, () => App.openSaved()),
        crow('help', 'teal', 'امکانات کبوتر', null, () => App.openByUsername('kabootar')),
      ]),
      h('div', { class: 'settings-foot' }, `کبوتر وب ${App.version()}`));
  };
  paint();
  api('GET', '/api/sessions').then((r) => { devices = r.sessions.length; paint(); }).catch(() => {});
  return { body, paint };
};
App.settingsMoreMenu = (anchor) => UI.menu([
  { icon: 'oEdit', label: 'ویرایش پروفایل', onClick: () => App.settingsPage('profile') },
  { icon: 'oLogout', label: 'خروج از حساب', danger: true, onClick: async () => { if (await UI.ask('خروج', 'از حساب خود خارج می‌شوید؟', 'خروج', true)) App.logout(false); } },
], { anchor });
App.openSettings = (page) => {
  if (App.nav === 'settings' && !App.side.depth) { if (page) App.settingsPage(page); return null; }
  const { body, paint } = App.settingsView();
  const tab = App.side.push({
    title: 'تنظیمات', body, cls: 'settings-tab main-settings',
    actions: [ibtn('more', 'بیشتر', (e) => App.settingsMoreMenu(e.currentTarget))],
    onShow: paint,
  });
  App.settingsTab = tab;
  if (page) App.settingsPage(page);
  return tab;
};
App.settingsDialog = () => App.openSettings();
App.sessionsDialog = () => App.settingsPage('sessions');

App.settingsPage = (page, arg) => {
  const builder = SETTINGS_PAGES[page];
  if (!builder) return;
  const onRoot = App.nav === 'settings' || App.nav === 'profile';
  if (!onRoot && (!App.settingsTab || !App.side.stack.includes(App.settingsTab))) App.openSettings();
  return builder(arg);
};

const push = (title, body, extra = {}) => App.side.push({ title, body, cls: 'settings-tab', ...extra });

const SETTINGS_PAGES = {
  /* ---------- keyboard shortcuts ---------- */
  shortcuts() {
    const k = (keys, what) => h('div', { class: 'set-row static kb-row' }, h('div', { class: 'body' }, h('div', { class: 'n' }, what)), h('span', { class: 'kbd-wrap', dir: 'ltr' }, keys.map((x) => h('kbd', {}, x))));
    push('میانبرهای صفحه‌کلید', [
      UI.section('نوشتن پیام', [k(['Enter'], 'ارسال'), k(['Shift', 'Enter'], 'خط جدید'), k(['↑'], 'ویرایش آخرین پیام'), k(['Ctrl', 'B'], 'پررنگ'), k(['Ctrl', 'I'], 'کج'), k(['Ctrl', 'K'], 'افزودن لینک'), k(['Esc'], 'لغو پاسخ یا ویرایش')]),
      UI.section('عمومی', [k(['Esc'], 'بستن پنجره یا منو'), k(['Ctrl', 'F'], 'جستجو در گفتگو')]),
    ]);
  },

  /* ---------- edit profile ---------- */
  profile() {
    const me = S.me;
    const name = UI.field('نام', { value: me.display_name, maxlength: 64 });
    const bio = UI.field('بیوگرافی (اختیاری)', { multiline: true, rows: 2, value: me.bio || '', maxlength: 170 });
    const counter = h('span', { class: 'counter' }, fa(170 - (me.bio || '').length));
    bio.append(counter);
    bio.input.addEventListener('input', () => (counter.textContent = fa(170 - bio.input.value.length)));
    const uname = UI.field('نام کاربری', { value: me.username, dir: 'ltr', maxlength: 32 });
    let unameOk = true, t;
    uname.input.addEventListener('input', () => {
      clearTimeout(t);
      const v = uname.input.value.trim().replace(/^@/, '');
      if (v.toLowerCase() === me.username.toLowerCase()) { unameOk = true; return uname.setHint('', false); }
      t = setTimeout(async () => {
        try {
          const r = await api('GET', '/api/check-username?username=' + encodeURIComponent(v));
          unameOk = r.valid && r.available;
          uname.setHint(!r.valid ? 'نام کاربری نامعتبر است' : r.available ? `${v} در دسترس است` : 'این نام کاربری گرفته شده', !unameOk);
        } catch {}
      }, 300);
    });
    const bdayInput = h('input', { type: 'date', value: me.birthday && me.birthday.length === 10 ? me.birthday : '', max: new Date().toISOString().slice(0, 10), dir: 'ltr', class: 'bday-input' });
    const bday = h('div', { class: 'field bday' }, bdayInput,
      h('button', { type: 'button', class: 'btn flat', onclick: () => { bdayInput.value = ''; } }, 'حذف تولد'));
    const owned = [...S.chats.values()].filter((x) => x.type === 'channel' && x.can_manage && x.username);
    const chSel = h('select', { class: 'pc-select' }, h('option', { value: '' }, 'هیچ'),
      owned.map((x) => h('option', { value: String(x.id), selected: me.personal_channel?.id === x.id }, x.title)));
    const tab = push('ویرایش پروفایل', [
      avatarEditor({ name: me.display_name, avatar: me.avatar, seed: me.id }, async (id) => { S.me = (await api('PATCH', '/api/me', { avatar: id })).user; },
        { onRemove: async () => { S.me = (await api('PATCH', '/api/me', { avatar: null })).user; } }),
      h('div', { class: 'section' }, name, bio, h('div', { class: 'section-foot' }, 'هر چیزی درباره خودتان: سن، شغل یا شهر. مثلاً «طراح از شیراز».')),
      h('div', { class: 'section' }, h('div', { class: 'section-caption' }, 'تولد'), bday,
        h('div', { class: 'section-foot' }, 'فقط مخاطبین شما تاریخ تولدتان را می‌بینند (از حریم خصوصی قابل تغییر است).')),
      h('div', { class: 'section' }, h('div', { class: 'section-caption' }, 'کانال شخصی'), chSel,
        h('div', { class: 'section-foot' }, 'یک کانال عمومی که مالکش هستید، بالای پروفایلتان نشان داده می‌شود.')),
      h('div', { class: 'section' }, h('div', { class: 'section-caption' }, 'نام کاربری'), uname,
        h('div', { class: 'section-foot' }, 'دیگران می‌توانند با این نام شما را پیدا کنند و بدون دانستن چیز دیگری پیام بدهند. حروف a-z، عدد و _ ، حداقل ۴ حرف.')),
    ], {
      fab: { icon: 'check', title: 'ذخیره', onClick: async () => {
        if (!unameOk) return toast('نام کاربری را درست کنید');
        const body = { display_name: name.input.value.trim(), bio: bio.input.value.trim(), birthday: bdayInput.value || null,
          personal_channel: chSel.value ? Number(chSel.value) : null };
        const un = uname.input.value.trim().replace(/^@/, '');
        if (un !== me.username) body.username = un;
        try { S.me = (await api('PATCH', '/api/me', body)).user; toast('ذخیره شد'); App.side.pop(tab); } catch (e) { toast(e.message); }
      } },
    });
  },

  /* ---------- general ---------- */
  general() {
    const sample = h('div', { class: 'size-preview' }, h('div', { class: 'msg first last' }, h('div', { class: 'bubble' }, h('div', { class: 'text-wrap' }, h('div', { class: 'text' }, 'اندازه‌ی متن پیام‌ها همین‌قدر است 👋')), R.tail())));
    const size = UI.range(12, 20, 1, Number(S.settings.text_size) || 16, (v) => setSetting('text_size', v), (v) => fa(v));
    const accents = h('div', { class: 'accents' }, Object.entries(ACCENTS).map(([k, c]) => {
      const b = h('button', { type: 'button', class: 'accent-dot' + (S.settings.accent === k ? ' on' : '') + (k === 'default' ? ' def' : ''), title: k, onclick: () => {
        setSetting('accent', k);
        $$('.accent-dot', accents).forEach((x) => x.classList.toggle('on', x === b));
      } });
      if (c) b.style.background = c;
      return b;
    }));
    push('تنظیمات عمومی', [
      UI.section('تنظیمات', [h('div', { class: 'set-row static' }, icon('textSize'), h('div', { class: 'body' }, h('div', { class: 'n' }, 'اندازه‌ی متن پیام')), size.el), sample,
        UI.row('image', 'پس‌زمینه گفتگو', null, () => SETTINGS_PAGES.wallpaper())]),
      UI.section('حالت رنگ', UI.radios([['light', 'روز'], ['dark', 'شب'], ['system', 'هماهنگ با سیستم']], S.settings.theme, (v) => setSetting('theme', v))),
      UI.section('رنگ اصلی', accents),
      UI.section('صفحه‌کلید', UI.radios([['enter', 'ارسال با Enter', 'رفتن به خط بعد با Shift+Enter'], ['ctrl', 'ارسال با Ctrl+Enter', 'رفتن به خط بعد با Enter']], S.settings.send_key || 'enter', (v) => setSetting('send_key', v))),
      UI.section('قالب زمان', UI.radios([['24', '۲۴ ساعته'], ['12', '۱۲ ساعته']], S.settings.time_format || '24', (v) => { setSetting('time_format', v); if (S.active) App.renderMessages(); App.renderSidebar(); })),
      UI.section('انیمیشن و پخش خودکار', [
        UI.switchRow(null, 'انیمیشن‌ها', null, S.settings.animations !== false, (v) => setSetting('animations', v)),
        UI.switchRow(null, 'پخش خودکار GIFها', null, S.settings.autoplay_gif !== false, (v) => setSetting('autoplay_gif', v)),
        UI.switchRow(null, 'پخش خودکار ویدیوها', null, S.settings.autoplay_video !== false, (v) => setSetting('autoplay_video', v)),
      ]),
      UI.section('اموجی و استیکر', [
        UI.switchRow(null, 'اموجی بزرگ', 'پیام‌های فقط-اموجی بزرگ‌تر نمایش داده شوند', S.settings.large_emoji !== false, (v) => { setSetting('large_emoji', v); if (S.active) App.renderMessages(); }),
        UI.switchRow(null, 'پیشنهاد استیکر با اموجی', null, S.settings.suggest_stickers !== false, (v) => setSetting('suggest_stickers', v)),
      ]),
    ]);
  },

  /* ---------- chat wallpaper ---------- */
  wallpaper() {
    const grid = h('div', { class: 'wp-grid' });
    const cur = () => JSON.stringify(S.settings.background || null);
    const set = (bg) => { setSetting('background', bg); paint(); };
    const tileFor = (bg, label) => {
      const t = Wallpaper.preview(bg);
      t.classList.toggle('on', JSON.stringify(bg) === cur());
      t.addEventListener('click', () => set(bg));
      if (label) t.title = label;
      return t;
    };
    const paint = () => {
      grid.replaceChildren(
        h('div', { class: 'wp-tile upload', onclick: async () => {
          const f = await pickImage();
          if (!f) return;
          toast('در حال آپلود…');
          try { const up = await uploadFile(f, 'wallpaper.jpg'); set({ type: 'image', url: up.url, blur: false }); } catch (e) { toast(e.message); }
        } }, icon('camera'), h('span', {}, 'عکس خودم')),
        ...Wallpaper.GRADIENTS.map((colors) => tileFor({ type: 'gradient', colors, pattern: true })),
        ...Wallpaper.GRADIENTS.slice(0, 4).map((colors) => tileFor({ type: 'gradient', colors, pattern: false })),
        ...Wallpaper.COLORS.map((color) => tileFor({ type: 'color', color })));
    };
    paint();
    const bg = S.settings.background;
    push('پس‌زمینه گفتگو', [
      UI.section(null, [
        UI.row('undo', 'بازگشت به پیش‌فرض', null, () => set(null)),
        bg?.type === 'image' ? UI.switchRow('image', 'تار کردن عکس', null, !!bg.blur, (v) => setSetting('background', { ...S.settings.background, blur: v })) : null,
      ]),
      grid,
    ]);
  },

  /* ---------- notifications ---------- */
  notifications() {
    const ok = 'Notification' in window;
    push('اعلان‌ها و صداها', [
      Native.ok ? null : UI.section('اعلان‌های وب', [
        ok ? UI.switchRow('bell', 'اعلان دسکتاپ', Notification.permission === 'denied' ? 'در تنظیمات مرورگر مسدود شده' : 'وقتی کبوتر باز نیست', S.settings.notify && Notification.permission === 'granted', async (v) => {
          if (v && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission();
            if (p !== 'granted') throw new Error('اجازه اعلان داده نشد');
          }
          setSetting('notify', v);
        }) : UI.row('bell', 'مرورگر شما اعلان را پشتیبانی نمی‌کند'),
        UI.switchRow('eye', 'پیش‌نمایش پیام', 'متن پیام در اعلان دیده شود', S.settings.notify_preview !== false, (v) => setSetting('notify_preview', v)),
        UI.switchRow('volume', 'صداهای داخل برنامه', 'صدای پیام تازه در گفتگوهای دیگر', S.settings.sound !== false, (v) => { setSetting('sound', v); if (v) Sound.play('notify', true); }),
        UI.switchRow('music', 'صداهای داخل گفتگو', 'صدای ارسال و دریافت پیام، ضبط صدا', S.settings.chat_sounds !== false, (v) => { setSetting('chat_sounds', v); if (v) Sound.play('out', true); }),
      ]),
      Native.ok ? UI.section('اعلان‌های برنامه', [
        UI.switchRow('bell', 'اعلان پیام‌ها', Native.has('notifications') ? 'وقتی کبوتر بسته است هم می‌آید' : 'اجازه‌ی اعلان داده نشده، بزنید', S.settings.app_notify !== false && Native.has('notifications'), (v) => {
          if (v && !Native.has('notifications')) { Native.openNotifySettings(); throw new Error('اول اجازه‌ی اعلان را بدهید'); }
          setSetting('app_notify', v);
        }),
        UI.switchRow('network', 'اتصال پس‌زمینه', 'برای رسیدن پیام‌ها وقتی برنامه بسته است، مثل تلگرام بدون سرویس گوگل', S.settings.bg_service !== false, (v) => setSetting('bg_service', v)),
        Native.batteryOk() ? null : UI.row('timer', 'بهینه‌سازی باتری', 'خاموشش کنید تا اعلان‌ها دیر نرسند', () => Native.openBattery()),
        UI.row('settings', 'تنظیمات اعلان سیستم', 'صدا، لرزش و نمایش روی صفحه‌ی قفل', () => Native.openNotifySettings()),
      ].filter(Boolean)) : null,
      UI.section('اعلان گفتگوها', [
        UI.switchRow('user', 'گفتگوهای خصوصی', null, S.settings.notify_private !== false, (v) => setSetting('notify_private', v)),
        UI.switchRow('group', 'گروه‌ها', null, S.settings.notify_group !== false, (v) => setSetting('notify_group', v)),
        UI.switchRow('channel', 'کانال‌ها', null, S.settings.notify_channel !== false, (v) => setSetting('notify_channel', v)),
      ]),
    ]);
  },

  /* ---------- data & storage ---------- */
  data() {
    const ad = { photo: true, video: true, file: true, ...(S.settings.auto_download || {}) };
    const setAd = (k, v) => { ad[k] = v; setSetting('auto_download', { ...ad }); };
    const drafts = Object.keys(S.drafts).length;
    push('داده و حافظه', [
      UI.section('دانلود خودکار رسانه', [
        UI.switchRow('image', 'عکس‌ها', null, ad.photo, (v) => setAd('photo', v)),
        UI.switchRow('video', 'ویدیوها', null, ad.video, (v) => setAd('video', v)),
        UI.switchRow('file', 'فایل‌ها', null, ad.file, (v) => setAd('file', v)),
      ]),
      UI.section('پخش خودکار', [
        UI.switchRow('gif', 'GIFها', null, S.settings.autoplay_gif !== false, (v) => setSetting('autoplay_gif', v)),
        UI.switchRow('video', 'ویدیوها', null, S.settings.autoplay_video !== false, (v) => setSetting('autoplay_video', v)),
      ]),
      UI.section('حافظه‌ی این دستگاه', [
        UI.row('trash', 'پاک کردن پیش‌نویس‌ها', drafts ? `${fa(drafts)} پیش‌نویس` : 'پیش‌نویسی نیست', async () => {
          if (!(await UI.ask('پاک کردن پیش‌نویس‌ها', 'همه‌ی پیش‌نویس‌های این دستگاه پاک شوند؟', 'پاک کن', true))) return;
          S.drafts = {}; save('drafts', {}); App.renderSidebar(); toast('پاک شد');
        }),
        UI.row('clock', 'پاک کردن اموجی‌ها و استیکرهای اخیر', null, () => { S.recentEmoji = []; save('recentEmoji', []); setSetting('stickers_recent', []); toast('پاک شد'); }),
      ]),
    ]);
  },

  /* ---------- privacy & security ---------- */
  async privacy() {
    const body = h('div');
    const tab = push('حریم خصوصی و امنیت', body, { onShow: () => paint() });
    let sessions = [], blocked = [], twofa = { enabled: !!S.me.twofa };
    const paint = () => {
      const p = S.me.privacy || {};
      const rule = (k, ic, label) => UI.row(ic, label, PRIVACY_LABELS[p[k] || 'everybody'], () => SETTINGS_PAGES.privacyRule(k, label));
      body.replaceChildren(
        UI.section('امنیت', [
          UI.row('key', 'تأیید دومرحله‌ای', twofa.enabled ? 'روشن' : 'خاموش', () => SETTINGS_PAGES.twofa()),
          UI.row('lock', 'کد قفل', Lock.enabled() ? 'روشن' : 'خاموش', () => SETTINGS_PAGES.passcode()),
          UI.row('devices', 'نشست‌های فعال', sessions.length ? fa(sessions.length) + ' دستگاه' : null, () => SETTINGS_PAGES.sessions()),
          UI.row('block', 'کاربران مسدود', blocked.length ? fa(blocked.length) + ' کاربر' : 'هیچ', () => SETTINGS_PAGES.blocked()),
        ]),
        UI.section('حریم خصوصی', [
          rule('last_seen', 'clock', 'آخرین بازدید و آنلاین'),
          rule('photo', 'camera', 'عکس پروفایل'),
          rule('bio', 'info', 'بیوگرافی'),
          rule('forwards', 'forward', 'پیام‌های بازارسال‌شده'),
          rule('calls', 'phone', 'تماس‌ها'),
          rule('groups', 'group', 'گروه‌ها و کانال‌ها'),
          rule('birthday', 'heart', 'تاریخ تولد'),
        ], 'تعیین کنید چه کسانی بتوانند این اطلاعات را ببینند یا شما را به گروه‌ها اضافه کنند. کاربران مسدود هیچ‌کدام را نمی‌بینند.'));
    };
    paint();
    try {
      [sessions, blocked, twofa] = await Promise.all([api('GET', '/api/sessions').then((r) => r.sessions), api('GET', '/api/blocked').then((r) => r.users), api('GET', '/api/me/2fa')]);
      paint();
    } catch {}
    return tab;
  },
  privacyRule(key, label) {
    const p = S.me.privacy || {};
    const hints = {
      last_seen: 'اگر آخرین بازدیدتان را پنهان کنید، دیگران «به تازگی» می‌بینند.',
      photo: 'کسانی که اجازه ندارند، عکس پروفایل شما را نمی‌بینند.',
      forwards: 'وقتی کسی پیام شما را بازارسال کند، اسم شما به پروفایلتان لینک نمی‌شود.',
      calls: 'چه کسانی می‌توانند با شما تماس بگیرند.',
      groups: 'چه کسانی می‌توانند شما را به گروه‌ها و کانال‌ها اضافه کنند.',
      bio: 'چه کسانی بیوگرافی شما را ببینند.',
      birthday: 'چه کسانی تاریخ تولد شما را ببینند.',
    };
    push(label, [UI.section(label, UI.radios([['everybody', 'همه'], ['contacts', 'مخاطبین من'], ['nobody', 'هیچ‌کس']], p[key] || 'everybody', async (v) => {
      try { const r = await api('PATCH', '/api/me/privacy', { [key]: v }); S.me = { ...S.me, privacy: r.privacy }; } catch (e) { toast(e.message); }
    }), hints[key])]);
  },

  /* ---------- two-step verification ---------- */
  async twofa() {
    const body = h('div');
    const tab = push('تأیید دومرحله‌ای', body);
    let st = { enabled: false, hint: '' };
    try { st = await api('GET', '/api/me/2fa'); } catch (e) { toast(e.message); }
    const ill = h('div', { class: 'illus' }, icon('key'));
    if (!st.enabled) {
      body.replaceChildren(ill, h('p', { class: 'illus-text' }, 'می‌توانید یک رمز اضافه بگذارید که هنگام ورود از دستگاه جدید، علاوه بر رمز حساب، پرسیده شود.'),
        h('div', { class: 'pad' }, h('button', { class: 'btn block', onclick: () => SETTINGS_PAGES.twofaSet(null, tab) }, 'تنظیم رمز اضافه')));
    } else {
      body.replaceChildren(ill, h('p', { class: 'illus-text' }, 'تأیید دومرحله‌ای فعال است. برای ورود از دستگاه جدید، این رمز لازم است.' + (st.hint ? `\nراهنما: ${st.hint}` : '')),
        UI.section(null, [
          UI.row('key', 'تغییر رمز', null, async () => { const cur = await UI.prompt('رمز فعلی', 'رمز فعلی تأیید دومرحله‌ای', '', { type: 'password', dir: 'ltr' }); if (cur) SETTINGS_PAGES.twofaSet(cur, tab); }),
          UI.row('close', 'خاموش کردن تأیید دومرحله‌ای', null, async () => {
            const cur = await UI.prompt('خاموش کردن', 'رمز فعلی تأیید دومرحله‌ای', '', { type: 'password', dir: 'ltr' });
            if (!cur) return;
            try { await api('POST', '/api/me/2fa', { current_password: cur, new_password: '' }); S.me.twofa = false; toast('خاموش شد'); App.side.pop(tab); } catch (e) { toast(e.message); }
          }, 'danger'),
        ]));
    }
  },
  twofaSet(current, parentTab) {
    const p1 = UI.field('رمز', { type: 'password', dir: 'ltr', autocomplete: 'new-password' });
    const p2 = UI.field('تکرار رمز', { type: 'password', dir: 'ltr', autocomplete: 'new-password' });
    const hint = UI.field('راهنما (اختیاری)', { maxlength: 64 }, 'یک سرنخ که فقط خودتان بفهمید');
    const tab = push('رمز جدید', [h('div', { class: 'illus' }, icon('lock')), h('div', { class: 'section' }, p1, p2, hint)], {
      fab: { icon: 'check', title: 'ذخیره', onClick: async () => {
        if (!p1.input.value) return toast('رمز را بنویسید');
        if (p1.input.value !== p2.input.value) { p2.classList.add('error'); return toast('رمزها یکی نیستند'); }
        try {
          await api('POST', '/api/me/2fa', { current_password: current || undefined, new_password: p1.input.value, hint: hint.input.value.trim() });
          S.me.twofa = true;
          toast('تأیید دومرحله‌ای فعال شد');
          App.side.pop(parentTab);
        } catch (e) { toast(e.message); }
      } },
    });
    setTimeout(() => p1.input.focus(), 60);
    return tab;
  },

  /* ---------- local passcode lock ---------- */
  passcode() {
    const body = h('div');
    const tab = push('کد قفل', body, { onShow: () => paint() });
    const paint = () => {
      const ill = h('div', { class: 'illus' }, icon('lock'));
      if (!Lock.enabled()) {
        body.replaceChildren(ill, h('p', { class: 'illus-text' }, 'با کد قفل، کبوتر روی این دستگاه قفل می‌شود و تا وارد کردن کد، پیام‌ها دیده نمی‌شوند. نشست ورود هم با این کد رمزگذاری می‌شود.'),
          h('div', { class: 'pad' }, h('button', { class: 'btn block', onclick: () => SETTINGS_PAGES.passcodeSet(paint) }, 'فعال کردن کد قفل')));
        return;
      }
      body.replaceChildren(ill,
        UI.section(null, [
          UI.row('key', 'تغییر کد قفل', null, () => SETTINGS_PAGES.passcodeSet(paint)),
          UI.row('lock', 'همین حالا قفل کن', null, () => Lock.lockNow()),
        ]),
        UI.section('قفل خودکار', UI.radios([[0, 'غیرفعال'], [1, 'بعد از ۱ دقیقه'], [5, 'بعد از ۵ دقیقه'], [60, 'بعد از ۱ ساعت'], [300, 'بعد از ۵ ساعت']], Lock.autolock(), (v) => Lock.setAutolock(Number(v))),
          'اگر مدتی با کبوتر کار نکنید، خودکار قفل می‌شود.'),
        UI.section(null, UI.row('close', 'خاموش کردن کد قفل', null, async () => {
          if (!(await UI.ask('خاموش کردن کد قفل', 'کد قفل این دستگاه برداشته شود؟', 'خاموش کن', true))) return;
          await Lock.disable();
          paint();
          el.lockBtn.hidden = true;
        }, 'danger')));
    };
    paint();
  },
  passcodeSet(done) {
    if (!Lock.supported()) return toast('برای کد قفل اتصال امن (HTTPS) لازم است');
    const p1 = UI.field('کد قفل', { type: 'password', dir: 'ltr', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 32 });
    const p2 = UI.field('تکرار کد', { type: 'password', dir: 'ltr', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 32 });
    const tab = push('کد قفل جدید', [h('div', { class: 'illus' }, icon('lock')), h('div', { class: 'section' }, p1, p2, h('div', { class: 'section-foot' }, 'حداقل ۴ کاراکتر. اگر کد را فراموش کنید باید دوباره وارد حساب شوید.'))], {
      fab: { icon: 'check', title: 'ذخیره', onClick: async () => {
        const v = p1.input.value;
        if (v.length < 4) return toast('حداقل ۴ کاراکتر');
        if (v !== p2.input.value) { p2.classList.add('error'); return toast('کدها یکی نیستند'); }
        try { await Lock.set(v); toast('کد قفل فعال شد'); el.lockBtn.hidden = false; App.side.pop(tab); done && done(); } catch (e) { toast(e.message); }
      } },
    });
    setTimeout(() => p1.input.focus(), 60);
  },

  /* ---------- sessions (Telegram Android "Devices") ---------- */
  async sessions() {
    const body = h('div', { class: 'devices' });
    const tab = push('دستگاه‌ها', body);
    const PLAT = { android: ['pAndroid', '#5fbe67'], ios: ['pApple', '#8a94a3'], mac: ['pApple', '#8a94a3'], windows: ['pWindows', '#3d9cf5'], linux: ['devices', '#f5a524'], web: ['globe', '#4fa9f1'], api: ['bot', '#8e6cf1'] };
    const devIcon = (s, big) => { const [ic, bg] = PLAT[s.platform] || PLAT.web; return h('span', { class: 'dev-ic' + (big ? ' big' : ''), style: { background: bg } }, icon(ic)); };
    const when = (s) => (s.current ? 'آنلاین' : Date.now() - s.last_active < 120000 ? 'آنلاین' : fmtListTime(s.last_active));
    const reload = async () => paint((await api('GET', '/api/sessions')).sessions);
    const kill = async (s) => {
      if (!(await UI.ask('خاتمه‌ی نشست', `از «${s.model || s.device}» خارج شوید؟`, 'خاتمه', true))) return false;
      try { await api('DELETE', `/api/sessions/${s.id}`); toast('نشست خاتمه یافت'); await reload(); return true; } catch (e) { toast(e.message); return false; }
    };
    const details = (s) => {
      const rows = h('div', { class: 'dev-rows' },
        h('div', { class: 'dr' }, h('span', {}, 'برنامه'), h('b', { dir: 'ltr' }, s.app || 'Kabootar')),
        s.os ? h('div', { class: 'dr' }, h('span', {}, 'سیستم‌عامل'), h('b', { dir: 'ltr' }, s.os)) : null,
        h('div', { class: 'dr' }, h('span', {}, 'آی‌پی'), h('b', { dir: 'ltr' }, s.ip || '—')),
        h('div', { class: 'dr' }, h('span', {}, 'ورود'), h('b', {}, `${fmtDay(s.created_at)} ${fmtTime(s.created_at)}`)),
        h('div', { class: 'dr' }, h('span', {}, 'آخرین فعالیت'), h('b', {}, s.current ? 'آنلاین' : `${fmtDay(s.last_active)} ${fmtTime(s.last_active)}`)));
      const m = UI.modal({
        noHead: true, cls: 'dev-sheet',
        body: [h('div', { class: 'dev-top' }, devIcon(s, true), h('div', { class: 't', dir: 'ltr' }, s.model || s.device), h('div', { class: 'st' }, when(s))), rows],
        foot: s.current ? [h('button', { class: 'btn flat', onclick: () => m.close() }, 'بستن')]
          : [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), h('button', { class: 'btn flat danger', onclick: async () => { if (await kill(s)) m.close(); } }, 'خاتمه‌ی نشست')],
      });
    };
    const row = (s) => h('div', { class: 'dev-row', onclick: () => details(s) }, devIcon(s),
      h('div', { class: 'body' },
        h('div', { class: 'n', dir: 'ltr' }, s.model || s.device),
        h('div', { class: 's', dir: 'ltr' }, s.app || ''),
        h('div', { class: 's' }, h('span', { dir: 'ltr' }, s.ip || '—'), ' · ', h('span', { class: when(s) === 'آنلاین' ? 'on' : '' }, when(s)))));
    const paint = (items) => {
      const cur = items.find((s) => s.current);
      const others = items.filter((s) => !s.current);
      body.replaceChildren(
        h('div', { class: 'dev-hero' }, h('div', { class: 'dh-ic' }, icon('devices')),
          h('p', {}, 'با یک حساب کبوتر می‌توانید هم‌زمان روی گوشی، تبلت و مرورگر وارد شوید و همه‌جا پیام‌هایتان یکی باشد.')),
        UI.section('این دستگاه', [cur ? row(cur) : null,
          others.length ? h('div', { class: 'set-row clickable danger dev-kill', onclick: async () => {
            if (!(await UI.ask('خاتمه‌ی همه‌ی نشست‌های دیگر', 'از همه‌ی دستگاه‌ها به‌جز این یکی خارج می‌شوید.', 'خاتمه', true))) return;
            try { await api('POST', '/api/sessions/terminate-others'); await reload(); toast('همه‌ی نشست‌های دیگر خاتمه یافتند'); } catch (e) { toast(e.message); }
          } }, icon('hand'), h('div', { class: 'body' }, h('div', { class: 'n' }, 'خاتمه‌ی همه‌ی نشست‌های دیگر'))) : null],
          others.length ? 'از همه‌ی دستگاه‌ها به‌جز همین یکی خارج شوید.' : null),
        others.length ? UI.section('نشست‌های فعال', others.map(row), 'روی هر نشست بزنید تا جزئیات آن را ببینید یا خاتمه‌اش دهید.') : null);
    };
    try { await reload(); } catch (e) { toast(e.message); }
    return tab;
  },

  /* ---------- blocked users ---------- */
  async blocked() {
    const list = h('div', { class: 'list' });
    const load = async () => {
      try {
        const { users } = await api('GET', '/api/blocked');
        list.replaceChildren(...(users.length ? users.map((u) => {
          const row = App.personRow(u, (e) => UI.menu([{ icon: 'block', label: 'رفع مسدودی', onClick: async () => { await App.toggleBlock(u); load(); } }], { x: e.clientX, y: e.clientY }), '@' + u.username);
          return row;
        }) : [h('div', { class: 'empty-hint' }, 'کسی را مسدود نکرده‌اید')]));
      } catch (e) { toast(e.message); }
    };
    push('کاربران مسدود', [h('div', { class: 'section-foot top' }, 'کاربران مسدود نمی‌توانند به شما پیام بدهند، تماس بگیرند یا شما را به گروه اضافه کنند.'), list], {
      fab: { icon: 'plus', title: 'مسدود کردن', onClick: () => {
        const picker = userPicker({ multiple: false, onPick: async (u) => { m.close(); await App.toggleBlock({ ...u, blocked: false }); load(); } });
        const m = UI.modal({ title: 'مسدود کردن کاربر', body: picker.el, wide: true });
      } },
    });
    load();
  },

  /* ---------- chat folders ---------- */
  folders() {
    const body = h('div');
    const tab = push('پوشه‌های گفتگو', body, { onShow: () => paint() });
    const paint = () => {
      const list = App.folders();
      const missing = DEFAULT_FOLDERS.filter((d) => !list.some((f) => f.id === d.id));
      body.replaceChildren(
        h('div', { class: 'illus' }, icon('folder')),
        h('p', { class: 'illus-text' }, 'برای گروه‌ها، کانال‌ها و گفتگوهای مختلف پوشه بسازید و سریع بین آن‌ها جابه‌جا شوید.'),
        h('div', { class: 'pad' }, h('button', { class: 'btn block', onclick: () => SETTINGS_PAGES.folderEdit(null, paint) }, icon('plus'), 'ساخت پوشه‌ی جدید')),
        UI.section('پوشه‌ها', list.length ? list.map((f) => {
          const count = App.sortedChats(false).filter((c) => App.folderMatch(f, c)).length;
          const r = UI.row('folder', (f.emoji ? f.emoji + ' ' : '') + f.title, `${fa(count)} گفتگو`, () => SETTINGS_PAGES.folderEdit(f, paint));
          r.addEventListener('contextmenu', (e) => { e.preventDefault(); UI.menu([{ icon: 'trash', label: 'حذف پوشه', danger: true, onClick: () => { setSetting('folders', App.folders().filter((x) => x.id !== f.id)); paint(); App.renderSidebar(); } }], { x: e.clientX, y: e.clientY }); });
          return r;
        }) : h('div', { class: 'info-empty' }, 'پوشه‌ای ندارید')),
        missing.length ? UI.section('پیشنهادی', missing.map((d) => UI.row('addCircle', d.title, null, () => { setSetting('folders', [...App.folders(), d]); paint(); App.renderSidebar(); }))) : null,
        UI.section(null, UI.row('undo', 'بازگشت به پوشه‌های پیش‌فرض', null, () => { setSetting('folders', null); paint(); App.renderSidebar(); })));
    };
    paint();
  },
  folderEdit(folder, done) {
    const f = folder ? JSON.parse(JSON.stringify(folder)) : { id: 'f' + Date.now().toString(36), title: '', types: [], include: [], exclude: [] };
    const name = UI.field('نام پوشه', { value: f.title, maxlength: 24 });
    const emoji = UI.field('اموجی (اختیاری)', { value: f.emoji || '', maxlength: 4 });
    const types = [['contacts', 'مخاطبین', 'user'], ['non_contacts', 'غیرمخاطبین', 'personAdd'], ['groups', 'گروه‌ها', 'group'], ['channels', 'کانال‌ها', 'channel']];
    const chatsBox = (key) => {
      const box = h('div');
      const paint = () => box.replaceChildren(...(f[key] || []).map((id) => S.chats.get(id)).filter(Boolean).map((c) => h('div', { class: 'pick' }, chatAvatar(c, 's42'),
        h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, chatTitle(c))), ibtn('close', 'حذف', () => { f[key] = f[key].filter((x) => x !== c.id); paint(); }))));
      paint();
      const add = UI.row('plus', key === 'include' ? 'افزودن گفتگو' : 'حذف گفتگو', null, () => {
        const input = h('input', { type: 'search', placeholder: 'جستجو…' });
        const list = h('div', { class: 'picker-list' });
        const draw = () => {
          const q = input.value.trim().toLowerCase();
          list.replaceChildren(...App.sortedChats(false).filter((c) => !q || chatTitle(c).toLowerCase().includes(q)).map((c) => {
            const on = (f[key] || []).includes(c.id);
            return h('div', { class: 'pick' + (on ? ' sel' : ''), onclick: () => {
              f[key] = on ? f[key].filter((x) => x !== c.id) : [...(f[key] || []), c.id];
              const other = key === 'include' ? 'exclude' : 'include';
              f[other] = (f[other] || []).filter((x) => x !== c.id);
              draw();
            } }, h('span', { class: 'checkbox round' + (on ? ' on' : '') }, icon('check')), chatAvatar(c, 's42'), h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, chatTitle(c))));
          }));
        };
        input.addEventListener('input', draw);
        draw();
        const m = UI.modal({ title: key === 'include' ? 'گفتگوهای شامل' : 'گفتگوهای مستثنی', body: [h('div', { class: 'tab-search' }, icon('search'), input), list], wide: true,
          foot: [h('button', { class: 'btn flat', onclick: () => { m.close(); paint(); } }, 'تأیید')] });
      }, 'accent');
      return [add, box];
    };
    const tab = push(folder ? 'ویرایش پوشه' : 'پوشه‌ی جدید', [
      h('div', { class: 'section' }, name, emoji),
      UI.section('گفتگوهای شامل', [...types.map(([k, label]) => UI.checkRow(label, (f.types || []).includes(k), (v) => { f.types = v ? [...new Set([...(f.types || []), k])] : (f.types || []).filter((x) => x !== k); })), ...chatsBox('include')]),
      UI.section('مستثنی کردن', [
        UI.checkRow('بی‌صداها', !!f.no_muted, (v) => (f.no_muted = v)),
        UI.checkRow('خوانده‌شده‌ها', !!f.no_read, (v) => (f.no_read = v)),
        ...chatsBox('exclude'),
      ]),
      folder ? UI.section(null, UI.row('trash', 'حذف پوشه', null, () => { setSetting('folders', App.folders().filter((x) => x.id !== f.id)); App.renderSidebar(); App.side.pop(tab); done && done(); }, 'danger')) : null,
    ], {
      fab: { icon: 'check', title: 'ذخیره', onClick: () => {
        f.title = name.input.value.trim();
        f.emoji = emoji.input.value.trim() || undefined;
        if (!f.title) return toast('یک نام بنویسید');
        if (!(f.types || []).length && !(f.include || []).length) return toast('حداقل یک نوع گفتگو یا یک گفتگو انتخاب کنید');
        const list = App.folders().slice();
        const i = list.findIndex((x) => x.id === f.id);
        if (i >= 0) list[i] = f; else list.push(f);
        setSetting('folders', list);
        App.renderSidebar();
        App.side.pop(tab);
        done && done();
      } },
    });
  },

  /* ---------- stickers & emoji ---------- */
  async stickers() {
    const body = h('div');
    const tab = push('استیکرها و اموجی‌ها', body, { onShow: () => paint() });
    const paint = async () => {
      const packs = await App.loadStickers(true);
      body.replaceChildren(
        UI.section(null, [
          UI.switchRow(null, 'پیشنهاد استیکر با اموجی', null, S.settings.suggest_stickers !== false, (v) => setSetting('suggest_stickers', v)),
          UI.switchRow(null, 'اموجی بزرگ', null, S.settings.large_emoji !== false, (v) => setSetting('large_emoji', v)),
        ]),
        UI.section(null, [
          UI.row('search', 'پیدا کردن بسته‌های استیکر', null, () => App.stickerSearchDialog()),
          UI.row('plus', 'ساخت بسته‌ی استیکر', null, () => App.createPackDialog()),
        ]),
        UI.section('بسته‌های من', packs.length ? packs.map((p) => {
          const r = h('div', { class: 'pick pack-row', onclick: () => App.stickerPackDialog(p.id) },
            p.thumb ? h('img', { class: 'pack-thumb', src: p.thumb, alt: '' }) : h('span', { class: 'pack-thumb' }),
            h('div', { class: 'body' }, h('div', { class: 'n' }, p.title), h('div', { class: 's' }, `${fa(p.count)} استیکر`)),
            ibtn('more', 'بیشتر', (e) => { e.stopPropagation(); UI.menu([
              { icon: 'link', label: 'کپی لینک', onClick: () => copyText(`${location.origin}/#/addstickers/${p.short_name}`, 'لینک کپی شد') },
              p.mine ? { icon: 'plus', label: 'افزودن استیکر', onClick: () => App.addStickerToPack(p) } : null,
              { icon: 'trash', label: 'حذف از فهرست', danger: true, onClick: async () => { await api('DELETE', `/api/stickers/packs/${p.id}/install`).catch((er) => toast(er.message)); paint(); } },
            ], { anchor: e.currentTarget, alignStart: true }); }));
          return r;
        }) : h('div', { class: 'info-empty' }, 'بسته‌ای نصب نیست')));
    };
    paint();
  },

  language() {
    push('زبان', [UI.section('زبان رابط کاربری', UI.radios([['fa', 'فارسی', 'Persian']], 'fa', () => {}), 'رابط کاربری کبوتر فعلاً فقط فارسی و راست‌به‌چپ است.')]);
  },
};
