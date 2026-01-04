/**
 * Supabase Client Configuration
 * The Marketing Department 2026 - SEO Agent Dashboard
 *
 * This file initializes the Supabase client for authentication and database operations.
 * Configure your Supabase project URL and anon key in the settings page or environment.
 */

(function() {
    'use strict';

    // Supabase Configuration
    // These can be set via the Settings page or hardcoded for production
    const SUPABASE_CONFIG = {
        url: localStorage.getItem('supabase-url') || '',
        anonKey: localStorage.getItem('supabase-anon-key') || ''
    };

    // Supabase Client Instance
    let supabaseClient = null;

    /**
     * Initialize the Supabase client
     */
    function initSupabase(url, anonKey) {
        if (!url || !anonKey) {
            console.warn('Supabase not configured. Please set URL and anon key in Settings.');
            return null;
        }

        try {
            // Check if Supabase JS library is loaded
            if (typeof supabase === 'undefined') {
                console.error('Supabase JS library not loaded. Add the CDN script to your HTML.');
                return null;
            }

            supabaseClient = supabase.createClient(url, anonKey);
            console.log('Supabase client initialized successfully');
            return supabaseClient;
        } catch (error) {
            console.error('Failed to initialize Supabase:', error);
            return null;
        }
    }

    /**
     * Get the Supabase client instance
     */
    function getClient() {
        if (!supabaseClient && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
            return initSupabase(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
        }
        return supabaseClient;
    }

    /**
     * Check if Supabase is configured
     */
    function isConfigured() {
        return !!(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
    }

    /**
     * Update Supabase configuration
     */
    function setConfig(url, anonKey) {
        SUPABASE_CONFIG.url = url;
        SUPABASE_CONFIG.anonKey = anonKey;
        localStorage.setItem('supabase-url', url);
        localStorage.setItem('supabase-anon-key', anonKey);

        // Reinitialize client with new config
        supabaseClient = null;
        return initSupabase(url, anonKey);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTHENTICATION SERVICE
    // ═══════════════════════════════════════════════════════════════════════════

    const Auth = {
        /**
         * Sign up a new user
         */
        async signUp(email, password, metadata = {}) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: {
                    data: metadata
                }
            });

            if (error) throw error;
            return data;
        },

        /**
         * Sign in with email and password
         */
        async signIn(email, password) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;
            return data;
        },

        /**
         * Sign in with OAuth provider
         */
        async signInWithOAuth(provider) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: window.location.origin + '/dashboard.html'
                }
            });

            if (error) throw error;
            return data;
        },

        /**
         * Sign out the current user
         */
        async signOut() {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { error } = await client.auth.signOut();
            if (error) throw error;
        },

        /**
         * Get the current user
         */
        async getUser() {
            const client = getClient();
            if (!client) return null;

            const { data: { user } } = await client.auth.getUser();
            return user;
        },

        /**
         * Get the current session
         */
        async getSession() {
            const client = getClient();
            if (!client) return null;

            const { data: { session } } = await client.auth.getSession();
            return session;
        },

        /**
         * Reset password
         */
        async resetPassword(email) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/reset-password.html'
            });

            if (error) throw error;
            return data;
        },

        /**
         * Update user password
         */
        async updatePassword(newPassword) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;
            return data;
        },

        /**
         * Update user metadata
         */
        async updateProfile(metadata) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.auth.updateUser({
                data: metadata
            });

            if (error) throw error;
            return data;
        },

        /**
         * Listen to auth state changes
         */
        onAuthStateChange(callback) {
            const client = getClient();
            if (!client) return null;

            return client.auth.onAuthStateChange((event, session) => {
                callback(event, session);
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DATABASE SERVICE
    // ═══════════════════════════════════════════════════════════════════════════

    const DB = {
        // ─────────────────────────────────────────────────────────────────────────
        // USER PROFILES
        // ─────────────────────────────────────────────────────────────────────────

        async getProfile(userId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        },

        async updateProfile(userId, updates) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('profiles')
                .upsert({ id: userId, ...updates, updated_at: new Date().toISOString() })
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // PROJECTS
        // ─────────────────────────────────────────────────────────────────────────

        async getProjects(userId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('projects')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },

        async getProject(projectId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('projects')
                .select('*')
                .eq('id', projectId)
                .single();

            if (error) throw error;
            return data;
        },

        async createProject(project) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('projects')
                .insert(project)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async updateProject(projectId, updates) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('projects')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', projectId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async deleteProject(projectId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { error } = await client
                .from('projects')
                .delete()
                .eq('id', projectId);

            if (error) throw error;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // AUDITS
        // ─────────────────────────────────────────────────────────────────────────

        async getAudits(projectId, limit = 20) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('audits')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data;
        },

        async getAudit(auditId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('audits')
                .select('*, audit_issues(*)')
                .eq('id', auditId)
                .single();

            if (error) throw error;
            return data;
        },

        async createAudit(audit) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('audits')
                .insert(audit)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async saveAuditIssues(auditId, issues) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const issuesWithAuditId = issues.map(issue => ({
                ...issue,
                audit_id: auditId
            }));

            const { data, error } = await client
                .from('audit_issues')
                .insert(issuesWithAuditId)
                .select();

            if (error) throw error;
            return data;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // KEYWORDS
        // ─────────────────────────────────────────────────────────────────────────

        async getKeywords(projectId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('keywords')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },

        async addKeywords(projectId, keywords) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const keywordsWithProject = keywords.map(kw => ({
                project_id: projectId,
                keyword: typeof kw === 'string' ? kw : kw.keyword,
                ...( typeof kw === 'object' ? kw : {})
            }));

            const { data, error } = await client
                .from('keywords')
                .insert(keywordsWithProject)
                .select();

            if (error) throw error;
            return data;
        },

        async updateKeyword(keywordId, updates) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('keywords')
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq('id', keywordId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async deleteKeyword(keywordId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { error } = await client
                .from('keywords')
                .delete()
                .eq('id', keywordId);

            if (error) throw error;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // KEYWORD RANKINGS
        // ─────────────────────────────────────────────────────────────────────────

        async getKeywordRankings(keywordId, days = 30) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const { data, error } = await client
                .from('keyword_rankings')
                .select('*')
                .eq('keyword_id', keywordId)
                .gte('recorded_at', startDate.toISOString())
                .order('recorded_at', { ascending: true });

            if (error) throw error;
            return data;
        },

        async saveKeywordRanking(ranking) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('keyword_rankings')
                .insert(ranking)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // COMPETITORS
        // ─────────────────────────────────────────────────────────────────────────

        async getCompetitors(projectId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('competitors')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },

        async addCompetitor(competitor) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('competitors')
                .insert(competitor)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async deleteCompetitor(competitorId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { error } = await client
                .from('competitors')
                .delete()
                .eq('id', competitorId);

            if (error) throw error;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // BACKLINKS
        // ─────────────────────────────────────────────────────────────────────────

        async getBacklinks(projectId, limit = 100) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('backlinks')
                .select('*')
                .eq('project_id', projectId)
                .order('discovered_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data;
        },

        async addBacklinks(backlinks) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('backlinks')
                .upsert(backlinks, { onConflict: 'source_url,target_url' })
                .select();

            if (error) throw error;
            return data;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // ALERTS
        // ─────────────────────────────────────────────────────────────────────────

        async getAlerts(projectId, unreadOnly = false) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            let query = client
                .from('alerts')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false });

            if (unreadOnly) {
                query = query.eq('read', false);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data;
        },

        async createAlert(alert) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('alerts')
                .insert(alert)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async markAlertRead(alertId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('alerts')
                .update({ read: true, read_at: new Date().toISOString() })
                .eq('id', alertId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async markAllAlertsRead(projectId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { error } = await client
                .from('alerts')
                .update({ read: true, read_at: new Date().toISOString() })
                .eq('project_id', projectId)
                .eq('read', false);

            if (error) throw error;
        },

        // ─────────────────────────────────────────────────────────────────────────
        // SETTINGS
        // ─────────────────────────────────────────────────────────────────────────

        async getSettings(userId) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('user_settings')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        },

        async saveSettings(userId, settings) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client
                .from('user_settings')
                .upsert({
                    user_id: userId,
                    settings,
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // REALTIME SUBSCRIPTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const Realtime = {
        /**
         * Subscribe to project changes
         */
        subscribeToProject(projectId, callback) {
            const client = getClient();
            if (!client) return null;

            return client
                .channel(`project:${projectId}`)
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
                    callback
                )
                .subscribe();
        },

        /**
         * Subscribe to new alerts
         */
        subscribeToAlerts(projectId, callback) {
            const client = getClient();
            if (!client) return null;

            return client
                .channel(`alerts:${projectId}`)
                .on('postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'alerts', filter: `project_id=eq.${projectId}` },
                    callback
                )
                .subscribe();
        },

        /**
         * Subscribe to audit completions
         */
        subscribeToAudits(projectId, callback) {
            const client = getClient();
            if (!client) return null;

            return client
                .channel(`audits:${projectId}`)
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'audits', filter: `project_id=eq.${projectId}` },
                    callback
                )
                .subscribe();
        },

        /**
         * Unsubscribe from a channel
         */
        unsubscribe(channel) {
            const client = getClient();
            if (!client || !channel) return;

            client.removeChannel(channel);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STORAGE SERVICE (for file uploads)
    // ═══════════════════════════════════════════════════════════════════════════

    const Storage = {
        /**
         * Upload a file
         */
        async uploadFile(bucket, path, file) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { data, error } = await client.storage
                .from(bucket)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (error) throw error;
            return data;
        },

        /**
         * Get public URL for a file
         */
        getPublicUrl(bucket, path) {
            const client = getClient();
            if (!client) return null;

            const { data } = client.storage
                .from(bucket)
                .getPublicUrl(path);

            return data.publicUrl;
        },

        /**
         * Delete a file
         */
        async deleteFile(bucket, path) {
            const client = getClient();
            if (!client) throw new Error('Supabase not configured');

            const { error } = await client.storage
                .from(bucket)
                .remove([path]);

            if (error) throw error;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT API
    // ═══════════════════════════════════════════════════════════════════════════

    window.Supabase = {
        init: initSupabase,
        getClient,
        isConfigured,
        setConfig,
        Auth,
        DB,
        Realtime,
        Storage
    };

    // Auto-initialize if configured
    if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
        // Wait for Supabase library to load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => initSupabase(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey), 100);
            });
        } else {
            setTimeout(() => initSupabase(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey), 100);
        }
    }

})();
