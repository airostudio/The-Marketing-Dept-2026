-- Audema Audience — persistent contact database + segments for campaign sending
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-business-brain.sql and supabase-intelligence-profiles.sql
-- have already been run (this uses the same dual project/profile scope + the
-- intelligence_profile_members sharing model as supabase-social-posts.sql).
--
-- Fixes the gap in the Pat (Email Delivery) agent: recipients previously had
-- to be pasted or imported fresh for every single campaign, with no memory of
-- who had already been contacted, who unsubscribed, or how to group people
-- into a reusable audience. This schema is that missing persistent layer:
-- one row per contact, reusable segments (dynamic tag-rules or a manually
-- curated static list), and a send log so a segment always excludes anyone
-- who has opted out or bounced.

-- ── Contacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  email             TEXT        NOT NULL,
  first_name        TEXT,
  last_name         TEXT,
  company           TEXT,
  custom_fields     JSONB       NOT NULL DEFAULT '{}', -- arbitrary merge-tag values, e.g. {"city":"Melbourne"}
  tags              TEXT[]      NOT NULL DEFAULT '{}',

  status            TEXT        NOT NULL DEFAULT 'subscribed'
                                CHECK (status IN ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  status_changed_at TIMESTAMPTZ,

  source            TEXT        DEFAULT 'manual', -- 'manual' | 'csv_import' | 'paste' | agent key that created it
  notes             TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  -- One contact per email per account — segments filter this single pool
  -- rather than fragmenting the audience across projects/profiles.
  UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user     ON contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_project  ON contacts (project_id);
CREATE INDEX IF NOT EXISTS idx_contacts_profile  ON contacts (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status   ON contacts (status);
CREATE INDEX IF NOT EXISTS idx_contacts_tags     ON contacts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_contacts_email    ON contacts (lower(email));

-- ── Segments — reusable recipient groups ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS segments (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  name              TEXT        NOT NULL,
  description       TEXT,

  -- 'dynamic': membership computed at send time from filter_rules
  -- 'static':  membership is exactly the rows in segment_members
  member_mode       TEXT        NOT NULL DEFAULT 'dynamic' CHECK (member_mode IN ('dynamic', 'static')),

  -- Dynamic filter shape: { "tagsAny": ["vip"], "tagsAll": [], "status": "subscribed" }
  -- status defaults to 'subscribed' (excluding unsubscribed/bounced/complained)
  -- whenever the key is omitted — enforced in application code, not just here.
  filter_rules      JSONB       NOT NULL DEFAULT '{}',

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_user     ON segments (user_id);
CREATE INDEX IF NOT EXISTS idx_segments_project  ON segments (project_id);
CREATE INDEX IF NOT EXISTS idx_segments_profile  ON segments (intel_profile_id);

-- ── Static segment membership ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS segment_members (
  segment_id  UUID        NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  contact_id  UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (segment_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_segment_members_contact ON segment_members (contact_id);

-- ── Campaign send log — one row per recipient per campaign send ────────────
-- campaign_id is an opaque client-generated id (Pat's collateCampaign()), not
-- a foreign key — campaigns themselves are ephemeral/composed client-side.
CREATE TABLE IF NOT EXISTS campaign_sends (
  id             UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id     UUID        REFERENCES contacts(id) ON DELETE SET NULL,

  campaign_id    TEXT        NOT NULL,
  campaign_name  TEXT,
  segment_id     UUID        REFERENCES segments(id) ON DELETE SET NULL,

  email          TEXT        NOT NULL,
  subject        TEXT,
  status         TEXT        NOT NULL CHECK (status IN ('sent', 'failed', 'rejected')),
  provider_id    TEXT,       -- Resend email id, when sent
  error          TEXT,

  sent_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_sends_user     ON campaign_sends (user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_contact  ON campaign_sends (contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends (campaign_id);

-- ── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_contact()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contact_touch ON contacts;
CREATE TRIGGER trg_contact_touch
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_contact();

CREATE OR REPLACE FUNCTION touch_segment()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_segment_touch ON segments;
CREATE TRIGGER trg_segment_touch
  BEFORE UPDATE ON segments
  FOR EACH ROW EXECUTE FUNCTION touch_segment();

-- Keep status_changed_at honest whenever status actually changes.
CREATE OR REPLACE FUNCTION touch_contact_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contact_status_touch ON contacts;
CREATE TRIGGER trg_contact_status_touch
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION touch_contact_status();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_sends  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_owner_all" ON contacts;
CREATE POLICY "contacts_owner_all" ON contacts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_profile_access" ON contacts;
CREATE POLICY "contacts_profile_access" ON contacts
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );

DROP POLICY IF EXISTS "segments_owner_all" ON segments;
CREATE POLICY "segments_owner_all" ON segments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "segments_profile_access" ON segments;
CREATE POLICY "segments_profile_access" ON segments
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );

DROP POLICY IF EXISTS "segment_members_owner_all" ON segment_members;
CREATE POLICY "segment_members_owner_all" ON segment_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM segments s WHERE s.id = segment_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM segments s WHERE s.id = segment_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "segment_members_profile_access" ON segment_members;
CREATE POLICY "segment_members_profile_access" ON segment_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM segments s
      WHERE s.id = segment_id AND s.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = s.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = s.intel_profile_id AND m.user_id = auth.uid()
                     AND m.role IN ('owner', 'editor'))
      )
    )
  );

DROP POLICY IF EXISTS "campaign_sends_owner_all" ON campaign_sends;
CREATE POLICY "campaign_sends_owner_all" ON campaign_sends
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
