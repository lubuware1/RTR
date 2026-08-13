-- Run this in Supabase dashboard → SQL Editor
--
-- RTR Fixtures has no season concept at all — every page pulls the
-- entire table with .select('*'), no filter. It currently holds all 462
-- matches from the 2025/26 season (matchweeks 1–38, all "complete"). This
-- is why referees.html still showed card/game counts after the season
-- refresh: its stat display falls back to aggregating RTR Match Stats
-- joined to RTR Fixtures.ref_id whenever the archived RTR Referees
-- columns are null (which they now always are) — and that aggregation
-- was summing every fixture ever synced, not just this season's.
--
-- Adds a season column (backfilled to '2025' for existing rows, same
-- convention as every other season-tagged table), so loadFixtures() can
-- filter to the current season. Since the referee stat aggregation only
-- counts fixtures actually present in MATCHES, filtering this one read
-- fixes referees.html too — RTR Match Stats itself needs no changes.

ALTER TABLE "RTR Fixtures" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR Fixtures" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_fixtures_season ON "RTR Fixtures" (season);
