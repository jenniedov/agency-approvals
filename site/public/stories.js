/* Stories: posts with kind = 'story' are approved in a screen built like Instagram Stories.
   Opened by foryou.js (story rings at the top of For You, or /foryou?stories=<client>).
   Tap right = next, tap left = previous, hold = pause. Approve sits where Instagram has the heart;
   the reply box saves a comment at the current second and marks the video as needing changes.
   Same API calls as For You (docs/API.md): POST /api/posts/<id>/state, POST /api/posts/<id>/comments. */
(() => {
  'use strict';

  const RING = 'M12 2.6a9.4 9.4 0 1 1 0 18.8a9.4 9.4 0 1 1 0-18.8z';
  const ICON = {
    approve: `<path class="hf" d="${RING}"/><path class="hc" d="M7.7 12.2l2.9 2.9 5.7-5.8"/>`,
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    vol: '<path d="M3.5 9.3h3.8L12 5.2v13.6l-4.7-4.1H3.5z" fill="currentColor"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.2 6.2a8.2 8.2 0 0 1 0 11.6"/>',
    mute: '<path d="M3.5 9.3h3.8L12 5.2v13.6l-4.7-4.1H3.5z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    play: '<path d="M8 4.6v14.8L20 12z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" stroke="none"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5"/>',
    note: '<path d="M20.7 16.9A9.6 9.6 0 1 0 17 20.6L21.8 22z"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
  const $ = (s, r) => r.querySelector(s);
  function h(tag, a, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(3)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const round1 = (n) => Math.round((n || 0) * 10) / 10;
  const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* no-op */ } };
  const plural = (n, one, many) => (n === 1 ? one : n + ' ' + many);

  let V = null; // the open viewer

  function avatar(c, size) {
    const el = h('span', { class: 'av', 'aria-hidden': 'true' });
    el.style.width = el.style.height = size + 'px';
    el.style.fontSize = Math.round(size * 0.42) + 'px';
    if (c && c.avatar) el.append(h('img', { src: c.avatar, alt: '' }));
    else { el.textContent = ((c && c.name) || '?').trim().charAt(0); if (c && c.color) el.style.background = c.color; }
    return el;
  }

  /* opts: {sets: [{client, posts}], client?, post?, api, video?, muted, gesture, onClose(summary), onMute(m), readonly?}
     readonly: the public share page (share.js): no approve/comment bar, no Aa editor, no moving stickers, no scrubber, no close */
  function open(opts) {
    if (V) close();
    const list = [];
    opts.sets.forEach((set) => set.posts.forEach((post) => list.push({ set, post })));
    if (!list.length) return false;
    let i = 0;
    if (opts.post != null) i = Math.max(0, list.findIndex((x) => String(x.post.id) === String(opts.post)));
    else if (opts.client != null) {
      const inSet = list.map((x, n) => [x, n]).filter(([x]) => String(x.set.client.id) === String(opts.client));
      const firstOpen = inSet.find(([x]) => x.post.video_state === 'pending') || inSet.find(([x]) => x.post.video_state !== 'approved') || inSet[0];
      if (firstOpen) i = firstOpen[1];
    } else {
      const firstOpen = list.findIndex((x) => x.post.video_state === 'pending');
      if (firstOpen >= 0) i = firstOpen;
    }

    const vid = opts.video || document.createElement('video');
    list.forEach((x) => { if (!Array.isArray(x.post.texts)) x.post.texts = []; });
    const RO = !!opts.readonly;
    const root = h('div', { class: 'st' + (RO ? ' st-ro' : ''), dir: 'ltr', role: 'dialog', 'aria-modal': 'true', 'aria-label': RO ? 'סטוריז' : 'סטוריז לאישור' });
    const frame = h('div', { class: 'st-frame' });
    const media = h('div', { class: 'st-media' });
    const poster = h('img', { class: 'st-poster', alt: '' });
    const tap = h('div', { class: 'st-tap', 'aria-hidden': 'true' });
    const bars = h('div', { class: 'st-bars' });
    const head = h('div', { class: 'st-head', dir: 'ltr' }, bars, h('div', { class: 'st-row' }));
    const center = h('div', { class: 'st-center', 'aria-hidden': 'true' });
    const texts = h('div', { class: 'st-texts' });
    const trash = h('div', { class: 'st-trash', 'aria-hidden': 'true', html: icon('trash') });
    const scrubT = h('span', { class: 'st-scrub-t' }, '0:00');
    const range = h('input', { type: 'range', class: 'st-range', min: '0', max: '1', step: '0.05', value: '0', 'aria-label': 'בחירת השנייה להערה' });
    const scrub = h('div', { class: 'st-scrub', dir: 'ltr', hidden: true }, range, scrubT);
    const verr = h('div', { class: 'st-err' });
    const input = h('input', { class: 'st-input', type: 'text', dir: 'rtl', placeholder: 'הערה...', 'aria-label': 'הערה לסטורי, נשמרת בשנייה הנוכחית', enterkeyhint: 'send', autocomplete: 'off' });
    const approveBtn = h('button', { type: 'button', class: 'st-approve', 'aria-label': 'אישור הסטורי', html: icon('approve') });
    const sendBtn = h('button', { type: 'submit', class: 'st-send' }, 'שליחה');
    const bar = h('form', { class: 'st-bar', dir: 'ltr', novalidate: true }, input, approveBtn, sendBtn);
    const toastEl = h('div', { class: 'st-toast', role: 'status', 'aria-live': 'polite' });
    const end = h('div', { class: 'st-end', hidden: true });
    const navPrev = h('button', { type: 'button', class: 'st-nav prev', 'aria-label': 'הסטורי הקודם', html: icon('prev') });
    const navNext = h('button', { type: 'button', class: 'st-nav next', 'aria-label': 'הסטורי הבא', html: icon('next') });

    vid.className = 'st-vid';
    vid.loop = false;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    vid.preload = 'auto';
    vid.muted = !!opts.muted || !opts.gesture;
    const sbox = h('div', { 'aria-hidden': 'true', style: 'position:absolute;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none' });
    media.append(sbox, poster, vid, h('div', { class: 'st-shade' }), tap, texts, head, center, verr, trash);
    if (RO) frame.append(media, end, toastEl); else frame.append(media, scrub, bar, end, toastEl);
    root.append(frame, navPrev, navNext);
    document.body.append(root);
    document.body.classList.add('st-open');

    V = { sbox, opts, list, i, root, frame, media, texts, trash, scrub, range, scrubT, vid, poster, tap, bars, head, center, verr, input, approveBtn, sendBtn, bar, toastEl, end,
      pool: new Map(), imgs: new Set(), raf: 0, held: false, typing: false, editing: false, scrubbing: false, ro: null, lastStyle: 'white-box', saveT: {}, userPaused: false, ended: false, srcIdx: 0, srcs: [], approvedNow: new Set(), notedNow: new Set(), onKey: null, onVid: {} };

    /* video events (bound to whichever element is current: a preloaded one can be swapped in) */
    V.bindVid = (v) => {
      const on = (ev, fn) => { v.addEventListener(ev, fn); V.onVid[ev] = fn; };
      on('ended', () => { if (V && !V.ended && V.vid === v) next(); });
      on('playing', () => { root.classList.remove('buffering'); verr.replaceChildren(); });
      on('waiting', () => root.classList.add('buffering'));
      on('loadeddata', () => { root.classList.add('ready'); root.classList.remove('buffering'); });
      on('error', () => {
        if (!V || !v.error || V.vid !== v) return;
        V.srcIdx++;
        if (V.srcIdx < V.srcs.length) { v.src = V.srcs[V.srcIdx]; play(); return; }
        root.classList.remove('buffering');
        verr.replaceChildren(h('span', {}, 'הסרטון לא נטען'), h('button', { type: 'button', class: 'st-pill', onclick: (e) => { e.stopPropagation(); show(V.i); } }, 'לנסות שוב'));
      });
    };
    V.unbindVid = (v) => { for (const [ev, fn] of Object.entries(V.onVid)) v.removeEventListener(ev, fn); V.onVid = {}; };
    V.bindVid(vid);

    const setU = () => media.style.setProperty('--u', (media.clientWidth / 1080) + 'px');
    setU();
    if (window.ResizeObserver) { V.ro = new ResizeObserver(setU); V.ro.observe(media); }
    bindTap();
    range.addEventListener('input', () => { V.vid.currentTime = +range.value; paintScrub(); });
    const scrubOn = () => { V.scrubbing = true; };
    const scrubOff = () => setTimeout(() => { if (V) V.scrubbing = false; }, 400);
    range.addEventListener('pointerdown', scrubOn); range.addEventListener('touchstart', scrubOn, { passive: true });
    range.addEventListener('pointerup', scrubOff); range.addEventListener('pointercancel', scrubOff); range.addEventListener('touchend', scrubOff);
    bar.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    approveBtn.addEventListener('click', () => approve());
    input.addEventListener('focus', () => enterComment());
    input.addEventListener('blur', () => { setTimeout(() => { if (!V || V.scrubbing) return; if (!input.value.trim() && document.activeElement !== input) exitComment(); }, 160); });
    input.addEventListener('input', () => root.classList.toggle('has-text', !!input.value.trim()));
    navPrev.addEventListener('click', () => prev());
    navNext.addEventListener('click', () => next());
    V.onKey = (e) => {
      if (!V || document.querySelector('.fy-modal')) return; // a confirm box on top handles its own keys
      if (RO) { if (e.key === 'ArrowRight') { e.preventDefault(); next(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); } else if (e.key === ' ') { e.preventDefault(); togglePause(); } else if (e.key === 'm' || e.key === 'M') setMuted(!V.vid.muted); return; }
      if (V.editing) { if (e.key === 'Escape') { e.preventDefault(); V.finishEditor && V.finishEditor(); } return; }
      if (e.target === input) { if (e.key === 'Escape') { input.value = ''; root.classList.remove('has-text'); input.blur(); exitComment(); } return; }
      if (e.target && e.target.type === 'range') return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (V.opts.onEscape) V.opts.onEscape(); else close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); togglePause(); }
      else if (e.key === 'm' || e.key === 'M') setMuted(!V.vid.muted);
    };
    document.addEventListener('keydown', V.onKey, true);
    V.onVis = () => { if (!V) return; if (document.hidden) V.vid.pause(); else resume(); };
    document.addEventListener('visibilitychange', V.onVis);

    show(i);
    if (vid.muted && !opts.muted) toast('אפשר להפעיל שמע מהכפתור למעלה');
    return true;
  }

  const cur = () => V.list[V.i];

  function show(i) {
    V.i = i; V.ended = false; V.userPaused = false;
    V.end.hidden = true; V.root.classList.remove('at-end', 'ready');
    V.root.classList.add('buffering');
    V.verr.replaceChildren(); V.center.replaceChildren();
    V.root.classList.remove('user-paused');
    renderTexts();
    const { post } = cur();
    const ver = post.version || {};
    V.srcs = (Array.isArray(ver.mp4) ? ver.mp4 : []).filter(Boolean);
    if (ver.hls && V.vid.canPlayType('application/vnd.apple.mpegurl')) V.srcs.push(ver.hls);
    V.srcIdx = 0;
    const thumb = ver.thumb || post.cover_url;
    if (thumb) { V.poster.src = thumb; V.poster.hidden = false; } else { V.poster.removeAttribute('src'); V.poster.hidden = true; }
    paintHead(); paintState();
    if (!V.srcs.length) {
      V.root.classList.remove('buffering');
      V.verr.replaceChildren(h('span', {}, 'אין עדיין קובץ וידאו'));
      V.vid.removeAttribute('src');
    } else {
      const sp = V.pool.get(V.srcs[0]);
      if (sp) { V.pool.delete(V.srcs[0]); adopt(sp); }
      if (V.vid.getAttribute('src') === V.srcs[0]) {
        const warm = V.vid.readyState >= 2;
        if (V.vid.currentTime > 0.05) { try { V.vid.currentTime = 0; } catch { /* ignore */ } }
        if (warm) { V.root.classList.add('ready'); V.root.classList.remove('buffering'); }
      } else { V.vid.src = V.srcs[0]; V.vid.currentTime = 0; }
      play();
    }
    startRaf();
    preloadSoon();
  }

  /* ---- preloading: the next and the previous story wait in hidden, muted, playsinline <video> elements ---- */
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function mkVid() {
    const v = document.createElement('video');
    v.className = 'st-vid'; v.loop = false; v.playsInline = true; v.muted = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    return v;
  }
  function adopt(nv) { // swap the playing element for a preloaded one
    const old = V.vid;
    V.unbindVid(old);
    nv.muted = old.muted; nv.className = 'st-vid';
    old.pause();
    old.replaceWith(nv);
    if (old !== V.opts.video) { old.removeAttribute('src'); try { old.load(); } catch { /* ignore */ } } else { old.removeAttribute('src'); try { old.load(); } catch { /* ignore */ } }
    V.vid = nv;
    V.bindVid(nv);
  }
  function warmImg(u) { if (!u || V.imgs.has(u)) return; V.imgs.add(u); const i = new Image(); i.decoding = 'async'; i.src = u; }
  function preloadNow() {
    if (!V) return;
    const want = [V.i + 1, V.i - 1, V.i + 2].filter((n) => n >= 0 && n < V.list.length);
    const keep = new Set();
    want.forEach((n, k) => {
      const { set, post } = V.list[n];
      const ver = post.version || {};
      warmImg(ver.thumb || post.cover_url); warmImg(set.client && set.client.avatar);
      const src = (Array.isArray(ver.mp4) ? ver.mp4 : []).filter(Boolean)[0];
      if (!src || k > 1) return; // two videos (next, previous); the one after only gets its poster
      keep.add(src);
      if (V.pool.has(src)) return;
      const v = mkVid(); v.src = src;
      V.pool.set(src, v);
      V.sbox.append(v);
      try { v.load(); } catch { /* ignore */ }
      if (IOS) v.addEventListener('loadeddata', () => { if (!V || V.pool.get(src) !== v || v.readyState >= 4) return; v.play().then(() => { if (V && V.pool.get(src) === v) { v.pause(); try { v.currentTime = 0; } catch { /* ignore */ } } }).catch(() => {}); }, { once: true });
    });
    for (const [src, v] of [...V.pool]) if (!keep.has(src)) { V.pool.delete(src); v.removeAttribute('src'); try { v.load(); } catch { /* ignore */ } v.remove(); }
  }
  function preloadSoon() { // after the current video can play, so the two never fight for bandwidth
    const v = V.vid, at = V.i;
    const run = () => { if (V && V.i === at) preloadNow(); };
    if (v.readyState >= 3) run(); else { v.addEventListener('canplay', run, { once: true }); setTimeout(run, 4000); }
  }

  function paintHead() {
    const { set, post } = cur();
    const inSet = set.posts;
    const k = inSet.indexOf(post);
    V.bars.replaceChildren(...inSet.map((p, n) => h('i', { class: n < k ? 'done' : '' }, h('b', {}))));
    const muted = V.vid.muted;
    const paused = V.userPaused;
    $('.st-row', V.head).replaceChildren(...[
      avatar(set.client, 32),
      h('span', { class: 'st-who' },
        h('b', { class: 'st-name', dir: 'auto' }, set.client.name || ''),
        h('span', { class: 'st-title', dir: 'auto' }, post.title || '')),
      h('span', { class: 'st-badge' }),
      h('span', { class: 'st-grow' }),
      V.opts.readonly ? null : h('button', { type: 'button', class: 'st-ib st-aa', 'aria-label': 'הוספת טקסט', onclick: () => openEditor(null) }, 'Aa'),
      h('button', { type: 'button', class: 'st-ib st-pp', 'aria-label': paused ? 'המשך' : 'עצירה', html: icon(paused ? 'play' : 'pause'), onclick: () => togglePause() }),
      h('button', { type: 'button', class: 'st-ib st-mute', 'aria-label': muted ? 'הפעלת שמע' : 'השתקה', html: icon(muted ? 'mute' : 'vol'), onclick: () => setMuted(!V.vid.muted) }),
      V.opts.readonly || !V.opts.onDelete ? null : h('button', { type: 'button', class: 'st-ib st-del', 'aria-label': 'מחיקת הסטורי', html: icon('trash'), onclick: () => askDelete() }),
      V.opts.readonly ? null : h('button', { type: 'button', class: 'st-ib st-x', 'aria-label': 'סגירה', html: icon('x'), onclick: () => close() })].filter(Boolean));
    V.root.querySelector('.st-nav.prev').disabled = V.i === 0;
  }

  function paintState() {
    if (V.opts.readonly) return;
    const { post } = cur();
    const st = post.video_state;
    V.approveBtn.classList.toggle('on', st === 'approved');
    V.approveBtn.setAttribute('aria-pressed', String(st === 'approved'));
    V.approveBtn.setAttribute('aria-label', st === 'approved' ? 'מאושר. לחיצה מבטלת את האישור' : 'אישור הסטורי');
    const badge = $('.st-badge', V.head);
    if (!badge) return;
    const notes = (post.comments || []).filter((c) => c.target === 'video' && c.status !== 'done' && (!post.version || c.version_id == null || c.version_id === post.version.id)).length;
    badge.className = 'st-badge' + (st === 'approved' ? ' ok' : st === 'changes' ? ' warn' : '');
    badge.replaceChildren(...(st === 'approved' ? [h('span', { html: icon('check') }), 'מאושר']
      : st === 'changes' ? [h('span', { html: icon('note') }), notes > 1 ? notes + ' הערות' : 'הערה'] : []));
  }

  /* progress bars */
  function startRaf() {
    cancelAnimationFrame(V.raf);
    const tick = () => {
      if (!V) return;
      const b = V.bars.children[cur().set.posts.indexOf(cur().post)];
      const d = V.vid.duration || (cur().post.version && cur().post.version.duration) || 0;
      const f = d ? Math.min(1, (V.vid.currentTime || 0) / d) : 0;
      if (b) b.firstChild.style.transform = 'scaleX(' + f + ')';
      V.raf = requestAnimationFrame(tick);
    };
    V.raf = requestAnimationFrame(tick);
  }

  async function play() {
    if (!V || V.held || V.typing || V.editing || V.userPaused || V.ended || !V.vid.getAttribute('src')) return;
    try { await V.vid.play(); }
    catch (e) {
      if (e && e.name === 'NotAllowedError' && !V.vid.muted) {
        V.vid.muted = true; paintHead();
        try { await V.vid.play(); } catch { /* waits for a tap */ }
      }
    }
  }
  function pause() { if (V) V.vid.pause(); }
  function resume() { if (V && !V.held && !V.typing && !V.editing && !V.userPaused && !V.ended && V.end.hidden) play(); }
  // pause while the confirm box is up; play on if she cancels (on delete the page reloads)
  async function askDelete() {
    const wasPaused = V.userPaused;
    if (!wasPaused) togglePause();
    const gone = await V.opts.onDelete(cur());
    if (!gone && V && !wasPaused && V.userPaused) togglePause();
  }

  function togglePause() {
    V.userPaused = !V.userPaused;
    if (V.userPaused) pause(); else play();
    V.root.classList.toggle('user-paused', V.userPaused);
    if (V.userPaused) V.center.replaceChildren(h('div', { class: 'st-pind', html: icon('pause') }));
    else { const b = h('div', { class: 'st-pind out', html: icon('play') }); V.center.replaceChildren(b); setTimeout(() => b.remove(), 600); }
    paintHead(); paintState();
  }
  function setMuted(m) {
    V.vid.muted = m;
    if (V.opts.onMute) V.opts.onMute(m);
    if (!m && V.vid.paused) resume();
    paintHead(); paintState();
  }

  function next() {
    if (!V) return;
    if (V.input.value.trim()) { V.input.focus(); return; }
    if (V.i < V.list.length - 1) show(V.i + 1);
    else showEnd();
  }
  function prev() {
    if (!V) return;
    if (!V.end.hidden) { show(V.list.length - 1); return; }
    if (V.i === 0) { V.vid.currentTime = 0; resume(); return; }
    show(V.i - 1);
  }

  /* tap left / right, hold to pause, swipe down to close */
  function bindTap() {
    let t0 = 0, x0 = 0, y0 = 0, holdT = 0, id = null;
    const tap = V.tap;
    tap.addEventListener('contextmenu', (e) => e.preventDefault());
    tap.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      id = e.pointerId; t0 = performance.now(); x0 = e.clientX; y0 = e.clientY;
      try { tap.setPointerCapture(id); } catch { /* old Safari */ }
      clearTimeout(holdT);
      holdT = setTimeout(() => { V.held = true; pause(); V.root.classList.add('holding'); }, 220);
    });
    const up = (e, cancel) => {
      if (e.pointerId !== id) return;
      id = null; clearTimeout(holdT);
      const dy = e.clientY - y0, dx = e.clientX - x0;
      const swipe = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3;
      if (V.held) {
        V.held = false; V.root.classList.remove('holding');
        if (!cancel && dy > 110 && !V.opts.readonly) { close(); return; }
        if (!cancel && swipe) { dx < 0 ? next() : prev(); return; }
        resume(); return;
      }
      if (cancel) return;
      if (dy > 110 && Math.abs(dy) > Math.abs(dx) && !V.opts.readonly) { close(); return; }
      if (swipe) { dx < 0 ? next() : prev(); return; } // swipe left = next, like Instagram
      if (performance.now() - t0 > 500 || Math.abs(dx) > 14 || Math.abs(dy) > 14) return;
      if (document.activeElement === V.input) { V.input.blur(); return; }
      if (V.typing) { if (!V.input.value.trim()) exitComment(); return; }
      const r = tap.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
      if (fx < 1 / 3) prev(); else if (fx > 2 / 3) next(); else togglePause();
    };
    tap.addEventListener('pointerup', (e) => up(e, false));
    tap.addEventListener('pointercancel', (e) => up(e, true));
  }

  /* approve: same call as the For You check ring */
  async function approve() {
    const { post } = cur();
    if (post.video_state === 'approved') {
      await setState(post, 'pending');
      V.approvedNow.delete(post.id);
      toast('האישור בוטל');
      return;
    }
    vibrate(12);
    burst();
    V.approvedNow.add(post.id);
    const ok = setState(post, 'approved');
    const at = V.i;
    toast('אושר');
    setTimeout(() => { if (V && V.i === at && V.end.hidden && !V.typing) next(); }, 750);
    await ok;
  }

  async function setState(post, state) {
    const prevState = post.video_state;
    post.video_state = state;
    if (V && cur().post === post) paintState();
    try {
      const r = await V.opts.api('/api/posts/' + post.id + '/state', { method: 'POST', body: { part: 'video', state } });
      if (r && r.post) { post.video_state = r.post.video_state; post.stage = r.post.stage; }
      return true;
    } catch {
      post.video_state = prevState;
      toast('לא נשמר, אפשר לנסות שוב');
      return false;
    } finally {
      if (V && cur().post === post) paintState();
    }
  }

  /* reply box: a comment at the current second, and the video goes to "needs changes" (like For You's "לתקן") */
  async function send() {
    const text = V.input.value.trim();
    if (!text) { V.input.focus(); return; }
    const { post } = cur();
    const at = round1(V.typing ? +V.range.value : (V.vid.currentTime || 0));
    V.sendBtn.disabled = true;
    try {
      const r = await V.opts.api('/api/posts/' + post.id + '/comments', { method: 'POST', body: { target: 'video', body: text, at_sec: at } });
      const cm = (r && r.comment) || { id: Date.now(), target: 'video', body: text, at_sec: at, status: 'open' };
      if (post.version && cm.version_id == null) cm.version_id = post.version.id;
      (post.comments = post.comments || []).push(cm);
      V.input.value = '';
      V.root.classList.remove('has-text');
      if (post.video_state !== 'changes') await setState(post, 'changes');
      V.notedNow.add(post.id); V.approvedNow.delete(post.id);
      paintState();
      toast('ההערה נשמרה ב־' + fmt(at));
      V.input.blur();
      exitComment();
    } catch {
      toast('ההערה לא נשמרה, אפשר לנסות שוב');
    } finally {
      if (V) V.sendBtn.disabled = false;
    }
  }

  /* comment at a chosen second: the video pauses and a scrubber appears above the bar */
  const durationOf = () => { const d = V.vid.duration; return (d && isFinite(d) ? d : (cur().post.version && cur().post.version.duration)) || 0; };
  function paintScrub() { V.scrubT.textContent = fmt(+V.range.value); }
  function enterComment() {
    if (!V || V.typing) return;
    V.typing = true; pause();
    V.root.classList.add('typing', 'commenting');
    V.range.max = String(durationOf() || 1);
    V.range.value = String(V.vid.currentTime || 0);
    V.scrub.hidden = false; paintScrub();
  }
  function exitComment() {
    if (!V) return;
    V.typing = false; V.scrubbing = false;
    V.scrub.hidden = true;
    V.root.classList.remove('typing', 'commenting');
    resume();
  }

  /* text captions placed on the story. x, y = centre in % of the frame, width_pct = max box width in % of the frame width,
     font_px_at_1080 = font size at 1080 px wide. Everything scales with --u (frame width / 1080), so any screen shows the same layout. */
  const STYLES = ['white-box', 'black-box', 'shadow'];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function paintText(el, t) {
    el.className = 'st-text s-' + t.style;
    el.replaceChildren(h('span', {}, t.text)); // inline span = Instagram-style box per line (stories.css)
    el.style.left = t.x + '%'; el.style.top = t.y + '%';
    el.style.maxWidth = t.width_pct + '%';
    el.style.setProperty('--fs', t.font_px_at_1080);
    el.style.transform = 'translate(-50%,-50%) rotate(' + (t.rotation || 0) + 'deg)';
  }
  function renderTexts(hideId) {
    const { post } = cur();
    V.texts.replaceChildren(...post.texts.map((t) => {
      const el = h('div', { class: 'st-text', dir: 'rtl' });
      paintText(el, t);
      if (hideId != null && t.id === hideId) el.classList.add('hide');
      if (V.opts.readonly) el.style.pointerEvents = 'none'; else bindText(el, t, post);
      return el;
    }));
  }
  function persist(post, t, immediate) {
    clearTimeout(V.saveT[t._k]);
    const run = async () => {
      const body = { text: t.text, style: t.style, x: round1(t.x), y: round1(t.y), width_pct: round1(t.width_pct), font_px_at_1080: Math.round(t.font_px_at_1080), rotation: t.rotation || 0 };
      try {
        if (!t.id) { const r = await V.opts.api('/api/posts/' + post.id + '/texts', { method: 'POST', body }); if (r && r.text) t.id = r.text.id; }
        else await V.opts.api('/api/texts/' + t.id, { method: 'PATCH', body });
      } catch { toast('הטקסט לא נשמר, אפשר לנסות שוב'); }
    };
    if (immediate) return run();
    V.saveT[t._k] = setTimeout(run, 350);
  }
  async function removeText(post, t) {
    post.texts.splice(post.texts.indexOf(t), 1);
    if (V.i >= 0 && cur().post === post) renderTexts();
    if (t.id) { try { await V.opts.api('/api/texts/' + t.id, { method: 'DELETE' }); } catch { toast('המחיקה לא נשמרה'); } }
  }
  function scaleText(t, f) {
    const nf = clamp(t.font_px_at_1080 * f, 24, 220);
    f = nf / t.font_px_at_1080;
    t.font_px_at_1080 = nf; t.width_pct = clamp(t.width_pct * f, 20, 100);
  }
  let tk = 1;
  function bindText(el, t, post) {
    t._k = t._k || tk++;
    const ptrs = new Map();
    let st = null;
    const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const base = () => { const [a] = [...ptrs.values()]; st = { x: t.x, y: t.y, px: a.x, py: a.y, d: ptrs.size > 1 ? dist() : 0, font: t.font_px_at_1080, w: t.width_pct, moved: st ? st.moved : false, t0: st ? st.t0 : performance.now() }; };
    const overTrash = (x, y) => { const r = V.trash.getBoundingClientRect(); return x > r.left - 14 && x < r.right + 14 && y > r.top - 14 && y < r.bottom + 14; };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (V.editing) return;
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* old Safari */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      base();
    });
    el.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !st) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = V.texts.getBoundingClientRect();
      if (ptrs.size >= 2) {
        st.moved = true;
        const f = dist() / st.d;
        t.font_px_at_1080 = st.font; t.width_pct = st.w; scaleText(t, f);
      } else {
        const [a] = [...ptrs.values()];
        const dx = a.x - st.px, dy = a.y - st.py;
        if (!st.moved && Math.hypot(dx, dy) < 6) return;
        st.moved = true;
        t.x = clamp(st.x + dx / r.width * 100, 0, 100); t.y = clamp(st.y + dy / r.height * 100, 0, 100);
        V.root.classList.add('dragging-text');
        V.trash.classList.toggle('hot', overTrash(a.x, a.y));
      }
      paintText(el, t);
    });
    const end = (e, cancel) => {
      if (!ptrs.has(e.pointerId)) return;
      const hot = ptrs.size === 1 && overTrash(e.clientX, e.clientY);
      ptrs.delete(e.pointerId);
      if (ptrs.size) { base(); return; }
      V.root.classList.remove('dragging-text'); V.trash.classList.remove('hot');
      const s = st; st = null;
      if (cancel || !s) return;
      if (!s.moved && performance.now() - s.t0 < 600) { openEditor(t); return; }
      if (hot) { removeText(post, t); vibrate(12); return; }
      persist(post, t);
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }

  /* the editor: type, cycle the style (like Instagram's "A" box button), size slider, Done */
  function openEditor(existing) {
    if (!V || V.editing) return;
    if (V.typing) { V.input.blur(); exitComment(); }
    const post = cur().post;
    const t = existing ? { ...existing } : { id: null, text: '', style: V.lastStyle, x: 50, y: 50, width_pct: 90, font_px_at_1080: 72, rotation: 0 };
    V.editing = true; pause();
    V.root.classList.add('editing');
    renderTexts(existing ? existing.id : null);
    const box = h('div', { class: 'st-text st-ed-box', contenteditable: 'true', dir: 'rtl', 'data-ph': 'כתיבה...', role: 'textbox', 'aria-label': 'טקסט לסטורי', spellcheck: 'false', autocapitalize: 'off' });
    const paintBox = () => { box.className = 'st-text st-ed-box s-' + t.style; box.style.setProperty('--fs', t.font_px_at_1080); box.style.maxWidth = t.width_pct + '%'; styleBtn.className = 'st-ed-style s-' + t.style; };
    const styleBtn = h('button', { type: 'button', class: 'st-ed-style', 'aria-label': 'סגנון הטקסט' }, 'A');
    const size = h('input', { type: 'range', class: 'st-range st-ed-size', min: '28', max: '200', step: '1', value: String(Math.round(t.font_px_at_1080)), 'aria-label': 'גודל הטקסט' });
    const done = h('button', { type: 'button', class: 'st-ed-done' }, 'סיום');
    const ed = h('div', { class: 'st-ed', dir: 'ltr' },
      h('div', { class: 'st-ed-top' }, styleBtn, done),
      h('div', { class: 'st-ed-sz' }, h('span', { class: 'st-ed-a sm' }, 'A'), size, h('span', { class: 'st-ed-a lg' }, 'A')),
      box);
    box.textContent = t.text;
    paintBox();
    V.media.append(ed);
    styleBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    styleBtn.addEventListener('click', () => { t.style = STYLES[(STYLES.indexOf(t.style) + 1) % STYLES.length]; V.lastStyle = t.style; paintBox(); box.focus(); });
    // like Instagram: the size slider only changes the letters, the wrap width stays full, so a smaller font fits more words per line
    size.addEventListener('input', () => { t.font_px_at_1080 = +size.value; t.width_pct = 90; paintBox(); });
    box.addEventListener('input', () => { if (!box.textContent.trim()) box.innerHTML = ''; });
    box.addEventListener('paste', (e) => { e.preventDefault(); const tx = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, tx); });
    const finish = () => {
      if (!V || !V.editing) return;
      V.editing = false; V.finishEditor = null;
      const text = (box.innerText || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      ed.remove();
      V.root.classList.remove('editing');
      t.text = text;
      if (existing) {
        if (!text) removeText(post, existing);
        else { Object.assign(existing, t); persist(post, existing, true); }
      } else if (text) {
        post.texts.push(t); persist(post, t, true);
      }
      renderTexts();
      resume();
    };
    V.finishEditor = finish;
    done.addEventListener('click', finish);
    ed.addEventListener('pointerdown', (e) => { if (e.target === ed) { e.preventDefault(); finish(); } });
    setTimeout(() => box.focus(), 30);
  }

  function burst() {
    const b = h('div', { class: 'st-burst', html: icon('approve') });
    V.center.replaceChildren(b);
    setTimeout(() => b.remove(), 900);
  }

  let toastT = 0;
  function toast(msg) {
    if (!V) return;
    V.toastEl.textContent = msg;
    V.toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => V && V.toastEl.classList.remove('show'), 2000);
  }

  function summary() {
    const posts = V.list.map((x) => x.post);
    return {
      total: posts.length,
      approved: posts.filter((p) => p.video_state === 'approved').length,
      notes: posts.filter((p) => p.video_state === 'changes').length,
      left: posts.filter((p) => p.video_state === 'pending').length,
    };
  }

  function showEnd() {
    V.ended = true;
    pause();
    cancelAnimationFrame(V.raf);
    [...V.bars.children].forEach((b) => { b.className = 'done'; b.firstChild.style.transform = ''; });
    if (V.opts.readonly) {
      V.end.replaceChildren(h('div', { class: 'st-end-in' },
        h('div', { class: 'st-end-ic', html: icon('check') }),
        h('h2', {}, 'זה היה הסטורי האחרון'),
        h('div', { class: 'st-end-acts' }, h('button', { type: 'button', class: 'st-pill solid', onclick: () => show(0) }, 'לצפייה שוב'))));
      V.end.hidden = false;
      V.root.classList.add('at-end');
      return;
    }
    const s = summary();
    const title = s.left ? (s.left === 1 ? 'נשאר סטורי אחד' : 'נשארו ' + s.left + ' סטוריז') : s.notes ? 'עברת על הכל' : 'הכל אושר';
    const parts = [];
    parts.push(s.approved === 1 ? 'סטורי אחד אושר' : (s.approved || 'אף') + ' ' + (s.approved ? 'סטוריז אושרו' : 'סטורי לא אושר'));
    if (s.notes) parts.push(plural(s.notes, 'אחד עם הערות', 'עם הערות'));
    if (s.left) parts.push(plural(s.left, 'אחד בלי החלטה', 'בלי החלטה'));
    const firstOpen = V.list.findIndex((x) => x.post.video_state === 'pending');
    V.end.replaceChildren(h('div', { class: 'st-end-in' },
      h('div', { class: 'st-end-ic' + (s.left || s.notes ? '' : ' ok'), html: icon(s.left || s.notes ? 'check' : 'approve') }),
      h('h2', {}, title),
      h('p', {}, parts.join(', ')),
      h('div', { class: 'st-end-acts' },
        firstOpen >= 0 ? h('button', { type: 'button', class: 'st-pill solid', onclick: () => show(firstOpen) }, 'לסטוריז שנשארו') : null,
        h('button', { type: 'button', class: 'st-pill' + (firstOpen >= 0 ? '' : ' solid'), onclick: () => close() }, 'סגירה'))));
    V.end.hidden = false;
    V.root.classList.add('at-end');
    const btn = V.end.querySelector('button'); if (btn) btn.focus({ preventScroll: true });
  }

  function close() {
    if (!V) return;
    const v = V;
    const s = summary();
    cancelAnimationFrame(v.raf);
    if (v.ro) v.ro.disconnect();
    document.removeEventListener('keydown', v.onKey, true);
    document.removeEventListener('visibilitychange', v.onVis);
    v.unbindVid(v.vid);
    for (const [, pv] of v.pool) { pv.removeAttribute('src'); try { pv.load(); } catch { /* ignore */ } }
    v.pool.clear();
    v.vid.pause();
    v.vid.removeAttribute('src');
    try { v.vid.load(); } catch { /* frees the decoder */ }
    v.vid.remove();
    v.vid.className = 'vid';
    v.vid.loop = true;
    v.root.remove();
    document.body.classList.remove('st-open');
    V = null;
    if (v.opts.onClose) v.opts.onClose(s);
  }

  window.FYStories = { open, close, isOpen: () => !!V };
})();
