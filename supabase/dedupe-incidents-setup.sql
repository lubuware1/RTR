-- Run this in Supabase dashboard → SQL Editor
--
-- sync-live-incidents.js (the scheduled function that polls football-data.org
-- every 2 minutes during live matches) was supposed to skip re-inserting a
-- card/penalty it had already created, by checking existing RTR Incidents
-- rows first. That check was failing in practice: 6 matches on 2026-09-12
-- (GW4) ended up with 249 duplicate rows total — Crystal Palace v Ipswich
-- alone had 5 real events duplicated ~28-29 times each, one extra copy
-- roughly every poll for the rest of the match.
--
-- This does three things, in order, inside one transaction:
--   1. For any vote cast on a row that's about to be deleted, move it onto
--      the one row being kept for that event (skipped if that user already
--      voted on the kept row too, to respect the existing one-vote-per-
--      incident rule) — so no one's vote silently disappears.
--   2. Deletes the duplicate RTR Incidents rows, keeping the earliest one
--      per (match_id, type, minute, description) group.
--   3. Adds a real DB-level unique constraint on that same combination, so
--      sync-live-incidents.js's new upsert (on_conflict + ignore-
--      duplicates) has something to actually enforce against — this makes
--      a repeat insert a structural no-op instead of depending on an
--      app-side read-then-check, which is exactly what failed here.
--
-- Safe to run once; re-running after it succeeds is a no-op (no duplicates
-- left to remove, and the constraint already exists).

BEGIN;

CREATE TEMP TABLE incident_dupes AS
SELECT id AS dup_id,
       FIRST_VALUE(id) OVER (
         PARTITION BY match_id, type, minute, description
         ORDER BY created_at ASC, id ASC
       ) AS keep_id
FROM "RTR Incidents";

DELETE FROM incident_dupes WHERE dup_id = keep_id;

-- Move votes on a duplicate onto the kept row, unless that user already voted there
UPDATE "RTR Incident Votes" v
SET incident_id = d.keep_id
FROM incident_dupes d
WHERE v.incident_id = d.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM "RTR Incident Votes" v2
    WHERE v2.incident_id = d.keep_id AND v2.user_id = v.user_id
  );

-- Any vote left on a duplicate at this point means that user already voted
-- on the kept row too — nothing left to do but drop the leftover duplicate vote
DELETE FROM "RTR Incident Votes" v
USING incident_dupes d
WHERE v.incident_id = d.dup_id;

DELETE FROM "RTR Incidents" i
USING incident_dupes d
WHERE i.id = d.dup_id;

DROP TABLE incident_dupes;

ALTER TABLE "RTR Incidents"
  ADD CONSTRAINT uq_incident_event UNIQUE (match_id, type, minute, description);

COMMIT;
