-- ═══════════════════════════════════════════════════════════════════════
-- HOTFIX: sign-in is failing for everyone
-- ═══════════════════════════════════════════════════════════════════════
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run. Takes about a second. Sign-in works again immediately —
-- no deploy needed, this is database-side only.
--
-- ── What broke ─────────────────────────────────────────────────────────
--
-- Three policies ON profiles asked a question ABOUT profiles:
--
--     CREATE POLICY "Admins can view all profiles" ON profiles
--       FOR SELECT USING (
--         EXISTS (SELECT 1 FROM profiles WHERE ...)   -- ← same table
--       );
--
-- To decide whether you may read a row of profiles, Postgres has to run
-- that subquery — which reads profiles — which invokes the policy again.
-- It detects the loop and raises:
--
--     42P17: infinite recursion detected in policy for relation "profiles"
--
-- Every read of profiles fails, for everyone. The app reads the profile
-- immediately after authenticating, so sign-in fails at that step even
-- though the password was accepted.
--
-- ── Why it started now ─────────────────────────────────────────────────
--
-- These policies have been wrong since they were written, but they had
-- never actually been created. database/admin-setup.sql used bare
-- CREATE POLICY with no DROP guard, so a second run died partway with
-- 42710 "policy already exists" — the error reported earlier today — and
-- aborted BEFORE reaching them.
--
-- Adding the DROP ... IF EXISTS guards fixed that abort, the script ran
-- to completion for the first time, and the recursive policies finally
-- took effect. The idempotency fix was right; it uncovered this.
--
-- ── The fix ────────────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function runs as its owner rather than the caller,
-- so the lookup inside it does not re-enter the policy. Same rule, no
-- loop. It answers only about the current caller, so it discloses
-- nothing: the boolean it returns is one you already know about yourself.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE ALL   ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- ── profiles ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile" ON profiles
    FOR UPDATE USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins can delete non-admin profiles" ON profiles;
CREATE POLICY "Admins can delete non-admin profiles" ON profiles
    FOR DELETE USING (public.is_platform_admin() AND role = 'user');

-- ── projects ───────────────────────────────────────────────────────────
-- Not recursive (different table), but same rule, one definition.
DROP POLICY IF EXISTS "Admins can view all projects" ON projects;
CREATE POLICY "Admins can view all projects" ON projects
    FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins can update all projects" ON projects;
CREATE POLICY "Admins can update all projects" ON projects
    FOR UPDATE USING (public.is_platform_admin());

-- ── check it worked ────────────────────────────────────────────────────
-- This must return a row rather than raising 42P17. It is your own
-- profile, read through the same policies the app uses.
SELECT id, email, role FROM profiles WHERE id = auth.uid();
