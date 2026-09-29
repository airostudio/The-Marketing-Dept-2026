-- Audema Credit Balances — quota metering for paid AI generation.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql already run.
--
-- Starts metering api/generate-ad-image.js (real per-call OpenAI image
-- cost). Scoped per intelligence profile/site — the same dual project/
-- profile model as social_posts and business_brain — so a whole team
-- sharing a site shares one balance rather than each login getting its own.
-- New scopes default to 20,000 credits; generation pauses at 0 and the
-- caller is shown an upgrade prompt instead of a silent/opaque failure.

CREATE TABLE IF NOT EXISTS credit_balances (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  credits_total     INTEGER     NOT NULL DEFAULT 20000,
  credits_used      INTEGER     NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT credit_balances_scope_check CHECK (project_id IS NOT NULL OR intel_profile_id IS NOT NULL),
  CONSTRAINT credit_balances_used_nonneg CHECK (credits_used >= 0)
);

-- One balance row per scope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_balances_profile ON credit_balances (intel_profile_id) WHERE intel_profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_balances_project ON credit_balances (project_id) WHERE project_id IS NOT NULL;

-- ── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_credit_balance()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_balance_touch ON credit_balances;
CREATE TRIGGER trg_credit_balance_touch
  BEFORE UPDATE ON credit_balances
  FOR EACH ROW EXECUTE FUNCTION touch_credit_balance();

-- ── Atomic reserve and refund ───────────────────────────────────────────────
--
-- api/generate-ad-image.js used to read the balance, compare it in JavaScript,
-- call OpenAI, and then write back `credits_used + cost` as an absolute value.
-- Two things went wrong with that under any real concurrency:
--
--   * Lost update. Two calls that both read credits_used = X both write
--     X + 100, so the second image is free. The write is an absolute value,
--     so it overwrites rather than accumulates.
--   * A gate held open for two minutes. The check happened before the OpenAI
--     call and the deduction after it, and that call can take 120 seconds. An
--     account with 100 credits left could start twenty generations inside that
--     window, and every one of them would pass a check against the same
--     pre-spend balance. Twenty images bought, one image charged.
--
-- consume_credits() closes both: it compares and deducts in a single UPDATE,
-- so the row lock serialises concurrent callers and the second one re-reads
-- what the first one wrote. The endpoint calls it BEFORE spending money and
-- calls refund_credits() if the generation then fails, so an unlucky customer
-- is not billed for an image they never received.
--
-- Returns (allowed, used_after, total). On refusal used_after is the unchanged
-- current value, so the caller can report an accurate remaining figure.
CREATE OR REPLACE FUNCTION consume_credits(pid UUID, ipid UUID, cost INTEGER)
RETURNS TABLE (allowed BOOLEAN, used_after INTEGER, total INTEGER) AS $$
DECLARE
  new_used  INTEGER;
  new_total INTEGER;
  cur_used  INTEGER;
  cur_total INTEGER;
BEGIN
  UPDATE credit_balances b
     SET credits_used = b.credits_used + cost
   WHERE (
           (ipid IS NOT NULL AND b.intel_profile_id = ipid)
        OR (ipid IS NULL AND pid IS NOT NULL AND b.project_id = pid)
         )
     AND b.credits_used + cost <= b.credits_total
  RETURNING b.credits_used, b.credits_total INTO new_used, new_total;

  IF new_used IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, new_used, new_total;
    RETURN;
  END IF;

  SELECT b.credits_used, b.credits_total INTO cur_used, cur_total
    FROM credit_balances b
   WHERE (ipid IS NOT NULL AND b.intel_profile_id = ipid)
      OR (ipid IS NULL AND pid IS NOT NULL AND b.project_id = pid)
   LIMIT 1;

  -- No row matched at all: the scope has no balance, which is a different
  -- thing from a spent one. Refuse rather than report a zero balance that
  -- was never issued.

  RETURN QUERY SELECT FALSE, COALESCE(cur_used, 0), COALESCE(cur_total, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Give back credits reserved for a generation that then failed. Clamped at
-- zero so a double refund cannot manufacture credits.
CREATE OR REPLACE FUNCTION refund_credits(pid UUID, ipid UUID, cost INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_used INTEGER;
BEGIN
  UPDATE credit_balances b
     SET credits_used = GREATEST(0, b.credits_used - cost)
   WHERE (ipid IS NOT NULL AND b.intel_profile_id = ipid)
      OR (ipid IS NULL AND pid IS NOT NULL AND b.project_id = pid)
  RETURNING b.credits_used INTO new_used;
  RETURN COALESCE(new_used, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Deductions and inserts always happen server-side via SUPABASE_SERVICE_
-- ROLE_KEY (which bypasses RLS) — api/generate-ad-image.js is the only
-- writer. The only policy needed here is read access, so the UI can show a
-- live "X credits remaining" meter without round-tripping the metered API.
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_balances_scope_read" ON credit_balances;
CREATE POLICY "credit_balances_scope_read" ON credit_balances
  FOR SELECT USING (
    (intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid())
    ))
    OR (project_id IS NOT NULL AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.user_id = auth.uid()))
  );
