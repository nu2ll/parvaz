'use strict';
/* Kabootar web client — panels: new chat flows, contacts, calls, dialogs, info column (Web K right sidebar). */

/* ---------- user picker (search + multi-select chips) ---------- */
function userPicker({ multiple = true, onPick, onChange, exclude = new Set() } = {}) {
  const selected = new Map();
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'search', placeholder: multiple ? 'افزودن افراد…' : 'جستجوی نام یا @نام‌کاربری', autocomplete: 'off' });
  const field = h('div', { class: 'picker-input' }, chips, input);
  const results = h('div', { class: 'picker-list' });
  const paintChips = () => {
    chips.replaceChildren(...[...selected.values()].map((u) => h('span', { class: 'chip' }, userAvatar(u), h('span', { dir: 'auto' }, userName(u)),
      h('button', { type: 'button', onclick: () => { selected.delete(u.id); paintChips(); paint(lastList); onChange && onChange(selected); } }, icon('close')))));
  };
  let lastList = [];
  const paint = (users) => {
    lastList = users.filter((u) => !exclude.has(u.id));
    results.replaceChildren(...(lastList.length ? lastList.map((u) => {
      const row = h('div', { class: 'pick' + (selected.has(u.id) ? ' sel' : ''), onclick: () => {
        if (!multiple) return onPick && onPick(u);
        selected.has(u.id) ? selected.delete(u.id) : selected.set(u.id, u);
        paintChips(); paint(lastList); onChange && onChange(selected);
        input.value = ''; input.focus();
      } }, multiple ? h('span', { class: 'checkbox round' + (selected.has(u.id) ? ' on' : '') }, icon('check')) : null, userAvatar(u, 's42'),
      h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, userName(u)), h('div', { class: 's' + (u.online ? ' accent' : ''), dir: 'auto' }, lastSeenText(u))));
      return row;
    }) : [h('div', { class: 'info-empty' }, input.value.trim() ? 'کسی پیدا نشد' : 'نام کسی را جستجو کنید')]));
  };
  // suggestions: contacts + people you already chat with
  const suggestions = () => {
    const map = new Map();
    for (const u of S.contacts || []) map.set(u.id, u);
    for (const c of [...S.chats.values()].filter((c) => c.type === 'private' && !isSaved(c)).sort((a, b) => activity(b) - activity(a))) if (!map.has(c.peer.id)) map.set(c.peer.id, c.peer);
    return [...map.values()];
  };
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) return paint(suggestions());
    t = setTimeout(async () => {
      try { const r = await api('GET', '/api/search?q=' + encodeURIComponent(q)); if (input.value.trim() === q) paint(r.users); } catch (e) { toast(e.message); }
    }, 220);
  });
  App.loadContacts().then(() => { if (!input.value.trim()) paint(suggestions()); });
  paint(suggestions());
  return { el: h('div', { class: 'picker' }, field, results), selected, input };
}

App.loadContacts = async (force) => {
  if (S.contacts && !force) return S.contacts;
  try { S.contacts = (await api('GET', '/api/contacts')).contacts; } catch { S.contacts = S.contacts || []; }
  return S.contacts;
};

/* ---------- new private chat / contacts (sidebar tabs) ---------- */
App.newPrivateDialog = () => {
  const picker = userPicker({ multiple: false, onPick: (u) => { App.side.pop(tab); App.openPrivateWith(u.username); } });
  const tab = App.side.push({ title: 'گفتگوی خصوصی جدید', body: picker.el });
  setTimeout(() => picker.input.focus(), 50);
};

App.openContacts = async () => {
  const input = h('input', { type: 'search', placeholder: 'جستجوی مخاطبین', autocomplete: 'off' });
  const list = h('div', { class: 'list' });
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const items = (S.contacts || []).filter((u) => !q || userName(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
      .sort((a, b) => (b.online - a.online) || (b.last_seen || 0) - (a.last_seen || 0));
    list.replaceChildren(...(items.length ? items.map((u) => {
      const row = App.personRow(u, () => { App.side.pop(tab); App.openPrivateWith(u.username); }, lastSeenText(u));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); UI.menu([
        { icon: 'edit', label: 'ویرایش مخاطب', onClick: () => App.contactDialog(u) },
        { icon: 'trash', label: 'حذف مخاطب', danger: true, onClick: () => App.removeContact(u).then(paint) },
      ], { x: e.clientX, y: e.clientY }); });
      return row;
    }) : [h('div', { class: 'empty-hint' }, S.contacts?.length ? 'کسی پیدا نشد' : 'هنوز مخاطبی ندارید.\nبا دکمه + کسی را با نام کاربری اضافه کنید.')]));
  };
  input.addEventListener('input', paint);
  const tab = App.side.push({
    title: 'مخاطبین', body: [h('div', { class: 'tab-search' }, icon('search'), input), list],
    fab: { icon: 'personAdd', title: 'افزودن مخاطب', onClick: () => App.contactDialog(null, () => paint()) },
  });
  paint();
  await App.loadContacts(true);
  paint();
};

