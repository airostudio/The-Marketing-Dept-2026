-- Audema Agency Edition — multi-tenant agency layer
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql has already been run.
--
-- Purely additive on top of the existing single-business model
-- (docs/audema-agency/DECISIONS.md #1): an intelligence_profile is now also
-- referred to as a "Client Business" once it is owned by an Agency, but
-- every new column here is nullable and every existing row is unaffected —
-- agency_id stays NULL and the profile keeps behaving exactly as before.

-- ── Agencies ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agencies (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  slug         TEXT        NOT NULL,
  website      TEXT        DEFAULT '',
  country      TEXT        DEFAULT '',
  timezone     TEXT        DEFAULT 'UTC',
  currency     TEXT        NOT NULL DEFAULT 'USD',
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','payment_due','restricted','suspended','cancelled')),
  branding     JSONB       DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_agencies_owner ON agencies (owner_id);

-- ── Agency members (seats) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agency_members (
  id         UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  agency_id  UUID        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL
             CHECK (role IN ('owner','admin','account_manager','marketing_specialist','analyst','client_viewer')),
  status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed')),
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_members_agency ON agency_members (agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_members_user   ON agency_members (user_id);

-- ── Agency invitations ────────────────────────────────────────────────────────
-- token_hash only, never the raw invite token (standing no-plaintext-credentials rule).
CREATE TABLE IF NOT EXISTS agency_invitations (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  agency_id   UUID        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL
              CHECK (role IN ('owner','admin','account_manager','marketing_specialist','analyst','client_viewer')),
  token_hash  TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_agency_invitations_agency ON agency_invitations (agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_invitations_email  ON agency_invitations (email);

-- ── Extend intelligence_profiles ("Client Business") ─────────────────────────
ALTER TABLE intelligence_profiles ADD COLUMN IF NOT EXISTS agency_id UUID
  REFERENCES agencies(id) ON DELETE SET NULL;
ALTER TABLE intelligence_profiles ADD COLUMN IF NOT EXISTS account_manager_user_id UUID
  REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE intelligence_profiles ADD COLUMN IF NOT EXISTS status TEXT
  NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'));
ALTER TABLE intelligence_profiles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_intel_profiles_agency ON intelligence_profiles (agency_id);

-- ── Per-member client access grants ──────────────────────────────────────────
-- Deliberately separate from intelligence_profile_members (owner/admin agency
-- roles bypass this table entirely; see docs/audema-agency/DECISIONS.md #3).
CREATE TABLE IF NOT EXISTS client_member_access (
  id                 UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  agency_id          UUID        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  client_business_id UUID        NOT NULL REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  agency_member_id   UUID        NOT NULL REFERENCES agency_members(id) ON DELETE CASCADE,
  access_level       TEXT        NOT NULL DEFAULT 'full' CHECK (access_level IN ('full','read_only')),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_business_id, agency_member_id)
);

CREATE INDEX IF NOT EXISTS idx_client_access_agency ON client_member_access (agency_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_access_member ON client_member_access (agency_member_id);

-- ── Agency subscriptions (Stripe) ─────────────────────────────────────────────
-- Schema only — no Stripe calls anywhere yet (docs/audema-agency/DECISIONS.md #2).
-- status intentionally mirrors Stripe's own vocabulary verbatim: Stripe webhook
-- events are the source of truth, this column is never locally reinterpreted.
CREATE TABLE IF NOT EXISTS agency_subscriptions (
  id                          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  agency_id                   UUID        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  stripe_customer_id          TEXT        NOT NULL,
  stripe_subscription_id      TEXT        NOT NULL,
  stripe_price_id             TEXT        NOT NULL,
  seat_quantity                INTEGER     NOT NULL CHECK (seat_quantity > 0),
  status                      TEXT        NOT NULL
                              CHECK (status IN ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  current_period_start        TIMESTAMPTZ NOT NULL,
  current_period_end          TIMESTAMPTZ NOT NULL,
  cancel_at_period_end        BOOLEAN     NOT NULL DEFAULT FALSE,
  scheduled_seat_quantity      INTEGER     CHECK (scheduled_seat_quantity IS NULL OR scheduled_seat_quantity > 0),
  scheduled_change_effective_at TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agency_id),
  UNIQUE (stripe_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_subscriptions_agency ON agency_subscriptions (agency_id);

-- ── Agency audit log ──────────────────────────────────────────────────────────
-- Distinct from admin_activity_log (database/admin-setup.sql), which logs
-- platform-admin actions and has no agency/client scoping concept.
CREATE TABLE IF NOT EXISTS agency_audit_log (
  id                 UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  agency_id          UUID        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  client_business_id UUID        REFERENCES intelligence_profiles(id) ON DELETE SET NULL,
  actor_user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action             TEXT        NOT NULL,
  resource_type      TEXT        NOT NULL,
  resource_id        UUID        NOT NULL,
  metadata           JSONB       DEFAULT '{}'::jsonb,
  ip_address         TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agency_audit_log_agency ON agency_audit_log (agency_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_audit_log_client ON agency_audit_log (client_business_id, created_at DESC);

-- ── updated_at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_agency_row()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agencies_touch ON agencies;
CREATE TRIGGER trg_agencies_touch
  BEFORE UPDATE ON agencies
  FOR EACH ROW EXECUTE FUNCTION touch_agency_row();

DROP TRIGGER IF EXISTS trg_agency_members_touch ON agency_members;
CREATE TRIGGER trg_agency_members_touch
  BEFORE UPDATE ON agency_members
  FOR EACH ROW EXECUTE FUNCTION touch_agency_row();

DROP TRIGGER IF EXISTS trg_agency_invitations_touch ON agency_invitations;
CREATE TRIGGER trg_agency_invitations_touch
  BEFORE UPDATE ON agency_invitations
  FOR EACH ROW EXECUTE FUNCTION touch_agency_row();

DROP TRIGGER IF EXISTS trg_client_member_access_touch ON client_member_access;
CREATE TRIGGER trg_client_member_access_touch
  BEFORE UPDATE ON client_member_access
  FOR EACH ROW EXECUTE FUNCTION touch_agency_row();

DROP TRIGGER IF EXISTS trg_agency_subscriptions_touch ON agency_subscriptions;
CREATE TRIGGER trg_agency_subscriptions_touch
  BEFORE UPDATE ON agency_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_agency_row();

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE agencies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_member_access   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_audit_log       ENABLE ROW LEVEL SECURITY;

-- Agency owner: full control over the agency record.
DROP POLICY IF EXISTS "agency_owner_all" ON agencies;
CREATE POLICY "agency_owner_all" ON agencies
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Any active member can read the agency record they belong to.
DROP POLICY IF EXISTS "agency_member_read" ON agencies;
CREATE POLICY "agency_member_read" ON agencies
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = id AND m.user_id = auth.uid() AND m.status = 'active')
  );

-- Agency members table: owner/admin manage membership; members read their own row
-- and see their agency's roster.
DROP POLICY IF EXISTS "agency_members_owner_admin_manage" ON agency_members;
CREATE POLICY "agency_members_owner_admin_manage" ON agency_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = agency_members.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_members.agency_id AND a.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = agency_members.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_members.agency_id AND a.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "agency_members_self_read" ON agency_members;
CREATE POLICY "agency_members_self_read" ON agency_members
  FOR SELECT USING (user_id = auth.uid());

-- Invitations: owner/admin manage; invited person can read their own invite by email.
DROP POLICY IF EXISTS "agency_invitations_owner_admin_manage" ON agency_invitations;
CREATE POLICY "agency_invitations_owner_admin_manage" ON agency_invitations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = agency_invitations.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_invitations.agency_id AND a.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = agency_invitations.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_invitations.agency_id AND a.owner_id = auth.uid())
  );

-- Client access grants: owner/admin manage; a member can read grants that name them.
DROP POLICY IF EXISTS "client_access_owner_admin_manage" ON client_member_access;
CREATE POLICY "client_access_owner_admin_manage" ON client_member_access
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = client_member_access.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = client_member_access.agency_id AND a.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = client_member_access.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = client_member_access.agency_id AND a.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "client_access_self_read" ON client_member_access;
CREATE POLICY "client_access_self_read" ON client_member_access
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.id = client_member_access.agency_member_id AND m.user_id = auth.uid())
  );

-- Subscriptions: owner only (billing is not a shared surface).
DROP POLICY IF EXISTS "agency_subscriptions_owner_all" ON agency_subscriptions;
CREATE POLICY "agency_subscriptions_owner_all" ON agency_subscriptions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_subscriptions.agency_id AND a.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_subscriptions.agency_id AND a.owner_id = auth.uid())
  );

-- Audit log: owner/admin read; writes happen only via SECURITY DEFINER service code
-- (no direct client INSERT policy — service role bypasses RLS as usual).
DROP POLICY IF EXISTS "agency_audit_log_owner_admin_read" ON agency_audit_log;
CREATE POLICY "agency_audit_log_owner_admin_read" ON agency_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM agency_members m
            WHERE m.agency_id = agency_audit_log.agency_id AND m.user_id = auth.uid()
              AND m.role IN ('owner','admin') AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM agencies a WHERE a.id = agency_audit_log.agency_id AND a.owner_id = auth.uid())
  );
