-- Run this in Supabase dashboard → SQL Editor
-- Supports the Google Drive story import (netlify/functions/sync-drive-stories.js):
--   status        'published' (default, all existing rows) or 'draft' (auto-imported, awaiting approval)
--   drive_file_id the Drive file an article was imported from; UNIQUE so a re-run can never import it twice

ALTER TABLE "RTR Articles" ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "RTR Articles" ADD COLUMN IF NOT EXISTS drive_file_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS articles_drive_file_id_key
  ON "RTR Articles" (drive_file_id);  -- plain (not partial) so on_conflict works; NULLs stay allowed
