-- Run this in Supabase dashboard → SQL Editor
--
-- Full RLS rollout. Until now, every table except RTR Fixtures/Home
-- Content/Articles had no RLS at all — meaning the public anon key baked
-- into shared.js (visible to anyone via browser dev tools) could read AND
-- write every row in every table directly via the REST API, completely
-- bypassing the app's UI and its client-side-only admin checks. The three
-- tables that did have RLS (Fixtures, Home Content, Articles) had their
-- writes wide open too ("Public write"/"Public update" USING (true)),
-- explicitly because — per their own comments — "admin" wasn't a concept
-- Postgres could check. It is now.
--
-- Design:
--   • Reference/public data (referees, fixtures, articles, home content,
--     match stats, config, incidents, general votes/incident votes
--     aggregates, forum posts) stays world-readable — guests browse the
--     site without logging in and that must keep working.
--   • Writes to anything editorial/admin (config, home content, articles,
--     referees, match stats, fixtures, manual bonuses, tasks, incidents)
--     are now enforced at the DB level via a real is_admin flag, not just
--     a hidden admin.html page.
--   • User-owned rows (votes, fantasy picks, forum posts, badges, decision
--     flags) can only be written by their own owner (auth.uid() = user_id),
--     with an admin bypass where the app legitimately needs one (e.g.
--     admin bulk-scoring fantasy gw_pts, admin bulk-creating match threads).
--
-- Safe to re-run: every ENABLE/POLICY statement below is idempotent
-- (DROP POLICY IF EXISTS before each CREATE POLICY).

-- ════════════════════════════════════════════════════════════════════
-- Admin flag + helper function
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Profiles" ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE "RTR Profiles" SET is_admin = true WHERE lower(username) IN ('danawhiteware', 'jware89');

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE((SELECT is_admin FROM "RTR Profiles" WHERE id = auth.uid()), false);
$$;

-- ════════════════════════════════════════════════════════════════════
-- RTR Profiles — public read (login-by-username lookup + leaderboards
-- need this), write only your own row
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Profiles" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_public" ON "RTR Profiles";
CREATE POLICY "profiles_select_public" ON "RTR Profiles" FOR SELECT USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON "RTR Profiles";
CREATE POLICY "profiles_insert_own" ON "RTR Profiles" FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON "RTR Profiles";
CREATE POLICY "profiles_update_own" ON "RTR Profiles" FOR UPDATE USING (auth.uid() = id);

-- ════════════════════════════════════════════════════════════════════
-- RTR Votes — legacy rating table (read-only in the live app today;
-- write path unused, policy added defensively to match intended shape)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Votes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "votes_select_public" ON "RTR Votes";
CREATE POLICY "votes_select_public" ON "RTR Votes" FOR SELECT USING (true);

DROP POLICY IF EXISTS "votes_insert_own" ON "RTR Votes";
CREATE POLICY "votes_insert_own" ON "RTR Votes" FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "votes_delete_own" ON "RTR Votes";
CREATE POLICY "votes_delete_own" ON "RTR Votes" FOR DELETE USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════
-- RTR Fantasy Picks — read requires login (leaderboard shows everyone's
-- picks to logged-in users), write your own row; admin can update gw_pts
-- on anyone's row (bulk scoring)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Fantasy Picks" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fantasy_picks_select_authenticated" ON "RTR Fantasy Picks";
CREATE POLICY "fantasy_picks_select_authenticated" ON "RTR Fantasy Picks"
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "fantasy_picks_insert_own" ON "RTR Fantasy Picks";
CREATE POLICY "fantasy_picks_insert_own" ON "RTR Fantasy Picks"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "fantasy_picks_update_own_or_admin" ON "RTR Fantasy Picks";
CREATE POLICY "fantasy_picks_update_own_or_admin" ON "RTR Fantasy Picks"
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Match Stats — public read (referees.html is guest-reachable),
-- admin-only write
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Match Stats" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_stats_select_public" ON "RTR Match Stats";
CREATE POLICY "match_stats_select_public" ON "RTR Match Stats" FOR SELECT USING (true);

DROP POLICY IF EXISTS "match_stats_write_admin" ON "RTR Match Stats";
CREATE POLICY "match_stats_write_admin" ON "RTR Match Stats"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Config — public read (global GW/season config read by every page),
-- admin-only write
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Config" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "config_select_public" ON "RTR Config";
CREATE POLICY "config_select_public" ON "RTR Config" FOR SELECT USING (true);

DROP POLICY IF EXISTS "config_write_admin" ON "RTR Config";
CREATE POLICY "config_write_admin" ON "RTR Config"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Manual Bonuses — read requires login, admin-only write
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Manual Bonuses" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_bonuses_select_authenticated" ON "RTR Manual Bonuses";
CREATE POLICY "manual_bonuses_select_authenticated" ON "RTR Manual Bonuses"
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "manual_bonuses_write_admin" ON "RTR Manual Bonuses";
CREATE POLICY "manual_bonuses_write_admin" ON "RTR Manual Bonuses"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Home Content — tighten from fully public write to admin-only
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Public write" ON "RTR Home Content";
DROP POLICY IF EXISTS "Public update" ON "RTR Home Content";

