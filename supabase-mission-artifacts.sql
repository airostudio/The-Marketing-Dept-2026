-- Audema Mission Artifacts — the real, approvable output of a Scotty mission.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql already run (for sharing).
--
-- A Scotty mission used to "run" an agent by asking Claude to write up what
-- that agent would have produced — a markdown report, nothing real behind it.
-- A mission task that actually runs an agent's real pipeline needs somewhere
-- real to put what it produced, in a form a person can look at and approve
-- with one click: that's this table. One row per agent task's output.
--
-- kind says what payload holds and what "approve" does for it:
--   'blade_leads' — shortlisted local businesses (Blade). Approving imports
--                   the ones with a real email into Beeker's contacts,
--                   tagged and with their provenance recorded. It sends
--                   nothing — sending is Pat's job, behind its own checks.
--   'pat_campaign' — a drafted, QA-reviewed outreach email (Pat). Approving
--                   records the human OK and prepares an audience segment;
--                   it sends nothing. The person sends from Pat's own page.
--   'nancy_week'  — a week of Instagram posts with hosted images (Nancy).
--                   Approving puts them in the Content Calendar as approved;
--                   it schedules and publishes nothing.
--   'competitive_report' — competitor battlecards (every finding quote-verified
--                   against their pages) and a cross-competitor read (figures
--                   checked). Approving saves it to Report History and starts
--                   daily change-watching on those sites.
--   'analytics_report' — a performance report written only from the account's
--                   own numbers, with every figure checked against them (Analytics).
--                   Approving saves it to Report History; it sends nothing.
--   'ad_campaign' — ad copy per platform, checked against platform limits (Ads).
--                   Approving saves the fitting ads as approved ad copy; it
--                   buys, schedules and publishes nothing.
--   'seo_plan'    — SEO research, proposed topics and drafted articles (SEO).
--                   Approving saves them into the SEO Content Engine as a new
--                   run; it publishes nothing.
--   'social_posts' — text posts for LinkedIn / X / Facebook (Social Studio).
--                   Approving puts the publishable ones in the Content
--                   Calendar as approved; it schedules and publishes nothing.
--   'chase_audit' — website audits of a Blade shortlist (Chase). Approving
--                   tags prospects already in the audience by opportunity.
-- New agents add a kind; nothing about the table changes.
--
-- Writes happen only through the service-role endpoints
-- (api/mission-blade.js, api/mission-artifacts.js), which do their own
-- ownership/profile-membership check; the policies below are for reading.

CREATE TABLE IF NOT EXISTS mission_artifacts (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  mission_id        TEXT,       -- the client-side MissionStore id, when the artifact came from a mission
  agent_key         TEXT        NOT NULL,
  kind              TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  payload           JSONB       NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'building'
                                CHECK (status IN ('building', 'pending_approval', 'approved', 'rejected', 'empty')),
  decided_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_artifacts_user    ON mission_artifacts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_artifacts_profile ON mission_artifacts (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_mission_artifacts_status  ON mission_artifacts (status);

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE mission_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_artifacts_owner_all" ON mission_artifacts;
CREATE POLICY "mission_artifacts_owner_all" ON mission_artifacts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Same profile-sharing pattern as contacts/campaigns/site watchlist: anyone
-- on the business can see what a mission produced for it.
DROP POLICY IF EXISTS "mission_artifacts_profile_read" ON mission_artifacts;
CREATE POLICY "mission_artifacts_profile_read" ON mission_artifacts
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid())
    )
  );
