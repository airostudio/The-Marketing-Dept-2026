-- ═══════════════════════════════════════════════════════════════════════════════
-- SEO AGENT DASHBOARD - SUPABASE DATABASE SCHEMA
-- The Marketing Department 2026
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Run this SQL in your Supabase SQL Editor to set up the database.
-- This creates all tables, indexes, RLS policies, and functions.
--
-- Prerequisites:
-- 1. Create a new Supabase project at https://supabase.com
-- 2. Go to SQL Editor in your project dashboard
-- 3. Copy and paste this entire file
-- 4. Click "Run" to execute
--
-- WARNING: This script will DROP all existing tables and data!
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- DROP EXISTING TABLES (in correct order due to foreign key constraints)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop triggers first
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
DROP TRIGGER IF EXISTS update_competitors_updated_at ON competitors;
DROP TRIGGER IF EXISTS update_keywords_updated_at ON keywords;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS get_project_stats(UUID) CASCADE;

-- Drop tables in reverse order of dependencies
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS page_metrics CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS backlinks CASCADE;
DROP TABLE IF EXISTS keyword_rankings CASCADE;
DROP TABLE IF EXISTS keywords CASCADE;
DROP TABLE IF EXISTS audit_issues CASCADE;
DROP TABLE IF EXISTS audits CASCADE;
DROP TABLE IF EXISTS competitors CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS user_settings CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PROFILES TABLE
-- Extended user profiles linked to Supabase Auth
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    company_name TEXT,
    job_title TEXT,
    phone TEXT,
    timezone TEXT DEFAULT 'UTC',
    language TEXT DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can only see and update their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- USER SETTINGS TABLE
-- Stores user preferences and dashboard settings
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own settings" ON user_settings
    FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PROJECTS TABLE
-- SEO projects/websites being tracked
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Basic Info
    name TEXT NOT NULL,
    website_url TEXT NOT NULL,
    industry TEXT,
    business_type TEXT,

    -- Target Settings
    target_country TEXT,
    target_language TEXT,
    additional_regions TEXT[],

    -- Crawl Settings
    sitemap_url TEXT,
    robots_txt_url TEXT,
    crawl_depth INTEGER DEFAULT 3,
    max_pages INTEGER DEFAULT 1000,
    crawl_frequency TEXT DEFAULT 'weekly',
    page_types TEXT[],
    tech_checks TEXT[],
    exclude_patterns TEXT[],

    -- Keywords
    seed_keywords TEXT[],
    brand_keywords TEXT[],
    keyword_update_frequency TEXT DEFAULT 'weekly',
    search_engine TEXT DEFAULT 'google',
    additional_engines TEXT[],

    -- Goals
    traffic_goal INTEGER,
    keyword_goal INTEGER,
    backlink_goal INTEGER,
    da_goal INTEGER,

    -- Alert Settings
    alert_channels TEXT[],
    alert_types TEXT[],
    alert_frequency TEXT DEFAULT 'daily',
    alert_email TEXT,

    -- Integrations (encrypted API keys stored separately)
    integrations JSONB DEFAULT '{}'::jsonb,

    -- Status
    is_active BOOLEAN DEFAULT true,
    last_crawl_at TIMESTAMPTZ,
    last_audit_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_website_url ON projects(website_url);
CREATE INDEX IF NOT EXISTS idx_projects_is_active ON projects(is_active);

-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own projects" ON projects
    FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- COMPETITORS TABLE
-- Competitor websites to track
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    website_url TEXT NOT NULL,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_competitors_project_id ON competitors(project_id);

-- Enable RLS
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage competitors in own projects" ON competitors
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = competitors.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDITS TABLE
-- SEO audit runs and results
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Audit Info
    audit_type TEXT DEFAULT 'full', -- full, quick, technical, content
    status TEXT DEFAULT 'pending', -- pending, running, completed, failed

    -- Results Summary
    pages_crawled INTEGER DEFAULT 0,
    issues_total INTEGER DEFAULT 0,
    issues_critical INTEGER DEFAULT 0,
    issues_high INTEGER DEFAULT 0,
    issues_medium INTEGER DEFAULT 0,
    issues_low INTEGER DEFAULT 0,

    -- Scores
    health_score INTEGER,
    performance_score INTEGER,
    seo_score INTEGER,
    accessibility_score INTEGER,

    -- Timing
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,

    -- Metadata
    triggered_by TEXT DEFAULT 'manual', -- manual, scheduled, api
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audits_project_id ON audits(project_id);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits(created_at DESC);

