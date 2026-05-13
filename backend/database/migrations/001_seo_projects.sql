-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: add seo_projects table
-- Apply with:  psql $DATABASE_URL -f backend/database/migrations/001_seo_projects.sql
--
-- Idempotent — safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS seo_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  project_name VARCHAR(255) NOT NULL,
  website_url TEXT NOT NULL,
  industry VARCHAR(100),
  business_type VARCHAR(100),

  target_country VARCHAR(10),
  target_language VARCHAR(10),
  additional_regions TEXT[] DEFAULT '{}',

  sitemap_url TEXT,
  robots_txt_url TEXT,
  crawl_depth INTEGER DEFAULT 3,
  max_pages INTEGER DEFAULT 1000,
  crawl_frequency VARCHAR(20) DEFAULT 'weekly',
  page_types TEXT[] DEFAULT '{}',
  tech_checks TEXT[] DEFAULT '{}',
  exclude_patterns TEXT,

  seed_keywords TEXT[] DEFAULT '{}',
  brand_keywords TEXT[] DEFAULT '{}',
  keyword_update_frequency VARCHAR(20) DEFAULT 'weekly',
  search_engine VARCHAR(20) DEFAULT 'google',
  additional_engines TEXT[] DEFAULT '{}',

  competitors JSONB DEFAULT '[]',

  traffic_goal INTEGER,
  keyword_goal INTEGER,
  backlink_goal INTEGER,
  da_goal INTEGER,

  alert_channels TEXT[] DEFAULT '{}',
  alert_types TEXT[] DEFAULT '{}',
  alert_frequency VARCHAR(20) DEFAULT 'daily',
  alert_email VARCHAR(255),

  integrations JSONB DEFAULT '{}',

  is_active BOOLEAN DEFAULT TRUE,
  last_audit_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_projects_organization ON seo_projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_projects_user ON seo_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_seo_projects_is_active ON seo_projects(is_active);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_seo_projects_updated_at') THEN
    CREATE TRIGGER update_seo_projects_updated_at BEFORE UPDATE ON seo_projects
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;
