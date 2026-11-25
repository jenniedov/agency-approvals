-- R2 videos have no Bunny thumbnail: the Mac uploads the first frame as video/<guid>.jpg and sets this to 1
ALTER TABLE versions ADD COLUMN poster INTEGER DEFAULT 0;
-- deleted from the site (soft: hidden everywhere, the agent can restore it)
ALTER TABLE posts ADD COLUMN deleted_at TEXT;
-- the posts a job produced (JSON list of ids): a finished job opens them for approval
ALTER TABLE jobs ADD COLUMN post_ids TEXT;
