-- Run this in Supabase dashboard → SQL Editor
--
-- Two new tables for the forum:
--
-- 1. RTR Notifications — "@username mentioned you" alerts. A mentioning
--    user's own client inserts a row for the MENTIONED user (not
--    themselves), which is why the insert policy checks from_user_id
--    (the sender) rather than user_id (the recipient) — you can only
--    claim to be the sender, never fake who sent it, but you can send
--    "at" anyone. Reading/marking-read is owner-only as normal.
--
-- 2. RTR Reactions — yellow/red card reactions on any forum post or
--    reply. One reaction per user per post (UNIQUE constraint), so
--    picking a new card type replaces your old one rather than stacking.
--    Counts are public read (visible to guests browsing the forum);
--    writing your own reaction requires being that user.

CREATE TABLE IF NOT EXISTS "RTR Notifications" (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  from_user_id UUID NOT NULL,
  from_username TEXT NOT NULL,
  post_id BIGINT NOT NULL REFERENCES "RTR Forum"(id) ON DELETE CASCADE,
  excerpt TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON "RTR Notifications" (user_id, read);

ALTER TABLE "RTR Notifications" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON "RTR Notifications";
CREATE POLICY "notifications_select_own" ON "RTR Notifications"
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON "RTR Notifications";
CREATE POLICY "notifications_update_own" ON "RTR Notifications"
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_as_self" ON "RTR Notifications";
CREATE POLICY "notifications_insert_as_self" ON "RTR Notifications"
  FOR INSERT WITH CHECK (auth.uid() = from_user_id);


CREATE TABLE IF NOT EXISTS "RTR Reactions" (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES "RTR Forum"(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('yellow','red')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_post ON "RTR Reactions" (post_id);

ALTER TABLE "RTR Reactions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reactions_select_public" ON "RTR Reactions";
CREATE POLICY "reactions_select_public" ON "RTR Reactions"
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "reactions_insert_own" ON "RTR Reactions";
CREATE POLICY "reactions_insert_own" ON "RTR Reactions"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reactions_update_own" ON "RTR Reactions";
CREATE POLICY "reactions_update_own" ON "RTR Reactions"
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reactions_delete_own" ON "RTR Reactions";
CREATE POLICY "reactions_delete_own" ON "RTR Reactions"
  FOR DELETE USING (auth.uid() = user_id);
