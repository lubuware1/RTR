-- Run this in Supabase dashboard → SQL Editor
--
-- New "Classic Decision" homepage feature: fans vote Correct/Wrong Call on
-- old refereeing decisions. Pure opinion poll — no stored "right answer",
-- just the vote split. Admin controls which single decision is currently
-- featured on the homepage via the `featured` flag (app code unsets any
-- other featured row when setting a new one — no DB constraint enforcing
-- "only one" since that's simpler to manage from admin.html directly).

CREATE TABLE IF NOT EXISTS "RTR Classic Decisions" (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url   TEXT,
  featured    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "RTR Classic Decisions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "classic_decisions_select_public" ON "RTR Classic Decisions";
CREATE POLICY "classic_decisions_select_public" ON "RTR Classic Decisions" FOR SELECT USING (true);

DROP POLICY IF EXISTS "classic_decisions_write_admin" ON "RTR Classic Decisions";
CREATE POLICY "classic_decisions_write_admin" ON "RTR Classic Decisions"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "RTR Classic Decision Votes" (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id BIGINT NOT NULL REFERENCES "RTR Classic Decisions"(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES "RTR Profiles"(id),
  vote        TEXT NOT NULL CHECK (vote IN ('correct', 'wrong')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_id, user_id)
);

ALTER TABLE "RTR Classic Decision Votes" ENABLE ROW LEVEL SECURITY;

-- Public read so vote splits/percentages can be computed client-side,
-- matching the existing RTR Votes / RTR Incident Votes convention.
DROP POLICY IF EXISTS "classic_votes_select_public" ON "RTR Classic Decision Votes";
CREATE POLICY "classic_votes_select_public" ON "RTR Classic Decision Votes" FOR SELECT USING (true);

DROP POLICY IF EXISTS "classic_votes_insert_own" ON "RTR Classic Decision Votes";
CREATE POLICY "classic_votes_insert_own" ON "RTR Classic Decision Votes"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "classic_votes_update_own" ON "RTR Classic Decision Votes";
CREATE POLICY "classic_votes_update_own" ON "RTR Classic Decision Votes"
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "classic_votes_delete_own" ON "RTR Classic Decision Votes";
CREATE POLICY "classic_votes_delete_own" ON "RTR Classic Decision Votes"
  FOR DELETE USING (auth.uid() = user_id);
