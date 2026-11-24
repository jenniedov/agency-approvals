/* End-client approval page, served at /c/<token>. No login. API: GET /api/c/<token>, POST .../posts/<id>/approve|comment */
(function () {
  'use strict';
  var MOCK = new URLSearchParams(location.search).has('mock');
  var $app = document.getElementById('app');
  var m = location.pathname.match(/\/c\/([^/?#]+)/);
  var token = m ? decodeURIComponent(m[1]) : (MOCK ? 'mock-token' : '');
  var data = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    return /^(https?:)?\/\//i.test(u) || u.charAt(0) === '/' || /^data:image\//i.test(u) ? esc(u) : '';
  }
  function parseTime(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    var s = String(v);
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    return Date.parse(s);
  }
  var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtWhen(v) {
    var t = parseTime(v); if (isNaN(t)) return '';
    var d = new Date(t);
    return 'יום ' + DAYS[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtSec(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); }

  var KIND = { reel: 'ריל', story: 'סטורי', short: 'סרטון קצר', long: 'סרטון ארוך', post: 'פוסט' };
  var NET = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב', linkedin: 'לינקדאין', threads: 'שרשורים' };
  function where(p) {
    var plats = p.platforms;
    if (typeof plats === 'string') { try { plats = JSON.parse(plats); } catch (_) { plats = null; } }
    var kind = KIND[p.kind] || 'סרטון';
    if (Array.isArray(plats) && plats.length) {
      var names = plats.map(function (x) { return NET[String(x).toLowerCase()] || ''; }).filter(Boolean);
      if (names.length) return kind + ' ב' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' ו' + names[names.length - 1] : names[0]);
    }
    return kind;
  }

  var ERR = {
    network: 'אין חיבור לאינטרנט כרגע. אפשר לנסות שוב בעוד רגע',
    not_found: 'הקישור הזה לא פעיל. כדאי לבקש מהסוכנות קישור חדש',
    empty: 'צריך לכתוב משהו לפני ששולחים',
    too_many_tries: 'נשלחו הרבה בקשות. כדאי לחכות דקה ולנסות שוב'
  };
  function errText(e) {
    if (e && ERR[e.code]) return ERR[e.code];
    if (e && e.status >= 500) return 'משהו השתבש אצלנו. אפשר לנסות שוב בעוד רגע';
    return 'משהו השתבש. אפשר לנסות שוב';
  }

  function api(method, path, body) {
    if (MOCK) return mockApi(method, path, body);
    var opt = { method: method, headers: { accept: 'application/json' }, credentials: 'omit' };
    if (method !== 'GET') { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'http'); e.code = d.error; e.status = r.status; throw e; }
        return d;
      });
    }, function () { var e = new Error('network'); e.code = 'network'; throw e; });
  }
  function base() { return '/api/c/' + encodeURIComponent(token); }

  var ICON_CHECK = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>';
  var ICON_LOCK = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>';

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function showFatal(msg, retry) {
    $app.innerHTML = '<div class="empty" role="alert"><h1 style="font-size:22px">' + esc(msg) + '</h1>' +
      (retry ? '<button type="button" class="btn ghost" id="retry" style="max-width:240px">לנסות שוב</button>' : '') + '</div>';
    if (retry) document.getElementById('retry').onclick = load;
  }

  function postCard(p, i, total) {
    var v = p.version || {};
    var srcs = (v.mp4 || []).map(safeUrl).filter(Boolean);
    var poster = safeUrl(v.thumb || p.cover_url);
    var orient = p.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    var when = p.scheduled_at ? fmtWhen(p.scheduled_at) : 'עוד לא נקבע, הסוכנות תעדכן';
    var prev = (p.comments || []).filter(function (c) { return c.author_kind === 'client' || !c.author_kind; });
    var id = esc(p.id);
    return '<article class="post" id="post-' + id + '" aria-labelledby="t-' + id + '">' +
      (total > 1 ? '<div class="post-num">סרטון ' + (i + 1) + ' מתוך ' + total + '</div>' : '') +
      '<div class="body" style="padding-bottom:12px"><h2 id="t-' + id + '" style="font-size:19px">' + esc(p.title) + '</h2></div>' +
      '<div class="player ' + orient + '">' +
      (srcs.length ? '<video controls playsinline preload="metadata"' + (poster ? ' poster="' + poster + '"' : '') + ' data-video aria-label="' + esc(p.title) + '">' +
        srcs.map(function (s) { return '<source src="' + s + '" type="video/mp4">'; }).join('') +
        'הדפדפן לא מצליח לנגן את הסרטון.</video>'
        : '<div class="no-video">הסרטון עוד מתעבד. אפשר לרענן את הדף בעוד כמה דקות.</div>') +
      '</div>' +
      '<div class="body">' +
      '<div class="facts"><div class="fact"><span class="k">מתי זה עולה</span><span class="v">' + esc(when) + '</span></div>' +
      '<div class="fact"><span class="k">איפה</span><span class="v">' + esc(where(p)) + '</span></div>' +
      (v.duration ? '<div class="fact"><span class="k">אורך</span><span class="v ltr" style="text-align:right">' + fmtSec(v.duration) + '</span></div>' : '') + '</div>' +
      (p.caption ? '<section style="display:flex;flex-direction:column;gap:6px"><h3 class="caption-h">הכיתוב שיעלה עם הסרטון</h3><div class="caption">' + esc(p.caption) + '</div></section>' : '') +
      (prev.length ? '<div class="prev"><span class="muted">מה כבר כתבת על הסרטון הזה</span><ul>' + prev.map(function (c) {
        return '<li>' + (c.at_sec != null ? '<span class="ltr muted">' + fmtSec(c.at_sec) + '</span> · ' : '') + esc(c.body) + '</li>';
      }).join('') + '</ul></div>' : '') +
      '<div data-state></div>' +
      '<div class="actions" data-actions>' +
      '<button type="button" class="btn approve" data-approve="' + id + '">' + ICON_CHECK + 'מאושר, אפשר להעלות</button>' +
      '</div>' +
      '<form class="note" data-note="' + id + '" novalidate>' +
      '<label for="n-' + id + '">רוצה לשנות משהו?</label>' +
      '<textarea id="n-' + id + '" name="body" rows="3" placeholder="אפשר לכתוב כאן בחופשיות, במילים שלך"></textarea>' +
      (srcs.length ? '<label class="check"><input type="checkbox" name="at"> <span>בשנייה שהסרטון עומד עליה עכשיו <span class="ltr" data-sec>(0:00)</span></span></label>' : '') +
      '<div class="err" role="alert" hidden></div>' +
      '<button type="submit" class="btn ghost">לשלוח את ההערה</button>' +
      '</form>' +
      '</div></article>';
  }

  function render() {
    var brand = (data.brand && data.brand.name) || 'הסוכנות';
    var c = data.client || {};
    document.title = c.name ? 'אישור סרטונים · ' + c.name : 'אישור סרטונים';
    var pending = (data.posts || []).filter(function (p) { return p.client_state === 'pending'; });
    var approved = (data.posts || []).filter(function (p) { return p.client_state === 'approved'; });
    var av = safeUrl(c.avatar);
    var html = '<header class="top"><div class="who">' + (av ? '<img src="' + av + '" alt="">' : '<span class="ini" aria-hidden="true">' + esc(String(c.name || '?').charAt(0)) + '</span>') +
      '<span>' + esc(brand) + ' · ' + esc(c.name || '') + '</span></div>' +
      '<h1>' + (pending.length === 0 ? 'אין כרגע משהו שמחכה לך' : pending.length === 1 ? 'סרטון חדש מחכה לאישור שלך' : pending.length + ' סרטונים מחכים לאישור שלך') + '</h1></header>';
    html += '<div class="calm">' + ICON_LOCK + '<span>בלי הרשמה ובלי סיסמה. התשובה שלך מגיעה ישר לסוכנות.</span></div>';
    if (pending.length) {
      html += pending.map(function (p, i) { return postCard(p, i, pending.length); }).join('');
    } else {
      html += '<div class="empty">' + ICON_CHECK + '<strong>הכל אצלך מטופל</strong><span class="muted">כשיהיה סרטון חדש, הסוכנות תשלח לך את הקישור הזה שוב. אפשר לשמור אותו.</span></div>';
    }
    if (approved.length) {
      html += '<details class="history"><summary>מה כבר אישרת (' + approved.length + ')</summary><ul class="hist">' + approved.slice(0, 10).map(function (p) {
        var th = safeUrl((p.version && p.version.thumb) || p.cover_url);
        return '<li>' + (th ? '<img src="' + th + '" alt="" loading="lazy">' : '<span class="ph"></span>') +
          '<div class="t"><div>' + esc(p.title) + '</div><div class="small muted">' + esc(p.scheduled_at ? 'עולה ' + fmtWhen(p.scheduled_at) : where(p)) + '</div></div>' +
          '<span class="tag-ok">אישרת</span></li>';
      }).join('') + '</ul></details>';
    }
    html += '<p class="foot">' + esc(brand) + '</p>';
    $app.innerHTML = html;
    bind();
  }

  function bind() {
    $app.querySelectorAll('video[data-video]').forEach(function (v) {
      var card = v.closest('.post'); var lab = card.querySelector('[data-sec]');
      if (lab) v.addEventListener('timeupdate', function () { lab.textContent = '(' + fmtSec(v.currentTime) + ')'; });
    });
    $app.querySelectorAll('[data-approve]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-approve'), card = b.closest('.post');
        b.disabled = true; b.lastChild.textContent = 'שולחת…';
        api('POST', base() + '/posts/' + encodeURIComponent(id) + '/approve', {}).then(function () {
          card.querySelector('[data-actions]').hidden = true;
          card.querySelector('[data-note]').hidden = true;
          card.querySelector('[data-state]').innerHTML = '<div class="done" role="status">' + ICON_CHECK + '<span>תודה! אישרת את הסרטון והסוכנות כבר יודעת. אין צורך לעשות שום דבר נוסף.</span></div>';
          var v = card.querySelector('video'); if (v) v.pause();
          toast('האישור נשלח');
          card.setAttribute('data-done', '1');
          var left = $app.querySelectorAll('.post:not([data-done])').length, h = $app.querySelector('header h1');
          if (h) h.textContent = left === 0 ? 'אישרת הכל, תודה' : left === 1 ? 'עוד סרטון אחד מחכה לך' : 'עוד ' + left + ' סרטונים מחכים לך';
        }).catch(function (e) {
          b.disabled = false; b.lastChild.textContent = 'מאושר, אפשר להעלות';
          card.querySelector('[data-state]').innerHTML = '<div class="err" role="alert">' + esc(errText(e)) + '</div>';
        });
      });
    });
    $app.querySelectorAll('form[data-note]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var id = f.getAttribute('data-note'), card = f.closest('.post');
        var err = f.querySelector('.err'), text = f.body.value.trim();
        if (!text) { err.textContent = ERR.empty; err.hidden = false; f.body.focus(); return; }
        err.hidden = true;
        var body = { body: text, target: 'video' };
        var v = card.querySelector('video');
        if (f.at && f.at.checked && v) body.at_sec = Math.round(v.currentTime * 10) / 10;
        var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'שולחת…';
        api('POST', base() + '/posts/' + encodeURIComponent(id) + '/comment', body).then(function () {
          var prev = card.querySelector('.prev ul');
          var li = '<li>' + (body.at_sec != null ? '<span class="ltr muted">' + fmtSec(body.at_sec) + '</span> · ' : '') + esc(text) + '</li>';
          if (prev) prev.insertAdjacentHTML('beforeend', li);
          else card.querySelector('[data-state]').insertAdjacentHTML('beforebegin', '<div class="prev"><span class="muted">מה כבר כתבת על הסרטון הזה</span><ul>' + li + '</ul></div>');
          card.querySelector('[data-state]').innerHTML = '<div class="done" role="status">' + ICON_CHECK + '<span>ההערה נשלחה לסוכנות. הם יתקנו וישלחו לך גרסה חדשה. אפשר להוסיף עוד הערות.</span></div>';
          f.reset(); toast('ההערה נשלחה');
        }).catch(function (e) { err.textContent = errText(e); err.hidden = false; })
          .then(function () { btn.disabled = false; btn.textContent = 'לשלוח את ההערה'; });
      });
    });
  }

  function load() {
    if (!token) { showFatal('הקישור לא שלם. כדאי לפתוח אותו שוב מההודעה של הסוכנות'); return; }
    api('GET', base()).then(function (d) { data = d; render(); })
      .catch(function (e) { showFatal(errText(e), e.code !== 'not_found'); });
  }

  /* mock (only with ?mock=1) */
  function mockApi(method, path) {
    return new Promise(function (res) {
      setTimeout(function () {
        if (method !== 'GET') return res({ ok: true });
        var now = Date.now();
        res({
          brand: { name: 'סטודיו לדוגמה' }, client: { id: 'nona', name: 'ביסטרו נונה', avatar: '', handle: 'bistro.nona' },
          posts: [
            { id: 1, title: 'ריל: מנת השף של השבוע', kind: 'reel', orientation: 'vertical', client_state: 'pending', platforms: '["instagram","facebook"]', scheduled_at: new Date(now + 2 * 864e5).toISOString(),
              caption: 'השבוע אצלנו: ניוקי ערמונים בחמאה חומה.\nהשף מכין אותו רק עד יום שבת, ואז הוא יורד מהתפריט.\n\nלהזמנת שולחן: הקישור בפרופיל', version: { n: 2, duration: 42, mp4: ['/demo/demo-1.mp4'], thumb: '/demo/demo-1.jpg' }, comments: [] },
            { id: 2, title: 'סרטון: סיור במטבח', kind: 'long', orientation: 'horizontal', client_state: 'pending', scheduled_at: null, caption: '', version: { n: 1, duration: 95, mp4: [], thumb: '' }, comments: [{ body: 'אפשר להתחיל מהתנור?', at_sec: 3, author_kind: 'client' }] },
            { id: 3, title: 'ריל: ערב ג׳אז', kind: 'reel', client_state: 'approved', scheduled_at: new Date(now - 864e5).toISOString(), version: { thumb: '' } }
          ]
        });
      }, 200);
    });
  }

  load();
})();
