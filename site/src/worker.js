// Agency approvals: one Worker (API + screens) and one D1 per agency. See docs/ARCHITECTURE.md and docs/API.md.
import { json, err, randomToken, hashPassword, checkPassword, makeSession, readSession, sessionCookie, seal, unseal, safeEqual, slugify } from './lib.js';
import * as bunny from './bunny.js';

const PARTS = { video: 'video_state', caption: 'caption_state', cover: 'cover_state' };
const STATES = ['pending', 'approved', 'changes'];
const STAGES = ['editing', 'review', 'client', 'approved', 'scheduled', 'published'];

// ---------- data helpers
const all = (db, sql, ...b) => db.prepare(sql).bind(...b).all().then((r) => r.results);
const one = (db, sql, ...b) => db.prepare(sql).bind(...b).first();

async function getSettings(env) {
  const rows = await all(env.DB, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
async function putSetting(env, key, value) {
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).bind(key, value).run();
}
const brandOf = (s, env) => ({ name: s.agency_name || env.APP_NAME || 'Approvals' });

function shareUrl(req, token) { return `${new URL(req.url).origin}/c/${token}`; }
function clientOut(req, c) { return c && { ...c, share_url: shareUrl(req, c.share_token) }; }

async function addEvent(env, kind, { post_id = null, client_id = null, actor = null, body = null } = {}) {
  await env.DB.prepare('INSERT INTO events (kind, post_id, client_id, actor, body) VALUES (?,?,?,?,?)').bind(kind, post_id, client_id, actor, body).run();
}

// Posts with their current version, version list and comments, in as few queries as possible.
async function expandPosts(env, settings, posts) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const q = ids.map(() => '?').join(',');
  const [versions, comments, covers] = await Promise.all([
    all(env.DB, `SELECT * FROM versions WHERE post_id IN (${q}) ORDER BY n DESC`, ...ids),
    all(env.DB, `SELECT * FROM comments WHERE post_id IN (${q}) ORDER BY COALESCE(at_sec, 1e9), id`, ...ids),
    all(env.DB, `SELECT id, post_id, token, note, chosen, created_at FROM cover_options WHERE post_id IN (${q}) ORDER BY id`, ...ids),
  ]);
  return posts.map((p) => {
    const vs = versions.filter((v) => v.post_id === p.id);
    const cur = vs.find((v) => v.id === p.current_version_id) || vs[0] || null;
    const short = cur ? Math.min(cur.width || 1080, cur.height || 1920) : null;
    return {
      ...p,
      music: p.music ? safeParse(p.music) : null,
      platforms: p.platforms ? safeParse(p.platforms) : null,
      version: cur ? { ...cur, ...bunny.playback(settings, cur.bunny_guid, short) } : null,
      versions: vs.map((v) => ({ id: v.id, n: v.n, note: v.note, created_at: v.created_at })),
      cover_options: covers.filter((o) => o.post_id === p.id).map((o) => ({ id: o.id, url: `/cover/${o.token}.jpg`, note: o.note, chosen: !!o.chosen, created_at: o.created_at })),
      comments: comments.filter((c) => c.post_id === p.id).map((c) => ({ ...c, drawing: c.drawing ? safeParse(c.drawing) : null })),
    };
  });
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return s; } };
const POST_SQL = 'SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON c.id = p.client_id';

async function postById(env, settings, id) {
  const p = await one(env.DB, `${POST_SQL} WHERE p.id = ?`, +id);
  return p ? (await expandPosts(env, settings, [p]))[0] : null;
}

// three approvals → stage
async function settleStage(env, id) {
  const p = await one(env.DB, 'SELECT * FROM posts WHERE id = ?', id);
  if (!p) return;
  let stage = p.stage;
  // a story has no caption or cover to approve: the video alone decides
  const states = p.kind === 'story' ? [p.video_state] : [p.video_state, p.caption_state, p.cover_state];
  if (states.includes('changes')) stage = 'editing';
  else if (states.every((s) => s === 'approved') && ['editing', 'review', 'client'].includes(p.stage) && p.client_state !== 'pending') stage = 'approved';
  else if (p.stage === 'approved' && !states.every((s) => s === 'approved')) stage = 'review';
  if (stage !== p.stage) {
    await env.DB.prepare("UPDATE posts SET stage=?, updated_at=datetime('now') WHERE id=?").bind(stage, id).run();
    if (stage === 'approved') await addEvent(env, 'approved', { post_id: id, client_id: p.client_id });
  }
}

// ---------- login rate limit: 8 tries per 15 minutes per email and per IP
async function limited(env, key) {
  const r = await one(env.DB, "SELECT n, (julianday('now') - julianday(window_start)) * 1440 AS mins FROM login_attempts WHERE key = ?", key);
  if (r && r.mins < 15 && r.n >= 8) return true;
  if (!r || r.mins >= 15) await env.DB.prepare("INSERT INTO login_attempts (key, n, window_start) VALUES (?, 1, datetime('now')) ON CONFLICT(key) DO UPDATE SET n=1, window_start=datetime('now')").bind(key).run();
  else await env.DB.prepare('UPDATE login_attempts SET n = n + 1 WHERE key = ?').bind(key).run();
  return false;
}

