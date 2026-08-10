-- Run this in Supabase dashboard → SQL Editor
--
-- Adds season tracking to the tables that drive referee ratings and the
-- Forum, so a new season starts with a clean slate (ratings/threads default
-- to the current season) without deleting last season's data — it stays in
-- the same tables, just tagged, for a future "past seasons" view.
--
-- Existing rows (all from before this migration) are backfilled to '2025'
-- (the 2025/26 season). New rows going forward are stamped by the app with
-- whatever "RTR Config".season currently is.
--
-- Also fixes "RTR General Votes" missing its is_fan column — shared.js's
-- saveGeneralVote()/loadIncidentRatings() already read/write it, but the
-- table was never given the column, which broke the neutral/fan split for
-- general votes.

ALTER TABLE "RTR Incident Votes" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR Incident Votes" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_incident_votes_season ON "RTR Incident Votes" (season);

ALTER TABLE "RTR General Votes" ADD COLUMN IF NOT EXISTS is_fan BOOLEAN DEFAULT false;
ALTER TABLE "RTR General Votes" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR General Votes" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_general_votes_season ON "RTR General Votes" (season);

ALTER TABLE "RTR Incidents" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR Incidents" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_season ON "RTR Incidents" (season);

ALTER TABLE "RTR Forum" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR Forum" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_forum_season ON "RTR Forum" (season);
