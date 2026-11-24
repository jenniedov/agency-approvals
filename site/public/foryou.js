/* For You: vertical full-screen approvals feed. Plain JS, no build step.
   API contract: docs/API.md. ?mock=1 runs against an in-memory mock (for building without the Worker). */
(() => {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const MOCK = qs.get('mock') === '1';
  const PARTS = ['video', 'caption', 'cover'];
  const SPEEDS = [1, 1.5, 2];

  /* ---------- tiny helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function h(tag, a, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(3)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }
  const K = (...a) => a.flat(3).filter((x) => x != null && x !== false);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const round1 = (n) => Math.round((n || 0) * 10) / 10;
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const parseJSON = (v) => { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v); } catch { return null; } };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fy.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fy.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* no-op */ } };

  const ICON = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    comment: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4a8.5 8.5 0 1 1 15.6-4.6z"/>',
    send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    music: '<path d="M9 18V5.5l11-2.5v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
    play: '<path d="M7.5 4.8v14.4L19.5 12z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>',
    vol: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>',
    undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    brush: '<path d="M14.5 4.5l5 5L11 18l-5-5z"/><path d="M6 13c-2 0-3 1.5-3 3.5 0 1-.5 2-1.5 2.5 3 .5 7 0 7.5-3"/>',
    rotate: '<rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M8 3.5c3-1 6.5-.5 9 2M17 2.5v3h-3"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    back3: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v3.7h3.7"/>',
    clean: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 4.5v15"/>',
    speed: '<path d="M12 20a8 8 0 1 1 8-8"/><path d="M12 12l4.5-3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    home: '<path d="M4 11l8-6.5 8 6.5v8.5h-5.5v-5h-5v5H4z"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  /* ---------- state ---------- */
  const S = {
    user: null, brand: null, groups: [], posts: new Map(), clients: new Map(), allClients: null, tracks: null,
    cards: [], active: null, speed: SPEEDS.includes(store.get('speed', 1)) ? store.get('speed', 1) : 1,
    muted: store.get('muted', false), forcedMute: false, clean: false, sheet: null, modal: null,
  };
  const feed = $('#feed');
  const sheetRoot = $('#sheetRoot');

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    if (MOCK) return mockApi(path, opts);
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    // The Worker answers 415 to any non-GET without a JSON body, so always send one.
    if (init.method !== 'GET') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body ?? {}); }
    const res = await fetch(path, init);
    if (res.status === 401) { location.replace('/'); throw new Error('unauthorized'); }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) { const e = new Error((data && data.error) || 'http_' + res.status); e.status = res.status; throw e; }
    return data || {};
  }

  function normPost(p) {
    p.music = parseJSON(p.music);
    p.comments = Array.isArray(p.comments) ? p.comments : [];
    p.comments.forEach(normComment);
    PARTS.forEach((k) => { p[k + '_state'] = p[k + '_state'] || 'pending'; });
    return p;
  }
  function normComment(c) { c.drawing = parseJSON(c.drawing); return c; }
  function mergePost(post, fresh) {
    const keep = post.comments;
    const t = post._t;
    Object.assign(post, normPost(fresh));
    if (!Array.isArray(fresh.comments) || !fresh.comments.length) post.comments = keep;
    post._t = t;
  }
  const isPending = (p) => PARTS.some((k) => p[k + '_state'] === 'pending');
  const clientOf = (p) => S.clients.get(p.client_id) || { id: p.client_id, name: p.client_name || '' };

  /* ---------- toast / confirm ---------- */
  let toastTimer = 0;
  function toast(msg, opt = {}) {
    const t = $('#toast');
    t.replaceChildren(...K(h('span', {}, msg)));
    if (opt.action) t.append(h('button', { type: 'button', onclick: () => { t.classList.remove('show'); opt.fn(); } }, opt.action));
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), opt.ms || (opt.action ? 4500 : 2200));
  }

  function confirmBox({ title, text, ok = 'אישור', cancel = 'ביטול', danger = false }) {
    return new Promise((resolve) => {
      const done = (v) => { S.modal = null; wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 200); resolve(v); };
      const wrap = h('div', { class: 'fy-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'fy-modal-back', onclick: () => done(false) }),
        h('div', { class: 'fy-modal-box' },
          h('h2', {}, title),
          text ? h('p', {}, text) : null,
          h('div', { class: 'fy-modal-acts' },
            h('button', { type: 'button', class: 'btn ghost', onclick: () => done(false) }, cancel),
            h('button', { type: 'button', class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, ok))));
      document.body.append(wrap);
      S.modal = { close: () => done(false) };
      requestAnimationFrame(() => { wrap.classList.add('in'); $('.btn.primary, .btn.danger', wrap).focus(); });
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback below */ }
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text;
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }

  /* ---------- avatars ---------- */
  function avatar(c, size = 32) {
    const el = h('span', { class: 'av', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' }, 'aria-hidden': 'true' });
    if (c && c.avatar) el.append(h('img', { src: c.avatar, alt: '', loading: 'lazy', decoding: 'async' }));
    else { el.textContent = ((c && c.name) || '?').trim().charAt(0); if (c && c.color) el.style.background = c.color; }
    return el;
  }

  /* ================================================================
     Player: one shared <video>, moved into the active card.
     One element = one decoder on iPhone, and once sound is unlocked
     by a tap it stays unlocked for every following video.
     ================================================================ */
  const P = { el: null, card: null, post: null, srcs: [], si: 0, raf: 0, scrub: false };

  function makeVideo() {
    const v = document.createElement('video');
    v.className = 'vid';
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('disableremoteplayback', '');
    v.disablePictureInPicture = true;
    v.preload = 'auto';
    v.loop = true;
    v.muted = S.muted;
    v.addEventListener('error', onVideoError);
    v.addEventListener('volumechange', () => { if (!v.muted) S.forcedMute = false; syncMute(); });
    v.addEventListener('playing', () => P.card && P.card.classList.remove('buffering', 'paused', 'err'));
    v.addEventListener('play', () => P.card && P.card.classList.remove('paused'));
    v.addEventListener('pause', () => P.card && !P.scrub && P.card.classList.add('paused'));
    v.addEventListener('waiting', () => P.card && P.card.classList.add('buffering'));
    v.addEventListener('canplay', () => P.card && P.card.classList.remove('buffering'));
    v.addEventListener('loadeddata', () => P.card && P.card.classList.add('ready'));
    v.addEventListener('loadedmetadata', () => { if (P.card) { drawInk(P.card); renderMarks(P.post); } });
    return v;
  }

  function sourcesFor(post) {
    const ver = post.version || {};
    const out = (Array.isArray(ver.mp4) ? ver.mp4 : []).filter(Boolean);
    if (ver.hls && P.el.canPlayType('application/vnd.apple.mpegurl')) out.push(ver.hls);
    return out;
  }

  function attach(card) {
    if (P.card === card) { if (!S.sheet && P.el.paused && !card._userPaused) play(); return; }
    detach();
    const post = card._fy.post;
    P.card = card; P.post = post; P.srcs = sourcesFor(post); P.si = 0;
    card.classList.add('attached', 'buffering');
    card.classList.remove('err', 'paused', 'ready');
    card._userPaused = false;
    const vbox = $('.vbox', card);
    vbox.insertBefore(P.el, $('.ink', vbox));
    if (!P.srcs.length) { showVideoError(card, 'אין עדיין קובץ וידאו'); return; }
    P.el.muted = S.muted || S.forcedMute;
    syncMute();
    const t = post._t || 0;
    if (t > 0.5) P.el.addEventListener('loadedmetadata', () => { try { P.el.currentTime = t; } catch { /* ignore */ } }, { once: true });
    P.el.src = P.srcs[0];
    P.el.defaultPlaybackRate = S.speed;
    P.el.playbackRate = S.speed;
    play();
    startRaf();
  }

  function detach() {
    if (!P.card) return;
    if (P.post) P.post._t = P.el.currentTime || 0;
    P.el.pause();
    P.card.classList.remove('attached', 'buffering', 'paused', 'fast', 'peek', 'ready');
    P.card = null; P.post = null;
    P.el.removeAttribute('src');
    try { P.el.load(); } catch { /* frees the decoder */ }
    P.el.remove();
    cancelAnimationFrame(P.raf);
  }

  async function play() {
    if (!P.card || !P.el.getAttribute('src')) return;
    P.el.playbackRate = P.card.classList.contains('fast') ? 2 : S.speed;
    try { await P.el.play(); }
    catch (e) {
      if (e && e.name === 'NotAllowedError' && !P.el.muted) {
        // Autoplay with sound blocked: play muted and offer sound.
        P.el.muted = true; S.forcedMute = true; syncMute();
        try { await P.el.play(); } catch { P.card && P.card.classList.add('paused'); }
      } else if (e && e.name === 'NotAllowedError') { P.card && P.card.classList.add('paused'); }
    }
  }

  function togglePause(card) {
    if (P.card !== card) return;
    if (P.el.paused) { card._userPaused = false; play(); flash(card, 'play'); }
    else { card._userPaused = true; P.el.pause(); }
  }

  function onVideoError() {
    if (!P.card || !P.el.error) return;
    const want = P.srcs[P.si] && new URL(P.srcs[P.si], location.href).href;
    if (P.el.src !== want) return; // stale error from a source we already left
    P.si++;
    if (P.si < P.srcs.length) { P.el.src = P.srcs[P.si]; play(); }
    else showVideoError(P.card, 'הסרטון לא נטען');
  }

  function showVideoError(card, msg) {
    card.classList.remove('buffering');
    card.classList.add('err');
    const box = $('.verr', card);
    box.replaceChildren(...K(h('span', {}, msg),
      P.srcs.length ? h('button', { type: 'button', class: 'btn small', onclick: (e) => { e.stopPropagation(); P.card = null; card.classList.remove('err'); P.el.remove(); attach(card); } }, 'לנסות שוב') : null));
  }

  function setMuted(m, byUser = true) {
    S.muted = m; S.forcedMute = false;
    if (byUser) store.set('muted', m);
    P.el.muted = m;
    if (!m && P.card && P.el.paused && !P.card._userPaused) play();
    syncMute();
  }
  function syncMute() {
    const m = P.el.muted;
    $$('.mute').forEach((b) => { b.innerHTML = icon(m ? 'mute' : 'vol'); b.setAttribute('aria-label', m ? 'הפעלת שמע' : 'השתקה'); });
    document.body.classList.toggle('forced-mute', S.forcedMute && m);
  }

  function setSpeed(x) {
    S.speed = x; store.set('speed', x);
    P.el.defaultPlaybackRate = x;
    if (!(P.card && P.card.classList.contains('fast'))) P.el.playbackRate = x;
    $$('.speed-tag').forEach((t) => { t.textContent = x === 1 ? '' : '×' + x; });
  }

  function flash(card, kind) {
    const f = $('.vflash', card);
    f.innerHTML = icon(kind);
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  /* progress bar */
  function startRaf() {
    cancelAnimationFrame(P.raf);
    const tick = () => { if (!P.card) return; updateProgress(); P.raf = requestAnimationFrame(tick); };
    P.raf = requestAnimationFrame(tick);
  }
  function duration(post) {
    if (P.post === post && isFinite(P.el.duration) && P.el.duration > 0) return P.el.duration;
    return (post.version && post.version.duration) || 0;
  }
  function updateProgress() {
    const card = P.card; if (!card) return;
    const d = duration(P.post), t = P.el.currentTime || 0;
    const f = d ? clamp(t / d, 0, 1) : 0;
    const fill = card._prog.fill; fill.style.transform = 'scaleX(' + f + ')';
    card._prog.knob.style.left = (f * 100) + '%';
    if (P.scrub || card.classList.contains('paused') || S.sheet) card._prog.time.textContent = fmt(t) + ' / ' + fmt(d);
    if (S.sheet && S.sheet.onTick) S.sheet.onTick(t);
  }

  function buildProgress(card, post) {
    const fill = h('div', { class: 'prog-fill' });
    const marks = h('div', { class: 'prog-marks' });
    const knob = h('div', { class: 'prog-knob' });
    const time = h('div', { class: 'prog-time' });
    const track = h('div', { class: 'prog-track' }, fill, marks, knob);
    const prog = h('div', { class: 'prog', role: 'slider', 'aria-label': 'מיקום בסרטון', tabindex: '-1' }, time, track);
    card._prog = { fill, marks, knob, time, track };
    let wasPlaying = false;
    const seekAt = (e, fast) => {
      const r = track.getBoundingClientRect();
      const f = clamp((e.clientX - r.left) / r.width, 0, 1);
      const d = duration(post); if (!d) return;
      const t = f * d;
      if (fast && typeof P.el.fastSeek === 'function') P.el.fastSeek(t); else P.el.currentTime = t;
      fill.style.transform = 'scaleX(' + f + ')'; knob.style.left = (f * 100) + '%';
      time.textContent = fmt(t) + ' / ' + fmt(d);
    };
    prog.addEventListener('pointerdown', (e) => {
      if (P.card !== card) return;
      e.preventDefault(); e.stopPropagation();
      prog.setPointerCapture(e.pointerId);
      P.scrub = true; card.classList.add('scrubbing');
      wasPlaying = !P.el.paused; P.el.pause();
      seekAt(e, true);
    });
    prog.addEventListener('pointermove', (e) => { if (P.scrub && P.card === card) seekAt(e, true); });
    const end = (e) => {
      if (!P.scrub) return;
      if (e.type === 'pointerup') seekAt(e, false);
      P.scrub = false; card.classList.remove('scrubbing');
      if (wasPlaying && !S.sheet) play(); else card.classList.add('paused');
    };
    prog.addEventListener('pointerup', end);
    prog.addEventListener('pointercancel', end);
    return prog;
  }

  function renderMarks(post) {
    const card = cardFor(post, 'video'); if (!card || !card._prog) return;
    const d = duration(post);
    card._prog.marks.replaceChildren(...K(...(d ? videoComments(post).filter((c) => c.at_sec != null)
      .map((c) => h('i', { style: { left: clamp(c.at_sec / d, 0, 1) * 100 + '%' }, class: c.status === 'done' ? 'done' : '' })) : [])));
  }

  /* gestures on the video: tap = pause, hold right side = 2x, hold elsewhere = peek (hide overlays) */
  function bindGestures(card, gest) {
    let start = null, timer = 0, held = null;
    const release = () => {
      if (held === 'fast') { card.classList.remove('fast'); P.el.playbackRate = S.speed; }
      if (held === 'peek') { card.classList.remove('peek'); if (!card._userPaused) play(); }
      held = null;
    };
    gest.addEventListener('pointerdown', (e) => {
      if (P.card !== card || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!start) return;
        const r = gest.getBoundingClientRect();
        if (start.x - r.left > r.width * 0.62) {
          held = 'fast'; card.classList.add('fast'); P.el.playbackRate = 2; if (P.el.paused) P.el.play().catch(() => {});
        } else { held = 'peek'; card.classList.add('peek'); P.el.pause(); }
        vibrate(8);
      }, 380);
    });
    gest.addEventListener('pointermove', (e) => {
      if (start && !held && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { clearTimeout(timer); start = null; }
    });
    gest.addEventListener('pointerup', () => {
      clearTimeout(timer);
      if (held) { release(); start = null; return; }
      if (start && performance.now() - start.t < 380) togglePause(card);
      start = null;
    });
    gest.addEventListener('pointercancel', () => { clearTimeout(timer); start = null; if (held) release(); });
    gest.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ================================================================
     Drawing layer (normalised to the visible video picture)
     drawing JSON: {v:1, strokes:[{c:"#hex", w:0.008, p:[[x,y],...]}]}  x,y in 0..1
     ================================================================ */
  function contentRect(card) {
    const box = $('.vbox', card);
    const W = box.clientWidth, H = box.clientHeight;
    const post = card._fy.post, ver = post.version || {};
    let ar = (P.card === card && P.el.videoWidth) ? P.el.videoWidth / P.el.videoHeight
      : (ver.width && ver.height) ? ver.width / ver.height : (post.orientation === 'horizontal' ? 16 / 9 : 9 / 16);
    let w = W, hh = W / ar;
    if (hh > H) { hh = H; w = H * ar; }
    return { x: (W - w) / 2, y: (H - hh) / 2, w, h: hh, W, H };
  }
  function sizeInk(card) {
    const c = $('.ink', card), box = $('.vbox', card);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(box.clientWidth * dpr), hh = Math.round(box.clientHeight * dpr);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    drawInk(card);
  }
  function drawInk(card) {
    const c = $('.ink', card); if (!c) return;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const d = card._ink;
    if (!d || !Array.isArray(d.strokes) || !d.strokes.length) return;
    const dpr = c.width / Math.max(1, $('.vbox', card).clientWidth);
    ctx.scale(dpr, dpr);
    const r = contentRect(card);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of d.strokes) {
      if (!s.p || !s.p.length) continue;
      ctx.strokeStyle = s.c || '#fff';
      ctx.lineWidth = Math.max(2, (s.w || 0.008) * r.w);
      ctx.beginPath();
      s.p.forEach(([x, y], i) => { const px = r.x + x * r.w, py = r.y + y * r.h; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      if (s.p.length === 1) ctx.lineTo(r.x + s.p[0][0] * r.w + 0.1, r.y + s.p[0][1] * r.h);
      ctx.stroke();
    }
  }
  function showInk(card, drawing) { card._ink = drawing || null; drawInk(card); }

  function bindInkInput(card) {
    const c = $('.ink', card);
    let stroke = null;
    const pt = (e) => {
      const b = c.getBoundingClientRect(), r = contentRect(card);
      return [round4(clamp((e.clientX - b.left - r.x) / r.w, 0, 1)), round4(clamp((e.clientY - b.top - r.y) / r.h, 0, 1))];
    };
    c.addEventListener('pointerdown', (e) => {
      const C = S.sheet && S.sheet.draw; if (!C || !C.on) return;
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      stroke = { c: C.color, w: 0.008, p: [pt(e)] };
      C.drawing.strokes.push(stroke); showInk(card, C.drawing);
    });
    c.addEventListener('pointermove', (e) => {
      if (!stroke) return;
      const p = pt(e), last = stroke.p[stroke.p.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004) return;
      stroke.p.push(p); drawInk(card);
    });
    const end = () => { if (stroke) { stroke = null; S.sheet && S.sheet.draw && S.sheet.draw.changed(); } };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  }
  const round4 = (n) => Math.round(n * 10000) / 10000;

  /* ================================================================
     Cards
     ================================================================ */
  const cardFor = (post, type) => S.cards.find((c) => c._fy.post === post && c._fy.type === type);
  const videoComments = (post) => post.comments.filter((c) => (c.target || 'video') === 'video')
    .sort((a, b) => (a.at_sec ?? 1e9) - (b.at_sec ?? 1e9) || a.id - b.id);

  function groupIntro(group) {
    return h('div', { class: 'gintro', 'data-client': group.client.id },
      avatar(group.client, 30),
      h('b', {}, group.client.name),
      h('span', { class: 'gcount' }, ''));
  }

  function videoCard(post, group, first) {
    const horizontal = post.orientation === 'horizontal';
    const card = h('section', { class: 'card card-video' + (horizontal ? ' card-h' : ''), 'data-post': post.id, 'data-client': post.client_id, 'aria-label': post.title || 'סרטון' });
    card._fy = { type: 'video', post, group };
    const ver = post.version || {};
    const gest = h('div', { class: 'gest' });
    const vbox = h('div', { class: 'vbox' },
      ver.thumb || post.cover_url ? h('img', { class: 'poster', src: ver.thumb || post.cover_url, alt: '', decoding: 'async', loading: S.cards.length < 4 ? 'eager' : 'lazy' }) : null,
      h('canvas', { class: 'ink' }),
      gest,
      h('div', { class: 'vstate', 'aria-hidden': 'true', html: icon('play') }),
      h('div', { class: 'vflash', 'aria-hidden': 'true' }),
      h('div', { class: 'vspin', 'aria-hidden': 'true' }),
      h('div', { class: 'fastpill', 'aria-hidden': 'true' }, '×2', h('span', { html: icon('play') + icon('play') })),
      h('div', { class: 'verr' }),
      h('div', { class: 'burst', 'aria-hidden': 'true', html: icon('check') }),
      h('button', { type: 'button', class: 'mute', onclick: (e) => { e.stopPropagation(); setMuted(!P.el.muted); } }),
      h('button', { type: 'button', class: 'soundhint', onclick: (e) => { e.stopPropagation(); setMuted(false); } }, 'השמע כבוי · הקישי להפעלה'),
      buildProgress(card, post));
    bindGestures(card, gest);

    if (!horizontal) {
      vbox.append(...K(
        first ? groupIntro(group) : null,
        h('div', { class: 'info' },
          h('div', { class: 'info-client' }, avatar(clientOf(post), 28), h('b', {}, clientOf(post).name || post.client_name || ''),
            h('span', { class: 'speed-tag' }, S.speed === 1 ? '' : '×' + S.speed)),
          h('div', { class: 'info-title' }, post.title || ''),
          h('div', { class: 'info-meta' }, versionLine(post)),
          post.caption ? h('div', { class: 'info-cap' }, post.caption) : null)));
      card.append(h('div', { class: 'stage' }, vbox, h('div', { class: 'rail' })));
    } else {
      vbox.append(h('button', { type: 'button', class: 'fullbtn', 'aria-label': 'מסך מלא', html: icon('full'), onclick: (e) => { e.stopPropagation(); goFull(card); } }));
      card.append(h('div', { class: 'h-wrap' },
        first ? groupIntro(group) : null,
        vbox,
        h('div', { class: 'h-body' },
          h('div', { class: 'h-title' }, post.title || ''),
          h('div', { class: 'h-client' }, avatar(clientOf(post), 26), h('b', {}, clientOf(post).name || ''), h('span', {}, versionLine(post))),
          h('div', { class: 'rail rail-row' }),
          h('div', { class: 'h-rotate', html: icon('rotate') + '<span>אפשר לסובב את הטלפון לצפייה רחבה</span>' }),
          h('div', { class: 'h-comments' }))));
    }
    new ResizeObserver(() => sizeInk(card)).observe(vbox);
    bindInkInput(card);
    return card;
  }

  function versionLine(post) {
    const v = post.version;
    if (!v) return 'עוד אין גרסה';
    return 'גרסה ' + v.n + (v.note ? ' · ' + v.note : '') + (v.duration ? ' · ' + fmt(v.duration) : '');
  }

  function goFull(card) {
    const box = $('.vbox', card);
    if (P.card === card && P.el.webkitEnterFullscreen && !box.requestFullscreen) { P.el.webkitEnterFullscreen(); return; }
    if (box.requestFullscreen) box.requestFullscreen().catch(() => { if (P.el.webkitEnterFullscreen) P.el.webkitEnterFullscreen(); });
    else if (P.el.webkitEnterFullscreen) P.el.webkitEnterFullscreen();
  }

  /* --- action rail --- */
  const STATE_LABEL = { pending: 'אישור', approved: 'מוכן', changes: 'לא מאושר' };
  function railButton(cls, ico, label, onTap, extra = {}) {
    const b = h('button', { type: 'button', class: 'rb ' + cls, 'aria-label': extra.aria || label },
      h('span', { class: 'rb-ic', html: icon(ico) }), h('span', { class: 'rb-l' }, label));
    if (extra.badge != null) b.append(h('span', { class: 'rb-badge' }, extra.badge));
    if (extra.onHold) {
      let t = 0, fired = false;
      b.addEventListener('pointerdown', () => { fired = false; t = setTimeout(() => { fired = true; vibrate(10); extra.onHold(); }, 450); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(t)));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (fired) { fired = false; return; } onTap(); });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    } else b.addEventListener('click', (e) => { e.stopPropagation(); onTap(); });
    return b;
  }

  function buildRail(post) {
    const vs = post.video_state;
    const n = videoComments(post).length;
    const music = post.music && post.music.title;
    const shared = post.client_state === 'pending' || post.stage === 'client';
    const rail = h('div', { class: 'rail-in' },
      railButton('approve st-' + vs, 'check', STATE_LABEL[vs],
        () => (vs === 'pending' ? setState(post, 'video', 'approved') : stateChooser(post, 'video')),
        { onHold: () => stateChooser(post, 'video'), aria: 'אישור הסרטון: ' + STATE_LABEL[vs] }),
      railButton('reject' + (vs === 'changes' ? ' on' : ''), 'x', 'לתקן',
        () => (vs === 'changes' ? stateChooser(post, 'video') : rejectVideo(post)), { aria: 'הסרטון לא מאושר' }),
      railButton('comments', 'comment', n ? String(n) : 'הערות', () => openComments(post), { aria: 'הערות (' + n + ')' }),
      railButton('share' + (shared ? ' on' : ''), 'send', shared ? 'נשלח' : 'שליחה', () => openShare(post)),
      railButton('music' + (music ? ' on' : ''), 'music', music ? music : 'מוזיקה', () => openMusic(post), { aria: 'מוזיקה' + (music ? ': ' + music : '') }),
      railButton('more', 'more', 'עוד', () => openMore(post)));
    return rail;
  }

  function rejectVideo(post) {
    setState(post, 'video', 'changes');
    toast('סומן כלא מאושר', { action: 'מה לתקן?', fn: () => openComments(post, { focus: true }) });
  }

  function stateChooser(post, part) {
    const cur = post[part + '_state'];
    const names = { video: 'הסרטון', caption: 'הכיתוב', cover: 'העטיפה' };
    const opt = (state, ico, label, sub) => h('button', {
      type: 'button', class: 'choice st-' + state + (cur === state ? ' cur' : ''),
      onclick: () => { closeSheet(); setState(post, part, state); if (state === 'changes' && part === 'video') setTimeout(() => openComments(post, { focus: true }), 320); },
    }, h('span', { class: 'choice-ic', html: icon(ico) }), h('span', { class: 'choice-t' }, h('b', {}, label), sub ? h('small', {}, sub) : null),
    cur === state ? h('span', { class: 'choice-cur' }, 'עכשיו') : null);
    openSheet({
      title: names[part], cls: 'sheet-choice',
      body: h('div', { class: 'choices' },
        opt('approved', 'check', 'מוכן להעלאה', 'הסרטון מאושר מבחינתך'),
        opt('changes', 'x', 'לא מאושר', 'צריך תיקון, כדאי להוסיף הערה'),
        opt('pending', 'undo', 'החזרה להמתנה', 'עוד לא החלטת')),
    });
  }

  async function setState(post, part, state) {
    const key = part + '_state', prev = post[key];
    if (prev === state) return;
    post[key] = state;
    refreshPost(post);
    if (part === 'video' && state === 'approved') { const c = cardFor(post, 'video'); if (c) { const b = $('.burst', c); b.classList.remove('go'); void b.offsetWidth; b.classList.add('go'); } vibrate(12); }
    try {
      const r = await api('/api/posts/' + post.id + '/state', { method: 'POST', body: { part, state } });
      if (r && r.post) mergePost(post, r.post);
      refreshPost(post);
    } catch {
      post[key] = prev; refreshPost(post);
      toast('לא נשמר, אפשר לנסות שוב');
    }
  }

  /* --- cover + caption card --- */
  function metaCard(post, group) {
    const card = h('section', { class: 'card card-meta', 'data-post': post.id, 'data-client': post.client_id, 'aria-label': 'עטיפה וכיתוב: ' + (post.title || '') });
    card._fy = { type: 'meta', post, group };
    card.append(h('div', { class: 'meta-bg', style: post.cover_url ? { backgroundImage: 'url("' + String(post.cover_url).replace(/"/g, '%22') + '")' } : {} }),
      h('div', { class: 'meta-in' }));
    renderMeta(card);
    return card;
  }

  function partRow(post, part, extra) {
    const st = post[part + '_state'];
    const pill = h('span', { class: 'pill st-' + st }, { pending: 'ממתין', approved: 'מאושר', changes: 'לא מאושר' }[st]);
    return h('div', { class: 'part-row' }, pill, h('span', { class: 'grow' }),
      extra || null,
      h('button', { type: 'button', class: 'pbtn reject' + (st === 'changes' ? ' on' : ''), 'aria-label': 'לא מאושר', onclick: () => partReject(post, part) }, h('span', { html: icon('x') }), 'לתקן'),
      h('button', { type: 'button', class: 'pbtn approve' + (st === 'approved' ? ' on' : ''), onclick: () => partApprove(post, part) }, h('span', { html: icon('check') }), 'אישור'));
  }

  function partApprove(post, part) {
    if (post[part + '_state'] === 'approved') { stateChooser(post, part); return; }
    post._metaTouched = true;
    setState(post, part, 'approved');
  }
  function partReject(post, part) {
    if (post[part + '_state'] === 'changes') { stateChooser(post, part); return; }
    post._metaTouched = true;
    post['_ask_' + part] = true;
    setState(post, part, 'changes');
  }

  function renderMeta(card) {
    const post = card._fy.post;
    const inn = $('.meta-in', card);
    const c = clientOf(post);
    const coverSrc = post.cover_url || (post.version && post.version.thumb);
    const editing = card._editing;

    const askBox = (part) => {
      if (!post['_ask_' + part] || post[part + '_state'] !== 'changes') return null;
      const inp = h('input', { type: 'text', class: 'ask-in', placeholder: part === 'cover' ? 'מה לשנות בעטיפה?' : 'מה לשנות בכיתוב?', enterkeyhint: 'send', dir: 'auto' });
      const send = async () => {
        const body = inp.value.trim(); if (!body) { post['_ask_' + part] = false; renderMeta(card); return; }
        try {
          const r = await api('/api/posts/' + post.id + '/comments', { method: 'POST', body: { target: part, body } });
          if (r.comment) post.comments.push(normComment(r.comment));
          post['_ask_' + part] = false; renderMeta(card); toast('ההערה נשמרה');
        } catch { toast('לא נשמר, אפשר לנסות שוב'); }
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      return h('div', { class: 'ask' }, inp, h('button', { type: 'button', class: 'btn small primary', onclick: send }, 'שמירה'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { post['_ask_' + part] = false; renderMeta(card); } }, 'דילוג'));
    };

    const partNotes = (part) => {
      const list = post.comments.filter((x) => x.target === part);
      return list.length ? h('ul', { class: 'pnotes' }, list.map((x) => h('li', { class: x.status === 'done' ? 'done' : '' }, x.body))) : null;
    };

    let capBlock;
    if (editing) {
      const ta = h('textarea', { class: 'cap-edit', dir: 'auto', rows: '6', 'aria-label': 'עריכת הכיתוב' });
      ta.value = post.caption || '';
      capBlock = h('div', { class: 'cap-box editing' }, ta,
        h('div', { class: 'part-row' }, h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { card._editing = false; renderMeta(card); } }, 'ביטול'),
          h('button', { type: 'button', class: 'btn small primary', onclick: () => saveCaption(card, ta.value) }, 'שמירה ואישור')));
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
    } else {
      capBlock = h('div', { class: 'cap-box' },
        post.caption ? h('div', { class: 'cap-text', dir: 'auto' }, post.caption) : h('div', { class: 'cap-text empty' }, 'עוד אין כיתוב'),
        partRow(post, 'caption', h('button', { type: 'button', class: 'pbtn edit', onclick: () => { card._editing = true; renderMeta(card); } }, h('span', { html: icon('pencil') }), post.caption ? 'לערוך' : 'לכתוב')),
        askBox('caption'), partNotes('caption'));
    }

    const allApproved = PARTS.every((k) => post[k + '_state'] === 'approved');
    inn.replaceChildren(...K(
      h('div', { class: 'meta-head' }, avatar(c, 30), h('div', {}, h('b', {}, c.name || ''), h('div', { class: 'meta-sub' }, (post.title || '') + ' · עטיפה וכיתוב'))),
      h('div', { class: 'meta-cover' },
        h('div', { class: 'cover-img' + (post.orientation === 'horizontal' ? ' wide' : '') }, coverSrc ? h('img', { src: coverSrc, alt: 'העטיפה', loading: 'lazy', decoding: 'async' }) : h('span', {}, 'עוד אין עטיפה')),
        h('div', { class: 'cover-side' }, h('div', { class: 'meta-label' }, 'עטיפה'), partRow(post, 'cover'), askBox('cover'), partNotes('cover'))),
      h('div', { class: 'meta-label' }, 'כיתוב'),
      capBlock,
      allApproved ? h('button', { type: 'button', class: 'btn primary wide', onclick: () => openShare(post) }, h('span', { html: icon('send') }), (post.client_state === 'pending' ? 'נשלח ללקוח · לשלוח שוב' : 'הכול מאושר · שליחה ללקוח')) : null,
      h('div', { class: 'meta-next', 'aria-hidden': 'true' }, 'הבא בתור')));
  }

  async function saveCaption(card, text) {
    const post = card._fy.post, prev = post.caption;
    post.caption = text; card._editing = false; post._metaTouched = true;
    refreshPost(post);
    try {
      const r = await api('/api/posts/' + post.id, { method: 'PATCH', body: { caption: text } });
      if (r && r.post) mergePost(post, r.post);
      await setState(post, 'caption', 'approved');
      toast('הכיתוב נשמר ואושר');
    } catch {
      post.caption = prev; refreshPost(post); toast('לא נשמר, אפשר לנסות שוב');
    }
  }

  function endCard() {
    const card = h('section', { class: 'card card-end' });
    card._fy = { type: 'end' };
    card.append(h('div', { class: 'end-in' }));
    return card;
  }
  function renderEnd() {
    const card = S.cards.find((c) => c._fy.type === 'end'); if (!card) return;
    const left = countLeft();
    $('.end-in', card).replaceChildren(...K(
      h('div', { class: 'calm-ic', html: icon(left ? 'more' : 'check') }),
      h('h2', {}, left ? 'עברת על כל הרשימה' : 'הכול מאושר'),
      h('p', {}, left ? 'נשארו ' + left + ' סרטונים עם החלטה פתוחה' : 'אין כרגע עוד משהו שמחכה לך'),
      h('div', { class: 'end-acts' },
        left ? h('button', { type: 'button', class: 'btn primary', onclick: () => { const c = firstPendingCard(); if (c) scrollToCard(c); } }, 'לפתוחים') : null,
        h('a', { class: 'btn ' + (left ? 'ghost' : 'primary'), href: '/' }, 'למסך הבית'))));
  }
  const firstPendingCard = () => S.cards.find((c) => c._fy.post && isPending(c._fy.post));

  /* refresh everything that shows a post's state, without touching the video box */
  function refreshPost(post) {
    const vc = cardFor(post, 'video');
    if (vc) {
      const rail = $('.rail', vc); rail.replaceChildren(...K(buildRail(post)));
      const hc = $('.h-comments', vc); if (hc) renderHComments(vc, hc);
      renderMarks(post);
      vc.classList.toggle('is-approved', post.video_state === 'approved');
      vc.classList.toggle('is-changes', post.video_state === 'changes');
      const cap = $('.info-cap', vc); if (cap) cap.textContent = post.caption || '';
    }
    const mc = cardFor(post, 'meta');
    if (mc && !mc._editing) {
      renderMeta(mc);
      if (post._metaTouched && post.caption_state !== 'pending' && post.cover_state !== 'pending' && S.active === mc) {
        post._metaTouched = false;
        const wantsNote = post._ask_cover || post._ask_caption;
        if (!wantsNote) setTimeout(() => { if (S.active === mc && !S.sheet) step(1); }, 650);
      }
    }
    updateCounts();
  }

  /* --- counts, chips --- */
  const countLeft = () => { let n = 0; S.posts.forEach((p) => { if (isPending(p)) n++; }); return n; };
  function updateCounts() {
    const left = countLeft();
    $('#left').textContent = left ? 'נשארו ' + left : 'הכול מאושר';
    S.groups.forEach((g) => {
      const n = g.posts.filter(isPending).length;
      const label = n ? n + ' לאישור' : 'הכול מאושר';
      $$('.gintro[data-client="' + cssEsc(g.client.id) + '"] .gcount').forEach((el) => { el.textContent = label; });
      const chip = $('.chip[data-client="' + cssEsc(g.client.id) + '"] .chip-n');
      if (chip) { chip.textContent = n || ''; chip.hidden = !n; }
    });
    renderEnd();
  }
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));

  function renderChips() {
    const chips = $('#chips');
    chips.replaceChildren(...K(...S.groups.map((g) => h('button', {
      type: 'button', class: 'chip', 'data-client': g.client.id,
      onclick: () => { const c = S.cards.find((x) => x._fy.group === g); if (c) scrollToCard(c); },
    }, avatar(g.client, 22), h('span', {}, g.client.name), h('span', { class: 'chip-n' })))));
    chips.hidden = S.groups.length < 2;
  }
  function markChip(clientId) {
    $$('.chip').forEach((c) => {
      const on = c.dataset.client === String(clientId);
      c.classList.toggle('on', on);
      if (on) c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }

  /* ---------- feed render + active card ---------- */
  let io = null;
  function render() {
    feed.replaceChildren(...K()); S.cards = [];
    if (!S.groups.length) { renderEmpty(); return; }
    S.groups.forEach((g) => {
      S.clients.set(g.client.id, g.client);
      g.posts.forEach((p) => S.posts.set(String(p.id), p));
    });
    S.groups.forEach((g) => {
      g.posts.forEach((p, i) => {
        const vc = videoCard(p, g, i === 0); S.cards.push(vc); feed.append(vc);
        const mc = metaCard(p, g); S.cards.push(mc); feed.append(mc);
      });
    });
    const end = endCard(); S.cards.push(end); feed.append(end);
    S.posts.forEach((p) => refreshPost(p));
    renderChips(); updateCounts(); syncMute(); measureTop();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(e.target);
    }, { root: feed, threshold: [0.6] });
    S.cards.forEach((c) => io.observe(c));
  }

  function measureTop() {
    const t = $('#top'); if (!t) return;
    document.documentElement.style.setProperty('--top-h', Math.ceil(t.getBoundingClientRect().height) + 'px');
  }
  window.addEventListener('resize', () => requestAnimationFrame(measureTop));

  function renderEmpty() {
    document.body.classList.add('is-empty');
    $('#left').textContent = '';
    $('#chips').hidden = true;
    feed.append(h('section', { class: 'card card-end empty' }, h('div', { class: 'end-in' },
      h('div', { class: 'calm-ic', html: icon('check') }),
      h('h2', {}, 'הכול מאושר'),
      h('p', {}, 'אין כרגע סרטונים שמחכים לך. כשיעלה משהו חדש הוא יופיע כאן'),
      h('a', { class: 'btn primary', href: '/' }, 'למסך הבית'))));
  }

  function setActive(card) {
    if (S.active === card) return;
    if (S.active) S.active.classList.remove('active');
    S.active = card; card.classList.add('active');
    const f = card._fy;
    document.body.classList.toggle('on-meta', f.type !== 'video');
    document.body.classList.toggle('on-h', f.type === 'video' && f.post.orientation === 'horizontal');
    if (f.type === 'video') attach(card); else detach();
    if (f.post) markChip(f.post.client_id);
    // keep the next poster warm
    const nxt = S.cards[S.cards.indexOf(card) + 2];
    const img = nxt && $('img.poster', nxt); if (img) img.loading = 'eager';
  }

  function scrollToCard(card, smooth = true) {
    if (!card) return;
    feed.scrollTo({ top: card.offsetTop, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }
  function step(d) {
    const i = S.cards.indexOf(S.active);
    scrollToCard(S.cards[clamp(i + d, 0, S.cards.length - 1)]);
  }

  /* ================================================================
     Bottom sheet
     ================================================================ */
  function openSheet({ title, sub, body, cls = '', squeeze = null, onClose = null, onTick = null, clearBack = false }) {
    if (S.sheet) closeSheet();
    const closeBtn = h('button', { type: 'button', class: 'sheet-x', 'aria-label': 'סגירה', html: icon('x'), onclick: () => closeSheet() });
    const head = h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-title' }, h('h2', {}, title), sub ? h('span', { class: 'sheet-sub' }, sub) : null), closeBtn);
    const bodyWrap = h('div', { class: 'sheet-body' }, body);
    const panel = h('div', { class: 'sheet ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, head, bodyWrap);
    const back = h('div', { class: 'sheet-back' + (clearBack ? ' clear' : ''), onclick: () => closeSheet() });
    sheetRoot.append(back, panel);
    const s = { panel, back, head, bodyWrap, onClose, onTick, squeeze, ro: null, sub: $('.sheet-sub', head) };
    S.sheet = s;
    document.body.classList.add('sheet-open');
    if (squeeze) {
      s.ro = new ResizeObserver(() => squeeze.style.setProperty('--sheet-h', panel.offsetHeight + 'px'));
      s.ro.observe(panel);
      squeeze.style.setProperty('--sheet-h', '0px');
      squeeze.classList.add('squeeze');
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { back.classList.add('in'); panel.classList.add('in'); }));
    bindSheetDrag(s);
    return s;
  }

  function closeSheet() {
    const s = S.sheet; if (!s) return;
    S.sheet = null;
    s.panel.style.transform = '';
    s.panel.classList.remove('in'); s.back.classList.remove('in');
    if (s.squeeze) { s.squeeze.classList.remove('squeeze'); }
    if (s.ro) s.ro.disconnect();
    document.body.classList.remove('sheet-open');
    if (document.activeElement && s.panel.contains(document.activeElement)) document.activeElement.blur();
    setTimeout(() => { s.panel.remove(); s.back.remove(); }, 320);
    try { s.onClose && s.onClose(); } catch (e) { console.error(e); }
  }

  function bindSheetDrag(s) {
    const { panel, head, bodyWrap } = s;
    let y0 = 0, t0 = 0, dy = 0, on = false;
    const begin = (y) => { y0 = y; t0 = performance.now(); dy = 0; on = true; panel.style.transition = 'none'; };
    const move = (y) => { dy = Math.max(0, y - y0); panel.style.transform = 'translateY(' + dy + 'px)'; };
    const finish = () => {
      if (!on) return; on = false; panel.style.transition = '';
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > 110 || (v > 0.55 && dy > 30)) closeSheet(); else panel.style.transform = '';
    };
    head.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; head.setPointerCapture(e.pointerId); begin(e.clientY); });
    head.addEventListener('pointermove', (e) => { if (on) move(e.clientY); });
    head.addEventListener('pointerup', finish); head.addEventListener('pointercancel', finish);
    // pull down from the top of the scrolled content (touch)
    let ty = null;
    bodyWrap.addEventListener('touchstart', (e) => {
      if (e.target.closest('textarea, input, canvas, .no-drag')) { ty = null; return; }
      ty = bodyWrap.scrollTop <= 0 ? e.touches[0].clientY : null;
    }, { passive: true });
    bodyWrap.addEventListener('touchmove', (e) => {
      if (ty == null) return;
      const d = e.touches[0].clientY - ty;
      if (!on && d > 8 && bodyWrap.scrollTop <= 0) begin(ty);
      if (on) { e.preventDefault(); move(e.touches[0].clientY); }
    }, { passive: false });
    bodyWrap.addEventListener('touchend', () => { ty = null; finish(); });
    bodyWrap.addEventListener('touchcancel', () => { ty = null; finish(); });
  }

  /* keyboard on iPhone: lift sheets above it */
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onVV = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb + 'px');
      document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      document.body.classList.toggle('kb-open', kb > 80);
    };
    vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); onVV();
  }

  /* ================================================================
     Comments sheet
     ================================================================ */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function inkPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    return [v('--reject', '#b4574b'), v('--pending', '#c9a46a'), v('--approve', '#4f7a5a'), v('--fy-on-stage', '#ffffff')];
  }

  function openComments(post, opt = {}) {
    const card = cardFor(post, 'video');
    if (!card) return;
    if (S.active !== card) { scrollToCard(card, false); setActive(card); }
    const wasPlaying = P.card === card && !P.el.paused;
    if (P.card === card) P.el.pause();

    const palette = inkPalette();
    const C = { post, card, editing: null, rec: null, draw: { on: false, color: palette[0], drawing: { v: 1, strokes: [] }, changed: () => syncDraft() } };

    const list = h('div', { class: 'cm-list' });
    const timeChip = h('span', { class: 'cm-at' }, '0:00');
    const ta = h('textarea', { class: 'cm-in', rows: '1', dir: 'auto', placeholder: 'מה לתקן ברגע הזה?', 'aria-label': 'הערה', enterkeyhint: 'send' });
    const sendBtn = h('button', { type: 'button', class: 'cm-send', 'aria-label': 'שמירת הערה', html: icon('send') });
    const micBtn = SR ? h('button', { type: 'button', class: 'cm-tool mic', 'aria-label': 'הכתבה', html: icon('mic') }) : null;
    const drawBtn = h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'ציור על הפריים', html: icon('brush') });
    const draft = h('div', { class: 'cm-draft' });
    const seek = (dt) => { if (P.card !== card) return; P.el.pause(); P.el.currentTime = clamp((P.el.currentTime || 0) + dt, 0, duration(post) || 1e6); updateProgress(); };

    const drawBar = h('div', { class: 'drawbar no-drag' },
      h('span', { class: 'drawbar-l' }, 'ציור על הפריים'),
      ...palette.map((col, i) => h('button', { type: 'button', class: 'swatch' + (i === 0 ? ' on' : ''), style: { background: col }, 'aria-label': 'צבע ' + (i + 1),
        onclick: (e) => { C.draw.color = col; $$('.swatch', drawBar).forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } })),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'ביטול קו אחרון', html: icon('undo'), onclick: () => { C.draw.drawing.strokes.pop(); showInk(card, C.draw.drawing); syncDraft(); } }),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => { C.draw.drawing.strokes = []; showInk(card, C.draw.drawing); syncDraft(); } }, 'ניקוי'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => setDraw(false) }, 'סיום'));

    const composer = h('div', { class: 'cm-compose no-drag' },
      h('div', { class: 'cm-timerow' },
        h('button', { type: 'button', class: 'tbtn', 'aria-label': 'שלוש שניות אחורה', onclick: () => seek(-3) }, h('span', { html: icon('back3') }), '3'),
        h('button', { type: 'button', class: 'tbtn', 'aria-label': 'שנייה אחורה', onclick: () => seek(-1) }, '−1'),
        h('div', { class: 'cm-atbox' }, h('small', {}, 'הערה בשנייה'), timeChip),
        h('button', { type: 'button', class: 'tbtn', 'aria-label': 'שנייה קדימה', onclick: () => seek(1) }, '+1')),
      draft,
      drawBar,
      h('div', { class: 'cm-row' }, ta, micBtn, drawBtn, sendBtn));

    function setDraw(on) {
      C.draw.on = on;
      card.classList.toggle('drawing', on);
      s.panel.classList.toggle('draw-mode', on);
      drawBtn.classList.toggle('on', on);
      if (on) { if (document.activeElement === ta) ta.blur(); showInk(card, C.draw.drawing); }
      syncDraft();
    }
    function syncDraft() {
      const n = C.draw.drawing.strokes.length;
      draft.replaceChildren(...K(
        C.editing ? h('span', { class: 'tag' }, 'עריכת הערה', h('button', { type: 'button', 'aria-label': 'ביטול עריכה', html: icon('x'), onclick: () => resetComposer() })) : null,
        n && !C.draw.on ? h('span', { class: 'tag ink-tag' }, h('span', { html: icon('brush') }), 'יש ציור', h('button', { type: 'button', 'aria-label': 'מחיקת הציור', html: icon('x'), onclick: () => { C.draw.drawing.strokes = []; showInk(card, null); syncDraft(); } })) : null));
      draft.hidden = !draft.childElementCount;
      sendBtn.classList.toggle('ready', !!(ta.value.trim() || n));
    }
    function resetComposer() {
      C.editing = null; ta.value = ''; autosize();
      C.draw.drawing = { v: 1, strokes: [] }; showInk(card, null);
      setDraw(false); sendBtn.innerHTML = icon('send');
      $$('.cm', list).forEach((r) => r.classList.remove('editing'));
      syncDraft();
    }
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'; };
    ta.addEventListener('input', () => { autosize(); syncDraft(); });
    ta.addEventListener('focus', () => { if (P.card === card) P.el.pause(); if (C.draw.on) setDraw(false); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); send(); } });
    drawBtn.addEventListener('click', () => setDraw(!C.draw.on));
    sendBtn.addEventListener('click', () => send());
    if (micBtn) micBtn.addEventListener('click', () => toggleMic());

    function toggleMic() {
      if (C.rec) { C.rec.stop(); return; }
      let rec;
      try { rec = new SR(); } catch { toast('אין הכתבה בדפדפן הזה'); return; }
      rec.lang = 'he-IL'; rec.interimResults = true; rec.continuous = true;
      const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
      rec.onresult = (ev) => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; ta.value = base + t; autosize(); syncDraft(); };
      rec.onerror = (ev) => { toast(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'צריך לאשר גישה למיקרופון' : 'ההכתבה נעצרה'); };
      rec.onend = () => { C.rec = null; micBtn.classList.remove('on'); };
      try { rec.start(); C.rec = rec; micBtn.classList.add('on'); if (P.card === card) P.el.pause(); } catch { toast('ההכתבה לא נפתחה'); }
    }

    async function send() {
      const body = ta.value.trim();
      const drawing = C.draw.drawing.strokes.length ? C.draw.drawing : null;
      if (!body && !drawing) { ta.focus(); return; }
      if (C.rec) C.rec.stop();
      const at = round1(P.card === card ? P.el.currentTime : 0);
      const payload = { body: body || 'ציור על הפריים', at_sec: at, drawing: drawing || null };
      sendBtn.disabled = true;
      try {
        if (C.editing) {
          const r = await api('/api/comments/' + C.editing.id, { method: 'PATCH', body: payload });
          Object.assign(C.editing, normComment((r && r.comment) || { ...payload }));
          toast('ההערה עודכנה');
        } else {
          const r = await api('/api/posts/' + post.id + '/comments', { method: 'POST', body: { target: 'video', ...payload } });
          const cm = normComment((r && r.comment) || { id: Date.now(), target: 'video', author: S.user && S.user.name, author_kind: 'team', status: 'open', ...payload });
          if (post.version && cm.version_id == null) cm.version_id = post.version.id;
          post.comments.push(cm);
        }
        resetComposer();
        renderList(); refreshPost(post);
      } catch { toast('לא נשמר, אפשר לנסות שוב'); }
      finally { sendBtn.disabled = false; }
    }

    const verN = (id) => { const v = (post.versions || []).find((x) => x.id === id); return v ? v.n : null; };
    function renderList() {
      const items = videoComments(post);
      if (s.sub) s.sub.textContent = items.length ? String(items.length) : '';
      if (!items.length) { list.replaceChildren(...K(h('p', { class: 'cm-empty' }, 'עוד אין הערות. עוצרים ברגע הנכון וכותבים, מכתיבים או מציירים'))); return; }
      list.replaceChildren(...K(...items.map((c) => {
        const own = (c.author_kind || 'team') === 'team';
        const vn = c.version_id && post.version && c.version_id !== post.version.id ? verN(c.version_id) : null;
        const row = h('div', { class: 'cm' + (c.status === 'done' ? ' done' : '') + (C.editing === c ? ' editing' : ''), 'data-id': c.id },
          h('button', { type: 'button', class: 'cm-time', 'aria-label': 'מעבר לשנייה ' + fmt(c.at_sec) }, c.at_sec != null ? fmt(c.at_sec) : '—'),
          h('div', { class: 'cm-main' },
            h('div', { class: 'cm-body', dir: 'auto' }, c.body),
            h('div', { class: 'cm-meta' },
              c.author ? h('span', {}, c.author) : null,
              c.author_kind === 'client' ? h('span', { class: 'tag-s' }, 'לקוח') : null,
              c.author_kind === 'claude' ? h('span', { class: 'tag-s' }, 'עריכה') : null,
              c.drawing && c.drawing.strokes && c.drawing.strokes.length ? h('span', { class: 'tag-s', html: icon('brush') + 'ציור' }) : null,
              c.status === 'done' ? h('span', { class: 'tag-s ok' }, 'תוקן') : null,
              vn ? h('span', { class: 'tag-s' }, 'גרסה ' + vn) : null)),
          own ? h('div', { class: 'cm-acts' },
            h('button', { type: 'button', 'aria-label': 'עריכה', html: icon('pencil'), onclick: (e) => { e.stopPropagation(); editComment(c); } }),
            h('button', { type: 'button', 'aria-label': 'מחיקה', html: icon('trash'), onclick: (e) => { e.stopPropagation(); deleteComment(c); } })) : null);
        row.addEventListener('click', () => {
          $$('.cm', list).forEach((r) => r.classList.toggle('sel', r === row));
          if (P.card === card && c.at_sec != null) { P.el.pause(); P.el.currentTime = c.at_sec; updateProgress(); }
          if (!C.draw.on) showInk(card, c.drawing);
        });
        return row;
      })));
    }

    function editComment(c) {
      C.editing = c;
      ta.value = c.body === 'ציור על הפריים' && c.drawing ? '' : c.body; autosize();
      C.draw.drawing = c.drawing && c.drawing.strokes ? JSON.parse(JSON.stringify(c.drawing)) : { v: 1, strokes: [] };
      showInk(card, C.draw.drawing);
      if (P.card === card && c.at_sec != null) { P.el.pause(); P.el.currentTime = c.at_sec; updateProgress(); }
      sendBtn.innerHTML = icon('check');
      renderList(); syncDraft();
      ta.focus();
    }
    async function deleteComment(c) {
      const ok = await confirmBox({ title: 'למחוק את ההערה?', text: c.body.length > 80 ? c.body.slice(0, 80) + '…' : c.body, ok: 'מחיקה', danger: true });
      if (!ok) return;
      try {
        await api('/api/comments/' + c.id, { method: 'DELETE' });
        post.comments = post.comments.filter((x) => x !== c);
        if (C.editing === c) resetComposer();
        showInk(card, null);
        renderList(); refreshPost(post);
      } catch { toast('לא נמחק, אפשר לנסות שוב'); }
    }

    const body = h('div', { class: 'cm-wrap' }, list, composer);
    const s = openSheet({
      title: 'הערות', sub: '', body, cls: 'sheet-comments' + (post.orientation === 'horizontal' ? ' over-h' : ''),
      squeeze: post.orientation === 'horizontal' ? null : card,
      clearBack: true,
      onTick: (t) => { const r = round1(t); timeChip.textContent = fmt(r) + '.' + Math.round((r % 1) * 10) % 10; },
      onClose: () => {
        if (C.rec) { try { C.rec.stop(); } catch { /* ignore */ } }
        C.draw.on = false; card.classList.remove('drawing'); showInk(card, null);
        if (wasPlaying && P.card === card && !card._userPaused) play();
      },
    });
    s.draw = C.draw;
    renderList(); syncDraft(); updateProgress();
    timeChip.textContent = fmt(P.el.currentTime);
    if (opt.focus) setTimeout(() => ta.focus(), 350);
  }

  /* comments list inside the horizontal (YouTube-style) card */
  function renderHComments(card, box) {
    const post = card._fy.post, items = videoComments(post);
    box.replaceChildren(...K(
      h('div', { class: 'hc-head' }, h('b', {}, 'הערות'), h('span', {}, items.length ? String(items.length) : ''), h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn small primary', onclick: () => openComments(post, { focus: true }) }, h('span', { html: icon('plus') }), 'הערה בשנייה הזאת')),
      items.length ? h('div', { class: 'hc-list' }, items.map((c) => h('button', {
        type: 'button', class: 'hc' + (c.status === 'done' ? ' done' : ''),
        onclick: () => { if (P.card === card && c.at_sec != null) { P.el.pause(); P.el.currentTime = c.at_sec; updateProgress(); } showInk(card, c.drawing); },
      }, h('span', { class: 'cm-time' }, c.at_sec != null ? fmt(c.at_sec) : '—'), h('span', { class: 'hc-body', dir: 'auto' }, c.body)))) : h('p', { class: 'cm-empty' }, 'עוד אין הערות')));
  }

  /* ================================================================
     Share sheet
     ================================================================ */
  async function openShare(post) {
    const own = clientOf(post);
    const others = h('div', { class: 'sh-grid' }, h('p', { class: 'muted' }, 'טוען…'));
    const shared = post.client_state === 'pending';
    openSheet({
      title: 'שליחה לאישור הלקוח', cls: 'sheet-share',
      body: h('div', { class: 'sh' },
        h('button', { type: 'button', class: 'sh-own', onclick: () => doShare(post, own) },
          avatar(own, 52),
          h('span', { class: 'sh-own-t' }, h('b', {}, own.name || ''), h('small', {}, shared ? 'כבר נשלח · אפשר לשלוח שוב' : 'הלקוח של הסרטון')),
          h('span', { class: 'sh-go' }, h('span', { html: icon('send') }), 'שליחה')),
        h('button', { type: 'button', class: 'sh-row', onclick: async () => {
          const url = own.share_url ? new URL(own.share_url, location.origin).href : null;
          if (!url) { toast('אין עדיין קישור ללקוח הזה'); return; }
          toast((await copyText(url)) ? 'הקישור הועתק' : 'לא הצלחתי להעתיק');
        } }, h('span', { class: 'sh-row-ic', html: icon('link') }), 'העתקת הקישור של הלקוח'),
        h('div', { class: 'meta-label' }, 'לקוח אחר'),
        others),
    });
    try {
      if (!S.allClients) S.allClients = ((await api('/api/clients')).clients || []);
      S.allClients.forEach((c) => { if (!S.clients.has(c.id)) S.clients.set(c.id, c); });
      const rest = S.allClients.filter((c) => c.id !== post.client_id);
      others.replaceChildren(...K(...(rest.length ? rest.map((c) => h('button', { type: 'button', class: 'sh-c', onclick: () => doShare(post, c) }, avatar(c, 48), h('span', {}, c.name)))
        : [h('p', { class: 'muted' }, 'אין לקוחות נוספים')])));
    } catch { others.replaceChildren(...K(h('p', { class: 'muted' }, 'הרשימה לא נטענה'))); }
  }

  async function doShare(post, client) {
    if (client.id !== post.client_id) {
      const ok = await confirmBox({ title: 'לשלוח ל-' + client.name + '?', text: 'זה לא הלקוח של הסרטון', ok: 'כן, לשלוח' });
      if (!ok) return;
    }
    closeSheet();
    try {
      const r = await api('/api/posts/' + post.id + '/share', { method: 'POST', body: client.id === post.client_id ? {} : { client_id: client.id } });
      post.client_state = 'pending'; post.stage = 'client';
      refreshPost(post);
      const url = r && r.url ? new URL(r.url, location.origin).href : null;
      toast('נשלח ל-' + client.name, url ? { action: 'העתקת קישור', fn: async () => toast((await copyText(url)) ? 'הקישור הועתק' : 'לא הצלחתי להעתיק') } : {});
    } catch { toast('לא נשלח, אפשר לנסות שוב'); }
  }

  /* ================================================================
     Music sheet
     ================================================================ */
  let previewAudio = null;
  async function openMusic(post) {
    const body = h('div', { class: 'mu' }, h('p', { class: 'muted' }, 'טוען…'));
    openSheet({ title: 'מוזיקה', cls: 'sheet-music', body, onClose: () => { if (previewAudio) { previewAudio.pause(); previewAudio = null; } } });
    try { if (!S.tracks) S.tracks = ((await api('/api/tracks')).tracks || []); }
    catch { body.replaceChildren(...K(h('p', { class: 'muted' }, 'רשימת השירים לא נטענה'))); return; }
    const cur = post.music;
    const isCur = (t) => cur && ((cur.track_id != null && cur.track_id === t.id) || (cur.track_id == null && cur.title === t.title && cur.source === t.source));
    const row = (t) => {
      const b = h('div', { class: 'mu-row' + (isCur(t) ? ' cur' : '') });
      if (t.url) {
        const pb = h('button', { type: 'button', class: 'mu-play', 'aria-label': 'השמעה', html: icon('play') });
        pb.addEventListener('click', (e) => {
          e.stopPropagation();
          if (previewAudio && previewAudio._t === t) { previewAudio.pause(); previewAudio = null; pb.innerHTML = icon('play'); return; }
          if (previewAudio) previewAudio.pause();
          $$('.mu-play', body).forEach((x) => { x.innerHTML = icon('play'); });
          previewAudio = new Audio(t.url); previewAudio._t = t; P.el.pause();
          previewAudio.play().then(() => { pb.innerHTML = icon('pause'); }).catch(() => toast('השיר לא מתנגן'));
          previewAudio.onended = () => { pb.innerHTML = icon('play'); };
        });
        b.append(pb);
      } else b.append(h('span', { class: 'mu-dot', html: icon('music') }));
      b.append(h('button', { type: 'button', class: 'mu-pick', onclick: () => pickTrack(post, t) },
        h('span', { class: 'mu-t' }, h('b', { dir: 'auto' }, t.title), t.artist ? h('small', { dir: 'auto' }, t.artist) : null),
        isCur(t) ? h('span', { class: 'mu-check', html: icon('check') }) : null));
      return b;
    };
    const lib = S.tracks.filter((t) => t.source !== 'instagram');
    const ig = S.tracks.filter((t) => t.source === 'instagram');
    const addIn = h('input', { type: 'text', placeholder: 'שם השיר באינסטגרם', dir: 'auto', enterkeyhint: 'done', 'aria-label': 'שם שיר מאינסטגרם' });
    const add = async () => {
      const title = addIn.value.trim(); if (!title) { addIn.focus(); return; }
      try {
        const r = await api('/api/tracks', { method: 'POST', body: { title, source: 'instagram' } });
        const t = (r && (r.track || r)) || { title, source: 'instagram' };
        if (!t.title) t.title = title;
        if (!t.source) t.source = 'instagram';
        S.tracks.push(t); pickTrack(post, t);
      } catch { toast('לא נשמר, אפשר לנסות שוב'); }
    };
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    body.replaceChildren(...K(
      h('button', { type: 'button', class: 'mu-none' + (!cur ? ' cur' : ''), onclick: () => pickTrack(post, null) }, 'בלי מוזיקה', !cur ? h('span', { class: 'mu-check', html: icon('check') }) : null),
      h('div', { class: 'meta-label' }, 'השירים שלך'),
      lib.length ? h('div', { class: 'mu-list' }, lib.map(row)) : h('p', { class: 'muted' }, 'עוד אין שירים בספרייה'),
      h('div', { class: 'meta-label' }, 'מספריית אינסטגרם'),
      h('p', { class: 'muted small' }, 'שם בלבד. את השיר בוחרים באפליקציה בזמן ההעלאה'),
      ig.length ? h('div', { class: 'mu-list' }, ig.map(row)) : null,
      h('div', { class: 'mu-add no-drag' }, addIn, h('button', { type: 'button', class: 'btn small primary', onclick: add }, 'הוספה'))));
  }

  async function pickTrack(post, t) {
    const prev = post.music;
    const music = t ? { title: t.title, artist: t.artist || null, source: t.source || 'library', track_id: t.id ?? null } : null;
    post.music = music; closeSheet(); refreshPost(post);
    try {
      const r = await api('/api/posts/' + post.id, { method: 'PATCH', body: { music } });
      if (r && r.post) { mergePost(post, r.post); refreshPost(post); }
      toast(music ? 'נבחר: ' + music.title : 'בלי מוזיקה');
    } catch { post.music = prev; refreshPost(post); toast('לא נשמר, אפשר לנסות שוב'); }
  }

  /* ================================================================
     "…" sheet: speed lock + clean screen
     ================================================================ */
  function openMore() {
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'מהירות' }, SPEEDS.map((x) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(S.speed === x), class: S.speed === x ? 'on' : '',
      onclick: (e) => { setSpeed(x); $$('button', seg).forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); },
    }, '×' + x)));
    openSheet({
      title: 'עוד', cls: 'sheet-more',
      body: h('div', { class: 'more' },
        h('div', { class: 'more-row' }, h('span', { class: 'more-ic', html: icon('speed') }), h('span', { class: 'grow' }, 'מהירות קבועה'), seg),
        h('button', { type: 'button', class: 'more-row btnrow', onclick: () => { closeSheet(); setClean(true); } },
          h('span', { class: 'more-ic', html: icon('clean') }), h('span', { class: 'grow' }, h('b', {}, 'מסך נקי'), h('small', {}, 'בלי כפתורים, לצפייה מההתחלה עד הסוף'))),
        h('button', { type: 'button', class: 'more-row btnrow', onclick: () => { setMuted(!P.el.muted); closeSheet(); } },
          h('span', { class: 'more-ic', html: icon(P.el.muted ? 'vol' : 'mute') }), h('span', { class: 'grow' }, P.el.muted ? 'הפעלת שמע' : 'השתקה')),
        h('p', { class: 'muted small hint-keys' }, 'במחשב: חיצים למעבר, רווח לעצירה, M לשמע')),
    });
  }

  function setClean(on) {
    S.clean = on;
    document.body.classList.toggle('clean', on);
    if (on) toast('מסך נקי · הקישי על האיקס כדי לצאת', { ms: 1800 });
  }
  $('#cleanExit').addEventListener('click', () => setClean(false));

  /* ================================================================
     Keyboard (desktop)
     ================================================================ */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') { if (S.modal) S.modal.close(); else if (S.sheet) closeSheet(); else if (S.clean) setClean(false); return; }
    if (S.modal) return;
    const k = e.key;
    if (S.sheet) {
      if (k === ' ' && P.card) { e.preventDefault(); togglePause(P.card); }
      return;
    }
    if (k === 'ArrowDown' || k === 'PageDown' || k === 'j') { e.preventDefault(); step(1); }
    else if (k === 'ArrowUp' || k === 'PageUp' || k === 'k') { e.preventDefault(); step(-1); }
    else if (k === ' ') { if (P.card) { e.preventDefault(); togglePause(P.card); } }
    else if (k === 'm' || k === 'M') setMuted(!P.el.muted);
    else if (k === 'ArrowRight' && P.card) { e.preventDefault(); P.el.currentTime = Math.min((P.el.currentTime || 0) + 5, duration(P.post)); }
    else if (k === 'ArrowLeft' && P.card) { e.preventDefault(); P.el.currentTime = Math.max((P.el.currentTime || 0) - 5, 0); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) P.el.pause();
    else if (P.card && !S.sheet && !P.card._userPaused) play();
  });
  feed.addEventListener('wheel', (e) => { if (S.sheet) e.preventDefault(); }, { passive: false });

  /* ================================================================
     Boot
     ================================================================ */
  async function boot() {
    P.el = makeVideo();
    syncMute(); setSpeed(S.speed);
    try {
      const ses = await api('/api/session');
      if (!ses || !ses.user) { location.replace('/'); return; }
      S.user = ses.user; S.brand = ses.brand;
      const data = await api('/api/feed?stage=review');
      S.groups = (data.groups || []).filter((g) => g && g.client && Array.isArray(g.posts) && g.posts.length);
      S.groups.forEach((g) => g.posts.forEach(normPost));
      const wantPost = qs.get('post');
      if (wantPost && !S.groups.some((g) => g.posts.some((p) => String(p.id) === wantPost))) {
        try {
          const r = await api('/api/posts/' + encodeURIComponent(wantPost));
          if (r && r.post) {
            const p = normPost(r.post);
            const g = S.groups.find((x) => x.client.id === p.client_id);
            if (g) g.posts.unshift(p); else S.groups.unshift({ client: { id: p.client_id, name: p.client_name || '' }, posts: [p] });
          }
        } catch { /* post gone: start at the top */ }
      }
    } catch (e) {
      if (e && e.message === 'unauthorized') return;
      $('#loading').remove();
      feed.replaceChildren(...K(h('section', { class: 'card card-end' }, h('div', { class: 'end-in' },
        h('h2', {}, 'לא הצלחתי לטעון'), h('p', {}, 'בדקי את החיבור ונסי שוב'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => location.reload() }, 'לנסות שוב')))));
      return;
    }
    render();
    $('#loading').remove();
    const wantPost = qs.get('post'), wantClient = qs.get('client');
    let start = null;
    if (wantPost) start = S.cards.find((c) => c._fy.type === 'video' && String(c._fy.post.id) === wantPost);
    if (!start && wantClient) start = S.cards.find((c) => c._fy.post && String(c._fy.post.client_id) === wantClient);
    if (start) { feed.scrollTop = start.offsetTop; }
  }

  /* ================================================================
     Mock (only with ?mock=1): in-memory data, same shapes as docs/API.md
     ================================================================ */
  let M = null;
  function makeMock() {
    const base = qs.get('mockmedia') || 'http://localhost:8799/';
    const ver = (id, n, file, thumb, w, hh, dur, note) => ({ id, n, bunny_guid: 'g' + id, duration: dur, width: w, height: hh, note,
      mp4: [base + 'missing-720.mp4', base + file], hls: null, thumb: base + thumb, embed: null });
    const clients = [
      { id: 'noa', name: 'נועה קוסמטיקה', handle: '@noa', avatar: null, color: '#c9a46a', share_url: '/c/tok-noa' },
      { id: 'lev', name: 'לב בייקרי', handle: '@lev', avatar: null, color: '#4f7a5a', share_url: '/c/tok-lev' },
      { id: 'dan', name: 'דן נדל״ן', handle: '@dan', avatar: null, color: '#9c8b7a', share_url: '/c/tok-dan' },
    ];
    const post = (id, client_id, title, v, extra = {}) => ({
      id, client_id, client_name: clients.find((c) => c.id === client_id).name, title, kind: 'reel', orientation: 'vertical', stage: 'review',
      video_state: 'pending', caption: 'שלוש טעויות שכולן עושות עם קרם לחות ☀️\nשמרי את הסרטון לפעם הבאה\n#טיפוח #עור', caption_state: 'pending',
      cover_url: v.thumb, cover_state: 'pending', music: null, scheduled_at: null, client_state: 'none', created_at: '2026-11-24 09:00', updated_at: '2026-11-24 09:00',
      version: v, versions: [{ id: v.id, n: v.n, created_at: '2026-11-24', note: v.note }], comments: [], ...extra,
    });
    const posts = [
      post(1, 'noa', 'קרם לחות · 3 טעויות', ver(11, 2, 'v.mp4', 'c1.jpg', 720, 1280, 12, 'קיצרתי את הפתיחה'), {
        versions: [{ id: 10, n: 1, created_at: '2026-11-23' }, { id: 11, n: 2, created_at: '2026-11-24', note: 'קיצרתי את הפתיחה' }],
        comments: [
          { id: 101, post_id: 1, version_id: 10, target: 'video', at_sec: 2.4, body: 'הכותרת נכנסת מאוחר מדי', drawing: null, author: 'ג׳ני', author_kind: 'team', status: 'done', created_at: '' },
          { id: 102, post_id: 1, version_id: 11, target: 'video', at_sec: 6, body: 'הלוגו מסתיר את הפנים כאן', drawing: JSON.stringify({ v: 1, strokes: [{ c: '#b4574b', w: 0.01, p: [[0.3, 0.4], [0.5, 0.35], [0.7, 0.45], [0.5, 0.55], [0.3, 0.4]] }] }), author: 'ג׳ני', author_kind: 'team', status: 'open', created_at: '' },
        ] }),
      post(2, 'noa', 'לפני ואחרי · סרום', ver(21, 1, 'v2.mp4', 'c2.jpg', 720, 1280, 8), { caption: '', music: JSON.stringify({ title: 'Golden Hour', artist: 'JVKE', source: 'instagram', track_id: 3 }) }),
      post(3, 'lev', 'מאחורי הקלעים במאפייה', ver(31, 1, 'v.mp4', 'c1.jpg', 720, 1280, 12), { caption: 'ככה נראה הבוקר שלנו ב־5:00 🥐', video_state: 'approved' }),
      post(4, 'lev', 'סדנת שאור · פרק מלא', ver(41, 1, 'h.mp4', 'c3.jpg', 1280, 720, 15), { orientation: 'horizontal', kind: 'long', caption: 'כל מה שצריך לדעת על שאור, מההתחלה', comments: [
        { id: 401, post_id: 4, version_id: 41, target: 'video', at_sec: 4, body: 'לחתוך את ההשתהות כאן', drawing: null, author: 'ג׳ני', author_kind: 'team', status: 'open' },
        { id: 402, post_id: 4, version_id: 41, target: 'video', at_sec: 9.5, body: 'אפשר מוזיקה שקטה יותר?', drawing: null, author: 'דנה', author_kind: 'client', status: 'open' }] }),
      post(5, 'dan', 'דירת 4 חדרים · סיור', ver(51, 1, 'v2.mp4', 'c2.jpg', 720, 1280, 8), { cover_url: null }),
    ];
    const tracks = [
      { id: 1, title: 'שיר בטוח 1', artist: 'ספריית הסוכנות', source: 'library', url: null },
      { id: 2, title: 'Morning Light', artist: 'Lofi', source: 'library', url: null },
      { id: 3, title: 'Golden Hour', artist: 'JVKE', source: 'instagram', url: null },
    ];
    return { clients, posts, tracks, nextId: 1000 };
  }
  async function mockApi(path, opts) {
    M = M || makeMock();
    await new Promise((r) => setTimeout(r, 150));
    const method = (opts.method || 'GET').toUpperCase(), b = opts.body || {};
    const u = new URL(path, location.origin), p = u.pathname;
    const clone = (x) => JSON.parse(JSON.stringify(x));
    let m;
    if (p === '/api/session') return { brand: { name: 'סוכנות בדיקה' }, setup_needed: false, user: qs.get('nouser') ? null : { id: 1, name: 'ג׳ני', email: 'owner@example.test', role: 'owner' } };
    if (p === '/api/feed') {
      if (qs.get('empty')) return { groups: [] };
      return { groups: M.clients.map((c) => ({ client: clone(c), posts: clone(M.posts.filter((x) => x.client_id === c.id && x.stage !== 'approved')) })).filter((g) => g.posts.length) };
    }
    if (p === '/api/clients') return { clients: clone(M.clients) };
    if (p === '/api/tracks') {
      if (method === 'POST') { const t = { id: ++M.nextId, title: b.title, artist: b.artist || null, source: b.source || 'library', url: b.url || null }; M.tracks.push(t); return { track: t }; }
      return { tracks: clone(M.tracks) };
    }
    if ((m = p.match(/^\/api\/posts\/(\d+)$/))) {
      const post = M.posts.find((x) => x.id === +m[1]); if (!post) throw new Error('not_found');
      if (method === 'PATCH') Object.assign(post, b);
      return { post: clone(post) };
    }
    if ((m = p.match(/^\/api\/posts\/(\d+)\/state$/))) {
      const post = M.posts.find((x) => x.id === +m[1]); post[b.part + '_state'] = b.state;
      if (PARTS.every((k) => post[k + '_state'] === 'approved')) post.stage = 'approved';
      if (PARTS.some((k) => post[k + '_state'] === 'changes')) post.stage = 'editing';
      return { post: clone(post) };
    }
    if ((m = p.match(/^\/api\/posts\/(\d+)\/comments$/))) {
      const post = M.posts.find((x) => x.id === +m[1]);
      const c = { id: ++M.nextId, post_id: post.id, version_id: post.version && post.version.id, target: b.target || 'video', at_sec: b.at_sec ?? null, body: b.body, drawing: b.drawing || null, author: 'ג׳ני', author_kind: 'team', status: 'open', created_at: new Date().toISOString() };
      post.comments.push(c); return { comment: clone(c) };
    }
    if ((m = p.match(/^\/api\/comments\/(\d+)$/))) {
      for (const post of M.posts) {
        const i = post.comments.findIndex((x) => x.id === +m[1]);
        if (i < 0) continue;
        if (method === 'DELETE') { post.comments.splice(i, 1); return { ok: true }; }
        Object.assign(post.comments[i], b); return { comment: clone(post.comments[i]) };
      }
      throw new Error('not_found');
    }
    if ((m = p.match(/^\/api\/posts\/(\d+)\/share$/))) {
      const post = M.posts.find((x) => x.id === +m[1]); post.client_state = 'pending'; post.stage = 'client';
      const c = M.clients.find((x) => x.id === (b.client_id || post.client_id));
      return { ok: true, url: c.share_url };
    }
    throw new Error('mock: no route ' + method + ' ' + p);
  }

  boot();
})();
