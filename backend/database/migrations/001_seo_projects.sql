-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: add seo_projects table
-- Apply with:  psql $DATABASE_URL -f backend/database/migrations/001_seo_projects.sql
--
-- Fully idempotent and self-contained. Safe to run against a fresh database,
-- against an existing schema, or repeatedly — it will only create what's
-- missing. No need to apply schema.sql first.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Prerequisite tables ─────────────────────────────────────────────────────
-- seo_projects has FKs to organizations(id) and users(id). Make sure both
-- exist before we reference them, otherwise PostgreSQL fails with:
--   ERROR: 42P01: relation "organizations" does not exist

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  plan_type VARCHAR(50) NOT NULL DEFAULT 'basic',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── Shared trigger function ─────────────────────────────────────────────────
-- The seo_projects trigger below calls this. CREATE OR REPLACE is idempotent.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── seo_projects ────────────────────────────────────────────────────────────

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

DROP TRIGGER IF EXISTS update_seo_projects_updated_at ON seo_projects;
CREATE TRIGGER update_seo_projects_updated_at BEFORE UPDATE ON seo_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
