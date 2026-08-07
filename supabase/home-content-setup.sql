-- Run this in Supabase dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS "RTR Home Content" (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  content    JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow the app (anon role) to read the homepage content
ALTER TABLE "RTR Home Content" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON "RTR Home Content"
  FOR SELECT USING (true);

-- Allow the app (anon role) to write it — same posture as "RTR Config" /
-- "RTR Manual Bonuses": access is gated client-side in admin.html via
-- ADMIN_USERS, not by Postgres RLS, since the site doesn't use Supabase Auth.
CREATE POLICY "Public write" ON "RTR Home Content"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public update" ON "RTR Home Content"
  FOR UPDATE USING (true);
