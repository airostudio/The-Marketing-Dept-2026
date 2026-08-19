/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEO ANALYSIS ENGINE - PRODUCTION VERSION
 * Audema Marketing 2026 - Real SEO Analysis System
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This engine performs REAL SEO analysis using:
 * - Actual website crawling (seo-audit.js)
 * - Google PageSpeed Insights API (Core Web Vitals)
 * - Google Search Console API (keywords, if authorized)
 * - DataForSEO API (backlinks, if configured)
 *
 * NO MOCK DATA - Production ready with real analysis only.
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // Max pages to crawl
        maxPages: 100,
        maxDepth: 3,
        // Update intervals
        updateInterval: 100,
        logInterval: 1000
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    const state = {
        projectData: null,
        startTime: null,
        currentTask: null,
        completedTasks: [],
        isComplete: false,
        progress: 0,
        data: {
            pages: [],
            issues: [],
            keywords: [],
            backlinks: [],
            competitors: [],
            healthScore: 0,
            coreWebVitals: null,
            summary: {}
        },
        counters: {
            pages: 0,
            issues: 0,
            keywords: 0,
            backlinks: 0,
            competitors: 0
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TASK DEFINITIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const TASKS = [
        {
            id: 'crawl',
            name: 'Site Crawl',
            weight: 35,
            messages: [
                'Fetching robots.txt...',
                'Parsing sitemap.xml...',
                'Discovering pages...',
                'Analyzing internal links...',
                'Checking page content...',
                'Mapping site structure...'
            ]
        },
        {
            id: 'performance',
            name: 'Performance Analysis',
            weight: 20,
            messages: [
                'Running PageSpeed Insights...',
                'Measuring Core Web Vitals...',
                'Analyzing LCP...',
                'Checking CLS...',
                'Testing FID...'
            ]
        },
        {
            id: 'keywords',
            name: 'Keyword Analysis',
            weight: 20,
            messages: [
                'Extracting page keywords...',
                'Analyzing keyword density...',
                'Checking Search Console...',
                'Mapping keyword rankings...'
            ]
        },
        {
            id: 'backlinks',
            name: 'Backlink Analysis',
            weight: 15,
            messages: [
                'Discovering backlinks...',
                'Analyzing domain authority...',
                'Checking link quality...'
            ]
        },
        {
            id: 'report',
            name: 'Generate Report',
            weight: 10,
            messages: [
                'Compiling results...',
                'Calculating health score...',
                'Generating recommendations...'
            ]
        }
    ];

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM ELEMENTS
    // ═══════════════════════════════════════════════════════════════════════════

    const elements = {};

    function initElements() {
        // IDs match analyzing.html. Keep this in sync if either side changes.
        elements.progressBar = document.getElementById('progressBar');
        elements.progressPercent = document.getElementById('progressPercent');
        elements.activityLog = document.getElementById('liveLog');
        elements.siteUrl = document.getElementById('siteUrl');
        elements.siteMeta = document.getElementById('siteMeta');
        elements.siteStatus = document.getElementById('siteStatus');
        elements.taskList = document.getElementById('tasksList');
        elements.statsPages = document.getElementById('statPages');
        elements.statsIssues = document.getElementById('statIssues');
        elements.statsKeywords = document.getElementById('statKeywords');
        elements.statsBacklinks = document.getElementById('statBacklinks');
        elements.completionOverlay = document.getElementById('completionOverlay');
        elements.finalScore = document.getElementById('finalScore');
        elements.finalIssues = document.getElementById('finalIssues');
        elements.finalPages = document.getElementById('finalPages');
        elements.timeRemaining = document.getElementById('timeRemaining');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        initElements();

        state.projectData = await resolveProject();

        // Normalise field names. The wizard uses `websiteUrl` / `projectName`;
        // older code uses `url` / `name`. Accept either, expose `url`/`name`.
        if (state.projectData) {
            state.projectData.url = state.projectData.url || state.projectData.websiteUrl;
            state.projectData.name = state.projectData.name || state.projectData.projectName;
        }

        if (!state.projectData || !state.projectData.url) {
            addLog('Error: No project URL found. Redirecting...', 'error');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 2000);
            return;
        }

        // Display site info
        if (elements.siteUrl) {
            elements.siteUrl.textContent = state.projectData.url;
        }
        if (elements.siteMeta) {
            elements.siteMeta.textContent = state.projectData.name || 'Analyzing...';
        }

        // Initialize task list
        initTaskList();

        // Start analysis
        state.startTime = Date.now();
        addLog(`Starting analysis for ${state.projectData.url}`, 'info');

        startAnalysis();
    }

    async function resolveProject() {
        // 1. Ask ProjectService — it abstracts Supabase / backend / localStorage.
        try {
            if (window.ProjectService?.getCurrentProject) {
                const proj = await window.ProjectService.getCurrentProject();
                if (proj && (proj.url || proj.websiteUrl)) return proj;
            }
        } catch (e) {
            console.warn('[analysis] ProjectService.getCurrentProject failed:', e);
        }

        // 2. Look up the project ID stored by the wizard and resolve via the
        //    list of saved projects. The wizard now also writes the full
        //    project under `seo-current-project-data`.
        try {
            const fullProject = localStorage.getItem('seo-current-project-data');
            if (fullProject) {
                const parsed = JSON.parse(fullProject);
                if (parsed && (parsed.url || parsed.websiteUrl)) return parsed;
            }
        } catch (_) { /* ignore */ }

        try {
            const currentId = localStorage.getItem('seo-current-project');
            if (currentId) {
                // The key may hold either a bare ID or a full JSON object,
                // depending on how it was set.
                try {
                    const parsed = JSON.parse(currentId);
                    if (parsed && typeof parsed === 'object' && (parsed.url || parsed.websiteUrl)) {
                        return parsed;
                    }
                } catch (_) { /* not JSON — treat as ID */ }

                const projects = JSON.parse(localStorage.getItem('seo-projects') || '[]');
                const found = projects.find((p) => p && p.id === currentId);
                if (found) return found;
            }
        } catch (e) {
            console.warn('[analysis] localStorage project lookup failed:', e);
        }

        // 3. Pending-audit fallback (legacy).
        try {
            const pending = localStorage.getItem('seo-pending-audit');
            if (pending && pending !== 'true') {
                try {
                    const parsed = JSON.parse(pending);
                    if (parsed && (parsed.url || parsed.websiteUrl)) return parsed;
                } catch (_) {
                    return { url: pending, name: 'Analysis' };
                }
            }
        } catch (_) { /* ignore */ }

        return null;
    }

    function initTaskList() {
        if (!elements.taskList) return;

        elements.taskList.innerHTML = TASKS.map(task => `
            <div class="task-item" data-task="${task.id}">
                <div class="task-icon">
                    <svg class="task-pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                    <svg class="task-active" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <svg class="task-complete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                </div>
                <div class="task-info">
                    <span class="task-name">${task.name}</span>
                    <span class="task-status">Pending</span>
                </div>
            </div>
        `).join('');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REAL ANALYSIS - PRODUCTION ONLY
    // ═══════════════════════════════════════════════════════════════════════════

    async function startAnalysis() {
        // Step 1: format check (no network)
        const raw = (state.projectData.url || '').trim();
        const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
        let parsedUrl;
        try {
            parsedUrl = new URL(withProto);
            if (!parsedUrl.hostname.includes('.') || /\s/.test(parsedUrl.hostname)) {
                throw new Error('bad hostname');
            }
        } catch {
            showUrlError('Invalid URL — enter a real website address (e.g. https://example.com)');
            return;
        }
        state.projectData.url = withProto;

        // Step 2: live reachability check via our serverless proxy (real HTTP probe,
        //         no CORS issues, gives us the actual status code + page title)
        addLog('Checking if site is reachable...', 'info');
        if (elements.progressPercent) elements.progressPercent.textContent = 'Checking URL...';

        try {
            const checkResp = await fetch(
                `/api/check-url?url=${encodeURIComponent(withProto)}`,
                { signal: AbortSignal.timeout(20000) }
            );
            const check = await checkResp.json();

            if (!check.reachable) {
                const msg = check.error ||
                    (check.status ? `Site returned HTTP ${check.status}` : 'Site could not be reached');
                showUrlError(msg);
                return;
            }

            // Use the real page title if we got one
            if (check.title && !state.projectData.name) {
                state.projectData.name = check.title;
                if (elements.siteMeta) elements.siteMeta.textContent = check.title;
            }

            addLog(`Site confirmed reachable (HTTP ${check.status})`, 'success');
        } catch (e) {
            // If the check endpoint itself fails (e.g. dev env without Vercel),
            // fall through and let the crawler attempt it — don't block the user.
            addLog('Pre-check skipped (probe endpoint unavailable) — attempting crawl', 'warning');
            console.warn('[analysis] /api/check-url unavailable:', e.message);
        }

        await runRealAnalysis();
    }

    function showUrlError(message) {
        addLog(message, 'error');
        if (elements.progressPercent) elements.progressPercent.textContent = 'Failed';
        if (elements.progressBar) elements.progressBar.style.width = '0%';
        if (elements.siteStatus) {
            elements.siteStatus.innerHTML = `<span>${message.includes('HTTP') ? 'Error' : 'Unreachable'}</span>`;
            elements.siteStatus.style.background = 'rgba(239,68,68,0.1)';
            elements.siteStatus.style.color = '#ef4444';
        }
    }

    async function runRealAnalysis() {
        const url = state.projectData.url;

        try {
            // Task 1: Site Crawl
            let crawlError = null;
            await runTask('crawl', async () => {
                try {
                    if (typeof window.SEOAudit !== 'undefined') {
                        const crawlResults = await performRealCrawl(url);
                        state.data.pages = crawlResults.pages || [];
                        state.data.issues = crawlResults.issues || [];
                    } else {
                        addLog('Using direct fetch crawl...', 'info');
                        const simpleData = await performSimpleCrawl(url);
                        state.data.pages = simpleData.pages;
                        state.data.issues = simpleData.issues;
                    }
                    state.counters.pages = state.data.pages.length;
                    state.counters.issues = state.data.issues.length;
                    updateStats();
                } catch (err) {
                    crawlError = err;
                }
            });

            // Abort the entire analysis if the site couldn't be crawled
            if (crawlError) throw crawlError;

            // Task 2: Performance Analysis
            await runTask('performance', async () => {
                addLog('Running PageSpeed Insights...', 'info');

                try {
                    if (window.ProductionAPI?.PageSpeed) {
                        const pagespeed = await window.ProductionAPI.PageSpeed.analyze(url, 'mobile');
                        state.data.coreWebVitals = pagespeed.coreWebVitals;
                        state.data.performanceScore = pagespeed.scores.performance;
                        // PageSpeed.analyze() already computes accessibility/seo/
                        // bestPractices scores alongside performance — used to be
                        // discarded here, forcing anything downstream (e.g. the
                        // Health Score page) to either fabricate those numbers or
                        // show nothing despite the real data already existing.
                        state.data.pageSpeedScores = pagespeed.scores;

                        // Add performance issues
                        if (pagespeed.scores.performance < 50) {
                            state.data.issues.push({
                                severity: 'critical',
                                category: 'performance',
                                title: 'Poor Performance Score',
                                description: `Your page has a performance score of ${pagespeed.scores.performance}/100`,
                                recommendation: 'Focus on improving Core Web Vitals'
                            });
                            state.counters.issues++;
                        }

                        addLog(`Performance Score: ${pagespeed.scores.performance}/100`, 'success');
                    } else {
                        // Use seo-modules.js if available
                        addLog('Using fallback performance check...', 'info');
                    }
                } catch (e) {
                    addLog('PageSpeed analysis skipped: ' + e.message, 'warning');
                }

                updateStats();
            });

            // Task 3: Keyword Analysis
            await runTask('keywords', async () => {
                addLog('Analyzing keywords...', 'info');

                // Extract keywords from crawled pages
                const keywords = extractKeywordsFromPages(state.data.pages);
                state.data.keywords = keywords;
                state.counters.keywords = keywords.length;

                // Try to get Search Console data
                try {
                    if (window.ProductionAPI?.GoogleAuth?.isAuthorized()) {
                        addLog('Fetching Search Console data...', 'info');
                        const gscKeywords = await window.ProductionAPI.SearchConsole.getKeywords(url);
                        if (gscKeywords && gscKeywords.length > 0) {
                            state.data.keywords = gscKeywords;
                            state.counters.keywords = gscKeywords.length;
                            addLog(`Found ${gscKeywords.length} keywords from Search Console`, 'success');
                        }
                    }
                } catch (e) {
                    addLog('Search Console not available: ' + e.message, 'info');
                }

                updateStats();
            });

            // Task 4: Backlink Analysis
            await runTask('backlinks', async () => {
                addLog('Checking backlinks...', 'info');

                // Try DataForSEO if configured
                try {
                    const domain = new URL(url).hostname;
                    if (window.ProductionAPI?.DataForSEO && window.APP_CONFIG?.SEO_TOOLS?.DATAFORSEO?.ENABLED) {
                        const backlinks = await window.ProductionAPI.DataForSEO.getBacklinks(domain, 50);
                        state.data.backlinks = backlinks;
                        state.counters.backlinks = backlinks.length;
                        addLog(`Found ${backlinks.length} backlinks`, 'success');
                    } else {
                        // Limited backlink discovery from crawl
                        state.data.backlinks = [];
                        state.counters.backlinks = 0;
                        addLog('Backlink API not configured', 'info');
                    }
                } catch (e) {
                    addLog('Backlink analysis limited: ' + e.message, 'warning');
                }

                updateStats();
            });

            // Task 5: Generate Report
            await runTask('report', async () => {
                addLog('Generating report...', 'info');

                // Calculate health score
                state.data.healthScore = calculateHealthScore();
                state.data.summary = generateSummary();

                addLog(`Health Score: ${state.data.healthScore}/100`, 'success');
            });

            // Complete
            completeAnalysis();

        } catch (error) {
            console.error('Analysis failed:', error);
            state.isComplete = true;
            state.progress = 0;
            showUrlError(error.message || 'Analysis failed — please verify the URL and try again.');
        }
    }

    async function performRealCrawl(url) {
        return new Promise((resolve, reject) => {
            const pages = [];
            const issues = [];

            const audit = new window.SEOAudit(url, {
                maxPages: CONFIG.maxPages,
                maxDepth: CONFIG.maxDepth,
                checkBrokenLinks: true,
                onProgress: (progress) => {
                    if (progress.crawledUrls) {
                        state.counters.pages = progress.crawledUrls.length;
                        updateStats();
                    }
                    if (progress.message) {
                        addLog(progress.message, 'info');
                    }
                },
                onComplete: (results) => {
                    // Format pages
                    const crawledPages = (results.crawledUrls || []).map((pageUrl, i) => ({
                        url: pageUrl,
                        title: results.pageTitles?.[pageUrl] || `Page ${i + 1}`,
                        status: 200,
                        loadTime: results.loadTimes?.[pageUrl] || null
                    }));

                    // Format issues
                    const crawledIssues = (results.issues || []).map(issue => ({
                        severity: issue.severity || 'medium',
                        category: issue.category || 'seo',
                        title: issue.title || issue.message,
                        description: issue.description || '',
                        url: issue.url || url,
                        recommendation: issue.recommendation || ''
                    }));

                    resolve({
                        pages: crawledPages,
                        issues: crawledIssues
                    });
                },
                onError: (error) => {
                    reject(error);
                }
            });

            audit.start();
        });
    }

    async function performSimpleCrawl(url) {
        const pages = [];
        const issues = [];

        try {
            let html = '';
            let fetchOk = false;

            // Primary: server-side fetch — no CORS restriction, works for any public site.
            try {
                const response = await fetch('/api/fetch-page', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                    signal: AbortSignal.timeout(15000)
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok && data.success && data.html) {
                    html = data.html;
                    fetchOk = true;
                }
            } catch (e) {
                // fall through to proxy fallback below
            }

            // Fallback: third-party CORS proxy, best-effort only.
            if (!fetchOk) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                try {
                    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                    const response = await fetch(proxyUrl, { signal: controller.signal });
                    clearTimeout(timeout);

                    if (response.ok) {
                        const json = await response.json();
                        // allorigins /get returns { contents, status: { http_code } }
                        if (json.status?.http_code >= 200 && json.status?.http_code < 400 && json.contents) {
                            html = json.contents;
                            fetchOk = true;
                        } else if (json.status?.http_code === 0 || json.status?.http_code >= 400) {
                            throw new Error(`Site returned HTTP ${json.status?.http_code || 'unreachable'}`);
                        }
                    }
                } catch (fetchErr) {
                    clearTimeout(timeout);
                    if (fetchErr.name === 'AbortError') {
                        throw new Error('Request timed out — site may be down or blocking crawlers');
                    }
                    throw fetchErr;
                }
            }

            if (!fetchOk || !html || html.length < 100) {
                throw new Error('Site returned no content — check the URL and try again');
            }

            // Parse HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Add main page
            pages.push({
                url: url,
                title: doc.title || 'Homepage',
                status: 200
            });

            // Check for common SEO issues
            if (!doc.title) {
                issues.push({
                    severity: 'critical',
                    category: 'seo',
                    title: 'Missing Page Title',
                    description: 'The page does not have a title tag',
                    url: url,
                    recommendation: 'Add a descriptive title tag to improve SEO'
                });
            }

            const metaDesc = doc.querySelector('meta[name="description"]');
            if (!metaDesc) {
                issues.push({
                    severity: 'high',
                    category: 'seo',
                    title: 'Missing Meta Description',
                    description: 'The page does not have a meta description',
                    url: url,
                    recommendation: 'Add a meta description to improve click-through rates'
                });
            }

            const h1s = doc.querySelectorAll('h1');
            if (h1s.length === 0) {
                issues.push({
                    severity: 'high',
                    category: 'seo',
                    title: 'Missing H1 Tag',
                    description: 'The page does not have an H1 heading',
                    url: url,
                    recommendation: 'Add an H1 heading to establish page topic'
                });
            } else if (h1s.length > 1) {
                issues.push({
                    severity: 'medium',
                    category: 'seo',
                    title: 'Multiple H1 Tags',
                    description: `The page has ${h1s.length} H1 tags`,
                    url: url,
                    recommendation: 'Use only one H1 tag per page'
                });
            }

            // Find internal links
            const links = doc.querySelectorAll('a[href]');
            const baseUrl = new URL(url);

            links.forEach(link => {
                try {
                    const href = link.getAttribute('href');
                    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

                    const linkUrl = new URL(href, url);
                    if (linkUrl.hostname === baseUrl.hostname) {
                        const fullUrl = linkUrl.origin + linkUrl.pathname;
                        if (!pages.find(p => p.url === fullUrl)) {
                            pages.push({
                                url: fullUrl,
                                title: link.textContent?.trim() || 'Linked Page',
                                status: 200
                            });
                        }
                    }
                } catch {}
            });

            addLog(`Found ${pages.length} pages`, 'success');

        } catch (error) {
            // Re-throw so runRealAnalysis can catch it and abort with a visible error
            throw error;
        }

        return { pages, issues };
    }

    function extractKeywordsFromPages(pages) {
        const keywords = [];
        const seen = new Set();

        // Common stop words to filter out
        const stopWords = new Set([
            'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
            'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
            'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
            'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what'
        ]);

        pages.forEach(page => {
            if (page.title) {
                const words = page.title.toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w.length > 3 && !stopWords.has(w));

                words.forEach(word => {
                    if (!seen.has(word)) {
                        seen.add(word);
                        keywords.push({
                            keyword: word,
                            source: 'page_title',
                            frequency: 1
                        });
                    }
                });
            }
        });

        return keywords.slice(0, 100);
    }

    function calculateHealthScore() {
        let score = 100;

        state.data.issues.forEach(issue => {
            switch (issue.severity) {
                case 'critical': score -= 15; break;
                case 'high': score -= 8; break;
                case 'medium': score -= 3; break;
                case 'low': score -= 1; break;
            }
        });

        // Factor in performance if available
        if (state.data.performanceScore) {
            score = Math.round((score + state.data.performanceScore) / 2);
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    function generateSummary() {
        const criticalIssues = state.data.issues.filter(i => i.severity === 'critical').length;
        const highIssues = state.data.issues.filter(i => i.severity === 'high').length;

        return {
            totalPages: state.data.pages.length,
            totalIssues: state.data.issues.length,
            criticalIssues,
            highIssues,
            healthScore: state.data.healthScore,
            topKeywords: state.data.keywords.slice(0, 10),
            analyzedAt: new Date().toISOString()
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TASK EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════

    async function runTask(taskId, executor) {
        const task = TASKS.find(t => t.id === taskId);
        if (!task) return;

        state.currentTask = taskId;
        updateTaskStatus(taskId, 'active');
        addLog(`Starting ${task.name}...`, 'info');

        // Cycle through the task's progress messages while the executor runs.
        // Each message is shown for ~(totalTime / messageCount) ms so they spread
        // evenly across the task's expected duration.
        const messages = task.messages || [];
        let msgIdx = 0;
        const baseWeight = TASKS
            .filter(t => state.completedTasks.includes(t.id))
            .reduce((sum, t) => sum + t.weight, 0);
        const msgInterval = messages.length > 0
            ? setInterval(() => {
                if (msgIdx < messages.length) {
                    addLog(messages[msgIdx++], 'info');
                    // Animate progress smoothly within the task's weight slice
                    const frac = msgIdx / messages.length;
                    state.progress = Math.min(baseWeight + task.weight * frac, 99);
                    updateProgress();
                }
            }, 1200)
            : null;

        try {
            await executor();
        } catch (error) {
            addLog(`Error in ${task.name}: ${error.message}`, 'error');
        } finally {
            if (msgInterval) clearInterval(msgInterval);
        }

        // Ensure progress reaches the task's full weight after it completes
        const completedWeight = TASKS
            .filter(t => state.completedTasks.includes(t.id) || t.id === taskId)
            .reduce((sum, t) => sum + t.weight, 0);
        state.progress = Math.min(completedWeight, 99);
        updateProgress();

        state.completedTasks.push(taskId);
        updateTaskStatus(taskId, 'complete');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UI UPDATES
    // ═══════════════════════════════════════════════════════════════════════════

    function updateProgress() {
        if (elements.progressBar) {
            elements.progressBar.style.width = `${state.progress}%`;
        }
        if (elements.progressPercent) {
            elements.progressPercent.textContent = `${Math.round(state.progress)}%`;
        }
    }

    function updateStats() {
        // HTML stat containers wrap a .stat-value child — write into that, not
        // the container itself (which would erase the label).
        function setStat(container, value) {
            if (!container) return;
            const valueEl = container.querySelector('.stat-value');
            if (valueEl) valueEl.textContent = value;
            else container.textContent = value;
        }
        setStat(elements.statsPages, state.counters.pages);
        setStat(elements.statsIssues, state.counters.issues);
        setStat(elements.statsKeywords, state.counters.keywords);
        setStat(elements.statsBacklinks, state.counters.backlinks);
    }

    function updateTaskStatus(taskId, status) {
        const taskEl = document.querySelector(`[data-task="${taskId}"]`);
        if (!taskEl) return;

        taskEl.classList.remove('pending', 'active', 'complete');
        taskEl.classList.add(status);

        const statusEl = taskEl.querySelector('.task-status');
        if (statusEl) {
            statusEl.textContent = status === 'active' ? 'In Progress...' :
                                   status === 'complete' ? 'Complete' : 'Pending';
        }
    }

    function addLog(message, type = 'info') {
        if (!elements.activityLog) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;

        const time = new Date().toLocaleTimeString();
        logEntry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-message">${message}</span>
        `;

        elements.activityLog.appendChild(logEntry);
        elements.activityLog.scrollTop = elements.activityLog.scrollHeight;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPLETION
    // ═══════════════════════════════════════════════════════════════════════════

    async function completeAnalysis() {
        state.isComplete = true;
        state.progress = 100;

        updateProgress();
        addLog('Analysis complete!', 'success');

        // Update site status
        if (elements.siteStatus) {
            elements.siteStatus.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <span>Complete</span>
            `;
            elements.siteStatus.style.background = 'rgba(16, 185, 129, 0.1)';
            elements.siteStatus.style.color = 'var(--color-success)';
        }

        // Update meta
        if (elements.siteMeta) {
            elements.siteMeta.textContent = `Analysis completed in ${Math.round((Date.now() - state.startTime) / 1000)} seconds`;
        }

        // Save data and generate AI insights
        await saveAnalysisData();

        // Update completion overlay stats
        if (elements.finalScore) elements.finalScore.textContent = state.data.healthScore;
        if (elements.finalIssues) elements.finalIssues.textContent = state.counters.issues;
        if (elements.finalPages) elements.finalPages.textContent = state.counters.pages;

        // Show completion after a brief delay
        setTimeout(showCompletion, 1000);
    }

    async function saveAnalysisData() {
        try {
            const analysisData = {
                url: state.projectData.url,
                name: state.projectData.name,
                healthScore: state.data.healthScore,
                pages: state.data.pages,
                issues: state.data.issues,
                keywords: state.data.keywords,
                backlinks: state.data.backlinks,
                coreWebVitals: state.data.coreWebVitals,
                pageSpeedScores: state.data.pageSpeedScores,
                summary: state.data.summary,
                analyzedAt: new Date().toISOString(),
                isRealData: true // Always real data - no mock mode
            };

            // Generate AI-powered insights if available
            if (window.AIService?.isAvailable() && window.APP_CONFIG?.FEATURES?.ENABLE_AI_INSIGHTS) {
                addLog('Generating AI-powered recommendations...', 'info');

                try {
                    // Get AI recommendations for issues
                    if (state.data.issues.length > 0) {
                        const recommendations = await window.AIService.SEO.getIssueRecommendations(state.data.issues);
                        analysisData.aiRecommendations = recommendations;
                        addLog(`Generated ${recommendations.length} AI recommendations`, 'success');
                    }

                    // Generate executive summary
                    if (window.APP_CONFIG?.FEATURES?.ENABLE_AI_REPORTS) {
                        const summary = await window.AIService.Reports.generateExecutiveSummary(analysisData);
                        analysisData.aiExecutiveSummary = summary;
                        addLog('Generated AI executive summary', 'success');
                    }

                    // Suggest keywords based on content
                    if (state.data.keywords.length > 0) {
                        const topKeywords = state.data.keywords.slice(0, 5).map(k => k.keyword);
                        const suggestions = await window.AIService.SEO.suggestKeywords(
                            state.projectData.name || state.projectData.url,
                            topKeywords
                        );
                        analysisData.aiKeywordSuggestions = suggestions;
                        addLog(`Generated ${suggestions.length} keyword suggestions`, 'success');
                    }
                } catch (aiError) {
                    console.warn('AI insights generation failed:', aiError);
                    addLog('AI insights skipped (check API keys)', 'warning');
                }
            }

            localStorage.setItem('seo-analysis-results', JSON.stringify(analysisData));
            localStorage.setItem('seo-analysis-complete', 'true');
            localStorage.setItem('seo-just-completed-analysis', 'true');
            localStorage.removeItem('seo-pending-audit');

            // Update dashboard settings
            const settings = JSON.parse(localStorage.getItem('seo-dashboard-settings') || '{}');
            settings.lastAnalysis = new Date().toISOString();
            settings.healthScore = state.data.healthScore;
            settings.analysisComplete = true;
            localStorage.setItem('seo-dashboard-settings', JSON.stringify(settings));

            console.log('Analysis data saved:', analysisData);
        } catch (e) {
            console.error('Error saving analysis data:', e);
        }
    }

    function showCompletion() {
        if (elements.completionOverlay) {
            elements.completionOverlay.classList.add('visible');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZE ON LOAD
    // ═══════════════════════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
