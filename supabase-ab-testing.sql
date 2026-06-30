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

-- Service role bypasses RLS — needed for the MCP server (server-side)
-- Authenticated users see only their own experiments
CREATE POLICY "Users see own experiments"
  ON experiments FOR ALL
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users see own variants"
  ON variants FOR ALL
  USING (experiment_id IN (SELECT id FROM experiments WHERE auth.uid() = user_id OR user_id IS NULL));

CREATE POLICY "Users see own goals"
  ON goals FOR ALL
  USING (experiment_id IN (SELECT id FROM experiments WHERE auth.uid() = user_id OR user_id IS NULL));

-- Tracking is write-only from the browser via anon key
CREATE POLICY "Anyone can write visitors"
  ON visitors FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Anyone can write conversions"
  ON conversions FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Service can read visitors"
  ON visitors FOR SELECT
  USING (TRUE);

CREATE POLICY "Service can read conversions"
  ON conversions FOR SELECT
  USING (TRUE);

-- ── Updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER experiments_updated_at
  BEFORE UPDATE ON experiments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
