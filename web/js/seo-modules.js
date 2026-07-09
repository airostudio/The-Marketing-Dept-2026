/**
 * SEO Modules - Real Data Fetching
 * Provides real SEO data for Core Web Vitals, Broken Links, Indexing, and Mobile testing
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // All PageSpeed calls go through the Vercel proxy — no client-side key needed
        pageSpeedProxy: '/api/pagespeed',
        corsProxies: [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ],
        timeout: 90000, // 90 seconds for PageSpeed API
        retryAttempts: 3,
        retryDelay: 2000
    };

    /**
     * Get current project - uses ProjectService if available, localStorage fallback
     */
    function getCurrentProject() {
        // Use ProjectService if available (for Supabase-backed storage)
        if (window.ProjectService?.getCurrentProjectSync) {
            return window.ProjectService.getCurrentProjectSync();
        }

        // Fallback to localStorage
        const projectId = localStorage.getItem('seo-current-project');
        if (!projectId) return null;

        const projects = JSON.parse(localStorage.getItem('seo-projects') || '[]');
        return projects.find(p => p.id === projectId) || null;
    }

    /**
     * ==========================================
     * CORE WEB VITALS MODULE
     * ==========================================
     */
    const CoreWebVitals = {
        /**
         * Fetch real Core Web Vitals data using PageSpeed Insights API
         */
        async fetchData(url, onProgress = null) {
            if (!url) {
                const project = getCurrentProject();
                url = project?.websiteUrl;
            }

            if (!url) {
                throw new Error('No URL provided. Please create a project with a website URL first.');
            }

            // Normalize URL
            try {
                const normalizedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
                url = normalizedUrl.href;
            } catch (e) {
                throw new Error('Invalid URL format. Please provide a valid website URL.');
            }

            const results = {
                url: url,
                timestamp: new Date().toISOString(),
                desktop: null,
                mobile: null,
                errors: []
            };

            if (onProgress) onProgress({ phase: 'mobile', message: 'Analyzing mobile performance...' });

            // Fetch mobile data first (more important for SEO)
            try {
                results.mobile = await this.fetchPageSpeedData(url, 'mobile');
            } catch (error) {
                console.error('[PageSpeed] Mobile analysis failed:', error);
                results.errors.push({ strategy: 'mobile', error: error.message });
            }

            if (onProgress) onProgress({ phase: 'desktop', message: 'Analyzing desktop performance...' });

            // Fetch desktop data
            try {
                results.desktop = await this.fetchPageSpeedData(url, 'desktop');
            } catch (error) {
                console.error('[PageSpeed] Desktop analysis failed:', error);
                results.errors.push({ strategy: 'desktop', error: error.message });
            }

            // If both failed, throw an error
            if (!results.mobile && !results.desktop) {
                const errorMessages = results.errors.map(e => e.error).join('; ');
                throw new Error(`Failed to analyze website: ${errorMessages}`);
            }

            // Save results
            localStorage.setItem('seo-cwv-data', JSON.stringify(results));

            if (onProgress) onProgress({ phase: 'complete', message: 'Analysis complete!' });

            return results;
        },

        /**
         * Fetch PageSpeed Insights data with retry logic
         */
        async fetchPageSpeedData(url, strategy = 'mobile') {
            // Route through Vercel proxy — API key is in env vars on the server
            const apiUrl = `${CONFIG.pageSpeedProxy}?url=${encodeURIComponent(url)}&strategy=${strategy}`;

            let lastError = null;

            // Retry logic for transient failures
            for (let attempt = 1; attempt <= CONFIG.retryAttempts; attempt++) {
                try {
                    console.log(`[PageSpeed] Fetching ${strategy} data for ${url} (attempt ${attempt}/${CONFIG.retryAttempts})`);

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

                    const response = await fetch(apiUrl, {
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        const errorBody = await response.text();
                        let errorMessage = `PageSpeed API error: ${response.status}`;

                        try {
                            const errorJson = JSON.parse(errorBody);
                            if (errorJson.error?.message) {
                                errorMessage = errorJson.error.message;
                            }
                        } catch (e) {
                            // Use default error message
                        }

                        // Don't retry on client errors (4xx) except 429 (rate limit)
                        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                            throw new Error(errorMessage);
                        }

                        lastError = new Error(errorMessage);
                        console.warn(`[PageSpeed] Attempt ${attempt} failed:`, errorMessage);

                        if (attempt < CONFIG.retryAttempts) {
                            await new Promise(r => setTimeout(r, CONFIG.retryDelay * attempt));
                        }
                        continue; // body consumed by response.text() — never reach response.json()
                    }

                    const data = await response.json();
                    console.log(`[PageSpeed] Successfully fetched ${strategy} data`);
                    return this.parsePageSpeedResponse(data, strategy);

                } catch (error) {
                    lastError = error;
                    console.warn(`[PageSpeed] Attempt ${attempt} error:`, error.message);

                    if (error.name === 'AbortError') {
                        lastError = new Error('PageSpeed API request timed out. The target site may be slow to respond.');
                    }

                    if (attempt < CONFIG.retryAttempts) {
                        await new Promise(r => setTimeout(r, CONFIG.retryDelay * attempt));
                    }
                }
            }

            console.error(`[PageSpeed] All ${CONFIG.retryAttempts} attempts failed for ${strategy}:`, lastError);
            throw lastError || new Error('Failed to fetch PageSpeed data');
        },

        /**
         * Parse PageSpeed Insights response
         */
        parsePageSpeedResponse(data, strategy) {
            const lighthouse = data.lighthouseResult;
            if (!lighthouse) return null;

            const audits = lighthouse.audits || {};
            const categories = lighthouse.categories || {};

            // Extract Core Web Vitals
            const cwv = {
                strategy: strategy,
                scores: {
                    performance: Math.round((categories.performance?.score || 0) * 100),
                    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
                    seo: Math.round((categories.seo?.score || 0) * 100)
                },
                metrics: {
                    // Largest Contentful Paint
                    lcp: {
                        value: audits['largest-contentful-paint']?.numericValue || 0,
                        displayValue: audits['largest-contentful-paint']?.displayValue || '--',
                        score: audits['largest-contentful-paint']?.score || 0
                    },
                    // First Input Delay / Total Blocking Time (FID proxy)
                    fid: {
                        value: audits['total-blocking-time']?.numericValue || 0,
                        displayValue: audits['total-blocking-time']?.displayValue || '--',
                        score: audits['total-blocking-time']?.score || 0
                    },
                    // Cumulative Layout Shift
                    cls: {
                        value: audits['cumulative-layout-shift']?.numericValue || 0,
                        displayValue: audits['cumulative-layout-shift']?.displayValue || '--',
                        score: audits['cumulative-layout-shift']?.score || 0
                    },
                    // Interaction to Next Paint
                    inp: {
                        value: audits['interactive']?.numericValue || 0,
                        displayValue: audits['interactive']?.displayValue || '--',
                        score: audits['interactive']?.score || 0
                    },
                    // First Contentful Paint
                    fcp: {
                        value: audits['first-contentful-paint']?.numericValue || 0,
                        displayValue: audits['first-contentful-paint']?.displayValue || '--',
                        score: audits['first-contentful-paint']?.score || 0
                    },
                    // Time to First Byte
                    ttfb: {
                        value: audits['server-response-time']?.numericValue || 0,
                        displayValue: audits['server-response-time']?.displayValue || '--',
                        score: audits['server-response-time']?.score || 0
                    },
                    // Speed Index
                    speedIndex: {
                        value: audits['speed-index']?.numericValue || 0,
                        displayValue: audits['speed-index']?.displayValue || '--',
                        score: audits['speed-index']?.score || 0
                    }
                },
                // Additional insights
                opportunities: [],
                diagnostics: []
            };

            // Extract opportunities (improvements)
            const opportunityAudits = [
                'render-blocking-resources',
                'unused-css-rules',
                'unused-javascript',
                'modern-image-formats',
                'offscreen-images',
                'unminified-css',
                'unminified-javascript',
                'efficiently-encode-images',
                'uses-optimized-images',
                'uses-text-compression'
            ];

            opportunityAudits.forEach(auditId => {
                const audit = audits[auditId];
                if (audit && audit.score !== null && audit.score < 1) {
                    cwv.opportunities.push({
                        id: auditId,
                        title: audit.title,
                        description: audit.description,
                        savings: audit.displayValue || '',
                        score: audit.score
                    });
                }
            });

            // Extract diagnostics
            const diagnosticAudits = [
                'dom-size',
                'critical-request-chains',
                'network-requests',
                'main-thread-tasks',
                'bootup-time',
                'font-display',
                'third-party-summary'
            ];

            diagnosticAudits.forEach(auditId => {
                const audit = audits[auditId];
                if (audit && audit.details) {
                    cwv.diagnostics.push({
                        id: auditId,
                        title: audit.title,
                        description: audit.description,
                        displayValue: audit.displayValue || ''
                    });
                }
            });

            return cwv;
        },

        /**
         * Get status label for a metric score
         */
        getStatus(score) {
            if (score >= 0.9) return { label: 'Good', class: 'good' };
            if (score >= 0.5) return { label: 'Needs Improvement', class: 'moderate' };
            return { label: 'Poor', class: 'poor' };
        },

        /**
         * Get cached CWV data
         */
        getCachedData() {
            const cached = localStorage.getItem('seo-cwv-data');
            return cached ? JSON.parse(cached) : null;
        }
    };

    /**
     * ==========================================
     * BROKEN LINKS MODULE
     * ==========================================
     */
    const BrokenLinks = {
        /**
         * Get broken links data from last audit
         */
        getData() {
            const data = localStorage.getItem('seo-broken-links');
            if (!data) return null;
            return JSON.parse(data);
        },

        /**
         * Check a single link's status
         */
        async checkLink(url) {
            for (const proxy of CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(url), {
                        method: 'HEAD',
                        signal: AbortSignal.timeout(10000)
                    });
                    return {
                        url: url,
                        status: response.status,
                        ok: response.ok
                    };
                } catch (e) {
                    try {
                        const response = await fetch(proxy + encodeURIComponent(url), {
                            signal: AbortSignal.timeout(10000)
                        });
                        return {
                            url: url,
                            status: response.status,
                            ok: response.ok
                        };
                    } catch (e2) {
                        continue;
                    }
                }
            }
            return { url: url, status: 0, ok: false, error: 'Could not reach' };
        },

        /**
         * Check multiple links
         */
        async checkLinks(urls, onProgress) {
            const results = {
                checked: 0,
                total: urls.length,
                broken: [],
                redirects: [],
                working: []
            };

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                const result = await this.checkLink(url);

                results.checked++;

                if (result.status >= 400) {
                    results.broken.push(result);
                } else if (result.status >= 300 && result.status < 400) {
                    results.redirects.push(result);
                } else if (result.ok) {
                    results.working.push(result);
                }

                if (onProgress) {
                    onProgress(results);
                }

                // Small delay to avoid rate limiting
                await new Promise(r => setTimeout(r, 100));
            }

            // Save results
            localStorage.setItem('seo-link-check-results', JSON.stringify({
                timestamp: new Date().toISOString(),
                results: results
            }));

            return results;
        }
    };

    /**
     * ==========================================
     * INDEXING MODULE
     * ==========================================
     */
    const Indexing = {
        /**
         * Analyze site indexing status
         */
        async analyze(url) {
            if (!url) {
                const project = getCurrentProject();
                url = project?.websiteUrl;
            }

            if (!url) {
                throw new Error('No URL provided');
            }

            const baseUrl = new URL(url);
            const results = {
                url: url,
                timestamp: new Date().toISOString(),
                robotsTxt: null,
                sitemap: null,
                metaRobots: [],
                canonicals: [],
                issues: []
            };

            // Check robots.txt
            results.robotsTxt = await this.checkRobotsTxt(baseUrl.origin);

            // Check sitemap
            results.sitemap = await this.checkSitemap(baseUrl.origin);

            // Check meta robots and canonicals from crawled pages
            const lastAudit = JSON.parse(localStorage.getItem('seo-last-audit') || '{}');
            if (lastAudit.crawledUrls) {
                results.crawledPages = lastAudit.crawledUrls.length;
            }

            // Save results
            localStorage.setItem('seo-indexing-data', JSON.stringify(results));

            return results;
        },

        /**
         * Check robots.txt
         */
        async checkRobotsTxt(origin) {
            const robotsUrl = `${origin}/robots.txt`;

            for (const proxy of CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(robotsUrl), {
                        signal: AbortSignal.timeout(10000)
                    });

                    if (response.ok) {
                        const text = await response.text();
                        return this.parseRobotsTxt(text, robotsUrl);
                    }
                } catch (e) {
                    continue;
                }
            }

            return {
                exists: false,
                url: robotsUrl,
                rules: [],
                sitemaps: [],
                issues: ['robots.txt not found']
            };
        },

        /**
         * Parse robots.txt content
         */
        parseRobotsTxt(content, url) {
            const result = {
                exists: true,
                url: url,
                content: content,
                rules: [],
                sitemaps: [],
                issues: []
            };

            const lines = content.split('\n');
            let currentAgent = '*';

            lines.forEach(line => {
                line = line.trim();
                if (!line || line.startsWith('#')) return;

                const [directive, ...valueParts] = line.split(':');
                const value = valueParts.join(':').trim();

                if (directive.toLowerCase() === 'user-agent') {
                    currentAgent = value;
                } else if (directive.toLowerCase() === 'disallow') {
                    result.rules.push({
                        agent: currentAgent,
                        type: 'disallow',
                        path: value
                    });
                    // Check for problematic rules
                    if (value === '/' && currentAgent === '*') {
                        result.issues.push('Site is blocking all crawlers with Disallow: /');
                    }
                } else if (directive.toLowerCase() === 'allow') {
                    result.rules.push({
                        agent: currentAgent,
                        type: 'allow',
                        path: value
                    });
                } else if (directive.toLowerCase() === 'sitemap') {
                    result.sitemaps.push(value);
                }
            });

            if (result.rules.length === 0) {
                result.issues.push('robots.txt has no rules defined');
            }

            return result;
        },

        /**
         * Check sitemap
         */
        async checkSitemap(origin) {
            const sitemapUrl = `${origin}/sitemap.xml`;

            for (const proxy of CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(sitemapUrl), {
                        signal: AbortSignal.timeout(15000)
                    });

                    if (response.ok) {
                        const text = await response.text();
                        return this.parseSitemap(text, sitemapUrl);
                    }
                } catch (e) {
                    continue;
                }
            }

            return {
                exists: false,
                url: sitemapUrl,
                type: null,
                urls: [],
                issues: ['sitemap.xml not found']
            };
        },

        /**
         * Parse sitemap content
         */
        parseSitemap(content, url) {
            const result = {
                exists: true,
                url: url,
                type: 'unknown',
                urls: [],
                childSitemaps: [],
                lastmod: null,
                issues: []
            };

            // Check if sitemap index
            if (content.includes('<sitemapindex')) {
                result.type = 'index';
                const sitemapMatches = content.match(/<loc>([^<]+)<\/loc>/g) || [];
                result.childSitemaps = sitemapMatches.map(m => m.replace(/<\/?loc>/g, ''));
            } else if (content.includes('<urlset')) {
                result.type = 'urlset';
                const urlMatches = content.match(/<loc>([^<]+)<\/loc>/g) || [];
                result.urls = urlMatches.map(m => m.replace(/<\/?loc>/g, ''));

                // Check lastmod
                const lastmodMatch = content.match(/<lastmod>([^<]+)<\/lastmod>/);
                if (lastmodMatch) {
                    result.lastmod = lastmodMatch[1];
                }
            } else {
                result.issues.push('Invalid sitemap format');
            }

            // Check for issues
            if (result.urls.length === 0 && result.childSitemaps.length === 0) {
                result.issues.push('Sitemap is empty');
            }

            return result;
        },

        /**
         * Get cached indexing data
         */
        getCachedData() {
            const cached = localStorage.getItem('seo-indexing-data');
            return cached ? JSON.parse(cached) : null;
        }
    };

    /**
     * ==========================================
     * MOBILE FRIENDLINESS MODULE
     * ==========================================
     */
    const MobileFriendliness = {
        /**
         * Analyze mobile friendliness using PageSpeed Insights
         */
        async analyze(url) {
            if (!url) {
                const project = getCurrentProject();
                url = project?.websiteUrl;
            }

            if (!url) {
                throw new Error('No URL provided');
            }

            // Use mobile PageSpeed data
            const cwvData = CoreWebVitals.getCachedData();
            let mobileData = cwvData?.mobile;

            // If no cached data, fetch fresh
            if (!mobileData) {
                mobileData = await CoreWebVitals.fetchPageSpeedData(url, 'mobile');
            }

            const results = {
                url: url,
                timestamp: new Date().toISOString(),
                score: mobileData?.scores?.performance || 0,
                seoScore: mobileData?.scores?.seo || 0,
                accessibilityScore: mobileData?.scores?.accessibility || 0,
                metrics: mobileData?.metrics || {},
                issues: [],
                passed: []
            };

            // Analyze mobile-specific issues from PageSpeed
            if (mobileData?.opportunities) {
                mobileData.opportunities.forEach(opp => {
                    results.issues.push({
                        type: 'performance',
                        title: opp.title,
                        description: opp.description,
                        impact: opp.savings
                    });
                });
            }

            // Add mobile-specific checks
            const lastAudit = JSON.parse(localStorage.getItem('seo-last-audit') || '{}');
            if (lastAudit.issues) {
                const mobileIssues = lastAudit.issues.filter(i => i.category === 'Mobile');
                mobileIssues.forEach(issue => {
                    results.issues.push({
                        type: 'usability',
                        title: issue.title,
                        description: issue.description,
                        url: issue.url
                    });
                });
            }

            // Determine pass/fail criteria
            results.viewport = this.checkViewport(lastAudit);
            results.tapTargets = this.checkTapTargets(lastAudit);
            results.fontSizes = this.checkFontSizes(lastAudit);
            results.contentWidth = this.checkContentWidth(lastAudit);

            // Calculate overall mobile-friendly percentage
            let passedChecks = 0;
            let totalChecks = 4;

            if (results.viewport.pass) passedChecks++;
            if (results.tapTargets.pass) passedChecks++;
            if (results.fontSizes.pass) passedChecks++;
            if (results.contentWidth.pass) passedChecks++;

            results.mobileScore = Math.round((passedChecks / totalChecks) * 100);

            // Save results
            localStorage.setItem('seo-mobile-data', JSON.stringify(results));

            return results;
        },

        checkViewport(auditData) {
            // Check if any viewport issues were found
            const viewportIssues = (auditData.issues || []).filter(i =>
                i.title && i.title.toLowerCase().includes('viewport')
            );
            return {
                pass: viewportIssues.length === 0,
                issues: viewportIssues
            };
        },

        checkTapTargets(auditData) {
            const tapIssues = (auditData.issues || []).filter(i =>
                i.title && (i.title.toLowerCase().includes('tap') || i.title.toLowerCase().includes('click'))
            );
            return {
                pass: tapIssues.length === 0,
                issues: tapIssues
            };
        },

        checkFontSizes(auditData) {
            const fontIssues = (auditData.issues || []).filter(i =>
                i.title && (i.title.toLowerCase().includes('font') || i.title.toLowerCase().includes('text size'))
            );
            return {
                pass: fontIssues.length === 0,
                issues: fontIssues
            };
        },

        checkContentWidth(auditData) {
            const widthIssues = (auditData.issues || []).filter(i =>
                i.title && (i.title.toLowerCase().includes('width') || i.title.toLowerCase().includes('horizontal'))
            );
            return {
                pass: widthIssues.length === 0,
                issues: widthIssues
            };
        },

        /**
         * Get cached mobile data
         */
        getCachedData() {
            const cached = localStorage.getItem('seo-mobile-data');
            return cached ? JSON.parse(cached) : null;
        }
    };

    /**
     * ==========================================
     * UI UPDATER - Updates HTML pages with real data
     * ==========================================
     */
    const UIUpdater = {
        /**
         * Update Core Web Vitals page
         */
        updateCWVPage(data) {
            if (!data) return;

            const mobile = data.mobile;
            const desktop = data.desktop;

            // Update performance score
            const perfScore = document.querySelector('[data-metric="performance-score"]');
            if (perfScore && mobile) {
                perfScore.textContent = mobile.scores.performance;
                this.setScoreClass(perfScore, mobile.scores.performance / 100);
            }

            // Update LCP
            this.updateMetric('lcp', mobile?.metrics?.lcp);

            // Update FID/TBT
            this.updateMetric('fid', mobile?.metrics?.fid);

            // Update CLS
            this.updateMetric('cls', mobile?.metrics?.cls);

            // Update INP/TTI
            this.updateMetric('inp', mobile?.metrics?.inp);

            // Update FCP
            this.updateMetric('fcp', mobile?.metrics?.fcp);

            // Update TTFB
            this.updateMetric('ttfb', mobile?.metrics?.ttfb);

            // Update Speed Index
            this.updateMetric('speed-index', mobile?.metrics?.speedIndex);

            // Update status
            const statusEl = document.querySelector('[data-metric="cwv-status"]');
            if (statusEl && mobile) {
                const passed = mobile.metrics.lcp.score >= 0.9 &&
                              mobile.metrics.cls.score >= 0.9 &&
                              mobile.metrics.fid.score >= 0.9;
                statusEl.textContent = passed ? 'Passing' : 'Needs Improvement';
                statusEl.className = 'tag ' + (passed ? 'tag-success' : 'tag-warning');
            }

            // Update last checked time
            const lastChecked = document.querySelector('[data-metric="last-checked"]');
            if (lastChecked && data.timestamp) {
                lastChecked.textContent = this.formatTimeAgo(new Date(data.timestamp));
            }
        },

        /**
         * Update a single metric display
         */
        updateMetric(id, metric) {
            if (!metric) return;

            const valueEl = document.querySelector(`[data-metric="cwv-${id}"]`);
            const barEl = document.querySelector(`[data-metric="cwv-${id}-bar"]`);

            if (valueEl) {
                valueEl.textContent = metric.displayValue;
                this.setScoreClass(valueEl, metric.score);
            }

            if (barEl) {
                const percentage = Math.min(metric.score * 100, 100);
                barEl.style.width = percentage + '%';
                this.setScoreClass(barEl, metric.score);
            }
        },

        /**
         * Update Broken Links page
         */
        updateBrokenLinksPage(data) {
            if (!data) return;

            const totalEl = document.querySelector('[data-metric="total-broken"]');
            const internalEl = document.querySelector('[data-metric="internal-broken"]');
            const externalEl = document.querySelector('[data-metric="external-broken"]');
            const listEl = document.getElementById('brokenLinksList');

            const brokenLinks = data.links || [];

            if (totalEl) {
                totalEl.textContent = brokenLinks.length;
            }

            // Count internal vs external
            let internal = 0, external = 0;
            brokenLinks.forEach(link => {
                try {
                    const url = new URL(link.url);
                    const project = getCurrentProject();
                    const siteUrl = project?.websiteUrl ? new URL(project.websiteUrl) : null;
                    if (siteUrl && url.hostname === siteUrl.hostname) {
                        internal++;
                    } else {
                        external++;
                    }
                } catch (e) {
                    external++;
                }
            });

            if (internalEl) internalEl.textContent = internal;
            if (externalEl) externalEl.textContent = external;

            // Update list
            if (listEl && brokenLinks.length > 0) {
                listEl.innerHTML = brokenLinks.map(link => `
                    <div class="broken-link-item">
                        <div class="link-info">
                            <span class="status-badge status-${link.status}">${link.status}</span>
                            <a href="${this.escapeHtml(link.url)}" target="_blank" rel="noopener">${this.truncate(link.url, 60)}</a>
                        </div>
                        <div class="link-sources">
                            Found on: ${link.foundOn ? link.foundOn.map(u => this.truncate(u, 30)).join(', ') : 'Unknown'}
                        </div>
                    </div>
                `).join('');
            } else if (listEl) {
                listEl.innerHTML = `
                    <div class="empty-state">
                        <p>No broken links detected. Run an audit to check for broken links.</p>
                    </div>
                `;
            }

            // Update last checked
            const lastChecked = document.querySelector('[data-metric="last-checked"]');
            if (lastChecked && data.timestamp) {
                lastChecked.textContent = this.formatTimeAgo(new Date(data.timestamp));
            }
        },

        /**
         * Update Indexing page
         */
        updateIndexingPage(data) {
            if (!data) return;

            // Update robots.txt status
            const robotsStatus = document.querySelector('[data-metric="robots-status"]');
            if (robotsStatus && data.robotsTxt) {
                robotsStatus.textContent = data.robotsTxt.exists ? 'Found' : 'Not Found';
                robotsStatus.className = 'tag ' + (data.robotsTxt.exists ? 'tag-success' : 'tag-warning');
            }

            // Update sitemap status
            const sitemapStatus = document.querySelector('[data-metric="sitemap-status"]');
            if (sitemapStatus && data.sitemap) {
                sitemapStatus.textContent = data.sitemap.exists ? 'Found' : 'Not Found';
                sitemapStatus.className = 'tag ' + (data.sitemap.exists ? 'tag-success' : 'tag-warning');
            }

            // Update sitemap URL count
            const sitemapUrls = document.querySelector('[data-metric="sitemap-urls"]');
            if (sitemapUrls && data.sitemap) {
                const count = data.sitemap.urls?.length || data.sitemap.childSitemaps?.length || 0;
                sitemapUrls.textContent = count;
            }

            // Update crawled pages
            const crawledPages = document.querySelector('[data-metric="crawled-pages"]');
            if (crawledPages) {
                crawledPages.textContent = data.crawledPages || 0;
            }

            // Update issues list
            const issuesList = document.getElementById('indexingIssuesList');
            if (issuesList) {
                const allIssues = [
                    ...(data.robotsTxt?.issues || []),
                    ...(data.sitemap?.issues || [])
                ];

                if (allIssues.length > 0) {
                    issuesList.innerHTML = allIssues.map(issue => `
                        <div class="issue-item">
                            <span class="issue-icon">⚠️</span>
                            <span class="issue-text">${this.escapeHtml(issue)}</span>
                        </div>
                    `).join('');
                } else {
                    issuesList.innerHTML = `
                        <div class="success-state">
                            <span class="success-icon">✓</span>
                            <span>No indexing issues detected</span>
                        </div>
                    `;
                }
            }
        },

        /**
         * Update Mobile Friendliness page
         */
        updateMobilePage(data) {
            if (!data) return;

            // Update overall score
            const scoreEl = document.querySelector('[data-metric="mobile-score"]');
            if (scoreEl) {
                scoreEl.textContent = data.mobileScore + '%';
                this.setScoreClass(scoreEl, data.mobileScore / 100);
            }

            // Update performance score
            const perfEl = document.querySelector('[data-metric="mobile-performance"]');
            if (perfEl) {
                perfEl.textContent = data.score;
                this.setScoreClass(perfEl, data.score / 100);
            }

            // Update viewport check
            const viewportEl = document.querySelector('[data-metric="viewport-status"]');
            if (viewportEl) {
                viewportEl.textContent = data.viewport?.pass ? 'Pass' : 'Fail';
                viewportEl.className = 'status-badge ' + (data.viewport?.pass ? 'pass' : 'fail');
            }

            // Update tap targets check
            const tapEl = document.querySelector('[data-metric="tap-targets-status"]');
            if (tapEl) {
                tapEl.textContent = data.tapTargets?.pass ? 'Pass' : 'Fail';
                tapEl.className = 'status-badge ' + (data.tapTargets?.pass ? 'pass' : 'fail');
            }

            // Update font size check
            const fontEl = document.querySelector('[data-metric="font-size-status"]');
            if (fontEl) {
                fontEl.textContent = data.fontSizes?.pass ? 'Pass' : 'Fail';
                fontEl.className = 'status-badge ' + (data.fontSizes?.pass ? 'pass' : 'fail');
            }

            // Update content width check
            const widthEl = document.querySelector('[data-metric="content-width-status"]');
            if (widthEl) {
                widthEl.textContent = data.contentWidth?.pass ? 'Pass' : 'Fail';
                widthEl.className = 'status-badge ' + (data.contentWidth?.pass ? 'pass' : 'fail');
            }

            // Update issues list
            const issuesList = document.getElementById('mobileIssuesList');
            if (issuesList && data.issues) {
                if (data.issues.length > 0) {
                    issuesList.innerHTML = data.issues.map(issue => `
                        <div class="issue-item">
                            <div class="issue-header">
                                <span class="issue-type">${issue.type}</span>
                                <span class="issue-title">${this.escapeHtml(issue.title)}</span>
                            </div>
                            ${issue.description ? `<p class="issue-desc">${this.escapeHtml(issue.description)}</p>` : ''}
                            ${issue.impact ? `<span class="issue-impact">${issue.impact}</span>` : ''}
                        </div>
                    `).join('');
                } else {
                    issuesList.innerHTML = `
                        <div class="success-state">
                            <span class="success-icon">✓</span>
                            <span>No mobile issues detected</span>
                        </div>
                    `;
                }
            }
        },

        /**
         * Set score-based CSS class
         */
        setScoreClass(el, score) {
            el.classList.remove('good', 'moderate', 'poor', 'neutral');
            if (score >= 0.9) {
                el.classList.add('good');
            } else if (score >= 0.5) {
                el.classList.add('moderate');
            } else {
                el.classList.add('poor');
            }
        },

        /**
         * Format time ago
         */
        formatTimeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);
            if (seconds < 60) return 'just now';
            if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
            if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
            if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';
            return date.toLocaleDateString();
        },

        /**
         * Truncate string
         */
        truncate(str, len) {
            if (!str) return '';
            if (str.length <= len) return str;
            return str.substring(0, len - 3) + '...';
        },

        /**
         * Escape HTML
         */
        escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    };

    // Expose modules globally
    window.SEOModules = {
        CoreWebVitals,
        BrokenLinks,
        Indexing,
        MobileFriendliness,
        UIUpdater,
        getCurrentProject
    };

})();