App.contactDialog = (u, done) => {
  const uname = u ? null : UI.field('نام کاربری', { dir: 'ltr', placeholder: '@username' });
  const name = UI.field('نام مخاطب', { value: u ? userName(u) : '', maxlength: 64 });
  const ok = h('button', { class: 'btn flat' }, u?.is_contact ? 'ذخیره' : 'افزودن');
  const m = UI.modal({
    title: u?.is_contact ? 'ویرایش مخاطب' : 'افزودن مخاطب',
    body: [u ? h('div', { class: 'contact-head' }, userAvatar(u, 's64'), h('div', {}, h('b', { dir: 'auto' }, u.display_name), h('div', { class: 's' }, '@' + u.username))) : null, uname, name],
    foot: [
      u?.is_contact ? h('button', { class: 'btn flat danger', onclick: async () => { m.close(); await App.removeContact(u); done && done(); } }, 'حذف مخاطب') : null,
      h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), ok],
  });
  ok.addEventListener('click', async () => {
    try {
      const body = u ? { user_id: u.id, name: name.input.value.trim() } : { username: uname.input.value.trim().replace(/^@/, ''), name: name.input.value.trim() };
      const r = await api('POST', '/api/contacts', body);
      S.contacts = [...(S.contacts || []).filter((x) => x.id !== r.user.id), r.user];
      m.close();
      toast('مخاطب ذخیره شد');
      done && done(r.user);
    } catch (e) { toast(e.message); }
  });
};
App.removeContact = async (u) => {
  try { await api('DELETE', `/api/contacts/${u.id}`); S.contacts = (S.contacts || []).filter((x) => x.id !== u.id); toast('از مخاطبین حذف شد'); } catch (e) { toast(e.message); }
};
App.toggleBlock = async (u) => {
  if (!u.blocked) {
    if (!(await UI.ask('مسدود کردن کاربر', `${userName(u)} دیگر نمی‌تواند به شما پیام بدهد یا تماس بگیرد و وضعیت آنلاین و عکس شما را نمی‌بیند.`, 'مسدود کن', true))) return;
    try { await api('POST', '/api/blocked', { user_id: u.id }); toast('مسدود شد'); } catch (e) { toast(e.message); }
  } else {
    try { await api('DELETE', `/api/blocked/${u.id}`); toast('رفع مسدودی شد'); } catch (e) { toast(e.message); }
  }
};

/* ---------- calls list ---------- */
App.openCalls = async () => {
  const list = h('div', { class: 'list' }, h('div', { class: 'empty-hint' }, 'در حال بارگذاری…'));
  App.side.push({ title: 'تماس‌ها', body: list });
  try {
    const { calls } = await api('GET', '/api/calls');
    list.replaceChildren(...(calls.length ? calls.map((cl) => {
      const missed = cl.state !== 'ended' && !cl.outgoing;
      const c = S.chats.get(cl.chat_id);
      return h('div', { class: 'ci call-row' + (missed ? ' missed' : ''), onclick: () => c && App.openChat(c.id) }, userAvatar(cl.peer),
        h('div', { class: 'body' },
          h('div', { class: 'row' }, h('div', { class: 'title' }, h('span', { class: 't', dir: 'auto' }, userName(cl.peer)))),
          h('div', { class: 'row' }, h('div', { class: 'preview' }, icon(cl.outgoing ? 'callOut' : 'callIn', 'arrow'),
            `${cl.video ? 'تصویری' : 'صوتی'} · ${fmtListTime(cl.created_at)}${cl.duration ? ' · ' + fmtDur(cl.duration) : ''}`))),
        c ? h('button', { class: 'ibtn accent', type: 'button', title: 'تماس', onclick: (e) => { e.stopPropagation(); App.startCall(c, cl.video); } }, icon(cl.video ? 'video' : 'phone')) : null);
    }) : [h('div', { class: 'empty-hint' }, 'هنوز تماسی نداشته‌اید')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'empty-hint' }, e.message)); }
};

App.addMembersDialog = (c) => {
  const picker = userPicker({ multiple: true });
  const add = h('button', { class: 'btn flat' }, 'افزودن');
  const m = UI.modal({ title: c.type === 'channel' ? 'افزودن مشترک' : 'افزودن عضو', body: picker.el, wide: true, foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), add] });
  add.addEventListener('click', async () => {
    if (!picker.selected.size) return toast('کسی انتخاب نشده');
    try {
      await api('POST', `/api/chats/${c.id}/members`, { usernames: [...picker.selected.values()].map((u) => u.username) });
      m.close();
      toast('اضافه شد');
    } catch (e) { toast(e.message); }
  });
};

/* ---------- invite link / join ---------- */
const inviteUrl = (token) => `${location.origin}/#/join/${token}`;
const publicUrl = (name) => `${location.origin}/#/@${name}`;

App.inviteDialog = async (c, revoke = false) => {
  try {
    const { invite_token } = await api('POST', `/api/chats/${c.id}/invite`, { revoke });
    const url = inviteUrl(invite_token);
    const m = UI.modal({
      title: 'لینک دعوت',
      body: [h('p', {}, 'هر کسی این لینک را داشته باشد می‌تواند عضو شود.'),
        h('div', { class: 'field' }, h('input', { value: url, readonly: true, dir: 'ltr', onclick: (e) => e.target.select() }))],
      foot: [
        h('button', { class: 'btn flat danger', onclick: async () => { if (await UI.ask('باطل کردن لینک', 'لینک فعلی دیگر کار نمی‌کند و یک لینک تازه ساخته می‌شود.', 'باطل کن', true)) { m.close(); App.inviteDialog(c, true); } } }, 'باطل کردن'),
        h('button', { class: 'btn flat', onclick: () => copyText(url, 'لینک کپی شد') }, 'کپی لینک'),
      ],
    });
  } catch (e) { toast(e.message); }
};

App.joinDialog = async (ref) => {
  try {
    const { chat } = await api('POST', '/api/join/preview', ref);
    if (chat.is_member && S.chats.has(chat.id)) return App.openChat(chat.id);
    const btn = h('button', { class: 'btn' }, chat.type === 'channel' ? 'عضویت در کانال' : 'پیوستن به گروه');
    const m = UI.modal({
      title: chat.type === 'channel' ? 'کانال' : 'گروه',
      body: h('div', { class: 'info-top' },
        avatarEl({ name: chat.title, avatar: chat.avatar, seed: chat.id * 7 + 3 }, 's120'),
        h('div', { class: 't', dir: 'auto' }, chat.title, chat.verified ? R.verified() : null),
        h('div', { class: 'st' }, (chat.username ? '@' + chat.username + ' · ' : '') + membersText(chat)),
        chat.description ? h('p', { dir: 'auto', class: 'st' }, chat.description) : null,
        h('div', { class: 'join-wrap' }, btn)),
    });
    btn.addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/join', ref);
        S.chats.set(r.chat.id, r.chat);
        m.close();
        App.openChat(r.chat.id);
      } catch (e) { toast(e.message); }
    });
  } catch (e) { toast(e.message); }
};

