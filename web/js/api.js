/**
 * SEO Dashboard Data Service
 * Production-ready API layer for data fetching
 *
 * This service handles all data operations and is designed to:
 * 1. Connect to a real backend API when available
 * 2. Show empty/zero states when no data exists
 * 3. Handle loading and error states properly
 */

const API = {
    // Configuration - Set your API endpoint here
    config: {
        baseUrl: localStorage.getItem('seo-api-endpoint') || '',
        apiKey: localStorage.getItem('seo-api-key') || '',
        timeout: 30000
    },

    // Check if API is configured
    isConfigured() {
        return this.config.baseUrl && this.config.apiKey;
    },

    // Generic fetch wrapper with error handling
    async fetch(endpoint, options = {}) {
        if (!this.isConfigured()) {
            return { success: false, error: 'API not configured', data: null };
        }

        try {
            const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                timeout: this.config.timeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return { success: true, data, error: null };
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error.message);
            return { success: false, error: error.message, data: null };
        }
    },

    // Update API configuration
    setConfig(baseUrl, apiKey) {
        this.config.baseUrl = baseUrl;
        this.config.apiKey = apiKey;
        localStorage.setItem('seo-api-endpoint', baseUrl);
        localStorage.setItem('seo-api-key', apiKey);
    }
};

/**
 * Data Store - Central state management
 * Stores fetched data and provides reactive updates
 */
const DataStore = {
    _data: {
        siteHealth: null,
        traffic: null,
        keywords: null,
        backlinks: null,
        audits: null,
        alerts: null,
        history: null,
        competitors: null,
        coreWebVitals: null,
        brokenLinks: null,
        indexing: null,
        mobileData: null
    },

    _listeners: [],

    // Subscribe to data changes
    subscribe(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(cb => cb !== callback);
        };
    },

    // Notify all subscribers
    _notify(key, data) {
        this._listeners.forEach(cb => cb(key, data));
    },

    // Get data (returns empty state if not loaded)
    get(key) {
        return this._data[key];
    },

    // Set data and notify
    set(key, data) {
        this._data[key] = data;
        this._notify(key, data);
    },

    // Check if data exists
    hasData(key) {
        const data = this._data[key];
        if (data === null || data === undefined) return false;
        if (Array.isArray(data)) return data.length > 0;
        if (typeof data === 'object') return Object.keys(data).length > 0;
        return true;
    }
};

/**
 * Empty State Defaults
 * These are shown when no real data is available
 */
const EmptyStates = {
    siteHealth: {
        score: 0,
        issues: { critical: 0, warnings: 0, passed: 0 },
        lastAudit: null
    },
    traffic: {
        total: 0,
        organic: 0,
        direct: 0,
        referral: 0,
        social: 0,
        trend: []
    },
    keywords: {
        total: 0,
        ranking: 0,
        improved: 0,
        declined: 0,
        positions: []
    },
    backlinks: {
        total: 0,
        newThisMonth: 0,
        lost: 0,
        domains: 0,
        list: []
    },
    audits: [],
    alerts: [],
    history: [],
    competitors: [],
    coreWebVitals: {
        lcp: { value: 0, rating: 'unknown' },
        fid: { value: 0, rating: 'unknown' },
        cls: { value: 0, rating: 'unknown' },
        ttfb: { value: 0, rating: 'unknown' }
    },
    brokenLinks: {
        total: 0,
        internal: 0,
        external: 0,
        list: []
    },
    indexing: {
        indexed: 0,
        notIndexed: 0,
        blocked: 0,
        pages: []
    },
    mobileData: {
        score: 0,
        issues: [],
        passedTests: 0,
        failedTests: 0
    }
};

/**
 * SEO Data Service
 * High-level data fetching methods
 */
