-- Public, view-only share links for a set of stories (the friend-opinion link). post_ids = JSON array in play order.
CREATE TABLE IF NOT EXISTS story_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  post_ids TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
