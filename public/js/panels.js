'use strict';
/* Kabootar web client — dialogs and side panels. */

/* ---------- user picker (search + multi-select chips) ---------- */
function userPicker({ multiple = true, onPick } = {}) {
  const selected = new Map();
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'search', placeholder: 'جستجوی نام یا @نام‌کاربری', autocomplete: 'off' });
  const field = h('label', { class: 'field' }, input, h('span', {}, multiple ? 'افزودن افراد' : 'جستجو'));
  const results = h('div');
  const paintChips = () => {
    chips.replaceChildren(...[...selected.values()].map((u) => h('span', { class: 'chip' }, userAvatar(u), u.display_name,
      h('button', { type: 'button', onclick: () => { selected.delete(u.id); paintChips(); paint(lastList); } }, icon('close')))));
  };
  let lastList = [];
  const paint = (users) => {
    lastList = users;
    results.replaceChildren(...(users.length ? users.map((u) => {
      const row = h('div', { class: 'pick' + (selected.has(u.id) ? ' sel' : ''), onclick: () => {
        if (!multiple) return onPick && onPick(u);
        selected.has(u.id) ? selected.delete(u.id) : selected.set(u.id, u);
        paintChips(); paint(lastList);
      } }, userAvatar(u, 's40'),
      h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, u.display_name), h('div', { class: 's' + (u.online ? ' accent' : ''), dir: 'ltr' }, '@' + u.username + ' · ' + lastSeenText(u))),
      multiple ? h('span', { class: 'check' }, icon('check')) : null);
      return row;
    }) : [h('div', { class: 'info-empty' }, input.value.trim() ? 'کسی پیدا نشد' : 'نام کسی را جستجو کنید')]));
  };
  // suggestions: people you already chat with
  const contacts = () => [...S.chats.values()].filter((c) => c.type === 'private' && !isSaved(c)).sort((a, b) => activity(b) - activity(a)).map((c) => c.peer);
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) return paint(contacts());
    t = setTimeout(async () => {
      try { const r = await api('GET', '/api/search?q=' + encodeURIComponent(q)); if (input.value.trim() === q) paint(r.users); } catch (e) { toast(e.message); }
    }, 220);
  });
  paint(contacts());
  return { el: h('div', {}, chips, field, results), selected, input };
}

App.newPrivateDialog = () => {
  const picker = userPicker({ multiple: false, onPick: (u) => { m.close(); App.openPrivateWith(u.username); } });
  const m = UI.modal({ title: 'پیام جدید', body: picker.el });
};

