/* For You: approvals feed built like Instagram's Reels feed. Plain JS, no build step.
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
  const round4 = (n) => Math.round(n * 10000) / 10000;
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const parseJSON = (v) => { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v); } catch { return null; } };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fy.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fy.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDesk = () => matchMedia('(min-width: 900px)').matches;
  const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* no-op */ } };
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));

  const HEART = 'M12 20.4c-.4 0-9.5-5.3-9.5-11.3C2.5 6 4.8 3.6 7.6 3.6c1.9 0 3.5 1 4.4 2.6.9-1.6 2.5-2.6 4.4-2.6 2.8 0 5.1 2.4 5.1 5.5 0 6-9.1 11.3-9.5 11.3z';
  const RING = 'M12 2.6a9.4 9.4 0 1 1 0 18.8a9.4 9.4 0 1 1 0-18.8z'; /* approve = a thin ring with a check (not a heart) */
  const ICON = {
    approve: `<path class="hf" d="${RING}"/><path class="hc" d="M7.7 12.2l2.9 2.9 5.7-5.8"/>`,
    heartx: `<path class="hf" d="${RING}"/><path class="hc" d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4"/>`,
    side: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M15.5 4v16"/>',
    comment: '<path d="M20.7 16.9A9.6 9.6 0 1 0 17 20.6L21.8 22z"/>',
    share: '<path d="M21.5 2.8L9.4 10"/><path d="M11.7 20.6L21.5 2.8H2.6l6.8 7.2z"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    note: '<path d="M9 17.5V5.2l10.5-2.4v12.3"/><circle cx="6.2" cy="17.6" r="2.8" fill="currentColor"/><circle cx="16.7" cy="15.2" r="2.8" fill="currentColor"/>',
    play: '<path d="M8 4.6v14.8L20 12z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" stroke="none"/>',
    vol: '<path d="M3.5 9.3h3.8L12 5.2v13.6l-4.7-4.1H3.5z" fill="currentColor"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.2 6.2a8.2 8.2 0 0 1 0 11.6"/>',
    mute: '<path d="M3.5 9.3h3.8L12 5.2v13.6l-4.7-4.1H3.5z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>',
    undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    chat: '<path d="M3.6 20.4l1.3-4.1A8.6 8.6 0 1 1 8 19.3z"/><path d="M9.2 8.4c.2 2.9 2.6 5.6 5.6 6.2l1-1.4-1.9-1-.8.8c-1-.5-1.8-1.4-2.2-2.3l.8-.8-.9-2z" fill="currentColor" stroke="none"/>',
    sys: '<path d="M12 3.5v11M7.8 7.5L12 3.3l4.2 4.2"/><path d="M8 10.5H5.5v10h13v-10H16"/>',
    brush: '<path d="M14.5 4.5l5 5L11 18l-5-5z"/><path d="M6 13c-2 0-3 1.5-3 3.5 0 1-.5 2-1.5 2.5 3 .5 7 0 7.5-3"/>',
    rotate: '<rect x="7" y="3" width="10" height="18" rx="2.2" transform="rotate(-90 12 12)"/><path d="M4.5 6.5A9 9 0 0 1 12 2.5M4.5 2.8v3.8h3.8"/>',
    back3: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v3.7h3.7"/>',
    clean: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
    speed: '<path d="M12 20a8 8 0 1 1 8-8"/><path d="M12 12l4.5-3"/>',
    search: '<circle cx="11" cy="11" r="6.8"/><path d="M20.5 20.5l-4.6-4.6"/>',
    up: '<path d="M12 19V5.5M6 11.5l6-6 6 6"/>',
    caption: '<path d="M4 6h16M4 11h16M4 16h9"/>',
    image: '<rect x="3" y="3.5" width="18" height="17" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="M3.5 17.5l5-5 4 4 2.5-2.5 5.5 5"/>',
    grid: '<rect x="5.5" y="3" width="13" height="18" rx="1.5"/><path d="M5.5 7h13M5.5 17h13"/>',
    exit: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  /* ---------- state ---------- */
  /* which side the action rail sits on: theme token --fy-rail-side (right | left), overridable per device from the "…" sheet */
  const railSide = () => store.get('railSide', null) || (getComputedStyle(document.documentElement).getPropertyValue('--fy-rail-side').trim() === 'left' ? 'left' : 'right');
  const setRail = (side) => { document.documentElement.dataset.rail = side; };
  setRail(railSide());

  const S = {
    user: null, brand: null, groups: [], posts: new Map(), clients: new Map(), allClients: null, tracks: null, order: [],
    cards: [], active: null, speed: SPEEDS.includes(store.get('speed', 1)) ? store.get('speed', 1) : 1,
    muted: store.get('muted', false), forcedMute: false, clean: false, sheet: null, modal: null, pop: null, chipClient: null,
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
    p.cover_options = Array.isArray(p.cover_options) ? p.cover_options : [];
    PARTS.forEach((k) => { p[k + '_state'] = p[k + '_state'] || 'pending'; });
    return p;
  }
  function normComment(c) { c.drawing = parseJSON(c.drawing); return c; }
  function mergePost(post, fresh) {
    const keep = post.comments, keepOpts = post.cover_options;
    const t = post._t;
    Object.assign(post, normPost(fresh));
    if (!Array.isArray(fresh.comments) || !fresh.comments.length) post.comments = keep;
    if (!Array.isArray(fresh.cover_options)) post.cover_options = keepOpts;
    post._t = t;
  }
  const isPending = (p) => PARTS.some((k) => p[k + '_state'] === 'pending');
  const clientOf = (p) => S.clients.get(p.client_id) || { id: p.client_id, name: p.client_name || '' };
  const handleOf = (c) => (c.handle ? String(c.handle).replace(/^@/, '') : (c.name || ''));

  /* ---------- toast / confirm / pop menu ---------- */
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
      const okBtn = h('button', { type: 'button', class: 'al-btn ' + (danger ? 'danger' : 'strong'), onclick: () => done(true) }, ok);
      const wrap = h('div', { class: 'fy-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'fy-modal-back', onclick: () => done(false) }),
        h('div', { class: 'fy-modal-box' },
          h('div', { class: 'al-text' }, h('h2', {}, title), text ? h('p', {}, text) : null),
          okBtn,
          h('button', { type: 'button', class: 'al-btn', onclick: () => done(false) }, cancel)));
      document.body.append(wrap);
      S.modal = { close: () => done(false) };
      requestAnimationFrame(() => { wrap.classList.add('in'); okBtn.focus(); });
    });
  }

  function closePop() {
    const p = S.pop; if (!p) return;
    S.pop = null;
    p.box.classList.remove('in'); p.back.remove();
    setTimeout(() => p.box.remove(), 160);
  }
  /* a small floating menu, like a long-press menu on iPhone */
  function popMenu(anchor, items, opt = {}) {
    closePop();
    const back = h('div', { class: 'pop-back', onclick: closePop, oncontextmenu: (e) => { e.preventDefault(); closePop(); } });
    const box = h('div', { class: 'pop', role: 'menu' }, K(items).map((it) => h('button', {
      type: 'button', role: 'menuitem', class: 'pop-i' + (it.cls ? ' ' + it.cls : '') + (it.cur ? ' cur' : ''),
      onclick: (e) => { e.stopPropagation(); closePop(); it.fn(); },
    }, h('span', { class: 'pop-ic', html: icon(it.icon) }), h('span', { class: 'pop-l' }, it.label), it.cur ? h('span', { class: 'pop-cur', html: icon('check') }) : null)));
    document.body.append(back, box);
    const bw = box.offsetWidth, bh = box.offsetHeight, vw = innerWidth, vh = innerHeight;
    let left, top;
    if (opt.at) { left = clamp(opt.at.x - bw / 2, 8, vw - bw - 8); top = opt.at.y + 12; if (top + bh > vh - 8) top = opt.at.y - bh - 12; }
    else {
      const r = anchor.getBoundingClientRect();
      left = r.left - bw - 10; if (left < 8) left = Math.min(vw - bw - 8, r.right + 10);
      top = r.top + r.height / 2 - bh / 2;
    }
    top = clamp(top, 8, vh - bh - 8);
    box.style.left = left + 'px'; box.style.top = top + 'px';
    S.pop = { back, box };
    requestAnimationFrame(() => { box.classList.add('in'); const f = $('.pop-i', box); if (f && !isTouch) f.focus(); });
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
    P.card.classList.remove('attached', 'buffering', 'paused', 'fast', 'peek', 'ready', 'scrubbing');
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
    if (P.el.paused) { card._userPaused = false; play(); }
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
      P.srcs.length ? h('button', { type: 'button', class: 'pill-btn', onclick: (e) => { e.stopPropagation(); P.card = null; card.classList.remove('err'); P.el.remove(); attach(card); } }, 'לנסות שוב') : null));
  }

  function setMuted(m, byUser = true) {
    S.muted = m; S.forcedMute = false;
    if (byUser) store.set('muted', m);
    P.el.muted = m;
    if (!m && P.card && P.el.paused && !P.card._userPaused && !S.sheet) play();
    syncMute();
    if (byUser && S.active) {
      const t = $('.mutetoast', S.active);
      if (t) { t.innerHTML = icon(m ? 'mute' : 'vol'); t.classList.remove('go'); void t.offsetWidth; t.classList.add('go'); }
    }
  }
  function syncMute() {
    const m = P.el.muted;
    const b = $('#soundBtn');
    b.innerHTML = icon(m ? 'mute' : 'vol');
    b.setAttribute('aria-label', m ? 'הפעלת שמע' : 'השתקה');
    document.body.classList.toggle('forced-mute', S.forcedMute && m);
  }

  function setSpeed(x) {
    S.speed = x; store.set('speed', x);
    P.el.defaultPlaybackRate = x;
    if (!(P.card && P.card.classList.contains('fast'))) P.el.playbackRate = x;
    $('#speedTag').textContent = x === 1 ? '' : '×' + x;
  }

  /* ---------- progress bar (Instagram scrubber) ---------- */
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
    card._prog.fill.style.transform = 'scaleX(' + f + ')';
    card._prog.knob.style.left = (f * 100) + '%';
    if (P.scrub) card._prog.time.textContent = fmt(t) + ' / ' + fmt(d);
    if (S.sheet && S.sheet.onTick) S.sheet.onTick(t);
  }

  function buildProgress(card, post) {
    const fill = h('div', { class: 'prog-fill' });
    const marks = h('div', { class: 'prog-marks' });
    const knob = h('div', { class: 'prog-knob' });
    const time = h('div', { class: 'scrub-time', 'aria-hidden': 'true' });
    const track = h('div', { class: 'prog-track' }, fill, marks, knob);
    const prog = h('div', { class: 'prog', role: 'slider', 'aria-label': 'מיקום בסרטון', tabindex: '-1' }, track);
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
    return [prog, time];
  }

  function renderMarks(post) {
    const card = cardFor(post, 'video'); if (!card || !card._prog) return;
    const d = duration(post);
    card._prog.marks.replaceChildren(...K(...(d ? videoComments(post).filter((c) => c.at_sec != null)
      .map((c) => h('i', { style: { left: clamp(c.at_sec / d, 0, 1) * 100 + '%' }, class: c.status === 'done' ? 'done' : '' })) : [])));
  }

  /* ---------- gestures on the picture ----------
     tap = pause / play (or bring the overlays back in clean screen)
     double tap = approve, with the big heart where the finger was
     hold right half = 2x, hold elsewhere = peek (pause, overlays away) */
  function bindGestures(card, gest, o) {
    let start = null, timer = 0, held = null, lastTap = null, single = 0;
    const release = () => {
      if (held === 'fast') { card.classList.remove('fast'); P.el.playbackRate = S.speed; }
      if (held === 'peek') { card.classList.remove('peek'); if (!card._userPaused) play(); }
      held = null;
    };
    gest.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      clearTimeout(timer);
      if (!o.hold || P.card !== card || S.clean) return;
      timer = setTimeout(() => {
        if (!start) return;
        clearTimeout(single); lastTap = null;
        const r = gest.getBoundingClientRect();
        if (start.x - r.left > r.width * 0.5) {
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
      if (!start || performance.now() - start.t >= 380) { start = null; return; }
      const { x, y } = start; start = null;
      const now = performance.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 60) {
        clearTimeout(single); lastTap = null; o.onDouble && o.onDouble(x, y); return;
      }
      lastTap = { t: now, x, y };
      clearTimeout(single);
      single = setTimeout(() => { lastTap = null; o.onTap && o.onTap(); }, o.onDouble ? 260 : 0);
    });
    gest.addEventListener('pointercancel', () => { clearTimeout(timer); start = null; if (held) release(); });
    gest.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function heartBurst(card, x, y) {
    const st = $('.stage', card), r = st.getBoundingClientRect();
    const b = h('div', { class: 'burst', 'aria-hidden': 'true', html: icon('approve'),
      style: { left: (x == null ? r.width / 2 : x - r.left) + 'px', top: (y == null ? r.height / 2 : y - r.top) + 'px', '--tilt': (Math.random() * 30 - 15).toFixed(1) + 'deg' } });
    st.append(b);
    setTimeout(() => b.remove(), 1000);
    vibrate(12);
  }

  /* ================================================================
     Drawing layer (normalised to the visible video picture)
     drawing JSON: {v:1, strokes:[{c:"#hex", w:0.008, p:[[x,y],...]}]}  x,y in 0..1
     ================================================================ */
  function contentRect(card) {
    const box = $('.vbox', card);
    const W = box.clientWidth, H = box.clientHeight;
    const post = card._fy.post, ver = post.version || {};
    const ar = (P.card === card && P.el.videoWidth) ? P.el.videoWidth / P.el.videoHeight
      : (ver.width && ver.height) ? ver.width / ver.height : (post.orientation === 'horizontal' ? 16 / 9 : 9 / 16);
    const fitEl = $('.vid', box) || $('.poster', box);
    const cover = fitEl && getComputedStyle(fitEl).objectFit === 'cover';
    let w = W, hh = W / ar;
    if (cover ? hh < H : hh > H) { hh = H; w = H * ar; }
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

  /* ================================================================
     Cards
     ================================================================ */
  const cardFor = (post, type) => S.cards.find((c) => c._fy.post === post && c._fy.type === type);
  const videoComments = (post) => post.comments.filter((c) => (c.target || 'video') === 'video')
    .sort((a, b) => (a.at_sec ?? 1e9) - (b.at_sec ?? 1e9) || a.id - b.id);
  const metaComments = (post) => post.comments.filter((c) => c.target === 'cover' || c.target === 'caption').sort((a, b) => a.id - b.id);

  function videoCard(post, group) {
    const horizontal = post.orientation === 'horizontal';
    const card = h('section', { class: 'card card-video' + (horizontal ? ' card-h' : ''), 'data-post': post.id, 'data-client': post.client_id, 'aria-label': post.title || 'סרטון' });
    card._fy = { type: 'video', post, group };
    const ver = post.version || {};
    if (horizontal && ver.width && ver.height) card.style.setProperty('--ar', String(ver.height / ver.width));
    const gest = h('div', { class: 'gest' });
    const [prog, scrubTime] = buildProgress(card, post);
    const stage = h('div', { class: 'stage' },
      h('div', { class: 'vbox' },
        ver.thumb || post.cover_url ? h('img', { class: 'poster', src: ver.thumb || post.cover_url, alt: '', decoding: 'async', loading: S.cards.length < 4 ? 'eager' : 'lazy' }) : null,
        h('canvas', { class: 'ink' })),
      h('div', { class: 'shade', 'aria-hidden': 'true' }),
      gest,
      h('div', { class: 'vstate', 'aria-hidden': 'true', html: icon('play') }),
      h('div', { class: 'vspin', 'aria-hidden': 'true' }),
      h('div', { class: 'fastpill', 'aria-hidden': 'true', dir: 'ltr' }, '2x', h('span', { html: icon('play') + icon('play') })),
      h('div', { class: 'mutetoast', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'soundhint', onclick: (e) => { e.stopPropagation(); setMuted(false); } }, h('span', { html: icon('mute') }), 'הקשה להפעלת השמע'),
      h('div', { class: 'verr' }),
      horizontal ? h('button', { type: 'button', class: 'fullpill', onclick: (e) => { e.stopPropagation(); goFull(card); } }, h('span', { html: icon('rotate') }), 'מסך מלא') : null,
      h('div', { class: 'info' }),
      scrubTime,
      prog,
      h('div', { class: 'land-acts' }));
    card.append(h('div', { class: 'col' }, stage, h('div', { class: 'rail' })));
    bindGestures(card, gest, {
      hold: true,
      onTap: () => { if (S.clean) setClean(false); else if (card._capOpen) toggleCaption(card, false); else togglePause(card); },
      onDouble: (x, y) => { if (S.clean) return; heartBurst(card, x, y); if (post.video_state !== 'approved') setState(post, 'video', 'approved'); },
    });
    new ResizeObserver(() => sizeInk(card)).observe($('.vbox', card));
    bindInkInput(card);
    return card;
  }

  /* bottom-left overlay: avatar + handle + version pill, caption, audio */
  function buildInfo(card) {
    const { post, type } = card._fy;
    const c = clientOf(post);
    const handle = handleOf(c) || post.client_name || '';
    const pill = type === 'meta'
      ? h('span', { class: 'ver' }, 'קאבר וכיתוב')
      : h('button', { type: 'button', class: 'ver', onclick: (e) => { e.stopPropagation(); versionToast(post); } }, post.version ? 'גרסה ' + post.version.n : 'אין גרסה');
    const who = h('div', { class: 'who' }, avatar(c, 32), h('b', { class: 'handle', dir: 'auto' }, handle), pill);

    let cap;
    if (!post.caption) {
      cap = h('button', { type: 'button', class: 'cap empty', onclick: (e) => { e.stopPropagation(); openCaptionEdit(post); } }, 'אין כיתוב · הוספה');
    } else if (card._capOpen) {
      cap = h('div', { class: 'cap open', onclick: (e) => { if (e.target.closest('button')) return; e.stopPropagation(); toggleCaption(card, false); } },
        h('div', { class: 'cap-t', dir: 'auto' }, post.caption),
        h('button', { type: 'button', class: 'cap-edit', onclick: (e) => { e.stopPropagation(); openCaptionEdit(post); } }, 'שינוי כיתוב'));
    } else {
      cap = h('div', { class: 'cap', onclick: (e) => { e.stopPropagation(); toggleCaption(card, true); } },
        h('span', { class: 'cap-t', dir: 'auto' }, post.caption.split('\n')[0]),
        h('span', { class: 'cap-more' }, '…עוד'));
    }

    const m = post.music && post.music.title;
    const text = m ? post.music.title + (post.music.artist ? ' · ' + post.music.artist : '') : handle + ' · סאונד מקורי';
    const long = text.length > 26;
    const audio = h('button', { type: 'button', class: 'audio', 'aria-label': 'מוזיקה: ' + text, onclick: (e) => { e.stopPropagation(); openMusic(post); } },
      h('span', { class: 'audio-ic', html: icon('note') }),
      h('span', { class: 'marq' + (long ? ' run' : '') }, h('span', { dir: 'auto' }, text), long ? h('span', { dir: 'auto', 'aria-hidden': 'true' }, text) : null));

    $('.info', card).replaceChildren(who, cap, audio);
    requestAnimationFrame(() => fitCaption(card));
  }
  function fitCaption(card) {
    const cap = $('.info .cap:not(.open):not(.empty)', card); if (!cap) return;
    const t = $('.cap-t', cap), post = card._fy.post;
    cap.classList.toggle('cut', post.caption.includes('\n') || t.scrollWidth > t.clientWidth + 1);
  }
  function toggleCaption(card, open) {
    card._capOpen = open;
    card.classList.toggle('cap-open', open);
    buildInfo(card);
  }
  function versionToast(post) {
    const v = post.version;
    if (!v) { toast('עוד אין גרסה'); return; }
    toast('גרסה ' + v.n + (v.note ? ' · ' + v.note : '') + (v.duration ? ' · ' + fmt(v.duration) : '') + ((post.versions || []).length > 1 ? ' · ' + post.versions.length + ' גרסאות' : ''));
  }

  function goFull(card) {
    const tryLock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch { /* not allowed */ } };
    if (card.requestFullscreen) { card.requestFullscreen().then(tryLock).catch(() => { if (P.card === card && P.el.webkitEnterFullscreen) P.el.webkitEnterFullscreen(); }); return; }
    if (P.card === card && P.el.webkitEnterFullscreen) P.el.webkitEnterFullscreen();
  }
  function exitFull() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }

  /* --- action rail --- */
  function railButton(cls, ico, label, onTap, extra = {}) {
    const b = h('button', { type: 'button', class: 'rb ' + cls, 'aria-label': extra.aria || label },
      h('span', { class: 'rb-ic', html: icon(ico) }), label ? h('span', { class: 'rb-l' }, label) : null);
    if (extra.onHold) {
      let t = 0, fired = false;
      b.addEventListener('pointerdown', () => { fired = false; t = setTimeout(() => { fired = true; vibrate(10); extra.onHold(b); }, 450); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(t)));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (fired) { fired = false; return; } onTap(b); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { fired = true; extra.onHold(b); } });
    } else b.addEventListener('click', (e) => { e.stopPropagation(); onTap(b); });
    return b;
  }

  const ST_LABEL = { pending: 'אישור', approved: 'אושר', changes: 'לתקן' };
  function approveButton(post, part, label) {
    const st = post[part + '_state'];
    const pop = post._pop === part; if (pop) post._pop = null;
    const names = { video: 'הסרטון', cover: 'הקאבר', caption: 'הכיתוב' };
    return railButton('approve st-' + st + (pop ? ' pop' : ''), st === 'changes' ? 'heartx' : 'approve', label || ST_LABEL[st],
      (b) => (st === 'pending' ? approvePart(post, part) : stateChooser(post, part, b)),
      { onHold: (b) => stateChooser(post, part, b), aria: 'אישור ' + names[part] + ': ' + ({ pending: 'ממתין', approved: 'מאושר', changes: 'לא מאושר' })[st] });
  }

  function musicSquare(post) {
    const c = clientOf(post);
    const src = post.music ? (post.cover_url || (post.version && post.version.thumb)) : c.avatar;
    const b = h('button', { type: 'button', class: 'rb-music', 'aria-label': 'מוזיקה' + (post.music ? ': ' + post.music.title : '') },
      src ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { html: icon('note') }));
    b.addEventListener('click', (e) => { e.stopPropagation(); openMusic(post); });
    return b;
  }

  function buildRail(card) {
    const { post, type } = card._fy;
    const shared = post.client_state === 'pending' || post.stage === 'client';
    if (type === 'video') {
      const n = videoComments(post).length;
      return [
        approveButton(post, 'video'),
        railButton('comments', 'comment', String(n), () => openComments(post), { aria: 'הערות (' + n + ')' }),
        railButton('share' + (shared ? ' on' : ''), 'share', shared ? 'נשלח' : 'שליחה', () => openShare(post)),
        railButton('more', 'more', '', () => openMore(post, 'video'), { aria: 'עוד' }),
        musicSquare(post),
      ];
    }
    const n = metaComments(post).length;
    return [
      approveButton(post, 'cover', 'קאבר'),
      approveButton(post, 'caption', 'כיתוב'),
      railButton('comments', 'comment', String(n), () => openComments(post, { meta: true }), { aria: 'הערות על הקאבר והכיתוב (' + n + ')' }),
      railButton('share' + (shared ? ' on' : ''), 'share', shared ? 'נשלח' : 'שליחה', () => openShare(post)),
      railButton('more', 'more', '', () => openMore(post, 'cover'), { aria: 'עוד' }),
      musicSquare(post),
    ];
  }

  function landActs(card) {
    const post = card._fy.post;
    const n = videoComments(post).length;
    return [
      approveButton(post, 'video'),
      railButton('comments', 'comment', String(n), () => openComments(post), { aria: 'הערות (' + n + ')' }),
      document.fullscreenElement ? railButton('exitfull', 'exit', 'יציאה', () => exitFull()) : null,
    ];
  }

  /* approve a part; with cover options, approving the cover = choosing the option on screen */
  function approvePart(post, part) {
    if (part === 'cover' && post.cover_options.length) {
      const mc = cardFor(post, 'meta');
      const opt = post.cover_options[mc ? coIndex(mc) : 0] || post.cover_options[0];
      chooseCover(post, opt);
      return;
    }
    if (part !== 'video') post._metaTouched = true;
    setState(post, part, 'approved');
  }

  function stateChooser(post, part, anchor) {
    const cur = post[part + '_state'];
    popMenu(anchor, [
      { icon: 'approve', label: 'מאושר', cls: 'ok', cur: cur === 'approved', fn: () => approvePart(post, part) },
      { icon: 'x', label: 'לא מאושר', cls: 'bad', cur: cur === 'changes', fn: () => rejectPart(post, part, false) },
      { icon: 'pencil', label: 'לתקן', fn: () => rejectPart(post, part, true) },
      cur !== 'pending' ? { icon: 'undo', label: 'החזרה להמתנה', fn: () => setState(post, part, 'pending') } : null,
    ]);
  }

  function rejectPart(post, part, ask) {
    if (part !== 'video') post._metaTouched = true;
    if (part !== 'video') post._ask = ask;
    setState(post, part, 'changes');
    if (ask) setTimeout(() => (part === 'video' ? openComments(post, { focus: true }) : openComments(post, { meta: true, target: part, focus: true })), 200);
    else if (part === 'video') toast('סומן כלא מאושר', { action: 'מה לתקן?', fn: () => openComments(post, { focus: true }) });
  }

  async function setState(post, part, state) {
    const key = part + '_state', prev = post[key];
    if (prev === state) return;
    post[key] = state;
    if (state === 'approved') { post._pop = part; vibrate(12); }
    refreshPost(post);
    try {
      const r = await api('/api/posts/' + post.id + '/state', { method: 'POST', body: { part, state } });
      if (r && r.post) mergePost(post, r.post);
      refreshPost(post);
    } catch {
      post[key] = prev; refreshPost(post);
      toast('לא נשמר, אפשר לנסות שוב');
    }
  }

  /* --- cover + caption card, built like an Instagram post preview --- */
  function metaCard(post, group) {
    const card = h('section', { class: 'card card-meta' + (post.orientation === 'horizontal' ? ' card-h' : ''), 'data-post': post.id, 'data-client': post.client_id, 'aria-label': 'קאבר וכיתוב: ' + (post.title || '') });
    card._fy = { type: 'meta', post, group };
    const gest = h('div', { class: 'gest' });
    const stage = h('div', { class: 'stage' }, h('div', { class: 'mbody' }), h('div', { class: 'shade', 'aria-hidden': 'true' }), gest, h('div', { class: 'info' }));
    card.append(h('div', { class: 'col' }, stage, h('div', { class: 'rail' })));
    bindGestures(card, gest, {
      hold: false,
      onTap: () => { if (S.clean) setClean(false); else if (card._capOpen) toggleCaption(card, false); },
      onDouble: (x, y) => { if (S.clean) return; heartBurst(card, x, y); if (post.cover_state !== 'approved') approvePart(post, 'cover'); },
    });
    renderMetaBody(card);
    return card;
  }

  function renderMetaBody(card) {
    const post = card._fy.post;
    const body = $('.mbody', card);
    const opts = post.cover_options;
    card.classList.toggle('has-opts', opts.length > 0);
    if (!opts.length) {
      const src = post.cover_url || (post.version && post.version.thumb);
      body.replaceChildren(...K(
        src ? h('img', { class: 'cover-full', src, alt: 'הקאבר', loading: 'lazy', decoding: 'async' }) : h('div', { class: 'cover-none' }, 'עוד אין קאבר'),
        post.orientation !== 'horizontal' && src ? h('div', { class: 'frame45', 'aria-hidden': 'true' }, h('span', {}, 'כך הקאבר ייחתך בגריד')) : null,
        post.orientation !== 'horizontal' && src ? h('button', { type: 'button', class: 'gridpill', 'aria-pressed': 'false', onclick: (e) => {
          e.stopPropagation(); const on = card.classList.toggle('grid'); e.currentTarget.setAttribute('aria-pressed', String(on));
        } }, h('span', { html: icon('grid') }), 'חיתוך גריד 4:5') : null));
      return;
    }
    // Instagram-style carousel of cover options
    const chosenIdx = Math.max(0, opts.findIndex((o) => o.chosen));
    const track = h('div', { class: 'co-track', tabindex: '0', 'aria-label': 'אפשרויות קאבר' },
      opts.map((o, i) => h('div', { class: 'co-slide', 'data-i': i, role: 'group', 'aria-label': 'אפשרות ' + (i + 1) + ' מתוך ' + opts.length },
        h('div', { class: 'co-img' }, h('img', { src: o.url, alt: o.note || 'אפשרות ' + (i + 1), loading: 'lazy', decoding: 'async' }),
          h('span', { class: 'co-badge' }, h('span', { html: icon('check') }), 'נבחר')))));
    const dots = h('div', { class: 'co-dots', 'aria-hidden': 'true' }, opts.map(() => h('i')));
    const count = h('span', { class: 'co-count', 'aria-hidden': 'true' });
    const note = h('div', { class: 'co-note', dir: 'auto' });
    const choose = h('button', { type: 'button', class: 'co-choose', onclick: (e) => { e.stopPropagation(); chooseCover(post, opts[coIndex(card)]); } });
    const ask = h('button', { type: 'button', class: 'co-ask', onclick: (e) => { e.stopPropagation(); openCoverText(post, opts[coIndex(card)], coIndex(card)); } }, 'בקשת שינוי טקסט');
    const bg = h('div', { class: 'co-bg', 'aria-hidden': 'true' });
    body.replaceChildren(bg, h('div', { class: 'co' }, h('div', { class: 'co-frame' }, track, count), dots, note, h('div', { class: 'co-acts' }, choose, ask)));
    card._co = { track, dots, count, note, choose, bg };
    let raf = 0;
    track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => syncCo(card)); }, { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const d = (e.key === 'ArrowLeft') === (getComputedStyle(track).direction === 'rtl') ? 1 : -1;
      scrollCo(card, clamp(coIndex(card) + d, 0, opts.length - 1));
    });
    requestAnimationFrame(() => { scrollCo(card, chosenIdx, false); syncCo(card); });
  }
  function coIndex(card) {
    const t = card._co && card._co.track; if (!t || !t.clientWidth) return 0;
    return clamp(Math.round(Math.abs(t.scrollLeft) / t.clientWidth), 0, card._fy.post.cover_options.length - 1);
  }
  function scrollCo(card, i, smooth = true) {
    const t = card._co && card._co.track; if (!t) return;
    const rtl = getComputedStyle(t).direction === 'rtl';
    t.scrollTo({ left: (rtl ? -1 : 1) * i * t.clientWidth, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  }
  function syncCo(card) {
    const co = card._co; if (!co) return;
    const post = card._fy.post, opts = post.cover_options, i = coIndex(card), o = opts[i];
    $$('i', co.dots).forEach((d, k) => d.classList.toggle('on', k === i));
    co.count.textContent = (i + 1) + '/' + opts.length;
    co.note.textContent = 'אפשרות ' + (i + 1) + (o && o.note ? ' · ' + o.note : '');
    $$('.co-slide', co.track).forEach((s, k) => s.classList.toggle('chosen', !!(opts[k] && opts[k].chosen)));
    const chosen = !!(o && o.chosen);
    co.choose.classList.toggle('on', chosen);
    co.choose.replaceChildren(...K(chosen ? h('span', { html: icon('check') }) : null, chosen ? 'נבחר' : 'בחירה'));
    if (o) co.bg.style.backgroundImage = 'url("' + String(o.url).replace(/"/g, '%22') + '")';
  }

  async function chooseCover(post, opt) {
    if (!opt) return;
    const prev = post.cover_options.map((o) => o.chosen), prevState = post.cover_state, prevUrl = post.cover_url;
    post.cover_options.forEach((o) => { o.chosen = o === opt; });
    post.cover_state = 'approved'; post.cover_url = opt.url; post._pop = 'cover'; post._metaTouched = true;
    vibrate(12);
    refreshPost(post);
    try {
      const r = await api('/api/posts/' + post.id + '/cover/choose', { method: 'POST', body: { option_id: opt.id } });
      if (r && r.post) mergePost(post, r.post);
      refreshPost(post);
    } catch {
      post.cover_options.forEach((o, i) => { o.chosen = prev[i]; });
      post.cover_state = prevState; post.cover_url = prevUrl; refreshPost(post);
      toast('לא נשמר, אפשר לנסות שוב');
    }
  }

  async function saveCaption(post, text) {
    const prev = post.caption;
    post.caption = text; post._metaTouched = true;
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
      h('div', { class: 'calm-ic', html: icon('check') }),
      h('h2', {}, left ? 'עברת על הכול' : 'הכול מאושר'),
      h('p', {}, left ? 'נשארו ' + left + ' עם החלטה פתוחה' : 'אין כרגע עוד משהו שמחכה לך'),
      h('div', { class: 'end-acts' },
        left ? h('button', { type: 'button', class: 'pill-btn solid', onclick: () => { const c = firstPendingCard(); if (c) scrollToCard(c); } }, 'לפתוחים') : null,
        h('a', { class: 'pill-btn' + (left ? '' : ' solid'), href: '/' }, 'למסך הבית'))));
  }
  const firstPendingCard = () => S.cards.find((c) => c._fy.post && isPending(c._fy.post));

  /* refresh everything that shows a post's state, without touching the video box */
  function refreshPost(post) {
    const all = PARTS.every((k) => post[k + '_state'] === 'approved');
    [cardFor(post, 'video'), cardFor(post, 'meta')].forEach((c) => {
      if (!c) return;
      $('.rail', c).replaceChildren(...K(buildRail(c)));
      buildInfo(c);
      c.classList.toggle('is-approved', post[(c._fy.type === 'video' ? 'video' : 'cover') + '_state'] === 'approved');
    });
    const vc = cardFor(post, 'video');
    if (vc) { $('.land-acts', vc).replaceChildren(...K(landActs(vc))); renderMarks(post); }
    const mc = cardFor(post, 'meta');
    if (mc) {
      if (mc._co) syncCo(mc);
      else if (!post.cover_options.length) { const img = $('.cover-full', mc); if (img && post.cover_url && img.getAttribute('src') !== post.cover_url) img.src = post.cover_url; }
      if (post._metaTouched && post.caption_state !== 'pending' && post.cover_state !== 'pending' && S.active === mc) {
        post._metaTouched = false;
        if (!post._ask) setTimeout(() => { if (S.active === mc && !S.sheet) step(1); }, 700);
        post._ask = false;
      }
    }
    if (all && post._wasAll === false) toast('הכול מאושר', { action: 'שליחה ללקוח', fn: () => openShare(post) });
    post._wasAll = all;
    updateCounts();
  }

  /* --- counts and the top bar --- */
  const countLeft = () => { let n = 0; S.posts.forEach((p) => { if (isPending(p)) n++; }); return n; };
  function updateCounts() { renderEnd(); updateTop(); }

  function updateTop() {
    const post = S.active && S.active._fy.post;
    const total = S.order.length;
    $('#count').textContent = post && total ? (S.order.indexOf(post) + 1) + '/' + total : (total ? '' : '');
    const chip = $('#clientChip');
    if (!post) { chip.hidden = true; return; }
    chip.hidden = false;
    const c = clientOf(post);
    if (S.chipClient !== c.id) {
      S.chipClient = c.id;
      chip.replaceChildren(avatar(c, 30));
      chip.setAttribute('aria-label', 'הלקוח: ' + (c.name || '') + ' · מעבר ללקוח');
      chip.classList.remove('swap'); void chip.offsetWidth; chip.classList.add('swap');
    }
  }

  /* ---------- feed render + active card ---------- */
  let io = null;
  function render() {
    feed.replaceChildren(); S.cards = []; S.order = [];
    if (!S.groups.length) { renderEmpty(); return; }
    S.groups.forEach((g) => {
      S.clients.set(g.client.id, g.client);
      g.posts.forEach((p) => { S.posts.set(String(p.id), p); S.order.push(p); });
    });
    S.groups.forEach((g) => {
      g.posts.forEach((p) => {
        const vc = videoCard(p, g); S.cards.push(vc); feed.append(vc);
        const mc = metaCard(p, g); S.cards.push(mc); feed.append(mc);
      });
    });
    const end = endCard(); S.cards.push(end); feed.append(end);
    S.posts.forEach((p) => { p._wasAll = PARTS.every((k) => p[k + '_state'] === 'approved'); refreshPost(p); });
    updateCounts(); syncMute();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(e.target);
    }, { root: feed, threshold: [0.6] });
    S.cards.forEach((c) => io.observe(c));
  }

  function renderEmpty() {
    document.body.classList.add('is-empty');
    $('#clientChip').hidden = true;
    feed.append(h('section', { class: 'card card-end empty' }, h('div', { class: 'end-in' },
      h('div', { class: 'calm-ic', html: icon('check') }),
      h('h2', {}, 'הכול מאושר'),
      h('p', {}, 'אין כרגע סרטונים שמחכים לך. כשיעלה משהו חדש הוא יופיע כאן'),
      h('a', { class: 'pill-btn solid', href: '/' }, 'למסך הבית'))));
  }

  function setActive(card) {
    if (S.active === card) return;
    if (S.active) S.active.classList.remove('active');
    S.active = card; card.classList.add('active');
    const f = card._fy;
    document.body.classList.toggle('on-end', f.type === 'end');
    if (f.type === 'video') attach(card); else detach();
    if (f.post) fitCaption(card);
    updateTop();
    const nxt = S.cards[S.cards.indexOf(card) + 2];
    const img = nxt && $('img.poster', nxt); if (img) img.loading = 'eager';
  }

  function scrollToCard(card, smooth = true) {
    if (!card) return;
    feed.scrollTo({ top: card.offsetTop, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  }
  function step(d) {
    const i = S.cards.indexOf(S.active);
    scrollToCard(S.cards[clamp(i + d, 0, S.cards.length - 1)]);
  }

  /* landscape phone / full screen = minimal overlay */
  const landMQ = matchMedia('(orientation: landscape) and (max-height: 540px)');
  function syncLand() {
    document.body.classList.toggle('land', landMQ.matches || !!document.fullscreenElement);
    document.body.classList.toggle('is-full', !!document.fullscreenElement);
    S.posts.forEach((p) => { const vc = cardFor(p, 'video'); if (vc) $('.land-acts', vc).replaceChildren(...K(landActs(vc))); });
    if (S.active) requestAnimationFrame(() => scrollToCard(S.active, false));
  }
  landMQ.addEventListener && landMQ.addEventListener('change', syncLand);
  document.addEventListener('fullscreenchange', syncLand);
  window.addEventListener('resize', () => { if (S.active) fitCaption(S.active); });

  /* ================================================================
     Bottom sheet (Instagram dark sheet with a grabber)
     ================================================================ */
  function openSheet({ title, body, cls = '', squeeze = null, onClose = null, onTick = null, clearBack = false, hideTitle = false }) {
    if (S.sheet) closeSheet();
    closePop();
    const closeBtn = h('button', { type: 'button', class: 'sheet-x', 'aria-label': 'סגירה', html: icon('x'), onclick: () => closeSheet() });
    const head = h('div', { class: 'sheet-head' + (hideTitle ? ' bare' : '') }, h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
      hideTitle ? null : h('h2', { class: 'sheet-title' }, title), closeBtn);
    const bodyWrap = h('div', { class: 'sheet-body' }, body);
    const panel = h('div', { class: 'sheet ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, head, bodyWrap);
    const back = h('div', { class: 'sheet-back' + (clearBack ? ' clear' : ''), onclick: () => closeSheet() });
    sheetRoot.append(back, panel);
    const s = { panel, back, head, bodyWrap, onClose, onTick, squeeze, ro: null };
    S.sheet = s;
    document.body.classList.add('sheet-open');
    if (squeeze) {
      const setH = () => squeeze.style.setProperty('--squeeze-h', Math.max(120, window.innerHeight - panel.offsetHeight) + 'px');
      s.ro = new ResizeObserver(setH); s.ro.observe(panel); setH();
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
    if (s.squeeze) s.squeeze.classList.remove('squeeze');
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
    let ty = null;
    bodyWrap.addEventListener('touchstart', (e) => {
      if (e.target.closest('textarea, input, canvas, .no-drag, .sh-grid')) { ty = null; return; }
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
     Comments sheet (video: at a second, with drawing; meta: cover / caption notes)
     ================================================================ */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function inkPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    return [v('--fy-like', '#ff3040'), v('--fy-warn', '#ffb020'), v('--fy-accent', '#0095f6'), v('--fy-on', '#ffffff')];
  }

  function openComments(post, opt = {}) {
    const meta = !!opt.meta;
    const card = cardFor(post, meta ? 'meta' : 'video');
    if (!card) return;
    if (S.active !== card) { scrollToCard(card, false); setActive(card); }
    const wasPlaying = !meta && P.card === card && !P.el.paused;
    if (!meta && P.card === card) P.el.pause();

    const palette = inkPalette();
    const C = { editing: null, rec: null, target: opt.target || 'cover', draw: { on: false, color: palette[0], drawing: { v: 1, strokes: [] }, changed: () => syncDraft() } };

    const list = h('div', { class: 'cm-list' });
    const ta = h('textarea', { class: 'cm-in', rows: '1', dir: 'rtl', placeholder: '', 'aria-label': 'הערה', enterkeyhint: 'send' });
    const sendBtn = h('button', { type: 'button', class: 'cm-send', 'aria-label': 'שליחה', html: icon('up') });
    const micBtn = SR ? h('button', { type: 'button', class: 'cm-ib', 'aria-label': 'הכתבה', html: icon('mic') }) : null;
    const draft = h('div', { class: 'cm-draft' });
    const timeChip = h('span', { class: 'cm-at' }, '0:00');
    const seek = (dt) => { if (P.card !== card) return; P.el.pause(); P.el.currentTime = clamp((P.el.currentTime || 0) + dt, 0, duration(post) || 1e6); updateProgress(); };
    const drawBtn = meta ? null : h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'ציור על הפריים' }, h('span', { html: icon('brush') }), 'ציור');

    const setPlaceholder = (t) => {
      ta.placeholder = meta ? (C.target === 'cover' ? 'הוסף הערה על הקאבר…' : 'הוסף הערה על הכיתוב…') : 'הוסף הערה בשנייה ' + fmt(t) + '…';
    };

    let tools;
    if (meta) {
      const tchip = (target, label) => h('button', { type: 'button', class: 'cm-tool' + (C.target === target ? ' on' : ''), 'aria-pressed': String(C.target === target),
        onclick: (e) => { C.target = target; $$('.cm-tool', tools).forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); setPlaceholder(0); } }, label);
      tools = h('div', { class: 'cm-tools no-drag' }, h('span', { class: 'cm-tools-l' }, 'הערה על'), tchip('cover', 'קאבר'), tchip('caption', 'כיתוב'));
    } else {
      tools = h('div', { class: 'cm-tools no-drag' },
        h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'שלוש שניות אחורה', onclick: () => seek(-3) }, h('span', { html: icon('back3') }), '3'),
        h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'שנייה אחורה', onclick: () => seek(-1) }, '−1'),
        h('span', { class: 'cm-atbox' }, timeChip),
        h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'שנייה קדימה', onclick: () => seek(1) }, '+1'),
        h('span', { class: 'grow' }),
        drawBtn);
    }

    const drawBar = meta ? null : h('div', { class: 'drawbar no-drag' },
      ...palette.map((col, i) => h('button', { type: 'button', class: 'swatch' + (i === 0 ? ' on' : ''), style: { background: col }, 'aria-label': 'צבע ' + (i + 1),
        onclick: (e) => { C.draw.color = col; $$('.swatch', drawBar).forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } })),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'cm-tool', 'aria-label': 'ביטול קו אחרון', html: icon('undo'), onclick: () => { C.draw.drawing.strokes.pop(); showInk(card, C.draw.drawing); syncDraft(); } }),
      h('button', { type: 'button', class: 'cm-tool', onclick: () => { C.draw.drawing.strokes = []; showInk(card, C.draw.drawing); syncDraft(); } }, 'ניקוי'),
      h('button', { type: 'button', class: 'cm-tool solid', onclick: () => setDraw(false) }, 'סיום'));

    const me = avatar({ name: (S.user && S.user.name) || 'א' }, 32);
    const composer = h('div', { class: 'cm-compose no-drag' },
      tools, draft, drawBar,
      h('div', { class: 'cm-row' }, me, h('div', { class: 'cm-field' }, ta, micBtn), sendBtn));

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
        n && !C.draw.on ? h('span', { class: 'tag' }, h('span', { html: icon('brush') }), 'יש ציור', h('button', { type: 'button', 'aria-label': 'מחיקת הציור', html: icon('x'), onclick: () => { C.draw.drawing.strokes = []; showInk(card, null); syncDraft(); } })) : null));
      draft.hidden = !draft.childElementCount;
      sendBtn.classList.toggle('ready', !!(ta.value.trim() || n));
    }
    function resetComposer() {
      C.editing = null; ta.value = ''; autosize();
      C.draw.drawing = { v: 1, strokes: [] };
      if (!meta) { showInk(card, null); setDraw(false); }
      $$('.cm', list).forEach((r) => r.classList.remove('editing'));
      syncDraft();
    }
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
    ta.addEventListener('input', () => { autosize(); syncDraft(); });
    ta.addEventListener('focus', () => { if (!meta && P.card === card) P.el.pause(); if (C.draw.on) setDraw(false); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); send(); } });
    if (drawBtn) drawBtn.addEventListener('click', () => setDraw(!C.draw.on));
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
      try { rec.start(); C.rec = rec; micBtn.classList.add('on'); if (!meta && P.card === card) P.el.pause(); } catch { toast('ההכתבה לא נפתחה'); }
    }

    async function send() {
      const body = ta.value.trim();
      const drawing = C.draw.drawing.strokes.length ? C.draw.drawing : null;
      if (!body && !drawing) { ta.focus(); return; }
      if (C.rec) C.rec.stop();
      const payload = meta ? { body } : { body: body || 'ציור על הפריים', at_sec: round1(P.card === card ? P.el.currentTime : 0), drawing: drawing || null };
      sendBtn.disabled = true;
      try {
        if (C.editing) {
          const r = await api('/api/comments/' + C.editing.id, { method: 'PATCH', body: payload });
          Object.assign(C.editing, normComment((r && r.comment) || { ...payload }));
          toast('ההערה עודכנה');
        } else {
          const target = meta ? C.target : 'video';
          const r = await api('/api/posts/' + post.id + '/comments', { method: 'POST', body: { target, ...payload } });
          const cm = normComment((r && r.comment) || { id: Date.now(), target, author: S.user && S.user.name, author_kind: 'team', status: 'open', ...payload });
          if (post.version && cm.version_id == null) cm.version_id = post.version.id;
          post.comments.push(cm);
          if (target === 'cover' && post.cover_state !== 'changes') { post.cover_state = 'changes'; }
        }
        resetComposer();
        renderList(); refreshPost(post);
      } catch { toast('לא נשמר, אפשר לנסות שוב'); }
      finally { sendBtn.disabled = false; }
    }

    const verN = (id) => { const v = (post.versions || []).find((x) => x.id === id); return v ? v.n : null; };
    const optN = (id) => { const i = post.cover_options.findIndex((o) => o.id === id); return i < 0 ? null : i + 1; };
    function renderList() {
      const items = meta ? metaComments(post) : videoComments(post);
      if (!items.length) {
        list.replaceChildren(h('div', { class: 'cm-empty' }, h('b', {}, 'עוד אין הערות'),
          h('span', {}, meta ? 'מה לשנות בקאבר או בכיתוב?' : 'עוצרים ברגע הנכון וכותבים, מכתיבים או מציירים')));
        return;
      }
      list.replaceChildren(...items.map((c) => {
        const own = (c.author_kind || 'team') === 'team';
        const vn = c.version_id && post.version && c.version_id !== post.version.id ? verN(c.version_id) : null;
        const chip = meta
          ? h('span', { class: 'cm-chip' }, c.target === 'caption' ? 'כיתוב' : 'קאבר' + (c.cover_option_id && optN(c.cover_option_id) ? ' ' + optN(c.cover_option_id) : ''))
          : h('button', { type: 'button', class: 'cm-chip time', 'aria-label': 'מעבר לשנייה ' + fmt(c.at_sec), onclick: (e) => { e.stopPropagation(); seekTo(c); } }, c.at_sec != null ? fmt(c.at_sec) : '—');
        const name = c.author || (c.author_kind === 'client' ? 'לקוח' : 'צוות');
        const row = h('div', { class: 'cm' + (c.status === 'done' ? ' done' : '') + (C.editing === c ? ' editing' : ''), 'data-id': c.id },
          avatar({ name, color: c.author_kind === 'client' ? '#5851db' : null }, 32),
          h('div', { class: 'cm-main' },
            h('div', { class: 'cm-head' }, h('b', { dir: 'auto' }, name), chip,
              c.author_kind === 'client' ? h('span', { class: 'cm-tag' }, 'לקוח') : null,
              c.author_kind === 'claude' ? h('span', { class: 'cm-tag' }, 'עריכה') : null,
              c.drawing && c.drawing.strokes && c.drawing.strokes.length ? h('span', { class: 'cm-tag', html: icon('brush') + 'ציור' }) : null,
              c.status === 'done' ? h('span', { class: 'cm-tag ok' }, 'תוקן') : null,
              vn ? h('span', { class: 'cm-tag' }, 'גרסה ' + vn) : null),
            h('div', { class: 'cm-body', dir: 'auto' }, c.body)),
          own ? h('button', { type: 'button', class: 'cm-dots', 'aria-label': 'אפשרויות להערה', html: icon('more'), onclick: (e) => { e.stopPropagation(); rowMenu(c, e.currentTarget); } }) : null);
        let lp = 0, lpFired = false, sx = 0, sy = 0;
        row.addEventListener('pointerdown', (e) => {
          if (!own || e.target.closest('button')) return;
          lpFired = false; sx = e.clientX; sy = e.clientY;
          lp = setTimeout(() => { lpFired = true; vibrate(10); rowMenu(c, row, { x: sx, y: sy }); }, 480);
        });
        row.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(lp); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => row.addEventListener(ev, () => clearTimeout(lp)));
        row.addEventListener('contextmenu', (e) => { if (!own) return; e.preventDefault(); clearTimeout(lp); if (!lpFired) rowMenu(c, row, { x: e.clientX, y: e.clientY }); });
        row.addEventListener('click', () => {
          if (lpFired) { lpFired = false; return; }
          $$('.cm', list).forEach((r) => r.classList.toggle('sel', r === row));
          if (!meta) seekTo(c);
        });
        return row;
      }));
    }
    function seekTo(c) {
      if (P.card === card && c.at_sec != null) { P.el.pause(); P.el.currentTime = c.at_sec; updateProgress(); }
      if (!C.draw.on) showInk(card, c.drawing);
    }
    function rowMenu(c, anchor, at) {
      popMenu(anchor, [
        { icon: 'pencil', label: 'עריכה', fn: () => editComment(c) },
        { icon: 'trash', label: 'מחיקה', cls: 'bad', fn: () => deleteComment(c) },
      ], { at: at || (() => { const r = anchor.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 6 }; })() });
    }

    function editComment(c) {
      C.editing = c;
      ta.value = c.body === 'ציור על הפריים' && c.drawing ? '' : c.body; autosize();
      if (meta) { C.target = c.target; $$('.cm-tool', tools).forEach((b, i) => b.classList.toggle('on', (i === 0) === (c.target === 'cover'))); }
      else {
        C.draw.drawing = c.drawing && c.drawing.strokes ? JSON.parse(JSON.stringify(c.drawing)) : { v: 1, strokes: [] };
        showInk(card, C.draw.drawing);
        if (P.card === card && c.at_sec != null) { P.el.pause(); P.el.currentTime = c.at_sec; updateProgress(); }
      }
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
        if (!meta) showInk(card, null);
        renderList(); refreshPost(post);
      } catch { toast('לא נמחק, אפשר לנסות שוב'); }
    }

    const body = h('div', { class: 'cm-wrap' }, list, composer);
    const s = openSheet({
      title: 'הערות', body, cls: 'sheet-comments',
      squeeze: card,
      clearBack: true,
      onTick: meta ? null : (t) => { const r = round1(t); timeChip.textContent = fmt(r) + '.' + Math.round((r % 1) * 10) % 10; setPlaceholder(t); },
      onClose: () => {
        if (C.rec) { try { C.rec.stop(); } catch { /* ignore */ } }
        if (!meta) { C.draw.on = false; card.classList.remove('drawing'); showInk(card, null); }
        if (wasPlaying && P.card === card && !card._userPaused) play();
      },
    });
    s.draw = C.draw;
    renderList(); syncDraft();
    if (!meta) { updateProgress(); timeChip.textContent = fmt(P.el.currentTime); }
    setPlaceholder(P.el.currentTime || 0);
    if (opt.focus) setTimeout(() => ta.focus(), 350);
  }

  /* "change the text on this cover option" */
  function openCoverText(post, opt, i) {
    if (!opt) return;
    const inp = h('textarea', { class: 'ct-in', rows: '3', dir: 'rtl', placeholder: 'מה לשנות בטקסט של הקאבר?', 'aria-label': 'מה לשנות בטקסט' });
    const send = h('button', { type: 'button', class: 'blue-btn' }, 'שליחה');
    const go = async () => {
      const body = inp.value.trim(); if (!body) { inp.focus(); return; }
      send.disabled = true;
      try {
        const r = await api('/api/posts/' + post.id + '/comments', { method: 'POST', body: { target: 'cover', body, cover_option_id: opt.id } });
        const cm = normComment((r && r.comment) || { id: Date.now(), target: 'cover', body, cover_option_id: opt.id, author_kind: 'team', status: 'open' });
        if (cm.cover_option_id == null) cm.cover_option_id = opt.id;
        post.comments.push(cm);
        post.cover_state = 'changes';
        closeSheet(); refreshPost(post);
        toast('הבקשה נשמרה');
      } catch { toast('לא נשמר, אפשר לנסות שוב'); send.disabled = false; }
    };
    send.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); go(); } });
    openSheet({
      title: 'שינוי טקסט בקאבר', cls: 'sheet-ct',
      body: h('div', { class: 'ct no-drag' },
        h('div', { class: 'ct-top' }, h('img', { src: opt.url, alt: '', class: 'ct-thumb' + (post.orientation === 'horizontal' ? ' wide' : '') }),
          h('div', {}, h('b', {}, 'אפשרות ' + (i + 1)), opt.note ? h('small', { dir: 'auto' }, opt.note) : null)),
        inp, send),
    });
    setTimeout(() => inp.focus(), 350);
  }

  /* caption editor */
  function openCaptionEdit(post) {
    const ta = h('textarea', { class: 'ct-in big', dir: 'rtl', rows: '7', 'aria-label': 'הכיתוב' });
    ta.value = post.caption || '';
    const save = h('button', { type: 'button', class: 'blue-btn', onclick: () => { closeSheet(); saveCaption(post, ta.value); } }, 'שמירה ואישור');
    openSheet({ title: 'שינוי כיתוב', cls: 'sheet-ct', body: h('div', { class: 'ct no-drag' }, ta, save) });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 350);
  }

  /* ================================================================
     Share sheet (Instagram: search, avatar grid, action row)
     ================================================================ */
  async function openShare(post) {
    const own = clientOf(post);
    let sel = own, q = '', clients = [own];
    const shared = post.client_state === 'pending' || post.stage === 'client';
    const search = h('input', { type: 'search', class: 'sh-search-in', placeholder: 'חיפוש', dir: 'rtl', 'aria-label': 'חיפוש לקוח', enterkeyhint: 'search' });
    const grid = h('div', { class: 'sh-grid' });
    const foot = h('div', { class: 'sh-foot' });
    const ownUrl = () => (own.share_url ? new URL(own.share_url, location.origin).href : null);
    const copyOwn = async (msg) => {
      const url = ownUrl();
      if (!url) { toast('אין עדיין קישור ללקוח הזה'); return; }
      toast((await copyText(url)) ? msg : 'לא הצלחתי להעתיק');
    };
    const act = (ico, label, fn) => h('button', { type: 'button', class: 'sh-act', onclick: fn }, h('span', { class: 'sh-act-ic', html: icon(ico) }), h('span', {}, label));
    const acts = h('div', { class: 'sh-acts' },
      act('link', 'העתקת קישור', () => copyOwn('הקישור הועתק')),
      act('chat', 'וואטסאפ', () => copyOwn('הקישור הועתק, אפשר להדביק בוואטסאפ')),
      navigator.share ? act('sys', 'שיתוף', async () => { const url = ownUrl(); if (!url) { toast('אין עדיין קישור ללקוח הזה'); return; } try { await navigator.share({ url, title: own.name || '' }); } catch { /* cancelled */ } }) : null);

    function renderGrid() {
      const list = clients.filter((c) => !q || (c.name || '').includes(q) || (c.handle || '').toLowerCase().includes(q.toLowerCase()));
      grid.replaceChildren(...(list.length ? list.map((c) => h('button', {
        type: 'button', class: 'sh-c' + (sel && sel.id === c.id ? ' on' : ''), 'aria-pressed': String(!!(sel && sel.id === c.id)),
        onclick: () => { sel = sel && sel.id === c.id ? null : c; renderGrid(); renderFoot(); },
      }, h('span', { class: 'sh-av' }, avatar(c, 64), h('span', { class: 'sh-tick', html: icon('check') })), h('span', { class: 'sh-n', dir: 'auto' }, c.name || '')))
        : [h('p', { class: 'sh-none' }, 'לא נמצא לקוח')]));
    }
    function renderFoot() {
      if (!sel) { foot.replaceChildren(); foot.hidden = true; return; }
      foot.hidden = false;
      if (sel.id === own.id) {
        foot.replaceChildren(h('button', { type: 'button', class: 'blue-btn', onclick: () => doShare(post, own) }, shared ? 'שליחה שוב' : 'שליחה'));
      } else {
        foot.replaceChildren(h('div', { class: 'sh-confirm' },
          h('p', {}, h('b', {}, 'לשלוח ל־' + sel.name + '?'), h('span', {}, 'זה לא הלקוח של הסרטון')),
          h('div', { class: 'sh-confirm-acts' },
            h('button', { type: 'button', class: 'gray-btn', onclick: () => { sel = own; renderGrid(); renderFoot(); } }, 'ביטול'),
            h('button', { type: 'button', class: 'blue-btn', onclick: () => doShare(post, sel) }, 'כן, לשלוח'))));
      }
    }
    search.addEventListener('input', () => { q = search.value.trim(); renderGrid(); });
    openSheet({
      title: 'שליחה ללקוח', hideTitle: true, cls: 'sheet-share',
      body: h('div', { class: 'sh' },
        h('label', { class: 'sh-search no-drag' }, h('span', { html: icon('search') }), search),
        grid, foot, acts),
    });
    renderGrid(); renderFoot();
    try {
      if (!S.allClients) S.allClients = ((await api('/api/clients')).clients || []);
      S.allClients.forEach((c) => { if (!S.clients.has(c.id)) S.clients.set(c.id, c); });
      clients = [own, ...S.allClients.filter((c) => c.id !== post.client_id)];
      renderGrid();
    } catch { /* the own client is still there */ }
  }

  async function doShare(post, client) {
    closeSheet();
    try {
      const r = await api('/api/posts/' + post.id + '/share', { method: 'POST', body: client.id === post.client_id ? {} : { client_id: client.id } });
      post.client_state = 'pending'; post.stage = 'client';
      refreshPost(post);
      const url = r && r.url ? new URL(r.url, location.origin).href : null;
      toast('נשלח ל־' + client.name, url ? { action: 'העתקת קישור', fn: async () => toast((await copyText(url)) ? 'הקישור הועתק' : 'לא הצלחתי להעתיק') } : {});
    } catch { toast('לא נשלח, אפשר לנסות שוב'); }
  }

  /* ================================================================
     Music sheet
     ================================================================ */
  let previewAudio = null;
  async function openMusic(post) {
    const body = h('div', { class: 'mu' }, h('p', { class: 'sh-none' }, 'טוען…'));
    openSheet({ title: 'מוזיקה', cls: 'sheet-music', body, onClose: () => { if (previewAudio) { previewAudio.pause(); previewAudio = null; } } });
    try { if (!S.tracks) S.tracks = ((await api('/api/tracks')).tracks || []); }
    catch { body.replaceChildren(h('p', { class: 'sh-none' }, 'רשימת השירים לא נטענה')); return; }
    const cur = post.music;
    const isCur = (t) => cur && ((cur.track_id != null && cur.track_id === t.id) || (cur.track_id == null && cur.title === t.title && cur.source === t.source));
    const row = (t) => {
      const b = h('div', { class: 'mu-row' + (isCur(t) ? ' cur' : '') });
      const thumb = h('span', { class: 'mu-thumb', html: icon('note') });
      if (t.url) {
        const pb = h('button', { type: 'button', class: 'mu-thumb', 'aria-label': 'השמעה', html: icon('play') });
        pb.addEventListener('click', (e) => {
          e.stopPropagation();
          if (previewAudio && previewAudio._t === t) { previewAudio.pause(); previewAudio = null; pb.innerHTML = icon('play'); return; }
          if (previewAudio) previewAudio.pause();
          $$('button.mu-thumb', body).forEach((x) => { x.innerHTML = icon('play'); });
          previewAudio = new Audio(t.url); previewAudio._t = t; P.el.pause();
          previewAudio.play().then(() => { pb.innerHTML = icon('pause'); }).catch(() => toast('השיר לא מתנגן'));
          previewAudio.onended = () => { pb.innerHTML = icon('play'); };
        });
        b.append(pb);
      } else b.append(thumb);
      b.append(h('button', { type: 'button', class: 'mu-pick', onclick: () => pickTrack(post, t) },
        h('span', { class: 'mu-t' }, h('b', { dir: 'auto' }, t.title), t.artist ? h('small', { dir: 'auto' }, t.artist) : null),
        isCur(t) ? h('span', { class: 'mu-check', html: icon('check') }) : null));
      return b;
    };
    const lib = S.tracks.filter((t) => t.source !== 'instagram');
    const ig = S.tracks.filter((t) => t.source === 'instagram');
    const addIn = h('input', { type: 'text', placeholder: 'שם השיר באינסטגרם', dir: 'rtl', enterkeyhint: 'done', 'aria-label': 'שם שיר מאינסטגרם' });
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
      h('div', { class: 'mu-row' + (!cur ? ' cur' : '') }, h('span', { class: 'mu-thumb av-thumb' }, avatar(clientOf(post), 44)),
        h('button', { type: 'button', class: 'mu-pick', onclick: () => pickTrack(post, null) },
          h('span', { class: 'mu-t' }, h('b', {}, 'סאונד מקורי'), h('small', {}, 'בלי מוזיקה נוספת')), !cur ? h('span', { class: 'mu-check', html: icon('check') }) : null)),
      h('div', { class: 'sec-l' }, 'השירים שלך'),
      lib.length ? h('div', { class: 'mu-list' }, lib.map(row)) : h('p', { class: 'sh-none' }, 'עוד אין שירים בספרייה'),
      h('div', { class: 'sec-l' }, 'מספריית אינסטגרם'),
      h('p', { class: 'sec-hint' }, 'שם בלבד. את השיר בוחרים באפליקציה בזמן ההעלאה'),
      ig.length ? h('div', { class: 'mu-list' }, ig.map(row)) : null,
      h('div', { class: 'mu-add no-drag' }, addIn, h('button', { type: 'button', class: 'blue-btn small', onclick: add }, 'הוספה'))));
  }

  async function pickTrack(post, t) {
    const prev = post.music;
    const music = t ? { title: t.title, artist: t.artist || null, source: t.source || 'library', track_id: t.id ?? null } : null;
    post.music = music; closeSheet(); refreshPost(post);
    try {
      const r = await api('/api/posts/' + post.id, { method: 'PATCH', body: { music } });
      if (r && r.post) { mergePost(post, r.post); refreshPost(post); }
      toast(music ? 'נבחר: ' + music.title : 'סאונד מקורי');
    } catch { post.music = prev; refreshPost(post); toast('לא נשמר, אפשר לנסות שוב'); }
  }

  /* ================================================================
     "…" sheet
     ================================================================ */
  function openMore(post, part) {
    const cur = post[part + '_state'];
    const round = (ico, label, cls, on, fn) => h('button', { type: 'button', class: 'mo-round ' + cls + (on ? ' on' : ''), 'aria-pressed': String(!!on), onclick: () => { closeSheet(); fn(); } },
      h('span', { class: 'mo-round-ic', html: icon(ico) }), h('span', {}, label));
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'מהירות' }, SPEEDS.map((x) => h('button', {
      type: 'button', role: 'radio', dir: 'ltr', 'aria-checked': String(S.speed === x), class: S.speed === x ? 'on' : '',
      onclick: (e) => { setSpeed(x); $$('button', seg).forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); },
    }, x + 'x')));
    const row = (ico, label, fn, extra) => h(fn ? 'button' : 'div', K({ type: fn ? 'button' : null, class: 'mo-row', onclick: fn ? () => { closeSheet(); fn(); } : null })[0],
      h('span', { class: 'mo-ic', html: icon(ico) }), h('span', { class: 'grow' }, label), extra || null);
    const capSt = post.caption_state;
    openSheet({
      title: 'עוד', hideTitle: true, cls: 'sheet-more',
      body: h('div', { class: 'mo' },
        h('div', { class: 'mo-rounds' },
          round('approve', part === 'cover' ? 'אישור קאבר' : 'מאושר', 'ok', cur === 'approved', () => approvePart(post, part)),
          round('x', 'לא מאושר', 'bad', cur === 'changes', () => rejectPart(post, part, false)),
          round('pencil', 'לתקן', '', false, () => rejectPart(post, part, true))),
        h('div', { class: 'mo-group' },
          part === 'cover' ? row('caption', capSt === 'approved' ? 'הכיתוב מאושר' : 'אישור הכיתוב', capSt === 'approved' ? null : () => approvePart(post, 'caption'), capSt === 'approved' ? h('span', { class: 'mo-ok', html: icon('check') }) : null) : null,
          part === 'cover' ? row('x', 'הכיתוב לא מאושר', () => rejectPart(post, 'caption', true)) : null,
          row('pencil', 'שינוי כיתוב', () => openCaptionEdit(post)),
          cur !== 'pending' ? row('undo', 'החזרה להמתנה', () => setState(post, part, 'pending')) : null),
        h('div', { class: 'mo-group' },
          row('clean', 'מסך נקי', () => setClean(true)),
          row('side', railSide() === 'left' ? 'הכפתורים בצד ימין' : 'הכפתורים בצד שמאל', () => { const n = railSide() === 'left' ? 'right' : 'left'; store.set('railSide', n); setRail(n); }),
          row('speed', 'מהירות קבועה', null, seg),
          row(P.el.muted ? 'vol' : 'mute', P.el.muted ? 'הפעלת שמע' : 'השתקה', () => setMuted(!P.el.muted))),
        isTouch ? null : h('p', { class: 'sec-hint center' }, 'במקלדת: חיצים למעבר, רווח לעצירה, M לשמע')),
    });
  }

  /* client switcher (from the title or the avatar chip) */
  function openClients() {
    if (!S.groups.length) return;
    const cur = S.active && S.active._fy.post && S.active._fy.post.client_id;
    openSheet({
      title: 'לקוחות', cls: 'sheet-clients',
      body: h('div', { class: 'cl' }, S.groups.map((g) => {
        const n = g.posts.filter(isPending).length;
        return h('button', { type: 'button', class: 'cl-row' + (g.client.id === cur ? ' cur' : ''), onclick: () => {
          closeSheet(); const c = S.cards.find((x) => x._fy.group === g); if (c) scrollToCard(c);
        } }, avatar(g.client, 44), h('span', { class: 'grow' }, h('b', { dir: 'auto' }, g.client.name), h('small', {}, n ? n + ' לאישור' : 'הכול מאושר')),
        g.client.id === cur ? h('span', { class: 'mu-check', html: icon('check') }) : null);
      })),
    });
  }
  $('#titleBtn').addEventListener('click', openClients);
  $('#clientChip').addEventListener('click', openClients);
  $('#soundBtn').addEventListener('click', () => setMuted(!P.el.muted));

  function setClean(on) {
    S.clean = on;
    document.body.classList.toggle('clean', on);
    if (on) toast('מסך נקי · הקשה מחזירה הכול', { ms: 1800 });
  }

  /* ================================================================
     Keyboard (desktop)
     ================================================================ */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') { if (S.pop) closePop(); else if (S.modal) S.modal.close(); else if (S.sheet) closeSheet(); else if (S.clean) setClean(false); return; }
    if (S.modal || S.pop) return;
    const k = e.key;
    if (S.sheet) {
      if (k === ' ' && P.card && !e.target.closest('button')) { e.preventDefault(); togglePause(P.card); }
      return;
    }
    if (e.target.closest && e.target.closest('.co-track') && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
    if (k === 'ArrowDown' || k === 'PageDown' || k === 'j') { e.preventDefault(); step(1); }
    else if (k === 'ArrowUp' || k === 'PageUp' || k === 'k') { e.preventDefault(); step(-1); }
    else if (k === ' ') { if (P.card && !(e.target.closest && e.target.closest('button, a'))) { e.preventDefault(); togglePause(P.card); } }
    else if (k === 'm' || k === 'M') setMuted(!P.el.muted);
    else if (k === 'ArrowRight' && P.card) { e.preventDefault(); P.el.currentTime = Math.min((P.el.currentTime || 0) + 5, duration(P.post)); }
    else if (k === 'ArrowLeft' && P.card) { e.preventDefault(); P.el.currentTime = Math.max((P.el.currentTime || 0) - 5, 0); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) P.el.pause();
    else if (P.card && !S.sheet && !P.card._userPaused) play();
  });
  feed.addEventListener('wheel', (e) => { if (S.sheet && !isDesk()) e.preventDefault(); }, { passive: false });

  /* ================================================================
     Boot
     ================================================================ */
  async function boot() {
    P.el = makeVideo();
    syncMute(); setSpeed(S.speed); syncLand();
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
      feed.replaceChildren(h('section', { class: 'card card-end' }, h('div', { class: 'end-in' },
        h('h2', {}, 'לא הצלחתי לטעון'), h('p', {}, 'בדקי את החיבור ונסי שוב'),
        h('button', { type: 'button', class: 'pill-btn solid', onclick: () => location.reload() }, 'לנסות שוב'))));
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
    const base = qs.get('mockmedia') || '/demo/';
    const ver = (id, n, file, thumb, w, hh, dur, note) => ({ id, n, bunny_guid: 'g' + id, duration: dur, width: w, height: hh, note,
      mp4: [base + 'missing-720.mp4', base + file], hls: null, thumb: base + thumb, embed: null });
    const clients = [
      { id: 'noa', name: 'נועה קוסמטיקה', handle: '@noa.cosmetics', avatar: null, color: '#c9a46a', share_url: '/c/tok-noa' },
      { id: 'lev', name: 'לב בייקרי', handle: '@lev.bakery', avatar: null, color: '#4f7a5a', share_url: '/c/tok-lev' },
      { id: 'dan', name: 'דן נדל״ן', handle: '@dan.realestate', avatar: null, color: '#9c8b7a', share_url: '/c/tok-dan' },
    ];
    let optId = 0;
    const opts = (...files) => files.map((f, i) => ({ id: ++optId, url: base + f, note: ['כותרת גדולה למטה', 'כותרת בתיבה לבנה', 'פריים נקי בלי טקסט'][i], chosen: false }));
    const post = (id, client_id, title, v, extra = {}) => ({
      id, client_id, client_name: clients.find((c) => c.id === client_id).name, title, kind: 'reel', orientation: 'vertical', stage: 'review',
      video_state: 'pending', caption: 'שלוש טעויות שכולן עושות עם קרם לחות ☀️\nשמרי את הסרטון לפעם הבאה\n#טיפוח #עור', caption_state: 'pending',
      cover_url: v.thumb, cover_state: 'pending', music: null, scheduled_at: null, client_state: 'none', created_at: '2026-11-24 09:00', updated_at: '2026-11-24 09:00',
      version: v, versions: [{ id: v.id, n: v.n, created_at: '2026-11-24', note: v.note }], comments: [], cover_options: [], ...extra,
    });
    const posts = [
      post(1, 'noa', 'קרם לחות · 3 טעויות', ver(11, 2, 'demo-1.mp4', 'demo-1.jpg', 720, 1280, 9, 'קיצרתי את הפתיחה'), {
        versions: [{ id: 10, n: 1, created_at: '2026-11-23' }, { id: 11, n: 2, created_at: '2026-11-24', note: 'קיצרתי את הפתיחה' }],
        cover_options: opts('demo-1.jpg', 'demo-2.jpg', 'demo-3.jpg'),
        comments: [
          { id: 101, post_id: 1, version_id: 10, target: 'video', at_sec: 2.4, body: 'הכותרת נכנסת מאוחר מדי', drawing: null, author: 'Owner', author_kind: 'team', status: 'done', created_at: '' },
          { id: 102, post_id: 1, version_id: 11, target: 'video', at_sec: 6, body: 'הלוגו מסתיר את הפנים כאן', drawing: JSON.stringify({ v: 1, strokes: [{ c: '#ff3040', w: 0.01, p: [[0.3, 0.4], [0.5, 0.35], [0.7, 0.45], [0.5, 0.55], [0.3, 0.4]] }] }), author: 'Owner', author_kind: 'team', status: 'open', created_at: '' },
        ] }),
      post(2, 'noa', 'לפני ואחרי · סרום', ver(21, 1, 'demo-2.mp4', 'demo-2.jpg', 720, 1280, 11), { caption: '', music: JSON.stringify({ title: 'Golden Hour', artist: 'JVKE', source: 'instagram', track_id: 3 }), cover_options: opts('demo-2.jpg', 'demo-3.jpg') }),
      post(3, 'lev', 'מאחורי הקלעים במאפייה', ver(31, 1, 'demo-3.mp4', 'demo-3.jpg', 720, 1280, 8), { caption: 'ככה נראה הבוקר שלנו ב־5:00 🥐', video_state: 'approved' }),
      post(4, 'lev', 'סדנת שאור · פרק מלא', ver(41, 1, 'demo-4.mp4', 'demo-4.jpg', 1280, 720, 14), { orientation: 'horizontal', kind: 'long', caption: 'כל מה שצריך לדעת על שאור, מההתחלה', cover_options: opts('demo-4.jpg', 'demo-1.jpg', 'demo-2.jpg'), comments: [
        { id: 401, post_id: 4, version_id: 41, target: 'video', at_sec: 4, body: 'לחתוך את ההשתהות כאן', drawing: null, author: 'Owner', author_kind: 'team', status: 'open' },
        { id: 402, post_id: 4, version_id: 41, target: 'video', at_sec: 9.5, body: 'אפשר מוזיקה שקטה יותר?', drawing: null, author: 'דנה', author_kind: 'client', status: 'open' }] }),
      post(5, 'dan', 'דירת 4 חדרים · סיור', ver(51, 1, 'demo-1.mp4', 'demo-1.jpg', 720, 1280, 9), { cover_url: null }),
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
    const settle = (post) => {
      if (PARTS.every((k) => post[k + '_state'] === 'approved')) post.stage = 'approved';
      if (PARTS.some((k) => post[k + '_state'] === 'changes')) post.stage = 'editing';
    };
    let m;
    if (p === '/api/session') return { brand: { name: 'סוכנות בדיקה' }, setup_needed: false, user: qs.get('nouser') ? null : { id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner' } };
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
      settle(post);
      return { post: clone(post) };
    }
    if ((m = p.match(/^\/api\/posts\/(\d+)\/cover\/choose$/))) {
      const post = M.posts.find((x) => x.id === +m[1]);
      const o = post.cover_options.find((x) => x.id === +b.option_id); if (!o) throw new Error('not_found');
      post.cover_options.forEach((x) => { x.chosen = x === o; });
      post.cover_url = o.url; post.cover_state = 'approved'; settle(post);
      return { post: clone(post) };
    }
    if ((m = p.match(/^\/api\/posts\/(\d+)\/comments$/))) {
      const post = M.posts.find((x) => x.id === +m[1]);
      const c = { id: ++M.nextId, post_id: post.id, version_id: post.version && post.version.id, target: b.target || 'video', at_sec: b.at_sec ?? null, body: b.body, drawing: b.drawing || null, author: 'Owner', author_kind: 'team', status: 'open', cover_option_id: b.cover_option_id || null, created_at: new Date().toISOString() };
      if (c.target === 'cover') { post.cover_state = 'changes'; settle(post); }
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
