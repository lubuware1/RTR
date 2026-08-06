-- Run this in Supabase dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS "RTR Articles" (
  id           BIGSERIAL PRIMARY KEY,
  tag          TEXT NOT NULL DEFAULT 'match',   -- incident | match | forum | rating | fantasy | live
  tag_text     TEXT NOT NULL DEFAULT '',
  headline     TEXT NOT NULL DEFAULT '',
  dek          TEXT NOT NULL DEFAULT '',         -- short teaser shown on cards
  body         TEXT NOT NULL DEFAULT '',         -- full story; paragraphs separated by a blank line
  meta_left    TEXT DEFAULT '',
  meta_right   TEXT DEFAULT '',
  media        JSONB DEFAULT '{"type":"css","variant":"pitch"}',
  published_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "RTR Articles" ENABLE ROW LEVEL SECURITY;

-- Anyone can read published articles
CREATE POLICY "Public read" ON "RTR Articles"
  FOR SELECT USING (true);

-- Same posture as "RTR Home Content" / "RTR Config": write access is gated
-- client-side in admin.html via ADMIN_USERS, not by Postgres RLS.
CREATE POLICY "Public write" ON "RTR Articles"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public update" ON "RTR Articles"
  FOR UPDATE USING (true);

CREATE POLICY "Public delete" ON "RTR Articles"
  FOR DELETE USING (true);
