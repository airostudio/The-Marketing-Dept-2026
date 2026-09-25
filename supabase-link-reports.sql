-- Audema Link Funnel — saved results from bulk URL clean-up + health checks
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-business-brain.sql and supabase-intelligence-profiles.sql
-- have already been run (same dual project/profile scope + sharing model as
-- supabase-audience.sql).
--
-- web/tools/link-funnel.html lets someone drop a spreadsheet or document full
-- of URLs, splits the real URLs from surrounding text, and runs the same
-- website-health check Blade already runs per-lead against each one. This is
-- where a run's results land so any agent — not just the tool page itself —
-- can look up "what did we already find out about these URLs for this
-- campaign" instead of re-uploading and re-checking the same list.

CREATE TABLE IF NOT EXISTS link_check_reports (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  name              TEXT        NOT NULL,
  source_filename   TEXT,

  -- One row per URL that looked real: { url, status: 'modern'|'outdated'|
  -- 'unreachable'|'check_failed', reasons: string[], checkedAt }. Kept as
  -- JSONB rather than a child table — a report is written once by the tool
  -- page and read as a whole, never queried or filtered row-by-row.
  results           JSONB       NOT NULL DEFAULT '[]',

  -- Whatever didn't parse as a URL, and why: { text, reason }. Kept so the
  -- person who uploaded the file can see exactly what got thrown out instead
  -- of silently vanishing.
  rejected          JSONB       NOT NULL DEFAULT '[]',

  good_count        INT         NOT NULL DEFAULT 0,
  bad_count         INT         NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_reports_user     ON link_check_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_link_reports_project  ON link_check_reports (project_id);
CREATE INDEX IF NOT EXISTS idx_link_reports_profile  ON link_check_reports (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_link_reports_created  ON link_check_reports (created_at DESC);

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE link_check_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "link_reports_owner_all" ON link_check_reports;
CREATE POLICY "link_reports_owner_all" ON link_check_reports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Shared across a business's team the same way contacts/segments are: anyone
-- who can edit the intelligence profile this report was saved against can
-- see it too, not just whoever happened to run the upload.
DROP POLICY IF EXISTS "link_reports_profile_access" ON link_check_reports;
CREATE POLICY "link_reports_profile_access" ON link_check_reports
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );
