-- Run this in Supabase dashboard → SQL Editor
--
-- Fixes a confirmed privilege-escalation vulnerability found during
-- penetration testing: the RTR Profiles insert/update policies only check
-- that a user is writing their OWN row (auth.uid() = id) — nothing stops
-- them from setting is_admin = true on that row themselves. Proven live
-- with a real self-signed-up test account (see session notes) — a single
-- authenticated PATCH request made it a full site admin.
--
-- Two old duplicate policies ("Users can insert own profile", "Users can
-- update own profile") have the same gap and must be dropped too — since
-- Postgres OR's permissive policies together, leaving them in place would
-- keep the hole open even after tightening the ones below.

DROP POLICY IF EXISTS "Users can insert own profile" ON "RTR Profiles";
DROP POLICY IF EXISTS "Users can update own profile" ON "RTR Profiles";

DROP POLICY IF EXISTS "profiles_insert_own" ON "RTR Profiles";
CREATE POLICY "profiles_insert_own" ON "RTR Profiles"
  FOR INSERT WITH CHECK (auth.uid() = id AND is_admin = false);

DROP POLICY IF EXISTS "profiles_update_own" ON "RTR Profiles";
CREATE POLICY "profiles_update_own" ON "RTR Profiles"
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT p.is_admin FROM "RTR Profiles" p WHERE p.id = auth.uid())
  );

-- Optional hygiene while in here: two more harmless-but-redundant read
-- policies exist from the same old policy set (both equivalent to the
-- "profiles_select_public"/"Public read profiles" ones already kept) —
-- safe to drop, not a security fix, just removes clutter.
DROP POLICY IF EXISTS "Users can read own profile" ON "RTR Profiles";
DROP POLICY IF EXISTS "Public read profiles" ON "RTR Profiles";