/* ---------- send media popup (Web K: compress / group / spoiler) ---------- */
App.sendFilesDialog = (files, asFile) => {
  const c = S.chats.get(S.active);
  if (!c?.can_post) return;
  const isMedia = (f) => /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(f.type);
  const allMedia = files.every(isMedia);
  let compress = !asFile && allMedia;
  let group = files.length > 1;
  let spoiler = false;
  const preview = h('div', { class: 'files-preview' });
  const urls = [];
  const paint = () => {
    preview.classList.toggle('grid', compress && files.length > 1 && group);
    preview.replaceChildren(...files.map((f) => {
      if (compress && f.type.startsWith('image/')) { const u = URL.createObjectURL(f); urls.push(u); return h('div', { class: 'fp' + (spoiler ? ' is-spoiler' : '') }, h('img', { src: u, alt: '' })); }
      if (compress && f.type.startsWith('video/')) { const u = URL.createObjectURL(f); urls.push(u); return h('div', { class: 'fp' + (spoiler ? ' is-spoiler' : '') }, h('video', { src: u, muted: true })); }
      return h('div', { class: 'fp doc' }, h('span', { class: 'ficon' }, icon('file')), h('div', {}, h('div', { class: 'fn' }, f.name), h('div', { class: 'st' }, fmtSize(f.size))));
    }));
  };
  paint();
  const caption = UI.field('کپشن (اختیاری)', { multiline: true, rows: 1, maxlength: 4096 });
  const opts = h('div', { class: 'send-opts' },
    allMedia ? UI.checkRow('فشرده‌سازی تصویر', compress, (v) => { compress = v; paint(); }) : null,
    files.length > 1 ? UI.checkRow('گروه کردن (آلبوم)', group, (v) => { group = v; paint(); }) : null,
    allMedia ? UI.checkRow('پوشاندن با اسپویلر', spoiler, (v) => { spoiler = v; paint(); }) : null);
  const send = h('button', { class: 'btn flat' }, 'ارسال');
  const m = UI.modal({
    title: files.length > 1 ? `ارسال ${fa(files.length)} فایل` : compress ? (files[0].type.startsWith('video/') ? 'ارسال ویدیو' : 'ارسال عکس') : 'ارسال فایل',
    body: [preview, opts, caption], cls: 'send-files',
    foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), send],
    onClose: () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000),
  });
  const go = () => {
    m.close();
    App.sendFilesNow(files, { caption: caption.input.value.trim(), compress, group, spoiler });
  };
  send.addEventListener('click', go);
  caption.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
};

// albums hold up to 10 items, like Telegram
App.sendFilesNow = (files, { caption = '', compress = true, group = true, spoiler = false } = {}) => {
  const cap = caption.trim();
  const replyTo = S.reply?.id || null;
  const groups = [];
  for (let i = 0; i < files.length; i += 10) groups.push(files.slice(i, i + 10));
  for (const chunk of groups) {
    const gid = group && chunk.length > 1 ? Math.random().toString(36).slice(2, 12) + Date.now().toString(36) : null;
    chunk.forEach((f, i) => App.upload(f, {
      caption: groups[0] === chunk && i === 0 ? cap : '', asFile: !compress, replyTo: groups[0] === chunk && i === 0 ? replyTo : null,
      grouped: gid, spoiler: spoiler && compress,
    }));
  }
  if (replyTo) { S.reply = null; App.renderComposerBar(); }
};

/* ---------- polls ---------- */
App.pollDialog = (c) => {
  const q = UI.field('سؤال', { maxlength: 255 });
  const optsBox = h('div');
  const addOpt = (v = '') => {
    if (optsBox.children.length >= 10) return toast('حداکثر ۱۰ گزینه');
    const f = UI.field(`گزینه ${fa(optsBox.children.length + 1)}`, { maxlength: 100, value: v });
    const row = h('div', { class: 'poll-opt' }, f, ibtn('close', 'حذف گزینه', () => { if (optsBox.children.length > 2) { row.remove(); renumber(); } }));
    f.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOpt(); $$('input', optsBox).at(-1).focus(); } });
    optsBox.append(row);
  };
  const renumber = () => $$('.field span', optsBox).forEach((s, i) => (s.textContent = `گزینه ${fa(i + 1)}`));
  addOpt(); addOpt();
  const create = h('button', { class: 'btn flat' }, 'ساخت');
  const m = UI.modal({
    title: 'نظرسنجی جدید',
    body: [q, h('div', { class: 'section-caption' }, 'گزینه‌ها'), optsBox, h('button', { class: 'btn flat', type: 'button', onclick: () => addOpt() }, icon('plus'), 'افزودن گزینه')],
    foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), create],
  });
  create.addEventListener('click', async () => {
    const options = $$('input', optsBox).map((i) => i.value.trim()).filter(Boolean);
    if (!q.input.value.trim()) return toast('سؤال را بنویسید');
    if (options.length < 2) return toast('حداقل ۲ گزینه لازم است');
    const body = { type: 'send', chat_id: c.id, poll: { question: q.input.value.trim(), options }, ...App.topicFields(c) };
    try {
      if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message);
      m.close();
    } catch (e) { toast(e.message); }
  });
};

