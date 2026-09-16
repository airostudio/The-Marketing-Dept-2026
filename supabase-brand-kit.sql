-- Audema Brand Kit — the account's own visual "staples" (logo, colors, fonts)
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql already run.
--
-- Every ad/creative generation surface (Social Studio's AI ad images and
-- quick-template creatives, and anything built on the same pattern later)
-- was left to invent its own look per generation — a free-text
-- "visualDirection" field was the only lever, so two ads for the same
-- business could come back with entirely different colors and no logo at
-- all. This table is the single, account-wide source of truth for the
-- handful of things that should be IDENTICAL across every generated asset:
-- the logo file, the brand's real hex colors, and its font names.
--
-- website_url lets the Brand Kit auto-detect logo/colors/fonts from the
-- business's own site (api/brand-kit-auto-detect.js) and be re-run later
-- without retyping it. It exists here, not on intelligence_profiles or
-- projects, because intelligence_profiles has no website column at all
-- today and this keeps the field wherever the rest of the visual identity
-- already lives — one place, not three.
--
-- Deliberately does NOT duplicate text BusinessBrain already owns (company
-- name, tagline, positioning, contact info — see supabase-business-brain.sql)
-- — this table owns only the visual identity fields nothing else in the
-- schema has anywhere: logo_url, colours, fonts. Reading both at generation
-- time (not merging them into one table) keeps one source of truth per field
-- instead of two places that can drift out of sync.
--
-- Scoped exactly like credit_balances/social_posts — the same dual project/
-- intelligence-profile model — so a whole team sharing a business shares one
-- brand kit rather than each login inventing its own. NOT the same table as
-- nancy_brands (which is a per-website RESEARCH record Nancy builds from
-- crawling a URL, keyed by user_id with no project/profile scoping, and can
-- have many rows per user for many researched sites — a different concept
-- from "this account's one canonical brand kit").

CREATE TABLE IF NOT EXISTS brand_kits (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  logo_url          TEXT,       -- hosted (R2) URL — never a data: URI, so it can be reused in prompts/requests
  website_url       TEXT,       -- the business's own site, so auto-detect can be re-run later without retyping it
  colours           JSONB       NOT NULL DEFAULT '{}'::jsonb,
                                -- {primary, secondary: [], accent: [], background: [], text: []} — all hex strings
  fonts             JSONB       NOT NULL DEFAULT '{}'::jsonb,
                                -- {heading, body} — font family names, not files (Google Fonts names or similar)

  updated_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT brand_kits_scope_check CHECK (project_id IS NOT NULL OR intel_profile_id IS NOT NULL)
);

-- Idempotent for a brand_kits table that already existed before website_url
-- was added — CREATE TABLE IF NOT EXISTS above is a no-op on a second run.
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS website_url TEXT;

-- One brand kit per scope — same "at most one row per business" shape as credit_balances.
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_kits_profile ON brand_kits (intel_profile_id) WHERE intel_profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_kits_project ON brand_kits (project_id) WHERE project_id IS NOT NULL;

-- ── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_brand_kit()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brand_kit_touch ON brand_kits;
CREATE TRIGGER trg_brand_kit_touch
  BEFORE UPDATE ON brand_kits
  FOR EACH ROW EXECUTE FUNCTION touch_brand_kit();

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Same sharing model as social_posts: a project's owner, or an
-- intelligence-profile's owner/editor, can read and write; a viewer can only
-- read. Nothing here is per-user-only, since the whole point is one shared
-- kit for everyone working on the same business.
ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_kits_project_owner_all" ON brand_kits;
CREATE POLICY "brand_kits_project_owner_all" ON brand_kits
  FOR ALL USING (
    project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  ) WITH CHECK (
    project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "brand_kits_profile_read" ON brand_kits;
CREATE POLICY "brand_kits_profile_read" ON brand_kits
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "brand_kits_profile_write" ON brand_kits;
CREATE POLICY "brand_kits_profile_write" ON brand_kits
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  ) WITH CHECK (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );
