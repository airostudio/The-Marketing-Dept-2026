-- Nancy "Jam Fancy" — AI Instagram Content Research & Generation Platform
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Turns a business website + a photo into a researched, branded week of
-- Instagram content. Schema mirrors the brand → research → content-week →
-- posts pipeline described in the product spec.

CREATE TABLE IF NOT EXISTS nancy_brands (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url           TEXT        NOT NULL,
  business_name         TEXT,
  business_category     TEXT,
  industry              TEXT,
  location              TEXT,
  products_services     JSONB       DEFAULT '[]'::jsonb,
  primary_offer         TEXT,
  secondary_offers      JSONB       DEFAULT '[]'::jsonb,
  target_customer       TEXT,
  customer_problems     JSONB       DEFAULT '[]'::jsonb,
  desired_outcomes      JSONB       DEFAULT '[]'::jsonb,
  unique_value_prop     TEXT,
  proof_points          JSONB       DEFAULT '[]'::jsonb,
  brand_voice           JSONB       DEFAULT '[]'::jsonb,
  common_phrases        JSONB       DEFAULT '[]'::jsonb,
  founder_or_team       JSONB       DEFAULT '[]'::jsonb,
  calls_to_action       JSONB       DEFAULT '[]'::jsonb,
  important_topics      JSONB       DEFAULT '[]'::jsonb,
  website_summary       TEXT,
  -- Visual identity
  screenshot_url        TEXT,
  logo_url              TEXT,
  colours               JSONB       DEFAULT '{}'::jsonb,  -- {primary, secondary[], accent[], background[], text[]}
  fonts                 JSONB       DEFAULT '{}'::jsonb,  -- {heading, body}
  visual_style           TEXT,
  brand_personality     JSONB       DEFAULT '[]'::jsonb,
  design_notes          TEXT,
  -- Personalisation answers (Step 7), reused across weeks
  personalization       JSONB       DEFAULT '{}'::jsonb,
  status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','researching','ready','error')),
  error                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nancy_research_runs (
  id                       UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  brand_id                 UUID        NOT NULL REFERENCES nancy_brands(id) ON DELETE CASCADE,
  category                 TEXT,
  search_queries           JSONB       DEFAULT '[]'::jsonb,
  what_everyone_says       JSONB       DEFAULT '[]'::jsonb,
  what_customers_care_about JSONB      DEFAULT '[]'::jsonb,
  where_opportunity_is     TEXT,
  content_opportunities    JSONB       DEFAULT '[]'::jsonb,   -- content territories, Step 6
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nancy_competitors (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  research_run_id   UUID        NOT NULL REFERENCES nancy_research_runs(id) ON DELETE CASCADE,
  business_name     TEXT        NOT NULL,
  website           TEXT        NOT NULL,
  positioning       TEXT,
  target_customer   TEXT,
  main_offer        TEXT,
  content_topics    JSONB       DEFAULT '[]'::jsonb,
  tone              TEXT,
  differentiators   JSONB       DEFAULT '[]'::jsonb,
  notable_patterns  JSONB       DEFAULT '[]'::jsonb,
  source_urls       JSONB       DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nancy_source_documents (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  research_run_id   UUID        NOT NULL REFERENCES nancy_research_runs(id) ON DELETE CASCADE,
  url               TEXT        NOT NULL,
  title             TEXT,
  extracted_content TEXT,
  fetched_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nancy_user_photos (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id     UUID        REFERENCES nancy_brands(id) ON DELETE CASCADE,
  storage_url  TEXT        NOT NULL,
  metadata     JSONB       DEFAULT '{}'::jsonb,  -- {width, height, sizeBytes, mimeType}
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nancy_content_weeks (
  id             UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  brand_id       UUID        NOT NULL REFERENCES nancy_brands(id) ON DELETE CASCADE,
  research_run_id UUID       REFERENCES nancy_research_runs(id) ON DELETE SET NULL,
  week_number    INTEGER     NOT NULL DEFAULT 1,
  strategy       JSONB       DEFAULT '{}'::jsonb,  -- {rationale, dayMix[], sourcesUsed[]}
  status         TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','ready','error')),
  error          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (brand_id, week_number)
);

CREATE TABLE IF NOT EXISTS nancy_posts (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  content_week_id   UUID        NOT NULL REFERENCES nancy_content_weeks(id) ON DELETE CASCADE,
  day               INTEGER     NOT NULL CHECK (day BETWEEN 1 AND 7),
  objective         TEXT,
  content_pillar    TEXT,
  format            TEXT,
  hook              TEXT,
  slide_headline    TEXT,
  slide_copy        TEXT,
  caption           TEXT,
  cta               TEXT,
  visual_direction  TEXT,
  uses_user_photo   BOOLEAN     DEFAULT false,
  research_basis    TEXT,
  hashtags          JSONB       DEFAULT '[]'::jsonb,
  design_data       JSONB       DEFAULT '{}'::jsonb,   -- design-system JSON used to render this asset
  rendered_svg      TEXT,                              -- the rendered creative (SVG source — see render-social-image.js rationale)
  rendered_asset_url TEXT,                              -- hosted copy if R2/Supabase Storage configured
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (content_week_id, day)
);

CREATE TABLE IF NOT EXISTS nancy_generation_jobs (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  content_week_id  UUID        REFERENCES nancy_content_weeks(id) ON DELETE CASCADE,
  brand_id         UUID        REFERENCES nancy_brands(id) ON DELETE CASCADE,
  stage            TEXT        NOT NULL, -- e.g. 'website_analysis','brand_extraction','research','strategy','content_plan','rendering'
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  error            TEXT,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nancy_brands_user            ON nancy_brands (user_id);
CREATE INDEX IF NOT EXISTS idx_nancy_research_runs_brand    ON nancy_research_runs (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nancy_competitors_run        ON nancy_competitors (research_run_id);
CREATE INDEX IF NOT EXISTS idx_nancy_source_documents_run   ON nancy_source_documents (research_run_id);
CREATE INDEX IF NOT EXISTS idx_nancy_user_photos_user       ON nancy_user_photos (user_id);
CREATE INDEX IF NOT EXISTS idx_nancy_content_weeks_brand    ON nancy_content_weeks (brand_id, week_number DESC);
CREATE INDEX IF NOT EXISTS idx_nancy_posts_week             ON nancy_posts (content_week_id, day);
CREATE INDEX IF NOT EXISTS idx_nancy_generation_jobs_week   ON nancy_generation_jobs (content_week_id, started_at DESC);

-- ── updated_at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION nancy_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nancy_brands_touch ON nancy_brands;
CREATE TRIGGER trg_nancy_brands_touch BEFORE UPDATE ON nancy_brands
  FOR EACH ROW EXECUTE FUNCTION nancy_touch_updated_at();

DROP TRIGGER IF EXISTS trg_nancy_posts_touch ON nancy_posts;
CREATE TRIGGER trg_nancy_posts_touch BEFORE UPDATE ON nancy_posts
  FOR EACH ROW EXECUTE FUNCTION nancy_touch_updated_at();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE nancy_brands            ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_research_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_competitors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_source_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_user_photos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_content_weeks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_posts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE nancy_generation_jobs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nancy_brands_owner_all" ON nancy_brands;
CREATE POLICY "nancy_brands_owner_all" ON nancy_brands
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "nancy_research_runs_owner_all" ON nancy_research_runs;
CREATE POLICY "nancy_research_runs_owner_all" ON nancy_research_runs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM nancy_brands b WHERE b.id = brand_id AND b.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "nancy_competitors_owner_all" ON nancy_competitors;
CREATE POLICY "nancy_competitors_owner_all" ON nancy_competitors
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM nancy_research_runs r
      JOIN nancy_brands b ON b.id = r.brand_id
      WHERE r.id = research_run_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "nancy_source_documents_owner_all" ON nancy_source_documents;
CREATE POLICY "nancy_source_documents_owner_all" ON nancy_source_documents
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM nancy_research_runs r
      JOIN nancy_brands b ON b.id = r.brand_id
      WHERE r.id = research_run_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "nancy_user_photos_owner_all" ON nancy_user_photos;
CREATE POLICY "nancy_user_photos_owner_all" ON nancy_user_photos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "nancy_content_weeks_owner_all" ON nancy_content_weeks;
CREATE POLICY "nancy_content_weeks_owner_all" ON nancy_content_weeks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM nancy_brands b WHERE b.id = brand_id AND b.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "nancy_posts_owner_all" ON nancy_posts;
CREATE POLICY "nancy_posts_owner_all" ON nancy_posts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM nancy_content_weeks w
      JOIN nancy_brands b ON b.id = w.brand_id
      WHERE w.id = content_week_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "nancy_generation_jobs_owner_all" ON nancy_generation_jobs;
CREATE POLICY "nancy_generation_jobs_owner_all" ON nancy_generation_jobs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM nancy_brands b WHERE b.id = brand_id AND b.user_id = auth.uid())
  );
