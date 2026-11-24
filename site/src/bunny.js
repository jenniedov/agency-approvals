// Bunny Stream calls. The library key is read from settings (encrypted) on each use.
import { unseal } from './lib.js';

const API = 'https://api.bunny.net';
const VIDEO = 'https://video.bunnycdn.com';

async function call(url, key, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { AccessKey: key, accept: 'application/json', ...(opts.headers || {}) } });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) { const e = new Error(`bunny ${r.status}`); e.status = r.status; e.body = body; throw e; }
  return body;
}

// Setup: create a library with the account key, keep only the library key and CDN host.
export async function createLibrary(accountKey, name) {
  const lib = await call(`${API}/videolibrary`, accountKey, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Name: name, ReplicationRegions: [] }),
  });
  // MP4 fallback so a plain <video> plays everywhere; no referrer lock so the agency's own domain is free to change
  await call(`${API}/videolibrary/${lib.Id}`, accountKey, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ EnableMP4Fallback: true, KeepOriginalFiles: true, AllowDirectPlay: true, EnabledResolutions: '360p,480p,720p,1080p' }),
  }).catch(() => null);
  let cdn = null;
  try {
    const pz = await call(`${API}/pullzone/${lib.PullZoneId}`, accountKey);
    const h = (pz.Hostnames || []).find((x) => /b-cdn\.net$/.test(x.Value)) || (pz.Hostnames || [])[0];
    cdn = h ? h.Value : null;
  } catch { /* filled in later from settings */ }
  return { id: String(lib.Id), key: lib.ApiKey, cdn };
}

export async function libraryKey(env, settings) {
  return unseal(env, settings.bunny_key_enc);
}

export async function createVideo(env, settings, title, collectionId) {
  const key = await libraryKey(env, settings);
  const lib = settings.bunny_library_id;
  const v = await call(`${VIDEO}/library/${lib}/videos`, key, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, ...(collectionId ? { collectionId } : {}) }),
  });
  return { guid: v.guid, library_id: lib, upload_url: `${VIDEO}/library/${lib}/videos/${v.guid}`, headers: { AccessKey: key } };
}

export async function getVideo(env, settings, guid) {
  const key = await libraryKey(env, settings);
  return call(`${VIDEO}/library/${settings.bunny_library_id}/videos/${guid}`, key);
}

export async function setThumbnail(env, settings, guid, bytes, contentType) {
  const key = await libraryKey(env, settings);
  await call(`${VIDEO}/library/${settings.bunny_library_id}/videos/${guid}/thumbnail`, key, {
    method: 'POST', headers: { 'content-type': contentType || 'image/jpeg' }, body: bytes,
  });
  const v = await getVideo(env, settings, guid);
  return v.thumbnailFileName || 'thumbnail.jpg';
}

export async function setThumbnailTime(env, settings, guid, seconds) {
  const key = await libraryKey(env, settings);
  await call(`${VIDEO}/library/${settings.bunny_library_id}/videos/${guid}`, key, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ thumbnailTime: Math.round(seconds * 1000) }),
  });
}

export function playback(settings, guid, height) {
  // demo videos ship with the site (public/demo) so a fresh install shows something before the first upload
  if (guid && guid.startsWith('demo-')) return { mp4: [`/demo/${guid}.mp4`], hls: null, thumb: `/demo/${guid}.jpg`, embed: null };
  // no Bunny library: the file sits in the Worker's own R2 bucket (binding MEDIA) and the Worker streams it to logged-in people or share links
  if (guid && guid.startsWith('r2-')) return { mp4: [`/media/${guid}.mp4`], hls: null, thumb: null, embed: null };
  const cdn = settings.bunny_cdn_host;
  if (!cdn || !guid) return null;
  const h = height || 1080;
  const sizes = [720, 480, 360].filter((s) => s <= Math.max(h, 360));
  return {
    mp4: sizes.map((s) => `https://${cdn}/${guid}/play_${s}p.mp4`),
    hls: `https://${cdn}/${guid}/playlist.m3u8`,
    thumb: `https://${cdn}/${guid}/thumbnail.jpg`,
    embed: `https://iframe.mediadelivery.net/embed/${settings.bunny_library_id}/${guid}?autoplay=false&responsive=true`,
  };
}
