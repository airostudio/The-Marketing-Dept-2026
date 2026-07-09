-- Audema Intelligence Profiles — multi-business Intelligence Layer
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-business-brain.sql has already been run.
--
-- One "intelligence profile" = one business's complete Intelligence Layer
-- (Business Brain, and later radar/pulse). Users switch profiles to work on
-- different businesses. Plan limits: basic=1, professional=3, agency=8,
-- enterprise=admin-configured per account.

-- ── Extend account plans ───────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free','basic','pro','professional','agency','enterprise'));

-- Admin-set profile allowance for enterprise accounts (NULL = not set → 1)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS intel_profile_limit INTEGER;

-- ── Intelligence profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_profiles (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  business_name TEXT        DEFAULT '',
  notes         TEXT        DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Shared access: members can be granted a role on a profile ("with the
-- right access, change the intelligence profile")
CREATE TABLE IF NOT EXISTS intelligence_profile_members (
  profile_id UUID NOT NULL REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_intel_profiles_owner  ON intelligence_profiles (owner_id);
CREATE INDEX IF NOT EXISTS idx_intel_members_user    ON intelligence_profile_members (user_id);

-- ── Link Business Brain data to profiles ───────────────────────────────────
-- business_brain was project-scoped; profile scoping supersedes it (project
-- scoping remains as a fallback for accounts that haven't run this migration).
ALTER TABLE business_brain         ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE business_brain_history ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE business_brain
  ADD COLUMN IF NOT EXISTS intel_profile_id UUID REFERENCES intelligence_profiles(id) ON DELETE CASCADE;
ALTER TABLE business_brain_history
  ADD COLUMN IF NOT EXISTS intel_profile_id UUID REFERENCES intelligence_profiles(id) ON DELETE CASCADE;

-- One current-state row per profile
CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_per_profile
  ON business_brain (intel_profile_id) WHERE intel_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brain_history_profile
  ON business_brain_history (intel_profile_id, created_at DESC);

-- ── Plan limit resolution + enforcement ────────────────────────────────────
CREATE OR REPLACE FUNCTION get_intel_profile_limit(uid UUID)
RETURNS INTEGER AS $$
  SELECT CASE plan
    WHEN 'agency'       THEN 8
    WHEN 'professional' THEN 3
    WHEN 'pro'          THEN 3
    WHEN 'enterprise'   THEN COALESCE(intel_profile_limit, 1)
    ELSE 1  -- free / basic
  END
  FROM profiles WHERE id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION enforce_intel_profile_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  allowed       INTEGER;
BEGIN
  SELECT COUNT(*) INTO current_count FROM intelligence_profiles WHERE owner_id = NEW.owner_id;
  allowed := COALESCE(get_intel_profile_limit(NEW.owner_id), 1);
  IF current_count >= allowed THEN
    RAISE EXCEPTION 'Intelligence profile limit reached (% of % used). Upgrade your plan to add more profiles.', current_count, allowed;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_intel_profile_limit ON intelligence_profiles;
CREATE TRIGGER trg_intel_profile_limit
  BEFORE INSERT ON intelligence_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_intel_profile_limit();

-- ── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_intel_profile()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intel_profile_touch ON intelligence_profiles;
CREATE TRIGGER trg_intel_profile_touch
  BEFORE UPDATE ON intelligence_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_intel_profile();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE intelligence_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_profile_members ENABLE ROW LEVEL SECURITY;

-- Owner: full control. Members: read the profile record.
DROP POLICY IF EXISTS "ip_owner_all"    ON intelligence_profiles;
CREATE POLICY "ip_owner_all" ON intelligence_profiles
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "ip_member_read" ON intelligence_profiles;
CREATE POLICY "ip_member_read" ON intelligence_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM intelligence_profile_members m
            WHERE m.profile_id = id AND m.user_id = auth.uid())
  );

-- Membership rows: profile owner manages; users see their own memberships.
DROP POLICY IF EXISTS "ipm_owner_manage" ON intelligence_profile_members;
CREATE POLICY "ipm_owner_manage" ON intelligence_profile_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM intelligence_profiles p
            WHERE p.id = profile_id AND p.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM intelligence_profiles p
            WHERE p.id = profile_id AND p.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "ipm_self_read" ON intelligence_profile_members;
CREATE POLICY "ipm_self_read" ON intelligence_profile_members
  FOR SELECT USING (user_id = auth.uid());

-- ── Extend brain policies for profile members ──────────────────────────────
-- Existing policies allow auth.uid() = user_id (the writer). Add access for
-- profile owner + editors so shared profiles work.
DROP POLICY IF EXISTS "brain_profile_access" ON business_brain;
CREATE POLICY "brain_profile_access" ON business_brain
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner','editor'))
    )
  );

DROP POLICY IF EXISTS "brain_history_profile_access" ON business_brain_history;
CREATE POLICY "brain_history_profile_access" ON business_brain_history
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner','editor'))
    )
  );
