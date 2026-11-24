-- One database per agency install. See docs/ARCHITECTURE.md.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','manager')),
  avatar TEXT,
  pass_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,                -- slug, also the folder name clients/<id>/
  name TEXT NOT NULL,
  handle TEXT,
  profile_url TEXT,
  avatar TEXT,                        -- data: URL or https URL
  bio TEXT,
  color TEXT,
  share_token TEXT NOT NULL UNIQUE,
  manager_id INTEGER REFERENCES users(id),
  sort INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'reel' CHECK (kind IN ('reel','story','short','long','post')),
  orientation TEXT NOT NULL DEFAULT 'vertical' CHECK (orientation IN ('vertical','horizontal')),
  stage TEXT NOT NULL DEFAULT 'editing' CHECK (stage IN ('editing','review','client','approved','scheduled','published')),
  video_state TEXT NOT NULL DEFAULT 'pending' CHECK (video_state IN ('pending','approved','changes')),
  caption TEXT,
  caption_state TEXT NOT NULL DEFAULT 'pending' CHECK (caption_state IN ('pending','approved','changes')),
  cover_url TEXT,
  cover_state TEXT NOT NULL DEFAULT 'pending' CHECK (cover_state IN ('pending','approved','changes')),
  music TEXT,                         -- JSON {title, artist, source, track_id}
  scheduled_at TEXT,
  platforms TEXT,                     -- JSON array
  client_state TEXT NOT NULL DEFAULT 'none' CHECK (client_state IN ('none','pending','approved','changes')),
  current_version_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX posts_client ON posts(client_id, stage);

CREATE TABLE versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  n INTEGER NOT NULL,
  bunny_guid TEXT NOT NULL,
  duration REAL,
  width INTEGER,
  height INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX versions_post ON versions(post_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  version_id INTEGER,
  target TEXT NOT NULL DEFAULT 'video' CHECK (target IN ('video','caption','cover','music','general')),
  at_sec REAL,
  body TEXT NOT NULL,
  drawing TEXT,                       -- JSON strokes, coordinates 0..1
  author TEXT,
  author_kind TEXT NOT NULL DEFAULT 'team' CHECK (author_kind IN ('team','client','claude')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  done_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX comments_post ON comments(post_id);
CREATE INDEX comments_open ON comments(status);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  post_id INTEGER,
  client_id TEXT,
  actor TEXT,
  body TEXT,
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX events_unread ON events(read_at, id);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  source TEXT NOT NULL DEFAULT 'library' CHECK (source IN ('library','instagram')),
  url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE machines (
  name TEXT PRIMARY KEY,
  detail TEXT,
  last_seen TEXT DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,               -- email or ip
  n INTEGER NOT NULL DEFAULT 0,
  window_start TEXT DEFAULT (datetime('now'))
);
