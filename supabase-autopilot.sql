-- Audema Autopilot — agents that do the work on a schedule, repair what
-- they can, ask for what they need, and tell you what happened.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql.
--
--   connections      a business's own accounts an agent acts on (its website
--                    CMS, Search Console…). Secrets are encrypted by the app
--                    (AES-256-GCM, CONNECTIONS_ENCRYPTION_KEY) before they
--                    reach this table, and no browser can read this table:
--                    every read and write goes through the API.
--   autopilots       which agent runs, on what schedule, for which business,
--                    and how much it may do on its own (earn trust first).
--   agent_jobs       one unit of agent work, run a step at a time by
--                    api/cron-autopilot.js, with every fault and repair kept.
--   activity_events  the "What happened" inbox: work done, problems fixed,
--                    approvals and permissions the business needs to give.

CREATE TABLE IF NOT EXISTS connections (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL CHECK (provider IN ('wordpress', 'webflow', 'shopify', 'wix', 'godaddy', 'gsc')),
  label            TEXT        NOT NULL DEFAULT '',
  site_url         TEXT,
  config           JSONB       NOT NULL DEFAULT '{}',   -- non-secret: blog id, collection id, field map…
  secret_enc       TEXT,                                -- encrypted by the app; never sent to a browser
  status           TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_attention', 'disconnected')),
  status_note      TEXT,
  last_ok_at       TIMESTAMPTZ,
  last_error_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections (user_id, provider);

CREATE TABLE IF NOT EXISTS autopilots (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  agent            TEXT        NOT NULL,                -- 'seo', …
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  cadence          JSONB       NOT NULL DEFAULT '{}',   -- { days: [2,5], hour: 9, timezone: 'Australia/Sydney' }
  settings         JSONB       NOT NULL DEFAULT '{}',
  connection_id    UUID        REFERENCES connections(id) ON DELETE SET NULL,
  -- earn_trust: the first trust_required pieces wait for approval, then it runs on its own.
  mode             TEXT        NOT NULL DEFAULT 'earn_trust' CHECK (mode IN ('earn_trust', 'auto', 'approve')),
  trust_required   INTEGER     NOT NULL DEFAULT 2,
  trust_earned     INTEGER     NOT NULL DEFAULT 0,
  next_run_at      TIMESTAMPTZ,
  last_run_at      TIMESTAMPTZ,
  paused_reason    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autopilots_due ON autopilots (next_run_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS agent_jobs (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  autopilot_id     UUID        REFERENCES autopilots(id) ON DELETE SET NULL,
  agent            TEXT        NOT NULL,
  kind             TEXT        NOT NULL,
  step             TEXT        NOT NULL,
  state            JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'waiting_approval', 'waiting_permission', 'done', 'failed', 'cancelled')),
  run_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  step_attempts    INTEGER     NOT NULL DEFAULT 0,
  lock_until       TIMESTAMPTZ,
  last_error       TEXT,
  repairs          JSONB       NOT NULL DEFAULT '[]',   -- [{ at, step, problem, fix }]
  result           JSONB,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_due ON agent_jobs (status, run_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user ON agent_jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_events (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  agent            TEXT,
  job_id           UUID        REFERENCES agent_jobs(id) ON DELETE SET NULL,
  kind             TEXT        NOT NULL CHECK (kind IN ('done', 'repaired', 'needs_approval', 'needs_permission', 'failed', 'info')),
  title            TEXT        NOT NULL,
  body             TEXT,
  details          JSONB       NOT NULL DEFAULT '{}',
  action           JSONB,                               -- { type: 'approve'|'reconnect'|'connect'|'open', … }
  read_at          TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  emailed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION touch_autopilot_tables()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_connections_touch ON connections;
CREATE TRIGGER trg_connections_touch BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION touch_autopilot_tables();
DROP TRIGGER IF EXISTS trg_autopilots_touch ON autopilots;
CREATE TRIGGER trg_autopilots_touch BEFORE UPDATE ON autopilots FOR EACH ROW EXECUTE FUNCTION touch_autopilot_tables();
DROP TRIGGER IF EXISTS trg_agent_jobs_touch ON agent_jobs;
CREATE TRIGGER trg_agent_jobs_touch BEFORE UPDATE ON agent_jobs FOR EACH ROW EXECUTE FUNCTION touch_autopilot_tables();

-- Row-level security on, with no policies: only the API (service role) reads
-- or writes these. A browser must never see connections.secret_enc.
ALTER TABLE connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopilots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

-- Published articles: where they went, so they can be tracked.
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;
ALTER TABLE seo_articles DROP CONSTRAINT IF EXISTS seo_articles_status_check;
ALTER TABLE seo_articles ADD CONSTRAINT seo_articles_status_check CHECK (status IN ('draft', 'downloaded', 'published_elsewhere', 'published'));
