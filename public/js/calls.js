'use strict';
/* Kabootar — 1:1 voice & video calls over WebRTC. Signaling goes through the existing WebSocket. */

const Calls = {
  call: null,
  supported: () => typeof RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia,

  /* ---------- tones (WebAudio, no files) ---------- */
  tone(kind) { this.stopTone(); Sound.loop(kind === 'incoming' ? 'ringtone' : 'ringback'); },
  stopTone() { Sound.stop('ringtone'); Sound.stop('ringback'); },

  /* ---------- outgoing ---------- */
  async start(chat, video) {
    if (this.call) return toast('شما الان در تماس هستید');
    if (!this.supported()) return toast('مرورگر شما تماس را پشتیبانی نمی‌کند (HTTPS لازم است)');
    if (!S.wsReady) return toast(ERRORS.network);
    const peer = chat.peer;
    const call = this.call = { chatId: chat.id, peer, video, outgoing: true, state: 'requesting', polite: false, queued: [] };
    this.renderUI();
    try { call.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false }); }
    catch { this.cleanup(); return toast(video ? 'دسترسی به دوربین یا میکروفون داده نشد' : 'دسترسی به میکروفون داده نشد'); }
    if (this.call !== call) return call.local.getTracks().forEach((t) => t.stop());
    this.renderUI();
    try {
      const r = await App.wsRequest({ type: 'call_request', chat_id: chat.id, video });
      if (this.call !== call) return;
      call.id = r.call_id;
      call.ice = r.ice_servers;
      if (r.state === 'ended') return this.ended(r.reason === 'busy' ? 'busy' : 'unavailable');
      call.state = 'ringing';
      this.tone('ringback');
      this.renderUI();
    } catch (e) { toast(e.message); this.cleanup(); }
  },

  /* ---------- incoming ---------- */
  incoming(c) {
    if (this.call) return; // server already answered "busy"
    this.call = { id: c.id, chatId: c.chat_id, peer: c.from, video: c.video, outgoing: false, state: 'incoming', polite: true, queued: [] };
    this.tone('incoming');
    this.renderUI();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification(userName(c.from), { body: c.video ? 'تماس تصویری ورودی' : 'تماس صوتی ورودی', tag: 'call', requireInteraction: true, icon: c.from.avatar || '/icon.svg' }); n.onclick = () => { window.focus(); n.close(); }; this.call.note = n; } catch {}
    }
  },
  async accept(withVideo) {
    const call = this.call;
    if (!call || call.state !== 'incoming') return;
    this.stopTone();
    call.state = 'connecting';
    this.renderUI();
    try { call.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false }); }
    catch { try { call.local = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('دسترسی به میکروفون داده نشد'); return this.hangup(); } }
    call.video = withVideo && call.local.getVideoTracks().length > 0;
    try {
      const r = await App.wsRequest({ type: 'call_accept', call_id: call.id });
      call.ice = r.ice_servers;
      this.createPC();
      for (const q of call.queued.splice(0)) this.onSignal(q);
      this.renderUI();
    } catch (e) { toast(e.message); this.cleanup(); }
  },
  decline() { this.hangup(); },

  /* ---------- peer connection (perfect negotiation; callee is polite) ---------- */
  createPC() {
    const call = this.call;
    const pc = call.pc = new RTCPeerConnection({ iceServers: call.ice || [{ urls: 'stun:stun.l.google.com:19302' }] });
    call.remote = new MediaStream();
    call.makingOffer = false;
    call.ignoreOffer = false;
    pc.ontrack = (e) => {
      for (const t of e.streams[0]?.getTracks() || [e.track]) if (!call.remote.getTracks().includes(t)) call.remote.addTrack(t);
      e.track.onunmute = () => this.renderUI();
      this.renderUI();
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.signal({ candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        call.makingOffer = true;
        await pc.setLocalDescription();
        this.signal({ sdp: pc.localDescription });
      } catch (e) { console.error(e); } finally { call.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && call.state !== 'active') { call.state = 'active'; call.startedAt = Date.now(); this.renderUI(); }
      if (pc.connectionState === 'failed') { toast('اتصال تماس برقرار نشد'); this.hangup(); }
    };
    // the caller sends first; the callee attaches its tracks once the offer arrives
    if (call.outgoing) for (const t of call.local.getTracks()) pc.addTrack(t, call.local);
  },
  signal(data) { if (this.call?.id) App.wsSend({ type: 'call_signal', call_id: this.call.id, data }); },
  async onSignal(data) {
    const call = this.call;
    if (!call) return;
    if (!call.pc) { call.queued.push(data); return; }
    const pc = call.pc;
    try {
      if (data.state) { call.peerState = data.state; return this.renderUI(); }
      if (data.sdp) {
        const collision = data.sdp.type === 'offer' && (call.makingOffer || pc.signalingState !== 'stable');
        call.ignoreOffer = !call.polite && collision;
        if (call.ignoreOffer) return;
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          if (!call.tracksAdded && !call.outgoing) {
            call.tracksAdded = true;
            for (const t of call.local.getTracks()) pc.addTrack(t, call.local);
          }
          await pc.setLocalDescription();
          this.signal({ sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!call.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.error('[call]', e); }
  },

  /* ---------- controls ---------- */
  toggleMute() {
    const call = this.call;
    if (!call?.local) return;
    call.muted = !call.muted;
    call.local.getAudioTracks().forEach((t) => (t.enabled = !call.muted));
    this.signal({ state: { muted: call.muted, video: this.videoOn() } });
    this.renderUI();
  },
  videoOn() { const t = this.call?.local?.getVideoTracks()[0]; return !!t && t.enabled && t.readyState === 'live'; },
  async toggleVideo() {
    const call = this.call;
    if (!call?.local) return;
    let t = call.local.getVideoTracks()[0];
    if (t && !call.screen) { t.enabled = !t.enabled; }
    else if (!t) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
        t = cam.getVideoTracks()[0];
        call.local.addTrack(t);
        call.pc?.addTrack(t, call.local); // renegotiates
      } catch { return toast('دسترسی به دوربین داده نشد'); }
    }
    this.signal({ state: { muted: !!call.muted, video: this.videoOn() } });
    this.renderUI();
  },
  async shareScreen() {
    const call = this.call;
    if (!call?.pc) return;
    if (call.screen) return this.stopScreen();
    if (!navigator.mediaDevices.getDisplayMedia) return toast('اشتراک صفحه در این مرورگر ممکن نیست');
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const st = ds.getVideoTracks()[0];
      call.screen = st;
      const sender = call.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(st);
      else call.pc.addTrack(st, call.local);
      st.onended = () => this.stopScreen();
      this.renderUI();
    } catch {}
  },
  async stopScreen() {
    const call = this.call;
    if (!call?.screen) return;
    const cam = call.local.getVideoTracks()[0] || null;
    const sender = call.pc.getSenders().find((s) => s.track === call.screen);
    call.screen.stop();
    call.screen = null;
    if (sender) await sender.replaceTrack(cam).catch(() => {});
    this.renderUI();
  },
  async flipCamera() {
    const call = this.call;
    const old = call?.local?.getVideoTracks()[0];
    if (!old) return;
    call.facing = call.facing === 'environment' ? 'user' : 'environment';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: call.facing } });
      const nt = s.getVideoTracks()[0];
      const sender = call.pc?.getSenders().find((x) => x.track === old);
      if (sender) await sender.replaceTrack(nt);
      call.local.removeTrack(old); old.stop(); call.local.addTrack(nt);
      this.renderUI();
    } catch { toast('تعویض دوربین ممکن نشد'); }
  },
  hangup() {
    const call = this.call;
    if (!call) return;
    if (call.id) App.wsSend({ type: 'call_hangup', call_id: call.id });
    Sound.play('callEnd');
    this.cleanup();
  },

  /* ---------- events ---------- */
  onEvent(ev) {
    const call = this.call;
    switch (ev.type) {
      case 'call_incoming': return this.incoming(ev.call);
      case 'call_accepted':
        if (!call || call.id !== ev.call_id) return;
        this.stopTone();
        Sound.play('connected');
        call.state = 'connecting';
        this.createPC();
        this.renderUI();
        return;
      case 'call_signal':
        if (!call || call.id !== ev.call_id) return;
        return this.onSignal(ev.data);
      case 'call_ended':
        if (!call || call.id !== ev.call_id) return;
        if (ev.reason === 'answered_elsewhere') { this.cleanup(); return; }
        return this.ended(ev.reason);
    }
  },
  ended(reason) {
    const call = this.call;
    if (!call) return;
    call.state = 'ended';
    call.reason = reason;
    this.stopTone();
    Sound.play(reason === 'busy' ? 'busy' : 'callEnd');
    this.stopMedia();
    this.renderUI();
    setTimeout(() => { if (this.call === call) this.cleanup(); }, 1600);
  },
  stopMedia() {
    const call = this.call;
    if (!call) return;
    call.local?.getTracks().forEach((t) => t.stop());
    call.screen?.stop();
    try { call.pc?.close(); } catch {}
    call.note?.close?.();
  },
  cleanup(silent) {
    this.stopTone();
    if (!this.call) return;
    this.stopMedia();
    clearInterval(this.call.clock);
    this.call = null;
    const ui = this.ui;
    this.ui = null;
    if (ui) { ui.classList.add('hide'); setTimeout(() => ui.remove(), 200); }
  },

  /* ---------- UI (Web K call popup) ---------- */
  statusText() {
    const c = this.call;
    switch (c.state) {
      case 'requesting': return 'در حال برقراری تماس…';
      case 'ringing': return 'در حال زنگ خوردن…';
      case 'incoming': return c.video ? 'تماس تصویری ورودی' : 'تماس صوتی ورودی';
      case 'connecting': return 'در حال اتصال…';
      case 'active': return fmtDur((Date.now() - c.startedAt) / 1000);
      case 'ended': return { busy: 'مشغول است', declined: 'تماس رد شد', missed: 'پاسخی نداد', unavailable: 'در دسترس نیست', ended: 'تماس پایان یافت' }[c.reason] || 'تماس پایان یافت';
    }
    return '';
  },
  renderUI() {
    const c = this.call;
    if (!c) return;
    if (!this.ui) {
      this.ui = h('div', { class: 'call-ui' });
      document.body.append(this.ui);
    }
    const ui = this.ui;
    const hasRemoteVideo = c.remote?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted) && c.peerState?.video !== false;
    let remoteV = $('video.cu-remote', ui), localV = $('video.cu-local', ui), remoteA = $('audio.cu-audio', ui);
    if (!remoteV) {
      remoteV = h('video', { class: 'cu-remote', autoplay: true, playsinline: true });
      localV = h('video', { class: 'cu-local', autoplay: true, playsinline: true, muted: true });
      localV.muted = true;
      remoteA = h('audio', { class: 'cu-audio', autoplay: true });
    }
    if (c.remote && remoteV.srcObject !== c.remote) { remoteV.srcObject = c.remote; remoteA.srcObject = c.remote; }
    if (c.local && localV.srcObject !== c.local) localV.srcObject = c.local;
    remoteV.muted = true; // audio plays through the <audio> element
    const btn = (ic, label, onClick, cls = '') => h('div', { class: 'cu-btn ' + cls }, h('button', { type: 'button', onclick: onClick, 'aria-label': label }, icon(ic)), h('span', {}, label));
    const status = h('div', { class: 'cu-status' }, this.statusText());
    const actions = c.state === 'incoming'
      ? [btn('callEnd', 'رد', () => this.decline(), 'red'), c.video ? btn('video', 'پاسخ با تصویر', () => this.accept(true), 'green') : null, btn('phone', 'پاسخ', () => this.accept(false), 'green')]
      : c.state === 'ended' ? [] : [
        btn(this.videoOn() ? 'video' : 'videoOff', 'دوربین', () => this.toggleVideo(), this.videoOn() ? 'on' : ''),
        c.pc && navigator.mediaDevices?.getDisplayMedia ? btn('screen', 'صفحه', () => this.shareScreen(), c.screen ? 'on' : '') : null,
        btn(c.muted ? 'micOff' : 'mic', c.muted ? 'صدادار' : 'بی‌صدا', () => this.toggleMute(), c.muted ? 'on' : ''),
        btn('callEnd', 'پایان', () => this.hangup(), 'red'),
      ];
    ui.className = 'call-ui ' + c.state + (hasRemoteVideo ? ' has-video' : '') + (this.videoOn() ? ' local-video' : '') + (c.mini ? ' mini' : '');
    ui.replaceChildren(
      h('div', { class: 'cu-bg' + (c.peer.avatar ? '' : ' g' + (c.peer.id % 7)) }, c.peer.avatar ? h('img', { src: c.peer.avatar, alt: '' }) : null),
      remoteV, remoteA, localV,
      h('div', { class: 'cu-top' }, ibtn(c.mini ? 'fullscreen' : 'minimize', c.mini ? 'بزرگ کردن' : 'کوچک کردن', () => { c.mini = !c.mini; this.renderUI(); }),
        h('span', { class: 'cu-enc' }, icon('lock'), c.video ? 'تماس تصویری' : 'تماس صوتی'), c.local?.getVideoTracks().length > 1 || /Android|iPhone|iPad/.test(navigator.userAgent || '') ? ibtn('flipCam', 'تعویض دوربین', () => this.flipCamera()) : h('span')),
      h('div', { class: 'cu-info', onclick: () => { if (c.mini) { c.mini = false; this.renderUI(); } } },
        userAvatar(c.peer, 's120'), h('div', { class: 'cu-name', dir: 'auto' }, userName(c.peer)), status,
        c.peerState?.muted ? h('div', { class: 'cu-flag' }, icon('micOff'), 'میکروفون طرف مقابل خاموش است') : null),
      h('div', { class: 'cu-actions' }, actions));
    clearInterval(c.clock);
    if (c.state === 'active') c.clock = setInterval(() => { if (this.call === c) status.textContent = this.statusText(); }, 1000);
  },
};

App.startCall = (c, video) => Calls.start(c, video);
