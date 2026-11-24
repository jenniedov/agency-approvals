/* Team screens: hash-routed single page. Plain JS, no build step.
   Routes: #/setup #/login #/ #/clients #/client/<id> #/schedule #/queue #/settings
   API contract: docs/API.md */
(function () {
  'use strict';

  var MOCK = new URLSearchParams(location.search).has('mock');
  var $main = document.getElementById('main');
  var $solo = document.getElementById('solo');
  var $shell = document.getElementById('shell');

  var state = { session: null, overview: null, settings: null, setup: null, weekOffset: 0 };

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (/^(https?:)?\/\//i.test(u) || u.charAt(0) === '/' || /^data:image\//i.test(u)) return esc(u);
    return '';
  }
  function parseTime(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    var s = String(v);
    if (/^\d+$/.test(s)) return parseTime(Number(s));
    // SQLite "YYYY-MM-DD HH:MM:SS" is UTC
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    return Date.parse(s);
  }
  var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dm(d) { return d.getDate() + '.' + (d.getMonth() + 1); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtWhen(v) {
    var t = parseTime(v); if (isNaN(t)) return '';
    var d = new Date(t);
    return DAYS[d.getDay()] + ' ' + dm(d) + ', ' + hm(d);
  }
  function plural(n, one, two, many) { return n === 1 ? one : n === 2 && two ? two : n + ' ' + many; }
  function fmtAgo(v) {
    var t = parseTime(v); if (isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'רגע';
    if (m < 60) return plural(m, 'דקה', 'שתי דקות', 'דקות');
    var h = Math.round(m / 60);
    if (h < 24) return plural(h, 'שעה', 'שעתיים', 'שעות');
    var dd = Math.round(h / 24);
    return plural(dd, 'יום', 'יומיים', 'ימים');
  }
  function fmtLen(sec) {
    if (!sec && sec !== 0) return '';
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + pad(sec % 60);
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function hashQuery() {
    var i = location.hash.indexOf('?');
    return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
  }
  function thumbOf(p) { return (p.version && p.version.thumb) || p.cover_url || ''; }
  function isWide(p) { return p.orientation === 'horizontal'; }
  function foryou(id) { return '/foryou' + (id != null ? '?post=' + encodeURIComponent(id) : ''); }
  function machineInfo(m) {
    if (!m || !m.last_seen) return { on: false, text: 'המחשב לא מחובר', sub: 'קלוד עוד לא התחבר מהמחשב' };
    var t = parseTime(m.last_seen);
    var on = !isNaN(t) && Date.now() - t < 15 * 60000;
    return { on: on, text: on ? 'המחשב מחובר' : 'המחשב לא מחובר', sub: 'נראה לפני ' + fmtAgo(m.last_seen), detail: m.detail || '' };
  }

  var ERR = {
    network: 'אין חיבור לשרת. כדאי לבדוק את האינטרנט ולנסות שוב',
    bad_credentials: 'האימייל או הסיסמה לא נכונים', invalid_credentials: 'האימייל או הסיסמה לא נכונים',
    wrong_password: 'האימייל או הסיסמה לא נכונים', bad_login: 'האימייל או הסיסמה לא נכונים',
    login: 'צריך להתחבר מחדש', too_many_tries: 'יותר מדי ניסיונות. כדאי לחכות כמה דקות ולנסות שוב',
    already_set_up: 'המערכת כבר הוגדרה. אפשר להתחבר', bad_owner: 'צריך שם, אימייל תקין וסיסמה של לפחות 8 תווים', latin_only: 'שם, אימייל וסיסמה באותיות באנגלית בלבד',
    bunny_key: 'המפתח של Bunny לא עבד. כדאי להעתיק אותו שוב, בלי רווחים', name: 'צריך לכתוב שם ללקוח',
    json_only: 'הבקשה לא נשלחה כמו שצריך. כדאי לרענן את הדף', empty: 'אי אפשר לשלוח הערה ריקה',
    unauthorized: 'צריך להתחבר מחדש', not_logged_in: 'צריך להתחבר מחדש',
    forbidden: 'אין לך הרשאה לפעולה הזו', owner_only: 'רק בעלת החשבון יכולה לשנות את זה',
    not_found: 'לא מצאנו את מה שחיפשת',
    setup_code: 'קוד ההתקנה לא נכון. כדאי לפתוח שוב את הקישור שקיבלת בהתקנה',
    setup_done: 'המערכת כבר הוגדרה. אפשר להתחבר', already_setup: 'המערכת כבר הוגדרה. אפשר להתחבר',
    too_many: 'יותר מדי ניסיונות. כדאי לחכות כמה דקות ולנסות שוב', rate_limited: 'יותר מדי ניסיונות. כדאי לחכות כמה דקות ולנסות שוב',
    email_taken: 'האימייל הזה כבר רשום', weak_password: 'הסיסמה קצרה מדי. צריך לפחות 8 תווים',
    missing_fields: 'חסרים פרטים בטופס', bad_request: 'חסרים פרטים בטופס', invalid: 'אחד הפרטים לא תקין',
    bunny_key_invalid: 'מפתח הסרטונים לא עובד. כדאי להעתיק אותו שוב', bunny_error: 'לא הצלחנו להתחבר לחשבון הסרטונים. כדאי לבדוק את המפתח',
    elevenlabs_key_invalid: 'מפתח התמלול לא עובד. כדאי להעתיק אותו שוב'
  };
  function errText(e) {
    var code = e && (e.code || e.message);
    if (ERR[code]) return ERR[code];
    if (code && /bunny/i.test(code)) return ERR.bunny_error;
    if (e && e.status >= 500) return 'משהו השתבש בשרת. אפשר לנסות שוב בעוד רגע';
    return 'משהו השתבש. אפשר לנסות שוב';
  }

  /* ---------------- api ---------------- */
  function api(method, path, body) {
    if (MOCK) return mockApi(method, path, body);
    var opt = { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (method !== 'GET') { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body === undefined ? {} : body); }
    return fetch(path, opt).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { error: 'bad_json' }; }
        if (!r.ok) {
          var err = new Error((data && data.error) || 'http_' + r.status);
          err.code = data && data.error; err.status = r.status;
          if (r.status === 401 && path.indexOf('/api/login') < 0 && path.indexOf('/api/session') < 0) {
            state.session && (state.session.user = null);
            setTimeout(function () { location.hash = '#/login'; }, 0);
          }
          throw err;
        }
        return data;
      });
    }, function () { var e = new Error('network'); e.code = 'network'; throw e; });
  }

  // Posts for many clients (the board / schedule / queue need every stage)
  function loadAllPosts() {
    return Promise.all([api('GET', '/api/clients'), api('GET', '/api/posts')]).then(function (r) {
      return { clients: r[0].clients || [], posts: r[1].posts || [] };
    });
  }

  function refreshOverview() {
    return api('GET', '/api/overview').then(function (ov) {
      state.overview = ov;
      if (ov.brand) state.session.brand = ov.brand;
      paintChrome();
      return ov;
    });
  }

  /* ---------------- icons ---------------- */
  function icon(name) {
    var p = {
      today: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
      clients: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3.2 2.7-4.8 5.5-4.8s4.9 1.6 5.5 4.8M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.6c1.7.6 2.7 2 3 4.4"/>',
      foryou: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="m10.5 9 4 3-4 3z"/>',
      schedule: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3.5v3M15.5 3.5v3"/>',
      queue: '<rect x="4" y="4.5" width="16" height="4" rx="2"/><rect x="4" y="10.5" width="16" height="4" rx="2"/><path d="M6 18.5h12"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
      eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      arrow: '<path d="M15 6l-6 6 6 6"/>',
      next: '<path d="M9 6l6 6-6 6"/>'
    }[name] || '';
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }

  /* ---------------- chrome (nav, bell, machine) ---------------- */
  var NAV = [
    { id: 'today', href: '#/', label: 'היום', short: 'היום' },
    { id: 'clients', href: '#/clients', label: 'לקוחות', short: 'לקוחות' },
    { id: 'foryou', href: '/foryou', label: 'לאישור', short: 'לאישור' },
    { id: 'schedule', href: '#/schedule', label: 'לוח פרסומים', short: 'לוח' },
    { id: 'queue', href: '#/queue', label: 'התור של קלוד', short: 'תור' },
    { id: 'settings', href: '#/settings', label: 'הגדרות', short: 'הגדרות' }
  ];
  var current = { nav: 'today', clientId: null };

  function reviewCount() {
    var ov = state.overview; if (!ov || !ov.clients) return 0;
    return ov.clients.reduce(function (s, c) { return s + ((c.counts && c.counts.review) || 0); }, 0);
  }

  function paintChrome() {
    var brand = (state.session && state.session.brand && state.session.brand.name) || 'הסוכנות';
    document.querySelectorAll('[data-brand]').forEach(function (el) { el.textContent = brand; });
    document.title = brand;
    var rc = reviewCount();
    var badge = function (n) { return n ? '<span class="badge" aria-label="' + n + ' מחכים">' + n + '</span>' : ''; };
    document.querySelector('[data-nav]').innerHTML = NAV.map(function (n) {
      return '<a class="nav-item" href="' + n.href + '"' + (current.nav === n.id ? ' aria-current="page"' : '') + '>' +
        icon(n.id) + '<span>' + n.label + '</span>' + (n.id === 'foryou' ? badge(rc) : '') + '</a>';
    }).join('');
    document.querySelector('[data-tabbar]').innerHTML = NAV.map(function (n) {
      return '<a class="tab" href="' + n.href + '"' + (current.nav === n.id ? ' aria-current="page"' : '') + ' aria-label="' + n.label + '">' +
        icon(n.id) + '<span aria-hidden="true">' + n.short + '</span>' + (n.id === 'foryou' ? badge(rc) : '') + '</a>';
    }).join('');

    var ov = state.overview;
    var sc = document.querySelector('[data-side-clients]');
    if (ov && ov.clients && ov.clients.length) {
      sc.innerHTML = '<div class="side-label">הלקוחות שלי</div>' + ov.clients.map(function (c) {
        var n = c.counts ? (c.counts.review || 0) + (c.counts.client || 0) + (c.counts.changes || 0) : 0;
        return '<a class="side-client" href="#/client/' + encodeURIComponent(c.id) + '"' + (current.clientId === String(c.id) ? ' aria-current="page"' : '') + '>' +
          avatar(c, 'sm') + '<span>' + esc(c.name) + '</span>' + (n ? '<span class="count">' + n + '</span>' : '') + '</a>';
      }).join('');
    } else sc.innerHTML = '';

    var mi = machineInfo(ov && ov.machine);
    document.querySelector('[data-machine-box]').innerHTML =
      '<div class="row" style="font-weight:500"><span class="dot ' + (mi.on ? 'on' : 'off') + '"></span>' + mi.text + '</div>' +
      '<div class="muted">' + esc(mi.sub) + '</div>';

    var unread = (ov && ov.unread) || 0;
    var bc = document.getElementById('bell-count');
    bc.hidden = !unread; bc.textContent = unread > 99 ? '99+' : unread;
    document.getElementById('bell').setAttribute('aria-label', unread ? 'התראות, ' + unread + ' חדשות' : 'התראות');
    if (!document.getElementById('notif-panel').hidden) paintNotifs();
  }

  function avatar(c, size) {
    var cls = 'avatar' + (size ? ' ' + size : '');
    var ring = c && c.color && /^#[0-9a-f]{3,8}$/i.test(c.color) ? ' style="box-shadow:0 0 0 2px ' + c.color + '"' : '';
    var src = c && safeUrl(c.avatar);
    if (src) return '<span class="' + cls + '"' + ring + '><img src="' + src + '" alt="" loading="lazy"></span>';
    return '<span class="' + cls + '"' + ring + ' aria-hidden="true">' + esc(String((c && c.name) || '?').trim().charAt(0)) + '</span>';
  }

  function clientName(id, fallback) {
    if (fallback) return fallback;
    var ov = state.overview;
    var c = ov && ov.clients && ov.clients.filter(function (x) { return String(x.id) === String(id); })[0];
    return c ? c.name : '';
  }

  var EV = {
    new_video: function (e) { return 'סרטון חדש מקלוד' + (e.post_title || e.body ? ': ' + (e.post_title || e.body) : ''); },
    new_version: function (e) { return 'גרסה חדשה מוכנה' + (e.post_title || e.body ? ': ' + (e.post_title || e.body) : ''); },
    client_approved: function (e) { return 'הלקוח אישר' + (e.post_title || e.body ? ': ' + (e.post_title || e.body) : ''); },
    client_comment: function (e) { return 'הלקוח כתב' + (e.body ? ': "' + e.body + '"' : ' הערה'); },
    comment: function (e) { return 'הערה חדשה' + (e.body ? ': "' + e.body + '"' : ''); },
    shared: function (e) { return 'נשלח ללקוח לאישור' + (e.post_title ? ': ' + e.post_title : ''); },
    approved: function (e) { return 'אושר ומוכן לתזמון' + (e.post_title ? ': ' + e.post_title : ''); }
  };
  function evHref(e) {
    if ((e.kind === 'new_video' || e.kind === 'new_version') && e.post_id != null) return foryou(e.post_id);
    if (e.kind === 'client_comment' || e.kind === 'comment') return '#/queue';
    if (e.client_id != null) return '#/client/' + encodeURIComponent(e.client_id);
    return '#/';
  }

  function paintNotifs() {
    var panel = document.getElementById('notif-panel');
    var ov = state.overview || {};
    var list = ov.notifications || [];
    panel.innerHTML = '<div class="notif-head"><h2>התראות</h2>' +
      (ov.unread ? '<button type="button" class="btn quiet small" data-action="read-all">לסמן הכל כנקרא</button>' : '') + '</div>' +
      (list.length ? '<ul class="notif-list">' + list.map(function (e) {
        var txt = (EV[e.kind] || function () { return e.body || 'עדכון'; })(e);
        var cn = clientName(e.client_id, e.client_name);
        return '<li><a class="notif' + (e.read_at ? '' : ' unread') + '" href="' + evHref(e) + '" data-notif="' + esc(e.id) + '">' +
          '<span class="ndot" aria-hidden="true"></span><span>' +
          (cn ? '<strong>' + esc(cn) + '</strong> · ' : '') + esc(txt) +
          '<br><span class="when">לפני ' + esc(fmtAgo(e.created_at)) + '</span></span></a></li>';
      }).join('') + '</ul>' : '<div class="empty" style="margin:16px;border:0">אין התראות עדיין. כשקלוד יסיים סרטון או לקוח יענה, זה יופיע כאן.</div>');
  }

  function toggleNotifs(open) {
    var panel = document.getElementById('notif-panel');
    var bell = document.getElementById('bell');
    if (open === undefined) open = panel.hidden;
    panel.hidden = !open;
    bell.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) paintNotifs();
  }

  function markRead(ids) {
    var ov = state.overview; if (!ov) return;
    var now = new Date().toISOString();
    (ov.notifications || []).forEach(function (e) {
      if (!e.read_at && (!ids || ids.indexOf(String(e.id)) >= 0)) { e.read_at = now; ov.unread = Math.max(0, (ov.unread || 0) - 1); }
    });
    if (!ids) ov.unread = 0;
    paintChrome();
    api('POST', '/api/notifications/read', ids ? { ids: ids.map(function (x) { return isNaN(+x) ? x : +x; }) } : {}).catch(function () {});
  }

  /* ---------------- toast ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }

  /* ---------------- page helpers ---------------- */
  function loading(blocks) {
    $main.innerHTML = '<div class="sr-only">טוען</div>' + (blocks || [56, 160, 220]).map(function (h) {
      return '<div class="skel" style="height:' + h + 'px"></div>';
    }).join('');
  }
  function showError(e, retry) {
    console.warn(e);
    $main.innerHTML = '<div class="error-box" role="alert"><span>' + esc(errText(e)) + '</span>' +
      '<button type="button" class="btn ghost" data-action="retry">לנסות שוב</button></div>';
    retryFn = retry;
  }
  var retryFn = null;
  var renderToken = 0;
  function guard(token) { return token === renderToken; }

  /* ---------------- page: today ---------------- */
  function pageToday(token) {
    loading([48, 110, 240, 200]);
    Promise.all([refreshOverview(), api('GET', '/api/feed?stage=review')]).then(function (res) {
      if (!guard(token)) return;
      var ov = res[0], feed = res[1];
      var waiting = [];
      (feed.groups || []).forEach(function (g) { (g.posts || []).forEach(function (p) { waiting.push({ p: p, c: g.client }); }); });
      var n = waiting.length;
      var changes = (ov.clients || []).reduce(function (s, c) { return s + ((c.counts && c.counts.changes) || 0); }, 0);
      var now = new Date(), hr = now.getHours();
      var hello = hr < 5 ? 'לילה טוב' : hr < 12 ? 'בוקר טוב' : hr < 17 ? 'צהריים טובים' : hr < 21 ? 'ערב טוב' : 'לילה טוב';
      var name = String((state.session.user && state.session.user.name) || '').trim();
      var sub = changes ? (changes === 1 ? 'סרטון אחד חזר לתיקון אצל קלוד.' : changes + ' סרטונים חזרו לתיקון אצל קלוד.') + ' כל השאר זז לבד.'
        : 'כל השאר זז לבד.';

      var html = '<header class="head"><div class="eyebrow">יום ' + DAYS[now.getDay()] + ', ' + dm(now) + '</div>' +
        '<h1>' + hello + (name ? ', ' + esc(name) : '') + '</h1><p class="muted">' + sub + '</p></header>';

      html += n
        ? '<a class="hero-card" href="/foryou"><div class="hero-row"><div><div class="big">' + (n === 1 ? 'סרטון אחד מחכה לך' : n + ' סרטונים מחכים לך') + '</div>' +
          '<div class="sub">לצפות, להעיר ולאשר ברצף</div></div>' +
          '<div class="hero-num" aria-hidden="true"><span class="n">' + (n < 10 ? '0' + n : n) + '</span><span class="fy">for you</span></div></div>' +
          '<span class="go">להתחיל ' + icon('arrow').replace('<svg', '<svg width="18" height="18"') + '</span></a>'
        : '<div class="hero-card calm"><div><div class="big">אין סרטונים שמחכים לך</div><div class="sub">כשקלוד יסיים סרטון חדש הוא יופיע כאן, ותקבלי התראה בפעמון</div></div></div>';

      if (n) {
        html += '<section class="section" aria-labelledby="h-wait"><div class="section-head"><h2 id="h-wait">מחכה לאישור שלך</h2>' +
          (changes ? '<span class="en-i" aria-label="' + n + ' מתוך ' + (n + changes) + '">' + n + ' of ' + (n + changes) + '</span>' : '') + '</div><div class="thumbs">' +
          waiting.map(function (w) {
            var p = w.p, th = safeUrl(thumbOf(p));
            var meta = p.version ? 'גרסה ' + esc(p.version.n) : '';
            return '<a class="thumb' + (isWide(p) ? ' wide' : '') + '" href="' + foryou(p.id) + '"><div class="frame' + (isWide(p) ? ' wide' : '') + '">' +
              (th ? '<img src="' + th + '" alt="" loading="lazy">' : '<span>אין תמונה עדיין</span>') +
              (p.version && p.version.duration ? '<span class="len">' + fmtLen(p.version.duration) + '</span>' : '') + '</div>' +
              '<div class="t-client">' + esc((w.c && w.c.name) || p.client_name) + (meta ? ' · ' + meta : '') + '</div>' +
              '<div class="t-title">' + esc(p.title) + '</div></a>';
          }).join('') + '</div></section>';
      }

      // clients answered
      var answers = (ov.notifications || []).filter(function (e) { return e.kind === 'client_approved' || e.kind === 'client_comment'; }).slice(0, 5);
      var ansHtml = answers.length ? '<div class="answers">' + answers.map(function (e) {
        var ok = e.kind === 'client_approved';
        var cn = clientName(e.client_id, e.client_name) || 'לקוח';
        var txt = ok ? '<strong>' + esc(cn) + '</strong> אישרו' + (e.post_title || e.body ? ' את ' + esc(e.post_title || e.body) : '')
          : '<strong>' + esc(cn) + '</strong> כתבו' + (e.body ? ': "' + esc(e.body) + '"' : ' הערה') + (e.post_title ? '<div class="small muted">' + esc(e.post_title) + '</div>' : '');
        return '<div class="answer"><span class="tag ' + (ok ? 'ok' : 'fix') + '">' + (ok ? 'אישרו' : 'הערה') + '</span>' +
          '<div class="txt">' + txt + '<div class="small muted">לפני ' + esc(fmtAgo(e.created_at)) + '</div></div>' +
          (ok ? '<a class="link-strong" href="#/schedule' + (e.client_id != null ? '?client=' + encodeURIComponent(e.client_id) : '') + '">לתזמן</a>'
              : '<a class="link-strong" href="#/queue">לתור של קלוד</a>') + '</div>';
      }).join('') + '</div>' : '<div class="empty">עוד אין תשובות מלקוחות. כשלקוח יאשר או יעיר בדף שלו, זה יופיע כאן.</div>';

      var mi = machineInfo(ov.machine);
      var claude = '<div class="row" style="font-weight:700"><span class="dot ' + (mi.on ? 'on' : 'off') + '"></span>' + mi.text + (ov.machine ? ', ' + esc(mi.sub) : '') + '</div>' +
        '<div class="claude-list">' +
        (mi.detail ? '<div class="claude-item"><span class="tag ok">עובד</span><div>' + esc(mi.detail) + '</div></div>' : '') +
        (changes ? '<div class="claude-item"><span class="tag">בתור</span><div>' + (changes === 1 ? 'סרטון אחד מחכה לתיקון' : changes + ' סרטונים מחכים לתיקון') + '</div></div>' : '') +
        (!mi.detail && !changes ? '<div class="muted">אין כרגע תיקונים שמחכים לקלוד</div>' : '') +
        '</div><p class="small muted">קלוד עובד מהמחשב שלך, אז הוא ממשיך רק כשהמחשב דלוק.</p>' +
        '<a class="link-strong" href="#/queue">לתור המלא</a>';

      html += '<div class="cards-2"><section class="card" aria-labelledby="h-ans"><h2 id="h-ans">הלקוחות ענו</h2>' + ansHtml + '</section>' +
        '<section class="card" aria-labelledby="h-cl"><h2 id="h-cl">מה קלוד עושה עכשיו</h2>' + claude + '</section></div>';

      // this week
      var today = startOfDay(now);
      var week = ov.week || [];
      var days = [], anyWeek = false;
      for (var i = 0; i < 7; i++) {
        var d = addDays(today, i);
        var ps = week.filter(function (p) { var t = parseTime(p.scheduled_at); return !isNaN(t) && sameDay(new Date(t), d); });
        if (ps.length) anyWeek = true;
        days.push('<div class="day' + (i === 0 ? ' today' : '') + (ps.length ? '' : ' empty-day') + '"><div class="d-name">' + (i === 0 ? 'היום' : DAYS[d.getDay()]) + '</div>' +
          '<div class="d-date">' + dm(d) + '</div><div class="d-note">' + esc(dayNote(ps)) + '</div></div>');
      }
      html += '<section class="section" aria-labelledby="h-week"><div class="section-head"><h2 id="h-week">עולה השבוע</h2>' +
        '<a class="link-strong" href="#/schedule">ללוח המלא</a></div><div class="week">' + days.join('') + '</div>' +
        (anyWeek ? '' : '<p class="small muted">עוד לא תוזמן כלום לשבוע הקרוב.</p>') + '</section>';

      $main.innerHTML = html;
    }).catch(function (e) { if (guard(token)) showError(e, function () { pageToday(++renderToken); }); });
  }

  function dayNote(ps) {
    if (!ps.length) return '';
    var c = { up: 0, set: 0, client: 0, me: 0 };
    ps.forEach(function (p) {
      if (p.stage === 'published') c.up++;
      else if (p.stage === 'scheduled' || p.stage === 'approved') c.set++;
      else if (p.stage === 'client') c.client++;
      else c.me++;
    });
    var out = [];
    if (c.up) out.push(c.up === 1 ? 'עלה 1' : 'עלו ' + c.up);
    if (c.set) out.push(c.set === 1 ? '1 מתוזמן' : c.set + ' מתוזמנים');
    if (c.client) out.push(c.client + ' מחכה ללקוח');
    if (c.me) out.push(c.me + ' מחכה לך');
    return out.join(' · ');
  }

  /* ---------------- page: clients ---------------- */
  function pageClients(token) {
    loading([48, 140, 140]);
    refreshOverview().then(function (ov) {
      if (!guard(token)) return;
      var cl = ov.clients || [];
      var html = '<header class="head-row"><div class="head"><h1>לקוחות</h1><p class="muted">' +
        (cl.length ? (cl.length === 1 ? 'לקוח אחד' : cl.length + ' לקוחות') + '. כל אחד עם דף אישורים משלו.' : 'עוד אין לקוחות.') + '</p></div>' +
        '<button type="button" class="btn" data-action="add-client">' + icon('plus') + 'להוסיף לקוח</button></header>';
      html += cl.length ? '<div class="client-grid">' + cl.map(function (c) {
        var k = c.counts || {}, tags = [];
        if (k.review) tags.push('<span class="tag me">' + k.review + ' מחכים לך</span>');
        if (k.client) tags.push('<span class="tag client">' + k.client + ' אצל הלקוח</span>');
        if (k.changes) tags.push('<span class="tag fix">' + k.changes + ' בתיקון</span>');
        if (k.approved) tags.push('<span class="tag ok">' + k.approved + ' מאושרים</span>');
        if (!tags.length) tags.push('<span class="tag">אין משהו פתוח</span>');
        return '<a class="client-card" href="#/client/' + encodeURIComponent(c.id) + '"><div class="who">' + avatar(c, 'lg') +
          '<div><div class="name">' + esc(c.name) + '</div>' + (c.handle ? '<div class="handle ltr">@' + esc(String(c.handle).replace(/^@/, '')) + '</div>' : '') + '</div></div>' +
          '<div class="counts">' + tags.join('') + '</div></a>';
      }).join('') + '</div>'
        : '<div class="empty"><strong>מתחילים מהלקוח הראשון</strong><span>מוסיפים שם וקישור לפרופיל, וקלוד ימלא את השאר.</span>' +
          '<button type="button" class="btn" data-action="add-client">' + icon('plus') + 'להוסיף לקוח</button></div>';
      $main.innerHTML = html;
    }).catch(function (e) { if (guard(token)) showError(e, function () { pageClients(++renderToken); }); });
  }

  function handleFromUrl(u) {
    var m = String(u || '').match(/(?:instagram\.com|tiktok\.com|threads\.net)\/@?([A-Za-z0-9._]+)/i);
    return m ? m[1] : '';
  }

  function openAddClient() {
    var dlg = document.getElementById('add-client-dlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'add-client-dlg'; dlg.className = 'sheet';
      dlg.setAttribute('aria-labelledby', 'ac-title');
      dlg.innerHTML = '<form class="form" method="dialog" novalidate>' +
        '<h2 id="ac-title">לקוח חדש</h2>' +
        '<div class="field"><label for="ac-name">שם הלקוח</label><input class="input" id="ac-name" name="name" required autocomplete="off" placeholder="למשל: ביסטרו נונה"></div>' +
        '<div class="field"><label for="ac-url">קישור לאינסטגרם או לטיקטוק</label><input class="input" id="ac-url" name="profile_url" type="url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://instagram.com/..."></div>' +
        '<div class="field"><label for="ac-handle">שם המשתמש</label><input class="input" id="ac-handle" name="handle" dir="ltr" autocomplete="off" placeholder="@name"><span class="hint">אם יש קישור, ממלאים את זה לבד</span></div>' +
        '<div class="claude-note"><span aria-hidden="true">✦</span><span>קלוד יכול למלא את השאר לבד: תמונת פרופיל, ביו</span></div>' +
        '<div class="form-error" role="alert" hidden></div>' +
        '<div class="form-actions"><button type="submit" class="btn" value="save">להוסיף</button><button type="button" class="btn ghost" data-close>ביטול</button></div>' +
        '</form>';
      document.body.appendChild(dlg);
      var f = dlg.querySelector('form');
      f.profile_url.addEventListener('input', function () {
        if (!f.handle.dataset.touched) f.handle.value = handleFromUrl(f.profile_url.value) ? '@' + handleFromUrl(f.profile_url.value) : '';
      });
      f.handle.addEventListener('input', function () { f.handle.dataset.touched = '1'; });
      dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
      dlg.addEventListener('click', function (ev) { if (ev.target === dlg) dlg.close(); });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var errEl = f.querySelector('.form-error');
        var name = f.name.value.trim();
        if (!name) { f.name.setAttribute('aria-invalid', 'true'); errEl.textContent = 'צריך לכתוב שם ללקוח'; errEl.hidden = false; f.name.focus(); return; }
        f.name.removeAttribute('aria-invalid'); errEl.hidden = true;
        var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'מוסיפה…';
        var body = { name: name };
        var url = f.profile_url.value.trim(); if (url) body.profile_url = /^https?:\/\//i.test(url) ? url : 'https://' + url;
        var h = f.handle.value.trim().replace(/^@/, ''); if (h) body.handle = h;
        api('POST', '/api/clients', body).then(function (r) {
          dlg.close(); f.reset(); delete f.handle.dataset.touched;
          toast('הלקוח נוסף');
          var c = r.client || r;
          location.hash = c && c.id != null ? '#/client/' + encodeURIComponent(c.id) : '#/clients';
          refreshOverview().catch(function () {});
        }).catch(function (e) { errEl.textContent = errText(e); errEl.hidden = false; })
          .then(function () { btn.disabled = false; btn.textContent = 'להוסיף'; });
      });
    }
    dlg.showModal();
    setTimeout(function () { dlg.querySelector('#ac-name').focus(); }, 30);
  }

  /* ---------------- page: client ---------------- */
  var COLS = [
    { id: 'editing', name: 'בעריכה' },
    { id: 'review', name: 'מחכה לי' },
    { id: 'client', name: 'אצל הלקוח' },
    { id: 'approved', name: 'מאושר' },
    { id: 'scheduled', name: 'מתוזמן' }
  ];
  function hasChanges(p) { return p.video_state === 'changes' || p.caption_state === 'changes' || p.cover_state === 'changes' || p.client_state === 'changes'; }
  function cardTag(p) {
    switch (p.stage) {
      case 'editing': return hasChanges(p) ? ['fix', 'תיקון'] : ['', 'קלוד עורך'];
      case 'review': return ['me', 'לצפות'];
      case 'client': return ['client', 'מחכה לתשובה'];
      case 'approved': return ['ok', 'לתזמן'];
      case 'published': return ['', 'עלה'];
      default: return ['ok', 'מתוזמן'];
    }
  }
  function cardMeta(p) {
    var v = p.version ? 'גרסה ' + p.version.n : '';
    var t;
    if (p.stage === 'editing') t = p.version ? 'קלוד עובד על גרסה ' + (p.version.n + 1) : 'קלוד עובד על גרסה 1';
    else if (p.stage === 'review') t = v + (p.updated_at ? ' · מוכן לפני ' + fmtAgo(p.updated_at) : '');
    else if (p.stage === 'client') t = 'נשלח לפני ' + fmtAgo(p.updated_at);
    else if (p.stage === 'approved') t = p.scheduled_at ? 'עולה ' + fmtWhen(p.scheduled_at) : 'הלקוח אישר';
    else t = p.scheduled_at ? fmtWhen(p.scheduled_at) : '';
    return t;
  }

  function pageClient(token, id) {
    current.clientId = String(id); paintChrome();
    loading([80, 44, 300]);
    Promise.all([api('GET', '/api/clients'), api('GET', '/api/posts?client=' + encodeURIComponent(id))]).then(function (res) {
      if (!guard(token)) return;
      var c = (res[0].clients || []).filter(function (x) { return String(x.id) === String(id); })[0];
      if (!c) { $main.innerHTML = '<div class="empty"><strong>הלקוח לא נמצא</strong><a class="link-strong" href="#/clients">לכל הלקוחות</a></div>'; return; }
      var posts = res[1].posts || [];
      var shareAbs = c.share_url ? new URL(c.share_url, location.origin).href : '';
      var shareShow = shareAbs.replace(/^https?:\/\//, '');

      var html = '<header class="client-head"><div class="client-id">' + avatar(c, 'lg') + '<div>' +
        '<div class="eyebrow"><a href="#/clients">לקוחות</a></div><h1>' + esc(c.name) + '</h1>' +
        (c.handle ? '<div class="muted ltr" style="text-align:right">' + (safeUrl(c.profile_url) ? '<a href="' + safeUrl(c.profile_url) + '" target="_blank" rel="noopener">@' + esc(String(c.handle).replace(/^@/, '')) + '</a>' : '@' + esc(String(c.handle).replace(/^@/, ''))) + '</div>' : '') +
        (c.bio ? '<p class="bio">' + esc(c.bio) + '</p>' : '') + '</div></div>' +
        (shareAbs ? '<div class="share-box"><div class="url"><span class="small muted">דף האישורים של הלקוח</span><span class="ltr">' + esc(shareShow) + '</span></div>' +
          '<button type="button" class="btn ghost" data-action="copy" data-text="' + esc(shareAbs) + '">' + icon('copy') + 'להעתיק קישור</button>' +
          '<a class="btn quiet" href="' + esc(shareAbs) + '" target="_blank" rel="noopener">' + icon('eye') + 'לראות כמו הלקוח</a></div>' : '') +
        '</header>';

      html += '<nav class="tabs" aria-label="תצוגות"><a href="#/client/' + encodeURIComponent(c.id) + '" aria-current="page">סרטונים</a>' +
        '<a href="#/schedule?client=' + encodeURIComponent(c.id) + '">פיד ולוח</a></nav>';

      if (!posts.length) {
        html += '<div class="empty"><strong>עוד אין סרטונים ללקוח הזה</strong><span>כשקלוד יעלה את הסרטון הראשון הוא יופיע כאן, בעמודה "מחכה לי".</span></div>';
      } else {
        html += '<div class="board-wrap" tabindex="0" aria-label="לוח הסרטונים"><div class="board">' + COLS.map(function (col) {
          var cards = posts.filter(function (p) { return p.stage === col.id || (col.id === 'scheduled' && p.stage === 'published'); });
          return '<section class="col' + (cards.length ? '' : ' is-empty') + '" aria-label="' + col.name + '"><div class="col-head"><h2>' + col.name + '</h2><span class="small muted">' + cards.length + '</span></div>' +
            (cards.length ? cards.map(function (p) {
              var tg = cardTag(p), th = safeUrl(thumbOf(p));
              return '<a class="kcard" href="' + foryou(p.id) + '"><div class="frame' + (isWide(p) ? ' wide' : '') + '">' +
                (th ? '<img src="' + th + '" alt="" loading="lazy">' : '<span>פריים</span>') + '</div>' +
                '<div class="k-body"><div class="k-title">' + esc(p.title) + '</div><div class="k-meta">' + esc(cardMeta(p)) + '</div>' +
                '<span class="tag ' + tg[0] + '">' + tg[1] + '</span></div></a>';
            }).join('') : '<div class="col-empty">אין כאן כלום כרגע</div>') + '</section>';
        }).join('') + '</div></div>';
      }
      html += '<p class="small muted">סרטון עובר עמודה לבד: קלוד מסיים, הוא מגיע אלייך. אישרת, הוא יוצא ללקוח. הלקוח אישר, הוא מחכה לתזמון.</p>';
      $main.innerHTML = html;
    }).catch(function (e) { if (guard(token)) showError(e, function () { pageClient(++renderToken, id); }); });
  }

  /* ---------------- page: schedule ---------------- */
  function schedStatus(p) {
    switch (p.stage) {
      case 'published': return ['up', 'עלה'];
      case 'scheduled': return ['ok', 'מתוזמן'];
      case 'approved': return ['ok', 'מאושר'];
      case 'client': return ['client', 'מחכה ללקוח'];
      case 'review': return ['me', 'מחכה לך'];
      default: return ['', 'בעריכה'];
    }
  }
  function pageSchedule(token) {
    loading([70, 340]);
    var q = hashQuery(), filter = q.get('client') || '';
    loadAllPosts().then(function (all) {
      if (!guard(token)) return;
      var clients = all.clients, posts = all.posts;
      var shown = filter ? posts.filter(function (p) { return String(p.client_id) === filter; }) : posts;
      var today = startOfDay(new Date());
      var start = addDays(today, -today.getDay() + state.weekOffset * 7);
      var end = addDays(start, 6);
      var byName = {}; clients.forEach(function (c) { byName[c.id] = c.name; });

      var html = '<header class="head-row"><div class="head"><div class="eyebrow">' + dm(start) + ' עד ' + dm(end) + '</div><h1>לוח פרסומים</h1>' +
        '<p class="muted">כל הלקוחות בשבוע אחד: מה עלה, מה מתוזמן, ומה עוד מחכה לאישור.</p></div>' +
        '<div class="week-nav"><button type="button" class="btn ghost" data-action="week" data-d="-1" aria-label="השבוע הקודם">' + icon('next') + '</button>' +
        '<button type="button" class="btn ghost" data-action="week" data-d="0"' + (state.weekOffset === 0 ? ' disabled' : '') + '>השבוע</button>' +
        '<button type="button" class="btn ghost" data-action="week" data-d="1" aria-label="השבוע הבא">' + icon('arrow') + '</button></div></header>';

      if (clients.length > 1) {
        html += '<div class="filters" role="group" aria-label="סינון לפי לקוח"><button type="button" class="chip" data-action="filter" data-id="" aria-pressed="' + (!filter) + '">כל הלקוחות</button>' +
          clients.map(function (c) {
            return '<button type="button" class="chip" data-action="filter" data-id="' + esc(c.id) + '" aria-pressed="' + (filter === String(c.id)) + '">' + esc(c.name) + '</button>';
          }).join('') + '</div>';
      }

      var days = [];
      for (var i = 0; i < 7; i++) {
        var d = addDays(start, i);
        var items = shown.filter(function (p) { var t = parseTime(p.scheduled_at); return !isNaN(t) && sameDay(new Date(t), d); })
          .sort(function (a, b) { return parseTime(a.scheduled_at) - parseTime(b.scheduled_at); });
        days.push('<div class="sday' + (sameDay(d, today) ? ' today' : '') + (items.length ? '' : ' emptyday') + '"><div class="sday-head"><strong>' + (sameDay(d, today) ? 'היום' : DAYS[d.getDay()]) + '</strong>' +
          '<span class="small muted">' + dm(d) + '</span></div>' +
          (items.length ? '<div class="sday-items" style="display:flex;flex-direction:column;gap:8px">' + items.map(function (p) {
            var st = schedStatus(p);
            return '<a class="sitem ' + st[0] + '" href="' + foryou(p.id) + '"><span class="ltr" style="font-weight:700;text-align:right">' + hm(new Date(parseTime(p.scheduled_at))) + '</span>' +
              (filter ? '' : '<span style="font-weight:500">' + esc(byName[p.client_id] || p.client_name || '') + '</span>') +
              '<span>' + esc(p.title) + '</span><span class="s-status ' + st[0] + '">' + st[1] + '</span></a>';
          }).join('') + '</div>' : '<span class="small muted">אין פרסומים</span>') + '</div>');
      }

      var weekHtml = '<section class="section" aria-label="השבוע"><div class="sched-week">' + days.join('') + '</div>' +
        '<div class="legend"><span><i></i>עלה</span><span><i class="ok"></i>מתוזמן</span><span><i class="client"></i>מחכה ללקוח</span><span><i class="me"></i>מחכה לך</span></div>' +
        '<p class="small muted">הפרסום עצמו יוצא מכלי התזמון שכבר יש לך. כאן רואים את התמונה המלאה, וסרטון לא נכנס ללוח כמתוזמן לפני שהלקוח אישר.</p></section>';

      var feedClients = filter ? clients.filter(function (c) { return String(c.id) === filter; }) : clients;
      var feedsHtml = '<div class="feeds">' + feedClients.map(function (c) {
        var ps = posts.filter(function (p) { return String(p.client_id) === String(c.id) && p.stage !== 'editing'; })
          .sort(function (a, b) {
            var ta = parseTime(a.scheduled_at || a.created_at), tb = parseTime(b.scheduled_at || b.created_at);
            return (tb || 0) - (ta || 0);
          }).slice(0, 12);
        return '<section class="card" aria-labelledby="feed-' + esc(c.id) + '"><div class="head"><h2 id="feed-' + esc(c.id) + '">הפיד של ' + esc(c.name) + '</h2>' +
          '<p class="small muted">ככה הוא ייראה אחרי השבוע הזה</p></div>' +
          (ps.length ? '<div class="feed-grid">' + ps.map(function (p) {
            var th = safeUrl(thumbOf(p)), plan = p.stage !== 'published';
            return '<a class="feed-tile' + (plan ? ' plan' : '') + '" href="' + foryou(p.id) + '" aria-label="' + esc(p.title) + (plan ? ', עוד לא עלה' : '') + '">' +
              (th ? '<img src="' + th + '" alt="" loading="lazy">' : '') + '<span>' + esc(p.title) + '</span></a>';
          }).join('') + '</div><div class="legend" style="flex-direction:column;gap:4px"><span><i style="outline:3px solid var(--approve);outline-offset:-3px"></i>עוד לא עלה, מתוכנן</span><span><i style="background:var(--frame)"></i>כבר בפיד</span></div>'
            : '<div class="empty">עוד אין סרטונים בפיד</div>') + '</section>';
      }).join('') + '</div>';

      html += clients.length ? '<div class="sched-layout">' + weekHtml + feedsHtml + '</div>'
        : '<div class="empty"><strong>עוד אין לקוחות</strong><a class="link-strong" href="#/clients">להוסיף לקוח</a></div>';
      $main.innerHTML = html;
    }).catch(function (e) { if (guard(token)) showError(e, function () { pageSchedule(++renderToken); }); });
  }

  /* ---------------- page: queue ---------------- */
  var TARGET = { video: 'הסרטון', caption: 'הכיתוב', cover: 'הקאבר', music: 'המוזיקה', general: 'כללי' };
  function pageQueue(token) {
    loading([60, 80, 300]);
    Promise.all([loadAllPosts(), api('GET', '/api/settings').catch(function () { return null; }), refreshOverview()]).then(function (res) {
      if (!guard(token)) return;
      var posts = res[0].posts, settings = res[1], ov = res[2];
      state.settings = settings;
      var open = [], done = [];
      posts.forEach(function (p) {
        (p.comments || []).forEach(function (c) { (c.status === 'done' ? done : open).push({ c: c, p: p }); });
      });
      var byTime = function (a, b) { return parseTime(b.c.updated_at || b.c.created_at) - parseTime(a.c.updated_at || a.c.created_at); };
      open.sort(byTime); done.sort(byTime);

      var html = '<header class="head"><h1>התור של קלוד</h1><p class="muted">כל הערה, שלך או של לקוח, נכנסת לכאן ויורדת למחשב שלך.</p></header>';
      html += '<div class="steps">' + [
        ['1', 'הערה באתר', 'שלך בדף הסרטון, או של הלקוח בדף האישור'],
        ['2', 'יורדת למחשב', 'נכנסת לתיקייה של אותו לקוח'],
        ['3', 'קלוד מתקן', 'ושומר את התיקון כגרסה חדשה'],
        ['4', 'הגרסה עולה לדף', 'ומחכה לך ב"היום"']
      ].map(function (s) { return '<div class="step"><span class="small muted">' + s[0] + '</span><strong>' + s[1] + '</strong><span class="small muted">' + s[2] + '</span></div>'; }).join('') + '</div>';

      var row = function (x, isDone) {
        var c = x.c, p = x.p;
        var who = c.author_kind === 'client' ? '<span class="tag client">הלקוח</span>' : c.author_kind === 'claude' ? '<span class="tag">קלוד</span>' : '<span class="tag">' + esc(c.author || 'הצוות') + '</span>';
        var where = (c.at_sec != null && c.at_sec !== '' ? fmtLen(c.at_sec) : TARGET[c.target] || '');
        return '<li class="qrow">' + '<div class="q-who">' + who + '</div>' +
          '<div class="q-video"><strong style="color:var(--text)">' + esc(p.client_name || clientName(p.client_id)) + '</strong> · <a href="' + foryou(p.id) + '">' + esc(p.title) + '</a>' + (where ? ', <span class="ltr">' + esc(where) + '</span>' : '') + '</div>' +
          '<div>' + (isDone ? '<span class="tag ok">תוקן</span>' : '<span class="tag me">חדש</span>') + '</div>' +
          '<div class="q-body">' + esc(c.body) + '</div></li>';
      };
      var listHtml = '<section class="card" style="padding:4px 0" aria-labelledby="h-open"><div style="padding:14px 18px 6px" class="section-head"><h2 id="h-open">הערות פתוחות</h2><span class="small muted">' + open.length + '</span></div>' +
        (open.length ? '<ul class="qlist">' + open.map(function (x) { return row(x, false); }).join('') + '</ul>'
          : '<div class="empty" style="margin:8px 18px 18px">אין הערות פתוחות. קלוד סיים את כל מה שביקשו ממנו.</div>') +
        (done.length ? '<details class="more" style="padding:0 18px 8px"><summary>מה כבר תוקן (' + done.length + ')</summary><ul class="qlist">' + done.slice(0, 15).map(function (x) { return row(x, true); }).join('') + '</ul></details>' : '') +
        '</section>';

      var mi = machineInfo(ov.machine);
      var side = '<section class="card" aria-labelledby="h-pc"><h2 id="h-pc">המחשב שלך</h2>' +
        '<div class="row" style="font-weight:700;color:' + (mi.on ? 'var(--tag-ok-fg)' : 'var(--text-2)') + '"><span class="dot ' + (mi.on ? 'on' : 'off') + '"></span>' +
        (mi.on ? 'מחובר, ' + esc(mi.sub) : 'לא מחובר' + (ov.machine ? ', ' + esc(mi.sub) : '')) + '</div>' +
        '<p class="small muted">העריכות, הקבצים והידע על כל לקוח יושבים בתיקייה אחת במחשב. האתר רק מציג אותם.</p>' +
        '<p class="small muted">כשהמחשב סגור, ההערות מחכות כאן. הן יורדות ברגע שהוא נדלק.</p></section>';
      side += connectionsCard(settings, true);

      html += '<div class="queue-layout">' + listHtml + '<div style="display:flex;flex-direction:column;gap:16px;min-width:0">' + side + '</div></div>';
      $main.innerHTML = html;
      bindSettingsForm();
    }).catch(function (e) { if (guard(token)) showError(e, function () { pageQueue(++renderToken); }); });
  }

  function connectionsCard(s, withForm) {
    var conn = function (name, what, ok, offTxt) {
      return '<div class="conn"><div><div style="font-weight:700">' + name + '</div><div class="small muted">' + what + '</div></div>' +
        (ok ? '<span class="tag ok">מחובר</span>' : '<span class="tag ' + (offTxt === 'חסר' ? 'fix' : '') + '">' + (offTxt === 'חסר' ? 'חסר מפתח' : 'לא חובר') + '</span>') + '</div>';
    };
    var html = '<section class="card" aria-labelledby="h-conn"><h2 id="h-conn">החיבורים</h2>' +
      conn('האתר', 'דפי האישור והלוח', true) +
      (s ? conn('Bunny', 'הסרטונים מתנגנים משם', s.has_bunny_key, 'חסר') + conn('ElevenLabs', 'תמלול הסרטונים, לא חובה', s.has_elevenlabs_key, 'רשות')
        : '<p class="small muted">אין הרשאה לראות את החיבורים. רק בעלת החשבון רואה אותם.</p>') +
      '<p class="small muted">כל החשבונות על שמך ובבעלותך.</p>';
    if (withForm && s) html += '<details class="more"><summary>להחליף מפתח</summary>' + settingsForm(s) + '</details>';
    return html + '</section>';
  }

  function keyField(id, label, help, hasKey, extra) {
    return '<div class="field"><div class="field-top"><label for="' + id + '">' + label + '</label>' +
      (help ? '<a href="' + help + '" target="_blank" rel="noopener">איפה מוצאים את זה</a>' : '') + '</div>' +
      '<input class="input" id="' + id + '" name="' + id.replace(/^s-|^su-/, '') + '" dir="ltr" autocomplete="off" spellcheck="false" ' +
      'placeholder="' + (hasKey ? 'נשמר. כדי להחליף מדביקים מפתח חדש' : 'להדביק כאן') + '"' + (extra || '') + '></div>';
  }

  function settingsForm(s) {
    return '<form class="form" data-settings novalidate>' +
      '<div class="field"><label for="s-agency_name">שם הסוכנות</label><input class="input" id="s-agency_name" name="agency_name" value="' + esc(s.agency_name || '') + '"></div>' +
      keyField('s-bunny_account_key', 'מפתח החשבון של Bunny', 'https://dash.bunny.net/account/api-key', s.has_bunny_key) +
      '<details class="more"><summary>יש לי כבר ספרייה</summary><div class="form">' +
      '<div class="field"><label for="s-bunny_library_id">מספר הספרייה</label><input class="input" id="s-bunny_library_id" name="bunny_library_id" dir="ltr" inputmode="numeric" value="' + esc(s.bunny_library_id || '') + '"></div>' +
      keyField('s-bunny_library_key', 'המפתח של הספרייה', 'https://dash.bunny.net/stream', s.has_bunny_key) +
      '<div class="field"><label for="s-bunny_cdn_host">כתובת הניגון</label><input class="input" id="s-bunny_cdn_host" name="bunny_cdn_host" dir="ltr" placeholder="vz-xxxx.b-cdn.net" value="' + esc(s.bunny_cdn_host || '') + '"></div>' +
      '</div></details>' +
      keyField('s-elevenlabs_key', 'מפתח ElevenLabs לתמלול', 'https://elevenlabs.io/app/settings/api-keys', s.has_elevenlabs_key) +
      '<div class="form-error" role="alert" hidden></div><div class="form-ok" role="status" hidden></div>' +
      '<div class="form-actions"><button type="submit" class="btn">לשמור</button></div></form>';
  }

  function bindSettingsForm() {
    document.querySelectorAll('form[data-settings]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var err = f.querySelector('.form-error'), ok = f.querySelector('.form-ok');
        err.hidden = ok.hidden = true;
        var body = {};
        ['agency_name', 'bunny_account_key', 'bunny_library_id', 'bunny_library_key', 'bunny_cdn_host', 'elevenlabs_key'].forEach(function (k) {
          var el = f.elements[k]; if (el && el.value.trim() !== '') body[k] = el.value.trim();
        });
        if (state.settings && body.agency_name === state.settings.agency_name) delete body.agency_name;
        if (state.settings && body.bunny_library_id === String(state.settings.bunny_library_id || '')) delete body.bunny_library_id;
        if (state.settings && body.bunny_cdn_host === (state.settings.bunny_cdn_host || '')) delete body.bunny_cdn_host;
        if (!Object.keys(body).length) { err.textContent = 'לא שונה כלום'; err.hidden = false; return; }
        var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'שומרת…';
        api('POST', '/api/settings', body).then(function () {
          ok.textContent = 'נשמר'; ok.hidden = false; toast('ההגדרות נשמרו');
          return api('GET', '/api/session').then(function (s) { state.session.brand = s.brand; paintChrome(); });
        }).then(function () { setTimeout(route, 700); })
          .catch(function (e) { err.textContent = errText(e); err.hidden = false; })
          .then(function () { btn.disabled = false; btn.textContent = 'לשמור'; });
      });
    });
  }

  /* ---------------- page: settings ---------------- */
  function pageSettings(token) {
    loading([48, 260]);
    api('GET', '/api/settings').then(function (s) { return s; }, function (e) { if (e.status === 403) return null; throw e; }).then(function (s) {
      if (!guard(token)) return;
      state.settings = s;
      var u = state.session.user || {};
      var html = '<header class="head"><h1>הגדרות</h1><p class="muted">החשבון שלך והחיבורים של הסוכנות.</p></header>';
      html += '<div class="cards-2">';
      html += s ? '<section class="card" aria-labelledby="h-keys"><h2 id="h-keys">הסוכנות והמפתחות</h2><p class="small muted">מפתח שנשמר לא מוצג שוב. כדי להחליף, מדביקים מפתח חדש.</p>' + settingsForm(s) +
        '<p class="guide-note">סרטון הדרכה קצר על מציאת המפתחות יגיע בקרוב.</p></section>' : '';
      html += '<div style="display:flex;flex-direction:column;gap:16px;min-width:0">' + connectionsCard(s, false) +
        '<section class="card" aria-labelledby="h-me"><h2 id="h-me">החשבון שלי</h2><div><strong>' + esc(u.name) + '</strong><div class="muted ltr" style="text-align:right">' + esc(u.email) + '</div></div>' +
        '<div class="form-actions"><button type="button" class="btn ghost" data-action="logout">להתנתק</button></div></section></div>';
      html += '</div>';
      $main.innerHTML = html;
      bindSettingsForm();
    }).catch(function (e) { if (guard(token)) showError(e, function () { pageSettings(++renderToken); }); });
  }

  /* ---------------- login ---------------- */
  function pageLogin() {
    var brand = (state.session && state.session.brand && state.session.brand.name) || '';
    $solo.innerHTML = '<div class="solo-card"><div class="topbar-brand" style="visibility:visible"><span class="brand-dot" aria-hidden="true"></span><span>' + esc(brand || 'מערכת האישורים') + '</span></div>' +
      '<div class="head"><h1>כניסה</h1><p class="muted">מתחברים עם האימייל והסיסמה של הסוכנות.</p></div>' +
      '<form class="form" id="login-form" novalidate>' +
      '<div class="field"><label for="li-email">אימייל</label><input class="input" id="li-email" name="email" type="email" dir="ltr" lang="en" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username" required></div>' +
      '<div class="field"><label for="li-pass">סיסמה</label><input class="input" id="li-pass" name="password" type="password" dir="ltr" lang="en" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="current-password" required></div>' +
      '<div class="form-error" role="alert" hidden></div>' +
      '<button type="submit" class="btn big block">להיכנס</button></form></div>';
    var f = document.getElementById('login-form');
    f.email.focus();
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = f.querySelector('.form-error');
      var email = f.email.value.trim(), pass = f.password.value;
      if (!email || !pass) { err.textContent = 'צריך למלא אימייל וסיסמה'; err.hidden = false; return; }
      var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'נכנסת…';
      api('POST', '/api/login', { email: email, password: pass }).then(function (r) {
        state.session.user = r.user; location.hash = '#/'; route();
      }).catch(function (e) {
        err.textContent = e.status === 401 && !ERR[e.code] ? ERR.bad_credentials : errText(e); err.hidden = false;
        btn.disabled = false; btn.textContent = 'להיכנס';
      });
    });
  }

  /* ---------------- setup (onboarding) ---------------- */
  var SETUP_STEPS = ['הסוכנות שלך', 'איפה הסרטונים יישמרו', 'תמלול, לא חובה'];
  function pageSetup() {
    var st = state.setup || (state.setup = { step: 0, data: {}, existing: false });
    var d = st.data;
    var v = function (k) { return esc(d[k] || ''); };
    var body = '';
    if (st.step === 0) {
      body = '<p class="muted">כמה פרטים כדי לפתוח את החשבון. האימייל והסיסמה ישמשו אותך להתחבר.</p>' +
        '<div class="field"><label for="su-agency_name">שם הסוכנות</label><input class="input" id="su-agency_name" name="agency_name" value="' + v('agency_name') + '" autocomplete="organization" required></div>' +
        '<div class="field"><label for="su-name">השם שלך</label><input class="input" id="su-name" name="name" value="' + v('name') + '" dir="ltr" lang="en" autocomplete="name" autocapitalize="words" spellcheck="false" placeholder="Dana" required><span class="hint">באנגלית</span></div>' +
        '<div class="field"><label for="su-email">אימייל</label><input class="input" id="su-email" name="email" type="email" dir="ltr" lang="en" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + v('email') + '" autocomplete="email" required></div>' +
        '<div class="field"><label for="su-password">סיסמה</label><input class="input" id="su-password" name="password" type="password" dir="ltr" lang="en" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + v('password') + '" autocomplete="new-password" minlength="8" required><span class="hint">לפחות 8 תווים</span></div>';
    } else if (st.step === 1) {
      body = '<p class="muted">הסרטונים נשמרים ומתנגנים מחשבון Bunny שלך. מדביקים מפתח אחד, והמערכת פותחת ספרייה לבד.</p>' +
        '<div class="choice" role="group" aria-label="איך מתחברים"><button type="button" data-action="bunny-mode" data-v="0" aria-pressed="' + !st.existing + '">חשבון חדש או ריק</button>' +
        '<button type="button" data-action="bunny-mode" data-v="1" aria-pressed="' + st.existing + '">יש לי כבר ספרייה</button></div>';
      if (!st.existing) {
        body += keyField('su-bunny_account_key', 'מפתח החשבון', 'https://dash.bunny.net/account/api-key', false, ' value="' + v('bunny_account_key') + '"') +
          '<p class="small muted">איפה זה: בלוח הבקרה של Bunny, Account settings, ושם API key.</p>';
      } else {
        body += '<div class="field"><div class="field-top"><label for="su-bunny_library_id">מספר הספרייה</label><a href="https://dash.bunny.net/stream" target="_blank" rel="noopener">איפה מוצאים את זה</a></div>' +
          '<input class="input" id="su-bunny_library_id" name="bunny_library_id" dir="ltr" inputmode="numeric" value="' + v('bunny_library_id') + '"></div>' +
          keyField('su-bunny_library_key', 'המפתח של הספרייה', 'https://dash.bunny.net/stream', false, ' value="' + v('bunny_library_key') + '"') +
          '<div class="field"><div class="field-top"><label for="su-bunny_cdn_host">כתובת הניגון</label><a href="https://dash.bunny.net/stream" target="_blank" rel="noopener">איפה מוצאים את זה</a></div>' +
          '<input class="input" id="su-bunny_cdn_host" name="bunny_cdn_host" dir="ltr" placeholder="vz-xxxx.b-cdn.net" value="' + v('bunny_cdn_host') + '"></div>' +
          '<p class="small muted">שלושתם נמצאים בספרייה עצמה, בלשונית API.</p>';
      }
      body += '<p class="guide-note">סרטון הדרכה קצר שמראה בדיוק איפה זה יגיע בקרוב.</p>';
    } else {
      body = '<p class="muted">קלוד משתמש ב־ElevenLabs כדי לתמלל את הסרטונים במחשב שלך. אפשר לחבר עכשיו, ואפשר גם אחר כך מההגדרות.</p>' +
        keyField('su-elevenlabs_key', 'מפתח ElevenLabs', 'https://elevenlabs.io/app/settings/api-keys', false, ' value="' + v('elevenlabs_key') + '"') +
        '<p class="guide-note">סרטון הדרכה קצר שמראה בדיוק איפה זה יגיע בקרוב.</p>';
    }
    var last = st.step === 2;
    if (!state.setupCode) {
      $solo.innerHTML = '<div class="solo-card"><div class="head"><h1>קוד ההתקנה חסר</h1>' +
        '<p class="muted">כדי לפתוח את החשבון צריך להיכנס מהקישור שקיבלת בסוף ההתקנה. הוא נראה כמו כתובת האתר ואחריה ‎#setup=‎ וקוד.</p></div>' +
        '<form class="form" id="code-form" novalidate><div class="field"><label for="su-code">או להדביק כאן את הקוד</label>' +
        '<input class="input" id="su-code" name="code" dir="ltr" autocomplete="off" spellcheck="false"></div>' +
        '<div class="form-error" role="alert" hidden></div><button type="submit" class="btn big block">להמשיך</button></form></div>';
      document.getElementById('code-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = ev.target.code.value.trim().replace(/^.*setup=/, '');
        if (!v) { var e = ev.target.querySelector('.form-error'); e.textContent = 'צריך להדביק את הקוד'; e.hidden = false; return; }
        state.setupCode = v; try { sessionStorage.setItem('setup_code', v); } catch (_) {}
        pageSetup();
      });
      return;
    }
    $solo.innerHTML = '<div class="solo-card">' +
      '<div class="head"><div class="eyebrow">ברוכה הבאה · שלב ' + (st.step + 1) + ' מתוך 3</div><h1>' + SETUP_STEPS[st.step] + '</h1></div>' +
      '<ol class="stepper" aria-label="שלבים">' + SETUP_STEPS.map(function (s, i) {
        return '<li class="' + (i < st.step ? 'done' : i === st.step ? 'cur' : '') + '"' + (i === st.step ? ' aria-current="step"' : '') + '>' + s + '</li>';
      }).join('') + '</ol>' +
      '<form class="form" id="setup-form" novalidate>' + body +
      '<div class="form-error" role="alert" hidden></div>' +
      '<div class="form-actions">' +
      '<button type="submit" class="btn big" style="flex:1">' + (last ? 'לסיים ולהיכנס' : 'הלאה') + '</button>' +
      (last ? '<button type="button" class="btn ghost big" data-action="setup-skip">אפשר גם אחר כך</button>' : '') +
      (st.step > 0 ? '<button type="button" class="btn quiet" data-action="setup-back">חזרה</button>' : '') +
      '</div></form></div>';
    var f = document.getElementById('setup-form');
    var first = f.querySelector('input'); if (first && !first.value) first.focus();
    f.addEventListener('submit', function (ev) { ev.preventDefault(); setupNext(f, false); });
  }

  function collect(f) {
    var d = state.setup.data;
    Array.prototype.forEach.call(f.querySelectorAll('input[name]'), function (el) { d[el.name] = el.value.trim(); });
    if (f.elements.password) d.password = f.elements.password.value; // keep spaces in passwords
  }
  function setupNext(f, skip) {
    var st = state.setup, d = st.data, err = f.querySelector('.form-error');
    collect(f);
    var fail = function (msg, field) {
      err.textContent = msg; err.hidden = false;
      if (field && f.elements[field]) { f.elements[field].setAttribute('aria-invalid', 'true'); f.elements[field].focus(); }
    };
    Array.prototype.forEach.call(f.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    if (st.step === 0) {
      if (!d.agency_name) return fail('צריך לכתוב את שם הסוכנות', 'agency_name');
      if (!d.name) return fail('צריך לכתוב את השם שלך', 'name');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '')) return fail('האימייל לא נראה תקין', 'email');
      if ((d.password || '').length < 8) return fail('הסיסמה צריכה להיות לפחות 8 תווים', 'password');
    }
    if (st.step === 1) {
      if (!st.existing && !d.bunny_account_key) return fail('צריך להדביק את מפתח החשבון', 'bunny_account_key');
      if (st.existing) {
        if (!d.bunny_library_id) return fail('צריך את מספר הספרייה', 'bunny_library_id');
        if (!d.bunny_library_key) return fail('צריך את המפתח של הספרייה', 'bunny_library_key');
        if (!d.bunny_cdn_host) return fail('צריך את כתובת הניגון', 'bunny_cdn_host');
      }
    }
    if (st.step < 2) { st.step++; pageSetup(); return; }

    var body = { setup_code: state.setupCode, agency_name: d.agency_name, name: d.name, email: d.email, password: d.password };
    if (st.existing) { body.bunny_library_id = d.bunny_library_id; body.bunny_library_key = d.bunny_library_key; body.bunny_cdn_host = d.bunny_cdn_host.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
    else body.bunny_account_key = d.bunny_account_key;
    if (!skip && d.elevenlabs_key) body.elevenlabs_key = d.elevenlabs_key;
    var btns = f.querySelectorAll('button'); btns.forEach(function (b) { b.disabled = true; });
    var main = f.querySelector('[type=submit]'); main.textContent = 'פותחת את החשבון…';
    api('POST', '/api/setup', body).then(function (r) {
      state.setup = null;
      try { sessionStorage.removeItem('setup_code'); } catch (_) {}
      state.session.setup_needed = false; state.session.user = r.user;
      state.session.brand = { name: d.agency_name };
      location.hash = '#/'; route(); toast('החשבון מוכן');
    }).catch(function (e) {
      btns.forEach(function (b) { b.disabled = false; }); main.textContent = 'לסיים ולהיכנס';
      var msg = errText(e);
      if (/bunny/i.test(e.code || '')) { st.step = 1; pageSetup(); var f2 = document.getElementById('setup-form'); f2.querySelector('.form-error').textContent = msg; f2.querySelector('.form-error').hidden = false; return; }
      if (e.code === 'setup_code') { state.setupCode = ''; try { sessionStorage.removeItem('setup_code'); } catch (_) {} st.step = 0; pageSetup(); var f3 = document.querySelector('#code-form .form-error'); if (f3) { f3.textContent = ERR.setup_code; f3.hidden = false; } return; }
      if (e.code === 'setup_done' || e.code === 'already_setup' || e.code === 'already_set_up') { state.session.setup_needed = false; location.hash = '#/login'; return; }
      fail(msg);
    });
  }

  /* ---------------- router ---------------- */
  function route() {
    var s = state.session; if (!s) return;
    var h = location.hash.replace(/^#/, '') || '/';
    var path = h.split('?')[0];
    toggleNotifs(false);
    if (s.setup_needed) {
      if (path !== '/setup') { history.replaceState(null, '', location.pathname + location.search + '#/setup'); }
      $shell.hidden = true; $solo.hidden = false; document.title = 'פתיחת חשבון'; pageSetup(); return;
    }
    if (!s.user) {
      if (path !== '/login') history.replaceState(null, '', location.pathname + location.search + '#/login');
      $shell.hidden = true; $solo.hidden = false; document.title = 'כניסה'; pageLogin(); return;
    }
    if (path === '/login' || path === '/setup') { history.replaceState(null, '', location.pathname + location.search + '#/'); path = '/'; }
    $solo.hidden = true; $solo.innerHTML = ''; $shell.hidden = false;
    var token = ++renderToken;
    var m;
    if (!state.overview && path !== '/' && path !== '/clients' && path !== '/queue') refreshOverview().catch(function () {});
    current.clientId = null;
    if (path === '/' || path === '') { current.nav = 'today'; paintChrome(); pageToday(token); }
    else if (path === '/clients') { current.nav = 'clients'; paintChrome(); pageClients(token); }
    else if ((m = path.match(/^\/client\/(.+)$/))) { current.nav = 'clients'; pageClient(token, decodeURIComponent(m[1])); }
    else if (path === '/schedule') { current.nav = 'schedule'; paintChrome(); pageSchedule(token); }
    else if (path === '/queue') { current.nav = 'queue'; paintChrome(); pageQueue(token); }
    else if (path === '/settings') { current.nav = 'settings'; paintChrome(); pageSettings(token); }
    else { current.nav = ''; paintChrome(); $main.innerHTML = '<div class="empty"><strong>הדף לא נמצא</strong><a class="link-strong" href="#/">חזרה להיום</a></div>'; }
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.tabbar, .side')) $main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action], [data-notif], #bell');
    if (!t) {
      if (!ev.target.closest('.bell-wrap')) toggleNotifs(false);
      return;
    }
    if (t.id === 'bell') { toggleNotifs(); return; }
    if (t.hasAttribute('data-notif')) { markRead([t.getAttribute('data-notif')]); toggleNotifs(false); return; }
    var a = t.getAttribute('data-action');
    if (a === 'retry' && retryFn) retryFn();
    else if (a === 'read-all') markRead(null);
    else if (a === 'add-client') openAddClient();
    else if (a === 'copy') copyText(t.getAttribute('data-text')).then(function () { toast('הקישור הועתק'); }, function () { toast('לא הצלחנו להעתיק. אפשר לסמן את הקישור ולהעתיק ידנית'); });
    else if (a === 'week') { var dd = +t.getAttribute('data-d'); state.weekOffset = dd === 0 ? 0 : state.weekOffset + dd; pageSchedule(++renderToken); }
    else if (a === 'filter') { var id = t.getAttribute('data-id'); location.hash = '#/schedule' + (id ? '?client=' + encodeURIComponent(id) : ''); }
    else if (a === 'logout') api('POST', '/api/logout').catch(function () {}).then(function () { state.session.user = null; state.overview = null; location.hash = '#/login'; route(); });
    else if (a === 'bunny-mode') { collect(document.getElementById('setup-form')); state.setup.existing = t.getAttribute('data-v') === '1'; pageSetup(); }
    else if (a === 'setup-back') { collect(document.getElementById('setup-form')); state.setup.step--; pageSetup(); }
    else if (a === 'setup-skip') setupNext(document.getElementById('setup-form'), true);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !document.getElementById('notif-panel').hidden) { toggleNotifs(false); document.getElementById('bell').focus(); }
  });
  window.addEventListener('hashchange', route);
  // keep the bell and heartbeat fresh while the tab is open
  setInterval(function () {
    if (document.visibilityState === 'visible' && state.session && state.session.user && !MOCK) refreshOverview().catch(function () {});
  }, 60000);

  /* ---------------- boot ---------------- */
  function readSetupCode() {
    var m = location.hash.match(/[#&?]setup=([^&]+)/);
    if (m) {
      state.setupCode = decodeURIComponent(m[1]);
      try { sessionStorage.setItem('setup_code', state.setupCode); } catch (_) {}
      history.replaceState(null, '', location.pathname + location.search + '#/setup');
    } else if (!state.setupCode) {
      try { state.setupCode = sessionStorage.getItem('setup_code') || ''; } catch (_) { state.setupCode = ''; }
    }
  }
  function boot() {
    readSetupCode();
    $solo.hidden = false;
    $solo.innerHTML = '<div class="solo-card" aria-busy="true"><div class="skel" style="height:28px;width:50%"></div><div class="skel" style="height:120px"></div></div>';
    api('GET', '/api/session').then(function (s) {
      state.session = s;
      route();
    }).catch(function (e) {
      $solo.innerHTML = '<div class="solo-card"><div class="error-box" role="alert"><span>' + esc(errText(e)) + '</span><button type="button" class="btn ghost" id="boot-retry">לנסות שוב</button></div></div>';
      document.getElementById('boot-retry').onclick = boot;
    });
  }

  /* ---------------- mock (only with ?mock=1) ---------------- */
  function mockApi(method, path, body) {
    var M = window.__mock || (window.__mock = makeMock());
    var url = new URL(path, location.origin), p = url.pathname, q = url.searchParams;
    var ok = function (x) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(x))); }, 180); }); };
    var no = function (code, status) { return new Promise(function (_, rej) { setTimeout(function () { var e = new Error(code); e.code = code; e.status = status || 400; rej(e); }, 180); }); };
    var postOut = function (x) { var c = M.clients.filter(function (k) { return k.id === x.client_id; })[0]; x.client_name = c && c.name; return x; };
    if (p === '/api/session') return ok({ brand: M.brand, setup_needed: M.setup, user: M.user });
    if (p === '/api/setup') { M.setup = false; M.user = { id: 1, name: body.name, email: body.email, role: 'owner' }; M.brand = { name: body.agency_name }; return ok({ ok: true, user: M.user }); }
    if (p === '/api/login') { if (body.password !== 'password1') return no('bad_credentials', 401); M.user = { id: 1, name: 'Owner', email: body.email, role: 'owner' }; return ok({ ok: true, user: M.user }); }
    if (p === '/api/logout') { M.user = null; return ok({ ok: true }); }
    if (!M.user) return no('unauthorized', 401);
    if (p === '/api/overview') {
      var wk = M.posts.filter(function (x) { var t = parseTime(x.scheduled_at); return t >= startOfDay(new Date()).getTime() && t < addDays(startOfDay(new Date()), 7).getTime(); });
      return ok({ brand: M.brand, user: M.user, clients: M.clients.map(function (c) {
        var ps = M.posts.filter(function (x) { return x.client_id === c.id; });
        var cnt = function (s) { return ps.filter(function (x) { return x.stage === s; }).length; };
        return Object.assign({}, c, { counts: { review: cnt('review'), client: cnt('client'), approved: cnt('approved'), changes: ps.filter(hasChanges).length } });
      }), notifications: M.events, unread: M.events.filter(function (e) { return !e.read_at; }).length, machine: M.machine, week: wk.map(postOut) });
    }
    if (p === '/api/clients' && method === 'GET') return ok({ clients: M.clients });
    if (p === '/api/clients' && method === 'POST') { var c = Object.assign({ id: 'c' + Date.now(), share_url: '/c/tok' + Date.now() }, body); M.clients.push(c); return ok({ client: c }); }
    if (p === '/api/feed') {
      var stage = q.get('stage') || 'review';
      return ok({ groups: M.clients.map(function (c) { return { client: c, posts: M.posts.filter(function (x) { return x.client_id === c.id && x.stage === stage; }).map(postOut) }; }).filter(function (g) { return g.posts.length; }) });
    }
    if (p === '/api/posts') return ok({ posts: M.posts.filter(function (x) { return !q.get('client') || x.client_id === q.get('client'); }).map(postOut) });
    if (p === '/api/notifications/read') { M.events.forEach(function (e) { if (!body.ids || body.ids.indexOf(e.id) >= 0) e.read_at = new Date().toISOString(); }); return ok({ ok: true }); }
    if (p === '/api/settings' && method === 'GET') return ok(M.settings);
    if (p === '/api/settings' && method === 'POST') { if (body.agency_name) { M.settings.agency_name = body.agency_name; M.brand.name = body.agency_name; } if (body.elevenlabs_key) M.settings.has_elevenlabs_key = true; if (body.bunny_account_key || body.bunny_library_key) M.settings.has_bunny_key = true; return ok({ ok: true }); }
    return no('not_found', 404);
  }
  function makeMock() {
    var now = Date.now(), H = 3600000, D = 24 * H;
    var iso = function (t) { return new Date(t).toISOString(); };
    var qs = new URLSearchParams(location.search);
    var clients = [
      { id: 'nona', name: 'ביסטרו נונה', handle: 'bistro.nona', profile_url: 'https://instagram.com/bistro.nona', avatar: '', bio: 'ביסטרו איטלקי קטן בפלורנטין', color: '#c9a46a', share_url: '/c/nona-demo-token' },
      { id: 'alma', name: 'קפה אלמה', handle: 'cafe.alma', profile_url: 'https://instagram.com/cafe.alma', avatar: '', bio: '', color: '#4f7a5a', share_url: '/c/alma-demo-token' },
      { id: 'shahar', name: 'מאפיית שחר', handle: 'shahar.bakery', profile_url: 'https://www.tiktok.com/@shahar.bakery', avatar: '', bio: '', color: '', share_url: '/c/shahar-demo-token' }
    ];
    var id = 0;
    var mk = function (client, title, stage, extra) {
      id++;
      return Object.assign({ id: id, client_id: client, title: title, kind: 'reel', orientation: 'vertical', stage: stage, video_state: 'pending', caption: 'כיתוב לדוגמה', caption_state: 'pending', cover_url: '', cover_state: 'pending', music: null, scheduled_at: null, client_state: 'none', created_at: iso(now - id * H), updated_at: iso(now - id * 40 * 60000),
        version: { id: id, n: 1, bunny_guid: 'g', duration: 30 + id * 3, width: 1080, height: 1920, note: '', mp4: [], hls: '', thumb: '', embed: '' }, versions: [], comments: [] }, extra || {});
    };
    var posts = [
      mk('nona', 'ריל: מנת השף של השבוע', 'review', { version: { id: 1, n: 2, duration: 42, mp4: [], thumb: '' } }),
      mk('alma', 'ריל: הבריסטה מסביר קפה קר', 'review'),
      mk('shahar', 'סטורי: מה יוצא מהתנור היום', 'review', { kind: 'story', scheduled_at: iso(startOfDay(new Date()).getTime() + 16 * H) }),
      mk('nona', 'ריל: שף אורח בשישי', 'editing', { version: null }),
      mk('nona', 'ריל: היין החדש', 'client', { client_state: 'pending', scheduled_at: iso(startOfDay(new Date()).getTime() + 2 * D + 12 * H) }),
      mk('nona', 'ריל: ערב ג׳אז', 'approved', { client_state: 'approved' }),
      mk('nona', 'ריל: קינוח הבית', 'scheduled', { scheduled_at: iso(startOfDay(new Date()).getTime() + 1 * D + 12 * H) }),
      mk('nona', 'פסטה טרייה', 'published', { scheduled_at: iso(now - 2 * D) }),
      mk('alma', 'ריל: מאפה הבוקר', 'published', { scheduled_at: iso(startOfDay(new Date()).getTime() - 1 * D + 12 * H) }),
      mk('alma', 'ריל: קפה קר, גרסה 2', 'editing', { video_state: 'changes', comments: [{ id: 1, post_id: 10, target: 'music', at_sec: null, body: 'המוזיקה חזקה מדי בהתחלה', author: 'קפה אלמה', author_kind: 'client', status: 'open', created_at: iso(now - 30 * 60000) }] }),
      mk('shahar', 'ריל: בוקר במאפייה', 'scheduled', { scheduled_at: iso(startOfDay(new Date()).getTime() + 3 * D + 10 * H), comments: [{ id: 2, post_id: 11, target: 'caption', body: 'פחות סימני קריאה, זה לא נשמע כמוהם.', author: 'Owner', author_kind: 'team', status: 'done', created_at: iso(now - D) }] })
    ];
    posts[0].comments = [{ id: 3, post_id: 1, target: 'video', at_sec: 7, body: 'המעבר לצלחת מהיר מדי. לתת לה עוד שנייה.', author: 'Owner', author_kind: 'team', status: 'open', created_at: iso(now - 2 * H) }];
    var events = [
      { id: 1, kind: 'new_video', post_id: 1, client_id: 'nona', body: 'ריל: מנת השף של השבוע', created_at: iso(now - 20 * 60000), read_at: null },
      { id: 2, kind: 'client_comment', post_id: 10, client_id: 'alma', body: 'המוזיקה חזקה מדי בהתחלה', created_at: iso(now - 30 * 60000), read_at: null },
      { id: 3, kind: 'client_approved', post_id: 6, client_id: 'nona', body: 'ריל: ערב ג׳אז', created_at: iso(now - 3 * H), read_at: null },
      { id: 4, kind: 'shared', post_id: 5, client_id: 'nona', body: 'ריל: היין החדש', created_at: iso(now - D), read_at: iso(now - D) }
    ];
    return {
      setup: qs.has('setup'), user: qs.has('nouser') || qs.has('setup') ? null : { id: 1, name: 'Owner', email: 'owner@example.com', role: 'owner' },
      brand: { name: 'סטודיו לדוגמה' }, clients: clients, posts: posts, events: events,
      machine: qs.has('offline') ? { name: 'mac', last_seen: iso(now - 5 * H) } : { name: 'mac', last_seen: iso(now - 2 * 60000) },
      settings: { agency_name: 'סטודיו לדוגמה', bunny_library_id: '12345', bunny_cdn_host: 'vz-demo.b-cdn.net', has_bunny_key: true, has_elevenlabs_key: false }
    };
  }

  boot();
})();
