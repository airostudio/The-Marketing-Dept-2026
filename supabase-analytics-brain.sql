-- Analytics Brain — Persisted Report History
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Report Builder generated a report and threw it away the moment you
-- navigated off the page (or refreshed) — only a local, this-device-only
-- copy existed via agent-history.js's localStorage cache. This table gives
-- generated reports the same real, cross-device, versioned persistence
-- pattern the rest of the app uses (nancy_content_weeks, business_brain,
-- etc.) — same dual project/intel_profile scope model as ContactsStore.

CREATE TABLE IF NOT EXISTS analytics_reports (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  report_type       TEXT        NOT NULL, -- 'monthly' | 'quarterly' | 'campaign' | 'exec' | 'board'
  audience          TEXT,                 -- 'cmo' | 'ceo' | 'board' | 'team' | 'client'
  title             TEXT        NOT NULL,
  focus             TEXT,                 -- optional key-message input the user gave
  source_data       TEXT,                 -- the raw metrics/data pasted in, kept for reference
  content           TEXT        NOT NULL, -- the generated report (markdown)

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_reports_user    ON analytics_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_reports_project ON analytics_reports (project_id);
CREATE INDEX IF NOT EXISTS idx_analytics_reports_profile ON analytics_reports (intel_profile_id);

ALTER TABLE analytics_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_reports_owner_all" ON analytics_reports;
CREATE POLICY "analytics_reports_owner_all" ON analytics_reports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
