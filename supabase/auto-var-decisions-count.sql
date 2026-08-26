-- Run this in Supabase dashboard → SQL Editor
--
-- Auto-derives RTR Match Stats.var_decisions from the actual count of
-- "VAR Decision" type rows on RTR Incidents for that match, instead of
-- relying on admin.html's manual number field. Every time a VAR decision
-- is added or removed via "+ Add Decision" / the Incident admin list, the
-- match's var_decisions count recalculates itself — no separate manual
-- entry to remember, and it can't silently drift out of sync.

CREATE OR REPLACE FUNCTION public.sync_var_decisions_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected_match_id BIGINT;
  cnt INT;
BEGIN
  affected_match_id := COALESCE(NEW.match_id, OLD.match_id);

  SELECT COUNT(*) INTO cnt
  FROM "RTR Incidents"
  WHERE match_id = affected_match_id AND type = 'VAR Decision';

  INSERT INTO "RTR Match Stats" (match_id, var_decisions)
  VALUES (affected_match_id, cnt)
  ON CONFLICT (match_id) DO UPDATE SET var_decisions = EXCLUDED.var_decisions;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_var_decisions_insert ON "RTR Incidents";
CREATE TRIGGER trg_sync_var_decisions_insert
  AFTER INSERT ON "RTR Incidents"
  FOR EACH ROW
  WHEN (NEW.type = 'VAR Decision')
  EXECUTE FUNCTION public.sync_var_decisions_count();

DROP TRIGGER IF EXISTS trg_sync_var_decisions_delete ON "RTR Incidents";
CREATE TRIGGER trg_sync_var_decisions_delete
  AFTER DELETE ON "RTR Incidents"
  FOR EACH ROW
  WHEN (OLD.type = 'VAR Decision')
  EXECUTE FUNCTION public.sync_var_decisions_count();

-- One-off backfill: recompute var_decisions for every match that already
-- has VAR Decision incidents, so existing data reflects reality immediately
-- rather than waiting for the next insert/delete to trigger a recalc.
INSERT INTO "RTR Match Stats" (match_id, var_decisions)
SELECT match_id, COUNT(*) FROM "RTR Incidents"
WHERE type = 'VAR Decision'
GROUP BY match_id
ON CONFLICT (match_id) DO UPDATE SET var_decisions = EXCLUDED.var_decisions;
