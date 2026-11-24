// Small helpers: responses, crypto (password hash, signed cookie, encrypted settings).
export const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), {
  status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h },
});
export const err = (code, s = 400) => json({ error: code }, s);

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 18) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function rawKey(secret, label) {
  if (!secret) throw new Error('SECRETS_KEY missing');
  return crypto.subtle.digest('SHA-256', enc.encode(label + ':' + secret));
}

// ---- passwords (PBKDF2; iterations kept low enough for the free plan CPU limit, logins are rate limited)
const ITER = 20000;
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(bits)}`;
}
export async function checkPassword(pw, stored) {
  const [, iter, salt, hash] = String(stored).split('$');
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: +iter }, key, 256);
  return safeEqual(b64(bits), hash);
}
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---- signed session cookie: <uid>.<expires>.<hmac>
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', await rawKey(secret, 'cookie'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export async function makeSession(env, uid, days = 30) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const v = `${uid}.${exp}`;
  return `${v}.${await hmac(env.SECRETS_KEY, v)}`;
}
export async function readSession(env, req) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)s=([^;]+)/);
  if (!m) return null;
  const [uid, exp, sig] = m[1].split('.');
  if (!uid || !exp || !sig || +exp < Date.now() / 1000) return null;
  if (!safeEqual(sig, await hmac(env.SECRETS_KEY, `${uid}.${exp}`))) return null;
  return +uid;
}
export const sessionCookie = (v, maxAge = 30 * 86400) =>
  `s=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ---- encrypted values in the settings table (AES-GCM, key from SECRETS_KEY)
async function aesKey(secret) {
  return crypto.subtle.importKey('raw', await rawKey(secret, 'settings'), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env.SECRETS_KEY), enc.encode(plain));
  return `gcm$${b64(iv)}$${b64(ct)}`;
}
export async function unseal(env, sealed) {
  if (!sealed) return null;
  const [, iv, ct] = sealed.split('$');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env.SECRETS_KEY), unb64(ct));
  return dec.decode(pt);
}

export function slugify(s) {
  const base = String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'client-' + randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '');
}
