/* Public, view-only stories page: /s/<token>. Same viewer as the approval screen (stories.js) with readonly: true. */
(async () => {
  const token = location.pathname.split('/').filter(Boolean).pop();
  const msg = document.getElementById('msg');
  const fail = (t) => { const l = document.getElementById('loading'); if (l) l.remove(); msg.textContent = t; msg.style.display = 'grid'; };
  try {
    const r = await fetch('/api/s/' + encodeURIComponent(token), { credentials: 'omit' });
    if (!r.ok) return fail('הקישור לא נמצא');
    const d = await r.json();
    if (!d.posts.length) return fail('אין כאן סטוריז');
    document.getElementById('loading').remove();
    // the first tap on the page (any tap) unlocks sound on iPhone; until then it plays muted, as in the approval screen
    FYStories.open({ sets: [{ client: d.client, posts: d.posts }], post: d.posts[0].id, readonly: true, muted: false, gesture: false, api: () => Promise.reject(new Error('read_only')) });
  } catch { fail('לא הצלחנו לטעון, אפשר לרענן'); }
})();