App.newChatDialog = (type) => {
  const isChannel = type === 'channel';
  const title = UI.field(isChannel ? 'نام کانال' : 'نام گروه', { maxlength: 128 });
  const desc = UI.field('توضیحات (اختیاری)', { multiline: true, rows: 2, maxlength: 255 });
  const link = isChannel ? UI.field('لینک عمومی (اختیاری)', { dir: 'ltr', placeholder: 'my_channel', maxlength: 32 }, 'اگر بگذارید، همه می‌توانند کانال را با @نام پیدا کنند و عضو شوند') : null;
  const picker = userPicker({ multiple: true });
  const create = h('button', { class: 'btn flat' }, 'ساخت');
  const m = UI.modal({
    title: isChannel ? 'کانال جدید' : 'گروه جدید', wide: true,
    body: [title, desc, link, h('div', { class: 'set-group-title' }, isChannel ? 'مشترک‌ها (اختیاری)' : 'اعضا'), picker.el],
    foot: [create, h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف')],
  });
  create.addEventListener('click', async () => {
    if (!title.input.value.trim()) { title.input.focus(); return toast('یک نام بنویسید'); }
    create.disabled = true;
    try {
      const { chat } = await api('POST', `/api/chats/${type}`, {
        title: title.input.value.trim(), description: desc.input.value.trim(),
        username: link?.input.value.trim().replace(/^@/, '') || undefined,
        usernames: [...picker.selected.values()].map((u) => u.username),
      });
      S.chats.set(chat.id, chat);
      m.close();
      App.openChat(chat.id);
    } catch (e) { toast(e.message); create.disabled = false; }
  });
};

App.addMembersDialog = (c) => {
  const picker = userPicker({ multiple: true });
  const add = h('button', { class: 'btn flat' }, 'افزودن');
  const m = UI.modal({ title: c.type === 'channel' ? 'افزودن مشترک' : 'افزودن عضو', body: picker.el, foot: [add, h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف')] });
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
        h('button', { class: 'btn flat', onclick: () => copyText(url, 'لینک کپی شد') }, 'کپی لینک'),
        h('button', { class: 'btn danger', onclick: async () => { if (await UI.ask('باطل کردن لینک', 'لینک فعلی دیگر کار نمی‌کند و یک لینک تازه ساخته می‌شود.', 'باطل کن', true)) { m.close(); App.inviteDialog(c, true); } } }, 'باطل کردن'),
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
        h('div', { class: 't', dir: 'auto' }, chat.title),
        h('div', { class: 'st' }, (chat.username ? '@' + chat.username + ' · ' : '') + membersText(chat)),
        chat.description ? h('p', { dir: 'auto', class: 'st' }, chat.description) : null,
        h('div', { style: null }, btn)),
    });
    btn.style.marginTop = '18px';
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

/* ---------- files ---------- */
App.sendFilesDialog = (files, asFile) => {
  const c = S.chats.get(S.active);
  if (!c?.can_post) return;
  const allMedia = files.every((f) => /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(f.type));
  let compress = !asFile && allMedia;
  const preview = h('div', { class: 'files-preview' });
  const urls = [];
  const paint = () => {
    preview.replaceChildren(...files.map((f) => {
      if (compress && f.type.startsWith('image/')) { const u = URL.createObjectURL(f); urls.push(u); return h('div', { class: 'fp' }, h('img', { src: u, alt: '' })); }
      if (compress && f.type.startsWith('video/')) { const u = URL.createObjectURL(f); urls.push(u); return h('div', { class: 'fp' }, h('video', { src: u, muted: true })); }
      return h('div', { class: 'fp doc' }, h('span', { class: 'ficon' }, icon('file')), h('div', {}, h('div', { class: 'fn' }, f.name), h('div', { class: 'st' }, fmtSize(f.size))));
    }));
  };
  paint();
  const caption = UI.field('کپشن (اختیاری)', { multiline: true, rows: 2, maxlength: 4096 });
  const asFileRow = allMedia ? UI.switchRow('file', 'ارسال بدون فشرده‌سازی (به صورت فایل)', null, !compress, (v) => { compress = !v; paint(); }) : null;
  const send = h('button', { class: 'btn flat' }, 'ارسال');
  const m = UI.modal({
    title: files.length > 1 ? `ارسال ${fa(files.length)} فایل` : compress ? (files[0].type.startsWith('video/') ? 'ارسال ویدیو' : 'ارسال عکس') : 'ارسال فایل',
    body: [preview, caption, asFileRow],
    foot: [send, h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف')],
    onClose: () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000),
  });
  const go = () => {
    const cap = caption.input.value.trim();
    const replyTo = S.reply?.id || null;
    m.close();
    files.forEach((f, i) => App.upload(f, { caption: i === 0 ? cap : '', asFile: !compress, replyTo: i === 0 ? replyTo : null }));
    if (replyTo) { S.reply = null; App.renderComposerBar(); }
  };
  send.addEventListener('click', go);
  caption.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
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
    body: [q, h('div', { class: 'set-group-title' }, 'گزینه‌ها'), optsBox, h('button', { class: 'btn flat', type: 'button', onclick: () => addOpt() }, icon('plus'), 'افزودن گزینه')],
    foot: [create, h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف')],
  });
  create.addEventListener('click', async () => {
    const options = $$('input', optsBox).map((i) => i.value.trim()).filter(Boolean);
    if (!q.input.value.trim()) return toast('سؤال را بنویسید');
    if (options.length < 2) return toast('حداقل ۲ گزینه لازم است');
    const body = { type: 'send', chat_id: c.id, poll: { question: q.input.value.trim(), options } };
    try {
      if (!App.wsSend(body)) App.onMessage((await api('POST', `/api/chats/${c.id}/messages`, body)).message);
      m.close();
    } catch (e) { toast(e.message); }
  });
};

/* ---------- forward ---------- */
App.forwardDialog = (ids) => {
  const input = h('input', { type: 'search', placeholder: 'جستجو…' });
  const list = h('div');
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const chats = App.sortedChats(false).concat(App.sortedChats(true)).filter((c) => c.can_post && (!q || chatTitle(c).toLowerCase().includes(q)));
    list.replaceChildren(...chats.map((c) => h('div', { class: 'pick', onclick: () => { m.close(); App.forward(ids, c.id, false); } },
      chatAvatar(c, 's40'), h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, chatTitle(c)), h('div', { class: 's' }, R.chatStatus(c).text || (isSaved(c) ? 'ذخیره برای خودتان' : ''))))));
  };
  input.addEventListener('input', paint);
  paint();
  const m = UI.modal({ title: 'بازارسال به…', body: [h('label', { class: 'field' }, input, h('span', {}, 'گفتگو')), list] });
};

