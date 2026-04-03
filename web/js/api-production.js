/**
 * Production API Integration Service
 * Aduma Marketing 2026
 *
 * Connects to real APIs for production use:
 * - Google Search Console (keywords, indexing)
 * - Google Analytics (traffic, audience)
 * - Google PageSpeed Insights (Core Web Vitals)
 * - Real website crawling (seo-audit.js)
 * - Third-party SEO tools (Ahrefs, SEMrush, etc.)
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CACHE MANAGER
    // ═══════════════════════════════════════════════════════════════════════════

    const Cache = {
        get(key) {
            const item = localStorage.getItem(`api_cache_${key}`);
            if (!item) return null;

            try {
                const { data, expires } = JSON.parse(item);
                if (Date.now() > expires) {
                    localStorage.removeItem(`api_cache_${key}`);
                    return null;
                }
                return data;
            } catch {
                return null;
            }
        },

        set(key, data, ttl) {
            const item = {
                data,
                expires: Date.now() + ttl
            };
            localStorage.setItem(`api_cache_${key}`, JSON.stringify(item));
        },

        clear(prefix = '') {
            const keys = Object.keys(localStorage).filter(k =>
                k.startsWith(`api_cache_${prefix}`)
            );
            keys.forEach(k => localStorage.removeItem(k));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE OAUTH MANAGER
    // ═══════════════════════════════════════════════════════════════════════════

    const GoogleAuth = {
        tokenKey: 'google_oauth_token',
        token: null,

        getToken() {
            if (this.token && this.token.expires > Date.now()) {
                return this.token.access_token;
            }

            const stored = localStorage.getItem(this.tokenKey);
            if (stored) {
                try {
                    this.token = JSON.parse(stored);
                    if (this.token.expires > Date.now()) {
                        return this.token.access_token;
                    }
                } catch {}
            }

            return null;
        },

        setToken(tokenData) {
            this.token = {
                access_token: tokenData.access_token,
                expires: Date.now() + (tokenData.expires_in * 1000) - 60000 // 1 min buffer
            };
            localStorage.setItem(this.tokenKey, JSON.stringify(this.token));
        },

        async authorize(scopes) {
            const config = window.APP_CONFIG?.GOOGLE;
            if (!config?.CLIENT_ID) {
                throw new Error('Google Client ID not configured');
            }

            return new Promise((resolve, reject) => {
                const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
                authUrl.searchParams.set('client_id', config.CLIENT_ID);
                authUrl.searchParams.set('redirect_uri', window.location.origin + '/oauth-callback.html');
                authUrl.searchParams.set('response_type', 'token');
                authUrl.searchParams.set('scope', scopes.join(' '));
                authUrl.searchParams.set('prompt', 'consent');

                const popup = window.open(authUrl.toString(), 'google-auth', 'width=500,height=600');

                const handleMessage = (event) => {
                    if (event.origin !== window.location.origin) return;
                    if (event.data?.type === 'oauth-callback') {
                        window.removeEventListener('message', handleMessage);
                        if (event.data.error) {
                            reject(new Error(event.data.error));
                        } else {
                            this.setToken(event.data);
                            resolve(event.data.access_token);
                        }
                        popup?.close();
                    }
                };

                window.addEventListener('message', handleMessage);

                // Timeout after 5 minutes
                setTimeout(() => {
                    window.removeEventListener('message', handleMessage);
                    popup?.close();
                    reject(new Error('Authorization timeout'));
                }, 300000);
            });
        },

        isAuthorized() {
            return !!this.getToken();
        },

        logout() {
            this.token = null;
            localStorage.removeItem(this.tokenKey);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE SEARCH CONSOLE API
    // ═══════════════════════════════════════════════════════════════════════════

    const SearchConsole = {
        baseUrl: 'https://searchconsole.googleapis.com/webmasters/v3',

        async ensureAuth() {
            if (!GoogleAuth.isAuthorized()) {
                const scopes = window.APP_CONFIG?.GOOGLE?.SEARCH_CONSOLE?.SCOPES || [
                    'https://www.googleapis.com/auth/webmasters.readonly'
                ];
                await GoogleAuth.authorize(scopes);
            }
            return GoogleAuth.getToken();
        },

        async getSites() {
            const cacheKey = 'gsc_sites';
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const token = await this.ensureAuth();
            const response = await fetch(`${this.baseUrl}/sites`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to fetch sites');

            const data = await response.json();
            Cache.set(cacheKey, data.siteEntry || [], window.APP_CONFIG?.CACHE_TTL?.SEARCH_CONSOLE || 1800000);
            return data.siteEntry || [];
        },

        async getSearchAnalytics(siteUrl, options = {}) {
            const {
                startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                endDate = new Date().toISOString().split('T')[0],
                dimensions = ['query'],
                rowLimit = 1000
            } = options;

            const cacheKey = `gsc_analytics_${siteUrl}_${startDate}_${endDate}_${dimensions.join(',')}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const token = await this.ensureAuth();
            const encodedUrl = encodeURIComponent(siteUrl);

            const response = await fetch(
                `${this.baseUrl}/sites/${encodedUrl}/searchAnalytics/query`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        startDate,
                        endDate,
                        dimensions,
                        rowLimit
                    })
                }
            );

            if (!response.ok) throw new Error('Failed to fetch search analytics');

            const data = await response.json();
            Cache.set(cacheKey, data.rows || [], window.APP_CONFIG?.CACHE_TTL?.SEARCH_CONSOLE || 1800000);
            return data.rows || [];
        },

        async getKeywords(siteUrl) {
            const rows = await this.getSearchAnalytics(siteUrl, {
                dimensions: ['query'],
                rowLimit: 500
            });

            return rows.map(row => ({
                keyword: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: (row.ctr * 100).toFixed(2),
                position: row.position.toFixed(1)
            }));
        },

        async getPages(siteUrl) {
            const rows = await this.getSearchAnalytics(siteUrl, {
                dimensions: ['page'],
                rowLimit: 500
            });

            return rows.map(row => ({
                url: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: (row.ctr * 100).toFixed(2),
                position: row.position.toFixed(1)
            }));
        },

        async getIndexingStatus(siteUrl) {
            const token = await this.ensureAuth();
            const encodedUrl = encodeURIComponent(siteUrl);

            try {
                const response = await fetch(
                    `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            inspectionUrl: siteUrl,
                            siteUrl: siteUrl
                        })
                    }
                );

                if (!response.ok) return null;
                return await response.json();
            } catch {
                return null;
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE ANALYTICS 4 API
    // ═══════════════════════════════════════════════════════════════════════════

    const Analytics = {
        baseUrl: 'https://analyticsdata.googleapis.com/v1beta',

        async ensureAuth() {
            if (!GoogleAuth.isAuthorized()) {
                const scopes = window.APP_CONFIG?.GOOGLE?.ANALYTICS?.SCOPES || [
                    'https://www.googleapis.com/auth/analytics.readonly'
                ];
                await GoogleAuth.authorize(scopes);
            }
            return GoogleAuth.getToken();
        },

        async runReport(propertyId, options) {
            const token = await this.ensureAuth();
            const property = propertyId || window.APP_CONFIG?.GOOGLE?.ANALYTICS?.PROPERTY_ID;

            if (!property) throw new Error('GA4 Property ID not configured');

            const response = await fetch(
                `${this.baseUrl}/${property}:runReport`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(options)
                }
            );

            if (!response.ok) throw new Error('Failed to run GA4 report');
            return await response.json();
        },

        async getTrafficOverview(days = 30) {
            const cacheKey = `ga_traffic_${days}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const startDate = `${days}daysAgo`;
            const endDate = 'today';

            const report = await this.runReport(null, {
                dateRanges: [{ startDate, endDate }],
                metrics: [
                    { name: 'sessions' },
                    { name: 'totalUsers' },
                    { name: 'newUsers' },
                    { name: 'bounceRate' },
                    { name: 'averageSessionDuration' },
                    { name: 'screenPageViews' }
                ]
            });

            const row = report.rows?.[0]?.metricValues || [];
            const data = {
                sessions: parseInt(row[0]?.value || 0),
                users: parseInt(row[1]?.value || 0),
                newUsers: parseInt(row[2]?.value || 0),
                bounceRate: parseFloat(row[3]?.value || 0).toFixed(2),
                avgDuration: parseFloat(row[4]?.value || 0).toFixed(0),
                pageviews: parseInt(row[5]?.value || 0)
            };

            Cache.set(cacheKey, data, window.APP_CONFIG?.CACHE_TTL?.ANALYTICS || 300000);
            return data;
        },

        async getTrafficBySource(days = 30) {
            const cacheKey = `ga_sources_${days}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const report = await this.runReport(null, {
                dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
                dimensions: [{ name: 'sessionDefaultChannelGroup' }],
                metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
            });

            const data = (report.rows || []).map(row => ({
                source: row.dimensionValues[0]?.value,
                sessions: parseInt(row.metricValues[0]?.value || 0),
                users: parseInt(row.metricValues[1]?.value || 0)
            }));

            Cache.set(cacheKey, data, window.APP_CONFIG?.CACHE_TTL?.ANALYTICS || 300000);
            return data;
        },

        async getTrafficTrend(days = 30) {
            const cacheKey = `ga_trend_${days}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const report = await this.runReport(null, {
                dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
                dimensions: [{ name: 'date' }],
                metrics: [
                    { name: 'sessions' },
                    { name: 'totalUsers' },
                    { name: 'screenPageViews' }
                ],
                orderBys: [{ dimension: { dimensionName: 'date' } }]
            });

            const data = (report.rows || []).map(row => ({
                date: row.dimensionValues[0]?.value,
                sessions: parseInt(row.metricValues[0]?.value || 0),
                users: parseInt(row.metricValues[1]?.value || 0),
                pageviews: parseInt(row.metricValues[2]?.value || 0)
            }));

            Cache.set(cacheKey, data, window.APP_CONFIG?.CACHE_TTL?.ANALYTICS || 300000);
            return data;
        },

        async getTopPages(days = 30, limit = 20) {
            const report = await this.runReport(null, {
                dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
                dimensions: [{ name: 'pagePath' }],
                metrics: [
                    { name: 'screenPageViews' },
                    { name: 'averageSessionDuration' },
                    { name: 'bounceRate' }
                ],
                orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
                limit
            });

            return (report.rows || []).map(row => ({
                path: row.dimensionValues[0]?.value,
                pageviews: parseInt(row.metricValues[0]?.value || 0),
                avgDuration: parseFloat(row.metricValues[1]?.value || 0).toFixed(0),
                bounceRate: parseFloat(row.metricValues[2]?.value || 0).toFixed(2)
            }));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE PAGESPEED INSIGHTS API
    // ═══════════════════════════════════════════════════════════════════════════

    const PageSpeed = {
        baseUrl: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',

        async analyze(url, strategy = 'mobile') {
            const cacheKey = `pagespeed_${url}_${strategy}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const apiKey = window.APP_CONFIG?.GOOGLE?.API_KEY;
            const params = new URLSearchParams({
                url,
                strategy,
                category: ['performance', 'accessibility', 'best-practices', 'seo'].join('&category=')
            });

            if (apiKey) params.set('key', apiKey);

            const response = await fetch(`${this.baseUrl}?${params}`);
            if (!response.ok) throw new Error('PageSpeed analysis failed');

            const data = await response.json();
            const result = this.parseResult(data);

            Cache.set(cacheKey, result, window.APP_CONFIG?.CACHE_TTL?.PAGESPEED || 3600000);
            return result;
        },

        parseResult(data) {
            const lighthouse = data.lighthouseResult;
            const categories = lighthouse?.categories || {};
            const audits = lighthouse?.audits || {};

            return {
                scores: {
                    performance: Math.round((categories.performance?.score || 0) * 100),
                    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
                    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
                    seo: Math.round((categories.seo?.score || 0) * 100)
                },
                coreWebVitals: {
                    lcp: {
                        value: audits['largest-contentful-paint']?.numericValue || 0,
                        score: audits['largest-contentful-paint']?.score || 0,
                        displayValue: audits['largest-contentful-paint']?.displayValue || 'N/A'
                    },
                    fid: {
                        value: audits['max-potential-fid']?.numericValue || 0,
                        score: audits['max-potential-fid']?.score || 0,
                        displayValue: audits['max-potential-fid']?.displayValue || 'N/A'
                    },
                    cls: {
                        value: audits['cumulative-layout-shift']?.numericValue || 0,
                        score: audits['cumulative-layout-shift']?.score || 0,
                        displayValue: audits['cumulative-layout-shift']?.displayValue || 'N/A'
                    },
                    ttfb: {
                        value: audits['server-response-time']?.numericValue || 0,
                        displayValue: audits['server-response-time']?.displayValue || 'N/A'
                    },
                    fcp: {
                        value: audits['first-contentful-paint']?.numericValue || 0,
                        score: audits['first-contentful-paint']?.score || 0,
                        displayValue: audits['first-contentful-paint']?.displayValue || 'N/A'
                    },
                    speedIndex: {
                        value: audits['speed-index']?.numericValue || 0,
                        score: audits['speed-index']?.score || 0,
                        displayValue: audits['speed-index']?.displayValue || 'N/A'
                    }
                },
                opportunities: Object.values(audits)
                    .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 1)
                    .map(a => ({
                        id: a.id,
                        title: a.title,
                        description: a.description,
                        savings: a.details?.overallSavingsMs || 0
                    }))
                    .sort((a, b) => b.savings - a.savings)
                    .slice(0, 10),
                diagnostics: Object.values(audits)
                    .filter(a => a.details?.type === 'table' && a.score !== null && a.score < 1)
                    .map(a => ({
                        id: a.id,
                        title: a.title,
                        description: a.description,
                        displayValue: a.displayValue
                    }))
                    .slice(0, 10)
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // REAL WEBSITE CRAWLER (uses seo-audit.js)
    // ═══════════════════════════════════════════════════════════════════════════

    const Crawler = {
        async crawlSite(url, options = {}) {
            const {
                maxPages = 100,
                maxDepth = 3,
                onProgress = () => {}
            } = options;

            // Check if SEOAudit is available
            if (typeof window.SEOAudit === 'undefined') {
                throw new Error('SEO Audit module not loaded');
            }

            return new Promise((resolve, reject) => {
                const audit = new window.SEOAudit(url, {
                    maxPages,
                    maxDepth,
                    checkBrokenLinks: true,
                    checkDuplicates: true,
                    onProgress: (progress) => {
                        onProgress({
                            phase: progress.phase || 'crawling',
                            current: progress.crawledUrls?.length || 0,
                            total: progress.totalUrls || maxPages,
                            message: progress.message || 'Crawling...'
                        });
                    },
                    onComplete: (results) => {
                        resolve(this.formatResults(results));
                    },
                    onError: (error) => {
                        reject(error);
                    }
                });

                audit.start();
            });
        },

        formatResults(results) {
            return {
                summary: {
                    pagesFound: results.crawledUrls?.length || 0,
                    issuesFound: results.issues?.length || 0,
                    healthScore: this.calculateHealthScore(results),
                    crawlTime: results.duration || 0
                },
                pages: results.crawledUrls || [],
                issues: (results.issues || []).map(issue => ({
                    severity: issue.severity || 'medium',
                    category: issue.category || 'general',
                    title: issue.title || issue.message,
                    description: issue.description || '',
                    url: issue.url || '',
                    recommendation: issue.recommendation || ''
                })),
                brokenLinks: results.brokenLinks || [],
                duplicates: results.duplicates || [],
                performance: results.performance || {}
            };
        },

        calculateHealthScore(results) {
            let score = 100;
            const issues = results.issues || [];

            issues.forEach(issue => {
                switch (issue.severity) {
                    case 'critical': score -= 10; break;
                    case 'high': score -= 5; break;
                    case 'medium': score -= 2; break;
                    case 'low': score -= 1; break;
                }
            });

            return Math.max(0, Math.min(100, score));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DATAFORSEO API (affordable SEO data alternative)
    // ═══════════════════════════════════════════════════════════════════════════

    const DataForSEO = {
        baseUrl: 'https://api.dataforseo.com/v3',

        getAuth() {
            const config = window.APP_CONFIG?.SEO_TOOLS?.DATAFORSEO;
            if (!config?.LOGIN || !config?.PASSWORD) return null;
            return btoa(`${config.LOGIN}:${config.PASSWORD}`);
        },

        async request(endpoint, data) {
            const auth = this.getAuth();
            if (!auth) throw new Error('DataForSEO not configured');

            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) throw new Error('DataForSEO request failed');
            return await response.json();
        },

        async getKeywordData(keywords, location = 2840) { // 2840 = USA
            const cacheKey = `dfs_keywords_${keywords.join(',')}_${location}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const result = await this.request('/keywords_data/google/search_volume/live', [{
                keywords,
                location_code: location,
                language_code: 'en'
            }]);

            const data = result.tasks?.[0]?.result || [];
            Cache.set(cacheKey, data, window.APP_CONFIG?.CACHE_TTL?.KEYWORDS || 86400000);
            return data;
        },

        async getBacklinks(target, limit = 100) {
            const cacheKey = `dfs_backlinks_${target}_${limit}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const result = await this.request('/backlinks/backlinks/live', [{
                target,
                limit,
                order_by: ['rank,desc']
            }]);

            const data = result.tasks?.[0]?.result?.[0]?.items || [];
            Cache.set(cacheKey, data, window.APP_CONFIG?.CACHE_TTL?.BACKLINKS || 86400000);
            return data;
        },

        async getDomainMetrics(domain) {
            const cacheKey = `dfs_domain_${domain}`;
            const cached = Cache.get(cacheKey);
            if (cached) return cached;

            const result = await this.request('/backlinks/summary/live', [{
                target: domain
            }]);

            const data = result.tasks?.[0]?.result?.[0] || {};
            Cache.set(cacheKey, data, window.APP_CONFIG?.CACHE_TTL?.BACKLINKS || 86400000);
            return data;
        },

        async getCompetitors(domain) {
            const result = await this.request('/dataforseo_labs/google/competitors_domain/live', [{
                target: domain,
                location_code: 2840,
                language_code: 'en',
                limit: 10
            }]);

            return result.tasks?.[0]?.result?.[0]?.items || [];
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIFIED PRODUCTION API
    // ═══════════════════════════════════════════════════════════════════════════

    const ProductionAPI = {
        // Auth
        GoogleAuth,

        // Data sources
        SearchConsole,
        Analytics,
        PageSpeed,
        Crawler,
        DataForSEO,

        // Cache
        Cache,

        /**
         * Get site health data from multiple sources
         */
        async getSiteHealth(siteUrl) {
            const results = {
                score: 0,
                issues: { critical: 0, warnings: 0, passed: 0 },
                sources: []
            };

            try {
                // Get PageSpeed data
                const pagespeed = await PageSpeed.analyze(siteUrl, 'mobile');
                results.score = pagespeed.scores.performance;
                results.pagespeed = pagespeed;
                results.sources.push('pagespeed');
            } catch (e) {
                console.warn('PageSpeed fetch failed:', e);
            }

            try {
                // Get Search Console data if authorized
                if (GoogleAuth.isAuthorized()) {
                    const keywords = await SearchConsole.getKeywords(siteUrl);
                    results.keywords = keywords;
                    results.sources.push('search_console');
                }
            } catch (e) {
                console.warn('Search Console fetch failed:', e);
            }

            return results;
        },

        /**
         * Get traffic data from Analytics
         */
        async getTraffic(days = 30) {
            if (!GoogleAuth.isAuthorized()) {
                return { error: 'Not authorized', requiresAuth: true };
            }

            try {
                const [overview, sources, trend] = await Promise.all([
                    Analytics.getTrafficOverview(days),
                    Analytics.getTrafficBySource(days),
                    Analytics.getTrafficTrend(days)
                ]);

                return { overview, sources, trend };
            } catch (e) {
                console.error('Analytics fetch failed:', e);
                return { error: e.message };
            }
        },

        /**
         * Get keyword rankings from Search Console
         */
        async getKeywords(siteUrl) {
            if (!GoogleAuth.isAuthorized()) {
                return { error: 'Not authorized', requiresAuth: true };
            }

            try {
                return await SearchConsole.getKeywords(siteUrl);
            } catch (e) {
                console.error('Keywords fetch failed:', e);
                return { error: e.message };
            }
        },

        /**
         * Get backlinks from DataForSEO
         */
        async getBacklinks(domain) {
            const config = window.APP_CONFIG?.SEO_TOOLS?.DATAFORSEO;
            if (!config?.ENABLED) {
                return { error: 'DataForSEO not configured', requiresConfig: true };
            }

            try {
                const [backlinks, metrics] = await Promise.all([
                    DataForSEO.getBacklinks(domain, 100),
                    DataForSEO.getDomainMetrics(domain)
                ]);

                return {
                    total: metrics.backlinks || 0,
                    domains: metrics.referring_domains || 0,
                    domainRank: metrics.rank || 0,
                    list: backlinks
                };
            } catch (e) {
                console.error('Backlinks fetch failed:', e);
                return { error: e.message };
            }
        },

        /**
         * Run a full site audit
         */
        async runAudit(url, options = {}) {
            return await Crawler.crawlSite(url, options);
        },

        /**
         * Check if APIs are configured
         */
        getApiStatus() {
            return {
                googleAuth: GoogleAuth.isAuthorized(),
                searchConsole: !!window.APP_CONFIG?.GOOGLE?.CLIENT_ID,
                analytics: !!window.APP_CONFIG?.GOOGLE?.ANALYTICS?.PROPERTY_ID,
                pagespeed: true, // Always available
                dataForSEO: !!window.APP_CONFIG?.SEO_TOOLS?.DATAFORSEO?.LOGIN,
                ahrefs: !!window.APP_CONFIG?.SEO_TOOLS?.AHREFS?.API_KEY,
                semrush: !!window.APP_CONFIG?.SEO_TOOLS?.SEMRUSH?.API_KEY
            };
        }
    };

    // Export to window
    window.ProductionAPI = ProductionAPI;

})();