/* ---------- forward ---------- */
App.forwardDialog = (ids) => {
  const input = h('input', { type: 'search', placeholder: 'جستجو…' });
  const list = h('div', { class: 'picker-list' });
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const chats = App.sortedChats(false).concat(App.sortedChats(true)).filter((c) => c.can_post && (!q || chatTitle(c).toLowerCase().includes(q)));
    list.replaceChildren(...chats.map((c) => h('div', { class: 'pick', onclick: () => { m.close(); App.forward(ids, c.id, false, c.is_forum ? 0 : undefined); } },
      chatAvatar(c, 's42'), h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, chatTitle(c)), h('div', { class: 's' }, R.chatStatus(c).text || (isSaved(c) ? 'ذخیره برای خودتان' : ''))))));
  };
  input.addEventListener('input', paint);
  paint();
  const m = UI.modal({ title: 'بازارسال به…', body: [h('div', { class: 'tab-search' }, icon('search'), input), list], cls: 'forward' });
};

/* ---------- stickers: pack viewer, search, create ---------- */
App.stickerPackOf = (m) => { if (m.sticker?.pack_id) App.stickerPackDialog(m.sticker.pack_id); };
App.stickerPackDialog = async (ref) => {
  try {
    const { pack } = await api('GET', `/api/stickers/packs/${encodeURIComponent(ref)}`);
    const btn = h('button', { class: 'btn block' + (pack.installed ? ' danger-fill' : '') }, pack.installed ? `حذف ${fa(pack.count)} استیکر` : `افزودن ${fa(pack.count)} استیکر`);
    const grid = h('div', { class: 'st-grid big' }, pack.stickers.map((st) => h('button', { type: 'button', class: 'st', title: st.emoji, onclick: () => {
      if (S.active && S.chats.get(S.active)?.can_post) { App.rememberSticker(st); App.sendSticker(st); m.close(); }
    } }, h('img', { src: st.url, alt: st.emoji, loading: 'lazy' }))));
    const m = UI.modal({
      title: pack.title, wide: true, cls: 'sticker-pack', body: [grid, pack.mine ? h('div', { class: 'pack-tools' },
        h('button', { class: 'btn flat', onclick: () => { m.close(); App.addStickerToPack(pack); } }, icon('plus'), 'افزودن استیکر'),
        h('button', { class: 'btn flat', onclick: () => copyText(`${location.origin}/#/addstickers/${pack.short_name}`, 'لینک کپی شد') }, icon('link'), 'کپی لینک')) : null],
      foot: [btn],
    });
    btn.addEventListener('click', async () => {
      try {
        await api(pack.installed ? 'DELETE' : 'POST', `/api/stickers/packs/${pack.id}/install`);
        await App.loadStickers(true);
        toast(pack.installed ? 'بسته حذف شد' : 'بسته اضافه شد');
        m.close();
      } catch (e) { toast(e.message); }
    });
  } catch (e) { toast(e.message); }
};
App.stickerSearchDialog = () => {
  const input = h('input', { type: 'search', placeholder: 'جستجوی بسته‌ها' });
  const list = h('div', { class: 'picker-list' });
  const run = async () => {
    try {
      const { packs } = await api('GET', '/api/stickers/search?q=' + encodeURIComponent(input.value.trim()));
      list.replaceChildren(...(packs.length ? packs.map((p) => h('div', { class: 'pick', onclick: () => { m.close(); App.stickerPackDialog(p.id); } },
        p.thumb ? h('img', { class: 'pack-thumb', src: p.thumb, alt: '' }) : h('span', { class: 'pack-thumb' }),
        h('div', { class: 'body' }, h('div', { class: 'n' }, p.title), h('div', { class: 's' }, `${fa(p.count)} استیکر`)),
        p.installed ? icon('check', 'ok') : null)) : [h('div', { class: 'info-empty' }, 'بسته‌ای پیدا نشد')]));
    } catch (e) { toast(e.message); }
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  const m = UI.modal({ title: 'بسته‌های استیکر', body: [h('div', { class: 'tab-search' }, icon('search'), input), list],
    foot: [h('button', { class: 'btn flat', onclick: () => { m.close(); App.createPackDialog(); } }, 'ساخت بسته‌ی جدید')] });
  run();
};
App.createPackDialog = () => {
  const title = UI.field('نام بسته', { maxlength: 64 });
  const short = UI.field('نام کوتاه (برای لینک)', { dir: 'ltr', maxlength: 32, placeholder: 'my_stickers' }, 'حروف انگلیسی، عدد و _');
  const ok = h('button', { class: 'btn flat' }, 'ساخت');
  const m = UI.modal({ title: 'بسته‌ی استیکر جدید', body: [title, short], foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), ok] });
  ok.addEventListener('click', async () => {
    try {
      const { pack } = await api('POST', '/api/stickers/packs', { title: title.input.value.trim(), short_name: short.input.value.trim() });
      await App.loadStickers(true);
      m.close();
      App.addStickerToPack(pack);
    } catch (e) { toast(e.message); }
  });
};
App.addStickerToPack = async (pack) => {
  const inp = h('input', { type: 'file', accept: 'image/png,image/webp,image/gif,image/jpeg', multiple: true });
  inp.addEventListener('change', async () => {
    const files = [...inp.files];
    if (!files.length) return;
    const emoji = (await UI.prompt('اموجی استیکر', 'یک اموجی برای این استیکرها', '🙂')) || '';
    toast('در حال آپلود…');
    for (const f of files) {
      try {
        const sq = await squareImage(f, 512, 'image/png');
        const up = await uploadFile(sq, 'sticker.png');
        await api('POST', `/api/stickers/packs/${pack.id}/stickers`, { file_id: up.id, emoji });
      } catch (e) { toast(e.message); }
    }
    await App.loadStickers(true);
    App.stickerPackDialog(pack.id);
  });
  inp.click();
};