const SEODataService = {
    // Fetch site health score and issues
    async getSiteHealth() {
        const result = await API.fetch('/site-health');
        if (result.success && result.data) {
            DataStore.set('siteHealth', result.data);
            return result.data;
        }
        return EmptyStates.siteHealth;
    },

    // Fetch traffic data
    async getTraffic(period = '30d') {
        const result = await API.fetch(`/traffic?period=${period}`);
        if (result.success && result.data) {
            DataStore.set('traffic', result.data);
            return result.data;
        }
        return EmptyStates.traffic;
    },

    // Fetch keyword rankings
    async getKeywords() {
        const result = await API.fetch('/keywords');
        if (result.success && result.data) {
            DataStore.set('keywords', result.data);
            return result.data;
        }
        return EmptyStates.keywords;
    },

    // Fetch backlink data
    async getBacklinks() {
        const result = await API.fetch('/backlinks');
        if (result.success && result.data) {
            DataStore.set('backlinks', result.data);
            return result.data;
        }
        return EmptyStates.backlinks;
    },

    // Fetch audit history
    async getAudits() {
        const result = await API.fetch('/audits');
        if (result.success && result.data) {
            DataStore.set('audits', result.data);
            return result.data;
        }
        return EmptyStates.audits;
    },

    // Fetch alerts
    async getAlerts() {
        const result = await API.fetch('/alerts');
        if (result.success && result.data) {
            DataStore.set('alerts', result.data);
            return result.data;
        }
        return EmptyStates.alerts;
    },

    // Fetch activity history
    async getHistory() {
        const result = await API.fetch('/history');
        if (result.success && result.data) {
            DataStore.set('history', result.data);
            return result.data;
        }
        return EmptyStates.history;
    },

    // Fetch competitor data
    async getCompetitors() {
        const result = await API.fetch('/competitors');
        if (result.success && result.data) {
            DataStore.set('competitors', result.data);
            return result.data;
        }
        return EmptyStates.competitors;
    },

    // Fetch Core Web Vitals
    async getCoreWebVitals() {
        const result = await API.fetch('/core-web-vitals');
        if (result.success && result.data) {
            DataStore.set('coreWebVitals', result.data);
            return result.data;
        }
        return EmptyStates.coreWebVitals;
    },

    // Fetch broken links
    async getBrokenLinks() {
        const result = await API.fetch('/broken-links');
        if (result.success && result.data) {
            DataStore.set('brokenLinks', result.data);
            return result.data;
        }
        return EmptyStates.brokenLinks;
    },

    // Fetch indexing status
    async getIndexingStatus() {
        const result = await API.fetch('/indexing');
        if (result.success && result.data) {
            DataStore.set('indexing', result.data);
            return result.data;
        }
        return EmptyStates.indexing;
    },

    // Fetch mobile friendliness data
    async getMobileData() {
        const result = await API.fetch('/mobile-friendliness');
        if (result.success && result.data) {
            DataStore.set('mobileData', result.data);
            return result.data;
        }
        return EmptyStates.mobileData;
    },

    // Run a new audit
    async runAudit(type = 'full') {
        const result = await API.fetch('/audits/run', {
            method: 'POST',
            body: JSON.stringify({ type })
        });
        return result;
    },

    // Dismiss an alert
    async dismissAlert(alertId) {
        const result = await API.fetch(`/alerts/${alertId}/dismiss`, {
            method: 'POST'
        });
        return result;
    },

    // Export report
    async exportReport(format = 'pdf', options = {}) {
        const result = await API.fetch('/reports/export', {
            method: 'POST',
            body: JSON.stringify({ format, ...options })
        });
        return result;
    },

    // Fetch all dashboard data
    async fetchAllDashboardData() {
        const results = await Promise.allSettled([
            this.getSiteHealth(),
            this.getTraffic(),
            this.getKeywords(),
            this.getBacklinks()
        ]);
        return {
            siteHealth: results[0].status === 'fulfilled' ? results[0].value : EmptyStates.siteHealth,
            traffic: results[1].status === 'fulfilled' ? results[1].value : EmptyStates.traffic,
            keywords: results[2].status === 'fulfilled' ? results[2].value : EmptyStates.keywords,
            backlinks: results[3].status === 'fulfilled' ? results[3].value : EmptyStates.backlinks
        };
    }
};

/**
 * UI Helpers - Render empty states and loading indicators
 */
