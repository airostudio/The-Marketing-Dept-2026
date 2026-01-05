/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SETTINGS MANAGEMENT
 * SEO Agent Dashboard - Production Settings System
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const STORAGE_KEY = 'seo-dashboard-settings';
    const SETTINGS_VERSION = '1.0';

    // Default settings - used when no saved settings exist
    const DEFAULT_SETTINGS = {
        version: SETTINGS_VERSION,

        // General - Project
        projectName: 'My SEO Project',
        websiteUrl: 'https://example.com',
        industry: 'technology',

        // General - Timezone & Language
        timezone: 'America/New_York',
        language: 'en',

        // General - Dashboard Preferences
        autoRefresh: true,
        darkMode: true,
        compactSidebar: false,

        // Crawl Settings
        crawlFrequency: '6hours',
        maxPages: 10000,
        crawlDelay: 1,
        userAgent: 'seoagent',
        respectRobots: true,
        autoDetectSitemap: true,
        followNofollow: false,
        customSitemap: '',

        // Notifications
        notificationEmail: '',
        emailFrequency: 'daily',
        weeklyReports: true,
        criticalAlerts: true,
        rankingChanges: false,
        backlinkAlerts: true,
        competitorAlerts: false,
        rankingThreshold: 5,
        trafficThreshold: 20,

        // Integrations
        googleSearchConsole: false,
        googleAnalytics: false,
        slack: false,

        // Meta
        lastSaved: null,
        lastModified: null
    };

    // Track if there are unsaved changes
    let hasUnsavedChanges = false;
    let originalSettings = null;

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    document.addEventListener('DOMContentLoaded', function() {
        initTabNavigation();
        loadSettings();
        initFormListeners();
        initSaveButtons();
        initIntegrationButtons();
        initAPIKeyButtons();
        applySystemSettings();

        // Warn before leaving with unsaved changes
        window.addEventListener('beforeunload', function(e) {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // TAB NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════

    function initTabNavigation() {
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.addEventListener('click', function() {
                const tab = this.dataset.tab;

                // Update nav
                document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
                this.classList.add('active');

                // Update panels
                document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
                const panel = document.querySelector(`[data-panel="${tab}"]`);
                if (panel) {
                    panel.classList.add('active');
                }

                // Save current tab preference
                localStorage.setItem('seo-dashboard-settings-tab', tab);
            });
        });

        // Restore last active tab
        const lastTab = localStorage.getItem('seo-dashboard-settings-tab');
        if (lastTab) {
            const tabBtn = document.querySelector(`.settings-nav-item[data-tab="${lastTab}"]`);
            if (tabBtn) {
                tabBtn.click();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SETTINGS STORAGE
    // ═══════════════════════════════════════════════════════════════════════════

    function loadSettings() {
        const settings = getSavedSettings();
        originalSettings = JSON.parse(JSON.stringify(settings));
        populateForm(settings);
        updateLastSavedDisplay(settings.lastSaved);
    }

    function getSavedSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Merge with defaults to ensure all keys exist
                return { ...DEFAULT_SETTINGS, ...parsed };
            }
        } catch (e) {
            console.warn('Could not load settings:', e);
        }
        return { ...DEFAULT_SETTINGS };
    }

    function saveSettings() {
        const settings = gatherFormData();
        settings.lastSaved = new Date().toISOString();
        settings.lastModified = new Date().toISOString();
        settings.version = SETTINGS_VERSION;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            originalSettings = JSON.parse(JSON.stringify(settings));
            hasUnsavedChanges = false;

            // Apply system-affecting settings immediately
            applySystemSettings(settings);

            // Update UI
            updateLastSavedDisplay(settings.lastSaved);
            updateSaveButton(false);

            // Show success notification
            showNotification('Settings Saved', 'Your settings have been saved successfully.', 'success');

            // Dispatch event for other parts of the app
            window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: settings }));

            return true;
        } catch (e) {
            console.error('Could not save settings:', e);
            showNotification('Error', 'Could not save settings. Please try again.', 'error');
            return false;
        }
    }

    function resetToDefaults() {
        if (confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
            localStorage.removeItem(STORAGE_KEY);
            populateForm(DEFAULT_SETTINGS);
            hasUnsavedChanges = true;
            updateSaveButton(true);
            showNotification('Settings Reset', 'Settings have been reset to defaults. Click Save to apply.', 'info');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FORM POPULATION & DATA GATHERING
    // ═══════════════════════════════════════════════════════════════════════════

    function populateForm(settings) {
        // Text/URL inputs
        setInputValue('projectName', settings.projectName);
        setInputValue('websiteUrl', settings.websiteUrl);
        setInputValue('notificationEmail', settings.notificationEmail);
        setInputValue('customSitemap', settings.customSitemap);

        // Number inputs
        setInputValue('maxPages', settings.maxPages);
        setInputValue('crawlDelay', settings.crawlDelay);
        setInputValue('rankingThreshold', settings.rankingThreshold);
        setInputValue('trafficThreshold', settings.trafficThreshold);

        // Select dropdowns
        setSelectValue('industry', settings.industry);
        setSelectValue('timezone', settings.timezone);
        setSelectValue('language', settings.language);
        setSelectValue('crawlFrequency', settings.crawlFrequency);
        setSelectValue('userAgent', settings.userAgent);
        setSelectValue('emailFrequency', settings.emailFrequency);

        // Checkboxes/Toggles
        setCheckboxValue('autoRefresh', settings.autoRefresh);
        setCheckboxValue('darkMode', settings.darkMode);
        setCheckboxValue('compactSidebar', settings.compactSidebar);
        setCheckboxValue('respectRobots', settings.respectRobots);
        setCheckboxValue('autoDetectSitemap', settings.autoDetectSitemap);
        setCheckboxValue('followNofollow', settings.followNofollow);
        setCheckboxValue('weeklyReports', settings.weeklyReports);
        setCheckboxValue('criticalAlerts', settings.criticalAlerts);
        setCheckboxValue('rankingChanges', settings.rankingChanges);
        setCheckboxValue('backlinkAlerts', settings.backlinkAlerts);
        setCheckboxValue('competitorAlerts', settings.competitorAlerts);

        // Update integration connection status
        updateIntegrationStatus('googleSearchConsole', settings.googleSearchConsole);
        updateIntegrationStatus('googleAnalytics', settings.googleAnalytics);
        updateIntegrationStatus('slack', settings.slack);
    }

    function gatherFormData() {
        return {
            // General - Project
            projectName: getInputValue('projectName'),
            websiteUrl: getInputValue('websiteUrl'),
            industry: getSelectValue('industry'),

            // General - Timezone & Language
            timezone: getSelectValue('timezone'),
            language: getSelectValue('language'),

            // General - Dashboard Preferences
            autoRefresh: getCheckboxValue('autoRefresh'),
            darkMode: getCheckboxValue('darkMode'),
            compactSidebar: getCheckboxValue('compactSidebar'),

            // Crawl Settings
            crawlFrequency: getSelectValue('crawlFrequency'),
            maxPages: parseInt(getInputValue('maxPages')) || 10000,
            crawlDelay: parseFloat(getInputValue('crawlDelay')) || 1,
            userAgent: getSelectValue('userAgent'),
            respectRobots: getCheckboxValue('respectRobots'),
            autoDetectSitemap: getCheckboxValue('autoDetectSitemap'),
            followNofollow: getCheckboxValue('followNofollow'),
            customSitemap: getInputValue('customSitemap'),

            // Notifications
            notificationEmail: getInputValue('notificationEmail'),
            emailFrequency: getSelectValue('emailFrequency'),
            weeklyReports: getCheckboxValue('weeklyReports'),
            criticalAlerts: getCheckboxValue('criticalAlerts'),
            rankingChanges: getCheckboxValue('rankingChanges'),
            backlinkAlerts: getCheckboxValue('backlinkAlerts'),
            competitorAlerts: getCheckboxValue('competitorAlerts'),
            rankingThreshold: parseInt(getInputValue('rankingThreshold')) || 5,
            trafficThreshold: parseInt(getInputValue('trafficThreshold')) || 20,

            // Integrations (preserved from saved settings)
            googleSearchConsole: originalSettings?.googleSearchConsole || false,
            googleAnalytics: originalSettings?.googleAnalytics || false,
            slack: originalSettings?.slack || false
        };
    }

    // Helper functions for form values
    function setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }

    function getInputValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function setSelectValue(id, value) {
        const el = document.getElementById(id);
        if (el && value) {
            el.value = value;
            // If value doesn't exist in options, select first option
            if (el.selectedIndex === -1 && el.options.length > 0) {
                el.selectedIndex = 0;
            }
        }
    }

    function getSelectValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function setCheckboxValue(id, checked) {
        const el = document.getElementById(id);
        if (el) el.checked = !!checked;
    }

    function getCheckboxValue(id) {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FORM CHANGE LISTENERS
    // ═══════════════════════════════════════════════════════════════════════════

    function initFormListeners() {
        // Listen for changes on all form elements
        const formElements = document.querySelectorAll('.settings-content input, .settings-content select, .settings-content textarea');

        formElements.forEach(el => {
            el.addEventListener('change', handleFormChange);
            el.addEventListener('input', handleFormChange);
        });

        // Special handling for toggles that should apply immediately
        const immediateToggleIds = ['darkMode', 'compactSidebar'];
        immediateToggleIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    // Apply immediately for preview, but still mark as unsaved
                    applySystemSettings(gatherFormData());
                });
            }
        });
    }

    function handleFormChange() {
        hasUnsavedChanges = true;
        updateSaveButton(true);
    }

    function updateSaveButton(hasChanges) {
        const saveBtn = document.querySelector('.settings-footer .btn-primary');
        const cancelBtn = document.querySelector('.settings-footer .btn-outline');

        if (saveBtn) {
            if (hasChanges) {
                saveBtn.textContent = 'Save Changes';
                saveBtn.classList.add('has-changes');
            } else {
                saveBtn.textContent = 'Saved';
                saveBtn.classList.remove('has-changes');
            }
        }

        if (cancelBtn) {
            cancelBtn.disabled = !hasChanges;
        }
    }

    function updateLastSavedDisplay(timestamp) {
        let display = document.querySelector('.last-saved-display');

        if (!display) {
            display = document.createElement('span');
            display.className = 'last-saved-display';
            const footer = document.querySelector('.settings-footer');
            if (footer) {
                footer.insertBefore(display, footer.firstChild);
            }
        }

        if (timestamp) {
            const date = new Date(timestamp);
            const formatted = date.toLocaleString();
            display.textContent = `Last saved: ${formatted}`;
        } else {
            display.textContent = 'Never saved';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SAVE/CANCEL BUTTONS
    // ═══════════════════════════════════════════════════════════════════════════

    function initSaveButtons() {
        const saveBtn = document.querySelector('.settings-footer .btn-primary');
        const cancelBtn = document.querySelector('.settings-footer .btn-outline');

        if (saveBtn) {
            saveBtn.addEventListener('click', function(e) {
                e.preventDefault();

                // Validate required fields
                if (validateSettings()) {
                    saveSettings();
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                e.preventDefault();

                if (hasUnsavedChanges) {
                    if (confirm('Discard unsaved changes?')) {
                        populateForm(originalSettings);
                        hasUnsavedChanges = false;
                        updateSaveButton(false);
                        applySystemSettings(originalSettings);
                    }
                }
            });
        }
    }

    function validateSettings() {
        const websiteUrl = getInputValue('websiteUrl');
        const email = getInputValue('notificationEmail');

        // Validate website URL
        if (websiteUrl && !isValidUrl(websiteUrl)) {
            showNotification('Invalid URL', 'Please enter a valid website URL.', 'error');
            document.getElementById('websiteUrl')?.focus();
            return false;
        }

        // Validate email if provided
        if (email && !isValidEmail(email)) {
            showNotification('Invalid Email', 'Please enter a valid email address.', 'error');
            document.getElementById('notificationEmail')?.focus();
            return false;
        }

        // Validate custom sitemap URL if provided
        const customSitemap = getInputValue('customSitemap');
        if (customSitemap && !isValidUrl(customSitemap)) {
            showNotification('Invalid Sitemap URL', 'Please enter a valid sitemap URL.', 'error');
            document.getElementById('customSitemap')?.focus();
            return false;
        }

        return true;
    }

    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SYSTEM SETTINGS APPLICATION
    // ═══════════════════════════════════════════════════════════════════════════

    function applySystemSettings(settings) {
        if (!settings) {
            settings = getSavedSettings();
        }

        // Apply dark mode
        if (settings.darkMode) {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
        }

        // Apply compact sidebar
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            if (settings.compactSidebar) {
                sidebar.classList.add('compact');
            } else {
                sidebar.classList.remove('compact');
            }
        }

        // Store auto-refresh setting for dashboard.js to use
        localStorage.setItem('seo-dashboard-auto-refresh', settings.autoRefresh ? 'true' : 'false');

        // Apply language (set html lang attribute)
        if (settings.language) {
            document.documentElement.lang = settings.language;
        }

        // Apply timezone (store for use in date formatting)
        if (settings.timezone) {
            localStorage.setItem('seo-dashboard-timezone', settings.timezone);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTEGRATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function initIntegrationButtons() {
        const integrationItems = document.querySelectorAll('.integration-item');

        integrationItems.forEach(item => {
            const btn = item.querySelector('.btn');
            if (!btn) return;

            btn.addEventListener('click', function(e) {
                e.preventDefault();

                const integrationName = item.querySelector('.integration-name')?.textContent || 'Integration';
                const isConnected = item.classList.contains('connected');

                if (isConnected) {
                    // Disconnect
                    if (confirm(`Disconnect from ${integrationName}?`)) {
                        disconnectIntegration(item, integrationName);
                    }
                } else {
                    // Connect - show OAuth simulation
                    connectIntegration(item, integrationName);
                }
            });
        });
    }

    function connectIntegration(item, name) {
        const btn = item.querySelector('.btn');
        btn.textContent = 'Connecting...';
        btn.disabled = true;

        // Simulate OAuth flow
        setTimeout(() => {
            item.classList.add('connected');
            btn.textContent = 'Disconnect';
            btn.disabled = false;
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-outline');

            const statusEl = item.querySelector('.integration-status');
            if (statusEl) {
                statusEl.textContent = 'Connected';
                statusEl.classList.remove('not-connected');
            }

            // Mark as unsaved
            hasUnsavedChanges = true;
            updateSaveButton(true);

            showNotification('Connected', `Successfully connected to ${name}.`, 'success');
        }, 1500);
    }

    function disconnectIntegration(item, name) {
        item.classList.remove('connected');

        const btn = item.querySelector('.btn');
        btn.textContent = 'Connect';
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');

        const statusEl = item.querySelector('.integration-status');
        if (statusEl) {
            statusEl.textContent = 'Not connected';
            statusEl.classList.add('not-connected');
        }

        // Mark as unsaved
        hasUnsavedChanges = true;
        updateSaveButton(true);

        showNotification('Disconnected', `Disconnected from ${name}.`, 'info');
    }

    function updateIntegrationStatus(integrationId, isConnected) {
        // Map integration IDs to display names for finding the correct item
        const integrationMap = {
            'googleSearchConsole': 'Google Search Console',
            'googleAnalytics': 'Google Analytics 4',
            'slack': 'Slack'
        };

        const name = integrationMap[integrationId];
        if (!name) return;

        const items = document.querySelectorAll('.integration-item');
        items.forEach(item => {
            const nameEl = item.querySelector('.integration-name');
            if (nameEl && nameEl.textContent === name) {
                const btn = item.querySelector('.btn');
                const statusEl = item.querySelector('.integration-status');

                if (isConnected) {
                    item.classList.add('connected');
                    if (btn) {
                        btn.textContent = 'Disconnect';
                        btn.classList.remove('btn-primary');
                        btn.classList.add('btn-outline');
                    }
                    if (statusEl) {
                        statusEl.textContent = 'Connected';
                        statusEl.classList.remove('not-connected');
                    }
                } else {
                    item.classList.remove('connected');
                    if (btn) {
                        btn.textContent = 'Connect';
                        btn.classList.remove('btn-outline');
                        btn.classList.add('btn-primary');
                    }
                    if (statusEl) {
                        statusEl.textContent = 'Not connected';
                        statusEl.classList.add('not-connected');
                    }
                }
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // API KEYS
    // ═══════════════════════════════════════════════════════════════════════════

    function initAPIKeyButtons() {
        document.querySelectorAll('.api-key-item').forEach(item => {
            const showBtn = item.querySelector('.btn-ghost:nth-child(1)');
            const copyBtn = item.querySelector('.btn-ghost:nth-child(2)');
            const revokeBtn = item.querySelector('.btn-ghost:nth-child(3)');
            const keyValue = item.querySelector('.api-key-value');

            if (showBtn && keyValue) {
                let isShown = false;
                const originalText = keyValue.textContent;

                showBtn.addEventListener('click', () => {
                    isShown = !isShown;
                    if (isShown) {
                        // Generate a fake visible key for demo
                        keyValue.textContent = generateFakeKey(keyValue.textContent.includes('live') ? 'live' : 'test');
                        showBtn.textContent = 'Hide';
                    } else {
                        keyValue.textContent = originalText;
                        showBtn.textContent = 'Show';
                    }
                });
            }

            if (copyBtn && keyValue) {
                copyBtn.addEventListener('click', () => {
                    const text = keyValue.textContent.includes('••••') ?
                        generateFakeKey(keyValue.textContent.includes('live') ? 'live' : 'test') :
                        keyValue.textContent;

                    navigator.clipboard.writeText(text).then(() => {
                        const originalText = copyBtn.textContent;
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => {
                            copyBtn.textContent = originalText;
                        }, 2000);
                    });
                });
            }

            if (revokeBtn) {
                revokeBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to revoke this API key? This cannot be undone.')) {
                        item.style.opacity = '0.5';
                        item.style.pointerEvents = 'none';
                        showNotification('API Key Revoked', 'The API key has been revoked.', 'info');
                    }
                });
            }
        });

        // Generate new key button
        const generateBtn = document.querySelector('.settings-panel[data-panel="api"] .btn-outline');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => {
                showNotification('New API Key', 'New API key generated successfully.', 'success');
            });
        }
    }

    function generateFakeKey(type) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let key = type === 'live' ? 'sk_live_' : 'sk_test_';
        for (let i = 0; i < 24; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return key;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function showNotification(title, message, type) {
        // Use global notification function if available
        if (window.SEODashboard && window.SEODashboard.showNotification) {
            window.SEODashboard.showNotification(title, message, type);
            return;
        }

        // Fallback notification implementation
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-icon">${getNotificationIcon(type)}</div>
            <div class="notification-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
            <button class="notification-close">&times;</button>
        `;

        container.appendChild(notification);
        requestAnimationFrame(() => notification.classList.add('visible'));

        const timeout = setTimeout(() => dismissNotification(notification), 5000);

        notification.querySelector('.notification-close').addEventListener('click', () => {
            clearTimeout(timeout);
            dismissNotification(notification);
        });
    }

    function dismissNotification(notification) {
        notification.classList.remove('visible');
        setTimeout(() => notification.remove(), 300);
    }

    function getNotificationIcon(type) {
        const icons = {
            success: '&#10003;',
            error: '&#10005;',
            warning: '&#9888;',
            info: '&#8505;'
        };
        return icons[type] || icons.info;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    function initSupabaseSettings() {
        // Load saved Supabase config
        const supabaseUrl = localStorage.getItem('supabase-url') || '';
        const supabaseAnonKey = localStorage.getItem('supabase-anon-key') || '';

        const urlInput = document.getElementById('supabaseUrl');
        const anonKeyInput = document.getElementById('supabaseAnonKey');

        if (urlInput) urlInput.value = supabaseUrl;
        if (anonKeyInput) anonKeyInput.value = supabaseAnonKey;

        // Update connection status based on current state
        if (typeof window.Supabase !== 'undefined') {
            const state = window.Supabase.getConnectionState();
            if (state === window.Supabase.ConnectionState.CONNECTED) {
                updateSupabaseConnectionStatus(true);
            } else if (state === window.Supabase.ConnectionState.ERROR) {
                updateSupabaseConnectionStatus(false, 'Connection error');
            } else {
                updateSupabaseConnectionStatus();
            }
        } else {
            updateSupabaseConnectionStatus();
        }

        // Listen for connection state changes
        window.addEventListener('supabaseConnectionChange', function(e) {
            const { state, error } = e.detail;
            if (state === 'connected') {
                updateSupabaseConnectionStatus(true);
            } else if (state === 'error') {
                updateSupabaseConnectionStatus(false, error);
            } else if (state === 'connecting') {
                updateSupabaseConnectionStatus(null, 'Connecting...');
            } else {
                updateSupabaseConnectionStatus();
            }
        });

        // Listen for auth state changes
        window.addEventListener('supabaseAuthChange', function(e) {
            const { event, user } = e.detail;
            if (event === 'SIGNED_IN' && user) {
                showAuthenticatedState(user);
            } else if (event === 'SIGNED_OUT') {
                showUnauthenticatedState();
            }
        });

        // Setup event listeners
        setupSupabaseEventListeners();

        // Check auth state
        checkAuthState();
    }

    function setupSupabaseEventListeners() {
        // Test connection button
        const testBtn = document.getElementById('testSupabaseConnection');
        if (testBtn) {
            testBtn.addEventListener('click', testSupabaseConnection);
        }

        // Save config button
        const saveBtn = document.getElementById('saveSupabaseConfig');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveSupabaseConfig);
        }

        // Password visibility toggles
        document.querySelectorAll('.toggle-visibility').forEach(btn => {
            btn.addEventListener('click', function() {
                const targetId = this.dataset.target;
                const input = document.getElementById(targetId);
                if (input) {
                    const isPassword = input.type === 'password';
                    input.type = isPassword ? 'text' : 'password';

                    const showIcon = this.querySelector('.icon-show');
                    const hideIcon = this.querySelector('.icon-hide');
                    if (showIcon && hideIcon) {
                        showIcon.style.display = isPassword ? 'none' : 'block';
                        hideIcon.style.display = isPassword ? 'block' : 'none';
                    }
                }
            });
        });

        // Auth tab switching
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const targetTab = this.dataset.tab;

                // Update tabs
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');

                // Show/hide forms
                const signInForm = document.getElementById('signInForm');
                const signUpForm = document.getElementById('signUpForm');

                if (signInForm && signUpForm) {
                    signInForm.style.display = targetTab === 'signin' ? 'block' : 'none';
                    signUpForm.style.display = targetTab === 'signup' ? 'block' : 'none';
                }
            });
        });

        // Sign in form
        const signInForm = document.getElementById('signInForm');
        if (signInForm) {
            signInForm.addEventListener('submit', handleSignIn);
        }

        // Sign up form
        const signUpForm = document.getElementById('signUpForm');
        if (signUpForm) {
            signUpForm.addEventListener('submit', handleSignUp);
        }

        // Sign out button
        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', handleSignOut);
        }

        // OAuth buttons
        const googleOAuthBtn = document.getElementById('googleOAuth');
        if (googleOAuthBtn) {
            googleOAuthBtn.addEventListener('click', () => handleOAuth('google'));
        }

        const githubOAuthBtn = document.getElementById('githubOAuth');
        if (githubOAuthBtn) {
            githubOAuthBtn.addEventListener('click', () => handleOAuth('github'));
        }
    }

    async function testSupabaseConnection() {
        const btn = document.getElementById('testSupabaseConnection');
        const urlInput = document.getElementById('supabaseUrl');
        const anonKeyInput = document.getElementById('supabaseAnonKey');

        if (!urlInput || !anonKeyInput) return;

        const url = urlInput.value.trim();
        const anonKey = anonKeyInput.value.trim();

        if (!url || !anonKey) {
            showNotification('Missing Configuration', 'Please enter both URL and Anon Key', 'error');
            return;
        }

        // Show loading state
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Testing...';

        try {
            // Try to initialize Supabase with the new credentials
            if (typeof window.Supabase !== 'undefined') {
                const client = window.Supabase.setConfig(url, anonKey);

                if (client) {
                    // Try a simple query to test connection
                    const { error } = await client.auth.getSession();

                    if (!error) {
                        showNotification('Connection Successful', 'Successfully connected to Supabase', 'success');
                        updateSupabaseConnectionStatus(true);
                    } else {
                        throw new Error(error.message);
                    }
                } else {
                    throw new Error('Failed to initialize Supabase client');
                }
            } else {
                throw new Error('Supabase library not loaded');
            }
        } catch (error) {
            showNotification('Connection Failed', error.message, 'error');
            updateSupabaseConnectionStatus(false, error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Test Connection
            `;
        }
    }

    function saveSupabaseConfig() {
        const urlInput = document.getElementById('supabaseUrl');
        const anonKeyInput = document.getElementById('supabaseAnonKey');

        if (!urlInput || !anonKeyInput) return;

        const url = urlInput.value.trim();
        const anonKey = anonKeyInput.value.trim();

        localStorage.setItem('supabase-url', url);
        localStorage.setItem('supabase-anon-key', anonKey);

        if (typeof window.Supabase !== 'undefined') {
            window.Supabase.setConfig(url, anonKey);
        }

        showNotification('Configuration Saved', 'Supabase configuration has been saved', 'success');
        updateSupabaseConnectionStatus();
    }

    function updateSupabaseConnectionStatus(connected = null, statusMsg = null) {
        const statusEl = document.getElementById('supabaseStatus');
        if (!statusEl) return;

        const indicator = statusEl.querySelector('.status-indicator');
        const text = statusEl.querySelector('span:last-child');

        if (connected === true) {
            indicator.className = 'status-indicator connected';
            text.textContent = 'Connected';
        } else if (connected === false) {
            indicator.className = 'status-indicator error';
            text.textContent = statusMsg || 'Connection failed';
        } else if (statusMsg === 'Connecting...') {
            indicator.className = 'status-indicator connecting';
            text.textContent = 'Connecting...';
        } else {
            // Check current config and connection state
            const url = localStorage.getItem('supabase-url');
            const anonKey = localStorage.getItem('supabase-anon-key');

            if (url && anonKey) {
                // Check if already connected
                if (typeof window.Supabase !== 'undefined' && window.Supabase.isConnected()) {
                    indicator.className = 'status-indicator connected';
                    text.textContent = 'Connected';
                } else {
                    indicator.className = 'status-indicator neutral';
                    text.textContent = 'Configured - click Test to verify';
                }
            } else {
                indicator.className = 'status-indicator neutral';
                text.textContent = 'Not configured';
            }
        }
    }

    async function checkAuthState() {
        if (typeof window.Supabase === 'undefined' || !window.Supabase.isConfigured()) {
            return;
        }

        try {
            const user = await window.Supabase.Auth.getUser();
            if (user) {
                showAuthenticatedState(user);
            }
        } catch (error) {
            console.log('Not authenticated');
        }
    }

    function showAuthenticatedState(user) {
        const authSection = document.getElementById('authSection');
        const authForms = document.getElementById('authForms');

        if (authSection) {
            authSection.style.display = 'block';

            const avatar = document.getElementById('userAvatarLarge');
            const emailDisplay = document.getElementById('userEmailDisplay');
            const userSince = document.getElementById('userSince');

            if (avatar && user.email) {
                avatar.textContent = user.email.substring(0, 2).toUpperCase();
            }

            if (emailDisplay) {
                emailDisplay.textContent = user.email;
            }

            if (userSince && user.created_at) {
                const date = new Date(user.created_at);
                userSince.textContent = 'Member since ' + date.toLocaleDateString();
            }
        }

        if (authForms) {
            authForms.style.display = 'none';
        }
    }

    function showUnauthenticatedState() {
        const authSection = document.getElementById('authSection');
        const authForms = document.getElementById('authForms');

        if (authSection) {
            authSection.style.display = 'none';
        }

        if (authForms) {
            authForms.style.display = 'block';
        }
    }

    async function handleSignIn(e) {
        e.preventDefault();

        const email = document.getElementById('signInEmail').value.trim();
        const password = document.getElementById('signInPassword').value;

        if (!email || !password) {
            showNotification('Missing Fields', 'Please enter email and password', 'error');
            return;
        }

        if (typeof window.Supabase === 'undefined' || !window.Supabase.isConfigured()) {
            showNotification('Not Configured', 'Please configure Supabase first', 'error');
            return;
        }

        try {
            const data = await window.Supabase.Auth.signIn(email, password);
            showNotification('Welcome Back!', 'Successfully signed in', 'success');
            showAuthenticatedState(data.user);
        } catch (error) {
            showNotification('Sign In Failed', error.message, 'error');
        }
    }

    async function handleSignUp(e) {
        e.preventDefault();

        const name = document.getElementById('signUpName').value.trim();
        const email = document.getElementById('signUpEmail').value.trim();
        const password = document.getElementById('signUpPassword').value;
        const passwordConfirm = document.getElementById('signUpPasswordConfirm').value;

        if (!name || !email || !password || !passwordConfirm) {
            showNotification('Missing Fields', 'Please fill in all fields', 'error');
            return;
        }

        if (password !== passwordConfirm) {
            showNotification('Password Mismatch', 'Passwords do not match', 'error');
            return;
        }

        if (password.length < 8) {
            showNotification('Weak Password', 'Password must be at least 8 characters', 'error');
            return;
        }

        if (typeof window.Supabase === 'undefined' || !window.Supabase.isConfigured()) {
            showNotification('Not Configured', 'Please configure Supabase first', 'error');
            return;
        }

        try {
            await window.Supabase.Auth.signUp(email, password, { full_name: name });
            showNotification('Account Created', 'Please check your email to verify your account', 'success');
        } catch (error) {
            showNotification('Sign Up Failed', error.message, 'error');
        }
    }

    async function handleSignOut() {
        if (typeof window.Supabase === 'undefined') return;

        try {
            await window.Supabase.Auth.signOut();
            showNotification('Signed Out', 'You have been signed out', 'success');
            showUnauthenticatedState();
        } catch (error) {
            showNotification('Sign Out Failed', error.message, 'error');
        }
    }

    async function handleOAuth(provider) {
        if (typeof window.Supabase === 'undefined' || !window.Supabase.isConfigured()) {
            showNotification('Not Configured', 'Please configure Supabase first', 'error');
            return;
        }

        try {
            await window.Supabase.Auth.signInWithOAuth(provider);
        } catch (error) {
            showNotification('OAuth Failed', error.message, 'error');
        }
    }

    // Initialize Supabase settings when page loads
    document.addEventListener('DOMContentLoaded', function() {
        // Small delay to ensure Supabase library is loaded
        setTimeout(initSupabaseSettings, 100);
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT FOR GLOBAL ACCESS
    // ═══════════════════════════════════════════════════════════════════════════

    window.SEOSettings = {
        getSettings: getSavedSettings,
        saveSettings,
        resetToDefaults,
        applySystemSettings,
        DEFAULT_SETTINGS
    };

})();

// ═══════════════════════════════════════════════════════════════════════════════
// ADDITIONAL CSS FOR SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const settingsStyles = document.createElement('style');
settingsStyles.textContent = `
    /* Form hint text */
    .form-hint {
        display: block;
        margin-top: 6px;
        font-size: 12px;
        color: var(--color-text-tertiary);
    }

    /* Last saved display */
    .last-saved-display {
        font-size: 13px;
        color: var(--color-text-tertiary);
        margin-right: auto;
    }

    /* Save button with changes indicator */
    .settings-footer .btn-primary.has-changes {
        animation: pulse-save 2s infinite;
    }

    @keyframes pulse-save {
        0%, 100% {
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4);
        }
        50% {
            box-shadow: 0 0 0 8px rgba(99, 102, 241, 0);
        }
    }

    /* Light mode support */
    body.light-mode {
        --color-bg-primary: #ffffff;
        --color-bg-secondary: #f8fafc;
        --color-bg-tertiary: #f1f5f9;
        --color-text-primary: #0f172a;
        --color-text-secondary: #475569;
        --color-text-tertiary: #94a3b8;
        --color-border: #e2e8f0;
    }

    body.light-mode .sidebar {
        background: #ffffff;
        border-right: 1px solid #e2e8f0;
    }

    body.light-mode .main-content {
        background: #f8fafc;
    }

    body.light-mode .settings-section,
    body.light-mode .settings-nav-item,
    body.light-mode .form-input,
    body.light-mode .form-select {
        background: #ffffff;
        border-color: #e2e8f0;
        color: #0f172a;
    }

    body.light-mode .topbar {
        background: rgba(255, 255, 255, 0.9);
        border-color: #e2e8f0;
    }

    /* Compact sidebar */
    .sidebar.compact {
        width: 72px;
    }

    .sidebar.compact .logo-text,
    .sidebar.compact .nav-item span,
    .sidebar.compact .nav-section-title,
    .sidebar.compact .user-info {
        display: none;
    }

    .sidebar.compact .sidebar-logo {
        justify-content: center;
    }

    .sidebar.compact .nav-item {
        justify-content: center;
        padding: 12px;
    }

    .sidebar.compact + .main-content {
        margin-left: 72px;
    }

    /* Disabled cancel button */
    .settings-footer .btn-outline:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;
document.head.appendChild(settingsStyles);
