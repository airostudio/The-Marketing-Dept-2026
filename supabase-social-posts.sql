-- Audema Social Posts — per-post data model for Social Studio (PULSE)
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-business-brain.sql and supabase-intelligence-profiles.sql
-- have already been run (this table uses the same dual project/profile scope).
--
-- Fixes the core architectural gap found in the social-agent audit: organic
-- posts and ad concepts were generated as one big markdown blob with no
-- per-post data model, so there was no way to approve/reject/regenerate a
-- single post, no real calendar (just a CSV with fabricated dates), and no
-- queue a future publish integration could consume. This table is that
-- missing per-post record — one row per generated post/ad variant, carrying
-- its own review status, optional scheduled time, optional rendered image,
-- and a publish_status a real platform-publish adapter can update later.

-- ── Social posts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_posts (
  id                    UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id            UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id      UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  batch_id              UUID        NOT NULL, -- groups posts generated together in one request
  source                TEXT        NOT NULL DEFAULT 'organic' CHECK (source IN ('organic', 'ad')),
  platform              TEXT        NOT NULL, -- 'LinkedIn' | 'Instagram' | 'Meta/Facebook' | 'TikTok' | 'Twitter/X' | 'Google Search' | ...
  angle_type            TEXT,       -- for ad concepts: 'pain-point' | 'offer' | 'proof' | 'urgency' | 'comparison' | 'aspirational'; null for organic

  hook                  TEXT,
  headline              TEXT        NOT NULL,
  body                  TEXT        NOT NULL DEFAULT '',
  cta                   TEXT,
  hashtags              TEXT[]      DEFAULT '{}',
  proof_point            TEXT,
  urgency_line           TEXT,
  visual_direction       TEXT,

  image_url             TEXT,       -- rendered/uploaded creative for this post
  image_render_status    TEXT        DEFAULT 'none' CHECK (image_render_status IN ('none', 'pending', 'rendered', 'failed')),

  status                TEXT        NOT NULL DEFAULT 'pending_review'
                                    CHECK (status IN ('pending_review', 'approved', 'rejected', 'scheduled', 'published', 'archived')),
  review_note            TEXT,       -- why it was rejected / regen instructions used

  scheduled_at           TIMESTAMPTZ,
  publish_status         TEXT        DEFAULT 'not_connected'
                                    CHECK (publish_status IN ('not_connected', 'queued', 'publishing', 'published', 'failed')),
  publish_platform_post_id TEXT,     -- the ID/URL the real platform API returns once published
  publish_error          TEXT,
  published_at           TIMESTAMPTZ,

  metadata               JSONB       DEFAULT '{}', -- scores, framework used, regen lineage, campaign objective, etc.

  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_user       ON social_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_project    ON social_posts (project_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_profile    ON social_posts (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_batch      ON social_posts (batch_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_status     ON social_posts (status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled  ON social_posts (scheduled_at) WHERE scheduled_at IS NOT NULL;

-- ── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_social_post()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_post_touch ON social_posts;
CREATE TRIGGER trg_social_post_touch
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION touch_social_post();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_posts_owner_all" ON social_posts;
CREATE POLICY "social_posts_owner_all" ON social_posts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Intelligence-profile editors/owners (shared access) can also manage posts
-- scoped to that profile, mirroring the business_brain sharing model.
DROP POLICY IF EXISTS "social_posts_profile_access" ON social_posts;
CREATE POLICY "social_posts_profile_access" ON social_posts
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );
