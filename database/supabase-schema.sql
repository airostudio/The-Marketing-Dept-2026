-- ═══════════════════════════════════════════════════════════════════════════════
-- THE MARKETING DEPARTMENT 2026 - SUPABASE DATABASE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- This SQL file sets up the complete database schema for the application.
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
--
-- Prerequisites:
-- 1. Create a new Supabase project at https://app.supabase.com
-- 2. Go to SQL Editor and paste this entire file
-- 3. Click "Run" to execute
-- 4. Copy your project URL and anon key from Settings > API
-- 5. Add them to web/js/config.js
--
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════════
-- USER PROFILES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    firstname TEXT,
    lastname TEXT,
    avatar_url TEXT,
    -- Canonical plan enum (superseded/re-asserted by supabase-intelligence-profiles.sql
    -- if that migration has also been run, but kept correct here too so a
    -- fresh install from this file alone gets the real tier names).
    plan TEXT DEFAULT 'free' CHECK (plan IN (
        'free',
        'start', 'growth', 'scale', 'autonomous', 'enterprise',
        'agency_starter', 'agency_growth', 'agency_pro', 'agency_enterprise'
    )),
    company TEXT,
    website TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, firstname, lastname, company)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'firstname', NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'lastname', NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'org', NEW.raw_user_meta_data->>'company', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════════
-- PROJECTS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    industry TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    settings JSONB DEFAULT '{}',
    health_score INTEGER DEFAULT 0,
    last_audit_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDITS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('full', 'quick', 'scheduled', 'manual')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    score INTEGER,
    summary JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    pages_crawled INTEGER DEFAULT 0,
    issues_found INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audits_project_id ON audits(project_id);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT ISSUES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    recommendation TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'ignored')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_issues_audit_id ON audit_issues(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_issues_severity ON audit_issues(severity);
CREATE INDEX IF NOT EXISTS idx_audit_issues_status ON audit_issues(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- KEYWORDS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    search_volume INTEGER,
    difficulty INTEGER,
    cpc DECIMAL(10, 2),
    current_position INTEGER,
    previous_position INTEGER,
    best_position INTEGER,
    target_url TEXT,
    tags TEXT[],
    status TEXT DEFAULT 'tracking' CHECK (status IN ('tracking', 'paused', 'archived')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_keywords_project_id ON keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);

-- ═══════════════════════════════════════════════════════════════════════════════
-- KEYWORD RANKINGS (Historical tracking)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keyword_rankings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword_id UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    position INTEGER,
    url TEXT,
    search_engine TEXT DEFAULT 'google',
    device TEXT DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile', 'tablet')),
    location TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_rankings_keyword_id ON keyword_rankings(keyword_id);
CREATE INDEX IF NOT EXISTS idx_keyword_rankings_recorded_at ON keyword_rankings(recorded_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- COMPETITORS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    metrics JSONB DEFAULT '{}',
    last_analyzed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_competitors_project_id ON competitors(project_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKLINKS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backlinks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT,
    rel TEXT,
    domain_authority INTEGER,
    page_authority INTEGER,
    spam_score INTEGER,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'lost', 'broken')),
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_url, target_url)
);

CREATE INDEX IF NOT EXISTS idx_backlinks_project_id ON backlinks(project_id);
CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks(status);
CREATE INDEX IF NOT EXISTS idx_backlinks_discovered_at ON backlinks(discovered_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ALERTS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    title TEXT NOT NULL,
    message TEXT,
    data JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_project_id ON alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- USER SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{
        "notifications": {
            "email": true,
            "browser": true,
            "digest": "daily"
        },
        "dashboard": {
            "theme": "light",
            "defaultView": "overview"
        },
        "seo": {
            "defaultSearchEngine": "google",
            "defaultLocation": "us",
            "defaultDevice": "desktop"
        }
    }',
    api_keys JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE backlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can only see/edit their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Projects: Users can only access their own projects
CREATE POLICY "Users can view own projects" ON projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create projects" ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" ON projects
    FOR DELETE USING (auth.uid() = user_id);

-- Audits: Users can access audits for their projects
CREATE POLICY "Users can view project audits" ON audits
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = audits.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can create project audits" ON audits
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = audits.project_id AND projects.user_id = auth.uid())
    );

-- Audit Issues: Users can access issues for their audits
CREATE POLICY "Users can view audit issues" ON audit_issues
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM audits
            JOIN projects ON projects.id = audits.project_id
            WHERE audits.id = audit_issues.audit_id AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create audit issues" ON audit_issues
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM audits
            JOIN projects ON projects.id = audits.project_id
            WHERE audits.id = audit_issues.audit_id AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update audit issues" ON audit_issues
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM audits
            JOIN projects ON projects.id = audits.project_id
            WHERE audits.id = audit_issues.audit_id AND projects.user_id = auth.uid()
        )
    );

