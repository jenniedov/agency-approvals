/* "New job" intake for the owner: a floating + opens a sheet. She picks photos/videos from the phone (they start
   uploading at once, in 10 MB parts straight into R2, with retries), types or records a voice note while they upload,
   and sends. The job lands in Claude's queue (agent.py jobs) once every file is in. Plain JS, no build step. */
(function () {
  'use strict';

  var MAX_PARTS_IN_FLIGHT = 3;
  var RETRY_WAIT = [1, 2, 4, 8, 15, 30, 30, 60];
  var STATUS = {
    queued: { label: 'נשלחה, הקבצים עוד עולים', cls: 'me' },
    new: { label: 'מחכה לקלוד', cls: 'me' },
    working: { label: 'קלוד עובד על זה', cls: 'client' },
    done: { label: 'מוכן', cls: 'ok' }
  };

  var user = null;
  var job = null;          // the draft being built: {id}
  var items = [];          // files in the sheet: {key, file, role, fileId, total, pending:[], etags:{}, loaded:{}, state, transcript, tstate, url}
  var inflight = 0;
  var sending = false;     // tapped send, waiting for the server
  var sent = null;         // job object after send (sheet shows the "sent" state)
  var rec = null;          // active recording
  var wakeLock = null;
  var seq = 0;

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mb(n) { return n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1) + ' GB' : Math.max(0.1, n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB'; }
  function api(method, path, body) {
    var opt = { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (method !== 'GET') { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'http_' + r.status); e.code = d.error; e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function wait(sec) { return new Promise(function (r) { setTimeout(r, sec * 1000); }); }
  function online() {
    if (navigator.onLine !== false) return Promise.resolve();
    return new Promise(function (r) { window.addEventListener('online', function f() { window.removeEventListener('online', f); r(); }); });
  }
  function toast(t) {
    var el = document.getElementById('toast'); if (!el) return;
    el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function svg(p, w) { return '<svg aria-hidden="true" width="' + (w || 22) + '" height="' + (w || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var I = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    photo: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="9" cy="10.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    send: '<path d="M20 4 3 11l7 2.5L12.5 21z"/><path d="m10 13.5 4-4"/>',
    retry: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5"/>'
  };

  /* ---------------- upload engine ---------------- */
  function ensureJob() {
    if (job) return Promise.resolve(job);
    if (ensureJob.p) return ensureJob.p;
    ensureJob.p = api('POST', '/api/jobs').then(function (r) {
      job = { id: r.job.id };
      try { localStorage.setItem('job_draft', String(job.id)); } catch (_) {}
      return job;
    }).finally(function () { ensureJob.p = null; });
    return ensureJob.p;
  }

  function addFile(file, role) {
    var it = { key: ++seq, file: file, role: role || 'media', state: 'starting', pending: [], etags: {}, loaded: {}, done: 0, url: null };
    if (/^(image|video|audio)\//.test(file.type)) { try { it.url = URL.createObjectURL(file); } catch (_) {} }
    items.push(it);
    startItem(it);
    paint();
    return it;
  }

  function startItem(it) {
    it.state = 'starting'; paint();
    ensureJob().then(function (j) {
      return api('POST', '/api/jobs/' + j.id + '/files', { name: it.file.name || (it.role + '.bin'), size: it.file.size, content_type: it.file.type || 'application/octet-stream', role: it.role });
    }).then(function (r) {
      it.fileId = r.file_id; it.partSize = r.part_size; it.total = r.parts;
      it.pending = []; for (var n = 1; n <= r.parts; n++) it.pending.push(n);
      it.state = 'uploading'; keepAwake(); paint(); pump();
    }).catch(function (e) { console.warn(e); it.state = 'failed'; paint(); });
  }

  function nextPart() {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.state === 'uploading' && it.pending.length) return { it: it, n: it.pending.shift() };
    }
    return null;
  }
  function pump() {
    var nx;
    while (inflight < MAX_PARTS_IN_FLIGHT && (nx = nextPart())) {
      inflight++;
      (function (it, n) {
        sendPart(it, n, 0).then(function (etag) {
          it.etags[n] = etag; it.done += partLen(it, n); delete it.loaded[n];
          if (Object.keys(it.etags).length === it.total) completeItem(it);
        }, function (e) {
          console.warn('part failed', n, e);
          delete it.loaded[n];
          if (it.state === 'removed') return;
          it.pending.unshift(n); it.state = 'failed';
        }).finally(function () { inflight--; paint(); pump(); });
      })(nx.it, nx.n);
    }
    paint();
  }
  function partLen(it, n) { return n < it.total ? it.partSize : it.file.size - it.partSize * (it.total - 1); }

  function sendPart(it, n, attempt) {
    var start = (n - 1) * it.partSize;
    var blob = it.file.slice(start, start + partLen(it, n));
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      it.xhr = it.xhr || {}; it.xhr[n] = x;
      x.open('PUT', '/api/jobs/' + job.id + '/files/' + it.fileId + '/parts/' + n);
      x.withCredentials = true;
      x.setRequestHeader('content-type', 'application/octet-stream');
      x.upload.onprogress = function (e) { it.loaded[n] = e.loaded; paintSoon(); };
      x.onload = function () {
        delete it.xhr[n];
        var d = {}; try { d = JSON.parse(x.responseText); } catch (_) {}
        if (x.status >= 200 && x.status < 300 && d.etag) resolve(d.etag);
        else { var e = new Error(d.error || 'http_' + x.status); e.status = x.status; reject(e); }
      };
      x.onerror = x.ontimeout = function () { delete it.xhr[n]; reject(new Error('network')); };
      x.onabort = function () { delete it.xhr[n]; reject(new Error('abort')); };
      x.timeout = 5 * 60 * 1000;
      x.send(blob);
    }).catch(function (e) {
      it.loaded[n] = 0;
      if (it.state === 'removed' || e.message === 'abort' || (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) || attempt >= RETRY_WAIT.length) throw e;
      return online().then(function () { return wait(RETRY_WAIT[attempt]); }).then(function () { return sendPart(it, n, attempt + 1); });
    });
  }

  function completeItem(it) {
    var parts = Object.keys(it.etags).map(function (n) { return { part_number: +n, etag: it.etags[n] }; });
    it.state = 'finishing'; paint();
    var go = function (attempt) {
      return api('POST', '/api/jobs/' + job.id + '/files/' + it.fileId + '/complete', { parts: parts }).catch(function (e) {
        if (attempt >= 4 || (e.status && e.status < 500)) throw e;
        return online().then(function () { return wait(RETRY_WAIT[attempt]); }).then(function () { return go(attempt + 1); });
      });
    };
    go(0).then(function () {
      it.state = 'ready'; paint(); refreshSent(); releaseWake();
      if (it.role === 'voice') transcribeItem(it);
    }, function (e) { console.warn(e); it.state = 'failed'; it.completeFailed = true; paint(); });
  }

  function transcribeItem(it) {
    it.tstate = 'pending'; paint();
    api('POST', '/api/jobs/' + job.id + '/files/' + it.fileId + '/transcribe').then(function (r) {
      it.tstate = 'done'; it.transcript = r.transcript || ''; insertTranscript(it); paint();
    }, function (e) { it.tstate = e.code === 'no_key' ? 'later' : 'failed'; paint(); });
  }
  // her words go straight into the text box (appended, once per recording), so she can read and fix them
  function insertTranscript(it) {
    if (it.inserted || !it.transcript) return;
    it.inserted = true;
    var ta = document.getElementById('jb-text');
    var cur = ta ? ta.value : (localStorage.getItem('job_text') || '');
    var next = cur.replace(/\s+$/, '') + (cur.trim() ? '\n' : '') + it.transcript.trim();
    if (ta) { ta.value = next; ta.scrollTop = ta.scrollHeight; }
    try { localStorage.setItem('job_text', next); } catch (_) {}
  }

  function retryItem(it) {
    if (!it.fileId) return startItem(it);
    if (it.completeFailed) { it.completeFailed = false; return completeItem(it); }
    it.state = 'uploading'; pump();
  }

  function removeItem(it) {
    it.state = 'removed';
    Object.keys(it.xhr || {}).forEach(function (n) { try { it.xhr[n].abort(); } catch (_) {} });
    items = items.filter(function (x) { return x !== it; });
    if (it.url) URL.revokeObjectURL(it.url);
    if (job && it.fileId) api('DELETE', '/api/jobs/' + job.id + '/files/' + it.fileId).catch(function () {});
    paint(); releaseWake();
  }

  function voicePending() { return items.filter(function (it) { return it.role === 'voice' && it.state !== 'failed' && it.state !== 'removed' && (it.state !== 'ready' || it.tstate === 'pending'); }); }
  function busy() { return items.filter(function (it) { return it.state === 'starting' || it.state === 'uploading' || it.state === 'finishing'; }); }
  function totals() {
    var size = 0, done = 0;
    items.forEach(function (it) {
      size += it.file.size;
      if (it.state === 'ready') done += it.file.size;
      else { done += it.done || 0; Object.keys(it.loaded).forEach(function (n) { done += it.loaded[n] || 0; }); }
    });
    return { size: size, done: done, pct: size ? Math.min(100, Math.floor(done / size * 100)) : 100 };
  }
  function itemPct(it) {
    if (it.state === 'ready') return 100;
    var d = it.done || 0; Object.keys(it.loaded).forEach(function (n) { d += it.loaded[n] || 0; });
    return it.file.size ? Math.min(99, Math.floor(d / it.file.size * 100)) : 0;
  }

  // iPhone: Safari stops uploads when the screen locks, so keep it awake while files go up
  function keepAwake() {
    if (wakeLock || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
  }
  function releaseWake() { if (!busy().length && wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && busy().length) { keepAwake(); pump(); } });
  window.addEventListener('beforeunload', function (e) { if (busy().length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- voice recording ---------------- */
  function pickMime() {
    var opts = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < opts.length; i++) if (MediaRecorder.isTypeSupported(opts[i])) return opts[i];
    return '';
  }
  function startRec() {
    if (rec) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('הדפדפן הזה לא מקליט. אפשר להכתיב עם המיקרופון של המקלדת'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = pickMime();
      var mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      var chunks = [];
      rec = { mr: mr, stream: stream, start: Date.now(), level: 0 };
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (rec && rec.ctx) rec.ctx.close().catch(function () {});
        var type = (mr.mimeType || mime || 'audio/mp4').split(';')[0];
        var ext = /mp4|aac|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
        var secs = Math.round((Date.now() - rec.start) / 1000);
        rec = null;
        if (!chunks.length || secs < 1) { paint(); return; }
        var d = new Date();
        var f = new File(chunks, 'voice-' + d.getHours() + '-' + ('0' + d.getMinutes()).slice(-2) + '-' + ('0' + d.getSeconds()).slice(-2) + '.' + ext, { type: type });
        var it = addFile(f, 'voice'); it.secs = secs;
      };
      mr.start(1000);
      try { // a little live level so she sees it hears her
        var AC = window.AudioContext || window.webkitAudioContext;
        var ctx = new AC(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
        an.fftSize = 512; src.connect(an); rec.ctx = ctx;
        var buf = new Uint8Array(an.fftSize);
        (function loop() {
          if (!rec || rec.ctx !== ctx) return;
          an.getByteTimeDomainData(buf);
          var peak = 0; for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          rec.level = rec.level * 0.6 + (peak / 128) * 0.4;
          var ring = document.querySelector('.jb-rec-ring');
          if (ring) ring.style.transform = 'scale(' + (1 + Math.min(0.6, rec.level * 1.6)).toFixed(3) + ')';
          var t = document.querySelector('.jb-rec-time');
          if (t) { var s = Math.floor((Date.now() - rec.start) / 1000); t.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
          requestAnimationFrame(loop);
        })();
      } catch (_) {}
      keepAwake();
      paint();
      if (rec && !rec.ctx) rec.timer = setInterval(function () { var t = document.querySelector('.jb-rec-time'); if (t && rec) { var s = Math.floor((Date.now() - rec.start) / 1000); t.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); } }, 500);
    }, function () { toast('צריך לאשר גישה למיקרופון כדי להקליט'); });
  }
  function stopRec() { if (rec) { clearInterval(rec.timer); try { rec.mr.stop(); } catch (_) {} } }

  /* ---------------- send ---------------- */
  function textValue() { var t = document.getElementById('jb-text'); return t ? t.value.trim() : ''; }
  function send(force) {
    if (sending) return;
    var text = textValue();
    if (!text && !items.length) { toast('אפשר להוסיף קבצים, לכתוב או להקליט'); return; }
    if (rec) stopRec();
    sending = true; paint();
    ensureJob().then(function (j) { return api('POST', '/api/jobs/' + j.id + '/send', { text: text, force: !!force }); }).then(function (r) {
      sent = r.job; sending = false;
      try { localStorage.removeItem('job_draft'); localStorage.removeItem('job_text'); } catch (_) {}
      paint(); paintPill(); refreshLists();
    }, function (e) { sending = false; paint(); toast(e.code === 'empty' ? 'אין מה לשלוח עדיין' : 'לא הצלחנו לשלוח. אפשר לנסות שוב'); });
  }
  function refreshSent() {
    if (!sent || !job) return;
    api('GET', '/api/jobs/' + job.id).then(function (r) { sent = r.job; paint(); paintPill(); refreshLists(); }).catch(function () {});
  }
  function resetDraft() {
    items.forEach(function (it) { if (it.url) URL.revokeObjectURL(it.url); });
    job = null; items = []; sent = null; sending = false;
    var t = document.getElementById('jb-text'); if (t) t.value = '';
  }
  function cancelDraft() {
    if (busy().length || items.length) { if (!confirm('לבטל את המשימה ולמחוק את הקבצים שהועלו?')) return; }
    var id = job && job.id;
    items.slice().forEach(function (it) { it.state = 'removed'; Object.keys(it.xhr || {}).forEach(function (n) { try { it.xhr[n].abort(); } catch (_) {} }); });
    resetDraft();
    try { localStorage.removeItem('job_draft'); localStorage.removeItem('job_text'); } catch (_) {}
    if (id) api('DELETE', '/api/jobs/' + id).catch(function () {});
    close();
  }

  /* ---------------- sheet ---------------- */
  var $dlg, $fab, $pill, $input;
  function build() {
    if ($dlg) return;
    $fab = document.createElement('button');
    $fab.type = 'button'; $fab.className = 'jb-fab'; $fab.setAttribute('aria-label', 'משימה חדשה לקלוד');
    $fab.innerHTML = svg(I.plus, 30);
    $fab.onclick = open;
    $pill = document.createElement('button');
    $pill.type = 'button'; $pill.className = 'jb-pill'; $pill.hidden = true; $pill.onclick = open;
    $input = document.createElement('input');
    $input.type = 'file'; $input.multiple = true; $input.accept = 'video/*,image/*'; $input.hidden = true;
    $input.onchange = function () { Array.prototype.forEach.call($input.files || [], function (f) { addFile(f, 'media'); }); $input.value = ''; };
    $dlg = document.createElement('dialog');
    $dlg.className = 'sheet jb-sheet'; $dlg.setAttribute('aria-labelledby', 'jb-title');
    $dlg.addEventListener('click', onClick);
    $dlg.addEventListener('close', function () { if (rec) stopRec(); paintPill(); });
    $dlg.addEventListener('input', function (e) { if (e.target.id === 'jb-text') { try { localStorage.setItem('job_text', e.target.value); } catch (_) {} } });
    document.body.appendChild($fab); document.body.appendChild($pill); document.body.appendChild($input); document.body.appendChild($dlg);
  }
  function open() {
    build();
    if (sent && !busy().length && sent.status !== 'queued') resetDraft();
    paint(true);
    if (!$dlg.open) { try { $dlg.showModal(); } catch (_) { $dlg.setAttribute('open', ''); } }
    resumeDraft();
  }
  function close() { if ($dlg && $dlg.open) $dlg.close(); paintPill(); }

  // a draft left from before a reload: show its files that made it, drop the half-uploaded ones
  function resumeDraft() {
    if (job || items.length) return;
    var id = null; try { id = localStorage.getItem('job_draft'); } catch (_) {}
    if (!id) return;
    api('GET', '/api/jobs/' + id).then(function (r) {
      if (r.job.status !== 'draft') { localStorage.removeItem('job_draft'); return; }
      job = { id: r.job.id };
      r.job.files.forEach(function (f) {
        if (f.state !== 'ready') { api('DELETE', '/api/jobs/' + job.id + '/files/' + f.id).catch(function () {}); return; }
        items.push({ key: ++seq, file: { name: f.name, size: f.size, type: f.content_type }, role: f.role, fileId: f.id, state: 'ready', pending: [], etags: {}, loaded: {}, done: f.size,
          url: f.url, transcript: f.transcript, tstate: f.transcript_state === 'done' ? 'done' : f.role === 'voice' ? 'later' : null, inserted: true });
      });
      paint();
    }).catch(function () { try { localStorage.removeItem('job_draft'); } catch (_) {} });
  }

  function onClick(e) {
    if (e.target === $dlg) { close(); return; } // tap on the backdrop
    var t = e.target.closest('[data-jb]'); if (!t) return;
    var a = t.getAttribute('data-jb');
    var it = items.filter(function (x) { return String(x.key) === t.getAttribute('data-key'); })[0];
    if (a === 'pick') $input.click();
    else if (a === 'rec') startRec();
    else if (a === 'stop') stopRec();
    else if (a === 'send') send(false);
    else if (a === 'force') send(true);
    else if (a === 'close') close();
    else if (a === 'cancel') cancelDraft();
    else if (a === 'new') { resetDraft(); paint(true); }
    else if (a === 'remove' && it) removeItem(it);
    else if (a === 'retry' && it) retryItem(it);
    else if (a === 'retx' && it) transcribeItem(it);
  }

  var paintTimer = null, fileSig = null, voiceSig = null;
  function updateTiles(media) {
    media.forEach(function (it) {
      var li = $dlg.querySelector('[data-k="' + it.key + '"]'); if (!li) return;
      var pct = itemPct(it);
      var bar = li.querySelector('.jb-bar span'); if (bar) bar.style.width = pct + '%';
      var pe = li.querySelector('.jb-pct'); if (pe) pe.textContent = it.state === 'starting' ? '…' : it.state === 'finishing' ? '100%' : pct + '%';
    });
  }
  function paintSoon() { if (!paintTimer) paintTimer = setTimeout(function () { paintTimer = null; paint(); }, 250); }

  function tile(it) {
    var pct = itemPct(it);
    var isImg = /^image\//.test(it.file.type), isVid = /^video\//.test(it.file.type);
    var media = it.url && isImg ? '<img src="' + esc(it.url) + '" alt="">'
      : it.url && isVid ? '<video src="' + esc(it.url) + (it.url.indexOf('blob:') === 0 ? '#t=0.1' : '') + '" muted playsinline preload="metadata"></video>'
      : '<span class="jb-ph">' + svg(I.photo, 26) + '</span>';
    var st = it.state === 'ready' ? '<span class="jb-ok">' + svg(I.check, 16) + '</span>'
      : it.state === 'failed' ? '<button type="button" class="jb-retry" data-jb="retry" data-key="' + it.key + '">' + svg(I.retry, 16) + 'לנסות שוב</button>'
      : '<span class="jb-pct">' + (it.state === 'starting' ? '…' : it.state === 'finishing' ? '100%' : pct + '%') + '</span>';
    return '<li class="jb-tile ' + it.state + '" data-k="' + it.key + '">' + media +
      (it.state !== 'ready' ? '<span class="jb-bar"><span style="width:' + (it.state === 'failed' ? itemPct(it) : pct) + '%"></span></span>' : '') +
      '<span class="jb-tile-meta">' + st + '<span class="jb-size ltr">' + mb(it.file.size) + '</span></span>' +
      (sent ? '' : '<button type="button" class="jb-x" data-jb="remove" data-key="' + it.key + '" aria-label="להסיר את ' + esc(it.file.name) + '">' + svg(I.x, 14) + '</button>') + '</li>';
  }
  // one quiet line per recording that is not text yet (the audio itself still goes to Claude with the job)
  function voiceLine(it) {
    if (it.state === 'failed') return '<p class="jb-vline">' + svg(I.mic, 15) + '<span>ההקלטה לא עלתה. <button type="button" class="jb-link" data-jb="retry" data-key="' + it.key + '">לנסות שוב</button> · <button type="button" class="jb-link" data-jb="remove" data-key="' + it.key + '">לוותר</button></span></p>';
    if (it.state !== 'ready' || it.tstate === 'pending') return '<p class="jb-vline"><span class="jb-spin" aria-hidden="true"></span><span>מתמללת את ההקלטה…</span></p>';
    if (it.tstate === 'failed') return '<p class="jb-vline">' + svg(I.mic, 15) + '<span>התמלול לא הצליח. <button type="button" class="jb-link" data-jb="retx" data-key="' + it.key + '">לנסות שוב</button> · ההקלטה עצמה תגיע לקלוד</span></p>';
    if (it.tstate === 'later') return '<p class="jb-vline">' + svg(I.mic, 15) + '<span>ההקלטה נשמרה, קלוד יתמלל אותה</span></p>';
    if (it.tstate === 'done' && !it.transcript) return '<p class="jb-vline">' + svg(I.mic, 15) + '<span>לא נשמעו מילים בהקלטה</span></p>';
    return '';
  }

  function paint(full) {
    if (!$dlg) return;
    var media = items.filter(function (x) { return x.role === 'media'; });
    var voices = items.filter(function (x) { return x.role === 'voice'; });
    var b = busy(), tot = totals(), failed = items.filter(function (x) { return x.state === 'failed'; });

    if (sent) {
      var waiting = sent.status === 'queued';
      var html = '<div class="jb-body jb-sent"><div class="jb-sent-badge">' + svg(waiting && b.length ? I.send : I.check, 30) + '</div>' +
        '<h2 id="jb-title">' + (waiting ? 'נשלח לקלוד' : 'קלוד קיבל את המשימה') + '</h2>' +
        (waiting && b.length ? '<p class="muted">עוד ' + (b.length === 1 ? 'קובץ אחד עולה' : b.length + ' קבצים עולים') + ', ' + tot.pct + '%. המשימה תיכנס לתור ברגע שהם יסיימו. כדאי להשאיר את המסך פתוח.</p>' +
          '<div class="jb-total"><span style="width:' + tot.pct + '%"></span></div>'
          : waiting && failed.length ? '<p class="muted">' + (failed.length === 1 ? 'קובץ אחד לא עלה' : failed.length + ' קבצים לא עלו') + '.</p>' +
            '<div class="jb-row"><button type="button" class="btn ghost" data-jb="force">לשלוח בלי ' + (failed.length === 1 ? 'הקובץ הזה' : 'הקבצים האלה') + '</button></div>'
          : '<p class="muted">היא בתור של קלוד. אפשר לעקוב אחריה בעמוד התור של קלוד.</p>') +
        (items.length ? '<ul class="jb-tiles">' + media.map(tile).join('') + '</ul>' : '') +
        '<div class="jb-row"><a class="btn ghost" href="#/queue" data-jb="close">לתור של קלוד</a><button type="button" class="btn" data-jb="new">' + svg(I.plus, 18) + 'משימה חדשה</button></div></div>';
      var sig = 'sent|' + sent.status + '|' + b.length + '|' + failed.length + '|' + media.map(function (x) { return x.key + x.state; }).join();
      if ($dlg.getAttribute('data-sig') !== sig) {
        $dlg.setAttribute('data-sig', sig);
        $dlg.innerHTML = '<div class="jb-grab" aria-hidden="true"></div><button type="button" class="jb-close" data-jb="close" aria-label="לסגור">' + svg(I.x, 20) + '</button>' + html;
      } else {
        updateTiles(media);
        var tb = $dlg.querySelector('.jb-total span'); if (tb) tb.style.width = tot.pct + '%';
        var tp = $dlg.querySelector('.jb-sent p'); if (tp && b.length) tp.textContent = 'עוד ' + (b.length === 1 ? 'קובץ אחד עולה' : b.length + ' קבצים עולים') + ', ' + tot.pct + '%. המשימה תיכנס לתור ברגע שהם יסיימו. כדאי להשאיר את המסך פתוח.';
      }
      paintPill();
      return;
    }

    if (full || !$dlg.querySelector('.jb-compose')) {
      $dlg.removeAttribute('data-sig'); fileSig = voiceSig = null;
      var saved = ''; try { saved = localStorage.getItem('job_text') || ''; } catch (_) {}
      var prev = document.getElementById('jb-text');
      $dlg.innerHTML = '<div class="jb-grab" aria-hidden="true"></div>' +
        '<button type="button" class="jb-close" data-jb="close" aria-label="לסגור">' + svg(I.x, 20) + '</button>' +
        '<div class="jb-body jb-compose">' +
        '<h2 id="jb-title">משימה חדשה לקלוד</h2>' +
        '<p class="muted small jb-lede">מוסיפים קבצים, ובזמן שהם עולים כותבים או מקליטים מה לעשות איתם</p>' +
        '<button type="button" class="jb-pick" data-jb="pick">' + svg(I.photo, 24) + '<span><strong>להוסיף תמונות וסרטונים</strong><span class="small muted">מהגלריה או מהקבצים, כמה שרוצים</span></span></button>' +
        '<div data-jb-files></div>' +
        '<label class="jb-label" for="jb-text">מה לעשות עם זה</label>' +
        '<textarea id="jb-text" rows="3" placeholder="למשל: את הסטוריז להעלות היום בערב, ואת הסרטון לערוך לרילס של דקה"></textarea>' +
        '<div data-jb-voice></div>' +
        '<div data-jb-foot></div></div>';
      var ta = document.getElementById('jb-text');
      ta.value = prev ? prev.value : saved;
    }
    var fhead = media.length ? '<span>' + (media.length === 1 ? 'קובץ אחד' : media.length + ' קבצים') + ' · <span class="ltr">' + mb(media.reduce(function (s, x) { return s + x.file.size; }, 0)) + '</span></span>' +
        (b.length ? '<span class="muted">עולה, ' + tot.pct + '%</span>' : failed.length ? '<span class="jb-warn">' + failed.length + ' לא עלו</span>' : '<span class="jb-okt">הכול עלה</span>') : '';
    var fs = media.map(function (x) { return x.key + x.state; }).join();
    if (fs !== fileSig) {
      fileSig = fs;
      $dlg.querySelector('[data-jb-files]').innerHTML = media.length ? '<div class="jb-files-head">' + fhead + '</div><ul class="jb-tiles">' + media.map(tile).join('') + '</ul>' : '';
    } else if (media.length) { $dlg.querySelector('.jb-files-head').innerHTML = fhead; updateTiles(media); }
    var vs = (rec ? 'rec' : '') + voices.map(function (x) { return x.key + x.state + x.tstate + (x.transcript || '').length; }).join();
    if (vs !== voiceSig) { voiceSig = vs; $dlg.querySelector('[data-jb-voice]').innerHTML =
      voices.map(voiceLine).join('') +
      (rec ? '<div class="jb-rec on"><button type="button" class="jb-mic stop" data-jb="stop" aria-label="לעצור את ההקלטה"><span class="jb-rec-ring" aria-hidden="true"></span>' + svg(I.stop, 26) + '</button>' +
          '<div><strong>מקליטה</strong> <span class="jb-rec-time ltr">0:00</span><div class="small muted">מדברים חופשי, ולוחצים לעצור</div></div></div>'
        : '<div class="jb-rec"><button type="button" class="jb-mic" data-jb="rec" aria-label="להקליט הודעה קולית">' + svg(I.mic, 26) + '</button>' +
          '<div><strong>' + (voices.length ? 'להקליט עוד' : 'להקליט במקום לכתוב') + '</strong><div class="small muted">מה שאומרים ייכתב בתיבה, ואפשר לתקן</div></div></div>'); }
    var vp = voicePending().length;
    var can = !sending && !vp && (items.length || textValue());
    $dlg.querySelector('[data-jb-foot]').innerHTML =
      '<button type="button" class="btn big block jb-send" data-jb="send"' + (can ? '' : ' disabled') + '>' + svg(I.send, 20) +
      (sending ? 'שולחת…' : vp ? 'מחכה לתמלול…' : b.filter(function (x) { return x.role === 'media'; }).length ? 'לשלוח, הקבצים ימשיכו לעלות' : 'לשלוח לקלוד') + '</button>' +
      (b.length ? '<p class="small muted jb-note">כדאי להשאיר את המסך פתוח עד שההעלאה מסתיימת</p>' : '') +
      (items.length || job ? '<button type="button" class="jb-link jb-cancel" data-jb="cancel">לבטל את המשימה</button>' : '');
    paintPill();
  }

  function paintPill() {
    if (!$pill) return;
    var b = busy();
    var show = user && b.length && !($dlg && $dlg.open);
    $pill.hidden = !show;
    if (show) $pill.innerHTML = '<span class="jb-spin" aria-hidden="true"></span>' + (b.length === 1 ? 'קובץ אחד עולה' : b.length + ' קבצים עולים') + ' · ' + totals().pct + '%';
  }
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'jb-text') { var s = $dlg && $dlg.querySelector('.jb-send'); if (s) s.disabled = sending || voicePending().length > 0 || !(items.length || e.target.value.trim()); } });

  /* ---------------- jobs list (התור של קלוד, היום) ---------------- */
  function fmtWhen(v) {
    var t = Date.parse(String(v || '').replace(' ', 'T') + 'Z'); if (isNaN(t)) return '';
    var d = new Date(t), days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    return 'יום ' + days[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + ', ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function jobCard(j) {
    var st = STATUS[j.status] || { label: j.status, cls: '' };
    var media = j.files.filter(function (f) { return f.role === 'media'; });
    var voices = j.files.filter(function (f) { return f.role === 'voice'; });
    var thumbs = media.slice(0, 6).map(function (f) {
      var img = /^image\//.test(f.content_type) && f.state === 'ready';
      var vid = /^video\//.test(f.content_type) && f.state === 'ready';
      return '<span class="jl-th">' + (img ? '<img src="' + esc(f.url) + '" alt="" loading="lazy">' : vid ? '<video src="' + esc(f.url) + '#t=0.1" muted playsinline preload="metadata"></video>' : svg(I.photo, 18)) + '</span>';
    }).join('') + (media.length > 6 ? '<span class="jl-th more">+' + (media.length - 6) + '</span>' : '');
    var tx = voices.filter(function (v) { return !(v.transcript && (j.text || '').indexOf(v.transcript.trim()) >= 0); }).map(function (v) { return v.transcript ? '<p class="jl-voice">' + svg(I.mic, 14) + '<span>' + esc(v.transcript) + '</span></p>' : '<p class="jl-voice muted">' + svg(I.mic, 14) + '<span>הודעה קולית' + (v.transcript_state === 'pending' ? ', עוד לא תומללה' : '') + '</span></p>'; }).join('');
    return '<li class="jl-card ' + esc(j.status) + '"><div class="jl-head"><span class="tag ' + st.cls + '">' + st.label + '</span><span class="small muted">' + fmtWhen(j.sent_at || j.created_at) + '</span></div>' +
      (j.text ? '<p class="jl-text">' + esc(j.text) + '</p>' : '') + tx +
      (media.length ? '<div class="jl-thumbs">' + thumbs + '</div>' : '') +
      (j.status_note ? '<div class="claude-note jl-note"><strong>קלוד:</strong> <span>' + esc(j.status_note) + '</span></div>' : '') + '</li>';
  }
  var lists = [];
  function renderList(el, opts) {
    if (!el || !user) return;
    opts = opts || {};
    lists = lists.filter(function (x) { return document.body.contains(x.el); });
    if (!lists.some(function (x) { return x.el === el; })) lists.push({ el: el, opts: opts });
    api('GET', '/api/jobs').then(function (r) {
      var jobs = r.jobs || [];
      if (opts.compact) jobs = jobs.filter(function (j) { return j.status !== 'done' || Date.now() - Date.parse(String(j.done_at || j.updated_at).replace(' ', 'T') + 'Z') < 2 * 86400000; }).slice(0, 3);
      if (!jobs.length && opts.compact) { el.innerHTML = ''; return; }
      el.innerHTML = '<section class="card jl" aria-labelledby="h-jobs-' + (opts.compact ? 'c' : 'q') + '"><div class="section-head"><h2 id="h-jobs-' + (opts.compact ? 'c' : 'q') + '">המשימות שנתתי לקלוד</h2>' +
        (opts.compact ? '<a class="small" href="#/queue">לכל המשימות</a>' : '<button type="button" class="btn ghost jl-new" data-jb-open>' + svg(I.plus, 16) + 'משימה חדשה</button>') + '</div>' +
        (jobs.length ? '<ul class="jl-list">' + jobs.map(jobCard).join('') + '</ul>'
          : '<div class="empty">עוד אין משימות. לוחצים על הפלוס, מוסיפים קבצים ומספרים לקלוד מה לעשות.</div>') + '</section>';
    }).catch(function () { el.innerHTML = ''; });
  }
  function refreshLists() { lists.forEach(function (x) { if (document.body.contains(x.el)) renderList(x.el, x.opts); }); }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-jb-open]')) open(); });
  setInterval(function () { if (document.visibilityState === 'visible' && user && lists.length) refreshLists(); }, 30000);

  /* ---------------- public ---------------- */
  window.JobsUI = {
    show: function (u) {
      user = u && u.role === 'owner' ? u : null;
      if (!user) return this.hide();
      build(); $fab.hidden = false; paintPill();
    },
    hide: function () { user = null; if ($fab) { $fab.hidden = true; $pill.hidden = true; } if ($dlg && $dlg.open) $dlg.close(); },
    open: open,
    renderList: renderList
  };
})();
