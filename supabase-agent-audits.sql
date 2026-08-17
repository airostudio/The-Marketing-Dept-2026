-- Audema Agent Audits — bi-monthly "stay current" research runs.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Not tenant-scoped like most other tables here — this data is about the
-- PLATFORM'S OWN agents (Rex, Pat, Beeker, Pulse, etc.), not any client's
-- business, so every signed-in user can read the same shared audit history.
-- Only api/cron-agent-audit.js (service-role key) writes to it.

CREATE TABLE IF NOT EXISTS agent_audit_runs (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT        NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partial', 'failed')),
  agent_count      INTEGER     NOT NULL DEFAULT 0,
  flagged_count    INTEGER     NOT NULL DEFAULT 0,
  overall_summary  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_audit_findings (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES agent_audit_runs(id) ON DELETE CASCADE,
  agent_key         TEXT        NOT NULL, -- matches AGENT_META keys in scotty.html, e.g. 'seo', 'social', 'linkedin'
  agent_label       TEXT        NOT NULL, -- human display name, e.g. "SEO Intelligence (Rex)"
  up_to_date        BOOLEAN     NOT NULL DEFAULT true,
  summary           TEXT,
  gaps              JSONB       DEFAULT '[]',   -- string[]
  recommendations   JSONB       DEFAULT '[]',   -- [{text, impact: 'high'|'medium'|'low'}]
  security_notes    JSONB       DEFAULT '[]',   -- string[]
  sources           JSONB       DEFAULT '[]',   -- [{title, url}]
  error             TEXT,                        -- set if this agent's research call failed — findings above are empty/partial in that case
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_findings_run     ON agent_audit_findings (run_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_findings_agent   ON agent_audit_findings (agent_key);
CREATE INDEX IF NOT EXISTS idx_agent_audit_runs_run_at      ON agent_audit_runs (run_at DESC);

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Read-only for any signed-in user (this is meta-info about the product's
-- own agents, not client data); writes only via the service-role key the
-- cron job uses, which bypasses RLS entirely.
ALTER TABLE agent_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_audit_runs_read" ON agent_audit_runs;
CREATE POLICY "agent_audit_runs_read" ON agent_audit_runs
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "agent_audit_findings_read" ON agent_audit_findings;
CREATE POLICY "agent_audit_findings_read" ON agent_audit_findings
  FOR SELECT USING (auth.role() = 'authenticated');
