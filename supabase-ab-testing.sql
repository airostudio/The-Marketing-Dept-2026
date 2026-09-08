-- Aduma A/B Testing Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Or via: supabase db push

-- ── Experiments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name              TEXT        NOT NULL,
  description       TEXT        DEFAULT '',
  status            TEXT        DEFAULT 'draft'
                                CHECK (status IN ('draft','active','paused','finished')),
  type              TEXT        DEFAULT 'ab'
                                CHECK (type IN ('ab','multivariate','split-url')),
  primary_goal_id   UUID,
  winner_variant_id UUID,
  start_date        TIMESTAMPTZ,
  end_date          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  user_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── Variants ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS variants (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id       UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  description         TEXT        DEFAULT '',
  is_control          BOOLEAN     DEFAULT FALSE,
  traffic_allocation  DECIMAL(5,2) DEFAULT 50.00,
  redirect_url        TEXT,
  changes             JSONB       DEFAULT '[]',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Goals ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  type          TEXT        DEFAULT 'click'
                            CHECK (type IN ('click','pageview','custom','revenue')),
  selector      TEXT,
  url_pattern   TEXT,
  is_primary    BOOLEAN     DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Visitors (unique per experiment) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitors (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id    UUID        NOT NULL REFERENCES variants(id)    ON DELETE CASCADE,
  visitor_id    TEXT        NOT NULL,
  first_seen    TIMESTAMPTZ DEFAULT NOW(),
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (experiment_id, visitor_id)
);

-- ── Conversions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversions (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id    UUID        NOT NULL REFERENCES variants(id)    ON DELETE CASCADE,
  goal_id       UUID        NOT NULL REFERENCES goals(id)       ON DELETE CASCADE,
  visitor_id    TEXT        NOT NULL,
  revenue       DECIMAL(10,2),
  metadata      JSONB       DEFAULT '{}',
  converted_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_variants_experiment   ON variants    (experiment_id);
CREATE INDEX IF NOT EXISTS idx_goals_experiment      ON goals       (experiment_id);
CREATE INDEX IF NOT EXISTS idx_visitors_experiment   ON visitors    (experiment_id);
CREATE INDEX IF NOT EXISTS idx_visitors_id           ON visitors    (visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversions_exp       ON conversions (experiment_id);
CREATE INDEX IF NOT EXISTS idx_conversions_variant   ON conversions (variant_id);
CREATE INDEX IF NOT EXISTS idx_conversions_visitor   ON conversions (visitor_id);

-- ── Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — that is how api/ab-track.js writes tracking
-- rows and how the MCP server reads them. Nothing here needs to be reachable
-- with the anon key, which is published in every browser that loads the app.
--
-- ── What these policies replaced, and why ─────────────────────────────────
--
-- The first version of this file carried four policies that evaluated to
-- TRUE for every role, including `anon`:
--
--   "Anyone can write visitors"    ON visitors    FOR INSERT WITH CHECK (TRUE)
--   "Anyone can write conversions" ON conversions FOR INSERT WITH CHECK (TRUE)
--   "Service can read visitors"    ON visitors    FOR SELECT USING (TRUE)
--   "Service can read conversions" ON conversions FOR SELECT USING (TRUE)
--
-- The names say "service", but a policy with no role list applies to every
-- role. Since the anon key ships to the browser, those two SELECT policies
-- made every visitor and conversion row in the database — experiment_id,
-- variant_id, visitor_id, revenue, metadata, across every customer —
-- readable by anyone who opened the app and copied the key out of it. The
-- two INSERT policies let the same stranger fabricate visits and conversions
-- against any experiment id, which is the cheapest possible way to flip
-- which variant a customer declares the winner of.
--
-- Neither INSERT policy was ever needed: the tracking snippet POSTs to
-- api/ab-track.js, which holds SUPABASE_SERVICE_ROLE_KEY and bypasses RLS.
--
-- The ownership policies also carried `OR user_id IS NULL`. experiments.user_id
-- is ON DELETE SET NULL, so deleting a user turned their experiments into
-- rows every other tenant could read AND write — and because a FOR ALL policy
-- with no WITH CHECK reuses its USING expression as the write check, any
-- signed-in user could also create an experiment with user_id NULL and share
-- it with the whole database. Both halves are gone.
--
-- Existing rows with user_id IS NULL become invisible to end users after this
-- migration. That is the intended direction: they are currently visible to
-- *everyone*, and they remain reachable with the service-role key for
-- reassignment.

DROP POLICY IF EXISTS "Users see own experiments"   ON experiments;
DROP POLICY IF EXISTS "Users see own variants"      ON variants;
DROP POLICY IF EXISTS "Users see own goals"         ON goals;
DROP POLICY IF EXISTS "Anyone can write visitors"   ON visitors;
DROP POLICY IF EXISTS "Anyone can write conversions" ON conversions;
DROP POLICY IF EXISTS "Service can read visitors"   ON visitors;
DROP POLICY IF EXISTS "Service can read conversions" ON conversions;
DROP POLICY IF EXISTS "Owners read own visitors"    ON visitors;
DROP POLICY IF EXISTS "Owners read own conversions" ON conversions;

CREATE POLICY "Users see own experiments"
  ON experiments FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own variants" ON variants;
CREATE POLICY "Users see own variants"
  ON variants FOR ALL
  USING      (experiment_id IN (SELECT id FROM experiments WHERE user_id = auth.uid()))
  WITH CHECK (experiment_id IN (SELECT id FROM experiments WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users see own goals" ON goals;
CREATE POLICY "Users see own goals"
  ON goals FOR ALL
  USING      (experiment_id IN (SELECT id FROM experiments WHERE user_id = auth.uid()))
  WITH CHECK (experiment_id IN (SELECT id FROM experiments WHERE user_id = auth.uid()));

-- Results belong to whoever owns the experiment. web/js/experiments-store.js
-- reads these two tables straight from the browser (getResults()), always
-- filtered by experiment_id, so scoping by owner keeps that working and
-- stops it returning anybody else's rows.
DROP POLICY IF EXISTS "Owners read own visitors" ON visitors;
CREATE POLICY "Owners read own visitors"
  ON visitors FOR SELECT
  USING (experiment_id IN (SELECT id FROM experiments WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Owners read own conversions" ON conversions;
CREATE POLICY "Owners read own conversions"
  ON conversions FOR SELECT
  USING (experiment_id IN (SELECT id FROM experiments WHERE user_id = auth.uid()));

-- No INSERT/UPDATE/DELETE policy on visitors or conversions at all. Tracking
-- rows are written only by api/ab-track.js with the service-role key; with
-- RLS enabled and no permissive policy, every other role is refused.

-- ── One conversion per visitor per goal ───────────────────────────────────
-- A real visitor completing a goal is one event. Without this, a single
-- fabricated visitor_id can be replayed against the conversions endpoint
-- until a variant "wins" — the constraint makes repeat submissions collide
-- in the database rather than accumulate as results.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversions_visitor_goal
  ON conversions (experiment_id, visitor_id, goal_id);

-- ── Updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS experiments_updated_at ON experiments;
CREATE TRIGGER experiments_updated_at
  BEFORE UPDATE ON experiments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