/* ---------- avatar upload helper ---------- */
function pickImage() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp' });
    inp.addEventListener('change', () => resolve(inp.files[0] || null));
    inp.click();
  });
}
// Fit into a square (crop for avatars, contain for stickers) and shrink so it stays small and sharp.
async function squareImage(file, size = 640, type = 'image/jpeg') {
  try {
    const bmp = await createImageBitmap(file);
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (type === 'image/png') {
      const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    } else {
      const side = Math.min(bmp.width, bmp.height);
      const out = Math.min(size, side);
      cv.width = cv.height = out;
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
    }
    const blob = await new Promise((r) => cv.toBlob(r, type, 0.9));
    return blob ? new File([blob], type === 'image/png' ? 'image.png' : 'avatar.jpg', { type }) : file;
  } catch { return file; }
}

/* =====================================================================
   INFO COLUMN (right sidebar, sliding tabs)
   ===================================================================== */
App.buildInfo = () => {
  const info = $('#info');
  el.infoBase = h('div', { class: 'stab main in' });
  info.replaceChildren(el.infoBase);
  App.infoSide = new UI.Slider(info, el.infoBase);
  info.hidden = true;
};
App.closeInfo = () => {
  const info = $('#info');
  App.infoSide?.popAll();
  info.hidden = true;
  App.infoChat = null;
  document.body.classList.remove('info-open');
};
// back from the profile: on phones it's a page with its own history entry (Android back / swipe)
App.backInfo = () => {
  if (narrow() && history.state?.info) history.back();
  else App.closeInfo();
};
App.shareChat = (c) => {
  const url = c.type === 'private' ? `${location.origin}/#/@${c.username}` : c.username ? publicUrl(c.username) : c.invite_token ? inviteUrl(c.invite_token) : null;
  if (!url) return toast('این گفتگو لینک عمومی ندارد');
  if (navigator.share) navigator.share({ title: chatTitle(c), url }).catch(() => {});
  else copyText(url, 'لینک کپی شد');
};
// ⋮ on the profile: everything that isn't one of the three big buttons
App.infoMenu = (c, anchor) => {
  const priv = c.type === 'private' && !isSaved(c);
  const p = c.peer;
  UI.menu([
    priv && !p.system && !p.blocked ? { icon: 'video', label: 'تماس تصویری', onClick: () => App.startCall(c, true) } : null,
    priv && !p.system ? { icon: 'oEdit', label: p.is_contact ? 'ویرایش مخاطب' : 'افزودن به مخاطبین', onClick: () => App.contactDialog(p) } : null,
    c.username || c.invite_token ? { icon: 'oShare', label: 'اشتراک‌گذاری', onClick: () => App.shareChat(c) } : null,
    c.can_manage ? { icon: 'oEdit', label: 'ویرایش', onClick: () => App.editChatDialog(c) } : null,
    c.can_manage && !c.invite_token ? { icon: 'link', label: 'ساخت لینک دعوت', onClick: () => App.inviteDialog(c) } : null,
    S.me.is_admin && !isSaved(c) ? { icon: 'shield', label: c.verified ? 'برداشتن تیک آبی' : 'دادن تیک آبی', onClick: () => App.setVerified(c, !c.verified) } : null,
    priv && !p.system ? { icon: 'block', label: p.blocked ? 'رفع مسدودی' : 'مسدود کردن', danger: !p.blocked, onClick: () => App.toggleBlock(p) } : null,
    c.type !== 'private' ? { icon: 'logout', label: c.type === 'channel' ? 'ترک کانال' : 'ترک گروه', danger: true, onClick: () => App.leaveOrDelete(c) } : null,
  ], { anchor });
};
App.toggleInfo = () => {
  if (!$('#info').hidden && App.infoChat === S.active) return App.closeInfo();
  App.openInfo(S.active);
};

