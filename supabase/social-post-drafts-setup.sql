-- Run this in Supabase dashboard → SQL Editor
--
-- Auto-generates a social post draft the moment ANY new RTR Incidents row
-- is created — whether that's the scheduled live-sync function detecting
-- a card/penalty, or an admin manually adding a decision (e.g. VAR) via
-- admin.html's "+ Add Decision" form. One trigger covers every current
-- and future way an incident can be created, so nothing needs separate
-- wiring per source.
--
-- Drafts start as 'pending' and are never auto-posted by this migration —
-- that's a deliberate human-review step for now (admin.html → Social
-- Posts), reviewed and either posted or discarded manually. Fully
-- locked down (admin-only, no public read at all) since these are
-- internal review items, not public content until actually posted.

CREATE TABLE IF NOT EXISTS "RTR Social Post Drafts" (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES "RTR Incidents"(id) ON DELETE CASCADE,
  post_text   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'discarded')),
  posted_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "RTR Social Post Drafts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_drafts_admin_only" ON "RTR Social Post Drafts";
CREATE POLICY "social_drafts_admin_only" ON "RTR Social Post Drafts"
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_social_post_draft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  minute_prefix TEXT := CASE WHEN NEW.minute IS NOT NULL THEN NEW.minute::text || '''' || ' — ' ELSE '' END;
  -- Manual admin entries pack description as player||outcome||colour (see
  -- admin.html's "+ Add Decision" form); the live-sync function just writes
  -- plain text like "Romero (Spurs)". split_part on a string with no '||'
  -- delimiter simply returns the whole string, so this handles both shapes.
  detail        TEXT := COALESCE(NULLIF(split_part(NEW.description, '||', 1), ''), 'A decision');
  draft_text    TEXT;
BEGIN
  draft_text := CASE NEW.type
    WHEN 'Yellow Card' THEN
      '🟨 ' || minute_prefix || detail || ' booked. Correct call or harsh? Fans are voting now on RefRater.'
    WHEN 'Red Card' THEN
      '🟥 ' || minute_prefix || detail || ' sent off. Correct call or harsh? Fans are voting now on RefRater.'
    WHEN 'Penalty Given' THEN
      '⚽ ' || minute_prefix || detail || ' awarded. Right call or soft? Fans are voting now on RefRater.'
    WHEN 'VAR Decision' THEN
      '📺 VAR REVIEW — ' || minute_prefix || detail || E'. What\'s the verdict? Fans are voting now on RefRater.'
    ELSE
      '⚡ ' || minute_prefix || detail || '. Correct call or wrong? Fans are voting now on RefRater.'
  END;

  INSERT INTO "RTR Social Post Drafts" (incident_id, post_text, status)
  VALUES (NEW.id, draft_text, 'pending');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_social_post_draft ON "RTR Incidents";
CREATE TRIGGER trg_generate_social_post_draft
  AFTER INSERT ON "RTR Incidents"
  FOR EACH ROW EXECUTE FUNCTION public.generate_social_post_draft();
