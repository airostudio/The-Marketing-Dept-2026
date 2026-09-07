-- Audema CRO Backlog — cloud persistence for CRO Lab's ICE-scored test list.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- The ICE backlog lived in localStorage only ('cro_ice_tests') while the
-- experiments beside it were already cloud-backed — so the page had one half
-- of its workflow shared across the team and the other half stranded on one
-- browser. The backlog is the collaborative half: it is the prioritised list a
-- team argues over and works down, and each row can be handed to Scotty as a
-- mission, so it needs to be the same list for everyone looking at it.
--
-- Same dual project/intel_profile scope model and RLS pattern as
-- competitive_roster, video_generations and analytics_reports.

CREATE TABLE IF NOT EXISTS cro_backlog_tests (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  -- The id the page generated (Date.now()). Kept as the identity so a row
  -- already dispatched to Scotty as a mission still resolves to the same test
  -- after the lift out of localStorage.
  client_id        TEXT        NOT NULL,

  name             TEXT        NOT NULL,
  -- ICE is scored 1-10 on each axis. Constrained here as well as in the UI:
  -- a score outside that range silently changes every ranking on the page.
  impact           INTEGER     NOT NULL DEFAULT 5 CHECK (impact     BETWEEN 1 AND 10),
  confidence       INTEGER     NOT NULL DEFAULT 5 CHECK (confidence BETWEEN 1 AND 10),
  ease             INTEGER     NOT NULL DEFAULT 5 CHECK (ease       BETWEEN 1 AND 10),

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_cro_backlog_user
  ON cro_backlog_tests (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cro_backlog_profile
  ON cro_backlog_tests (intel_profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cro_backlog_project
  ON cro_backlog_tests (project_id, created_at);

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_cro_backlog_tests()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cro_backlog_touch ON cro_backlog_tests;
CREATE TRIGGER trg_cro_backlog_touch
  BEFORE UPDATE ON cro_backlog_tests
  FOR EACH ROW EXECUTE FUNCTION touch_cro_backlog_tests();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE cro_backlog_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cro_backlog_owner_all" ON cro_backlog_tests;
CREATE POLICY "cro_backlog_owner_all" ON cro_backlog_tests
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A teammate on a shared intelligence profile sees the same backlog — this is
-- a list a team prioritises together, so a private copy per person would
-- defeat the point.
DROP POLICY IF EXISTS "cro_backlog_member_read" ON cro_backlog_tests;
CREATE POLICY "cro_backlog_member_read" ON cro_backlog_tests
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM intelligence_profiles p
        WHERE p.id = cro_backlog_tests.intel_profile_id AND p.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM intelligence_profile_members m
        WHERE m.profile_id = cro_backlog_tests.intel_profile_id AND m.user_id = auth.uid()
      )
    )
  );

-- Editors and owners can re-score and add; viewers read only.
DROP POLICY IF EXISTS "cro_backlog_member_write" ON cro_backlog_tests;
CREATE POLICY "cro_backlog_member_write" ON cro_backlog_tests
  FOR UPDATE USING (
    intel_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM intelligence_profile_members m
      WHERE m.profile_id = cro_backlog_tests.intel_profile_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'editor')
    )
  );