// ---------- page routes
async function servePage(env, req, file) {
  const r = await env.ASSETS.fetch(new Request(new URL(file, req.url)));
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      console.error(e && e.stack || e, e && e.body);
      return json({ error: 'server', detail: String(e && e.message || e), bunny: e && e.body || undefined }, e && e.status === 401 ? 502 : 500);
    }
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  const method = req.method;
  let m;

  if ((m = p.match(/^\/c\/([\w-]{10,})\/?$/))) {
    const c = await one(env.DB, 'SELECT id FROM clients WHERE share_token = ? AND archived = 0', m[1]);
    if (!c) return new Response('הקישור לא נמצא', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return servePage(env, req, '/client.html');
  }
  if (p === '/foryou' || p === '/foryou/') return servePage(env, req, '/foryou.html');
  if ((m = p.match(/^\/cover\/([\w-]{12,})\.jpg$/))) {
    const o = await one(env.DB, 'SELECT image FROM cover_options WHERE token = ?', m[1]);
    if (!o) return new Response('not found', { status: 404 });
    if (!o.image.startsWith('data:')) return Response.redirect(new URL(o.image, req.url).toString(), 302);
    const [head, b64] = o.image.split(',');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'content-type': (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if ((m = p.match(/^\/media\/(r2-[\w-]+)\.mp4$/)) && (method === 'GET' || method === 'HEAD')) {
    // R2 video: a logged-in team member, or an end-client share link whose client owns a post with this video
    let ok = !!(await readSession(env, req).catch(() => null));
    const t = url.searchParams.get('t');
    if (!ok && t) ok = !!(await one(env.DB, 'SELECT 1 AS y FROM versions v JOIN posts po ON po.id = v.post_id JOIN clients c ON c.id = po.client_id WHERE v.bunny_guid = ? AND c.share_token = ? AND c.archived = 0', m[1], t));
    if (!ok) return new Response('login', { status: 403 });
    return serveMedia(env, req, m[1]);
  }
  if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);

  // Cheap CSRF guard: browser writes must be JSON (a cross-site form cannot send that without a preflight).
  const ctype = req.headers.get('content-type') || '';
  if (method !== 'GET' && !p.startsWith('/api/agent/') && ctype && !ctype.includes('application/json')) return err('json_only', 415);
  const settings = await getSettings(env).catch((e) => { throw Object.assign(new Error('schema: run the migrations (--remote)'), { cause: e }); });
  const body = async () => (method === 'GET' ? {} : req.json().catch(() => ({})));

  // ---------- agent (Claude on the Mac)
  if (p.startsWith('/api/agent/')) {
    const auth = req.headers.get('authorization') || '';
    if (!env.AGENT_TOKEN || !safeEqual(auth, `Bearer ${env.AGENT_TOKEN}`)) return err('auth', 401);
    return agentRoutes(req, env, settings, p.slice('/api/agent'.length), body);
  }

  // ---------- end-client (token link, no login)
  if ((m = p.match(/^\/api\/c\/([\w-]{10,})(\/.*)?$/))) {
    const client = await one(env.DB, 'SELECT * FROM clients WHERE share_token = ? AND archived = 0', m[1]);
    if (!client) return err('not_found', 404);
    const rest = m[2] || '';
    if (rest === '' && method === 'GET') {
      const posts = await all(env.DB, `${POST_SQL} WHERE p.client_id = ? AND (p.client_state = 'pending' OR (p.client_state = 'approved' AND p.updated_at > datetime('now','-30 days'))) ORDER BY p.client_state = 'pending' DESC, p.updated_at DESC LIMIT 30`, client.id);
      const out = (await expandPosts(env, settings, posts)).map((x) => ({ ...x, version: withToken(x.version, client.share_token), comments: x.comments.filter((c) => c.author_kind === 'client') }));
      return json({ brand: brandOf(settings, env), client: { id: client.id, name: client.name, avatar: client.avatar, handle: client.handle }, posts: out });
    }
    if ((m = rest.match(/^\/posts\/(\d+)\/(approve|comment)$/)) && method === 'POST') {
      const post = await one(env.DB, 'SELECT * FROM posts WHERE id = ? AND client_id = ?', +m[1], client.id);
      if (!post) return err('not_found', 404);
      if (m[2] === 'approve') {
        await env.DB.prepare("UPDATE posts SET client_state='approved', stage=CASE WHEN stage IN ('client','review','editing') THEN 'approved' ELSE stage END, updated_at=datetime('now') WHERE id=?").bind(post.id).run();
        await addEvent(env, 'client_approved', { post_id: post.id, client_id: client.id, actor: client.name });
        return json({ ok: true });
      }
      const b = await body();
      const text = String(b.body || '').trim().slice(0, 4000);
      if (!text) return err('empty');
      await env.DB.prepare('INSERT INTO comments (post_id, version_id, target, at_sec, body, author, author_kind) VALUES (?,?,?,?,?,?,?)')
        .bind(post.id, post.current_version_id, ['video', 'caption', 'cover', 'general'].includes(b.target) ? b.target : 'video', numOrNull(b.at_sec), text, client.name, 'client').run();
      await env.DB.prepare("UPDATE posts SET client_state='changes', updated_at=datetime('now') WHERE id=?").bind(post.id).run();
      await addEvent(env, 'client_comment', { post_id: post.id, client_id: client.id, actor: client.name, body: text.slice(0, 200) });
      return json({ ok: true });
    }
    return err('unknown', 404);
  }

  // ---------- session and setup
  const userCount = (await one(env.DB, 'SELECT COUNT(*) AS n FROM users')).n;
  const uid = await readSession(env, req).catch(() => null);
  const user = uid ? await one(env.DB, 'SELECT id, name, email, role FROM users WHERE id = ?', uid) : null;

  if (p === '/api/session' && method === 'GET') {
    return json({ brand: brandOf(settings, env), setup_needed: userCount === 0, user });
  }

  if (p === '/api/setup' && method === 'POST') {
    if (userCount > 0) return err('already_set_up', 409);
    if (!env.SECRETS_KEY) return err('secrets_key_missing', 500);
    const b = await body();
    // Only the person who ran the install has the setup code (the installer opens the page with it).
    if (!env.SETUP_CODE || !safeEqual(String(b.setup_code || ''), env.SETUP_CODE)) return err('setup_code', 403);
    const email = String(b.email || '').trim(), name = String(b.name || '').trim(), pw = String(b.password || '');
    if (!email.includes('@') || !name || pw.length < 8) return err('bad_owner');
    if (/[\u0590-\u05FF]/.test(name + email + pw)) return err('latin_only');
    // Bunny: an account key creates the library; or an existing library is given.
    if (b.bunny_account_key) {
      try {
        const lib = await bunny.createLibrary(String(b.bunny_account_key).trim(), String(b.agency_name || 'agency').trim().slice(0, 40) + ' videos');
        await putSetting(env, 'bunny_library_id', lib.id);
        await putSetting(env, 'bunny_key_enc', await seal(env, lib.key));
        if (lib.cdn) await putSetting(env, 'bunny_cdn_host', lib.cdn);
      } catch (e) {
        return json({ error: 'bunny_key', status: e.status || null }, 400);
      }
    } else if (b.bunny_library_id && b.bunny_library_key) {
      await putSetting(env, 'bunny_library_id', String(b.bunny_library_id).trim());
      await putSetting(env, 'bunny_key_enc', await seal(env, String(b.bunny_library_key).trim()));
      if (b.bunny_cdn_host) await putSetting(env, 'bunny_cdn_host', cleanHost(b.bunny_cdn_host));
    }
    if (b.elevenlabs_key) await putSetting(env, 'elevenlabs_key_enc', await seal(env, String(b.elevenlabs_key).trim()));
    if (b.agency_name) await putSetting(env, 'agency_name', String(b.agency_name).trim().slice(0, 80));
    const r = await one(env.DB, "INSERT INTO users (email, name, role, pass_hash) VALUES (?, ?, 'owner', ?) RETURNING id, name, email, role", email, name, await hashPassword(pw));
    return json({ ok: true, user: r }, 200, { 'set-cookie': sessionCookie(await makeSession(env, r.id)) });
  }

  if (p === '/api/login' && method === 'POST') {
    const b = await body();
    const email = String(b.email || '').trim().toLowerCase();
    const ip = req.headers.get('cf-connecting-ip') || 'local';
    if ((await limited(env, 'e:' + email)) || (await limited(env, 'i:' + ip))) return err('too_many_tries', 429);
    const u = await one(env.DB, 'SELECT * FROM users WHERE email = ?', email);
    if (!u || !(await checkPassword(String(b.password || ''), u.pass_hash))) return err('bad_login', 401);
    await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind('e:' + email).run();
    return json({ ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role } }, 200, { 'set-cookie': sessionCookie(await makeSession(env, u.id)) });
  }
  if (p === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });

  // ---------- team routes need a user
  if (!user) return err('login', 401);
  const actor = user.name;

  if (p === '/api/overview' && method === 'GET') {
    const [clients, counts, notifications, unread, machine, week] = await Promise.all([
      all(env.DB, 'SELECT * FROM clients WHERE archived = 0 ORDER BY sort, name'),
      all(env.DB, `SELECT client_id, SUM(stage='review') AS review, SUM(stage='client') AS client, SUM(stage='approved') AS approved,
                   SUM(video_state='changes' OR caption_state='changes' OR cover_state='changes' OR client_state='changes') AS changes FROM posts GROUP BY client_id`),
      all(env.DB, 'SELECT e.*, c.name AS client_name, p.title AS post_title FROM events e LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN posts p ON p.id = e.post_id ORDER BY e.id DESC LIMIT 40'),
      one(env.DB, 'SELECT COUNT(*) AS n FROM events WHERE read_at IS NULL'),
      one(env.DB, 'SELECT * FROM machines ORDER BY last_seen DESC LIMIT 1'),
      all(env.DB, `${POST_SQL} WHERE p.scheduled_at IS NOT NULL AND p.scheduled_at BETWEEN datetime('now','-1 day') AND datetime('now','+7 days') ORDER BY p.scheduled_at`),
    ]);
    const byClient = Object.fromEntries(counts.map((c) => [c.client_id, c]));
    return json({
      brand: brandOf(settings, env), user,
      clients: clients.map((c) => ({ ...clientOut(req, c), counts: byClient[c.id] || { review: 0, client: 0, approved: 0, changes: 0 } })),
      notifications, unread: unread.n, machine, week: await expandPosts(env, settings, week),
    });
  }

  if (p === '/api/clients' && method === 'GET') {
    return json({ clients: (await all(env.DB, 'SELECT * FROM clients WHERE archived = 0 ORDER BY sort, name')).map((c) => clientOut(req, c)) });
  }
  if (p === '/api/clients' && method === 'POST') {
    const c = await upsertClient(env, await body());
    return c.error ? err(c.error) : json({ client: clientOut(req, c) });
  }
  if ((m = p.match(/^\/api\/clients\/([\w-]+)$/)) && method === 'PATCH') {
    const c = await upsertClient(env, { ...(await body()), id: m[1] }, true);
    return c.error ? err(c.error) : json({ client: clientOut(req, c) });
  }

  if (p === '/api/feed' && method === 'GET') {
    const stage = url.searchParams.get('stage') || 'review';
    const client = url.searchParams.get('client');
    const stages = stage.split(',').filter((s) => STAGES.includes(s));
    if (!stages.length) return err('stage');
    const q = stages.map(() => '?').join(',');
    const posts = await all(env.DB, `${POST_SQL} WHERE c.archived = 0 AND p.stage IN (${q}) ${client ? 'AND p.client_id = ?' : ''} ORDER BY c.sort, c.name, p.id DESC`, ...stages, ...(client ? [client] : []));
    const full = await expandPosts(env, settings, posts);
    const clients = await all(env.DB, 'SELECT * FROM clients WHERE archived = 0 ORDER BY sort, name');
    const groups = clients.map((c) => ({ client: clientOut(req, c), posts: full.filter((x) => x.client_id === c.id) })).filter((g) => g.posts.length);
    return json({ groups });
  }

  if (p === '/api/posts' && method === 'GET') {
    const client = url.searchParams.get('client');
    const posts = await all(env.DB, `${POST_SQL} ${client ? 'WHERE p.client_id = ?' : ''} ORDER BY p.id DESC LIMIT 300`, ...(client ? [client] : []));
    return json({ posts: await expandPosts(env, settings, posts) });
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)$/))) {
    const id = +m[1];
    if (method === 'GET') { const post = await postById(env, settings, id); return post ? json({ post }) : err('not_found', 404); }
    if (method === 'PATCH') {
      const b = await body();
      const sets = [], vals = [];
      if (typeof b.title === 'string') { sets.push('title=?'); vals.push(b.title.slice(0, 200)); }
      if (typeof b.caption === 'string') { sets.push('caption=?'); vals.push(b.caption.slice(0, 5000)); }
      if (b.music !== undefined) { sets.push('music=?'); vals.push(b.music ? JSON.stringify(b.music) : null); }
      if (b.scheduled_at !== undefined) { sets.push('scheduled_at=?'); vals.push(b.scheduled_at || null); }
      if (b.stage && STAGES.includes(b.stage)) { sets.push('stage=?'); vals.push(b.stage); }
      if (!sets.length) return err('nothing');
      await env.DB.prepare(`UPDATE posts SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
      return json({ post: await postById(env, settings, id) });
    }
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/state$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    if (!PARTS[b.part] || !STATES.includes(b.state)) return err('bad');
    await env.DB.prepare(`UPDATE posts SET ${PARTS[b.part]}=?, updated_at=datetime('now') WHERE id=?`).bind(b.state, id).run();
    await settleStage(env, id);
    return json({ post: await postById(env, settings, id) });
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/cover\/choose$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    const o = await one(env.DB, 'SELECT * FROM cover_options WHERE id = ? AND post_id = ?', +b.option_id, id);
    if (!o) return err('not_found', 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE cover_options SET chosen = (id = ?) WHERE post_id = ?').bind(o.id, id),
      env.DB.prepare("UPDATE posts SET cover_url=?, cover_state='approved', updated_at=datetime('now') WHERE id=?").bind(`/cover/${o.token}.jpg`, id),
    ]);
    // best effort: the chosen cover also becomes the Bunny thumbnail
    const v = await one(env.DB, 'SELECT v.bunny_guid FROM posts p JOIN versions v ON v.id = p.current_version_id WHERE p.id = ?', id);
    if (v && settings.bunny_key_enc && o.image.startsWith('data:') && isBunny(v.bunny_guid)) {
      const bytes = Uint8Array.from(atob(o.image.split(',')[1]), (c) => c.charCodeAt(0));
      await bunny.setThumbnail(env, settings, v.bunny_guid, bytes, 'image/jpeg').catch((e) => console.error('thumb', e));
    }
    await settleStage(env, id);
    return json({ post: await postById(env, settings, id) });
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/comments$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    const post = await one(env.DB, 'SELECT * FROM posts WHERE id = ?', id);
    if (!post) return err('not_found', 404);
    const text = String(b.body || '').trim().slice(0, 4000);
    if (!text) return err('empty');
    const c = await one(env.DB, 'INSERT INTO comments (post_id, version_id, target, at_sec, body, drawing, author, author_kind, cover_option_id) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *',
      id, post.current_version_id, ['video', 'caption', 'cover', 'music', 'general'].includes(b.target) ? b.target : 'video', numOrNull(b.at_sec), text, b.drawing ? JSON.stringify(b.drawing).slice(0, 200000) : null, actor, 'team', b.cover_option_id ? +b.cover_option_id : null);
    if (b.target === 'cover') { await env.DB.prepare("UPDATE posts SET cover_state='changes', updated_at=datetime('now') WHERE id=?").bind(id).run(); await settleStage(env, id); }
    return json({ comment: { ...c, drawing: b.drawing || null } });
  }
  if ((m = p.match(/^\/api\/comments\/(\d+)$/))) {
    const id = +m[1];
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    if (method === 'PATCH') {
      const b = await body(); const sets = [], vals = [];
      if (typeof b.body === 'string' && b.body.trim()) { sets.push('body=?'); vals.push(b.body.trim().slice(0, 4000)); }
      if (b.at_sec !== undefined) { sets.push('at_sec=?'); vals.push(numOrNull(b.at_sec)); }
      if (b.drawing !== undefined) { sets.push('drawing=?'); vals.push(b.drawing ? JSON.stringify(b.drawing).slice(0, 200000) : null); }
      if (['open', 'done'].includes(b.status)) { sets.push('status=?'); vals.push(b.status); }
      if (!sets.length) return err('nothing');
      const c = await one(env.DB, `UPDATE comments SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=? RETURNING *`, ...vals, id);
      return c ? json({ comment: { ...c, drawing: c.drawing ? safeParse(c.drawing) : null } }) : err('not_found', 404);
    }
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/share$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    const post = await one(env.DB, 'SELECT * FROM posts WHERE id = ?', id);
    if (!post) return err('not_found', 404);
    const target = await one(env.DB, 'SELECT * FROM clients WHERE id = ?', b.client_id || post.client_id);
    if (!target) return err('client', 404);
    if (target.id === post.client_id) {
      await env.DB.prepare("UPDATE posts SET client_state='pending', stage=CASE WHEN stage IN ('editing','review','approved') THEN 'client' ELSE stage END, updated_at=datetime('now') WHERE id=?").bind(id).run();
    }
    await addEvent(env, 'shared', { post_id: id, client_id: target.id, actor, body: target.id === post.client_id ? null : 'shared with another client' });
    return json({ ok: true, url: shareUrl(req, target.share_token) });
  }
  if (p === '/api/notifications/read' && method === 'POST') {
    const b = await body();
    if (Array.isArray(b.ids) && b.ids.length) await env.DB.prepare(`UPDATE events SET read_at=datetime('now') WHERE id IN (${b.ids.map(() => '?').join(',')})`).bind(...b.ids.map(Number)).run();
    else await env.DB.prepare("UPDATE events SET read_at=datetime('now') WHERE read_at IS NULL").run();
    return json({ ok: true });
  }
  if (p === '/api/tracks') {
    if (method === 'GET') return json({ tracks: await all(env.DB, 'SELECT * FROM tracks ORDER BY source, title') });
    if (method === 'POST') {
      const b = await body();
      if (!String(b.title || '').trim()) return err('title');
      const t = await one(env.DB, 'INSERT INTO tracks (title, artist, source, url) VALUES (?,?,?,?) RETURNING *', String(b.title).trim().slice(0, 200), b.artist || null, b.source === 'instagram' ? 'instagram' : 'library', b.url || null);
      return json({ track: t });
    }
  }
  if (p === '/api/settings') {
    if (method === 'GET') {
      return json({ agency_name: settings.agency_name || '', bunny_library_id: settings.bunny_library_id || '', bunny_cdn_host: settings.bunny_cdn_host || '', has_bunny_key: !!settings.bunny_key_enc, has_elevenlabs_key: !!settings.elevenlabs_key_enc });
    }
    if (method === 'POST') {
      if (user.role !== 'owner') return err('owner_only', 403);
      const b = await body();
      if (b.agency_name) await putSetting(env, 'agency_name', String(b.agency_name).trim().slice(0, 80));
      if (b.bunny_account_key) {
        try {
          const lib = await bunny.createLibrary(String(b.bunny_account_key).trim(), (settings.agency_name || 'agency') + ' videos');
          await putSetting(env, 'bunny_library_id', lib.id); await putSetting(env, 'bunny_key_enc', await seal(env, lib.key));
          if (lib.cdn) await putSetting(env, 'bunny_cdn_host', lib.cdn);
        } catch (e) { return json({ error: 'bunny_key', status: e.status || null }, 400); }
      }
      if (b.bunny_library_id) await putSetting(env, 'bunny_library_id', String(b.bunny_library_id).trim());
      if (b.bunny_library_key) await putSetting(env, 'bunny_key_enc', await seal(env, String(b.bunny_library_key).trim()));
      if (b.bunny_cdn_host) await putSetting(env, 'bunny_cdn_host', cleanHost(b.bunny_cdn_host));
      if (b.elevenlabs_key) await putSetting(env, 'elevenlabs_key_enc', await seal(env, String(b.elevenlabs_key).trim()));
      return json({ ok: true });
    }
  }
  return err('unknown', 404);
}

const urlOf = (req) => new URL(req.url);
const isBunny = (guid) => !!guid && !guid.startsWith('demo-') && !guid.startsWith('r2-');
const mediaKey = (guid) => `video/${guid}.mp4`;
function withToken(version, token) {
  if (!version || !String(version.bunny_guid || '').startsWith('r2-')) return version;
  return { ...version, mp4: (version.mp4 || []).map((u) => `${u}?t=${encodeURIComponent(token)}`) };
}
function downloadUrl(settings, origin, guid, height) {
  if (!guid) return null;
  if (guid.startsWith('r2-')) return `${origin}/api/agent/media/${guid}.mp4`;
  const pb = bunny.playback(settings, guid, height);
  return pb && pb.mp4[0] ? new URL(pb.mp4[0], origin).toString() : null;
}

// Stream an R2 video with HTTP Range (Safari on iPhone will not play a video without 206 answers).
async function serveMedia(env, req, guid) {
  if (!env.MEDIA) return new Response('no media bucket', { status: 404 });
  const key = mediaKey(guid);
  const head = await env.MEDIA.head(key);
  if (!head) return new Response('not found', { status: 404 });
  const size = head.size;
  const base = { 'content-type': (head.httpMetadata && head.httpMetadata.contentType) || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', etag: head.httpEtag };
  const rh = req.headers.get('range');
  let range = null;
  const rm = rh && rh.match(/^bytes=(\d*)-(\d*)$/);
  if (rm && (rm[1] !== '' || rm[2] !== '')) {
    let start, end;
    if (rm[1] === '') { const n = Math.min(+rm[2], size); start = size - n; end = size - 1; }
    else { start = +rm[1]; end = rm[2] === '' ? size - 1 : Math.min(+rm[2], size - 1); }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
    range = { offset: start, length: end - start + 1 };
  }
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...base, 'content-length': String(size) } });
  const obj = await env.MEDIA.get(key, range ? { range } : {});
  if (!obj) return new Response('not found', { status: 404 });
  if (!range) return new Response(obj.body, { status: 200, headers: { ...base, 'content-length': String(size) } });
  return new Response(obj.body, { status: 206, headers: { ...base, 'content-length': String(range.length), 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` } });
}

