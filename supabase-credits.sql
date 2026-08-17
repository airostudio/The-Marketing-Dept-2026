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
