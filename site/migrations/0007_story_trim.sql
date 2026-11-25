-- Instagram-style trim of a story, per version (non-destructive: the file stays whole).
-- Seconds from the start of the file; NULL = not trimmed on that side. A new version starts untrimmed.
ALTER TABLE versions ADD COLUMN trim_in REAL;
ALTER TABLE versions ADD COLUMN trim_out REAL;