const UIHelpers = {
    // Create empty state message
    createEmptyState(container, message, icon = 'inbox') {
        const html = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <i class="fas fa-${icon}"></i>
                </div>
                <h3>No Data Available</h3>
                <p>${message}</p>
                <p class="empty-state-hint">Configure your API connection in Settings to start collecting data.</p>
            </div>
        `;
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        if (container) {
            container.innerHTML = html;
        }
    },

    // Create loading state
    createLoadingState(container) {
        const html = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <p>Loading data...</p>
            </div>
        `;
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        if (container) {
            container.innerHTML = html;
        }
    },

    // Format number with K/M suffix
    formatNumber(num) {
        if (num === 0 || num === null || num === undefined) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    },

    // Format percentage
    formatPercent(value) {
        if (value === 0 || value === null || value === undefined) return '0%';
        return value.toFixed(1) + '%';
    },

    // Format date
    formatDate(dateString) {
        if (!dateString) return 'Never';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // Get status color class
    getStatusClass(score) {
        if (score >= 80) return 'status-good';
        if (score >= 50) return 'status-warning';
        return 'status-critical';
    },

    // Update metric card
    updateMetricCard(selector, value, label = null) {
        const card = document.querySelector(selector);
        if (card) {
            const valueEl = card.querySelector('.metric-value, .stat-value, h2');
            if (valueEl) {
                valueEl.textContent = this.formatNumber(value);
            }
            if (label) {
                const labelEl = card.querySelector('.metric-label, .stat-label, p');
                if (labelEl) {
                    labelEl.textContent = label;
                }
            }
        }
    }
};

/**
 * Dashboard Renderer
 * Updates dashboard UI with real or empty data
 */
const DashboardRenderer = {
    // Initialize dashboard with data
    async init() {
        // Show loading states
        this.showLoadingStates();

        // Check if API is configured
        if (!API.isConfigured()) {
            this.renderEmptyDashboard();
            return;
        }

        // Fetch and render data
        try {
            const data = await SEODataService.fetchAllDashboardData();
            this.renderDashboard(data);
        } catch (error) {
            console.error('Dashboard init error:', error);
            this.renderEmptyDashboard();
        }
    },

    showLoadingStates() {
        // Add loading class to metric cards
        document.querySelectorAll('.metric-card, .stat-card').forEach(card => {
            card.classList.add('loading');
        });
    },

    renderEmptyDashboard() {
        // Remove loading states
        document.querySelectorAll('.metric-card, .stat-card').forEach(card => {
            card.classList.remove('loading');
        });

        // Update all metrics to zero/empty
        this.updateSiteHealth(EmptyStates.siteHealth);
        this.updateTraffic(EmptyStates.traffic);
        this.updateKeywords(EmptyStates.keywords);
        this.updateBacklinks(EmptyStates.backlinks);

        // Show empty state for charts
        const chartContainers = document.querySelectorAll('.chart-container');
        chartContainers.forEach(container => {
            UIHelpers.createEmptyState(container, 'Connect your API to see traffic trends.');
        });
    },

    renderDashboard(data) {
        // Remove loading states
        document.querySelectorAll('.metric-card, .stat-card').forEach(card => {
            card.classList.remove('loading');
        });

        this.updateSiteHealth(data.siteHealth);
        this.updateTraffic(data.traffic);
        this.updateKeywords(data.keywords);
        this.updateBacklinks(data.backlinks);
    },

    updateSiteHealth(data) {
        const scoreEl = document.querySelector('[data-metric="site-health-score"]');
        if (scoreEl) {
            scoreEl.textContent = data.score || 0;
            scoreEl.className = UIHelpers.getStatusClass(data.score || 0);
        }

        const issuesEl = document.querySelector('[data-metric="critical-issues"]');
        if (issuesEl) {
            issuesEl.textContent = data.issues?.critical || 0;
        }

        const warningsEl = document.querySelector('[data-metric="warnings"]');
        if (warningsEl) {
            warningsEl.textContent = data.issues?.warnings || 0;
        }

        const passedEl = document.querySelector('[data-metric="passed"]');
        if (passedEl) {
            passedEl.textContent = data.issues?.passed || 0;
        }
    },

    updateTraffic(data) {
        const totalEl = document.querySelector('[data-metric="total-traffic"]');
        if (totalEl) {
            totalEl.textContent = UIHelpers.formatNumber(data.total || 0);
        }
    },

    updateKeywords(data) {
        const totalEl = document.querySelector('[data-metric="total-keywords"]');
        if (totalEl) {
            totalEl.textContent = UIHelpers.formatNumber(data.total || 0);
        }

        const rankingEl = document.querySelector('[data-metric="ranking-keywords"]');
        if (rankingEl) {
            rankingEl.textContent = UIHelpers.formatNumber(data.ranking || 0);
        }
    },

    updateBacklinks(data) {
        const totalEl = document.querySelector('[data-metric="total-backlinks"]');
        if (totalEl) {
            totalEl.textContent = UIHelpers.formatNumber(data.total || 0);
        }

        const domainsEl = document.querySelector('[data-metric="referring-domains"]');
        if (domainsEl) {
            domainsEl.textContent = UIHelpers.formatNumber(data.domains || 0);
        }
    }
};

// Export for use in other scripts
window.API = API;
window.DataStore = DataStore;
window.EmptyStates = EmptyStates;
window.SEODataService = SEODataService;
window.UIHelpers = UIHelpers;
window.DashboardRenderer = DashboardRenderer;
