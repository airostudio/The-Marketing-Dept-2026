-- Audema Load Testing Agent — a permanent, k6/Locust-inspired job-processing
-- simulator for the team's own generation pipelines. Run this in:
-- Supabase Dashboard → SQL Editor → New query → Run
--
-- ── What this is NOT ─────────────────────────────────────────────────────
-- This feature NEVER calls a real AI provider and NEVER spends real money.
-- Every "job" here is a simulated generation request; every duration and
-- every dollar figure is computed from formulas and constants in
-- api/cron-loadtest-tick.js, never from a real Claude/OpenAI/Gemini call.
-- See the header of that file for the full explanation.
--
-- Not tenant-scoped, same shape as agent_audit_runs/agent_audit_findings —
-- this is platform-internal tooling data, not any client's business data.
-- Access to the pages that read this data is already gated by the internal
-- tools password (api/_lib/internal-tools-access-token.js), so read access
-- for any signed-in user is fine; only the cron tick (service-role key)
-- ever writes.

-- load_test_runs — one row per configured test.
CREATE TABLE IF NOT EXISTS load_test_runs (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_by            UUID        NOT NULL, -- auth.users.id of whoever started the run
  status                TEXT        NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
  config                JSONB       NOT NULL, -- validated shape — see api/loadtest-create.js CONFIG LIMITS
  started_at            TIMESTAMPTZ,
  ends_at               TIMESTAMPTZ,
  last_tick_at          TIMESTAMPTZ,

  -- Running counters, maintained incrementally by the tick (never
  -- recomputed with a full COUNT(*) once the jobs table has real volume —
  -- see api/cron-loadtest-tick.js).
  jobs_requested_total  BIGINT      NOT NULL DEFAULT 0,
  jobs_succeeded_total  BIGINT      NOT NULL DEFAULT 0,
  jobs_failed_total     BIGINT      NOT NULL DEFAULT 0,
  errors_by_category    JSONB       NOT NULL DEFAULT '{}', -- {claude_error: n, image_api_error: n, deployment_error: n, database_error: n}
  total_cost_usd        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ENTIRELY SYNTHETIC — see file header
  peak_concurrent_vus   INTEGER     NOT NULL DEFAULT 0,
  peak_concurrent_builds INTEGER    NOT NULL DEFAULT 0,
  peak_queue_depth      INTEGER     NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- load_test_jobs — one row per simulated "job" (a generation request).
-- Working state only — bounded by retention pruning in the tick, see
-- JOB_RETENTION_MS in api/cron-loadtest-tick.js. Snapshots are the durable
-- long-term record of a run, not this table.
CREATE TABLE IF NOT EXISTS load_test_jobs (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id                UUID        NOT NULL REFERENCES load_test_runs(id) ON DELETE CASCADE,
  persona               TEXT        NOT NULL
                                     CHECK (persona IN ('websiteBuilders', 'siteVisitors', 'existingEditors',
                                                         'ecommerce', 'heavyUsers', 'failureSimulations')),
  status                TEXT        NOT NULL DEFAULT 'queued'
                                     CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  queued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  expected_finish_at    TIMESTAMPTZ, -- pre-computed at promotion time — this is a discrete-event sim, not a real timer
  finished_at           TIMESTAMPTZ,
  duration_ms           INTEGER,
  failure_category      TEXT        CHECK (failure_category IN (NULL, 'claude_error', 'image_api_error', 'deployment_error', 'database_error')),
  simulated_cost_usd    NUMERIC(6,4), -- ENTIRELY SYNTHETIC — costPerGenerationUsd from the run's config, not a real API cost
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_load_test_jobs_run       ON load_test_jobs (run_id);
CREATE INDEX IF NOT EXISTS idx_load_test_jobs_status    ON load_test_jobs (run_id, status);
CREATE INDEX IF NOT EXISTS idx_load_test_jobs_run_queued ON load_test_jobs (run_id, queued_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_load_test_jobs_run_finish ON load_test_jobs (run_id, expected_finish_at) WHERE status = 'running';

-- load_test_snapshots — periodic rollup rows for charting without
-- re-aggregating every job on every dashboard read. This is the durable
-- record of a run's history; jobs are pruned, snapshots are not.
CREATE TABLE IF NOT EXISTS load_test_snapshots (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id                UUID        NOT NULL REFERENCES load_test_runs(id) ON DELETE CASCADE,
  snapshot_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concurrent_vus        INTEGER     NOT NULL DEFAULT 0,
  concurrent_builds     INTEGER     NOT NULL DEFAULT 0,
  queue_depth           INTEGER     NOT NULL DEFAULT 0,
  jobs_requested_total  BIGINT      NOT NULL DEFAULT 0,
  jobs_succeeded_total  BIGINT      NOT NULL DEFAULT 0,
  jobs_failed_total     BIGINT      NOT NULL DEFAULT 0,
  p50_ms                INTEGER,
  p95_ms                INTEGER,
  p99_ms                INTEGER,
  errors_by_category    JSONB       NOT NULL DEFAULT '{}',
  total_cost_usd        NUMERIC(12,2) NOT NULL DEFAULT 0, -- ENTIRELY SYNTHETIC
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_load_test_snapshots_run     ON load_test_snapshots (run_id, snapshot_at DESC);

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Read-only for any signed-in user (page access is already gated by the
-- internal-tools password); writes only via the service-role key the cron
-- tick and the create/control endpoints use, which bypasses RLS entirely.
ALTER TABLE load_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_test_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_test_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "load_test_runs_read" ON load_test_runs;
CREATE POLICY "load_test_runs_read" ON load_test_runs
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "load_test_jobs_read" ON load_test_jobs;
CREATE POLICY "load_test_jobs_read" ON load_test_jobs
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "load_test_snapshots_read" ON load_test_snapshots;
CREATE POLICY "load_test_snapshots_read" ON load_test_snapshots
  FOR SELECT USING (auth.role() = 'authenticated');