/* ---------- avatar upload helper ---------- */
function pickImage() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp' });
    inp.addEventListener('change', () => resolve(inp.files[0] || null));
    inp.click();
  });
}
// Crop to a centered square and shrink to 640px so avatars stay small and sharp.
async function squareImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const out = Math.min(640, side);
    const cv = document.createElement('canvas');
    cv.width = cv.height = out;
    cv.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    return blob ? new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
async function uploadAvatar() {
  const f = await pickImage();
  if (!f) return null;
  toast('در حال آپلود…');
  return uploadFile(await squareImage(f), 'avatar.jpg');
}
function avatarEditor(ent, onChange) {
  const box = h('div', { class: 'avatar-edit', title: 'تغییر عکس' }, avatarEl(ent, 's120'), h('div', { class: 'ov' }, icon('camera')));
  box.addEventListener('click', async () => {
    try {
      const f = await uploadAvatar();
      if (!f) return;
      await onChange(f.id);
      box.firstChild.replaceWith(avatarEl({ ...ent, avatar: f.url }, 's120'));
    } catch (e) { toast(e.message); }
  });
  return box;
}

/* ---------- edit group / channel ---------- */
App.editChatDialog = (c) => {
  const title = UI.field(c.type === 'channel' ? 'نام کانال' : 'نام گروه', { value: c.title, maxlength: 128 });
  const desc = UI.field('توضیحات', { multiline: true, rows: 3, value: c.description || '', maxlength: 255 });
  const link = UI.field('لینک عمومی', { dir: 'ltr', value: c.username || '', placeholder: 'خالی = خصوصی', maxlength: 32 },
    c.username ? publicUrl(c.username) : 'با گذاشتن نام، همه می‌توانند با @نام پیدا و عضو شوند');
  const saveBtn = h('button', { class: 'btn flat' }, 'ذخیره');
  const m = UI.modal({
    title: 'ویرایش',
    body: [
      avatarEditor({ name: c.title, avatar: c.avatar, seed: c.id * 7 + 3 }, (id) => api('PATCH', `/api/chats/${c.id}`, { avatar: id })),
      title, desc, link,
      c.avatar ? UI.row('trash', 'حذف عکس', null, async () => { try { await api('PATCH', `/api/chats/${c.id}`, { avatar: null }); m.close(); } catch (e) { toast(e.message); } }, 'danger') : null,
      c.role === 'owner' ? UI.row('trash', c.type === 'channel' ? 'حذف کانال' : 'حذف گروه', 'برای همه اعضا حذف می‌شود', async () => {
        if (await UI.ask('حذف برای همه', `«${c.title}» و همه پیام‌هایش برای همیشه حذف می‌شود.`, 'حذف', true)) {
          try { await api('DELETE', `/api/chats/${c.id}`); m.close(); App.removeChat(c.id); } catch (e) { toast(e.message); }
        }
      }, 'danger') : null,
    ],
    foot: [saveBtn, h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف')],
  });
  saveBtn.addEventListener('click', async () => {
    try {
      const { chat } = await api('PATCH', `/api/chats/${c.id}`, { title: title.input.value.trim(), description: desc.input.value.trim(), username: link.input.value.trim().replace(/^@/, '') || null });
      S.chats.set(chat.id, chat);
      m.close();
      toast('ذخیره شد');
    } catch (e) { toast(e.message); }
  });
};

/* ---------- info panel ---------- */
App.toggleInfo = () => {
  const info = $('#info');
  if (!info.hidden) { info.hidden = true; return; }
  App.openInfo(S.active);
};
App.openInfo = async (chatId, refresh) => {
  const c = S.chats.get(chatId);
  if (!c) return;
  const info = $('#info');
  const tab = refresh ? info.dataset.tab : null;
  info.hidden = false;
  info.dataset.chat = String(chatId);
  let details = { members: [] };
  if (c.type !== 'private') { try { details = await api('GET', `/api/chats/${chatId}`); } catch {} }
  if (S.active !== chatId || info.hidden) return;
  const st = R.chatStatus(c);
  const rows = h('div', { class: 'info-rows' });
  if (c.username) rows.append(UI.row(c.type === 'private' ? 'at' : 'link', c.type === 'private' ? '@' + c.username : publicUrl(c.username), c.type === 'private' ? 'نام کاربری' : 'لینک', () => copyText(c.type === 'private' ? '@' + c.username : publicUrl(c.username))));
  if (c.description) rows.append(UI.row('info', c.description, c.type === 'private' ? 'بیوگرافی' : 'توضیحات', () => copyText(c.description)));
  if (c.can_manage && c.invite_token) rows.append(UI.row('link', inviteUrl(c.invite_token), 'لینک دعوت', () => copyText(inviteUrl(c.invite_token), 'لینک کپی شد')));
  if (!isSaved(c)) rows.append(UI.switchRow('bell', 'اعلان‌ها', c.muted ? 'خاموش' : 'روشن', !c.muted, (v) => App.chatSetting(c, { muted: !v })));
  if (c.can_manage) {
    rows.append(UI.row('personAdd', c.type === 'channel' ? 'افزودن مشترک' : 'افزودن عضو', null, () => App.addMembersDialog(c)));
    if (!c.invite_token) rows.append(UI.row('link', 'ساخت لینک دعوت', null, () => App.inviteDialog(c)));
    rows.append(UI.row('edit', 'ویرایش', null, () => App.editChatDialog(c)));
  }
  rows.append(UI.row(c.type === 'private' ? 'trash' : 'logout', c.type === 'private' ? 'حذف گفتگو' : c.type === 'channel' ? 'ترک کانال' : 'ترک گروه', null, () => App.leaveOrDelete(c), 'danger'));

  const tabs = [];
  if (details.members.length) tabs.push(['members', c.type === 'channel' ? 'مشترک‌ها' : 'اعضا']);
  tabs.push(['media', 'رسانه'], ['file', 'فایل‌ها'], ['voice', 'صوت']);
  const tabBar = h('div', { class: 'info-tabs' });
  const content = h('div');
  const showTab = async (key) => {
    info.dataset.tab = key;
    $$('button', tabBar).forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    if (key === 'members') return content.replaceChildren(h('div', { class: 'info-list' }, details.members.map((u) => App.memberRow(c, u))));
    content.replaceChildren(h('div', { class: 'info-empty' }, 'در حال بارگذاری…'));
    try {
      const { messages } = await api('GET', `/api/chats/${chatId}/media?type=${key}`);
      if (info.dataset.tab !== key) return;
      if (!messages.length) return content.replaceChildren(h('div', { class: 'info-empty' }, 'چیزی نیست'));
      if (key === 'media') {
        content.replaceChildren(h('div', { class: 'media-grid' }, messages.map((m) => h('div', { class: 'mg', onclick: () => UI.lightbox(m) },
          m.kind === 'photo' ? h('img', { src: m.media.url, loading: 'lazy', alt: '' }) : h('video', { src: m.media.url, preload: 'metadata', muted: true }),
          m.kind === 'video' ? h('span', { class: 'vb' }, '▶ ' + fmtDur(m.media.duration || 0)) : null))));
      } else {
        content.replaceChildren(h('div', { class: 'info-list' }, messages.map((m) => h('div', { class: 'pick', onclick: () => App.jumpTo(chatId, m.id) },
          key === 'voice' ? userAvatar(m.sender, 's40') : h('span', { class: 'ficon avatar s40 g5' }, icon('file')),
          h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, key === 'voice' ? m.sender.display_name : m.media.name),
            h('div', { class: 's' }, `${fmtSize(m.media.size)} · ${fmtListTime(m.created_at)}`)),
          h('a', { class: 'ibtn', href: m.media.url, download: m.media.name, onclick: (e) => e.stopPropagation() }, icon('download'))))));
      }
    } catch (e) { content.replaceChildren(h('div', { class: 'info-empty' }, e.message)); }
  };
  tabs.forEach(([k, label]) => tabBar.append(h('button', { type: 'button', dataset: { k }, onclick: () => showTab(k) }, label)));

  const big = chatAvatar(c, 's120');
  big.addEventListener('click', () => {
    if (c.avatar) UI.lightbox({ kind: 'photo', media: { url: c.avatar, name: 'avatar.jpg' }, sender: c.peer || { display_name: c.title, id: c.id }, created_at: Date.now(), id: 0 });
  });
  info.replaceChildren(
    h('div', { class: 'info-head' }, ibtn('close', 'بستن', () => (info.hidden = true)),
      h('h3', {}, c.type === 'private' ? 'اطلاعات کاربر' : c.type === 'channel' ? 'اطلاعات کانال' : 'اطلاعات گروه'),
      c.can_manage ? ibtn('edit', 'ویرایش', () => App.editChatDialog(c)) : null),
    h('div', { class: 'info-body' },
      h('div', { class: 'info-top' }, big, h('div', { class: 't', dir: 'auto' }, chatTitle(c)), st.text ? h('div', { class: 'st' + (st.accent ? ' accent' : '') }, st.text) : null),
      rows, tabBar, content));
  showTab(tab && tabs.some((t) => t[0] === tab) ? tab : tabs[0][0]);
};

