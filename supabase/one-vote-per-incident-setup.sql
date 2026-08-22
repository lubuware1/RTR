-- Run this in Supabase dashboard → SQL Editor
--
-- Testers were able to vote on the same incident repeatedly — the app's
-- vote button re-clicks a fresh INSERT every time with no dedup, so each
-- click (including switching Correct↔Wrong) permanently added another row
-- to RTR Incident Votes rather than replacing the previous one. Client-side
-- was fixed to UPDATE an existing vote instead of inserting a second row,
-- but that's only ever advisory — this trigger is the real enforcement,
-- since a direct API call could otherwise still insert duplicates.
--
-- Admins are explicitly exempt — they can cast repeated votes on the same
-- incident (useful for testing/QA) — enforced via the existing
-- public.is_admin() helper from rls-full-rollout-setup.sql.

CREATE OR REPLACE FUNCTION public.enforce_one_incident_vote()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF EXISTS (
      SELECT 1 FROM "RTR Incident Votes"
      WHERE incident_id = NEW.incident_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'You have already voted on this incident — change your existing vote instead of casting a new one.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_one_incident_vote ON "RTR Incident Votes";
CREATE TRIGGER trg_one_incident_vote
  BEFORE INSERT ON "RTR Incident Votes"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_one_incident_vote();
