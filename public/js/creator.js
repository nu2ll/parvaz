'use strict';
/* Kabootar: Telegram Android flows.
   - Profile / chat photo: source sheet (gallery, camera, remove) → circular cropper (drag, pinch, zoom, rotate, mirror)
   - New channel: name + photo + description → Public / Private type (live link check, invite link) → add subscribers
   - New group: add members → name + photo → create */

/* ---------- circular cropper ---------- */
UI.cropImage = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  const img = h('img', { class: 'crop-img', alt: '', draggable: 'false' });
  const stage = h('div', { class: 'crop-stage' }, img, h('div', { class: 'crop-hole' }));
  const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', class: 'crop-zoom', 'aria-label': 'بزرگنمایی' });
  let w = 0, hgt = 0, D = 0, base = 1, k = 1, tx = 0, ty = 0, rot = 0, flip = 1;
  const dims = () => (rot % 180 ? [hgt, w] : [w, hgt]);
  const clamp = () => {
    const [rw, rh] = dims();
    const s = base * k;
    const mx = Math.max(0, (rw * s - D) / 2), my = Math.max(0, (rh * s - D) / 2);
    tx = Math.max(-mx, Math.min(mx, tx));
    ty = Math.max(-my, Math.min(my, ty));
  };
  const paint = () => {
    clamp();
    img.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${base * k * flip}, ${base * k})`;
    zoom.value = String(k);
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    D = Math.max(120, Math.min(r.width, r.height) - 48);
    stage.style.setProperty('--d', D + 'px');
    const [rw, rh] = dims();
    base = rw && rh ? D / Math.min(rw, rh) : 1;
    paint();
  };
  const done = (out) => { URL.revokeObjectURL(url); ov.remove(); document.removeEventListener('keydown', onKey); resolve(out); };
  const finish = async () => {
    const size = 800;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    const f = size / D;
    ctx.translate(size / 2, size / 2);
    ctx.scale(f, f);
    ctx.translate(tx, ty);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(base * k * flip, base * k);
    ctx.drawImage(img, -w / 2, -hgt / 2, w, hgt);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    done(blob ? new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) : null);
  };
  const onKey = (e) => { if (e.key === 'Escape') done(null); else if (e.key === 'Enter') finish(); };
  // gestures: one pointer pans, two pointers pinch
  const pts = new Map();
  let last = null;
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = null; });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { tx += e.clientX - prev.x; ty += e.clientY - prev.y; }
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (last) k = Math.max(1, Math.min(4, k * (dist / last)));
      last = dist;
    }
    paint();
  });
  const lift = (e) => { pts.delete(e.pointerId); last = null; };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); k = Math.max(1, Math.min(4, k * (e.deltaY < 0 ? 1.08 : 0.93))); paint(); }, { passive: false });
  zoom.addEventListener('input', () => { k = Number(zoom.value); paint(); });
  const ov = h('div', { class: 'cropper' },
    h('div', { class: 'crop-top' }, ibtn('close', 'لغو', () => done(null)), h('span', {}, 'جابه‌جا کنید و اندازه را تنظیم کنید')),
    stage,
    h('div', { class: 'crop-bottom' },
      ibtn('oRotate', 'چرخش', () => { rot = (rot + 270) % 360; fit(); }),
      h('div', { class: 'crop-zoom-wrap' }, icon('image', 'sm'), zoom, icon('image')),
      ibtn('oMirror', 'قرینه', () => { flip *= -1; paint(); }),
      h('button', { class: 'crop-done', type: 'button', title: 'تأیید', onclick: finish }, icon('check'))));
  document.body.append(ov);
  document.addEventListener('keydown', onKey);
  img.onload = () => { w = img.naturalWidth; hgt = img.naturalHeight; img.style.width = w + 'px'; img.style.height = hgt + 'px'; fit(); };
  img.onerror = () => { toast('این تصویر باز نشد'); done(null); };
  img.src = url;
  window.addEventListener('resize', fit, { once: true });
});

/* ---------- photo source sheet (Android: gallery / camera / remove) ---------- */
const pickFile = (accept, capture) => new Promise((resolve) => {
  const inp = h('input', { type: 'file', accept });
  if (capture) inp.setAttribute('capture', capture);
  inp.addEventListener('change', () => resolve(inp.files[0] || null));
  inp.click();
});
// resolves { file } (already cropped), { remove: true } or null
App.choosePhoto = (anchor, { canRemove = false } = {}) => new Promise((resolve) => {
  let settled = false;
  const take = async (p) => {
    settled = true;
    const f = await p;
    if (!f) return resolve(null);
    if (f.type === 'image/gif') return resolve({ file: f });
    const out = await UI.cropImage(f);
    resolve(out ? { file: out } : null);
  };
  UI.menu([
    { icon: 'oImage', label: 'انتخاب از گالری', onClick: () => take(pickFile('image/jpeg,image/png,image/webp,image/gif')) },
    { icon: 'oCamera', label: 'گرفتن عکس', onClick: () => take(pickFile('image/*', 'user')) },
    canRemove ? { icon: 'oTrash', label: 'حذف عکس', danger: true, onClick: () => { settled = true; resolve({ remove: true }); } } : null,
  ], { anchor, onClose: () => setTimeout(() => { if (!settled) resolve(null); }, 0) });
});
App.uploadPhoto = async (choice) => {
  toast('در حال آپلود…');
  return uploadFile(choice.file, choice.file.name || 'avatar.jpg');
};
// shared by profile editing, group/channel creation and chat info
function avatarEditor(ent, onChange, opts = {}) {
  let current = ent;
  const box = h('div', { class: 'avatar-edit' + (opts.small ? ' small' : ''), title: 'تغییر عکس', role: 'button', tabindex: '0' }, avatarEl(ent, opts.small ? 's64' : 's120'), h('div', { class: 'ov' }, icon('camera')));
  box.addEventListener('click', async () => {
    const choice = await App.choosePhoto(box, { canRemove: !!current.avatar && !!opts.onRemove });
    if (!choice) return;
    try {
      if (choice.remove) { await opts.onRemove(); current = { ...current, avatar: null }; }
      else {
        const f = await App.uploadPhoto(choice);
        await onChange(f.id, f);
        current = { ...current, avatar: f.url };
      }
      box.firstChild.replaceWith(avatarEl(current, opts.small ? 's64' : 's120'));
    } catch (e) { toast(e.message); }
  });
  return box;
}
App.setProfilePhoto = async (anchor) => {
  const choice = await App.choosePhoto(anchor, { canRemove: !!S.me.avatar });
  if (!choice) return;
  try {
    if (choice.remove) S.me = (await api('PATCH', '/api/me', { avatar: null })).user;
    else { const f = await App.uploadPhoto(choice); S.me = (await api('PATCH', '/api/me', { avatar: f.id })).user; }
    toast(choice.remove ? 'عکس حذف شد' : 'عکس پروفایل تنظیم شد');
    App.renderSidebar();
    App.repaintMe();
  } catch (e) { toast(e.message); }
};

/* ---------- public link field with live availability check ---------- */
App.linkField = (initial = '', { chatId } = {}) => {
  const input = h('input', { type: 'text', dir: 'ltr', value: initial, maxlength: 32, autocomplete: 'off', spellcheck: 'false', placeholder: 'link' });
  const hint = h('div', { class: 'link-hint' });
  const box = h('div', { class: 'link-field' }, h('span', { class: 'pfx', dir: 'ltr' }, location.host + '/@'), input);
  const wrap = h('div', { class: 'link-wrap' }, box, hint);
  let state = { ok: false, value: '' }, t;
  const check = () => {
    clearTimeout(t);
    const v = input.value.trim().replace(/^@/, '');
    state = { ok: false, value: v };
    hint.className = 'link-hint';
    if (!v) { hint.textContent = ''; return; }
    if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(v)) {
      hint.className = 'link-hint bad';
      hint.textContent = /^[^a-zA-Z]/.test(v) ? 'لینک باید با حرف انگلیسی شروع شود.' : v.length < 4 ? 'لینک باید حداقل ۴ حرف باشد.' : 'فقط حروف a-z، عدد و _ مجاز است.';
      return;
    }
    hint.textContent = 'در حال بررسی…';
    t = setTimeout(async () => {
      try {
        const r = await api('GET', '/api/check-username?username=' + encodeURIComponent(v) + (chatId ? '&chat_id=' + chatId : ''));
        if (input.value.trim().replace(/^@/, '') !== v) return;
        state = { ok: r.valid && r.available, value: v };
        hint.className = 'link-hint ' + (state.ok ? 'good' : 'bad');
        hint.textContent = !r.valid ? 'این لینک معتبر نیست.' : r.available ? `${v} در دسترس است.` : 'این لینک قبلاً گرفته شده.';
      } catch { hint.textContent = ''; }
    }, 300);
  };
  input.addEventListener('input', check);
  if (initial) state = { ok: true, value: initial };
  return { el: wrap, input, get state() { return state; }, check };
};

/* ---------- new channel (Android: details → type → subscribers) ---------- */
App.newChatDialog = (type) => (type === 'channel' ? App.newChannelFlow() : App.newGroupFlow());

const detailsHead = (label, avatarRef) => {
  const title = UI.field(label, { maxlength: 128 });
  const av = avatarEditor({ name: '?', seed: Date.now() }, async (id) => { avatarRef.id = id; }, { small: true });
  return { title, el: h('div', { class: 'new-head' }, av, title) };
};

App.newChannelFlow = () => {
  const avatar = { id: null };
  const head = detailsHead('نام کانال', avatar);
  const desc = UI.field('توضیحات (اختیاری)', { multiline: true, rows: 2, maxlength: 255 });
  let chat = null;
  const tab = App.side.push({
    title: 'کانال جدید',
    body: [h('div', { class: 'section new-section' }, head.el, desc), h('div', { class: 'section-foot top' }, 'می‌توانید یک توضیح کوتاه برای کانال‌تان بنویسید.')],
    cls: 'settings-tab',
    fab: { icon: 'check', title: 'بعدی', onClick: async () => {
      const title = head.title.input.value.trim();
      if (!title) { head.title.classList.add('error'); head.title.input.focus(); navigator.vibrate?.(20); return; }
      tab.fab.disabled = true;
      try {
        if (!chat) {
          chat = (await api('POST', '/api/chats/channel', { title, description: desc.input.value.trim(), usernames: [] })).chat;
          if (avatar.id) await api('PATCH', `/api/chats/${chat.id}`, { avatar: avatar.id }).catch(() => {});
          S.chats.set(chat.id, chat);
          App.renderSidebar();
        } else {
          await api('PATCH', `/api/chats/${chat.id}`, { title, description: desc.input.value.trim() });
        }
        App.channelTypeStep(chat);
      } catch (e) { toast(e.message); }
      tab.fab.disabled = false;
    } },
  });
  head.title.input.addEventListener('input', () => head.title.classList.remove('error'));
  setTimeout(() => head.title.input.focus(), 60);
  return tab;
};

App.channelTypeStep = async (chat, { editing = false, slider = App.side, onSaved } = {}) => {
  const noun = chat.type === 'channel' ? 'کانال' : 'گروه';
  let kind = chat.username ? 'public' : 'private';
  const link = App.linkField(chat.username || '', { chatId: chat.id });
  let invite = chat.invite_token || null;
  const inviteBox = h('div', { class: 'invite-box' });
  const paintInvite = () => {
    const url = invite ? `${location.origin}/#/join/${invite}` : '…';
    inviteBox.replaceChildren(
      h('div', { class: 'invite-url', dir: 'ltr', onclick: () => invite && copyText(url, 'لینک کپی شد') }, url),
      h('div', { class: 'invite-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => invite && copyText(url, 'لینک کپی شد') }, 'کپی لینک'),
        navigator.share ? h('button', { class: 'btn', type: 'button', onclick: () => navigator.share({ url }).catch(() => {}) }, 'اشتراک‌گذاری') : null));
  };
  const publicPart = h('div', {}, h('div', { class: 'section-caption' }, 'لینک عمومی'), h('div', { class: 'pad' }, link.el),
    h('div', { class: 'section-foot' }, `اگر لینک عمومی بگذارید، هر کسی می‌تواند ${noun} را در جستجو پیدا کند و عضو شود. حروف a-z، عدد و _ ، حداقل ۴ حرف.`));
  const privatePart = h('div', {}, h('div', { class: 'section-caption' }, 'لینک دعوت'), inviteBox,
    h('div', { class: 'section-foot' }, `هر کسی این لینک را داشته باشد می‌تواند عضو ${noun} شود. هر وقت خواستید می‌توانید آن را باطل کنید.`));
  const detail = h('div', { class: 'section' });
  const paint = async () => {
    detail.replaceChildren(kind === 'public' ? publicPart : privatePart);
    if (kind === 'private' && !invite) {
      try { invite = (await api('POST', `/api/chats/${chat.id}/invite`, {})).invite_token; } catch {}
    }
    if (kind === 'private') paintInvite();
    else setTimeout(() => link.input.focus(), 50);
  };
  const radios = UI.radios([
    ['public', `${noun} عمومی`, `هر کسی می‌تواند ${noun}‌های عمومی را جستجو کند و عضو شود.`],
    ['private', `${noun} خصوصی`, `فقط با لینک دعوت می‌شود به ${noun}‌های خصوصی پیوست.`],
  ], kind, (v) => { kind = v; paint(); });
  const tab = slider.push({
    title: `نوع ${noun}`,
    cls: 'settings-tab',
    body: [UI.section(`نوع ${noun}`, radios), detail],
    fab: { icon: 'check', title: editing ? 'ذخیره' : 'بعدی', onClick: async () => {
      try {
        if (kind === 'public') {
          const st = link.state;
          if (!st.value) { link.input.focus(); return toast('یک لینک برای کانال عمومی بنویسید'); }
          if (!st.ok && st.value !== chat.username) { link.input.focus(); return toast('این لینک قابل استفاده نیست'); }
          if (st.value !== chat.username) chat = (await api('PATCH', `/api/chats/${chat.id}`, { username: st.value })).chat || chat;
        } else if (chat.username) chat = (await api('PATCH', `/api/chats/${chat.id}`, { username: null })).chat || chat;
        if (editing) { S.chats.set(chat.id, { ...S.chats.get(chat.id), ...chat }); slider.pop(tab); toast('ذخیره شد'); onSaved && onSaved(chat); return; }
        App.channelMembersStep(chat);
      } catch (e) { toast(e.message); }
    } },
  });
  paint();
  return tab;
};

