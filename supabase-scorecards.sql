-- Audema Scorecards & Waitlists — public question pages that turn campaign
-- traffic into scored, opted-in contacts.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-audience.sql, supabase-audience-consent.sql,
--           supabase-intelligence-profiles.sql.
--
-- Campaigns used to send people straight to a website with nothing to catch
-- them. A scorecard is a hosted page (/s/<slug>) that asks a visitor a series
-- of questions, scores them and shows a personal result; a waitlist asks
-- questions without scoring, to learn what people need and would pay before
-- the product is built, and can be compared against another idea's waitlist.
--
-- Visitors never write to these tables directly: the public endpoint
-- (api/scorecard-public.js) validates, scores on the server and writes with
-- the service role. Owners read through api/scorecards.js.

CREATE TABLE IF NOT EXISTS scorecards (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  -- The public address: /s/<slug>. Unique across the whole service.
  slug             TEXT        NOT NULL UNIQUE,
  kind             TEXT        NOT NULL DEFAULT 'scorecard' CHECK (kind IN ('scorecard', 'waitlist')),
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed')),
  title            TEXT        NOT NULL DEFAULT '',

  -- The whole definition (intro, questions, result bands, business name,
  -- consent wording), shaped by api/_lib/scorecard.js normalize().
  definition       JSONB       NOT NULL DEFAULT '{}',

  -- Waitlists sharing a group are compared side by side.
  comparison_group TEXT,

  -- Segments made on publish, so email flows can follow up by result.
  segment_ids      JSONB       NOT NULL DEFAULT '{}',

  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scorecards_user    ON scorecards (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scorecards_profile ON scorecards (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_scorecards_project ON scorecards (project_id);

CREATE TABLE IF NOT EXISTS scorecard_responses (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  scorecard_id     UUID        NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  -- The scorecard's owner, so responses can be scoped without a join.
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  email            TEXT        NOT NULL,
  first_name       TEXT,
  answers          JSONB       NOT NULL DEFAULT '{}',
  score            INTEGER,
  max_score        INTEGER,
  percent          INTEGER,
  band_key         TEXT,

  -- Where they came from: ?src=email|instagram|… and ?c=<campaign>.
  source           TEXT,
  campaign         TEXT,

  -- Marketing consent is separate from taking the scorecard: a visitor can
  -- see their result without agreeing to emails. Only a consented response
  -- becomes a subscribed contact.
  consented        BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_text     TEXT,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,

  -- Their place in line, counted when they joined (waitlists).
  position         INTEGER,

  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scorecard_responses_card ON scorecard_responses (scorecard_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scorecard_responses_user ON scorecard_responses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scorecard_responses_email ON scorecard_responses (scorecard_id, lower(email));

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_scorecards()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scorecards_touch ON scorecards;
CREATE TRIGGER trg_scorecards_touch
  BEFORE UPDATE ON scorecards
  FOR EACH ROW EXECUTE FUNCTION touch_scorecards();

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Read-only for the owner (and teammates on a shared profile). Every write
-- goes through the API with the service role.
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scorecards_owner_read" ON scorecards;
CREATE POLICY "scorecards_owner_read" ON scorecards
  FOR SELECT USING (
    auth.uid() = user_id OR (
      intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = scorecards.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m WHERE m.profile_id = scorecards.intel_profile_id AND m.user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "scorecard_responses_owner_read" ON scorecard_responses;
CREATE POLICY "scorecard_responses_owner_read" ON scorecard_responses
  FOR SELECT USING (auth.uid() = user_id);