const numOrNull = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : Math.max(0, +v));
const cleanHost = (h) => String(h).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

async function upsertClient(env, b, patchOnly = false) {
  const id = b.id ? slugify(b.id) : slugify(b.handle || b.name);
  const existing = await one(env.DB, 'SELECT * FROM clients WHERE id = ?', id);
  if (patchOnly && !existing) return { error: 'not_found' };
  const f = ['name', 'handle', 'profile_url', 'avatar', 'bio', 'color'];
  if (existing) {
    const sets = [], vals = [];
    for (const k of f) if (typeof b[k] === 'string') { sets.push(`${k}=?`); vals.push(b[k].slice(0, k === 'avatar' ? 400000 : 2000)); }
    if (b.sort !== undefined) { sets.push('sort=?'); vals.push(+b.sort || 0); }
    if (b.archived !== undefined) { sets.push('archived=?'); vals.push(b.archived ? 1 : 0); }
    if (sets.length) await env.DB.prepare(`UPDATE clients SET ${sets.join(',')} WHERE id=?`).bind(...vals, id).run();
    return one(env.DB, 'SELECT * FROM clients WHERE id = ?', id);
  }
  if (!String(b.name || '').trim()) return { error: 'name' };
  return one(env.DB, 'INSERT INTO clients (id, name, handle, profile_url, avatar, bio, color, share_token) VALUES (?,?,?,?,?,?,?,?) RETURNING *',
    id, String(b.name).trim().slice(0, 120), b.handle || null, b.profile_url || null, b.avatar ? String(b.avatar).slice(0, 400000) : null, b.bio || null, b.color || null, randomToken(18));
}

