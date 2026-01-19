/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * API INTEGRATIONS SERVICE - Enterprise SEO Data Connections
 * The Marketing Department 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Real API integrations for production SEO data:
 * - Google PageSpeed Insights API
 * - Google Search Console API (OAuth 2.0)
 * - Site Crawler for Technical SEO
 * - Competitor Domain Analysis
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const API_CONFIG = {
        pageSpeed: {
            baseUrl: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
            categories: ['performance', 'accessibility', 'best-practices', 'seo'],
            strategies: ['mobile', 'desktop']
        },
        searchConsole: {
            authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            apiUrl: 'https://searchconsole.googleapis.com/webmasters/v3',
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        },
        cache: {
            pageSpeedTTL: 3600000, // 1 hour
            searchConsoleTTL: 1800000, // 30 minutes
            competitorTTL: 86400000 // 24 hours
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CACHE MANAGER
    // ═══════════════════════════════════════════════════════════════════════════

    const CacheManager = {
        get(key) {
            try {
                const cached = localStorage.getItem(`api-cache-${key}`);
                if (!cached) return null;

                const { data, expiry } = JSON.parse(cached);
                if (Date.now() > expiry) {
                    localStorage.removeItem(`api-cache-${key}`);
                    return null;
                }
                return data;
            } catch (e) {
                return null;
            }
        },

        set(key, data, ttl) {
            try {
                localStorage.setItem(`api-cache-${key}`, JSON.stringify({
                    data,
                    expiry: Date.now() + ttl
                }));
            } catch (e) {
                console.warn('Cache write failed:', e);
            }
        },

        clear(prefix) {
            const keys = Object.keys(localStorage).filter(k => k.startsWith(`api-cache-${prefix}`));
            keys.forEach(k => localStorage.removeItem(k));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // PAGESPEED INSIGHTS API
    // ═══════════════════════════════════════════════════════════════════════════

    const PageSpeedAPI = {
        getApiKey() {
            return localStorage.getItem('pagespeed-api-key') || '';
        },

        async analyze(url, strategy = 'mobile') {
            const apiKey = this.getApiKey();
            const cacheKey = `pagespeed-${strategy}-${url}`;

            // Check cache first
            const cached = CacheManager.get(cacheKey);
            if (cached) {
                console.log('PageSpeed: Using cached data for', url);
                return cached;
            }

            // Build API URL
            const params = new URLSearchParams({
                url: url.startsWith('http') ? url : `https://${url}`,
                strategy,
                category: API_CONFIG.pageSpeed.categories
            });

            if (apiKey) {
                params.append('key', apiKey);
            }

            const apiUrl = `${API_CONFIG.pageSpeed.baseUrl}?${params}`;

            try {
                console.log('PageSpeed: Fetching data for', url);
                const response = await fetch(apiUrl);

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error?.message || `API error: ${response.status}`);
                }

                const data = await response.json();
                const result = this.parseResults(data);

                // Cache the result
                CacheManager.set(cacheKey, result, API_CONFIG.cache.pageSpeedTTL);

                return result;
            } catch (error) {
                console.error('PageSpeed API error:', error);
                throw error;
            }
        },

        parseResults(data) {
            const lighthouse = data.lighthouseResult;
            const categories = lighthouse?.categories || {};
            const audits = lighthouse?.audits || {};

            // Core Web Vitals
            const cwv = {
                lcp: this.extractMetric(audits, 'largest-contentful-paint'),
                fid: this.extractMetric(audits, 'max-potential-fid'),
                cls: this.extractMetric(audits, 'cumulative-layout-shift'),
                fcp: this.extractMetric(audits, 'first-contentful-paint'),
                ttfb: this.extractMetric(audits, 'server-response-time'),
                tbt: this.extractMetric(audits, 'total-blocking-time'),
                si: this.extractMetric(audits, 'speed-index')
            };

            // Category scores
            const scores = {
                performance: Math.round((categories.performance?.score || 0) * 100),
                accessibility: Math.round((categories.accessibility?.score || 0) * 100),
                bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
                seo: Math.round((categories.seo?.score || 0) * 100)
            };

            // Issues and opportunities
            const issues = [];
            const opportunities = [];

            // Extract failed audits
            for (const [id, audit] of Object.entries(audits)) {
                if (audit.score !== null && audit.score < 0.9) {
                    const item = {
                        id,
                        title: audit.title,
                        description: audit.description,
                        score: audit.score,
                        displayValue: audit.displayValue,
                        impact: audit.score < 0.5 ? 'high' : audit.score < 0.75 ? 'medium' : 'low'
                    };

                    if (audit.details?.type === 'opportunity') {
                        item.savings = audit.details.overallSavingsMs;
                        opportunities.push(item);
                    } else if (audit.score < 0.9) {
                        issues.push(item);
                    }
                }
            }

            return {
                url: data.id,
                fetchTime: data.analysisUTCTimestamp,
                strategy: lighthouse?.configSettings?.emulatedFormFactor,
                scores,
                coreWebVitals: cwv,
                issues: issues.sort((a, b) => a.score - b.score).slice(0, 20),
                opportunities: opportunities.sort((a, b) => (b.savings || 0) - (a.savings || 0)).slice(0, 10),
                passedAudits: Object.values(audits).filter(a => a.score === 1).length,
                totalAudits: Object.keys(audits).length
            };
        },

        extractMetric(audits, id) {
            const audit = audits[id];
            if (!audit) return null;

            return {
                value: audit.numericValue,
                displayValue: audit.displayValue,
                score: audit.score,
                rating: audit.score >= 0.9 ? 'good' : audit.score >= 0.5 ? 'needs-improvement' : 'poor'
            };
        },

        async analyzeMultiplePages(urls, strategy = 'mobile', onProgress) {
            const results = [];
            let completed = 0;

            for (const url of urls) {
                try {
                    const result = await this.analyze(url, strategy);
                    results.push({ url, success: true, data: result });
                } catch (error) {
                    results.push({ url, success: false, error: error.message });
                }

                completed++;
                if (onProgress) {
                    onProgress(completed, urls.length, url);
                }

                // Rate limiting - wait 1 second between requests
                if (completed < urls.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            return results;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GOOGLE SEARCH CONSOLE API (OAuth 2.0)
    // ═══════════════════════════════════════════════════════════════════════════

    const SearchConsoleAPI = {
        state: {
            accessToken: null,
            refreshToken: null,
            tokenExpiry: null,
            clientId: null,
            clientSecret: null
        },

        initialize() {
            this.loadCredentials();
        },

        loadCredentials() {
            try {
                const saved = localStorage.getItem('gsc-credentials');
                if (saved) {
                    const creds = JSON.parse(saved);
                    this.state.accessToken = creds.accessToken;
                    this.state.refreshToken = creds.refreshToken;
                    this.state.tokenExpiry = creds.tokenExpiry;
                    this.state.clientId = creds.clientId;
                    this.state.clientSecret = creds.clientSecret;
                }
            } catch (e) {
                console.warn('Failed to load GSC credentials');
            }
        },

        saveCredentials() {
            try {
                localStorage.setItem('gsc-credentials', JSON.stringify(this.state));
            } catch (e) {
                console.warn('Failed to save GSC credentials');
            }
        },

        setClientCredentials(clientId, clientSecret) {
            this.state.clientId = clientId;
            this.state.clientSecret = clientSecret;
            this.saveCredentials();
        },

        getAuthUrl(redirectUri) {
            if (!this.state.clientId) {
                throw new Error('Client ID not configured');
            }

            const params = new URLSearchParams({
                client_id: this.state.clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: API_CONFIG.searchConsole.scopes.join(' '),
                access_type: 'offline',
                prompt: 'consent'
            });

            return `${API_CONFIG.searchConsole.authUrl}?${params}`;
        },

        async exchangeCode(code, redirectUri) {
            if (!this.state.clientId || !this.state.clientSecret) {
                throw new Error('OAuth credentials not configured');
            }

            const response = await fetch(API_CONFIG.searchConsole.tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: this.state.clientId,
                    client_secret: this.state.clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error_description || 'Token exchange failed');
            }

            const tokens = await response.json();
            this.state.accessToken = tokens.access_token;
            this.state.refreshToken = tokens.refresh_token;
            this.state.tokenExpiry = Date.now() + (tokens.expires_in * 1000);
            this.saveCredentials();

            return true;
        },

        async refreshAccessToken() {
            if (!this.state.refreshToken) {
                throw new Error('No refresh token available');
            }

            const response = await fetch(API_CONFIG.searchConsole.tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    refresh_token: this.state.refreshToken,
                    client_id: this.state.clientId,
                    client_secret: this.state.clientSecret,
                    grant_type: 'refresh_token'
                })
            });

            if (!response.ok) {
                throw new Error('Token refresh failed');
            }

            const tokens = await response.json();
            this.state.accessToken = tokens.access_token;
            this.state.tokenExpiry = Date.now() + (tokens.expires_in * 1000);
            this.saveCredentials();
        },

        async ensureValidToken() {
            if (!this.state.accessToken) {
                throw new Error('Not authenticated with Google Search Console');
            }

            if (this.state.tokenExpiry && Date.now() > this.state.tokenExpiry - 60000) {
                await this.refreshAccessToken();
            }
        },

        isAuthenticated() {
            return !!this.state.accessToken;
        },

        async apiRequest(endpoint, method = 'GET', body = null) {
            await this.ensureValidToken();

            const options = {
                method,
                headers: {
                    'Authorization': `Bearer ${this.state.accessToken}`,
                    'Content-Type': 'application/json'
                }
            };

            if (body) {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(`${API_CONFIG.searchConsole.apiUrl}${endpoint}`, options);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || `API error: ${response.status}`);
            }

            return response.json();
        },

        async getSites() {
            const data = await this.apiRequest('/sites');
            return data.siteEntry || [];
        },

        async getSearchAnalytics(siteUrl, options = {}) {
            const cacheKey = `gsc-analytics-${siteUrl}-${JSON.stringify(options)}`;
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;

            const endDate = options.endDate || new Date().toISOString().split('T')[0];
            const startDate = options.startDate || new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];

            const body = {
                startDate,
                endDate,
                dimensions: options.dimensions || ['query'],
                rowLimit: options.rowLimit || 1000,
                startRow: options.startRow || 0
            };

            if (options.dimensionFilterGroups) {
                body.dimensionFilterGroups = options.dimensionFilterGroups;
            }

            const encodedUrl = encodeURIComponent(siteUrl);
            const data = await this.apiRequest(`/sites/${encodedUrl}/searchAnalytics/query`, 'POST', body);

            const result = {
                rows: (data.rows || []).map(row => ({
                    keys: row.keys,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    ctr: row.ctr,
                    position: row.position
                })),
                responseAggregationType: data.responseAggregationType
            };

            CacheManager.set(cacheKey, result, API_CONFIG.cache.searchConsoleTTL);
            return result;
        },

        async getTopQueries(siteUrl, limit = 100) {
            const data = await this.getSearchAnalytics(siteUrl, {
                dimensions: ['query'],
                rowLimit: limit
            });

            return data.rows.map(row => ({
                query: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: (row.ctr * 100).toFixed(2),
                position: row.position.toFixed(1)
            }));
        },

        async getTopPages(siteUrl, limit = 100) {
            const data = await this.getSearchAnalytics(siteUrl, {
                dimensions: ['page'],
                rowLimit: limit
            });

            return data.rows.map(row => ({
                page: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: (row.ctr * 100).toFixed(2),
                position: row.position.toFixed(1)
            }));
        },

        async getQueryPerformance(siteUrl, query) {
            const data = await this.getSearchAnalytics(siteUrl, {
                dimensions: ['date'],
                dimensionFilterGroups: [{
                    filters: [{
                        dimension: 'query',
                        operator: 'equals',
                        expression: query
                    }]
                }]
            });

            return data.rows.map(row => ({
                date: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: row.ctr,
                position: row.position
            }));
        },

        disconnect() {
            this.state = {
                accessToken: null,
                refreshToken: null,
                tokenExpiry: null,
                clientId: this.state.clientId,
                clientSecret: this.state.clientSecret
            };
            this.saveCredentials();
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SITE CRAWLER - Technical SEO Analysis
    // ═══════════════════════════════════════════════════════════════════════════

    const SiteCrawler = {
        corsProxies: [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ],

        async fetchWithProxy(url) {
            for (const proxy of this.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(url), {
                        headers: { 'Accept': 'text/html' }
                    });
                    if (response.ok) {
                        return await response.text();
                    }
                } catch (e) {
                    continue;
                }
            }
            throw new Error('All proxies failed');
        },

        async analyzePage(url) {
            try {
                const html = await this.fetchWithProxy(url);
                return this.parsePageSEO(html, url);
            } catch (error) {
                return {
                    url,
                    error: error.message,
                    analyzed: false
                };
            }
        },

        parsePageSEO(html, url) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Title
            const title = doc.querySelector('title')?.textContent?.trim() || '';

            // Meta description
            const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

            // H1 tags
            const h1Tags = Array.from(doc.querySelectorAll('h1')).map(h => h.textContent?.trim());

            // H2 tags
            const h2Tags = Array.from(doc.querySelectorAll('h2')).map(h => h.textContent?.trim());

            // Canonical
            const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

            // Meta robots
            const metaRobots = doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '';

            // Images
            const images = Array.from(doc.querySelectorAll('img'));
            const imagesWithoutAlt = images.filter(img => !img.getAttribute('alt')).length;

            // Internal/External links
            const links = Array.from(doc.querySelectorAll('a[href]'));
            const urlHost = new URL(url).hostname;
            const internalLinks = links.filter(a => {
                try {
                    const href = a.getAttribute('href');
                    if (href.startsWith('/') || href.startsWith('#')) return true;
                    return new URL(href).hostname === urlHost;
                } catch { return false; }
            });
            const externalLinks = links.filter(a => {
                try {
                    const href = a.getAttribute('href');
                    if (href.startsWith('/') || href.startsWith('#')) return false;
                    return new URL(href).hostname !== urlHost;
                } catch { return false; }
            });

            // Word count (approximate)
            const bodyText = doc.body?.textContent || '';
            const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;

            // Structured data
            const structuredData = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
                .map(s => {
                    try { return JSON.parse(s.textContent); }
                    catch { return null; }
                })
                .filter(Boolean);

            // Open Graph
            const ogTags = {};
            doc.querySelectorAll('meta[property^="og:"]').forEach(m => {
                ogTags[m.getAttribute('property')] = m.getAttribute('content');
            });

            // Twitter Card
            const twitterTags = {};
            doc.querySelectorAll('meta[name^="twitter:"]').forEach(m => {
                twitterTags[m.getAttribute('name')] = m.getAttribute('content');
            });

            // Detect issues
            const issues = [];

            if (!title) {
                issues.push({ id: 'missing-title', severity: 'critical', message: 'Missing title tag' });
            } else if (title.length < 30) {
                issues.push({ id: 'short-title', severity: 'high', message: `Title too short (${title.length} chars)` });
            } else if (title.length > 60) {
                issues.push({ id: 'long-title', severity: 'medium', message: `Title too long (${title.length} chars)` });
            }

            if (!metaDesc) {
                issues.push({ id: 'missing-meta-desc', severity: 'high', message: 'Missing meta description' });
            } else if (metaDesc.length < 120) {
                issues.push({ id: 'short-meta-desc', severity: 'medium', message: `Meta description too short (${metaDesc.length} chars)` });
            } else if (metaDesc.length > 160) {
                issues.push({ id: 'long-meta-desc', severity: 'low', message: `Meta description too long (${metaDesc.length} chars)` });
            }

            if (h1Tags.length === 0) {
                issues.push({ id: 'missing-h1', severity: 'high', message: 'Missing H1 tag' });
            } else if (h1Tags.length > 1) {
                issues.push({ id: 'multiple-h1', severity: 'medium', message: `Multiple H1 tags (${h1Tags.length})` });
            }

            if (imagesWithoutAlt > 0) {
                issues.push({ id: 'missing-alt', severity: 'medium', message: `${imagesWithoutAlt} images missing alt text` });
            }

            if (!canonical) {
                issues.push({ id: 'missing-canonical', severity: 'medium', message: 'Missing canonical tag' });
            }

            if (wordCount < 300) {
                issues.push({ id: 'thin-content', severity: 'high', message: `Thin content (${wordCount} words)` });
            }

            if (structuredData.length === 0) {
                issues.push({ id: 'no-structured-data', severity: 'low', message: 'No structured data found' });
            }

            if (!ogTags['og:title'] || !ogTags['og:description']) {
                issues.push({ id: 'incomplete-og', severity: 'low', message: 'Incomplete Open Graph tags' });
            }

            return {
                url,
                analyzed: true,
                title: { text: title, length: title.length },
                metaDescription: { text: metaDesc, length: metaDesc.length },
                h1: h1Tags,
                h2: h2Tags.slice(0, 10),
                canonical,
                metaRobots,
                images: { total: images.length, withoutAlt: imagesWithoutAlt },
                links: { internal: internalLinks.length, external: externalLinks.length },
                wordCount,
                structuredData: structuredData.length,
                openGraph: ogTags,
                twitter: twitterTags,
                issues,
                score: Math.max(0, 100 - issues.reduce((sum, i) => {
                    const severity = { critical: 20, high: 10, medium: 5, low: 2 };
                    return sum + (severity[i.severity] || 0);
                }, 0))
            };
        },

        async crawlSite(baseUrl, options = {}) {
            const maxPages = options.maxPages || 20;
            const visited = new Set();
            const toVisit = [baseUrl];
            const results = [];

            const onProgress = options.onProgress || (() => {});

            while (toVisit.length > 0 && results.length < maxPages) {
                const url = toVisit.shift();
                if (visited.has(url)) continue;
                visited.add(url);

                onProgress(results.length + 1, maxPages, url);

                const result = await this.analyzePage(url);
                results.push(result);

                // Extract internal links to crawl
                if (result.analyzed && result.links) {
                    // In a real implementation, we'd extract and queue internal links
                    // For now, we just analyze the provided URL
                }

                // Rate limiting
                await new Promise(r => setTimeout(r, 500));
            }

            return {
                baseUrl,
                pagesAnalyzed: results.length,
                results,
                summary: this.summarizeResults(results)
            };
        },

        summarizeResults(results) {
            const analyzed = results.filter(r => r.analyzed);
            const allIssues = analyzed.flatMap(r => r.issues || []);

            const issueCounts = {};
            allIssues.forEach(i => {
                issueCounts[i.id] = (issueCounts[i.id] || 0) + 1;
            });

            return {
                pagesAnalyzed: analyzed.length,
                pagesFailed: results.length - analyzed.length,
                avgScore: analyzed.length > 0
                    ? Math.round(analyzed.reduce((sum, r) => sum + r.score, 0) / analyzed.length)
                    : 0,
                totalIssues: allIssues.length,
                criticalIssues: allIssues.filter(i => i.severity === 'critical').length,
                highIssues: allIssues.filter(i => i.severity === 'high').length,
                mediumIssues: allIssues.filter(i => i.severity === 'medium').length,
                lowIssues: allIssues.filter(i => i.severity === 'low').length,
                topIssues: Object.entries(issueCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([id, count]) => ({ id, count }))
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPETITOR ANALYZER
    // ═══════════════════════════════════════════════════════════════════════════

    const CompetitorAnalyzer = {
        async analyzeCompetitor(domain) {
            const cacheKey = `competitor-${domain}`;
            const cached = CacheManager.get(cacheKey);
            if (cached) return cached;

            const url = domain.startsWith('http') ? domain : `https://${domain}`;

            try {
                // Analyze competitor homepage
                const pageAnalysis = await SiteCrawler.analyzePage(url);

                // Get PageSpeed data if API key available
                let pageSpeed = null;
                if (PageSpeedAPI.getApiKey()) {
                    try {
                        pageSpeed = await PageSpeedAPI.analyze(url, 'mobile');
                    } catch (e) {
                        console.warn('PageSpeed analysis failed for competitor:', e);
                    }
                }

                const result = {
                    domain,
                    url,
                    analyzed: true,
                    analyzedAt: new Date().toISOString(),
                    seo: pageAnalysis.analyzed ? {
                        title: pageAnalysis.title,
                        metaDescription: pageAnalysis.metaDescription,
                        h1: pageAnalysis.h1,
                        wordCount: pageAnalysis.wordCount,
                        structuredData: pageAnalysis.structuredData,
                        score: pageAnalysis.score,
                        issues: pageAnalysis.issues
                    } : null,
                    performance: pageSpeed ? {
                        scores: pageSpeed.scores,
                        coreWebVitals: pageSpeed.coreWebVitals
                    } : null,
                    estimatedMetrics: this.estimateMetrics(domain, pageAnalysis, pageSpeed)
                };

                CacheManager.set(cacheKey, result, API_CONFIG.cache.competitorTTL);
                return result;
            } catch (error) {
                return {
                    domain,
                    url,
                    analyzed: false,
                    error: error.message
                };
            }
        },

        estimateMetrics(domain, pageAnalysis, pageSpeed) {
            // Estimate DA based on various signals
            let estimatedDA = 30; // Base

            if (pageAnalysis.analyzed) {
                if (pageAnalysis.structuredData > 0) estimatedDA += 5;
                if (pageAnalysis.wordCount > 1000) estimatedDA += 5;
                if (pageAnalysis.score > 80) estimatedDA += 10;
            }

            if (pageSpeed) {
                if (pageSpeed.scores.performance > 80) estimatedDA += 5;
                if (pageSpeed.scores.seo > 90) estimatedDA += 5;
            }

            // Known domains get higher estimates
            const knownDomains = {
                'semrush.com': 95, 'ahrefs.com': 94, 'moz.com': 92,
                'backlinko.com': 85, 'neilpatel.com': 90, 'hubspot.com': 93
            };

            if (knownDomains[domain]) {
                estimatedDA = knownDomains[domain];
            }

            return {
                domainAuthority: Math.min(100, estimatedDA),
                confidence: pageAnalysis.analyzed ? 'medium' : 'low'
            };
        },

        async compareCompetitors(competitors) {
            const results = [];

            for (const competitor of competitors) {
                const analysis = await this.analyzeCompetitor(competitor.domain || competitor);
                results.push(analysis);
            }

            return {
                competitors: results,
                comparison: this.generateComparison(results)
            };
        },

        generateComparison(results) {
            const analyzed = results.filter(r => r.analyzed);

            if (analyzed.length === 0) {
                return { error: 'No competitors could be analyzed' };
            }

            return {
                avgSEOScore: Math.round(
                    analyzed.filter(r => r.seo).reduce((sum, r) => sum + r.seo.score, 0) /
                    analyzed.filter(r => r.seo).length
                ),
                avgDA: Math.round(
                    analyzed.reduce((sum, r) => sum + r.estimatedMetrics.domainAuthority, 0) / analyzed.length
                ),
                topPerformer: analyzed.reduce((best, r) =>
                    r.seo && (!best || r.seo.score > best.seo.score) ? r : best
                , null)?.domain,
                commonIssues: this.findCommonIssues(analyzed)
            };
        },

        findCommonIssues(results) {
            const issueCounts = {};
            results.forEach(r => {
                if (r.seo?.issues) {
                    r.seo.issues.forEach(i => {
                        issueCounts[i.id] = (issueCounts[i.id] || 0) + 1;
                    });
                }
            });

            return Object.entries(issueCounts)
                .filter(([, count]) => count > 1)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([id, count]) => ({ id, count }));
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    window.APIIntegrations = {
        // PageSpeed Insights
        PageSpeed: PageSpeedAPI,

        // Google Search Console
        SearchConsole: SearchConsoleAPI,

        // Site Crawler
        Crawler: SiteCrawler,

        // Competitor Analysis
        Competitor: CompetitorAnalyzer,

        // Cache management
        Cache: CacheManager,

        // Initialize
        initialize() {
            SearchConsoleAPI.initialize();
            console.log('API Integrations Service initialized');
        },

        // Check API status
        getStatus() {
            return {
                pageSpeed: {
                    configured: !!PageSpeedAPI.getApiKey(),
                    apiKey: PageSpeedAPI.getApiKey() ? '***configured***' : null
                },
                searchConsole: {
                    configured: !!SearchConsoleAPI.state.clientId,
                    authenticated: SearchConsoleAPI.isAuthenticated()
                }
            };
        }
    };

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.APIIntegrations.initialize());
    } else {
        window.APIIntegrations.initialize();
    }

})();