App.memberRow = (c, u) => {
  const roleLabel = u.role === 'owner' ? 'مالک' : u.role === 'admin' ? 'ادمین' : '';
  const row = h('div', { class: 'pick' }, userAvatar(u, 's40'),
    h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, u.id === S.me.id ? 'شما' : u.display_name),
      h('div', { class: 's' + (u.online ? ' accent' : '') }, lastSeenText(u))),
    roleLabel ? h('span', { class: 'role' }, roleLabel) : null);
  if (u.id === S.me.id) return row;
  row.addEventListener('click', (e) => {
    const owner = c.role === 'owner';
    const canKick = c.can_manage && u.role !== 'owner' && (u.role !== 'admin' || owner);
    UI.menu([
      { icon: 'user', label: 'ارسال پیام', onClick: () => App.openPrivateWith(u.username) },
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

/* ---------- settings ---------- */
App.settingsDialog = () => {
  const me = S.me;
  const name = UI.field('نام نمایشی', { value: me.display_name, maxlength: 64 });
  const uname = UI.field('نام کاربری', { value: me.username, dir: 'ltr', maxlength: 32 }, 'دیگران می‌توانند با @' + me.username + ' شما را پیدا کنند');
  const bio = UI.field('بیوگرافی', { multiline: true, rows: 2, value: me.bio || '', maxlength: 170 }, 'چند کلمه درباره خودتان');
  const saveBtn = h('button', { class: 'btn flat' }, 'ذخیره');
  const notifSupported = 'Notification' in window;
  const m = UI.modal({
    title: 'تنظیمات', wide: true,
    body: [
      avatarEditor({ name: me.display_name, avatar: me.avatar, seed: me.id }, async (id) => { S.me = (await api('PATCH', '/api/me', { avatar: id })).user; }),
      name, uname, bio,
      me.avatar ? UI.row('trash', 'حذف عکس پروفایل', null, async () => { try { S.me = (await api('PATCH', '/api/me', { avatar: null })).user; m.close(); toast('حذف شد'); } catch (e) { toast(e.message); } }, 'danger') : null,
      h('div', { class: 'set-group-title' }, 'ظاهر'),
      UI.switchRow('moon', 'حالت شب', null, S.settings.theme === 'dark', (v) => { S.settings.theme = v ? 'dark' : 'light'; saveSettings(); applyTheme(); }),
      h('div', { class: 'set-group-title' }, 'اعلان‌ها'),
      notifSupported ? UI.switchRow('bell', 'اعلان دسکتاپ', Notification.permission === 'denied' ? 'در تنظیمات مرورگر مسدود شده' : 'وقتی کبوتر باز نیست', S.settings.notify && Notification.permission === 'granted', async (v) => {
        if (v && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') throw new Error('اجازه اعلان داده نشد');
        }
        S.settings.notify = v; saveSettings();
      }) : null,
      UI.switchRow('bell', 'صدای پیام', null, S.settings.sound, (v) => { S.settings.sound = v; saveSettings(); if (v) App.beep(); }),
      h('div', { class: 'set-group-title' }, 'حریم خصوصی و امنیت'),
      UI.switchRow('eye', 'نمایش آخرین بازدید', 'اگر خاموش باشد، دیگران «به تازگی» می‌بینند', me.show_last_seen !== false, async (v) => { S.me = (await api('PATCH', '/api/me', { show_last_seen: v })).user; }),
      UI.row('devices', 'دستگاه‌های فعال', 'ببینید کجا وارد شده‌اید', () => App.sessionsDialog()),
      UI.row('key', 'تغییر رمز عبور', null, () => App.passwordDialog()),
      UI.row('logout', 'خروج از حساب', null, async () => { if (await UI.ask('خروج', 'از حساب خود خارج می‌شوید؟', 'خروج', true)) { m.close(); App.logout(false); } }, 'danger'),
    ],
    foot: [saveBtn, h('button', { class: 'btn flat', onclick: () => m.close() }, 'بستن')],
  });
  saveBtn.addEventListener('click', async () => {
    const body = { display_name: name.input.value.trim(), bio: bio.input.value.trim() };
    if (uname.input.value.trim().replace(/^@/, '') !== me.username) body.username = uname.input.value.trim().replace(/^@/, '');
    try {
      S.me = (await api('PATCH', '/api/me', body)).user;
      toast('ذخیره شد');
      m.close();
    } catch (e) { toast(e.message); }
  });
};

App.sessionsDialog = async () => {
  try {
    const { sessions } = await api('GET', '/api/sessions');
    const list = h('div');
    const paint = (items) => list.replaceChildren(...items.map((s) => h('div', { class: 'pick' },
      h('span', { class: 'avatar s40 ' + (s.current ? 'g3' : 'g5') }, icon('devices')),
      h('div', { class: 'body' }, h('div', { class: 'n' }, s.device + (s.current ? ' (این دستگاه)' : '')),
        h('div', { class: 's' }, `${s.ip || '—'} · ${s.current ? 'آنلاین' : 'آخرین فعالیت ' + fmtListTime(s.last_active)}`)),
      s.current ? null : ibtn('close', 'خاتمه نشست', async () => {
        try { await api('DELETE', `/api/sessions/${s.id}`); paint((await api('GET', '/api/sessions')).sessions); } catch (e) { toast(e.message); }
      }))));
    paint(sessions);
    UI.modal({
      title: 'دستگاه‌های فعال',
      body: [list],
      foot: sessions.length > 1 ? [h('button', { class: 'btn danger', onclick: async () => {
        if (!(await UI.ask('خاتمه همه نشست‌ها', 'از همه دستگاه‌های دیگر خارج می‌شوید.', 'خاتمه', true))) return;
        try { await api('POST', '/api/sessions/terminate-others'); paint((await api('GET', '/api/sessions')).sessions); toast('انجام شد'); } catch (e) { toast(e.message); }
      } }, 'خاتمه همه نشست‌های دیگر')] : null,
    });
  } catch (e) { toast(e.message); }
};

App.passwordDialog = () => {
  const cur = UI.field('رمز فعلی', { type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const next = UI.field('رمز جدید', { type: 'password', dir: 'ltr', autocomplete: 'new-password', minlength: 8 }, 'حداقل ۸ کاراکتر. بقیه دستگاه‌ها خارج می‌شوند.');
  const btn = h('button', { class: 'btn flat' }, 'تغییر رمز');
  const m = UI.modal({ title: 'تغییر رمز عبور', body: [cur, next], foot: [btn, h('button', { class: 'btn flat', onclick: () => m.close() }, 'انصراف')] });
  btn.addEventListener('click', async () => {
    try {
      await api('POST', '/api/me/password', { current_password: cur.input.value, new_password: next.input.value });
      m.close();
      toast('رمز عوض شد');
    } catch (e) { toast(e.message); }
  });
};

App.boot();
