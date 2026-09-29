-- Audema Sales Intelligence — daily geographic sweep for Blade's repeatable
-- mail-merge audit workflow.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- api/cron-sales-intel-sweep.js runs once a day, walking US states
-- alphabetically (and, within a state, towns returned by the Places API),
-- auditing 100-150 businesses' websites, and filing anyone who looks like a
-- real opportunity (no website, or locked into GoDaddy/Wix/Squarespace, or
-- otherwise outdated) here as a draft lead. Nothing here ever sends an
-- email — see sales_intel_leads.sent below. A human reviews and sends via
-- Pat/Blade; this is discovery and drafting only.
--
-- This is a shared company-wide prospecting list, not per-customer data —
-- there is no user_id to scope it to, so access is restricted to admins,
-- the same way api/admin-activity.js's audit log is.

-- ── Cursor: where the sweep left off, so tomorrow continues today's place ──
-- A single row (id always 1) — there is one sweep, not one per user.
CREATE TABLE IF NOT EXISTS sales_intel_sweep_cursor (
  id                INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state_index       INTEGER     NOT NULL DEFAULT 0,   -- into api/_lib/us-states.js US_STATES, alphabetical
  sector_index      INTEGER     NOT NULL DEFAULT 0,   -- into the sector rotation in api/cron-sales-intel-sweep.js
  next_page_token   TEXT,                             -- Places API Text Search pagination within the current state+sector
  leads_found_today INTEGER     NOT NULL DEFAULT 0,
  candidates_today  INTEGER     NOT NULL DEFAULT 0,
  last_run_at       TIMESTAMPTZ,
  last_run_date     DATE,
  total_leads_found INTEGER     NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO sales_intel_sweep_cursor (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Dedupe: every place the sweep has already looked at ────────────────────
-- Prevents re-fetching and re-scoring the same business day after day,
-- including ones that turned out to be a genuinely modern site (not a lead)
-- — those still shouldn't be checked again tomorrow.
CREATE TABLE IF NOT EXISTS sales_intel_seen_places (
  place_id     TEXT        PRIMARY KEY,
  checked_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leads: qualifying opportunities, ready for a human to review and send ──
CREATE TABLE IF NOT EXISTS sales_intel_leads (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  place_id          TEXT        UNIQUE,
  business_name     TEXT        NOT NULL,
  sector             TEXT,
  state             TEXT,
  suburb            TEXT,
  email             TEXT,
  website           TEXT,
  website_status    TEXT        CHECK (website_status IN ('no_website', 'outdated', 'unreachable', 'modern')),
  site_platform     TEXT,        -- 'godaddy' | 'wix' | 'squarespace' | null
  owner_first_name  TEXT,
  owner_source      TEXT,
  personal_note     TEXT,
  opportunity_rank  INTEGER,
  sent              BOOLEAN     NOT NULL DEFAULT false,
  replied           BOOLEAN     NOT NULL DEFAULT false,
  discovered_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_intel_leads_discovered ON sales_intel_leads (discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_intel_leads_sent       ON sales_intel_leads (sent);

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE sales_intel_sweep_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_intel_seen_places  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_intel_leads        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_intel_cursor_admin_read" ON sales_intel_sweep_cursor;
CREATE POLICY "sales_intel_cursor_admin_read" ON sales_intel_sweep_cursor
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
  );

DROP POLICY IF EXISTS "sales_intel_leads_admin_all" ON sales_intel_leads;
CREATE POLICY "sales_intel_leads_admin_all" ON sales_intel_leads
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'super_admin'))
  );

-- sales_intel_seen_places carries no client-facing policy at all — it's an
-- internal dedupe ledger the cron reads/writes on the service-role key
-- (which bypasses RLS) and nobody else has any reason to query.

-- Writes to all three tables happen only via the service-role key
-- (api/cron-sales-intel-sweep.js). The admin-facing read/update policies
-- above are for api/sales-intel-leads.js, so a human can review, mark a
-- lead handled, or export it — never so a client can insert a lead itself.