// ---------- agent routes (bearer AGENT_TOKEN)
async function agentRoutes(req, env, settings, p, body) {
  const method = req.method;
  let m;
  if (p === '/beat' && method === 'POST') {
    const b = await body();
    await env.DB.prepare("INSERT INTO machines (name, detail, last_seen) VALUES (?, ?, datetime('now')) ON CONFLICT(name) DO UPDATE SET detail=excluded.detail, last_seen=excluded.last_seen").bind(String(b.machine || 'mac').slice(0, 80), b.detail ? String(b.detail).slice(0, 500) : null).run();
    return json({ ok: true });
  }
  if (p === '/inbox' && method === 'GET') {
    const comments = await all(env.DB, `SELECT cm.*, p.title AS post_title, p.client_id, c.name AS client_name, v.n AS version_n
      FROM comments cm JOIN posts p ON p.id = cm.post_id JOIN clients c ON c.id = p.client_id LEFT JOIN versions v ON v.id = cm.version_id
      WHERE cm.status = 'open' ORDER BY p.client_id, cm.post_id, COALESCE(cm.at_sec, 1e9)`);
    const changes = await all(env.DB, `${POST_SQL} WHERE p.video_state='changes' OR p.caption_state='changes' OR p.cover_state='changes' OR p.client_state='changes' ORDER BY p.id`);
    return json({ comments, changes });
  }
  if (p === '/clients' && method === 'POST') {
    const c = await upsertClient(env, await body());
    return c.error ? err(c.error) : json({ client: clientOut(req, c) });
  }
  if (p === '/clients' && method === 'GET') {
    return json({ clients: (await all(env.DB, 'SELECT * FROM clients ORDER BY sort, name')).map((c) => clientOut(req, c)) });
  }
  if (p === '/posts' && method === 'POST') {
    const b = await body();
    if (!b.client_id || !b.title) return err('bad');
    if (!(await one(env.DB, 'SELECT id FROM clients WHERE id = ?', b.client_id))) return err('client', 404);
    const post = await one(env.DB, 'INSERT INTO posts (client_id, title, kind, orientation, caption, platforms, scheduled_at) VALUES (?,?,?,?,?,?,?) RETURNING *',
      b.client_id, String(b.title).slice(0, 200), ['reel', 'story', 'short', 'long', 'post'].includes(b.kind) ? b.kind : 'reel',
      b.orientation === 'horizontal' ? 'horizontal' : 'vertical', b.caption || null, b.platforms ? JSON.stringify(b.platforms) : null, b.scheduled_at || null);
    return json({ post });
  }
  if (p === '/bunny/video' && method === 'POST') {
    if (!settings.bunny_key_enc) return err('bunny_not_set', 409);
    const b = await body();
    return json(await bunny.createVideo(env, settings, String(b.title || 'video').slice(0, 200), b.collection));
  }
  if ((m = p.match(/^\/bunny\/video\/([\w-]+)$/)) && method === 'GET') {
    return json(await bunny.getVideo(env, settings, m[1]));
  }
  if ((m = p.match(/^\/posts\/(\d+)\/versions$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    const post = await one(env.DB, 'SELECT * FROM posts WHERE id = ?', id);
    if (!post || !b.bunny_guid) return err('bad');
    const n = ((await one(env.DB, 'SELECT MAX(n) AS n FROM versions WHERE post_id = ?', id)).n || 0) + 1;
    const v = await one(env.DB, 'INSERT INTO versions (post_id, n, bunny_guid, duration, width, height, note) VALUES (?,?,?,?,?,?,?) RETURNING *',
      id, n, String(b.bunny_guid), numOrNull(b.duration), b.width ? +b.width : null, b.height ? +b.height : null, b.note || null);
    const cover = post.cover_url || (settings.bunny_cdn_host && isBunny(v.bunny_guid) ? `https://${settings.bunny_cdn_host}/${v.bunny_guid}/thumbnail.jpg` : null);
    await env.DB.prepare(`UPDATE posts SET current_version_id=?, stage='review', video_state='pending', client_state=CASE WHEN client_state='approved' THEN 'none' ELSE client_state END,
      cover_url=COALESCE(?, cover_url), updated_at=datetime('now') WHERE id=?`).bind(v.id, post.cover_url ? null : cover, id).run();
    await addEvent(env, n === 1 ? 'new_video' : 'new_version', { post_id: id, client_id: post.client_id, actor: 'claude', body: b.note || null });
    return json({ version: v });
  }
  if ((m = p.match(/^\/posts\/(\d+)$/)) && method === 'PATCH') {
    const id = +m[1], b = await body();
    const post = await one(env.DB, 'SELECT p.*, v.bunny_guid FROM posts p LEFT JOIN versions v ON v.id = p.current_version_id WHERE p.id = ?', id);
    if (!post) return err('not_found', 404);
    const sets = [], vals = [];
    if (typeof b.caption === 'string') { sets.push("caption=?, caption_state='pending'"); vals.push(b.caption.slice(0, 5000)); }
    if (typeof b.title === 'string') { sets.push('title=?'); vals.push(b.title.slice(0, 200)); }
    if (b.music !== undefined) { sets.push('music=?'); vals.push(b.music ? JSON.stringify(b.music) : null); }
    if (b.scheduled_at !== undefined) { sets.push('scheduled_at=?'); vals.push(b.scheduled_at || null); }
    if (b.cover_time !== undefined && post.bunny_guid && isBunny(post.bunny_guid)) {
      await bunny.setThumbnailTime(env, settings, post.bunny_guid, +b.cover_time);
      sets.push("cover_url=?, cover_state='pending'"); vals.push(`https://${settings.bunny_cdn_host}/${post.bunny_guid}/thumbnail.jpg?t=${Date.now()}`);
    }
    if (sets.length) await env.DB.prepare(`UPDATE posts SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
    await settleStage(env, id);
    return json({ post: await postById(env, settings, id) });
  }
  if ((m = p.match(/^\/posts\/(\d+)\/cover$/)) && method === 'POST') {
    const id = +m[1];
    const post = await one(env.DB, 'SELECT p.*, v.bunny_guid FROM posts p LEFT JOIN versions v ON v.id = p.current_version_id WHERE p.id = ?', id);
    if (!post || !post.bunny_guid) return err('no_version', 409);
    if (!isBunny(post.bunny_guid)) return err('bunny_only', 409);
    const file = await bunny.setThumbnail(env, settings, post.bunny_guid, await req.arrayBuffer(), req.headers.get('content-type'));
    const coverUrl = `https://${settings.bunny_cdn_host}/${post.bunny_guid}/${file}?t=${Date.now()}`;
    await env.DB.prepare("UPDATE posts SET cover_url=?, cover_state='pending', updated_at=datetime('now') WHERE id=?").bind(coverUrl, id).run();
    await settleStage(env, id);
    return json({ cover_url: coverUrl });
  }
  if ((m = p.match(/^\/posts\/(\d+)\/cover-options$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    if (!(await one(env.DB, 'SELECT id FROM posts WHERE id = ?', id))) return err('not_found', 404);
    const img = String(b.image || '');
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 1_500_000) return err('image');
    const o = await one(env.DB, 'INSERT INTO cover_options (post_id, token, image, note) VALUES (?,?,?,?) RETURNING id, token, note', id, randomToken(16), img, b.note ? String(b.note).slice(0, 300) : null);
    await env.DB.prepare("UPDATE posts SET cover_state='pending', updated_at=datetime('now') WHERE id=?").bind(id).run();
    await settleStage(env, id);
    if (b.notify !== false) await addEvent(env, 'new_cover', { post_id: id, actor: 'claude', body: b.note || null });
    return json({ option: { id: o.id, url: `/cover/${o.token}.jpg`, note: o.note } });
  }
  if ((m = p.match(/^\/comments\/(\d+)\/done$/)) && method === 'POST') {
    const b = await body();
    await env.DB.prepare("UPDATE comments SET status='done', done_note=?, updated_at=datetime('now') WHERE id=?").bind(b.note || null, +m[1]).run();
    return json({ ok: true });
  }
  if (p === '/storage' && method === 'GET') {
    return json({ bunny: !!settings.bunny_key_enc, r2: !!env.MEDIA });
  }
  if (p === '/r2/upload' && method === 'PUT') {
    // the file streams straight into R2 (Worker body limit: 100 MB on the free plan)
    if (!env.MEDIA) return err('r2_not_bound', 409);
    const size = +(req.headers.get('content-length') || 0);
    if (!size || !req.body) return err('content_length');
    if (size > 100 * 1024 * 1024) return err('too_big', 413);
    const guid = 'r2-' + randomToken(12).replace(/[^\w-]/g, '').toLowerCase();
    await env.MEDIA.put(mediaKey(guid), req.body, { httpMetadata: { contentType: req.headers.get('x-content-type') || 'video/mp4' }, customMetadata: { name: String(urlOf(req).searchParams.get('name') || '').slice(0, 200) } });
    return json({ guid, size });
  }
  if ((m = p.match(/^\/media\/(r2-[\w-]+)\.mp4$/)) && (method === 'GET' || method === 'HEAD')) {
    return serveMedia(env, req, m[1]);
  }
  if (p === '/approved' && method === 'GET') {
    // posts whose video is approved and that are not scheduled or out yet (?all=1: every approved video)
    const everything = urlOf(req).searchParams.get('all') === '1';
    const kind = urlOf(req).searchParams.get('kind');
    const rows = await all(env.DB, `SELECT p.id, p.title, p.kind, p.client_id, c.name AS client_name, p.stage, p.scheduled_at, p.caption, p.updated_at,
        v.n AS version_n, v.bunny_guid, v.duration, v.width, v.height
      FROM posts p JOIN clients c ON c.id = p.client_id LEFT JOIN versions v ON v.id = p.current_version_id
      WHERE p.video_state = 'approved' ${everything ? '' : "AND p.stage NOT IN ('scheduled','published')"} ${kind ? 'AND p.kind = ?' : ''}
      ORDER BY p.client_id, p.id`, ...(kind ? [kind] : []));
    const origin = urlOf(req).origin;
    return json({ posts: rows.map((r) => ({ ...r, download_url: downloadUrl(settings, origin, r.bunny_guid, r.height) })) });
  }
  if ((m = p.match(/^\/posts\/(\d+)\/scheduled$/)) && method === 'POST') {
    const id = +m[1], b = await body();
    const post = await one(env.DB, 'SELECT * FROM posts WHERE id = ?', id);
    if (!post) return err('not_found', 404);
    const at = b.at ? String(b.at).slice(0, 40) : null;
    await env.DB.prepare("UPDATE posts SET stage='scheduled', scheduled_at=COALESCE(?, scheduled_at), updated_at=datetime('now') WHERE id=?").bind(at, id).run();
    await addEvent(env, 'scheduled', { post_id: id, client_id: post.client_id, actor: 'claude', body: at });
    return json({ post: await one(env.DB, `${POST_SQL} WHERE p.id = ?`, id) });
  }
  if (p === '/secrets' && method === 'GET') {
    return json({ elevenlabs_key: await unseal(env, settings.elevenlabs_key_enc).catch(() => null) });
  }
  if (p === '/settings' && method === 'POST') { // installer: set Bunny / ElevenLabs without the UI
    const b = await body();
    if (b.bunny_library_id) await putSetting(env, 'bunny_library_id', String(b.bunny_library_id));
    if (b.bunny_library_key) await putSetting(env, 'bunny_key_enc', await seal(env, String(b.bunny_library_key)));
    if (b.bunny_cdn_host) await putSetting(env, 'bunny_cdn_host', cleanHost(b.bunny_cdn_host));
    if (b.elevenlabs_key) await putSetting(env, 'elevenlabs_key_enc', await seal(env, String(b.elevenlabs_key)));
    if (b.agency_name) await putSetting(env, 'agency_name', String(b.agency_name));
    return json({ ok: true });
  }
  return err('unknown', 404);
}
