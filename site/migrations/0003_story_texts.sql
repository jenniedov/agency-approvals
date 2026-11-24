-- Text captions Jennie places on top of a story (Instagram style). Claude bakes them into the video before posting.
-- Coordinates: x, y = centre of the box in percent of the frame; width_pct = box width in percent of the frame width;
-- font_px_at_1080 = font size in px on a 1080 px wide frame (1080x1920).
CREATE TABLE IF NOT EXISTS story_texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  version_id INTEGER,
  text TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT 'white-box',   -- white-box | black-box | shadow
  x REAL NOT NULL DEFAULT 50,
  y REAL NOT NULL DEFAULT 50,
  width_pct REAL NOT NULL DEFAULT 80,
  font_px_at_1080 REAL NOT NULL DEFAULT 72,
  rotation REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS story_texts_post ON story_texts(post_id);