App.channelMembersStep = (chat) => {
  const picker = userPicker({ multiple: true });
  const finish = async () => {
    const users = [...picker.selected.values()];
    if (users.length) { try { await api('POST', `/api/chats/${chat.id}/members`, { usernames: users.map((u) => u.username) }); } catch (e) { toast(e.message); } }
    App.side.popAll();
    App.openChat(chat.id);
  };
  App.side.push({ title: 'افزودن مشترک', body: picker.el, fab: { icon: 'check', title: 'تمام', onClick: finish } });
  setTimeout(() => picker.input.focus(), 60);
};

/* ---------- new group (Android: members → name + photo) ---------- */
App.newGroupFlow = () => {
  const picker = userPicker({ multiple: true, onChange: () => paintCount() });
  const tab = App.side.push({
    title: 'گروه جدید',
    body: picker.el,
    fab: { icon: 'back', title: 'بعدی', onClick: () => App.groupDetailsStep([...picker.selected.values()]) },
  });
  const paintCount = () => tab.setTitle(picker.selected.size ? `گروه جدید · ${fa(picker.selected.size)} عضو` : 'گروه جدید');
  setTimeout(() => picker.input.focus(), 60);
  return tab;
};
App.groupDetailsStep = (users) => {
  const avatar = { id: null };
  const head = detailsHead('نام گروه', avatar);
  const create = async () => {
    const title = head.title.input.value.trim();
    if (!title) { head.title.classList.add('error'); head.title.input.focus(); navigator.vibrate?.(20); return; }
    tab.fab.disabled = true;
    try {
      const { chat } = await api('POST', '/api/chats/group', { title, description: '', usernames: users.map((u) => u.username) });
      if (avatar.id) await api('PATCH', `/api/chats/${chat.id}`, { avatar: avatar.id }).catch(() => {});
      S.chats.set(chat.id, chat);
      App.side.popAll();
      App.openChat(chat.id);
    } catch (e) { toast(e.message); tab.fab.disabled = false; }
  };
  const members = [S.me, ...users];
  const tab = App.side.push({
    title: 'گروه جدید',
    cls: 'settings-tab',
    body: [h('div', { class: 'section new-section' }, head.el),
      UI.section(`${fa(members.length)} عضو`, h('div', { class: 'picker-list' }, members.map((u) => h('div', { class: 'pick' }, userAvatar(u, 's42'),
        h('div', { class: 'body' }, h('div', { class: 'n', dir: 'auto' }, u.id === S.me.id ? 'شما' : userName(u)), h('div', { class: 's' }, u.id === S.me.id ? 'آنلاین' : lastSeenText(u)))))))],
    fab: { icon: 'check', title: 'ساخت', onClick: create },
  });
  head.title.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  head.title.input.addEventListener('input', () => head.title.classList.remove('error'));
  setTimeout(() => head.title.input.focus(), 60);
};
