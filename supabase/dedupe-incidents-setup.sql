-- Run this in Supabase dashboard → SQL Editor
--
-- sync-live-incidents.js (the scheduled function that polls football-data.org
-- every 2 minutes during live matches) was supposed to skip re-inserting a
-- card/penalty it had already created, by checking existing RTR Incidents
-- rows first. That check was failing in practice: Crystal Palace v Ipswich
-- (2026-09-12) ended up with 142 rows for 5 real events, each duplicated
-- ~25-30 times — one extra copy roughly every poll for the rest of the
-- match. Several other matches that gameweek show the same pattern at
-- smaller scale.
--
-- This adds a real, DB-level guarantee instead of relying on an
-- application-side read-then-insert check (which is exactly the kind of
-- thing that's fragile to a stale read, a race between overlapping
-- invocations, or any other transient failure — a unique constraint can't
-- have that class of bug).
--
-- IMPORTANT: run the cleanup step to remove existing duplicate rows FIRST —
-- Postgres will refuse to create a unique index over data that already
-- violates it. See the separate cleanup pass before running this.

ALTER TABLE "RTR Incidents"
  ADD CONSTRAINT uq_incident_event UNIQUE (match_id, type, minute, description);
