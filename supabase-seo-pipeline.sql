-- SEO Pipeline — Competitor/Product Analysis, Daily Plan, Topic Research,
-- Article Writer, Backlink Prospecting + Human-Reviewed Outreach
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Same dual project/intel_profile scope model as ContactsStore/AnalyticsStore
-- (see supabase-audience.sql, supabase-analytics-brain.sql). One "run" ties
-- the whole pipeline together: analyze the business + competitors once, then
-- generate a rolling daily task list, topics, articles and backlink
-- prospects against that run.

CREATE TABLE IF NOT EXISTS seo_runs (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  website_url       TEXT        NOT NULL,
  business_summary  TEXT,
  products_services JSONB       DEFAULT '[]'::jsonb,
  target_customer   TEXT,
  existing_topics    JSONB      DEFAULT '[]'::jsonb, -- topics already covered on-site, so new plans don't duplicate
  competitors       JSONB       DEFAULT '[]'::jsonb, -- [{name, url, content_focus, notable_gaps}]

  status            TEXT        NOT NULL DEFAULT 'ready' CHECK (status IN ('analyzing','ready','error')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_topics (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES seo_runs(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  topic             TEXT        NOT NULL,
  target_keyword    TEXT,
  search_volume      INTEGER,    -- NULL when not real (see data_source)
  difficulty        INTEGER,    -- NULL when not real
  data_source       TEXT        NOT NULL DEFAULT 'estimate' CHECK (data_source IN ('real','estimate')), -- real = DataForSEO/SEMrush; estimate = AI, always labeled as such in the UI
  rationale         TEXT,       -- why this topic — content gap vs a competitor, ICP pain point, etc.
  content_pillar    TEXT,
  status            TEXT        NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','written','skipped')),

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_daily_tasks (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES seo_runs(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  day_number        INTEGER     NOT NULL, -- 1-based, relative to the plan start — not a calendar date, so "today's tasks" is derived client-side from when the run started
  task_type         TEXT        NOT NULL CHECK (task_type IN ('write_article','technical_fix','backlink_outreach','keyword_research','other')),
  title             TEXT        NOT NULL,
  description       TEXT,
  topic_id          UUID        REFERENCES seo_topics(id) ON DELETE SET NULL,
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_articles (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES seo_runs(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id          UUID        REFERENCES seo_topics(id) ON DELETE SET NULL,

  title             TEXT        NOT NULL,
  meta_description  TEXT,
  slug              TEXT,
  target_keyword    TEXT,
  body_markdown     TEXT        NOT NULL,
  schema_markup     JSONB,      -- suggested JSON-LD (Article/FAQ), for the user to paste in on publish
  word_count        INTEGER,
  status            TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','downloaded','published_elsewhere')),

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Backlink prospecting + HUMAN-REVIEWED outreach — nothing here ever sends
-- itself. status only reaches 'sent' via a user clicking send in the UI,
-- through the same Resend-backed api/send-campaign.js + Pat review-gate
-- already used for email campaigns elsewhere in this app.
CREATE TABLE IF NOT EXISTS seo_backlink_prospects (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES seo_runs(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  domain            TEXT        NOT NULL,
  page_url          TEXT,       -- the specific real page found, if any
  contact_email     TEXT,
  contact_name      TEXT,
  relevance_reason  TEXT,       -- why this is a real, plausible link target
  data_source       TEXT        NOT NULL DEFAULT 'estimate' CHECK (data_source IN ('real','estimate')), -- real = found via Ahrefs/Moz/DataForSEO backlink-gap data or a live crawl; estimate = AI-suggested target, not yet verified live

  outreach_subject  TEXT,
  outreach_body     TEXT,

  status            TEXT        NOT NULL DEFAULT 'found' CHECK (status IN ('found','drafted','queued','sent','replied','link_acquired','declined')),
  sent_at           TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_runs_user               ON seo_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_runs_project             ON seo_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_seo_runs_profile             ON seo_runs (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_seo_topics_run                ON seo_topics (run_id);
CREATE INDEX IF NOT EXISTS idx_seo_daily_tasks_run            ON seo_daily_tasks (run_id, day_number);
CREATE INDEX IF NOT EXISTS idx_seo_articles_run                ON seo_articles (run_id);
CREATE INDEX IF NOT EXISTS idx_seo_backlink_prospects_run       ON seo_backlink_prospects (run_id, status);

ALTER TABLE seo_runs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_topics              ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_daily_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_articles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_backlink_prospects  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seo_runs_owner_all" ON seo_runs;
CREATE POLICY "seo_runs_owner_all" ON seo_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "seo_topics_owner_all" ON seo_topics;
CREATE POLICY "seo_topics_owner_all" ON seo_topics FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "seo_daily_tasks_owner_all" ON seo_daily_tasks;
CREATE POLICY "seo_daily_tasks_owner_all" ON seo_daily_tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "seo_articles_owner_all" ON seo_articles;
CREATE POLICY "seo_articles_owner_all" ON seo_articles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "seo_backlink_prospects_owner_all" ON seo_backlink_prospects;
CREATE POLICY "seo_backlink_prospects_owner_all" ON seo_backlink_prospects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_seo_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seo_runs_updated_at ON seo_runs;
CREATE TRIGGER seo_runs_updated_at BEFORE UPDATE ON seo_runs FOR EACH ROW EXECUTE FUNCTION update_seo_updated_at();

DROP TRIGGER IF EXISTS seo_articles_updated_at ON seo_articles;
CREATE TRIGGER seo_articles_updated_at BEFORE UPDATE ON seo_articles FOR EACH ROW EXECUTE FUNCTION update_seo_updated_at();

DROP TRIGGER IF EXISTS seo_backlink_prospects_updated_at ON seo_backlink_prospects;
CREATE TRIGGER seo_backlink_prospects_updated_at BEFORE UPDATE ON seo_backlink_prospects FOR EACH ROW EXECUTE FUNCTION update_seo_updated_at();
