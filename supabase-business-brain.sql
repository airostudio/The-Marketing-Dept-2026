-- Aduma Business Brain — Per-Project Cloud Sync + Version History
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Fixes: BusinessBrain data previously lived only in localStorage (key
-- 'intel_business_brain'), was NOT scoped per-project (one shared brain for
-- every project), and had zero version history. This schema makes Business
-- Brain a first-class per-project, cloud-synced, versioned record.

-- ── Current brain state (one row per project) ─────────────────────────────
CREATE TABLE IF NOT EXISTS business_brain (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data              JSONB       NOT NULL DEFAULT '{}',
  confidence_score  INTEGER     DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id)
);

-- ── Append-only snapshot history (last 20 kept per project, pruned by app) ─
CREATE TABLE IF NOT EXISTS business_brain_history (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data              JSONB       NOT NULL,
  confidence_score  INTEGER     DEFAULT 0,
  label             TEXT,                 -- e.g. 'Autosave', 'Autofill overwrite', 'Manual snapshot'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brain_project          ON business_brain         (project_id);
CREATE INDEX IF NOT EXISTS idx_brain_user             ON business_brain         (user_id);
CREATE INDEX IF NOT EXISTS idx_brain_history_project   ON business_brain_history (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_history_user      ON business_brain_history (user_id);

-- ── Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE business_brain         ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_brain_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own brain"
  ON business_brain FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own brain history"
  ON business_brain_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_business_brain_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER business_brain_updated_at
  BEFORE UPDATE ON business_brain
  FOR EACH ROW EXECUTE FUNCTION update_business_brain_updated_at();
