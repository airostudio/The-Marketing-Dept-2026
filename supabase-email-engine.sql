-- Audema Email Engine — split tests, automation flows, revenue attribution.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-audience.sql (contacts, campaign_sends) and
--           supabase-email-events.sql (email_events) already run.
--
-- These are the three things the Email Marketing dashboard used to show with
-- invented numbers — A/B results, automation flows and per-campaign revenue —
-- and then, after that markup was removed, showed as "not set up" because
-- nothing behind them existed. This is what makes them real.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A/B SPLIT TESTS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_ab_tests (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id  TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  -- What is being varied. Kept explicit rather than inferred from the variant
  -- rows, because "we tested the subject line" is the question a result has to
  -- answer and it should not depend on diffing two blobs of HTML.
  dimension    TEXT        NOT NULL DEFAULT 'subject',
  -- The measure the winner is decided on. Declared BEFORE the send, so a test
  -- cannot be re-read after the fact against whichever metric happened to win.
  goal         TEXT        NOT NULL DEFAULT 'open',
  status       TEXT        NOT NULL DEFAULT 'running',
  winner_variant_id UUID,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT ab_dimension_valid CHECK (dimension IN ('subject','content','from_name','send_time')),
  CONSTRAINT ab_goal_valid      CHECK (goal IN ('open','click')),
  CONSTRAINT ab_status_valid    CHECK (status IN ('running','decided','cancelled'))
);

