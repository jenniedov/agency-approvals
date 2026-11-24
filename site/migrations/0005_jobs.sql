-- "New job" intake: Jennie drops files from her phone + text or a voice note; Claude picks the job up on the Mac.
-- status: draft (sheet still open) | queued (sent, files still uploading) | new (ready for Claude) | working | done
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft',
  text TEXT,
  created_by INTEGER,
  status_note TEXT,
  sent_at TEXT,
  picked_at TEXT,
  done_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

-- role: media (photos/videos) | voice (her voice note). Files live in R2 under jobs/<job>/...
-- state: uploading (multipart in progress) | ready | failed
-- transcript_state (voice only): pending | done | failed
CREATE TABLE IF NOT EXISTS job_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'media',
  name TEXT,
  content_type TEXT,
  size INTEGER,
  r2_key TEXT NOT NULL,
  upload_id TEXT,
  state TEXT NOT NULL DEFAULT 'uploading',
  transcript TEXT,
  transcript_state TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS job_files_job ON job_files(job_id);
