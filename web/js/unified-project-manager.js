/**
 * Unified Project Manager
 * Extends ProjectService with enhanced state tracking and cross-tool project management
 *
 * Features:
 * - Project lifecycle states (created, in_progress, paused, completed, archived)
 * - Progress tracking and completion percentages
 * - Auto-save and resume functionality
 * - Cross-tool project sharing (SEO, Content Writer, Social Media, etc.)
 * - Activity history and audit trail
 */

(function() {
    'use strict';

    // Project state constants
    const PROJECT_STATES = {
        CREATED: 'created',           // Just created, not started
        IN_PROGRESS: 'in_progress',   // Actively being worked on
        PAUSED: 'paused',             // Work paused, can be resumed
        COMPLETED: 'completed',       // Work finished
        ARCHIVED: 'archived'          // Archived for reference
    };

    // Project types
    const PROJECT_TYPES = {
        SEO: 'seo',
        CONTENT: 'content',
        SOCIAL_MEDIA: 'social_media',
        EMAIL: 'email',
        PAID_MEDIA: 'paid_media',
        BRAND: 'brand',
        ANALYTICS: 'analytics'
    };

    // Storage keys
    const STORAGE_KEYS = {
        PROJECTS: 'unified-projects',
        CURRENT_PROJECT: 'unified-current-project',
        PROJECT_HISTORY: 'unified-project-history'
    };

    /**
     * Enhanced project structure
     * Extends base project with state tracking
     */
    class UnifiedProject {
        constructor(data = {}) {
            // Core identification
            this.id = data.id || this.generateId();
            this.name = data.name || 'Untitled Project';
            this.type = data.type || PROJECT_TYPES.CONTENT;

            // State management
            this.state = data.state || PROJECT_STATES.CREATED;
            this.progress = data.progress || 0; // 0-100

            // Metadata
            this.description = data.description || '';
            this.tags = data.tags || [];
            this.color = data.color || this.getDefaultColor();

            // Timestamps
            this.createdAt = data.createdAt || new Date().toISOString();
            this.updatedAt = data.updatedAt || new Date().toISOString();
            this.startedAt = data.startedAt || null;
            this.pausedAt = data.pausedAt || null;
            this.completedAt = data.completedAt || null;
            this.lastAccessedAt = data.lastAccessedAt || new Date().toISOString();

            // Project data (tool-specific)
            this.data = data.data || {};

            // Activity history
            this.activities = data.activities || [];

            // Settings and preferences
            this.settings = data.settings || {};

            // User reference
            this.userId = data.userId || null;
        }

        generateId() {
            return `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        getDefaultColor() {
            const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#14B8A6'];
            return colors[Math.floor(Math.random() * colors.length)];
        }

        /**
         * Start working on the project
         */
        start() {
            if (this.state === PROJECT_STATES.CREATED || this.state === PROJECT_STATES.PAUSED) {
                this.state = PROJECT_STATES.IN_PROGRESS;
                if (!this.startedAt) {
                    this.startedAt = new Date().toISOString();
                }
                this.pausedAt = null;
                this.addActivity('started', 'Project work started');
                this.touch();
            }
        }

        /**
         * Pause the project
         */
        pause() {
            if (this.state === PROJECT_STATES.IN_PROGRESS) {
                this.state = PROJECT_STATES.PAUSED;
                this.pausedAt = new Date().toISOString();
                this.addActivity('paused', 'Project work paused');
                this.touch();
            }
        }

        /**
         * Resume paused project
         */
        resume() {
            if (this.state === PROJECT_STATES.PAUSED) {
                this.state = PROJECT_STATES.IN_PROGRESS;
                this.pausedAt = null;
                this.addActivity('resumed', 'Project work resumed');
                this.touch();
            }
        }

        /**
         * Mark project as completed
         */
        complete() {
            this.state = PROJECT_STATES.COMPLETED;
            this.progress = 100;
            this.completedAt = new Date().toISOString();
            this.addActivity('completed', 'Project completed');
            this.touch();
        }

        /**
         * Restart a completed project
         */
        restart() {
            if (this.state === PROJECT_STATES.COMPLETED) {
                this.state = PROJECT_STATES.IN_PROGRESS;
                this.progress = 0;
                this.completedAt = null;
                this.startedAt = new Date().toISOString();
                this.addActivity('restarted', 'Project restarted');
                this.touch();
            }
        }

        /**
         * Archive the project
         */
        archive() {
            this.state = PROJECT_STATES.ARCHIVED;
            this.addActivity('archived', 'Project archived');
            this.touch();
        }

        /**
         * Update progress (0-100)
         */
        updateProgress(progress) {
            this.progress = Math.max(0, Math.min(100, progress));

            // Auto-complete if 100%
            if (this.progress === 100 && this.state !== PROJECT_STATES.COMPLETED) {
                this.complete();
            }

            this.touch();
        }

        /**
         * Update project data (tool-specific)
         */
        updateData(updates) {
            this.data = {
                ...this.data,
                ...updates
            };
            this.touch();
        }

        /**
         * Add activity to history
         */
        addActivity(action, description, metadata = {}) {
            this.activities.unshift({
                id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                action,
                description,
                metadata,
                timestamp: new Date().toISOString()
            });

            // Keep only last 100 activities
            if (this.activities.length > 100) {
                this.activities = this.activities.slice(0, 100);
            }
        }

        /**
         * Update last accessed timestamp
         */
        touch() {
            this.lastAccessedAt = new Date().toISOString();
            this.updatedAt = new Date().toISOString();
        }

        /**
         * Get time spent on project (in milliseconds)
         */
        getTimeSpent() {
            // Simple calculation: time between started and now/completed/paused
            if (!this.startedAt) return 0;

            const start = new Date(this.startedAt).getTime();
            let end;

            if (this.completedAt) {
                end = new Date(this.completedAt).getTime();
            } else if (this.pausedAt) {
                end = new Date(this.pausedAt).getTime();
            } else if (this.state === PROJECT_STATES.IN_PROGRESS) {
                end = Date.now();
            } else {
                return 0;
            }

            return Math.max(0, end - start);
        }

        /**
         * Serialize to JSON
         */
        toJSON() {
            return {
                id: this.id,
                name: this.name,
                type: this.type,
                state: this.state,
                progress: this.progress,
                description: this.description,
                tags: this.tags,
                color: this.color,
                createdAt: this.createdAt,
                updatedAt: this.updatedAt,
                startedAt: this.startedAt,
                pausedAt: this.pausedAt,
                completedAt: this.completedAt,
                lastAccessedAt: this.lastAccessedAt,
                data: this.data,
                activities: this.activities,
                settings: this.settings,
                userId: this.userId
            };
        }
    }

    /**
     * Unified Project Manager Service
     */
    const UnifiedProjectManager = {
        /**
         * Initialize the service
         */
        async init() {
            console.log('[UnifiedProjectManager] Initializing...');

            // Load projects from storage
            await this.loadProjects();

            // Set up auto-save
            this.setupAutoSave();

            // Listen for auth changes
            window.addEventListener('supabaseAuthChange', async (e) => {
                if (e.detail?.event === 'SIGNED_IN') {
                    await this.syncProjects();
                }
            });

            console.log('[UnifiedProjectManager] Initialized');
        },

        /**
         * Load all projects from storage
         */
        async loadProjects() {
            try {
                const stored = localStorage.getItem(STORAGE_KEYS.PROJECTS);
                if (stored) {
                    const projectsData = JSON.parse(stored);
                    this.projects = projectsData.map(data => new UnifiedProject(data));
                } else {
                    this.projects = [];
                }
            } catch (error) {
                console.error('[UnifiedProjectManager] Failed to load projects:', error);
                this.projects = [];
            }
        },

        /**
         * Save all projects to storage
         */
        saveProjects() {
            try {
                const projectsData = this.projects.map(p => p.toJSON());
                localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projectsData));
                return true;
            } catch (error) {
                console.error('[UnifiedProjectManager] Failed to save projects:', error);
                return false;
            }
        },

        /**
         * Create a new project
         */
        async createProject(projectData) {
            const project = new UnifiedProject(projectData);

            // Add to projects list
            this.projects.unshift(project);

            // Save to storage
            this.saveProjects();

            // Set as current project
            this.setCurrentProject(project.id);

            console.log('[UnifiedProjectManager] Project created:', project.id);

            // Dispatch event
            window.dispatchEvent(new CustomEvent('projectCreated', {
                detail: { project: project.toJSON() }
            }));

            return project;
        },

        /**
         * Get a project by ID
         */
        getProject(projectId) {
            return this.projects.find(p => p.id === projectId) || null;
        },

        /**
         * Get all projects
         */
        getAllProjects(filters = {}) {
            let projects = [...this.projects];

            // Filter by state
            if (filters.state) {
                projects = projects.filter(p => p.state === filters.state);
            }

            // Filter by type
            if (filters.type) {
                projects = projects.filter(p => p.type === filters.type);
            }

            // Filter by tags
            if (filters.tags && filters.tags.length > 0) {
                projects = projects.filter(p =>
                    filters.tags.some(tag => p.tags.includes(tag))
                );
            }

            // Sort
            const sortBy = filters.sortBy || 'lastAccessedAt';
            const sortOrder = filters.sortOrder || 'desc';

            projects.sort((a, b) => {
                const aVal = a[sortBy];
                const bVal = b[sortBy];

                if (sortOrder === 'desc') {
                    return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
                } else {
                    return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                }
            });

            return projects;
        },

        /**
         * Update a project
         */
        updateProject(projectId, updates) {
            const project = this.getProject(projectId);
            if (!project) {
                console.warn('[UnifiedProjectManager] Project not found:', projectId);
                return null;
            }

            // Apply updates
            Object.keys(updates).forEach(key => {
                if (key !== 'id' && key !== 'createdAt') {
                    project[key] = updates[key];
                }
            });

            project.touch();
            this.saveProjects();

            // Dispatch event
            window.dispatchEvent(new CustomEvent('projectUpdated', {
                detail: { project: project.toJSON() }
            }));

            return project;
        },

        /**
         * Delete a project
         */
        deleteProject(projectId) {
            const index = this.projects.findIndex(p => p.id === projectId);
            if (index === -1) {
                return false;
            }

            this.projects.splice(index, 1);
            this.saveProjects();

            // Clear current project if it was deleted
            if (this.getCurrentProjectId() === projectId) {
                localStorage.removeItem(STORAGE_KEYS.CURRENT_PROJECT);
            }

            // Dispatch event
            window.dispatchEvent(new CustomEvent('projectDeleted', {
                detail: { projectId }
            }));

            return true;
        },

        /**
         * Get current project
         */
        getCurrentProject() {
            const currentId = this.getCurrentProjectId();
            if (!currentId) return null;

            const project = this.getProject(currentId);
            if (project) {
                project.touch();
                this.saveProjects();
            }

            return project;
        },

        /**
         * Get current project ID
         */
        getCurrentProjectId() {
            return localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT);
        },

        /**
         * Set current project
         */
        setCurrentProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) {
                console.warn('[UnifiedProjectManager] Cannot set current project - not found:', projectId);
                return false;
            }

            localStorage.setItem(STORAGE_KEYS.CURRENT_PROJECT, projectId);
            project.touch();
            this.saveProjects();

            // Dispatch event
            window.dispatchEvent(new CustomEvent('currentProjectChanged', {
                detail: { project: project.toJSON() }
            }));

            return true;
        },

        /**
         * Start a project
         */
        startProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) return false;

            project.start();
            this.saveProjects();
            this.setCurrentProject(projectId);

            return true;
        },

        /**
         * Pause a project
         */
        pauseProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) return false;

            project.pause();
            this.saveProjects();

            return true;
        },

        /**
         * Resume a project
         */
        resumeProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) return false;

            project.resume();
            this.saveProjects();
            this.setCurrentProject(projectId);

            return true;
        },

        /**
         * Complete a project
         */
        completeProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) return false;

            project.complete();
            this.saveProjects();

            return true;
        },

        /**
         * Restart a project
         */
        restartProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) return false;

            project.restart();
            this.saveProjects();
            this.setCurrentProject(projectId);

            return true;
        },

        /**
         * Auto-save current project data
         */
        autoSaveCurrentProject(data) {
            const project = this.getCurrentProject();
            if (!project) return false;

            project.updateData(data);
            this.saveProjects();

            return true;
        },

        /**
         * Set up auto-save interval
         */
        setupAutoSave() {
            // Auto-save every 30 seconds if there's a current project
            setInterval(() => {
                const project = this.getCurrentProject();
                if (project && project.state === PROJECT_STATES.IN_PROGRESS) {
                    this.saveProjects();
                }
            }, 30000);
        },

        /**
         * Sync projects with server (Supabase integration)
         */
        async syncProjects() {
            // Integration with existing ProjectService
            if (typeof window.ProjectService !== 'undefined') {
                const isAuth = await window.ProjectService.isAuthenticated();
                if (isAuth) {
                    console.log('[UnifiedProjectManager] Syncing with Supabase...');
                    // Sync logic here
                }
            }
        },

        /**
         * Get project statistics
         */
        getStatistics() {
            const total = this.projects.length;
            const byState = {};
            const byType = {};

            Object.values(PROJECT_STATES).forEach(state => {
                byState[state] = 0;
            });

            Object.values(PROJECT_TYPES).forEach(type => {
                byType[type] = 0;
            });

            this.projects.forEach(project => {
                byState[project.state]++;
                byType[project.type]++;
            });

            const totalProgress = this.projects.reduce((sum, p) => sum + p.progress, 0);
            const avgProgress = total > 0 ? Math.round(totalProgress / total) : 0;

            return {
                total,
                byState,
                byType,
                avgProgress,
                active: byState[PROJECT_STATES.IN_PROGRESS],
                completed: byState[PROJECT_STATES.COMPLETED]
            };
        },

        /**
         * Export project data
         */
        exportProject(projectId) {
            const project = this.getProject(projectId);
            if (!project) return null;

            const exportData = {
                ...project.toJSON(),
                exportedAt: new Date().toISOString(),
                version: '1.0'
            };

            return JSON.stringify(exportData, null, 2);
        },

        /**
         * Import project data
         */
        importProject(jsonData) {
            try {
                const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

                // Generate new ID to avoid conflicts
                data.id = `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                data.createdAt = new Date().toISOString();
                data.updatedAt = new Date().toISOString();

                const project = new UnifiedProject(data);
                this.projects.unshift(project);
                this.saveProjects();

                return project;
            } catch (error) {
                console.error('[UnifiedProjectManager] Import failed:', error);
                return null;
            }
        }
    };

    // Initialize projects array
    UnifiedProjectManager.projects = [];

    // Expose to window
    window.UnifiedProjectManager = UnifiedProjectManager;
    window.PROJECT_STATES = PROJECT_STATES;
    window.PROJECT_TYPES = PROJECT_TYPES;
    window.UnifiedProject = UnifiedProject;

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => UnifiedProjectManager.init());
    } else {
        UnifiedProjectManager.init();
    }

})();