-- Keywords: Users can access keywords for their projects
CREATE POLICY "Users can view project keywords" ON keywords
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = keywords.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can create project keywords" ON keywords
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = keywords.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can update project keywords" ON keywords
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = keywords.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can delete project keywords" ON keywords
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = keywords.project_id AND projects.user_id = auth.uid())
    );

-- Keyword Rankings: Users can access rankings for their keywords
CREATE POLICY "Users can view keyword rankings" ON keyword_rankings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM keywords
            JOIN projects ON projects.id = keywords.project_id
            WHERE keywords.id = keyword_rankings.keyword_id AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create keyword rankings" ON keyword_rankings
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM keywords
            JOIN projects ON projects.id = keywords.project_id
            WHERE keywords.id = keyword_rankings.keyword_id AND projects.user_id = auth.uid()
        )
    );

-- Competitors: Users can access competitors for their projects
CREATE POLICY "Users can view project competitors" ON competitors
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = competitors.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can create project competitors" ON competitors
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = competitors.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can delete project competitors" ON competitors
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = competitors.project_id AND projects.user_id = auth.uid())
    );

-- Backlinks: Users can access backlinks for their projects
CREATE POLICY "Users can view project backlinks" ON backlinks
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = backlinks.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can create project backlinks" ON backlinks
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = backlinks.project_id AND projects.user_id = auth.uid())
    );

-- Alerts: Users can access alerts for their projects
CREATE POLICY "Users can view project alerts" ON alerts
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = alerts.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can create project alerts" ON alerts
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = alerts.project_id AND projects.user_id = auth.uid())
    );

CREATE POLICY "Users can update project alerts" ON alerts
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM projects WHERE projects.id = alerts.project_id AND projects.user_id = auth.uid())
    );

-- User Settings: Users can only access their own settings
CREATE POLICY "Users can view own settings" ON user_settings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own settings" ON user_settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON user_settings
    FOR UPDATE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MARKETING DATA STORE
-- Generic key-value store for all marketing services (replaces localStorage)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS marketing_store (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    service TEXT NOT NULL,         -- e.g. 'cmo', 'content', 'social', 'paid-media', 'email', 'analytics', 'brand', 'product-marketing'
    key TEXT NOT NULL,             -- e.g. 'campaigns', 'calendar', 'posts', 'settings'
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, project_id, service, key)
);

CREATE INDEX IF NOT EXISTS idx_marketing_store_user ON marketing_store(user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_store_project ON marketing_store(project_id);
CREATE INDEX IF NOT EXISTS idx_marketing_store_service ON marketing_store(service);
CREATE INDEX IF NOT EXISTS idx_marketing_store_lookup ON marketing_store(user_id, service, key);

-- RLS for marketing_store
ALTER TABLE marketing_store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own marketing data" ON marketing_store
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own marketing data" ON marketing_store
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own marketing data" ON marketing_store
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own marketing data" ON marketing_store
    FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MARKETING CAMPAIGNS (cross-department)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('content', 'social', 'paid', 'email', 'cross-channel', 'brand', 'product-launch')),
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'active', 'paused', 'completed', 'archived')),
    channel TEXT,                  -- primary channel
    channels TEXT[],               -- all channels involved
    budget DECIMAL(12, 2),
    spend DECIMAL(12, 2) DEFAULT 0,
    start_date DATE,
    end_date DATE,
    goals JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user ON marketing_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_project ON marketing_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_type ON marketing_campaigns(type);

ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own campaigns" ON marketing_campaigns
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own campaigns" ON marketing_campaigns
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own campaigns" ON marketing_campaigns
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own campaigns" ON marketing_campaigns
    FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONTENT ITEMS (content strategy)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('blog', 'article', 'video', 'social', 'email', 'landing-page', 'whitepaper', 'case-study', 'infographic', 'other')),
    status TEXT DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'in-progress', 'review', 'approved', 'published', 'archived')),
    author TEXT,
    content TEXT,
    brief JSONB DEFAULT '{}',
    seo_data JSONB DEFAULT '{}',    -- target keywords, meta, etc.
    metrics JSONB DEFAULT '{}',     -- views, shares, conversions
    publish_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_user ON content_items(user_id);
CREATE INDEX IF NOT EXISTS idx_content_project ON content_items(project_id);
CREATE INDEX IF NOT EXISTS idx_content_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(type);

ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own content" ON content_items
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own content" ON content_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own content" ON content_items
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own content" ON content_items
    FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Function to update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_keywords_updated_at
    BEFORE UPDATE ON keywords
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_competitors_updated_at
    BEFORE UPDATE ON competitors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE!
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Next steps:
-- 1. Go to Settings > API in your Supabase dashboard
-- 2. Copy the "Project URL" and "anon public" key
-- 3. Add them to web/js/config.js:
--
--    window.APP_CONFIG = {
--        SUPABASE_URL: 'https://your-project.supabase.co',
--        SUPABASE_ANON_KEY: 'your-anon-key-here',
--        ...
--    };
--
-- 4. Users can now sign up and their data will persist across devices!
--
-- ═══════════════════════════════════════════════════════════════════════════════
