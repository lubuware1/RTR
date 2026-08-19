-- Run this in Supabase dashboard → SQL Editor
--
-- New table for the in-app support/bug-report page. Users submit a message
-- while logged in; only admins can read or update (mark read/resolved)
-- the resulting rows. Uses the existing public.is_admin() helper from
-- rls-full-rollout-setup.sql.

CREATE TABLE IF NOT EXISTS "RTR Support Messages" (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES "RTR Profiles"(id),
  username    TEXT NOT NULL,
  email       TEXT,
  category    TEXT NOT NULL DEFAULT 'bug' CHECK (category IN ('bug', 'feedback', 'other')),
  message     TEXT NOT NULL,
  page_url    TEXT,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "RTR Support Messages" ENABLE ROW LEVEL SECURITY;

-- Anyone can submit as themselves; nobody (not even the sender) can read
-- messages back — this is a one-way mailbox to the admin, not a thread.
DROP POLICY IF EXISTS "support_insert_own" ON "RTR Support Messages";
CREATE POLICY "support_insert_own" ON "RTR Support Messages"
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_select_admin" ON "RTR Support Messages";
CREATE POLICY "support_select_admin" ON "RTR Support Messages"
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "support_update_admin" ON "RTR Support Messages";
CREATE POLICY "support_update_admin" ON "RTR Support Messages"
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "support_delete_admin" ON "RTR Support Messages";
CREATE POLICY "support_delete_admin" ON "RTR Support Messages"
  FOR DELETE USING (public.is_admin());
