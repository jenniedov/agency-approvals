-- Cover options: Claude prepares a few, the team picks one (or asks for a change on one).
CREATE TABLE cover_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  token TEXT NOT NULL UNIQUE,          -- public, unguessable: /cover/<token>.jpg
  image TEXT NOT NULL,                 -- data: URL (JPEG, up to ~1.5 MB) or a path/URL
  note TEXT,                           -- what Claude did ("frame 0:03 + title")
  chosen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX cover_options_post ON cover_options(post_id);
ALTER TABLE comments ADD COLUMN cover_option_id INTEGER;
