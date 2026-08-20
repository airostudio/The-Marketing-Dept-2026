/**
 * Supabase Client Configuration
 * Audema Marketing 2026 - SEO Agent Dashboard
 *
 * This file initializes the Supabase client for authentication and database operations.
 * Configure your Supabase project URL and anon key in the settings page or environment.
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONNECTION STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    const ConnectionState = {
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        CONNECTED: 'connected',
        ERROR: 'error'
    };

    // Supabase Configuration - reactive to localStorage changes
    let supabaseConfig = {
        url: '',
        anonKey: ''
    };

    // Connection state
    let connectionState = ConnectionState.DISCONNECTED;
    let supabaseClient = null;
    let connectionRetryCount = 0;
    let connectionRetryTimeout = null;
    let authStateListener = null;
    let lastConnectionCheck = null;

    // ═══════════════════════════════════════════════════════════════════════════
    // READINESS PROMISE
    // ═══════════════════════════════════════════════════════════════════════════
    // getClient() is synchronous but client creation + the first getSession()
    // round-trip are not — on a fresh page load, anything that calls
    // getClient()/Auth.getUser() before that finishes gets `null`/"signed out"
    // even though persistSession already has a valid session in localStorage.
    // That race, not a real persistence bug, was the "keeps forgetting I'm
    // logged in" symptom across the app. `ready()` lets every caller wait for
    // the first init attempt (success or failure) instead of racing it.
    let initInFlight = null;

    function ready() {
        if (supabaseClient) return Promise.resolve(supabaseClient);
        if (initInFlight) return initInFlight.then(() => supabaseClient).catch(() => supabaseClient);
        return Promise.resolve(supabaseClient);
    }

    const MAX_RETRY_ATTEMPTS = 3;
    const RETRY_DELAY_BASE = 1000; // 1 second
    const CONNECTION_CHECK_INTERVAL = 30000; // 30 seconds

    // Load config from APP_CONFIG first, then localStorage as fallback
    function loadConfig() {
        // Priority: APP_CONFIG > localStorage
        const appConfig = window.APP_CONFIG || {};

        supabaseConfig.url = appConfig.SUPABASE_URL || localStorage.getItem('supabase-url') || '';
        supabaseConfig.anonKey = appConfig.SUPABASE_ANON_KEY || localStorage.getItem('supabase-anon-key') || '';
    }

    // Initial load
    loadConfig();

    // Listen for storage changes (from other tabs/windows)
    window.addEventListener('storage', function(e) {
        if (e.key === 'supabase-url' || e.key === 'supabase-anon-key') {
            const oldUrl = supabaseConfig.url;
            const oldKey = supabaseConfig.anonKey;
            loadConfig();

            // Reinitialize if config changed
            if (oldUrl !== supabaseConfig.url || oldKey !== supabaseConfig.anonKey) {
                console.log('Supabase config changed in another tab, reinitializing...');
                supabaseClient = null;
                initInFlight = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);
            }
        }
    });

    /**
     * Get current connection state
     */
    function getConnectionState() {
        return connectionState;
    }

    /**
     * Set connection state and dispatch event
     */
    function setConnectionState(state, error = null) {
        const oldState = connectionState;
        connectionState = state;

        // Dispatch custom event for UI updates
        window.dispatchEvent(new CustomEvent('supabaseConnectionChange', {
            detail: { state, previousState: oldState, error }
        }));

        // Log state changes
        if (state === ConnectionState.CONNECTED) {
            console.log('Supabase: Connected successfully');
        } else if (state === ConnectionState.ERROR) {
            console.error('Supabase: Connection error -', error);
        }
    }

    /**
     * Initialize the Supabase client with retry logic
     */
    async function initSupabase(url, anonKey, retryAttempt = 0) {
        // Clear any pending retry
        if (connectionRetryTimeout) {
            clearTimeout(connectionRetryTimeout);
            connectionRetryTimeout = null;
        }

        if (!url || !anonKey) {
            console.warn('Supabase not configured. Please set URL and anon key in Settings.');
            setConnectionState(ConnectionState.DISCONNECTED);
            return null;
        }

        setConnectionState(ConnectionState.CONNECTING);

        try {
            // Check if Supabase JS library is loaded
            if (typeof supabase === 'undefined') {
                throw new Error('Supabase JS library not loaded');
            }

            // Create the client
            supabaseClient = supabase.createClient(url, anonKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });

            // Verify connection by getting session
            const { data: sessionData, error } = await supabaseClient.auth.getSession();

            if (error) {
                throw error;
            }

            // If the SDK has no session of its own, adopt one that AuthModal
            // established. See adoptExternalSession() for why this has to
            // live here rather than in auth-modal.js.
            if (!sessionData?.session) {
                await adoptExternalSession();
            }

            // Setup auth state listener
            setupAuthStateListener();

            // Reset retry count on success
            connectionRetryCount = 0;
            setConnectionState(ConnectionState.CONNECTED);
            lastConnectionCheck = Date.now();

            // Start periodic health checks
            startConnectionHealthCheck();

            return supabaseClient;
        } catch (error) {
            console.error('Failed to initialize Supabase:', error);

            // Retry logic
            if (retryAttempt < MAX_RETRY_ATTEMPTS) {
                connectionRetryCount = retryAttempt + 1;
                const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryAttempt);

                console.log(`Supabase: Retrying connection in ${retryDelay}ms (attempt ${connectionRetryCount}/${MAX_RETRY_ATTEMPTS})`);

                connectionRetryTimeout = setTimeout(() => {
                    initSupabase(url, anonKey, connectionRetryCount);
                }, retryDelay);

                return null;
            }

            setConnectionState(ConnectionState.ERROR, error.message);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADOPT AN AUTHMODAL SESSION
    // ═══════════════════════════════════════════════════════════════════════════
    // AuthModal (js/auth-modal.js) signs users in over Supabase's Auth REST
    // API rather than through this SDK client, and stores the resulting
    // tokens in localStorage under its own keys. It tries to hand them to
    // this client on login — but index.html, the main login page, loads ONLY
    // auth-modal.js: no supabase.min.js, no supabase-client.js. So at the
    // moment of login `window.Supabase` doesn't exist and that handoff
    // silently no-ops. The user is genuinely signed in, every AuthModal
    // check agrees, and yet this client — which every Store module and
    // feature page reads auth state from — has no session at all.
    //
    // Doing the adoption here instead means it happens on EVERY page that
    // loads this file (i.e. every feature page), regardless of whether
    // auth-modal.js is present, and regardless of which page login happened
    // on. setSession() persists and auto-refreshes the tokens exactly like a
    // session this client created itself.
    async function adoptExternalSession() {
        let accessToken, refreshToken;
        try {
            accessToken  = localStorage.getItem('access_token');
            refreshToken = localStorage.getItem('refresh_token');
        } catch { return false; }

        // 'local_'-prefixed tokens come from AuthModal's offline/localStorage-only
        // fallback auth — there's no real Supabase session behind them.
        if (!accessToken || !refreshToken || accessToken.indexOf('local_') === 0) return false;

        try {
            const { error } = await supabaseClient.auth.setSession({
                access_token:  accessToken,
                refresh_token: refreshToken,
            });
            if (error) {
                // Expired/invalid tokens: clear them so the app shows a clean
                // signed-out state instead of retrying a dead session forever.
                console.warn('[supabase-client] Could not adopt existing session:', error.message);
                if (/expired|invalid|jwt/i.test(error.message || '')) {
                    try {
                        localStorage.removeItem('access_token');
                        localStorage.removeItem('refresh_token');
                    } catch { /* ignore */ }
                }
                return false;
            }
            console.info('[supabase-client] Adopted existing AuthModal session into the SDK client.');
            return true;
        } catch (e) {
            console.warn('[supabase-client] Session adoption failed:', e.message);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CROSS-ACCOUNT DATA ISOLATION GUARD
    // ═══════════════════════════════════════════════════════════════════════════
    // Business Brain / Intelligence Layer data lives in localStorage keyed by
    // *active profile*, not by Supabase user id — so without this, a second
    // person signing in on the same browser sees whatever business data the
    // previous account left behind (the "Webese data bleeding into a new
    // account" bug). Two layers of defense:
    //   1. SIGNED_OUT clears every local intelligence/profile key immediately.
    //   2. Any session-bearing event compares the signed-in user id against
    //      the last known one and clears defensively on a mismatch — this
    //      catches browsers where a previous account was never explicitly
    //      signed out (tab closed, session simply replaced by a new login).
    const LAST_UID_KEY = 'audema_last_uid';

    // ownerUserId lets clearAll() back the Business Brain up before wiping it,
    // namespaced to that user — without it, a sign-out permanently destroys
    // any brain data that never made it to the cloud (no active profile, or a
    // failing cloud push). Falls back to the last known uid, which is exactly
    // who the data being cleared belongs to.
    function clearLocalIntelligenceState(ownerUserId) {
        let uid = ownerUserId;
        if (!uid) { try { uid = localStorage.getItem(LAST_UID_KEY); } catch { uid = null; } }
        try {
            if (window.IntelligenceEngine?.clearAll) window.IntelligenceEngine.clearAll(true, uid);
        } catch (e) { console.error('[supabase-client] IntelligenceEngine.clearAll failed:', e); }
        try {
            // Not covered by IntelligenceEngine.clearAll() — these are the
            // per-browser "which profile/project is active" pointers that
            // must never survive an account switch either.
            localStorage.removeItem('intel_active_profile');
            localStorage.removeItem('seo-current-project');
        } catch (e) { console.error('[supabase-client] local cache cleanup failed:', e); }
    }

    function guardAccountSwitch(userId) {
        if (!userId) return;
        let lastUid;
        try { lastUid = localStorage.getItem(LAST_UID_KEY); } catch { return; }

        if (lastUid && lastUid !== userId) {
            console.warn('[supabase-client] Different account detected on this browser — clearing local intelligence/profile cache to prevent cross-account data bleed.');
            // Data being cleared belongs to lastUid — back it up under THAT id.
            clearLocalIntelligenceState(lastUid);
        }

        try { localStorage.setItem(LAST_UID_KEY, userId); } catch { /* ignore */ }

        // This user is signing back in — re-hydrate anything their own
        // sign-out backed up. Non-destructive: never overwrites a bucket that
        // already has live data, so a cloud pull or fresh edit always wins.
        try {
            if (window.IntelligenceEngine?.restoreBrainBackup) {
                window.IntelligenceEngine.restoreBrainBackup(userId);
            }
        } catch (e) { console.warn('[supabase-client] Business Brain backup restore failed:', e.message); }
    }

    /**
     * Setup auth state change listener for persistence
     */
    function setupAuthStateListener() {
        if (authStateListener) {
            authStateListener.subscription?.unsubscribe();
        }

        if (!supabaseClient) return;

        const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log('Supabase auth state changed:', event);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('supabaseAuthChange', {
                detail: { event, session, user: session?.user || null }
            }));

            // Handle specific events
            switch (event) {
                case 'INITIAL_SESSION':
                case 'SIGNED_IN':
                case 'TOKEN_REFRESHED':
                    if (event !== 'INITIAL_SESSION') setConnectionState(ConnectionState.CONNECTED);
                    guardAccountSwitch(session?.user?.id || null);
                    break;
                case 'SIGNED_OUT':
                    // Keep connected state, just no user. Clear immediately —
                    // don't wait for the next login to detect the switch, in
                    // case this browser gets handed straight to someone else.
                    clearLocalIntelligenceState();
                    try { localStorage.removeItem(LAST_UID_KEY); } catch { /* ignore */ }
                    break;
                case 'USER_UPDATED':
                    // Refresh user data in UI
                    break;
            }
        });

        authStateListener = data;
    }

    /**
     * Periodic connection health check
     */
    let healthCheckInterval = null;

    function startConnectionHealthCheck() {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
        }

        healthCheckInterval = setInterval(async () => {
            if (connectionState !== ConnectionState.CONNECTED) return;
            if (!supabaseClient) return;

            try {
                const { error } = await supabaseClient.auth.getSession();
                if (error) {
                    throw error;
                }
                lastConnectionCheck = Date.now();
            } catch (error) {
                console.warn('Supabase health check failed:', error);
                setConnectionState(ConnectionState.ERROR, error.message);

                // Try to reconnect
                reconnect();
            }
        }, CONNECTION_CHECK_INTERVAL);
    }

    /**
     * Reconnect to Supabase
     */
    async function reconnect() {
        if (connectionState === ConnectionState.CONNECTING) return;

        console.log('Supabase: Attempting to reconnect...');
        loadConfig(); // Reload config in case it changed
        connectionRetryCount = 0;
        initInFlight = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);
        return initInFlight;
    }

    /**
     * Get the Supabase client instance
     */
    function getClient() {
        if (!supabaseClient && supabaseConfig.url && supabaseConfig.anonKey) {
            initInFlight = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);
        }
        return supabaseClient;
    }

    /**
     * Check if Supabase is configured
     */
    function isConfigured() {
        // Always check localStorage for latest values
        loadConfig();
        return !!(supabaseConfig.url && supabaseConfig.anonKey);
    }

    /**
     * Check if connected
     */
    function isConnected() {
        return connectionState === ConnectionState.CONNECTED && supabaseClient !== null;
    }

    /**
     * Update Supabase configuration
     */
    function setConfig(url, anonKey) {
        supabaseConfig.url = url;
        supabaseConfig.anonKey = anonKey;
        localStorage.setItem('supabase-url', url);
        localStorage.setItem('supabase-anon-key', anonKey);

        // Reinitialize client with new config
        supabaseClient = null;
        connectionRetryCount = 0;
        initInFlight = initSupabase(url, anonKey);
        return initInFlight;
    }

    /**
     * Disconnect and cleanup
     */
    function disconnect() {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
        }

        if (connectionRetryTimeout) {
            clearTimeout(connectionRetryTimeout);
            connectionRetryTimeout = null;
        }

        if (authStateListener) {
            authStateListener.subscription?.unsubscribe();
            authStateListener = null;
        }

        supabaseClient = null;
        setConnectionState(ConnectionState.DISCONNECTED);
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
            await ready();
            const client = getClient();
            if (!client) return null;

            const { data: { user } } = await client.auth.getUser();
            return user;
        },

        /**
         * Get the current session
         */
        async getSession() {
            await ready();
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
        // Core functions
        init: initSupabase,
        getClient,
        ready,
        isConfigured,
        setConfig,
        disconnect,
        reconnect,

        // Connection state
        isConnected,
        getConnectionState,
        ConnectionState,

        // Services
        Auth,
        DB,
        Realtime,
        Storage
    };

    // Auto-initialize if configured
    function autoInit() {
        loadConfig();
        if (supabaseConfig.url && supabaseConfig.anonKey) {
            // Check if Supabase library is available
            if (typeof supabase !== 'undefined') {
                initInFlight = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);
            } else {
                // Wait for library to load. ready() needs a promise to await
                // here too, or every caller on a slow-loading page races this
                // polling loop the same way they used to race initSupabase()
                // itself.
                console.log('Supabase: Waiting for library to load...');
                let attempts = 0;
                initInFlight = new Promise((resolve) => {
                    const checkLibrary = setInterval(() => {
                        attempts++;
                        if (typeof supabase !== 'undefined') {
                            clearInterval(checkLibrary);
                            initSupabase(supabaseConfig.url, supabaseConfig.anonKey).then(resolve);
                        } else if (attempts > 50) { // 5 seconds max
                            clearInterval(checkLibrary);
                            console.error('Supabase: Library failed to load after 5 seconds');
                            resolve(null);
                        }
                    }, 100);
                });
            }
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        // Small delay to ensure other scripts are loaded
        setTimeout(autoInit, 50);
    }

})();
