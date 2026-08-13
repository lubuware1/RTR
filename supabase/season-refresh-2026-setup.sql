-- Run this in Supabase dashboard → SQL Editor
--
-- Season refresh for 2026/27. Two things:
--
-- 1. Referee officiating stats (apps/fouls/cards on "RTR Referees") are
--    flat columns on the referee row with no season dimension at all —
--    unlike the votes/incidents/forum tables, there's no way to "filter
--    by season" here without first splitting the numbers out. This
--    archives the current live numbers into a new per-season table
--    tagged '2025' (last season), then clears the live columns so admin
--    can start entering 2026/27 numbers on a blank slate. Referee
--    identity (name, bio, photo, nationality etc.) is untouched.
--
-- 2. Extends the season-tagging pattern from season-archiving-setup.sql
--    (season column + backfill existing rows to '2025') to two tables
--    that were missed: RTR Manual Bonuses and RTR Fantasy Picks. Fantasy
--    Picks also gets its uniqueness key widened from (user_id, matchweek)
--    to (user_id, matchweek, season) — otherwise matchweek 1 of the new
--    season would collide with matchweek 1 of last season for the same
--    user. RTR Votes gets the column too for consistency, though it's
--    currently empty/unused (ratings are actually driven by
--    RTR General Votes / RTR Incident Votes, already season-aware).

-- ── Referee officiating stats: split into a per-season table ──────────
CREATE TABLE IF NOT EXISTS "RTR Referee Season Stats" (
  id BIGSERIAL PRIMARY KEY,
  ref_id BIGINT NOT NULL REFERENCES "RTR Referees"(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  overall_apps INTEGER, overall_fouls_pg NUMERIC, overall_fouls_tackles NUMERIC, overall_pen_pg NUMERIC,
  overall_yel_pg NUMERIC, overall_yel INTEGER, overall_red_pg NUMERIC, overall_red INTEGER,
  home_apps INTEGER, home_fouls_pg NUMERIC, home_fouls_tackles NUMERIC, home_pen_pg NUMERIC,
  home_yel_pg NUMERIC, home_yel INTEGER, home_red_pg NUMERIC, home_red INTEGER,
  away_apps INTEGER, away_fouls_pg NUMERIC, away_fouls_tackles NUMERIC, away_pen_pg NUMERIC,
  away_yel_pg NUMERIC, away_yel INTEGER, away_red_pg NUMERIC, away_red INTEGER,
  UNIQUE(ref_id, season)
);
CREATE INDEX IF NOT EXISTS idx_ref_season_stats_season ON "RTR Referee Season Stats" (season);

-- Archive this season's live numbers as '2025' before wiping them
INSERT INTO "RTR Referee Season Stats" (
  ref_id, season, overall_apps, overall_fouls_pg, overall_fouls_tackles, overall_pen_pg,
  overall_yel_pg, overall_yel, overall_red_pg, overall_red,
  home_apps, home_fouls_pg, home_fouls_tackles, home_pen_pg,
  home_yel_pg, home_yel, home_red_pg, home_red,
  away_apps, away_fouls_pg, away_fouls_tackles, away_pen_pg,
  away_yel_pg, away_yel, away_red_pg, away_red
)
SELECT
  id, '2025', overall_apps, overall_fouls_pg, overall_fouls_tackles, overall_pen_pg,
  overall_yel_pg, overall_yel, overall_red_pg, overall_red,
  home_apps, home_fouls_pg, home_fouls_tackles, home_pen_pg,
  home_yel_pg, home_yel, home_red_pg, home_red,
  away_apps, away_fouls_pg, away_fouls_tackles, away_pen_pg,
  away_yel_pg, away_yel, away_red_pg, away_red
FROM "RTR Referees"
WHERE overall_apps IS NOT NULL
ON CONFLICT (ref_id, season) DO NOTHING;

-- Clear the live columns so the 2026/27 season starts blank
UPDATE "RTR Referees" SET
  overall_apps=NULL, overall_fouls_pg=NULL, overall_fouls_tackles=NULL, overall_pen_pg=NULL,
  overall_yel_pg=NULL, overall_yel=NULL, overall_red_pg=NULL, overall_red=NULL,
  home_apps=NULL, home_fouls_pg=NULL, home_fouls_tackles=NULL, home_pen_pg=NULL,
  home_yel_pg=NULL, home_yel=NULL, home_red_pg=NULL, home_red=NULL,
  away_apps=NULL, away_fouls_pg=NULL, away_fouls_tackles=NULL, away_pen_pg=NULL,
  away_yel_pg=NULL, away_yel=NULL, away_red_pg=NULL, away_red=NULL;

-- ── RTR Votes: season column (currently unused/empty, added for consistency) ──
ALTER TABLE "RTR Votes" ADD COLUMN IF NOT EXISTS season TEXT;
CREATE INDEX IF NOT EXISTS idx_votes_season ON "RTR Votes" (season);

-- ── RTR Manual Bonuses: season-tag (currently unused/empty) ──────────
ALTER TABLE "RTR Manual Bonuses" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR Manual Bonuses" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_manual_bonuses_season ON "RTR Manual Bonuses" (season);

-- ── RTR Fantasy Picks: season-tag + widen the uniqueness key ─────────
ALTER TABLE "RTR Fantasy Picks" ADD COLUMN IF NOT EXISTS season TEXT;
UPDATE "RTR Fantasy Picks" SET season = '2025' WHERE season IS NULL;
CREATE INDEX IF NOT EXISTS idx_fantasy_picks_season ON "RTR Fantasy Picks" (season);

-- Replace the existing (user_id, matchweek) unique constraint — whatever
-- it's actually named — with one that also includes season.
DO $$
DECLARE
  conname_var TEXT;
BEGIN
  SELECT c.conname INTO conname_var
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'RTR Fantasy Picks' AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 2;
  IF conname_var IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "RTR Fantasy Picks" DROP CONSTRAINT %I', conname_var);
  END IF;
END $$;
ALTER TABLE "RTR Fantasy Picks"
  ADD CONSTRAINT rtr_fantasy_picks_user_mw_season_key UNIQUE (user_id, matchweek, season);
