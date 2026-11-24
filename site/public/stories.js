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

  /* opts: {sets: [{client, posts}], client?, post?, api, video?, muted, gesture, onClose(summary), onMute(m)} */
  function open(opts) {
    if (V) close();
    const list = [];
    opts.sets.forEach((set) => set.posts.forEach((post) => list.push({ set, post })));
    if (!list.length) return false;
    let i = 0;
    if (opts.post != null) i = Math.max(0, list.findIndex((x) => String(x.post.id) === String(opts.post)));
    else if (opts.client != null) {
      const inSet = list.map((x, n) => [x, n]).filter(([x]) => String(x.set.client.id) === String(opts.client));
      const firstOpen = inSet.find(([x]) => x.post.video_state === 'pending') || inSet[0];
      if (firstOpen) i = firstOpen[1];
    } else {
      const firstOpen = list.findIndex((x) => x.post.video_state === 'pending');
      if (firstOpen >= 0) i = firstOpen;
    }

    const vid = opts.video || document.createElement('video');
    const root = h('div', { class: 'st', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'סטוריז לאישור' });
    const frame = h('div', { class: 'st-frame' });
    const media = h('div', { class: 'st-media' });
    const poster = h('img', { class: 'st-poster', alt: '' });
    const tap = h('div', { class: 'st-tap', 'aria-hidden': 'true' });
    const bars = h('div', { class: 'st-bars' });
    const head = h('div', { class: 'st-head', dir: 'ltr' }, bars, h('div', { class: 'st-row' }));
    const center = h('div', { class: 'st-center', 'aria-hidden': 'true' });
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
    media.append(poster, vid, h('div', { class: 'st-shade' }), tap, head, center, verr);
    frame.append(media, bar, end, toastEl);
    root.append(frame, navPrev, navNext);
    document.body.append(root);
    document.body.classList.add('st-open');

    V = { opts, list, i, root, frame, media, vid, poster, tap, bars, head, center, verr, input, approveBtn, sendBtn, bar, toastEl, end,
      raf: 0, held: false, typing: false, userPaused: false, ended: false, srcIdx: 0, srcs: [], approvedNow: new Set(), notedNow: new Set(), onKey: null, onVid: {} };

    /* video events */
    const on = (ev, fn) => { vid.addEventListener(ev, fn); V.onVid[ev] = fn; };
    on('ended', () => { if (V && !V.ended) next(); });
    on('playing', () => { root.classList.remove('buffering'); verr.replaceChildren(); });
    on('waiting', () => root.classList.add('buffering'));
    on('loadeddata', () => { root.classList.add('ready'); root.classList.remove('buffering'); });
    on('error', () => {
      if (!V || !vid.error) return;
      V.srcIdx++;
      if (V.srcIdx < V.srcs.length) { vid.src = V.srcs[V.srcIdx]; play(); return; }
      root.classList.remove('buffering');
      verr.replaceChildren(h('span', {}, 'הסרטון לא נטען'), h('button', { type: 'button', class: 'st-pill', onclick: (e) => { e.stopPropagation(); show(V.i); } }, 'לנסות שוב'));
    });

    bindTap();
    bar.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    approveBtn.addEventListener('click', () => approve());
    input.addEventListener('focus', () => { V.typing = true; pause(); root.classList.add('typing'); });
    input.addEventListener('blur', () => { setTimeout(() => { if (!V) return; V.typing = false; root.classList.remove('typing'); if (!input.value.trim()) resume(); }, 120); });
    input.addEventListener('input', () => root.classList.toggle('has-text', !!input.value.trim()));
    navPrev.addEventListener('click', () => prev());
    navNext.addEventListener('click', () => next());
    V.onKey = (e) => {
      if (!V) return;
      if (e.target === input) { if (e.key === 'Escape') { input.value = ''; root.classList.remove('has-text'); input.blur(); } return; }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); togglePause(); }
      else if (e.key === 'm' || e.key === 'M') setMuted(!vid.muted);
    };
    document.addEventListener('keydown', V.onKey, true);
    V.onVis = () => { if (!V) return; if (document.hidden) vid.pause(); else resume(); };
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
    V.verr.replaceChildren();
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
      V.vid.src = V.srcs[0];
      V.vid.currentTime = 0;
      play();
    }
    startRaf();
  }

  function paintHead() {
    const { set, post } = cur();
    const inSet = set.posts;
    const k = inSet.indexOf(post);
    V.bars.replaceChildren(...inSet.map((p, n) => h('i', { class: n < k ? 'done' : '' }, h('b', {}))));
    const muted = V.vid.muted;
    const paused = V.userPaused;
    $('.st-row', V.head).replaceChildren(
      avatar(set.client, 32),
      h('span', { class: 'st-who' },
        h('b', { class: 'st-name', dir: 'auto' }, set.client.name || ''),
        h('span', { class: 'st-title', dir: 'auto' }, post.title || '')),
      h('span', { class: 'st-badge' }),
      h('span', { class: 'st-grow' }),
      h('button', { type: 'button', class: 'st-ib st-pp', 'aria-label': paused ? 'המשך' : 'עצירה', html: icon(paused ? 'play' : 'pause'), onclick: () => togglePause() }),
      h('button', { type: 'button', class: 'st-ib st-mute', 'aria-label': muted ? 'הפעלת שמע' : 'השתקה', html: icon(muted ? 'mute' : 'vol'), onclick: () => setMuted(!V.vid.muted) }),
      h('button', { type: 'button', class: 'st-ib st-x', 'aria-label': 'סגירה', html: icon('x'), onclick: () => close() }));
    V.root.querySelector('.st-nav.prev').disabled = V.i === 0;
  }

  function paintState() {
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
    if (!V || V.held || V.typing || V.userPaused || V.ended || !V.vid.getAttribute('src')) return;
    try { await V.vid.play(); }
    catch (e) {
      if (e && e.name === 'NotAllowedError' && !V.vid.muted) {
        V.vid.muted = true; paintHead();
        try { await V.vid.play(); } catch { /* waits for a tap */ }
      }
    }
  }
  function pause() { if (V) V.vid.pause(); }
  function resume() { if (V && !V.held && !V.typing && !V.userPaused && !V.ended && V.end.hidden) play(); }
  function togglePause() {
    V.userPaused = !V.userPaused;
    if (V.userPaused) pause(); else play();
    V.root.classList.toggle('user-paused', V.userPaused);
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
      if (V.held) { V.held = false; V.root.classList.remove('holding'); if (!cancel && dy > 110) { close(); return; } resume(); return; }
      if (cancel) return;
      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { close(); return; }
      if (performance.now() - t0 > 500 || Math.abs(dx) > 14 || Math.abs(dy) > 14) return;
      if (document.activeElement === V.input) { V.input.blur(); return; }
      const r = tap.getBoundingClientRect();
      if (e.clientX - r.left < r.width / 3) prev(); else next();
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
    const at = round1(V.vid.currentTime || 0);
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
      V.typing = false; V.root.classList.remove('typing');
      resume();
    } catch {
      toast('ההערה לא נשמרה, אפשר לנסות שוב');
    } finally {
      if (V) V.sendBtn.disabled = false;
    }
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
    document.removeEventListener('keydown', v.onKey, true);
    document.removeEventListener('visibilitychange', v.onVis);
    for (const [ev, fn] of Object.entries(v.onVid)) v.vid.removeEventListener(ev, fn);
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
