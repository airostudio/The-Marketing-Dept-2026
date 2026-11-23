-- Audema client workspaces and admin-editable settings.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: profiles (supabase-install-all.sql), supabase-autopilot.sql.
--
--   workspaces    a client you sell Audema to (an agency or a business).
--                 Users belong to at most one; its owner manages its settings.
--   app_settings  the third-party keys and options the agents use (Anthropic,
--                 Resend, the LinkedIn/Facebook/X/Google sign-in apps…).
--                 scope 'platform' = your defaults for everyone;
--                 scope 'workspace' = one client's own, used instead of yours.
--                 Values are encrypted by the app (CONNECTIONS_ENCRYPTION_KEY)
--                 before they reach this table, and no browser can read it.
--
-- Precedence when an agent needs a key: the client's own → the platform
-- setting → the Vercel environment variable.

CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  name        TEXT        NOT NULL,
  owner_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS workspace_role TEXT DEFAULT 'member';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_workspace_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_workspace_role_check CHECK (workspace_role IN ('owner', 'member'));
CREATE INDEX IF NOT EXISTS idx_profiles_workspace ON profiles (workspace_id);

CREATE TABLE IF NOT EXISTS app_settings (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  scope         TEXT        NOT NULL CHECK (scope IN ('platform', 'workspace')),
  workspace_id  UUID        REFERENCES workspaces(id) ON DELETE CASCADE,
  key           TEXT        NOT NULL,
  value_enc     TEXT        NOT NULL,             -- encrypted by the app
  hint          TEXT,                             -- e.g. "…a1b2" so an admin can tell which key is set
  updated_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((scope = 'platform' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_platform ON app_settings (key) WHERE scope = 'platform';
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_workspace ON app_settings (workspace_id, key) WHERE scope = 'workspace';

CREATE OR REPLACE FUNCTION touch_workspace_tables()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_workspaces_touch ON workspaces;
CREATE TRIGGER trg_workspaces_touch BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION touch_workspace_tables();
DROP TRIGGER IF EXISTS trg_app_settings_touch ON app_settings;
CREATE TRIGGER trg_app_settings_touch BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION touch_workspace_tables();

-- Row-level security on, with no policies: only the API (service role) reads
-- or writes these. A browser must never see a setting's value.
ALTER TABLE workspaces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
