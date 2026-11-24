#!/usr/bin/env python3
"""Print SQL for the demo client (and, with --owner, a local test owner). Standard library only.
   python3 scripts/seed.py > /tmp/seed.sql ; npx wrangler d1 execute DB --local --file /tmp/seed.sql"""
import base64, hashlib, os, secrets, sys

def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

def pw_hash(pw):
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 20000, 32)
    return f"pbkdf2$20000${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"

avatar = ("data:image/svg+xml;utf8," +
          "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' rx='40' fill='%23e9dccd'/>"
          "<text x='40' y='50' font-family='Heebo,Arial,sans-serif' font-size='30' text-anchor='middle' fill='%235b4a3b'>DC</text></svg>")
out = []
if "--owner" in sys.argv:
    # local test login, recorded in site/.dev.vars.example; never used on a real install
    out.append(f"INSERT OR IGNORE INTO users (email, name, role, pass_hash) VALUES ('owner@demo.test', 'Owner', 'owner', {q(pw_hash('demo-pass-2026'))});")
    out.append("INSERT OR REPLACE INTO settings (key, value) VALUES ('agency_name', 'סוכנות דמו');")
out.append(f"INSERT OR IGNORE INTO clients (id, name, handle, profile_url, avatar, bio, color, share_token) VALUES "
           f"('demo-cafe', 'קפה דמו', 'demo.cafe', NULL, {q(avatar)}, 'בית קפה שכונתי. לקוח לדוגמה', '#c9a97f', {q(secrets.token_urlsafe(16))});")
posts = [
    ("רילס פתיחת בוקר", "reel", "vertical", "demo-1", 9, 720, 1280, "בוקר טוב מהשכונה ☕️\nהקרואסון של היום יוצא מהתנור ב-8:00", "review"),
    ("מאחורי הבר", "reel", "vertical", "demo-2", 11, 720, 1280, "ככה נראה אספרסו כפול כשאף אחד לא ממהר", "review"),
    ("מבצע סוף שבוע", "story", "vertical", "demo-3", 8, 720, 1280, "שישי-שבת: קפה + מאפה ב-25 ₪", "review"),
    ("סרטון היכרות ארוך", "long", "horizontal", "demo-4", 14, 1280, 720, "הכירו את הצוות שמאחורי הדלפק", "review"),
]
for i, (title, kind, orient, guid, dur, w, h, cap, stage) in enumerate(posts, 1):
    out.append(f"INSERT INTO posts (client_id, title, kind, orientation, stage, caption, cover_url) VALUES "
               f"('demo-cafe', {q(title)}, '{kind}', '{orient}', '{stage}', {q(cap)}, '/demo/{guid}.jpg');")
    out.append(f"INSERT INTO versions (post_id, n, bunny_guid, duration, width, height, note) VALUES ((SELECT MAX(id) FROM posts), 1, '{guid}', {dur}, {w}, {h}, 'גרסה ראשונה');")
    out.append("UPDATE posts SET current_version_id = (SELECT MAX(id) FROM versions) WHERE id = (SELECT MAX(id) FROM posts);")
    out.append("INSERT INTO events (kind, post_id, client_id, actor) VALUES ('new_video', (SELECT MAX(id) FROM posts), 'demo-cafe', 'claude');")
    notes = ["כותרת גדולה למטה", "כותרת בתיבה לבנה", "פריים נקי בלי טקסט"]
    for n in (1, 2, 3):  # cover options Claude prepared (scripts/make_covers.py); the team picks one
        out.append(f"INSERT INTO cover_options (post_id, token, image, note) VALUES ((SELECT MAX(id) FROM posts), {q(secrets.token_urlsafe(12))}, '/demo/covers/{guid}-{n}.jpg', {q(notes[n-1])});")
out.append("INSERT INTO comments (post_id, version_id, target, at_sec, body, author, author_kind) VALUES ((SELECT MIN(id) FROM posts), (SELECT MIN(id) FROM versions), 'video', 3.2, 'להכניס את הלוגו שנייה אחת קודם', 'Owner', 'team');")
out.append("INSERT INTO tracks (title, artist, source) VALUES ('Morning Coffee (ספריית אינסטגרם)', NULL, 'instagram'), ('שיר בטוח 1', 'ספרייה שלנו', 'library');")
print("\n".join(out))
