-- ═══════════════════════════════════════════════════════════════════════════════
-- DATABASE SCHEMA — Audema Marketing Platform
-- PostgreSQL schema for multi-tenant B2B SaaS marketing automation platform.
--
-- Architecture:
--   - Multi-tenant: Organizations → Users → Customers
--   - Customer lifecycle: Health scores, campaigns, lifecycle stages
--   - Revenue tracking: Deals, attribution, forecasting
--   - Integrations: CRM, ESP, ad platforms
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ORGANIZATIONS & USERS (Multi-Tenant)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  plan_type VARCHAR(50) NOT NULL DEFAULT 'basic', -- basic, pro, enterprise
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, suspended, cancelled
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(status);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- owner, admin, member, viewer
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, suspended, pending
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_status ON users(status);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(512) UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. CUSTOMERS (CRM-like customer data)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Basic info
  email VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  title VARCHAR(100),

  -- Lifecycle
  lifecycle_stage VARCHAR(50) NOT NULL DEFAULT 'trial', -- trial, onboarding, active, growth, at_risk, churned, champion
  current_plan VARCHAR(50), -- basic, pro, enterprise

  -- Dates
  trial_start_date TIMESTAMP WITH TIME ZONE,
  customer_start_date TIMESTAMP WITH TIME ZONE,
  churned_date TIMESTAMP WITH TIME ZONE,

  -- Revenue
  mrr DECIMAL(10,2) DEFAULT 0, -- Monthly Recurring Revenue
  ltv DECIMAL(10,2) DEFAULT 0, -- Lifetime Value

  -- Metadata
  source VARCHAR(100), -- where they came from (organic, paid, referral)
  custom_fields JSONB DEFAULT '{}',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_customers_organization ON customers(organization_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_lifecycle_stage ON customers(lifecycle_stage);
CREATE INDEX idx_customers_current_plan ON customers(current_plan);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. CUSTOMER HEALTH SCORES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE customer_health_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Health score components
  health_score INTEGER NOT NULL, -- 0-100
  status VARCHAR(20) NOT NULL, -- green, yellow, red
  churn_risk DECIMAL(4,3) NOT NULL, -- 0.000-1.000

  -- Component scores
  usage_score INTEGER, -- 0-100
  nps_score INTEGER, -- 0-100
  engagement_score INTEGER, -- 0-100
  billing_score INTEGER, -- 0-100

  -- Raw metrics
  usage_metrics JSONB DEFAULT '{}',
  engagement_metrics JSONB DEFAULT '{}',
  billing_metrics JSONB DEFAULT '{}',

  -- Recommendations
  recommendations JSONB DEFAULT '[]',

  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_health_scores_organization ON customer_health_scores(organization_id);
CREATE INDEX idx_health_scores_customer ON customer_health_scores(customer_id);
CREATE INDEX idx_health_scores_status ON customer_health_scores(status);
CREATE INDEX idx_health_scores_calculated_at ON customer_health_scores(calculated_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. NPS RESPONSES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE nps_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  category VARCHAR(20) NOT NULL, -- promoter, passive, detractor
  feedback TEXT,

  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nps_organization ON nps_responses(organization_id);
CREATE INDEX idx_nps_customer ON nps_responses(customer_id);
CREATE INDEX idx_nps_category ON nps_responses(category);
CREATE INDEX idx_nps_recorded_at ON nps_responses(recorded_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. CAMPAIGNS (Email, social, paid media)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Campaign details
  campaign_type VARCHAR(50) NOT NULL, -- onboarding, expansion, churn_prevention, advocacy
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, paused, completed, cancelled

  -- Sequence
  sequence JSONB DEFAULT '[]',
  current_step INTEGER DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  launched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_campaigns_organization ON campaigns(organization_id);
CREATE INDEX idx_campaigns_customer ON campaigns(customer_id);
CREATE INDEX idx_campaigns_type ON campaigns(campaign_type);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. LIFECYCLE STAGE HISTORY
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE lifecycle_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  from_stage VARCHAR(50),
  to_stage VARCHAR(50) NOT NULL,
  metadata JSONB DEFAULT '{}',

  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_lifecycle_history_organization ON lifecycle_stage_history(organization_id);
CREATE INDEX idx_lifecycle_history_customer ON lifecycle_stage_history(customer_id);
CREATE INDEX idx_lifecycle_history_timestamp ON lifecycle_stage_history(timestamp);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. REVENUE & DEALS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Deal details
  name VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  stage VARCHAR(50) NOT NULL, -- lead, mql, sql, opportunity, closed_won, closed_lost
  close_probability DECIMAL(4,3), -- 0.000-1.000
  expected_close_date DATE,

  -- Source attribution
  source VARCHAR(100),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  attribution_data JSONB DEFAULT '{}',

  -- Dates
  created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_date TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_deals_organization ON deals(organization_id);
CREATE INDEX idx_deals_customer ON deals(customer_id);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_expected_close_date ON deals(expected_close_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. ICP DATA (Ideal Customer Profile)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE icp_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- ICP details
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Demographics
  company_size_min INTEGER,
  company_size_max INTEGER,
  revenue_min DECIMAL(15,2),
  revenue_max DECIMAL(15,2),
  industries TEXT[], -- Array of industries
  job_titles TEXT[], -- Array of target job titles
  locations TEXT[], -- Array of locations

  -- Behavioral
  pain_points TEXT[],
  use_cases TEXT[],
  buying_signals TEXT[],

  -- Metadata
  fit_score_threshold INTEGER, -- Minimum score to qualify as ICP
  custom_criteria JSONB DEFAULT '{}',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_icp_organization ON icp_profiles(organization_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. INTEGRATIONS (Third-party API credentials)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Integration details
  provider VARCHAR(50) NOT NULL, -- salesforce, hubspot, sendgrid, google_ads, etc.
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, disconnected, error

  -- Credentials (encrypted)
  credentials JSONB NOT NULL, -- API keys, OAuth tokens, etc.

  -- Sync settings
  sync_enabled BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  sync_errors JSONB DEFAULT '[]',

  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integrations_organization ON integrations(organization_id);
CREATE INDEX idx_integrations_provider ON integrations(provider);
CREATE INDEX idx_integrations_status ON integrations(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. AUDIT LOGS (Track all data changes)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Action details
  action VARCHAR(50) NOT NULL, -- create, update, delete, login, etc.
  resource_type VARCHAR(50) NOT NULL, -- customer, campaign, deal, etc.
  resource_id UUID,

  -- Changes
  changes JSONB DEFAULT '{}',

  -- Metadata
  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_organization ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. SEO PROJECTS (Wizard output — one row per tracked website)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS seo_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Basic info
  project_name VARCHAR(255) NOT NULL,
  website_url TEXT NOT NULL,
  industry VARCHAR(100),
  business_type VARCHAR(100),

  -- Target settings
  target_country VARCHAR(10),
  target_language VARCHAR(10),
  additional_regions TEXT[] DEFAULT '{}',

  -- Crawl settings
  sitemap_url TEXT,
  robots_txt_url TEXT,
  crawl_depth INTEGER DEFAULT 3,
  max_pages INTEGER DEFAULT 1000,
  crawl_frequency VARCHAR(20) DEFAULT 'weekly',
  page_types TEXT[] DEFAULT '{}',
  tech_checks TEXT[] DEFAULT '{}',
  exclude_patterns TEXT,

  -- Keywords
  seed_keywords TEXT[] DEFAULT '{}',
  brand_keywords TEXT[] DEFAULT '{}',
  keyword_update_frequency VARCHAR(20) DEFAULT 'weekly',
  search_engine VARCHAR(20) DEFAULT 'google',
  additional_engines TEXT[] DEFAULT '{}',

  -- Competitors (stored as JSONB array of {name, url})
  competitors JSONB DEFAULT '[]',

  -- Goals
  traffic_goal INTEGER,
  keyword_goal INTEGER,
  backlink_goal INTEGER,
  da_goal INTEGER,

  -- Alerts
  alert_channels TEXT[] DEFAULT '{}',
  alert_types TEXT[] DEFAULT '{}',
  alert_frequency VARCHAR(20) DEFAULT 'daily',
  alert_email VARCHAR(255),

  -- Third-party integrations. Credentials should be encrypted at rest at
  -- the application layer — this column stores the encrypted blob.
  integrations JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_audit_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_projects_organization ON seo_projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_projects_user ON seo_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_seo_projects_is_active ON seo_projects(is_active);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS: Auto-update updated_at timestamps
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_icp_profiles_updated_at BEFORE UPDATE ON icp_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_seo_projects_updated_at BEFORE UPDATE ON seo_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- NOTE: A previous seed inserted a demo user with a placeholder bcrypt hash that
-- could never be matched by bcrypt.compare(). It was removed because (a) it gave
-- a false sense of a working login and (b) shipping a seeded demo account is a
-- production hazard.
--
-- To create an account against a fresh database, hit POST /api/auth/signup. The
-- transaction in backend/api/auth.js creates the organization and user atomically.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS: Convenient queries
-- ═══════════════════════════════════════════════════════════════════════════════

-- Latest health score for each customer
CREATE VIEW latest_customer_health AS
SELECT DISTINCT ON (customer_id)
  chs.*
FROM customer_health_scores chs
ORDER BY customer_id, calculated_at DESC;

-- Customer summary (with latest health)
CREATE VIEW customer_summary AS
SELECT
  c.*,
  lch.health_score,
  lch.status AS health_status,
  lch.churn_risk,
  lch.calculated_at AS health_calculated_at
FROM customers c
LEFT JOIN latest_customer_health lch ON c.id = lch.customer_id;

-- Organization metrics
CREATE VIEW organization_metrics AS
SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  COUNT(DISTINCT c.id) AS total_customers,
  COUNT(DISTINCT CASE WHEN c.lifecycle_stage = 'active' THEN c.id END) AS active_customers,
  COUNT(DISTINCT CASE WHEN c.lifecycle_stage = 'churned' THEN c.id END) AS churned_customers,
  SUM(c.mrr) AS total_mrr,
  AVG(lch.health_score) AS avg_health_score,
  COUNT(DISTINCT CASE WHEN lch.status = 'red' THEN c.id END) AS at_risk_customers
FROM organizations o
LEFT JOIN customers c ON o.id = c.organization_id
LEFT JOIN latest_customer_health lch ON c.id = lch.customer_id
GROUP BY o.id, o.name;

-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════
