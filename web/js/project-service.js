/**
 * Project Service - Supabase-backed Project Management
 * Audema Marketing 2026
 *
 * Handles persistent project storage using Supabase with localStorage fallback.
 * Projects are stored in the user's account and sync across devices.
 */

(function() {
    'use strict';

    // Storage keys
    const STORAGE_KEYS = {
        PROJECTS: 'seo-projects',
        CURRENT_PROJECT: 'seo-current-project',
        LAST_SYNC: 'seo-projects-last-sync'
    };

    // Supabase client (initialized lazily)
    let supabaseClient = null;

    /**
     * Get or initialize Supabase client.
     * Prefers the centralized client from supabase-client.js (window.Supabase)
     * so the auth session is shared across the entire app.
     */
    async function getSupabase() {
        // Wait for the centralized client's initial session check to finish
        // before deciding anything — otherwise a page that queries auth state
        // right on load can catch it mid-init and wrongly conclude "signed out"
        // even though a valid session is sitting in localStorage.
        if (window.Supabase?.ready) { try { await window.Supabase.ready(); } catch { /* fall through */ } }

        // 1) Use centralized client from supabase-client.js if available
        if (window.Supabase?.getClient) {
            const centralClient = window.Supabase.getClient();
            if (centralClient) {
                supabaseClient = centralClient;
                return supabaseClient;
            }
        }

        // 2) Reuse previously created client
        if (supabaseClient) return supabaseClient;

        // 3) Create own client as last resort (with proper auth options)
        const url = window.APP_CONFIG?.SUPABASE_URL;
        const key = window.APP_CONFIG?.SUPABASE_ANON_KEY;

        if (url && key && typeof supabase !== 'undefined') {
            supabaseClient = supabase.createClient(url, key, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
            return supabaseClient;
        }

        return null;
    }

    /**
     * Check if user is authenticated with Supabase
     */
    async function isAuthenticated() {
        return !!(await getCurrentUserId());
    }

    /**
     * Get current user ID
     */
    async function getCurrentUserId() {
        const client = await getSupabase();
        if (!client) return null;

        // Same getUser()-with-getSession()-fallback used by every store:
        // auth.getUser() re-verifies against the auth server and can fail
        // transiently even with a valid session. A false negative here means
        // _initWithAuth() never runs, so syncLocalProjectsToSupabase() never
        // upgrades a 'local_' project to a real row — leaving every scoped
        // write poisoned with a non-UUID id.
        try {
            const { data: { user }, error } = await client.auth.getUser();
            if (user) return user.id;
            if (error) throw error;
        } catch (e) {
            console.warn('[ProjectService] auth.getUser() failed, falling back to cached session:', e.message);
        }
        try {
            const { data: { session } } = await client.auth.getSession();
            return session?.user?.id || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * PROJECT CRUD OPERATIONS
     * ═══════════════════════════════════════════════════════════════════════════
     */

    /**
     * Get all projects for the current user
     */
    async function getProjects() {
        const client = await getSupabase();
        const isAuth = await isAuthenticated();

        if (client && isAuth) {
            try {
                const { data, error } = await client
                    .from('projects')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (error) throw error;

                // Format projects to match frontend expectations
                const projects = (data || []).map(formatProjectFromDB);

                // Sync to localStorage for offline access
                localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
                localStorage.setItem(STORAGE_KEYS.LAST_SYNC, Date.now().toString());

                return projects;
            } catch (e) {
                console.error('[ProjectService] Failed to fetch projects:', e);
                // Fall back to localStorage
                return getProjectsFromLocalStorage();
            }
        }

        return getProjectsFromLocalStorage();
    }

    /**
     * Get projects from localStorage (fallback)
     */
    function getProjectsFromLocalStorage() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS) || '[]');
        } catch (e) {
            return [];
        }
    }

    /**
     * Get a single project by ID
     */
    async function getProject(projectId) {
        const client = await getSupabase();
        const isAuth = await isAuthenticated();

        if (client && isAuth) {
            try {
                const { data, error } = await client
                    .from('projects')
                    .select('*')
                    .eq('id', projectId)
                    .single();

                if (error) throw error;
                return formatProjectFromDB(data);
            } catch (e) {
                console.error('[ProjectService] Failed to fetch project:', e);
            }
        }

        // Fall back to localStorage
        const projects = getProjectsFromLocalStorage();
        return projects.find(p => p.id === projectId) || null;
    }

    /**
     * Create a new project
     *
     * Persistence priority:
     *   1. Audema Express backend at /api/projects (requires a real JWT)
     *   2. Supabase (if configured and authenticated)
     *   3. localStorage (offline / demo fallback)
     */
    async function createProject(projectData) {
        const client = await getSupabase();
        const userId = await getCurrentUserId();

        // 1. Try the Express backend first — that's where the schema lives now.
        if (window.apiClient && window.apiClient.accessToken &&
            !String(window.apiClient.accessToken).startsWith('local_')) {
            try {
                const saved = await window.apiClient.post('/projects', projectData);
                const projects = getProjectsFromLocalStorage();
                projects.unshift(saved);
                localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
                console.log('[ProjectService] Project created via backend:', saved.id);
                return saved;
            } catch (e) {
                if (!e.isApiUnavailable) {
                    console.error('[ProjectService] Backend create failed:', e);
                }
                // Fall through to Supabase / localStorage.
            }
        }

        // Generate a local ID for localStorage fallback
        const localId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        const project = {
            id: localId,
            name: projectData.name || projectData.projectName || 'Untitled Project',
            websiteUrl: projectData.websiteUrl || projectData.url || '',
            description: projectData.description || '',
            industry: projectData.industry || '',
            competitors: projectData.competitors || [],
            keywords: projectData.keywords || [],
            settings: projectData.settings || {},
            healthScore: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (client && userId) {
            try {
                const { data, error } = await client
                    .from('projects')
                    .insert({
                        user_id: userId,
                        name: project.name,
                        url: project.websiteUrl,
                        description: project.description,
                        industry: project.industry,
                        settings: {
                            competitors: project.competitors,
                            keywords: project.keywords,
                            ...project.settings
                        },
                        status: 'active'
                    })
                    .select()
                    .single();

                if (error) throw error;

                const savedProject = formatProjectFromDB(data);

                // Update localStorage
                const projects = getProjectsFromLocalStorage();
                projects.unshift(savedProject);
                localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));

                console.log('[ProjectService] Project created in Supabase:', savedProject.id);
                return savedProject;
            } catch (e) {
                console.error('[ProjectService] Failed to create project in Supabase:', e);
                // Fall through to localStorage
            }
        }

        // Save to localStorage (fallback or only option)
        const projects = getProjectsFromLocalStorage();
        projects.unshift(project);
        localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));

        console.log('[ProjectService] Project created in localStorage:', project.id);
        return project;
    }

    /**
     * Update an existing project
     */
    async function updateProject(projectId, updates) {
        const client = await getSupabase();
        const isAuth = await isAuthenticated();

        if (client && isAuth && !projectId.startsWith('local_')) {
            try {
                const dbUpdates = {};

                if (updates.name !== undefined) dbUpdates.name = updates.name;
                if (updates.websiteUrl !== undefined) dbUpdates.url = updates.websiteUrl;
                if (updates.description !== undefined) dbUpdates.description = updates.description;
                if (updates.industry !== undefined) dbUpdates.industry = updates.industry;
                if (updates.healthScore !== undefined) dbUpdates.health_score = updates.healthScore;
                if (updates.settings !== undefined) dbUpdates.settings = updates.settings;
                if (updates.status !== undefined) dbUpdates.status = updates.status;

                const { data, error } = await client
                    .from('projects')
                    .update(dbUpdates)
                    .eq('id', projectId)
                    .select()
                    .single();

                if (error) throw error;

                const updatedProject = formatProjectFromDB(data);

                // Update localStorage
                const projects = getProjectsFromLocalStorage();
                const index = projects.findIndex(p => p.id === projectId);
                if (index >= 0) {
                    projects[index] = updatedProject;
                    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
                }

                return updatedProject;
            } catch (e) {
                console.error('[ProjectService] Failed to update project:', e);
            }
        }

        // Update in localStorage
        const projects = getProjectsFromLocalStorage();
        const index = projects.findIndex(p => p.id === projectId);

        if (index >= 0) {
            projects[index] = {
                ...projects[index],
                ...updates,
                updatedAt: new Date().toISOString()
            };
            localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
            return projects[index];
        }

        return null;
    }

    /**
     * Delete a project
     */
    async function deleteProject(projectId) {
        const client = await getSupabase();
        const isAuth = await isAuthenticated();

        if (client && isAuth && !projectId.startsWith('local_')) {
            try {
                const { error } = await client
                    .from('projects')
                    .delete()
                    .eq('id', projectId);

                if (error) throw error;
            } catch (e) {
                console.error('[ProjectService] Failed to delete project:', e);
            }
        }

        // Remove from localStorage
        const projects = getProjectsFromLocalStorage();
        const filtered = projects.filter(p => p.id !== projectId);
        localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(filtered));

        // Clear current project if it was deleted
        if (localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT) === projectId) {
            localStorage.removeItem(STORAGE_KEYS.CURRENT_PROJECT);
        }

        return true;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * CURRENT PROJECT MANAGEMENT
     * ═══════════════════════════════════════════════════════════════════════════
     */

    /**
     * Get the current active project
     */
    async function getCurrentProject() {
        const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT);

        if (!currentId) {
            // Try to get the first project
            const projects = await getProjects();
            if (projects.length > 0) {
                await setCurrentProject(projects[0].id);
                return projects[0];
            }
            return null;
        }

        return await getProject(currentId);
    }

    /**
     * Get current project synchronously (from localStorage cache)
     */
    function getCurrentProjectSync() {
        const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT);
        if (!currentId) return null;

        const projects = getProjectsFromLocalStorage();
        return projects.find(p => p.id === currentId) || null;
    }

    /**
     * Set the current active project
     */
    async function setCurrentProject(projectId) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_PROJECT, projectId);

        // Also save to user settings in Supabase
        const client = await getSupabase();
        const userId = await getCurrentUserId();

        if (client && userId) {
            try {
                await client
                    .from('user_settings')
                    .upsert({
                        user_id: userId,
                        settings: {
                            currentProjectId: projectId
                        }
                    }, {
                        onConflict: 'user_id'
                    });
            } catch (e) {
                console.warn('[ProjectService] Failed to save current project to Supabase:', e);
            }
        }

        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('projectChanged', {
            detail: { projectId }
        }));

        return true;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * SYNC & MIGRATION
     * ═══════════════════════════════════════════════════════════════════════════
     */

    /**
     * Sync local projects to Supabase (for migrating existing data)
     */
    async function syncLocalProjectsToSupabase() {
        const client = await getSupabase();
        const userId = await getCurrentUserId();

        if (!client || !userId) {
            console.log('[ProjectService] Cannot sync - not authenticated');
            return false;
        }

        const localProjects = getProjectsFromLocalStorage();
        const localOnly = localProjects.filter(p => p.id.startsWith('local_'));

        if (localOnly.length === 0) {
            console.log('[ProjectService] No local projects to sync');
            return true;
        }

        console.log(`[ProjectService] Syncing ${localOnly.length} local projects to Supabase`);

        for (const project of localOnly) {
            try {
                const { data, error } = await client
                    .from('projects')
                    .insert({
                        user_id: userId,
                        name: project.name,
                        url: project.websiteUrl,
                        description: project.description || '',
                        industry: project.industry || '',
                        settings: {
                            competitors: project.competitors || [],
                            keywords: project.keywords || [],
                            ...project.settings
                        },
                        health_score: project.healthScore || 0,
                        status: 'active'
                    })
                    .select()
                    .single();

                if (error) throw error;

                // Update localStorage with new ID
                const updatedProject = formatProjectFromDB(data);
                const projects = getProjectsFromLocalStorage();
                const index = projects.findIndex(p => p.id === project.id);

                if (index >= 0) {
                    // Update current project reference if needed
                    if (localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT) === project.id) {
                        localStorage.setItem(STORAGE_KEYS.CURRENT_PROJECT, updatedProject.id);
                    }

                    projects[index] = updatedProject;
                    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
                }

                console.log(`[ProjectService] Synced project: ${project.name} -> ${updatedProject.id}`);
            } catch (e) {
                console.error(`[ProjectService] Failed to sync project ${project.name}:`, e);
            }
        }

        return true;
    }

    /**
     * Load user's current project from Supabase settings
     */
    async function loadUserSettings() {
        const client = await getSupabase();
        const userId = await getCurrentUserId();

        if (!client || !userId) return;

        try {
            const { data } = await client
                .from('user_settings')
                .select('settings')
                .eq('user_id', userId)
                .single();

            if (data?.settings?.currentProjectId) {
                localStorage.setItem(STORAGE_KEYS.CURRENT_PROJECT, data.settings.currentProjectId);
            }
        } catch (e) {
            // Settings might not exist yet
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * HELPERS
     * ═══════════════════════════════════════════════════════════════════════════
     */

    /**
     * Format project from database row to frontend object
     */
    function formatProjectFromDB(row) {
        const settings = row.settings || {};

        return {
            id: row.id,
            name: row.name,
            websiteUrl: row.url,
            description: row.description || '',
            industry: row.industry || '',
            competitors: settings.competitors || [],
            keywords: settings.keywords || [],
            settings: settings,
            healthScore: row.health_score || 0,
            status: row.status || 'active',
            lastAuditAt: row.last_audit_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    /** Track whether we've already initialized with auth */
    let _initializedWithAuth = false;

    /**
     * Run the authenticated initialization flow
     */
    async function _initWithAuth() {
        if (_initializedWithAuth) return;
        _initializedWithAuth = true;

        console.log('[ProjectService] User authenticated, loading from Supabase');

        // Load user settings (including current project preference)
        await loadUserSettings();

        // Sync any local-only projects to Supabase
        await syncLocalProjectsToSupabase();

        // Load fresh projects from Supabase
        await getProjects();

        window.dispatchEvent(new CustomEvent('projectsLoaded'));
    }

    /**
     * Initialize service - call on page load
     */
    async function init() {
        console.log('[ProjectService] Initializing...');

        // Check if user is authenticated
        if (await isAuthenticated()) {
            await _initWithAuth();
        } else {
            console.log('[ProjectService] User not authenticated, using localStorage');
        }

        // Listen for auth state changes from the centralized Supabase client
        const client = await getSupabase();
        if (client) {
            client.auth.onAuthStateChange(async (event, session) => {
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    console.log('[ProjectService] Auth event:', event, '- syncing projects');
                    await _initWithAuth();
                } else if (event === 'SIGNED_OUT') {
                    console.log('[ProjectService] User signed out');
                    _initializedWithAuth = false;
                    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC);
                }
            });
        }

        // Also listen for the centralized Supabase connection event
        // (handles case where supabase-client.js finishes init after project-service.js)
        window.addEventListener('supabaseAuthChange', async function handler(e) {
            if (e.detail?.event === 'SIGNED_IN' || e.detail?.event === 'INITIAL_SESSION') {
                if (e.detail?.session?.user && !_initializedWithAuth) {
                    console.log('[ProjectService] Received supabaseAuthChange, re-initializing with auth');
                    // Re-obtain client (centralized client may now be available)
                    supabaseClient = null;
                    await _initWithAuth();
                }
            }
        });

        // If we got no client at all, wait for supabase-client.js to become available
        if (!client) {
            window.addEventListener('supabaseConnectionChange', async function handler(e) {
                if (e.detail?.state === 'connected' && !_initializedWithAuth) {
                    console.log('[ProjectService] Supabase connected late, checking auth');
                    supabaseClient = null; // Force re-fetch of centralized client
                    if (await isAuthenticated()) {
                        await _initWithAuth();
                    }
                }
            });
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * PUBLIC API
     * ═══════════════════════════════════════════════════════════════════════════
     */

    window.ProjectService = {
        // Initialization
        init,

        // CRUD operations
        getProjects,
        getProject,
        createProject,
        updateProject,
        deleteProject,

        // Current project
        getCurrentProject,
        getCurrentProjectSync,
        setCurrentProject,

        // Sync
        syncLocalProjectsToSupabase,

        // Utilities
        isAuthenticated,
        getProjectsFromLocalStorage
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