DROP POLICY IF EXISTS "home_content_write_admin" ON "RTR Home Content";
CREATE POLICY "home_content_write_admin" ON "RTR Home Content"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- "Public read" policy from home-content-setup.sql is kept as-is.

-- ════════════════════════════════════════════════════════════════════
-- RTR Articles — tighten from fully public write/update/delete to admin-only
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Public write" ON "RTR Articles";
DROP POLICY IF EXISTS "Public update" ON "RTR Articles";
DROP POLICY IF EXISTS "Public delete" ON "RTR Articles";

DROP POLICY IF EXISTS "articles_write_admin" ON "RTR Articles";
CREATE POLICY "articles_write_admin" ON "RTR Articles"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- "Public read" policy from articles-setup.sql is kept as-is.

-- ════════════════════════════════════════════════════════════════════
-- RTR Fixtures — add the admin-write policy that was documented but
-- never actually created (admin.html edits fixtures with the anon key
-- today; only the edge function was ever covered, via service_role)
-- ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "fixtures_write_admin" ON "RTR Fixtures";
CREATE POLICY "fixtures_write_admin" ON "RTR Fixtures"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- "Public read" policy from fixtures-setup.sql is kept as-is.
-- The sync-fixtures Edge Function uses the service_role key, which
-- bypasses RLS entirely — unaffected by this policy either way.

-- ════════════════════════════════════════════════════════════════════
-- RTR Incidents — public read (feeds referee ratings on guest-reachable
-- referees.html), admin-only write
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Incidents" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incidents_select_public" ON "RTR Incidents";
CREATE POLICY "incidents_select_public" ON "RTR Incidents" FOR SELECT USING (true);

DROP POLICY IF EXISTS "incidents_write_admin" ON "RTR Incidents";
CREATE POLICY "incidents_write_admin" ON "RTR Incidents"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Incident Votes — public read (aggregate ratings feed referees.html
-- for guests), write your own vote
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Incident Votes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incident_votes_select_public" ON "RTR Incident Votes";
CREATE POLICY "incident_votes_select_public" ON "RTR Incident Votes" FOR SELECT USING (true);

DROP POLICY IF EXISTS "incident_votes_insert_own" ON "RTR Incident Votes";
CREATE POLICY "incident_votes_insert_own" ON "RTR Incident Votes"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════
-- RTR General Votes — public read (feeds referees.html for guests),
-- write your own vote
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR General Votes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "general_votes_select_public" ON "RTR General Votes";
CREATE POLICY "general_votes_select_public" ON "RTR General Votes" FOR SELECT USING (true);

DROP POLICY IF EXISTS "general_votes_insert_own" ON "RTR General Votes";
CREATE POLICY "general_votes_insert_own" ON "RTR General Votes"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "general_votes_update_own" ON "RTR General Votes";
CREATE POLICY "general_votes_update_own" ON "RTR General Votes"
  FOR UPDATE USING (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════
-- RTR Forum — public read (forum.html is guest-reachable), write your
-- own post; admin can also post (bulk match-thread creation)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Forum" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forum_select_public" ON "RTR Forum";
CREATE POLICY "forum_select_public" ON "RTR Forum" FOR SELECT USING (true);

DROP POLICY IF EXISTS "forum_insert_own_or_admin" ON "RTR Forum";
CREATE POLICY "forum_insert_own_or_admin" ON "RTR Forum"
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Decision Flags — read requires login (only ever read from the
-- login-gated matches.html), write your own flag
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Decision Flags" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decision_flags_select_authenticated" ON "RTR Decision Flags";
CREATE POLICY "decision_flags_select_authenticated" ON "RTR Decision Flags"
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "decision_flags_insert_own" ON "RTR Decision Flags";
CREATE POLICY "decision_flags_insert_own" ON "RTR Decision Flags"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════
-- RTR Referees — public read (core reference data, guest-reachable),
-- admin-only write (no write path in the app today, added as a safety
-- net for future admin editing)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Referees" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referees_select_public" ON "RTR Referees";
CREATE POLICY "referees_select_public" ON "RTR Referees" FOR SELECT USING (true);

DROP POLICY IF EXISTS "referees_write_admin" ON "RTR Referees";
CREATE POLICY "referees_write_admin" ON "RTR Referees"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Referee Season Stats — re-enable RLS (it was disabled temporarily
-- during the season-refresh migration) with real policies this time
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Referee Season Stats" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ref_season_stats_select_public" ON "RTR Referee Season Stats";
CREATE POLICY "ref_season_stats_select_public" ON "RTR Referee Season Stats" FOR SELECT USING (true);

DROP POLICY IF EXISTS "ref_season_stats_write_admin" ON "RTR Referee Season Stats";
CREATE POLICY "ref_season_stats_write_admin" ON "RTR Referee Season Stats"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════
-- RTR Badges — read/write only your own badges
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Badges" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badges_select_own" ON "RTR Badges";
CREATE POLICY "badges_select_own" ON "RTR Badges" FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "badges_insert_own" ON "RTR Badges";
CREATE POLICY "badges_insert_own" ON "RTR Badges" FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════
-- RTR Tasks — internal admin kanban board, admin-only end to end
-- (team_task_manager.html itself is fully admin-gated already)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "RTR Tasks" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_admin_only" ON "RTR Tasks";
CREATE POLICY "tasks_admin_only" ON "RTR Tasks"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
