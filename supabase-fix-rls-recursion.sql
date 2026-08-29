-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: infinite recursion in intelligence_profiles / intelligence_profile_members RLS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Symptom
--   "infinite recursion detected in policy for relation intelligence_profiles"
--   on any read of intelligence_profiles. This makes ensureActiveProfile()
--   fail, so no profile can ever be created or activated, so Business Brain
--   and the SEO pipeline have no scope and cannot sync to the cloud.
--
-- Cause
--   The original policies in supabase-intelligence-profiles.sql cross-
--   reference each other's tables:
--
--     intelligence_profiles.ip_member_read
--       -> SELECT ... FROM intelligence_profile_members
--          which evaluates intelligence_profile_members' policies
--     intelligence_profile_members.ipm_owner_manage
--       -> SELECT ... FROM intelligence_profiles
--          which evaluates intelligence_profiles' policies -> loop
--
--   Postgres evaluates RLS on tables referenced *inside* a policy, so the two
--   policies invoke each other indefinitely.
--
-- Fix
--   Move the cross-table lookups into SECURITY DEFINER functions. Those run
--   as the function owner and bypass RLS on the tables they read, which
--   breaks the cycle. They are STABLE and take explicit arguments, so they
--   are also cheaper than the inline EXISTS subqueries they replace.
--
-- Safe to re-run. Does not touch or delete any data — policies only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper functions (bypass RLS to break the policy cycle) ────────────────
-- search_path is pinned explicitly: a SECURITY DEFINER function without it
-- can be hijacked via a caller-controlled search_path.

CREATE OR REPLACE FUNCTION is_intel_profile_owner(pid UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM intelligence_profiles
    WHERE id = pid AND owner_id = uid
  );
$$;

CREATE OR REPLACE FUNCTION is_intel_profile_member(pid UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM intelligence_profile_members
    WHERE profile_id = pid AND user_id = uid
  );
$$;

-- Owner/editor = write access to a profile's Business Brain.
CREATE OR REPLACE FUNCTION can_edit_intel_profile(pid UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM intelligence_profiles
    WHERE id = pid AND owner_id = uid
  ) OR EXISTS (
    SELECT 1 FROM intelligence_profile_members
    WHERE profile_id = pid AND user_id = uid AND role IN ('owner','editor')
  );
$$;

GRANT EXECUTE ON FUNCTION is_intel_profile_owner(UUID, UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION is_intel_profile_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_edit_intel_profile(UUID, UUID)  TO authenticated;

-- ── intelligence_profiles ──────────────────────────────────────────────────
-- Owner policy needs no function: owner_id is on this row, no cross-table
-- lookup, so it cannot recurse.
DROP POLICY IF EXISTS "ip_owner_all" ON intelligence_profiles;
CREATE POLICY "ip_owner_all" ON intelligence_profiles
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- This one was half of the cycle — now goes through the SECURITY DEFINER fn.
DROP POLICY IF EXISTS "ip_member_read" ON intelligence_profiles;
CREATE POLICY "ip_member_read" ON intelligence_profiles
  FOR SELECT USING (is_intel_profile_member(id, auth.uid()));

-- ── intelligence_profile_members ───────────────────────────────────────────
-- The other half of the cycle.
DROP POLICY IF EXISTS "ipm_owner_manage" ON intelligence_profile_members;
CREATE POLICY "ipm_owner_manage" ON intelligence_profile_members
  FOR ALL USING (is_intel_profile_owner(profile_id, auth.uid()))
  WITH CHECK (is_intel_profile_owner(profile_id, auth.uid()));

-- Self-read needs no function: user_id is on this row.
DROP POLICY IF EXISTS "ipm_self_read" ON intelligence_profile_members;
CREATE POLICY "ipm_self_read" ON intelligence_profile_members
  FOR SELECT USING (user_id = auth.uid());

-- ── business_brain / business_brain_history ────────────────────────────────
-- These read both profile tables, so they inherited the recursion too.
DROP POLICY IF EXISTS "brain_profile_access" ON business_brain;
CREATE POLICY "brain_profile_access" ON business_brain
  FOR ALL USING (
    intel_profile_id IS NOT NULL
    AND can_edit_intel_profile(intel_profile_id, auth.uid())
  ) WITH CHECK (
    intel_profile_id IS NOT NULL
    AND can_edit_intel_profile(intel_profile_id, auth.uid())
  );

DROP POLICY IF EXISTS "brain_history_profile_access" ON business_brain_history;
CREATE POLICY "brain_history_profile_access" ON business_brain_history
  FOR ALL USING (
    intel_profile_id IS NOT NULL
    AND can_edit_intel_profile(intel_profile_id, auth.uid())
  ) WITH CHECK (
    intel_profile_id IS NOT NULL
    AND can_edit_intel_profile(intel_profile_id, auth.uid())
  );

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Should return without error (0 rows is fine — no recursion is the point).
DO $$
BEGIN
  PERFORM 1 FROM intelligence_profiles LIMIT 1;
  RAISE NOTICE 'OK: intelligence_profiles is readable without recursion.';
END $$;