-- Enable RLS
ALTER TABLE audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage audits in own projects" ON audits
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = audits.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT ISSUES TABLE
-- Individual issues found during audits
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,

    -- Issue Details
    severity TEXT NOT NULL, -- critical, high, medium, low
    category TEXT NOT NULL, -- meta, content, links, images, performance, mobile, security, indexing, structure
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    recommendation TEXT,

    -- Technical Details
    element TEXT, -- The HTML element or code snippet
    line_number INTEGER,

    -- Status
    is_fixed BOOLEAN DEFAULT false,
    fixed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_issues_audit_id ON audit_issues(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_issues_severity ON audit_issues(severity);
CREATE INDEX IF NOT EXISTS idx_audit_issues_category ON audit_issues(category);
CREATE INDEX IF NOT EXISTS idx_audit_issues_is_fixed ON audit_issues(is_fixed);

-- Enable RLS
ALTER TABLE audit_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view issues in own projects" ON audit_issues
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM audits
            JOIN projects ON projects.id = audits.project_id
            WHERE audits.id = audit_issues.audit_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- KEYWORDS TABLE
-- Keywords being tracked for ranking
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Keyword Info
    keyword TEXT NOT NULL,
    keyword_type TEXT DEFAULT 'seed', -- seed, brand, discovered, competitor
    search_volume INTEGER,
    difficulty INTEGER, -- 0-100
    cpc DECIMAL(10,2),

    -- Current Ranking
    current_position INTEGER,
    previous_position INTEGER,
    best_position INTEGER,
    url_ranking TEXT, -- The URL that's ranking

    -- Grouping
    tags TEXT[],
    intent TEXT, -- informational, navigational, transactional, commercial
    topic_cluster TEXT,
    funnel_stage TEXT,

    -- Status
    is_tracked BOOLEAN DEFAULT true,
    last_checked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_keywords_project_id ON keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords USING gin(keyword gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_keywords_is_tracked ON keywords(is_tracked);
CREATE INDEX IF NOT EXISTS idx_keywords_current_position ON keywords(current_position);

-- Enable RLS
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage keywords in own projects" ON keywords
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = keywords.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- KEYWORD RANKINGS TABLE
-- Historical keyword position data
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keyword_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword_id UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,

    -- Ranking Data
    position INTEGER,
    url TEXT,
    search_engine TEXT DEFAULT 'google',
    device TEXT DEFAULT 'desktop', -- desktop, mobile
    location TEXT,

    -- SERP Features
    featured_snippet BOOLEAN DEFAULT false,
    local_pack BOOLEAN DEFAULT false,
    knowledge_panel BOOLEAN DEFAULT false,

    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_keyword_rankings_keyword_id ON keyword_rankings(keyword_id);
CREATE INDEX IF NOT EXISTS idx_keyword_rankings_recorded_at ON keyword_rankings(recorded_at DESC);

-- Partition by date for better performance (optional, uncomment if needed)
-- CREATE INDEX IF NOT EXISTS idx_keyword_rankings_date ON keyword_rankings(DATE(recorded_at));

-- Enable RLS
ALTER TABLE keyword_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view rankings in own projects" ON keyword_rankings
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM keywords
            JOIN projects ON projects.id = keywords.project_id
            WHERE keywords.id = keyword_rankings.keyword_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKLINKS TABLE
-- Discovered and tracked backlinks
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backlinks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Link Info
    source_url TEXT NOT NULL,
    source_domain TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT,

    -- Quality Metrics
    domain_authority INTEGER,
    page_authority INTEGER,
    spam_score INTEGER,
    trust_flow INTEGER,
    citation_flow INTEGER,

    -- Link Attributes
    is_dofollow BOOLEAN DEFAULT true,
    is_sponsored BOOLEAN DEFAULT false,
    is_ugc BOOLEAN DEFAULT false,
    link_type TEXT, -- text, image, redirect

    -- Status
    status TEXT DEFAULT 'active', -- active, lost, broken
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    lost_at TIMESTAMPTZ,

    discovered_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_url, target_url)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_backlinks_project_id ON backlinks(project_id);
CREATE INDEX IF NOT EXISTS idx_backlinks_source_domain ON backlinks(source_domain);
CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks(status);
CREATE INDEX IF NOT EXISTS idx_backlinks_discovered_at ON backlinks(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_backlinks_domain_authority ON backlinks(domain_authority DESC);

-- Enable RLS
ALTER TABLE backlinks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage backlinks in own projects" ON backlinks
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = backlinks.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- ALERTS TABLE
-- System alerts and notifications
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Alert Info
    alert_type TEXT NOT NULL, -- ranking_drop, ranking_gain, new_backlink, lost_backlink, technical_issue, goal_progress, competitor_change
    severity TEXT DEFAULT 'info', -- info, warning, error, success
    title TEXT NOT NULL,
    message TEXT,

    -- Related Entity
    entity_type TEXT, -- keyword, backlink, page, audit
    entity_id UUID,
    url TEXT,

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Status
    read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    actioned BOOLEAN DEFAULT false,
    actioned_at TIMESTAMPTZ,

    -- Delivery
    email_sent BOOLEAN DEFAULT false,
    email_sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alerts_project_id ON alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_alert_type ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

-- Enable RLS
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage alerts in own projects" ON alerts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = alerts.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- PAGE METRICS TABLE
-- Crawled page data and metrics
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS page_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,

    -- Page Info
    url TEXT NOT NULL,
    title TEXT,
    meta_description TEXT,
    canonical_url TEXT,

    -- Technical Metrics
    status_code INTEGER,
    response_time_ms INTEGER,
    page_size_bytes INTEGER,
    word_count INTEGER,

    -- SEO Elements
    h1_count INTEGER,
    h2_count INTEGER,
    internal_links INTEGER,
    external_links INTEGER,
    images_count INTEGER,
    images_without_alt INTEGER,

    -- Core Web Vitals
    lcp_ms INTEGER, -- Largest Contentful Paint
    fid_ms INTEGER, -- First Input Delay
    cls DECIMAL(5,3), -- Cumulative Layout Shift

    -- Mobile
    is_mobile_friendly BOOLEAN,
    viewport_configured BOOLEAN,

    -- Indexing
    is_indexable BOOLEAN DEFAULT true,
    has_noindex BOOLEAN DEFAULT false,
    has_nofollow BOOLEAN DEFAULT false,

    crawled_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_page_metrics_project_id ON page_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_page_metrics_url ON page_metrics(url);
CREATE INDEX IF NOT EXISTS idx_page_metrics_audit_id ON page_metrics(audit_id);
CREATE INDEX IF NOT EXISTS idx_page_metrics_crawled_at ON page_metrics(crawled_at DESC);

-- Enable RLS
ALTER TABLE page_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view page metrics in own projects" ON page_metrics
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = page_metrics.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- REPORTS TABLE
-- Generated reports
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Report Info
    report_type TEXT NOT NULL, -- weekly_summary, monthly_report, competitor_report, custom
    title TEXT NOT NULL,
    description TEXT,

    -- Content
    report_data JSONB DEFAULT '{}'::jsonb,

    -- Period
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,

    -- File
    file_url TEXT,
    file_format TEXT, -- pdf, html, csv

    -- Status
    status TEXT DEFAULT 'generated', -- generating, generated, failed, sent
    sent_to TEXT[], -- email addresses
    sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reports_project_id ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_report_type ON reports(report_type);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);

-- Enable RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage reports in own projects" ON reports
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = reports.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS AND TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to tables
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_competitors_updated_at
    BEFORE UPDATE ON competitors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_keywords_updated_at
    BEFORE UPDATE ON keywords
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Trigger to create profile on signup
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Function to get project stats
CREATE OR REPLACE FUNCTION get_project_stats(project_uuid UUID)
RETURNS TABLE (
    total_keywords BIGINT,
    keywords_in_top_10 BIGINT,
    total_backlinks BIGINT,
    total_issues BIGINT,
    health_score INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM keywords WHERE project_id = project_uuid AND is_tracked = true),
        (SELECT COUNT(*) FROM keywords WHERE project_id = project_uuid AND current_position <= 10),
        (SELECT COUNT(*) FROM backlinks WHERE project_id = project_uuid AND status = 'active'),
        (SELECT COALESCE(SUM(issues_total), 0) FROM audits WHERE project_id = project_uuid ORDER BY created_at DESC LIMIT 1),
        (SELECT audits.health_score FROM audits WHERE project_id = project_uuid ORDER BY created_at DESC LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STORAGE BUCKETS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create storage bucket for user avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for reports
CREATE POLICY "Users can access their own reports"
ON storage.objects FOR SELECT
USING (bucket_id = 'reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload reports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'reports' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ═══════════════════════════════════════════════════════════════════════════════
-- COMPLETED!
-- ═══════════════════════════════════════════════════════════════════════════════

-- Verify tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