CREATE TABLE IF NOT EXISTS email_ab_variants (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  test_id      UUID        NOT NULL REFERENCES email_ab_tests(id) ON DELETE CASCADE,
  -- 'A', 'B', 'C' — the label a person uses when talking about the result.
  label        TEXT        NOT NULL,
  subject      TEXT,
  html         TEXT,
  from_name    TEXT,
  -- Share of recipients, 0-100. They must total 100; enforced below.
  split_pct    INTEGER     NOT NULL DEFAULT 50,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT ab_split_range CHECK (split_pct > 0 AND split_pct <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_variant_label ON email_ab_variants (test_id, label);
CREATE INDEX IF NOT EXISTS idx_ab_tests_campaign ON email_ab_tests (campaign_id);

-- A split that does not total 100 silently drops or double-assigns recipients,
-- and the resulting rates would be computed against the wrong denominators.
CREATE OR REPLACE FUNCTION check_ab_split_totals()
RETURNS TRIGGER AS $$
DECLARE
  total INTEGER;
  tid UUID;
BEGIN
  tid := COALESCE(NEW.test_id, OLD.test_id);
  SELECT SUM(split_pct) INTO total FROM email_ab_variants WHERE test_id = tid;
  -- Allow the intermediate states while variants are being inserted one at a
  -- time; only a total ABOVE 100 is unambiguously wrong at every step.
  IF total > 100 THEN
    RAISE EXCEPTION 'Variant splits for test % total %%%, which is over 100%%', tid, total;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ab_split_totals ON email_ab_variants;
CREATE TRIGGER trg_ab_split_totals
  AFTER INSERT OR UPDATE ON email_ab_variants
  FOR EACH ROW EXECUTE FUNCTION check_ab_split_totals();

-- Which variant each recipient actually received. Recorded at send time rather
-- than recomputed later: the assignment must be the one that was really used,
-- not one re-derived from a hash whose inputs may since have changed.
CREATE TABLE IF NOT EXISTS email_ab_assignments (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  test_id      UUID        NOT NULL REFERENCES email_ab_tests(id) ON DELETE CASCADE,
  variant_id   UUID        NOT NULL REFERENCES email_ab_variants(id) ON DELETE CASCADE,
  contact_id   UUID,
  email        TEXT        NOT NULL,
  email_id     TEXT,       -- Resend's id, so events join back to the variant
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ab_assignment ON email_ab_assignments (test_id, email);
CREATE INDEX IF NOT EXISTS idx_ab_assignment_email_id ON email_ab_assignments (email_id);

-- ── Results ────────────────────────────────────────────────────────────────
-- Joined from real events. A variant with no sends returns zeros and null
-- rates rather than being omitted, so a broken split is visible rather than
-- looking like a test with fewer arms than it has.
CREATE OR REPLACE FUNCTION ab_test_results(tid UUID, uid UUID)
RETURNS TABLE (
  variant_id UUID, label TEXT, subject TEXT, split_pct INTEGER,
  assigned BIGINT, delivered BIGINT, unique_opened BIGINT, unique_clicked BIGINT
) AS $$
  SELECT
    v.id, v.label, v.subject, v.split_pct,
    COUNT(DISTINCT a.id),
    COUNT(DISTINCT e.email_id) FILTER (WHERE e.event_type = 'delivered'),
    COUNT(DISTINCT e.email_id) FILTER (WHERE e.event_type = 'opened'),
    COUNT(DISTINCT e.email_id) FILTER (WHERE e.event_type = 'clicked')
  FROM email_ab_variants v
  JOIN email_ab_tests t ON t.id = v.test_id
  LEFT JOIN email_ab_assignments a ON a.variant_id = v.id
  LEFT JOIN email_events e ON e.email_id = a.email_id
  WHERE v.test_id = tid AND (uid IS NULL OR t.user_id = uid)
  GROUP BY v.id, v.label, v.subject, v.split_pct
  ORDER BY v.label;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. AUTOMATION FLOWS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_flows (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  trigger_type TEXT        NOT NULL DEFAULT 'manual',
  -- For trigger_type 'segment_entry': which segment.
  segment_id   UUID,
  status       TEXT        NOT NULL DEFAULT 'draft',
  from_name    TEXT,
  from_email   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT flow_trigger_valid CHECK (trigger_type IN ('manual','contact_created','segment_entry')),
  CONSTRAINT flow_status_valid  CHECK (status IN ('draft','active','paused')),
  CONSTRAINT flow_name_nonempty CHECK (length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS email_flow_steps (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  flow_id      UUID        NOT NULL REFERENCES email_flows(id) ON DELETE CASCADE,
  step_order   INTEGER     NOT NULL,
  -- Hours to wait AFTER the previous step before this one sends. The first
  -- step's delay is measured from enrolment.
  delay_hours  INTEGER     NOT NULL DEFAULT 0,
  subject      TEXT        NOT NULL,
  html         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT flow_step_delay_nonneg CHECK (delay_hours >= 0),
  CONSTRAINT flow_step_subject_nonempty CHECK (length(btrim(subject)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_flow_step_order ON email_flow_steps (flow_id, step_order);

CREATE TABLE IF NOT EXISTS email_flow_enrolments (
  id             UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  flow_id        UUID        NOT NULL REFERENCES email_flows(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id     UUID,
  email          TEXT        NOT NULL,
  -- The step that will be sent NEXT, not the one last sent: the cron asks
  -- "what is due", and storing the answer directly keeps that a lookup rather
  -- than an inference.
  next_step_order INTEGER    NOT NULL DEFAULT 1,
  next_run_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT        NOT NULL DEFAULT 'active',
  -- Why it stopped, for a flow that ended early.
  exit_reason    TEXT,
  enrolled_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,

  CONSTRAINT enrolment_status_valid CHECK (status IN ('active','completed','exited','failed'))
);

-- One live enrolment per contact per flow: re-enrolling someone who is already
-- mid-sequence would send them the same series twice, overlapping.
CREATE UNIQUE INDEX IF NOT EXISTS uq_flow_enrolment_active
  ON email_flow_enrolments (flow_id, email) WHERE status = 'active';

-- The cron's only query: what is due now.
CREATE INDEX IF NOT EXISTS idx_flow_enrolments_due
  ON email_flow_enrolments (next_run_at) WHERE status = 'active';

CREATE OR REPLACE FUNCTION touch_email_flow()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_flow_touch ON email_flows;
CREATE TRIGGER trg_email_flow_touch
  BEFORE UPDATE ON email_flows
  FOR EACH ROW EXECUTE FUNCTION touch_email_flow();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. REVENUE ATTRIBUTION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Per-campaign revenue was left blank because nothing linked an order back to
-- a send. It cannot be inferred from email data alone — the order happens on
-- the customer's own site — so this records orders reported to us and the
-- attribution rule used, rather than producing a number with no provenance.

CREATE TABLE IF NOT EXISTS email_conversions (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The campaign credited, and how it was decided.
  campaign_id   TEXT,
  contact_id    UUID,
  email         TEXT,
  -- 'click' — the recipient clicked this campaign within the window;
  -- 'open'  — they opened it and no click exists;
  -- 'direct'— the caller named the campaign itself;
  -- 'none'  — reported, but nothing links it to any campaign. Kept, so total
  --           revenue is not quietly inflated into whichever campaign was
  --           nearest.
  attribution   TEXT        NOT NULL DEFAULT 'none',
  amount_cents  BIGINT      NOT NULL,
  currency      TEXT        NOT NULL DEFAULT 'AUD',
  -- The caller's own order id, so a retried webhook cannot double-count.
  external_id   TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT conversion_attribution_valid CHECK (attribution IN ('click','open','direct','none')),
  CONSTRAINT conversion_amount_nonneg CHECK (amount_cents >= 0),
  CONSTRAINT conversion_currency_len CHECK (length(currency) = 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversion_external
  ON email_conversions (user_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversions_campaign ON email_conversions (campaign_id);

CREATE OR REPLACE FUNCTION campaign_revenue(cid TEXT, uid UUID)
RETURNS TABLE (conversions BIGINT, revenue_cents BIGINT, currency TEXT) AS $$
  SELECT COUNT(*), COALESCE(SUM(amount_cents), 0), MIN(currency)
  FROM email_conversions
  WHERE campaign_id = cid AND (uid IS NULL OR user_id = uid)
    AND attribution <> 'none';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE email_ab_tests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_ab_variants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_ab_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_flows           ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_flow_steps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_flow_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_conversions     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ab_tests_owner_all" ON email_ab_tests;
CREATE POLICY "ab_tests_owner_all" ON email_ab_tests
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ab_variants_owner_all" ON email_ab_variants;
CREATE POLICY "ab_variants_owner_all" ON email_ab_variants
  FOR ALL USING (EXISTS (SELECT 1 FROM email_ab_tests t WHERE t.id = test_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM email_ab_tests t WHERE t.id = test_id AND t.user_id = auth.uid()));

-- Read-only to the owner: an assignment a client could rewrite is not a record
-- of which variant was sent.
DROP POLICY IF EXISTS "ab_assignments_owner_read" ON email_ab_assignments;
CREATE POLICY "ab_assignments_owner_read" ON email_ab_assignments
  FOR SELECT USING (EXISTS (SELECT 1 FROM email_ab_tests t WHERE t.id = test_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "flows_owner_all" ON email_flows;
CREATE POLICY "flows_owner_all" ON email_flows
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "flow_steps_owner_all" ON email_flow_steps;
CREATE POLICY "flow_steps_owner_all" ON email_flow_steps
  FOR ALL USING (EXISTS (SELECT 1 FROM email_flows f WHERE f.id = flow_id AND f.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM email_flows f WHERE f.id = flow_id AND f.user_id = auth.uid()));

DROP POLICY IF EXISTS "flow_enrolments_owner_read" ON email_flow_enrolments;
CREATE POLICY "flow_enrolments_owner_read" ON email_flow_enrolments
  FOR SELECT USING (auth.uid() = user_id);

-- Conversions are written only by api/track-conversion.js with the service
-- key: revenue a client could insert from the browser is not revenue.
DROP POLICY IF EXISTS "conversions_owner_read" ON email_conversions;
CREATE POLICY "conversions_owner_read" ON email_conversions
  FOR SELECT USING (auth.uid() = user_id);

-- DONE! Split tests, automation flows and revenue attribution are now real.