App.openInfo = async (chatId, refresh) => {
  const c = S.chats.get(chatId);
  if (!c) return;
  const info = $('#info');
  const tab = refresh ? info.dataset.tab : null;
  if (!refresh) App.infoSide.popAll();
  if (!refresh && narrow() && info.hidden && !history.state?.info) history.pushState({ ...(history.state || {}), info: chatId }, '');
  info.hidden = false;
  document.body.classList.add('info-open');
  App.infoChat = chatId;
  info.dataset.chat = String(chatId);
  let details = { members: [] };
  if (c.type !== 'private') { try { details = await api('GET', `/api/chats/${chatId}`); } catch {} }
  if (App.infoChat !== chatId || info.hidden) return;
  const priv = c.type === 'private' && !isSaved(c);
  const st = R.chatStatus(c);
  // Telegram Android profile: value on top, small label under it, no icons
  const rows = h('div', { class: 'info-rows p-card' });
  const vrow = (value, label, onClick, cls, end) => UI.row(null, value, label, onClick, 'p-val' + (cls ? ' ' + cls : ''), end);
  if (c.description) rows.append(vrow(c.description, c.type === 'private' ? 'بیوگرافی' : 'توضیحات', () => copyText(c.description), 'multi'));
  if (c.username) {
    const link = c.type === 'private' ? '@' + c.username : publicUrl(c.username).replace(/^https?:\/\//, '');
    rows.append(vrow(link, c.type === 'private' ? 'نام کاربری' : 'لینک', () => copyText(c.type === 'private' ? '@' + c.username : publicUrl(c.username)), 'ltr-n',
      ibtn('link', 'اشتراک‌گذاری', (e) => { e.stopPropagation(); App.shareChat(c); })));
  }
  if (c.can_manage && c.invite_token && !c.username) rows.append(vrow(inviteUrl(c.invite_token).replace(/^https?:\/\//, ''), 'لینک دعوت', () => copyText(inviteUrl(c.invite_token), 'لینک کپی شد'), 'ltr-n'));
  if (priv && c.peer.system) rows.append(vrow('حساب رسمی کبوتر', 'سرویس', null));
  if (!rows.children.length) rows.hidden = true;
  const extra = h('div', { class: 'info-rows p-card p-links' });
  if (priv && !c.peer.system && !c.peer.is_contact) extra.append(UI.row('personAdd', 'افزودن به مخاطبین', null, () => App.contactDialog(c.peer), 'accent'));
  if (c.can_manage) extra.append(UI.row('personAdd', c.type === 'channel' ? 'افزودن مشترک' : 'افزودن عضو', null, () => App.addMembersDialog(c), 'accent'));
  if (!extra.children.length) extra.hidden = true;

  const tabs = [];
  if (details.members.length) tabs.push(['members', c.type === 'channel' ? 'مشترک‌ها' : 'اعضا']);
  if (priv && !c.peer.system) tabs.push(['stories', 'استوری‌ها']);
  tabs.push(['media', 'رسانه'], ['file', 'فایل‌ها'], ['link', 'لینک‌ها'], ['music', 'موسیقی'], ['voice', 'صوت'], ['gif', 'GIF']);
  const content = h('div', { class: 'info-content' });
  const showTab = async (key) => {
    info.dataset.tab = key;
    tabBar.select(key);
    if (key === 'members') return content.replaceChildren(h('div', { class: 'info-list' }, details.members.map((u) => App.memberRow(c, u))));
    content.replaceChildren(h('div', { class: 'info-empty' }, 'در حال بارگذاری…'));
    try {
      if (key === 'stories') {
        const r = await api('GET', `/api/users/${c.peer.id}/stories`);
        if (info.dataset.tab !== key) return;
        const all = [...r.stories, ...r.pinned.filter((p) => !r.stories.some((s) => s.id === p.id))];
        if (!all.length) return content.replaceChildren(h('div', { class: 'info-empty' }, 'استوری‌ای نیست'));
        return content.replaceChildren(h('div', { class: 'media-grid stories' }, all.map((s) => h('div', { class: 'mg', onclick: () => Stories.openList(r.user, all, s.id) },
          s.kind === 'photo' ? h('img', { src: s.url, loading: 'lazy', alt: '' }) : h('video', { src: s.url, preload: 'metadata', muted: true })))));
      }
      const { messages } = await api('GET', `/api/chats/${chatId}/media?type=${key}`);
      if (info.dataset.tab !== key) return;
      if (!messages.length) return content.replaceChildren(h('div', { class: 'info-empty' }, 'چیزی نیست'));
      if (key === 'media' || key === 'gif') {
        content.replaceChildren(h('div', { class: 'media-grid' }, messages.map((m) => h('div', { class: 'mg', onclick: () => UI.lightbox(m, messages.slice().reverse()) },
          m.kind === 'photo' || m.media.mime === 'image/gif' ? h('img', { src: m.media.url, loading: 'lazy', alt: '' }) : h('video', { src: m.media.url, preload: 'metadata', muted: true, ...(m.kind === 'gif' ? { autoplay: true, loop: true } : {}) }),
          m.kind === 'video' ? h('span', { class: 'vb' }, fmtDur(m.media.duration || 0)) : null))));
      } else if (key === 'link') {
        content.replaceChildren(h('div', { class: 'info-list' }, messages.map((m) => {
          const url = (m.text.match(/https?:\/\/[^\s]+/) || [''])[0];
          let host = url;
          try { host = new URL(url).hostname; } catch {}
          return h('div', { class: 'pick link-row', onclick: () => App.jumpTo(chatId, m.id) },
            h('span', { class: 'link-ic' }, [...host.replace(/^www\./, '')][0]?.toUpperCase() || '🔗'),
            h('div', { class: 'body' }, h('div', { class: 'n', dir: 'ltr' }, host), h('a', { class: 's', href: url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr', onclick: (e) => e.stopPropagation() }, url),
              h('div', { class: 's', dir: 'auto' }, R.stripMarkup(m.text).slice(0, 80))));
        })));
      } else {
        content.replaceChildren(h('div', { class: 'info-list' }, messages.map((m) => h('div', { class: 'pick', onclick: () => App.jumpTo(chatId, m.id) },
          key === 'voice' ? userAvatar(m.sender, 's42') : h('span', { class: 'ficon avatar s42 ' + (key === 'music' ? 'g2' : 'g5') }, icon(key === 'music' ? 'music' : 'file')),
          h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, key === 'voice' ? m.sender.display_name : m.media.name),
            h('div', { class: 's' }, `${key === 'voice' ? fmtDur(m.media.duration || 0) : fmtSize(m.media.size)} · ${fmtListTime(m.created_at)}`)),
          h('a', { class: 'ibtn', href: m.media.url, download: m.media.name, onclick: (e) => e.stopPropagation() }, icon('download'))))));
      }
    } catch (e) { content.replaceChildren(h('div', { class: 'info-empty' }, e.message)); }
  };
  const tabBar = UI.tabs(tabs, tabs[0][0], showTab, 'info-tabs');

  // Telegram Android: round photo in the middle, name, status, then three action cards
  const name = h('div', { class: 't', dir: 'auto' }, chatTitle(c), c.verified ? R.verified() : null);
  const status = st.text ? h('div', { class: 'st' + (st.accent ? ' accent' : '') }, st.text) : null;
  const big = chatAvatar(c, 's110');
  big.addEventListener('click', () => {
    if (priv && c.peer.stories) return App.openStoriesOf(c.peer.id);
    if (c.avatar && !isSaved(c)) UI.lightbox({ kind: 'photo', media: { url: c.avatar, name: 'avatar.jpg' }, sender: c.peer || { display_name: c.title, id: c.id }, created_at: Date.now(), id: 0 }, null);
  });
  const top = h('div', { class: 'info-top p-top' }, big, name, status);
  const act = (ic, label, fn, cls) => h('button', { type: 'button', class: 'p-action' + (cls ? ' ' + cls : ''), onclick: fn }, icon(ic), h('span', {}, label));
  const muteAct = () => act(c.muted ? 'oBellOff' : 'oBell', c.muted ? 'صدادار کردن' : 'بی‌صدا کردن', () => App.chatSetting(c, { muted: !c.muted }));
  const goChat = () => { App.backInfo(); if (S.active !== c.id) App.openChat(c.id); };
  let acts = [];
  if (isSaved(c)) acts = [act('oSearch', 'جستجو', () => { App.backInfo(); App.openChatSearch(); })];
  else if (priv) acts = [
    !c.peer.system && !c.peer.blocked ? act('oPhone', 'تماس', () => App.startCall(c, false)) : null,
    c.peer.system ? null : muteAct(),
    act('oChat', 'پیام', goChat),
  ];
  else if (c.type === 'channel') acts = [
    c.can_manage ? act('oEdit', 'ویرایش', () => App.editChatDialog(c)) : act('oLeave', 'ترک کردن', () => App.leaveOrDelete(c)),
    act('oShare', 'به اشتراک گذاری', () => App.shareChat(c)),
    muteAct(),
  ];
  else acts = [
    c.can_manage ? act('oEdit', 'ویرایش', () => App.editChatDialog(c)) : act('oLeave', 'ترک کردن', () => App.leaveOrDelete(c)),
    muteAct(),
    act('oChat', 'پیام', goChat),
  ];
  acts = acts.filter(Boolean);
  const actions = acts.length ? h('div', { class: 'p-actions n' + acts.length }, acts) : null;
  const more = ibtn('more', 'بیشتر', (e) => App.infoMenu(c, e.currentTarget));
  el.infoBase.replaceChildren(
    h('div', { class: 'stab-head p-head' }, ibtn('back', 'بازگشت', App.backInfo), h('div', { class: 'sp' }), isSaved(c) ? null : more),
    h('div', { class: 'stab-body info-body p-body' }, top, actions, rows, extra, h('div', { class: 'info-media' }, tabBar, content)));
  showTab(tab && tabs.some((t) => t[0] === tab) ? tab : tabs[0][0]);
};

App.memberRow = (c, u) => {
  const roleLabel = u.role === 'owner' ? 'مالک' : u.role === 'admin' ? 'ادمین' : '';
  const row = h('div', { class: 'pick' }, userAvatar(u, 's42'),
    h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, u.id === S.me.id ? 'شما' : userName(u)),
      h('div', { class: 's' + (u.online ? ' accent' : '') }, lastSeenText(u))),
    roleLabel ? h('span', { class: 'role' }, roleLabel) : null);
  if (u.id === S.me.id) return row;
  row.addEventListener('click', (e) => {
    const owner = c.role === 'owner';
    const canKick = c.can_manage && u.role !== 'owner' && (u.role !== 'admin' || owner);
    UI.menu([
      { icon: 'user', label: 'ارسال پیام', onClick: () => App.openPrivateWith(u.username) },
      !u.is_contact ? { icon: 'personAdd', label: 'افزودن به مخاطبین', onClick: () => App.contactDialog(u) } : null,
      owner && u.role === 'member' ? { icon: 'shield', label: 'ادمین کردن', onClick: () => App.setRole(c, u, 'admin') } : null,
      owner && u.role === 'admin' ? { icon: 'shield', label: 'برکناری از ادمینی', onClick: () => App.setRole(c, u, 'member') } : null,
      canKick ? { icon: 'trash', label: c.type === 'channel' ? 'حذف از کانال' : 'حذف از گروه', danger: true, onClick: () => App.kick(c, u) } : null,
    ], { x: e.clientX, y: e.clientY });
  });
  return row;
};
App.setRole = async (c, u, role) => {
  try { await api('PATCH', `/api/chats/${c.id}/members/${u.id}`, { role }); toast(role === 'admin' ? `${u.display_name} ادمین شد` : 'برکنار شد'); } catch (e) { toast(e.message); }
};
App.kick = async (c, u) => {
  if (!(await UI.ask('حذف عضو', `${u.display_name} از «${c.title}» حذف شود؟`, 'حذف', true))) return;
  try { await api('DELETE', `/api/chats/${c.id}/members/${u.id}`); } catch (e) { toast(e.message); }
};

/* ---------- edit group / channel (info column tab) ---------- */
App.editChatDialog = (c) => {
  if ($('#info').hidden || App.infoChat !== c.id) App.openInfo(c.id);
  const title = UI.field(c.type === 'channel' ? 'نام کانال' : 'نام گروه', { value: c.title, maxlength: 128 });
  const desc = UI.field('توضیحات', { multiline: true, rows: 3, value: c.description || '', maxlength: 255 });
  const noun = c.type === 'channel' ? 'کانال' : 'گروه';
  const typeRow = UI.row('link', `نوع ${noun}`, c.username ? `عمومی · @${c.username}` : 'خصوصی', () => App.channelTypeStep(S.chats.get(c.id) || c, {
    editing: true, slider: App.infoSide, onSaved: (ch) => { typeRow.querySelector('.s').textContent = ch.username ? `عمومی · @${ch.username}` : 'خصوصی'; },
  }));
  let forum = !!c.is_forum;
  const body = [
    avatarEditor({ name: c.title, avatar: c.avatar, seed: c.id * 7 + 3 }, (id) => api('PATCH', `/api/chats/${c.id}`, { avatar: id }),
      { onRemove: () => api('PATCH', `/api/chats/${c.id}`, { avatar: null }) }),
    h('div', { class: 'section' }, title, desc),
    UI.section(null, typeRow),
    c.type === 'group' ? UI.section(null, UI.switchRow('topic', 'تاپیک‌ها', 'گفتگوهای گروه در چند موضوع جدا', forum, (v) => { forum = v; }), 'وقتی تاپیک‌ها فعال باشند، پیام‌های قبلی به تاپیک «عمومی» منتقل می‌شوند.') : null,
    UI.section(null, [
      UI.row('link', 'لینک‌های دعوت', null, () => App.inviteDialog(c)),
      UI.row('group', c.type === 'channel' ? 'مشترک‌ها' : 'اعضا', fa(c.member_count), () => { App.infoSide.pop(); }),
    ]),
    c.role === 'owner' ? UI.section(null, UI.row('trash', c.type === 'channel' ? 'حذف کانال' : 'حذف گروه', 'برای همه اعضا حذف می‌شود', async () => {
      if (await UI.ask('حذف برای همه', `«${c.title}» و همه پیام‌هایش برای همیشه حذف می‌شود.`, 'حذف', true)) {
        try { await api('DELETE', `/api/chats/${c.id}`); App.closeInfo(); App.removeChat(c.id); } catch (e) { toast(e.message); }
      }
    }, 'danger')) : null,
  ];
  const tab = App.infoSide.push({
    title: 'ویرایش', body, cls: 'edit-tab',
    fab: { icon: 'check', title: 'ذخیره', onClick: async () => {
      try {
        const payload = { title: title.input.value.trim(), description: desc.input.value.trim() };
        if (c.type === 'group' && forum !== !!c.is_forum) payload.is_forum = forum;
        const { chat } = await api('PATCH', `/api/chats/${c.id}`, payload);
        S.chats.set(chat.id, chat);
        App.infoSide.pop(tab);
        toast('ذخیره شد');
      } catch (e) { toast(e.message); }
    } },
  });
};

/* ---------- blue ticks (admins listed in ADMIN_USERNAMES) ---------- */
App.setVerified = async (c, on) => {
  try {
    const body = c.type === 'private' ? { user_id: c.peer.id, verified: on } : { chat_id: c.id, verified: on };
    await api('POST', '/api/admin/verify', body);
    toast(on ? 'تیک آبی داده شد' : 'تیک آبی برداشته شد');
  } catch (e) { toast(e.message); }
};

/* ---------- scheduled messages ---------- */
App.loadScheduledCount = async () => {
  const id = S.active;
  const c = S.chats.get(id);
  if (!c || !c.can_post) { App.scheduledCount = 0; return; }
  try {
    const { scheduled } = await api('GET', `/api/chats/${id}/scheduled`);
    if (S.active !== id) return;
    App.scheduledCount = scheduled.length;
    App.scheduledList = scheduled;
    el.schedBtn?.remove();
    el.schedBtn = null;
    if (scheduled.length && el.row && el.attachBtn) {
      el.schedBtn = ibtn('clock', 'پیام‌های زمان‌بندی‌شده', () => App.scheduledDialog(c), 'sched-btn');
      el.row.insertBefore(el.schedBtn, el.attachBtn);
    }
  } catch {}
};
const pad2 = (n) => String(n).padStart(2, '0');
App.scheduleDialog = () => {
  const c = S.chats.get(S.active);
  if (!c || !el.input?.value.trim()) return;
  const d = new Date(Date.now() + 3600e3);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const val = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const when = UI.field('زمان ارسال', { type: 'datetime-local', value: val, dir: 'ltr' });
  const quick = h('div', { class: 'chips-select' }, [['۱ ساعت بعد', 3600e3], ['امشب ساعت ۲۱', 'tonight'], ['فردا صبح ۹', 'tomorrow']].map(([label, v]) =>
    h('button', { type: 'button', class: 'chip-sel', onclick: () => {
      const t = new Date();
      if (v === 'tonight') { t.setHours(21, 0, 0, 0); if (t < Date.now()) t.setDate(t.getDate() + 1); }
      else if (v === 'tomorrow') { t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); }
      else t.setTime(Date.now() + v);
      when.input.value = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}T${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
    } }, label)));
  const ok = h('button', { class: 'btn flat' }, 'زمان‌بندی');
  const m = UI.modal({ title: isSaved(c) ? 'یادآوری' : 'زمان‌بندی پیام', body: [quick, when], foot: [h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف'), ok] });
  ok.addEventListener('click', async () => {
    const at = new Date(when.input.value).getTime();
    if (!Number.isFinite(at) || at < Date.now() + 10000) return toast('یک زمان در آینده انتخاب کنید');
    try {
      await api('POST', `/api/chats/${c.id}/scheduled`, { text: el.input.value.trim(), send_at: at, reply_to: S.reply?.id || null, ...App.topicFields(c) });
      el.input.value = '';
      delete S.drafts[App.draftKey()];
      save('drafts', S.drafts);
      S.reply = null;
      App.autoGrow(); App.renderComposerBar();
      m.close();
      toast(`پیام برای ${new Date(at).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' })} زمان‌بندی شد`);
      App.loadScheduledCount();
    } catch (e) { toast(e.message); }
  });
};
App.scheduledDialog = async (c) => {
  let list = [];
  try { list = (await api('GET', `/api/chats/${c.id}/scheduled`)).scheduled; } catch (e) { return toast(e.message); }
  const box = h('div', { class: 'picker-list' });
  const paint = () => box.replaceChildren(...(list.length ? list.map((s) => h('div', { class: 'pick sched' },
    h('span', { class: 'avatar s42 g5' }, icon('clock')),
    h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, R.stripMarkup(s.text).slice(0, 80)), h('div', { class: 's' }, new Date(s.send_at).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }))),
    ibtn('send', 'همین حالا بفرست', async () => { await api('POST', `/api/scheduled/${s.id}/send`).catch((e) => toast(e.message)); list = list.filter((x) => x.id !== s.id); paint(); App.loadScheduledCount(); }),
    ibtn('trash', 'حذف', async () => { await api('DELETE', `/api/scheduled/${s.id}`).catch((e) => toast(e.message)); list = list.filter((x) => x.id !== s.id); paint(); App.loadScheduledCount(); }))) : [h('div', { class: 'info-empty' }, 'پیام زمان‌بندی‌شده‌ای نیست')]));
  paint();
  UI.modal({ title: 'پیام‌های زمان‌بندی‌شده', body: box, wide: true });
};
