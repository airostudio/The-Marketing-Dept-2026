-- Audema Competitive Roster — cloud persistence for Competitive Command.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- The competitor roster, market gaps and battlecards lived in localStorage
-- only ('tmd_radar', 'tmd_ci_gaps', 'tmd_ci_battlecards'). That meant the
-- competitive picture a team had built — positioning, threat levels, logged
-- moves, gap scores, generated battlecards — existed on exactly one browser on
-- one machine. Clearing site data destroyed it, a second device never saw it,
-- and a colleague on the same account saw an empty page.
--
-- This is the same dual project/intel_profile scope model as ContactsStore and
-- AnalyticsStore, and the same "client calls Supabase directly, RLS does the
-- enforcing" pattern.
--
-- Distinct from competitor_watches (supabase-competitor-watch.sql): that is the
-- opt-in "check this URL daily and alert me when it changes" list. This is the
-- analyst's own working picture of the market.

CREATE TABLE IF NOT EXISTS competitive_roster (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  -- 'competitor' | 'gap' | 'battlecard'
  kind             TEXT        NOT NULL CHECK (kind IN ('competitor', 'gap', 'battlecard')),

  -- The id the page generated ('c_1738…'). Kept as the identity so records
  -- already referenced by other rows — a battlecard pointing at a competitor,
  -- a move pointing at its parent — keep pointing at the right thing after the
  -- migration from localStorage.
  client_id        TEXT        NOT NULL,

  -- The record as the page models it. The UI edits these objects wholesale
  -- (drag a competitor on the positioning map, push a move onto its list), so
  -- storing the shape it already uses keeps one source of truth rather than
  -- two that can drift.
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  -- One row per record per scope. Re-saving the same competitor updates it
  -- rather than accumulating duplicates on every edit.
  UNIQUE (user_id, kind, client_id)
);

CREATE INDEX IF NOT EXISTS idx_competitive_roster_user
  ON competitive_roster (user_id, kind);
CREATE INDEX IF NOT EXISTS idx_competitive_roster_profile
  ON competitive_roster (intel_profile_id, kind);
CREATE INDEX IF NOT EXISTS idx_competitive_roster_project
  ON competitive_roster (project_id, kind);

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_competitive_roster()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_competitive_roster_touch ON competitive_roster;
CREATE TRIGGER trg_competitive_roster_touch
  BEFORE UPDATE ON competitive_roster
  FOR EACH ROW EXECUTE FUNCTION touch_competitive_roster();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE competitive_roster ENABLE ROW LEVEL SECURITY;

-- Owner always has full access to their own rows.
DROP POLICY IF EXISTS "competitive_roster_owner_all" ON competitive_roster;
CREATE POLICY "competitive_roster_owner_all" ON competitive_roster
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A teammate granted access to an intelligence profile can read the
-- competitive picture built under it — the same sharing rule the rest of the
-- profile-scoped data already follows.
DROP POLICY IF EXISTS "competitive_roster_member_read" ON competitive_roster;
CREATE POLICY "competitive_roster_member_read" ON competitive_roster
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM intelligence_profiles p
        WHERE p.id = competitive_roster.intel_profile_id AND p.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM intelligence_profile_members m
        WHERE m.profile_id = competitive_roster.intel_profile_id AND m.user_id = auth.uid()
      )
    )
  );

-- Editors and owners of a shared profile can also change it; viewers cannot.
DROP POLICY IF EXISTS "competitive_roster_member_write" ON competitive_roster;
CREATE POLICY "competitive_roster_member_write" ON competitive_roster
  FOR UPDATE USING (
    intel_profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM intelligence_profile_members m
      WHERE m.profile_id = competitive_roster.intel_profile_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'editor')
    )
  );
