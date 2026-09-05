-- Audema Government Funding Room — non-dilutive funding pipeline + scorecards.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: database/admin-setup.sql already run (profiles.role).
--
-- This is Audema's OWN funding pipeline, not customer data — it tracks which
-- government programs Audema is pursuing, what each was scored, and what has
-- been won. It is therefore admin-only at the RLS level: an ordinary
-- customer account must never be able to read the company's funding position.

-- ── Opportunities ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grant_opportunities (
  id                  UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_by          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  name                TEXT        NOT NULL,
  funder              TEXT,                    -- e.g. 'AusIndustry', 'Vic Gov DJSIR', 'City of Melbourne'
  program             TEXT,                    -- the specific program/round
  -- Which level of government / instrument this is. Mirrors the coverage the
  -- funding specialist is engaged across.
  level               TEXT        NOT NULL DEFAULT 'federal'
                                  CHECK (level IN ('federal','state_vic','local','rd_tax_incentive',
                                                   'emdg','commercialisation','research_partnership',
                                                   'university','tender','international','other')),

  amount_min          NUMERIC(12,2),
  amount_max          NUMERIC(12,2),
  matching_required   NUMERIC(12,2),           -- cash/in-kind we must contribute
  currency            TEXT        NOT NULL DEFAULT 'AUD',

  opens_at            DATE,
  closes_at           DATE,

  -- The 11 pipeline stages, plus a terminal state. Real pipelines need
  -- somewhere for dead opportunities to go: without it, no-go decisions and
  -- unsuccessful applications sit in the funnel forever, inflating both the
  -- workload and the forecast.
  stage               TEXT        NOT NULL DEFAULT 'discovered'
                                  CHECK (stage IN ('discovered','eligibility_check','strategic_fit',
                                                   'partners_required','go_no_go','application',
                                                   'assessment','funded','milestones','acquittal',
                                                   'next_round','not_proceeding')),

  -- Scorecard: { eligibility: 8, alignment: 9, ... } scored 0-10 per criterion.
  -- Stored as JSONB rather than 9 columns so the model can gain a criterion
  -- without a migration; web/js/grant-scorecard.js is the source of truth for
  -- the weights and bands.
  scorecard           JSONB       NOT NULL DEFAULT '{}',
  score_total         INTEGER,                 -- cached result of the weighted calculation
  score_band          TEXT        CHECK (score_band IN ('apply','strategic','partner','decline')),

  go_no_go_notes      TEXT,                    -- why we decided what we decided
  partners            TEXT,                    -- research/council/industry partners required or secured
  owner_name          TEXT,                    -- who internally owns this one
  notes               TEXT,
  source_url          TEXT,

  -- Outcome, once known.
  amount_awarded      NUMERIC(12,2),
  decision_at         DATE,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grant_opps_stage  ON grant_opportunities (stage);
CREATE INDEX IF NOT EXISTS idx_grant_opps_closes ON grant_opportunities (closes_at);
CREATE INDEX IF NOT EXISTS idx_grant_opps_level  ON grant_opportunities (level);

-- ── updated_at ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_grant_opportunity()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_grant_opp_touch ON grant_opportunities;
CREATE TRIGGER trg_grant_opp_touch
  BEFORE UPDATE ON grant_opportunities
  FOR EACH ROW EXECUTE FUNCTION touch_grant_opportunity();

-- ── Row-Level Security: admins only ────────────────────────────────────────
-- Deliberately NOT "the user who created it" — this is company-level
-- financial information, and every admin needs the same complete view of it.
ALTER TABLE grant_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "grant_opps_admin_all" ON grant_opportunities;
CREATE POLICY "grant_opps_admin_all" ON grant_opportunities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  );

-- DONE! The Government Funding Room now has somewhere to keep its pipeline.
