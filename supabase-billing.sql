-- Audema Billing — Stripe subscription state on profiles + webhook audit log.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql already run (canonical plan enum).
--
-- Card capture happens on Stripe's own hosted Checkout + Customer Portal —
-- this table only mirrors the subscription state Stripe already owns, kept
-- in sync by api/stripe-webhook.js. Nothing here talks to Stripe directly.

-- ── Stripe fields on profiles ───────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_price_id        TEXT;
-- Stripe's own subscription status vocabulary — mirrored verbatim so this
-- column always matches what the Stripe Dashboard/API says, no translation.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT
  CHECK (subscription_status IN (
    'trialing','active','past_due','canceled','unpaid',
    'incomplete','incomplete_expired','paused'
  ));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON profiles (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ── Billing event audit log ─────────────────────────────────────────────────
-- Every Stripe webhook event this app has handled, for admin visibility
-- (Phase 4's admin Billing page) and for debugging "why didn't my plan
-- update" without having to go dig through the Stripe Dashboard.
CREATE TABLE IF NOT EXISTS billing_events (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_event_id   TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,
  payload           JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Stripe recommends treating webhook delivery as at-least-once; this makes
-- re-processing the same event a no-op instead of a duplicate log row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_stripe_id ON billing_events (stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events (user_id, created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- Written only by api/stripe-webhook.js via the service-role key (bypasses
-- RLS). Users can read their own billing history; admins can read all of it.
DROP POLICY IF EXISTS "billing_events_self_read" ON billing_events;
CREATE POLICY "billing_events_self_read" ON billing_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "billing_events_admin_read" ON billing_events;
CREATE POLICY "billing_events_admin_read" ON billing_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  );

-- ── Protect billing/role columns from direct client writes ─────────────────
-- profiles has a broad "Users can update own profile" RLS policy (no column
-- restriction) — without this trigger, any signed-in user could set their
-- own plan/subscription_status straight through the Supabase client and grant
-- themselves a paid plan for free, or make themselves an admin. Only the
-- webhook (service_role, which bypasses RLS but NOT this trigger — it's
-- allow-listed below) and an existing admin may change these columns.
CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- service_role = server-side calls using SUPABASE_SERVICE_ROLE_KEY (the
  -- Stripe webhook handler, admin API endpoints). auth.uid() IS NULL = a
  -- direct SQL Editor / migration run, not a PostgREST request at all.
  IF current_setting('role', true) = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.plan                    IS DISTINCT FROM OLD.plan
      OR NEW.role                 IS DISTINCT FROM OLD.role
      OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
      OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
      OR NEW.stripe_price_id        IS DISTINCT FROM OLD.stripe_price_id
      OR NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
      OR NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end
      OR NEW.intel_profile_limit    IS DISTINCT FROM OLD.intel_profile_limit)
     AND NOT EXISTS (
       SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')
     )
  THEN
    RAISE EXCEPTION 'Billing and role fields can only be changed by the billing system or an admin.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_billing_columns ON profiles;
CREATE TRIGGER trg_protect_billing_columns
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_billing_columns();

-- DONE! profiles now carries real Stripe subscription state, every webhook
-- event is logged to billing_events, and none of it is client-writable.
