-- Audema Blade Area Sweeps — search every town in a county, state or country
-- for local businesses, in the background, and (for Webese) write the
-- results into the state's Outreach Tracker sheet.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql.
--
-- Blade searched one city at a time from a browser tab. A sweep is a queue of
-- (town × trade) searches worked through a batch at a time by
-- api/cron-blade-sweeps.js (or "run a batch now"), so it carries on with the
-- page closed and stops at the search budget the person set — every search
-- is a paid Google Places call.
--
-- Writes go through the API with the service role; owners can read their own.

CREATE TABLE IF NOT EXISTS blade_sweeps (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  name             TEXT        NOT NULL DEFAULT '',
  -- What was picked: { level: 'country'|'state'|'county'|'towns', countryCode, countryName,
  --   adminCode1, stateName, adminCode2, countyName, towns? }
  root             JSONB       NOT NULL DEFAULT '{}',
  -- States still to be expanded into towns (country-wide sweeps only).
  frontier         JSONB       NOT NULL DEFAULT '[]',
  sectors          TEXT[]      NOT NULL DEFAULT '{}',
  min_population   INTEGER     NOT NULL DEFAULT 0,
  pages_per_town   INTEGER     NOT NULL DEFAULT 1 CHECK (pages_per_town BETWEEN 1 AND 3),

  max_searches     INTEGER     NOT NULL CHECK (max_searches > 0),
  searches_used    INTEGER     NOT NULL DEFAULT 0,

  status           TEXT        NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'paused', 'done', 'cancelled', 'failed')),
  status_note      TEXT,

  -- Webese only: write qualified businesses into "Webese <State> Outreach Tracker".
  write_to_tracker BOOLEAN     NOT NULL DEFAULT FALSE,
  trackers         JSONB       NOT NULL DEFAULT '{}',   -- { "<State>": { fileId, name, url } }

  totals           JSONB       NOT NULL DEFAULT '{}',   -- searched, discovered, audited, qualified, written, duplicates
  lock_until       TIMESTAMPTZ,                         -- one batch at a time
  last_tick_at     TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blade_sweeps_user   ON blade_sweeps (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blade_sweeps_status ON blade_sweeps (status) WHERE status = 'running';

-- One row per (town × trade): the unit of work.
CREATE TABLE IF NOT EXISTS blade_sweep_tasks (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  sweep_id         UUID        NOT NULL REFERENCES blade_sweeps(id) ON DELETE CASCADE,
  seq              INTEGER     NOT NULL,
  state_name       TEXT,
  state_code       TEXT,
  county_name      TEXT,
  county_code      TEXT,
  place_name       TEXT        NOT NULL,
  place_geoname_id BIGINT,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  population       INTEGER,
  sector           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  searches         INTEGER     NOT NULL DEFAULT 0,
  discovered       INTEGER     NOT NULL DEFAULT 0,
  qualified        INTEGER     NOT NULL DEFAULT 0,
  written          INTEGER     NOT NULL DEFAULT 0,
  attempts         INTEGER     NOT NULL DEFAULT 0,
  error            TEXT,
  done_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blade_sweep_tasks_next ON blade_sweep_tasks (sweep_id, status, seq);

-- Every business found, once per account (a business is never written twice).
CREATE TABLE IF NOT EXISTS blade_sweep_leads (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  sweep_id         UUID        NOT NULL REFERENCES blade_sweeps(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id         TEXT        NOT NULL,
  business_name    TEXT        NOT NULL,
  sector           TEXT,
  state_name       TEXT,
  county_name      TEXT,
  place_name       TEXT,
  address          TEXT,
  phone            TEXT,                -- kept in Audema; never written to a Webese tracker
  website          TEXT,
  maps_url         TEXT,
  review_count     INTEGER,
  site_status      TEXT,                -- no_website | outdated | modern | unreachable | check_failed
  site_platform    TEXT,
  qualified        BOOLEAN     NOT NULL DEFAULT FALSE,
  offer_type       TEXT,
  opportunity_score INTEGER,
  observation      TEXT,
  tracker_status   TEXT,                -- written | duplicate | null (not sent)
  discovered_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_blade_sweep_leads_sweep ON blade_sweep_leads (sweep_id, discovered_at DESC);

CREATE OR REPLACE FUNCTION touch_blade_sweeps()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blade_sweeps_touch ON blade_sweeps;
CREATE TRIGGER trg_blade_sweeps_touch
  BEFORE UPDATE ON blade_sweeps
  FOR EACH ROW EXECUTE FUNCTION touch_blade_sweeps();

ALTER TABLE blade_sweeps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE blade_sweep_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE blade_sweep_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blade_sweeps_owner_read" ON blade_sweeps;
CREATE POLICY "blade_sweeps_owner_read" ON blade_sweeps
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "blade_sweep_tasks_owner_read" ON blade_sweep_tasks;
CREATE POLICY "blade_sweep_tasks_owner_read" ON blade_sweep_tasks
  FOR SELECT USING (EXISTS (SELECT 1 FROM blade_sweeps s WHERE s.id = blade_sweep_tasks.sweep_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "blade_sweep_leads_owner_read" ON blade_sweep_leads;
CREATE POLICY "blade_sweep_leads_owner_read" ON blade_sweep_leads
  FOR SELECT USING (auth.uid() = user_id);
