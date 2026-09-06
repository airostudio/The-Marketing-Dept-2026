-- Audema Agent Mission metering — the unit the pricing tiers are built on.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: database/supabase-schema.sql (profiles) already run.
--
-- Customers are not limited to a handful of agents; they have the whole
-- department and are limited by how much work it performs. That work is
-- counted here.
--
-- Scoped per ACCOUNT and per calendar month, not per site: the plan is bought
-- by the account, and an agency's capacity is pooled across its client
-- businesses ("agency users then purchase additional marketing capacity where
-- necessary").

CREATE TABLE IF NOT EXISTS mission_usage (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period      TEXT        NOT NULL,          -- 'YYYY-MM', UTC
  used        INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT mission_usage_used_nonneg CHECK (used >= 0)
);

-- One row per account per month. Makes the counter idempotent to create and
-- lets the increment be a single atomic statement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_usage_user_period
  ON mission_usage (user_id, period);

-- Admin-settable override, same shape as intel_profile_limit. Lets an
-- Enterprise or negotiated account have an allowance that isn't in the code.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mission_limit INTEGER;

-- ── updated_at ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_mission_usage()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mission_usage_touch ON mission_usage;
CREATE TRIGGER trg_mission_usage_touch
  BEFORE UPDATE ON mission_usage
  FOR EACH ROW EXECUTE FUNCTION touch_mission_usage();

-- ── Atomic increment ───────────────────────────────────────────────────────
-- Read-then-write from the API would let two missions started at the same
-- moment both read the same count and both write count+1, so the second
-- mission would be free. This does the whole thing in one statement.
--
-- Returns the new used value. SECURITY DEFINER so it can be called with the
-- service-role key from the metering endpoint.
CREATE OR REPLACE FUNCTION increment_mission_usage(uid UUID, p TEXT)
RETURNS INTEGER AS $$
DECLARE
  new_used INTEGER;
BEGIN
  INSERT INTO mission_usage (user_id, period, used)
  VALUES (uid, p, 1)
  ON CONFLICT (user_id, period)
  DO UPDATE SET used = mission_usage.used + 1
  RETURNING used INTO new_used;
  RETURN new_used;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Row-Level Security ─────────────────────────────────────────────────────
-- Written only by api/mission-usage.js with the service-role key. Users may
-- read their own usage so the UI can show "12 of 60 missions used"; admins
-- read all of it for the usage dashboard.
ALTER TABLE mission_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_usage_self_read" ON mission_usage;
CREATE POLICY "mission_usage_self_read" ON mission_usage
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "mission_usage_admin_read" ON mission_usage;
CREATE POLICY "mission_usage_admin_read" ON mission_usage
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  );

-- Deliberately no INSERT/UPDATE policy: a client that could write this table
-- could grant itself unlimited missions.

-- DONE! Agent Missions are now countable per account per month.
