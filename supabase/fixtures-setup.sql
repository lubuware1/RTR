-- Run this in Supabase dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS "RTR Fixtures" (
  id           INTEGER PRIMARY KEY,   -- football-data.org match ID
  matchweek    INTEGER NOT NULL,
  home         TEXT    NOT NULL,
  away         TEXT    NOT NULL,
  home_emoji   TEXT    DEFAULT '',
  away_emoji   TEXT    DEFAULT '',
  kickoff      TIMESTAMPTZ,
  status       TEXT    DEFAULT 'upcoming',
  score        TEXT    DEFAULT '– v –',
  ref_id       INTEGER,               -- set manually via admin
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Allow the app (anon role) to read fixtures
ALTER TABLE "RTR Fixtures" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON "RTR Fixtures"
  FOR SELECT USING (true);

-- Allow the Edge Function (service role) to upsert — service role bypasses RLS by default
