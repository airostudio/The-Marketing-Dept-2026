/**
 * SEO Audit Service
 * Performs comprehensive multi-page technical SEO audits on websites
 */

(function() {
    'use strict';

    // Audit Configuration
    const AUDIT_CONFIG = {
        corsProxies: [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ],
        timeout: 30000,
        maxPages: 25,  // Increased for comprehensive crawling
        crawlDelay: 300, // Delay between page fetches (ms)
        maxDepth: 3 // Maximum crawl depth from homepage
    };

    // Issue Severity Levels
    const SEVERITY = {
        CRITICAL: 'critical',
        HIGH: 'high',
        MEDIUM: 'medium',
        LOW: 'low'
    };

    // Issue Categories
    const CATEGORY = {
        META: 'Meta Tags',
        CONTENT: 'Content',
        LINKS: 'Links',
        IMAGES: 'Images',
        PERFORMANCE: 'Performance',
        MOBILE: 'Mobile',
        SECURITY: 'Security',
        INDEXING: 'Indexing',
        STRUCTURE: 'Structure'
    };

    // Audit State
    const AuditState = {
        isRunning: false,
        progress: 0,
        pagesCrawled: 0,
        totalPagesToCheck: 0,
        issues: [],
        startTime: null,
        currentUrl: null,
        crawledUrls: new Set(),
        pendingUrls: [],
        brokenLinks: [],
        allLinks: [],
        pageData: {},        // Store data for each crawled page, keyed by FINAL (post-redirect) URL
        robotsRules: null,   // Parsed robots.txt directives — the crawler obeys these
        robotsSkipped: [],   // URLs not fetched because robots.txt disallows them
        redirects: []        // { from, to } for every URL that redirected
    };

    // DOM Elements
    let elements = {};

    /**
     * Initialize the audit module
     */
    function init() {
        cacheElements();
        setupEventListeners();
        loadLastAudit();
        checkForProject();
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements = {
            runAuditBtn: document.getElementById('runAudit'),
            auditProgress: document.getElementById('auditProgress'),
            progressBar: document.querySelector('[data-metric="progress-bar"]'),
            auditStatus: document.querySelector('[data-metric="audit-status"]'),
            pagesCrawled: document.querySelector('[data-metric="pages-crawled"]'),
            issuesFound: document.querySelector('[data-metric="issues-found"]'),
            criticalIssues: document.querySelector('[data-metric="critical-issues"]'),
            highIssues: document.querySelector('[data-metric="high-issues"]'),
            mediumIssues: document.querySelector('[data-metric="medium-issues"]'),
            lowIssues: document.querySelector('[data-metric="low-issues"]'),
            issuesTable: document.getElementById('issuesTableContent'),
            filterTabs: document.querySelectorAll('.filter-tab'),
            statusIndicator: document.querySelector('.status-indicator')
        };
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        if (elements.runAuditBtn) {
            elements.runAuditBtn.addEventListener('click', startAudit);
        }

        elements.filterTabs.forEach(tab => {
            tab.addEventListener('click', () => filterIssues(tab.dataset.filter));
        });
    }

    /**
     * Check if a project is configured
     */
    function checkForProject() {
        const project = getCurrentProject();
        if (!project || !project.websiteUrl) {
            showNoProjectState();
        }
    }

    /**
     * Get current project from storage
     */
    function getCurrentProject() {
        const projectId = localStorage.getItem('seo-current-project');
        if (!projectId) return null;

        const projects = JSON.parse(localStorage.getItem('seo-projects') || '[]');
        return projects.find(p => p.id === projectId) || null;
    }

    /**
     * Show no project configured state
     */
    function showNoProjectState() {
        if (elements.issuesTable) {
            elements.issuesTable.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    </div>
                    <h3>No Project Configured</h3>
                    <p>Create a project first to run SEO audits on your website.</p>
                    <a href="../project-wizard.html" class="btn btn-primary" style="margin-top: 16px;">Create Project</a>
                </div>
            `;
        }
    }

    /**
     * Start the SEO audit
     */
    async function startAudit() {
        const project = getCurrentProject();

        if (!project || !project.websiteUrl) {
            showNoProjectState();
            return;
        }

        if (AuditState.isRunning) {
            return;
        }

        // Reset state completely
        AuditState.isRunning = true;
        AuditState.progress = 0;
        AuditState.pagesCrawled = 0;
        AuditState.totalPagesToCheck = 0;
        AuditState.issues = [];
        AuditState.startTime = Date.now();
        AuditState.currentUrl = project.websiteUrl;
        AuditState.crawledUrls = new Set();
        AuditState.pendingUrls = [];
        AuditState.brokenLinks = [];
        AuditState.allLinks = [];
        AuditState.pageData = {};

        // Get max pages from project settings
        const maxPages = project.maxPages || AUDIT_CONFIG.maxPages;

        // Update UI
        updateRunButton(true);
        updateProgress(0, 'Starting comprehensive audit...');
        updateStatusIndicator('running');

        try {
            // Phase 1: Global checks (5%)
            updateProgress(0, 'Checking security...');
            await checkSecurity(project.websiteUrl);

            updateProgress(2, 'Checking robots.txt...');
            await checkRobotsTxt(project.websiteUrl);

            updateProgress(4, 'Checking sitemap...');
            const sitemapUrls = await checkSitemap(project.websiteUrl);

            // Phase 2: Discover and crawl pages (5-80%)
            updateProgress(5, 'Discovering pages...');

            // Start with homepage
            AuditState.pendingUrls.push({ url: normalizeUrl(project.websiteUrl), depth: 0 });

            // Add sitemap URLs if found
            if (sitemapUrls && sitemapUrls.length > 0) {
                sitemapUrls.slice(0, Math.floor(maxPages / 2)).forEach(u => {
                    if (!AuditState.crawledUrls.has(u)) {
                        AuditState.pendingUrls.push({ url: u, depth: 1 });
                    }
                });
            }

            // Crawl pages
            await crawlPages(project.websiteUrl, maxPages);

            // Phase 3: Check broken links (80-90%)
            updateProgress(80, 'Verifying links...');
            await verifyLinks();

            // Phase 4: Generate summary issues (90-95%)
            updateProgress(90, 'Analyzing results...');
            generateSummaryIssues();

            // Phase 5: Complete (95-100%)
            updateProgress(95, 'Finalizing audit...');
            await sleep(500);

            // Complete
            AuditState.isRunning = false;
            updateProgress(100, 'Audit complete');
            updateStatusIndicator('complete');
            updateRunButton(false);

            // Save results
            saveAuditResults();

            // Display results
            displayResults();

        } catch (error) {
            console.error('Audit error:', error);
            AuditState.isRunning = false;
            updateProgress(0, 'Audit failed: ' + error.message);
            updateStatusIndicator('error');
            updateRunButton(false);
        }
    }

    /**
     * Crawl multiple pages
     */
    async function crawlPages(baseUrl, maxPages) {
        const baseUrlObj = new URL(baseUrl);
        const baseDomain = baseUrlObj.hostname;
        let pagesFetched = 0;

        while (AuditState.pendingUrls.length > 0 && AuditState.pagesCrawled < maxPages) {
            const { url, depth } = AuditState.pendingUrls.shift();

            // Skip if already crawled
            if (AuditState.crawledUrls.has(url)) {
                continue;
            }

            // Skip if too deep
            if (depth > AUDIT_CONFIG.maxDepth) {
                continue;
            }

            // Obey robots.txt. A page the site owner has told crawlers to
            // stay out of is not a page to audit — reporting on it produces
            // findings about content Google will never see.
            if (isDisallowedByRobots(url)) {
                AuditState.robotsSkipped.push(url);
                AuditState.crawledUrls.add(url);
                continue;
            }

            // Mark as crawled
            AuditState.crawledUrls.add(url);

            // Update progress (5% to 80% range for crawling)
            const crawlProgress = 5 + ((AuditState.pagesCrawled / maxPages) * 75);
            updateProgress(crawlProgress, `Crawling: ${truncateUrl(url, 50)}`);

            try {
                // Fetch the page
                const fetched = await fetchPage(url);
                AuditState.pagesCrawled++;
                updatePagesCrawled();

                if (fetched) {
                    const { html } = fetched;
                    const finalUrl = normalizeUrl(fetched.finalUrl || url);
                    const redirected = finalUrl !== url;

                    if (redirected) {
                        AuditState.redirects.push({ from: url, to: finalUrl });
                    }

                    // If this URL redirected somewhere we've already audited,
                    // it's the same page reached a second way — record the
                    // redirect and move on. Auditing it again is what used to
                    // produce phantom "duplicate title" and "duplicate meta
                    // description" findings for a single real page.
                    if (redirected && AuditState.pageData[finalUrl]) {
                        await sleep(AUDIT_CONFIG.crawlDelay);
                        continue;
                    }

                    pagesFetched++;

                    // Store page data under the URL the content actually lives
                    // at, so every downstream check and the duplicate-content
                    // analysis see one entry per real page.
                    AuditState.crawledUrls.add(finalUrl);
                    AuditState.pageData[finalUrl] = {
                        html,
                        crawledAt: new Date().toISOString(),
                        redirectedFrom: redirected ? url : undefined
                    };

                    // Run checks on this page
                    await runPageChecks(html, finalUrl);

                    // Extract and queue internal links
                    const links = extractLinks(html, finalUrl, baseDomain);

                    links.internal.forEach(link => {
                        const normalizedLink = normalizeUrl(link);
                        if (!AuditState.crawledUrls.has(normalizedLink) &&
                            !AuditState.pendingUrls.some(p => p.url === normalizedLink)) {
                            AuditState.pendingUrls.push({ url: normalizedLink, depth: depth + 1 });
                        }
                    });

                    // Track all links for broken link checking
                    AuditState.allLinks.push(...links.all.map(l => ({ from: finalUrl, to: l.href, text: l.text })));
                }

                // Delay between requests
                await sleep(AUDIT_CONFIG.crawlDelay);

            } catch (e) {
                console.warn(`Failed to crawl ${url}:`, e.message);
            }
        }

        // If every single page failed to fetch, this isn't a partial audit —
        // it's a total failure to reach the site. Surface that clearly
        // instead of letting the caller proceed and generate a report from
        // zero real data.
        if (pagesFetched === 0) {
            throw new Error(`Could not fetch any pages from ${baseUrl}. The site may be down, blocking automated requests, or the URL may be incorrect.`);
        }
    }

    /**
     * Run all checks on a single page
     */
    async function runPageChecks(html, url) {
        try {
            checkMetaTags(html, url);
            checkHeadings(html, url);
            checkImages(html, url);
            checkLinks(html, url);
            checkContent(html, url);
            checkMobileFriendliness(html, url);
            checkPerformanceHints(html, url);
        } catch (e) {
            console.warn(`Error checking page ${url}:`, e);
        }
    }

    /**
     * Extract links from HTML
     */
    function extractLinks(html, pageUrl, baseDomain) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const baseUrlObj = new URL(pageUrl);

        const links = {
            internal: [],
            external: [],
            all: []
        };

        doc.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
                return;
            }

            try {
                const linkUrl = new URL(href, pageUrl);
                const fullUrl = linkUrl.href;
                const text = anchor.textContent.trim();

                links.all.push({ href: fullUrl, text });

                if (linkUrl.hostname === baseDomain) {
                    // Internal link - only crawl HTML pages
                    const path = linkUrl.pathname.toLowerCase();
                    const isHtmlPage = !path.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot|mp4|mp3|zip|rar|doc|docx|xls|xlsx)$/);

                    if (isHtmlPage) {
                        links.internal.push(fullUrl);
                    }
                } else {
                    links.external.push(fullUrl);
                }
            } catch (e) {
                // Invalid URL
            }
        });

        return links;
    }

    /**
     * Verify links for broken ones
     */
    async function verifyLinks() {
        // Group links by destination
        const linkMap = new Map();
        AuditState.allLinks.forEach(link => {
            if (!linkMap.has(link.to)) {
                linkMap.set(link.to, []);
            }
            linkMap.get(link.to).push(link.from);
        });

        // Sample check unique links (limit to avoid too many requests)
        const uniqueLinks = Array.from(linkMap.keys());
        const linksToCheck = uniqueLinks.slice(0, 50);

        let checked = 0;
        for (const linkUrl of linksToCheck) {
            checked++;
            updateProgress(80 + (checked / linksToCheck.length) * 10, `Checking link ${checked}/${linksToCheck.length}...`);

            try {
                const status = await checkLinkStatus(linkUrl);
                if (status >= 400) {
                    const sources = linkMap.get(linkUrl);
                    AuditState.brokenLinks.push({
                        url: linkUrl,
                        status,
                        foundOn: sources.slice(0, 3) // First 3 pages where found
                    });

                    addIssue({
                        severity: status === 404 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
                        category: CATEGORY.LINKS,
                        title: `Broken link (${status})`,
                        description: `Link to "${truncateUrl(linkUrl, 60)}" returns HTTP ${status}. Found on ${sources.length} page(s).`,
                        url: sources[0],
                        recommendation: status === 404 ?
                            'Remove the broken link or update it to point to a valid URL.' :
                            'Check if the destination server is working properly.'
                    });
                }
            } catch (e) {
                // Skip if can't check
            }

            await sleep(100);
        }
    }

    /**
     * Check link status code
     */
    async function checkLinkStatus(url) {
        // Server-side reachability probe (/api/check-url) — a real HEAD/GET
        // request from the server, not routed through a third-party proxy
        // that may mask or rewrite the target's actual status code.
        try {
            const response = await fetch(`/api/check-url?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(8000)
            });
            const data = await response.json().catch(() => ({}));
            if (typeof data.status === 'number' && data.status > 0) return data.status;
        } catch (e) {
            // fall through to proxy fallback
        }

        // Fallback: third-party CORS proxies (best-effort).
        for (const proxy of AUDIT_CONFIG.corsProxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(url), {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(5000)
                });
                return response.status;
            } catch (e) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(url), {
                        signal: AbortSignal.timeout(5000)
                    });
                    return response.status;
                } catch (e2) {
                    continue;
                }
            }
        }
        return 0; // Unknown
    }

    /**
     * Generate summary issues based on overall findings
     */
    function generateSummaryIssues() {
        const pageCount = AuditState.pagesCrawled;

        // Check for site-wide issues
        const issuesByType = {};
        AuditState.issues.forEach(issue => {
            const key = issue.title;
            if (!issuesByType[key]) {
                issuesByType[key] = [];
            }
            issuesByType[key].push(issue);
        });

        // Flag widespread issues.
        //
        // The rollup keeps the underlying issue's own severity. It used to
        // promote everything to HIGH, which meant a LOW-severity nitpick
        // appearing on every page of a consistent template got reported as a
        // high-severity site-wide problem — inflating the report precisely
        // where the site was being consistent. Breadth is worth surfacing;
        // it is not the same thing as severity.
        Object.entries(issuesByType).forEach(([title, issues]) => {
            if (title.startsWith('Site-wide: ')) return;
            if (issues.length > pageCount * 0.5 && issues.length > 3) {
                const firstIssue = issues[0];
                if (firstIssue.severity !== SEVERITY.CRITICAL) {
                    addIssue({
                        severity: firstIssue.severity,
                        category: firstIssue.category,
                        title: `Site-wide: ${title}`,
                        description: `This issue affects ${issues.length} out of ${pageCount} pages (${Math.round(issues.length/pageCount*100)}%). It looks like a template-level pattern, so one fix likely resolves all of them.`,
                        url: AuditState.currentUrl,
                        recommendation: 'Fix this at the template level to resolve it across all affected pages.',
                        evidence: 'Affected pages:\n' +
                            issues.slice(0, 10).map(i => '  • ' + i.url).join('\n') +
                            (issues.length > 10 ? `\n  …and ${issues.length - 10} more` : '')
                    });
                }
            }
        });

        // Check for duplicate content indicators
        const titles = {};
        const descriptions = {};
        Object.entries(AuditState.pageData).forEach(([url, data]) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(data.html, 'text/html');

            const title = doc.querySelector('title')?.textContent?.trim();
            const desc = doc.querySelector('meta[name="description"]')?.content?.trim();

            if (title) {
                if (!titles[title]) titles[title] = [];
                titles[title].push(url);
            }
            if (desc) {
                if (!descriptions[desc]) descriptions[desc] = [];
                descriptions[desc].push(url);
            }
        });

        // Report duplicate titles. Redirect chains were already collapsed
        // during the crawl, so anything reaching here really is two distinct
        // URLs serving the same title, not one page reached two ways.
        Object.entries(titles).forEach(([title, urls]) => {
            if (urls.length > 1) {
                addIssue({
                    severity: SEVERITY.HIGH,
                    category: CATEGORY.META,
                    title: 'Duplicate title tags',
                    description: `${urls.length} pages share the same title: "${truncateUrl(title, 50)}". Each page should have a unique title.`,
                    url: urls[0],
                    recommendation: 'Create unique, descriptive title tags for each page.',
                    evidence: `Title: "${title}"\nOn these URLs:\n${urls.map(u => '  • ' + u).join('\n')}`
                });
            }
        });

        // Report duplicate descriptions
        Object.entries(descriptions).forEach(([desc, urls]) => {
            if (urls.length > 1 && desc.length > 10) {
                addIssue({
                    severity: SEVERITY.MEDIUM,
                    category: CATEGORY.META,
                    title: 'Duplicate meta descriptions',
                    description: `${urls.length} pages share the same meta description. Each page should have unique content.`,
                    url: urls[0],
                    recommendation: 'Write unique meta descriptions for each page.',
                    evidence: `Description: "${desc}"\nOn these URLs:\n${urls.map(u => '  • ' + u).join('\n')}`
                });
            }
        });

        // Report what the crawl deliberately did NOT audit, so the absence of
        // findings for those URLs is explained rather than mysterious.
        if (AuditState.robotsSkipped.length > 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.INDEXING,
                title: 'Pages skipped (disallowed by robots.txt)',
                description: `${AuditState.robotsSkipped.length} URL(s) were not audited because your robots.txt disallows crawling them. This is informational, not a problem — search engines skip them too.`,
                url: AuditState.currentUrl,
                recommendation: 'No action needed unless one of these URLs is meant to be indexed, in which case remove its Disallow rule.',
                evidence: AuditState.robotsSkipped.map(u => '  • ' + u).join('\n')
            });
        }

        if (AuditState.redirects.length > 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.INDEXING,
                title: 'Redirects encountered during crawl',
                description: `${AuditState.redirects.length} URL(s) redirected elsewhere. Each was audited once, at its destination — not as a separate page.`,
                url: AuditState.currentUrl,
                recommendation: 'No action needed if these redirects are intentional. Update internal links to point at the destination directly to save a round trip.',
                evidence: AuditState.redirects.map(r => `  • ${r.from} → ${r.to}`).join('\n')
            });
        }
    }

    /**
     * Check mobile friendliness indicators
     */
    function checkMobileFriendliness(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Check for small tap targets (buttons/links with small touch area)
        const interactiveElements = doc.querySelectorAll('a, button, input, select, textarea');
        let smallTargets = 0;

        interactiveElements.forEach(el => {
            // Check for inline styles that might indicate small size
            const style = el.getAttribute('style') || '';
            if (style.includes('font-size') && style.match(/font-size:\s*(\d+)/)) {
                const size = parseInt(style.match(/font-size:\s*(\d+)/)[1]);
                if (size < 12) smallTargets++;
            }
        });

        // Check for fixed-width elements that might break mobile
        const fixedWidthElements = doc.querySelectorAll('[width], [style*="width:"]');
        let problematicWidths = 0;

        fixedWidthElements.forEach(el => {
            const widthAttr = el.getAttribute('width');
            const style = el.getAttribute('style') || '';

            if (widthAttr && parseInt(widthAttr) > 400) {
                problematicWidths++;
            }
            if (style.match(/width:\s*(\d+)px/) && parseInt(style.match(/width:\s*(\d+)px/)[1]) > 500) {
                problematicWidths++;
            }
        });

        if (problematicWidths > 3) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.MOBILE,
                title: 'Fixed-width elements detected',
                description: `${problematicWidths} elements have fixed widths that may cause horizontal scrolling on mobile devices.`,
                url: url,
                recommendation: 'Use responsive units (%, vw, max-width) instead of fixed pixel widths.'
            });
        }

        // Check for text size
        const smallText = doc.querySelectorAll('[style*="font-size"]');
        let tinyText = 0;
        smallText.forEach(el => {
            const style = el.getAttribute('style') || '';
            const match = style.match(/font-size:\s*(\d+)px/);
            if (match && parseInt(match[1]) < 12) {
                tinyText++;
            }
        });

        if (tinyText > 5) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.MOBILE,
                title: 'Small text detected',
                description: `${tinyText} elements have font sizes below 12px, which may be hard to read on mobile.`,
                url: url,
                recommendation: 'Use a minimum font size of 16px for body text on mobile devices.'
            });
        }
    }

    /**
     * Check for performance hints in HTML
     */
    function checkPerformanceHints(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Render-blocking means a network round trip the parser has to wait
        // on: an EXTERNAL script in <head> with no async/defer. Inline
        // <script> blocks are not that — they execute immediately with
        // nothing to download — and modern frameworks put several of them in
        // <head> as a matter of course (hydration bootstraps, theme-flash
        // guards, tag-manager loaders that set .async themselves in JS).
        // Counting those was flagging nearly every site built this decade.
        // type="module" is deferred by definition, and JSON-LD isn't script
        // execution at all, so both are excluded too.
        const blockingScripts = [];
        doc.querySelectorAll('head script[src]').forEach(script => {
            if (script.hasAttribute('async') || script.hasAttribute('defer')) return;
            const type = (script.getAttribute('type') || '').toLowerCase();
            if (type === 'module' || (type && !/javascript|ecmascript/.test(type))) return;
            blockingScripts.push(script.getAttribute('src'));
        });

        if (blockingScripts.length > 2) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.PERFORMANCE,
                title: 'Render-blocking scripts',
                description: `${blockingScripts.length} external script(s) in <head> have neither async nor defer, so the parser waits on each download before rendering.`,
                url: url,
                recommendation: 'Add async or defer to these specific scripts, or move them before </body>.',
                evidence: 'Blocking scripts found on this page:\n' +
                    blockingScripts.map(s => '  • ' + s).join('\n')
            });
        }

        // Check for large inline styles/scripts
        const inlineStyles = doc.querySelectorAll('style');
        let largeInlineCSS = 0;
        inlineStyles.forEach(style => {
            if (style.textContent.length > 5000) {
                largeInlineCSS++;
            }
        });

        if (largeInlineCSS > 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.PERFORMANCE,
                title: 'Large inline CSS',
                description: `${largeInlineCSS} large inline <style> block(s) detected. Consider external stylesheets.`,
                url: url,
                recommendation: 'Move large CSS to external files that can be cached by browsers.'
            });
        }

        // Resource hints. "This page has no preconnect" is not by itself a
        // finding — most pages don't need one. It's only worth raising when
        // the page actually pulls resources from third-party origins that a
        // preconnect would measurably help, and we can name them.
        const preconnected = new Set();
        doc.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]').forEach(l => {
            try { preconnected.add(new URL(l.getAttribute('href'), url).origin); } catch (e) { /* ignore */ }
        });

        const thirdPartyOrigins = new Set();
        doc.querySelectorAll('script[src], link[rel="stylesheet"][href], img[src]').forEach(el => {
            const raw = el.getAttribute('src') || el.getAttribute('href');
            if (!raw) return;
            try {
                const origin = new URL(raw, url).origin;
                if (origin !== new URL(url).origin && !preconnected.has(origin)) {
                    thirdPartyOrigins.add(origin);
                }
            } catch (e) { /* ignore */ }
        });

        if (thirdPartyOrigins.size >= 3) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.PERFORMANCE,
                title: 'Third-party origins without preconnect',
                description: `This page loads resources from ${thirdPartyOrigins.size} third-party origins with no preconnect/dns-prefetch hint, so each costs a fresh DNS + TLS handshake.`,
                url: url,
                recommendation: 'Add <link rel="preconnect"> for the origins on the critical path (fonts and above-the-fold assets benefit most).',
                evidence: 'Origins loaded without a preconnect hint:\n' +
                    [...thirdPartyOrigins].map(o => '  • ' + o).join('\n')
            });
        }
    }

    /**
     * Normalize URL for comparison
     */
    function normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            // Remove trailing slash, hash, and common tracking params
            let normalized = urlObj.origin + urlObj.pathname.replace(/\/$/, '');
            return normalized.toLowerCase();
        } catch (e) {
            return url.toLowerCase();
        }
    }

    /**
     * Truncate URL for display
     */
    function truncateUrl(url, maxLength) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }

    /**
     * Fetch a URL via the server-side /api/fetch-page endpoint. Shared by
     * fetchPage(), checkRobotsTxt() and checkSitemap() so all three real
     * checks get the same reliable, non-CORS-restricted path instead of
     * depending solely on flaky third-party proxies.
     *
     * Returns the body only. Callers that need to know where the request
     * actually landed after redirects use fetchViaServerDetailed() instead.
     * @returns {Promise<string|null>}
     */
    async function fetchViaServer(targetUrl, timeoutMs) {
        const result = await fetchViaServerDetailed(targetUrl, timeoutMs);
        return result ? result.html : null;
    }

    /**
     * As fetchViaServer(), but keeps the finalUrl the server reports after
     * following redirects. /api/fetch-page has always returned this; the
     * crawler used to discard it, which is why a URL that redirects (an
     * auth-gated /build → /login, say) got audited as though it were its own
     * distinct page — manufacturing duplicate titles and descriptions for
     * content that exists once.
     * @returns {Promise<{html: string, finalUrl: string, status: number}|null>}
     */
    async function fetchViaServerDetailed(targetUrl, timeoutMs) {
        try {
            const response = await fetch('/api/fetch-page', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl }),
                signal: AbortSignal.timeout(timeoutMs)
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.success && data.html) {
                return {
                    html: data.html,
                    finalUrl: data.finalUrl || targetUrl,
                    status: data.status || 200
                };
            }
        } catch (e) {
            // fall through — caller tries proxies next
        }
        return null;
    }

    /**
     * Fetch page content. Returns { html, finalUrl } for the real page, or
     * null if the page truly could not be fetched — callers must treat null
     * as "this page failed", never as an excuse to fabricate a page. A prior
     * version of this function returned a hardcoded fake HTML stub whenever
     * fetching failed, which produced a plausible-looking but entirely
     * synthetic "audit" with no relationship to the real site. That fallback
     * has been removed.
     *
     * finalUrl is where the request actually landed after redirects, which
     * the caller needs in order to avoid auditing one page several times
     * under each of the URLs that redirect to it.
     * @returns {Promise<{html: string, finalUrl: string}|null>}
     */
    async function fetchPage(url) {
        // Try direct fetch first — cheap, and works when the target sets
        // permissive CORS headers (rare, but free when it happens).
        try {
            const response = await fetch(url, {
                mode: 'cors',
                headers: { 'Accept': 'text/html' }
            });
            if (response.ok) {
                return { html: await response.text(), finalUrl: response.url || url };
            }
        } catch (e) {
            // Expected for cross-origin — fall through to the server-side fetch.
        }

        // Server-side fetch (/api/fetch-page) — no CORS restriction since
        // it's server-to-server, so this covers the vast majority of sites.
        const server = await fetchViaServerDetailed(url, AUDIT_CONFIG.timeout);
        if (server) return { html: server.html, finalUrl: server.finalUrl };

        // Last resort: third-party CORS proxies (best-effort, frequently
        // rate-limited/down). These can't report a final URL, so redirect
        // collapsing is unavailable on this path.
        for (const proxy of AUDIT_CONFIG.corsProxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(url), {
                    signal: AbortSignal.timeout(AUDIT_CONFIG.timeout)
                });
                if (response.ok) {
                    return { html: await response.text(), finalUrl: url };
                }
            } catch (e) {
                continue;
            }
        }

        // Every real fetch path failed — this page cannot be audited.
        console.warn(`Could not fetch ${url} through any path — marking as failed, not faking data.`);
        return null;
    }

    /**
     * Check meta tags
     */
    /**
     * Summarise what the crawler actually parsed out of <head>.
     *
     * Attached to every "missing X" finding, because that is the class of
     * finding most likely to be the crawler's fault rather than the site's:
     * if we report a missing title on a page that plainly has one, this shows
     * at a glance whether we fetched a redirect, a JS shell, an error page,
     * or genuinely a page with no title.
     */
    function headSnapshot(doc, html) {
        const lines = [];
        const t = doc.querySelector('title');
        lines.push(`<title>: ${t ? `"${t.textContent.trim()}"` : '(none found)'}`);

        const metas = doc.querySelectorAll('head meta[name], head meta[property]');
        if (metas.length) {
            const names = [...metas]
                .map(m => m.getAttribute('name') || m.getAttribute('property'))
                .filter(Boolean);
            lines.push(`meta tags in <head>: ${names.join(', ')}`);
        } else {
            lines.push('meta tags in <head>: (none found)');
        }

        lines.push(`HTML received: ${html.length.toLocaleString()} bytes`);
        lines.push(`First 200 bytes: ${html.slice(0, 200).replace(/\s+/g, ' ')}`);
        return lines.join('\n');
    }

    function checkMetaTags(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Title tag
        const title = doc.querySelector('title');
        const titleText = title ? title.textContent.trim() : '';

        // Length thresholds are deliberately permissive. There is no SEO
        // benefit to padding a title to hit a character count: "Terms of
        // Service | Example.com" is 28 characters and is exactly right for
        // that page. Only flag a title short enough to be genuinely
        // uninformative (a bare word or two), or long enough that Google will
        // visibly truncate it.
        if (!titleText) {
            addIssue({
                severity: SEVERITY.CRITICAL,
                category: CATEGORY.META,
                title: 'Missing title tag',
                description: 'The page is missing a title tag. Title tags are crucial for SEO and user experience.',
                url: url,
                recommendation: 'Add a unique, descriptive title tag of roughly 50-60 characters.',
                evidence: headSnapshot(doc, html)
            });
        } else if (titleText.length < 15) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Title tag very short',
                description: `Title tag is only ${titleText.length} characters, which is likely too brief to describe the page or distinguish it in results.`,
                url: url,
                recommendation: 'Consider adding the page subject and/or brand name.',
                evidence: `Current title (${titleText.length} chars): "${titleText}"`
            });
        } else if (titleText.length > 65) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Title tag may be truncated',
                description: `Title tag is ${titleText.length} characters. Google typically truncates around 60-65.`,
                url: url,
                recommendation: 'Front-load the important words so the title still reads well if cut short.',
                evidence: `Current title (${titleText.length} chars): "${titleText}"`
            });
        }

        // Meta description
        const metaDesc = doc.querySelector('meta[name="description"]');
        const descText = metaDesc ? metaDesc.getAttribute('content')?.trim() : '';

        // Same reasoning as titles: a clear 90-character description is fine.
        // Only flag one short enough to waste the snippet, or long enough to
        // be cut off.
        if (!descText) {
            addIssue({
                severity: SEVERITY.HIGH,
                category: CATEGORY.META,
                title: 'Missing meta description',
                description: 'The page is missing a meta description. This affects click-through rates from search results.',
                url: url,
                recommendation: 'Add a compelling meta description of roughly 120-160 characters.',
                evidence: headSnapshot(doc, html)
            });
        } else if (descText.length < 70) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Meta description very short',
                description: `Meta description is only ${descText.length} characters, leaving most of the search snippet unused.`,
                url: url,
                recommendation: 'Consider expanding it to make fuller use of the snippet.',
                evidence: `Current description (${descText.length} chars): "${descText}"`
            });
        } else if (descText.length > 165) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Meta description may be truncated',
                description: `Meta description is ${descText.length} characters. Google typically truncates around 155-160.`,
                url: url,
                recommendation: 'Put the key message first so it survives truncation.',
                evidence: `Current description (${descText.length} chars): "${descText}"`
            });
        }

        // Viewport meta tag
        const viewport = doc.querySelector('meta[name="viewport"]');
        if (!viewport) {
            addIssue({
                severity: SEVERITY.HIGH,
                category: CATEGORY.MOBILE,
                title: 'Missing viewport meta tag',
                description: 'The page is missing a viewport meta tag, which is essential for mobile responsiveness.',
                url: url,
                recommendation: 'Add: <meta name="viewport" content="width=device-width, initial-scale=1">',
                evidence: headSnapshot(doc, html)
            });
        }

        // Canonical URL
        const canonical = doc.querySelector('link[rel="canonical"]');
        if (!canonical) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.INDEXING,
                title: 'Missing canonical URL',
                description: 'The page is missing a canonical URL tag, which helps prevent duplicate content issues.',
                url: url,
                recommendation: 'Add a canonical link tag pointing to the preferred URL of this page.',
                evidence: `No <link rel="canonical"> found. Links present in <head>: ${
                    [...doc.querySelectorAll('head link[rel]')].map(l => l.getAttribute('rel')).join(', ') || '(none)'}`
            });
        }

        // Open Graph tags
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        const ogDesc = doc.querySelector('meta[property="og:description"]');
        const ogImage = doc.querySelector('meta[property="og:image"]');

        if (!ogTitle || !ogDesc || !ogImage) {
            const missing = [
                !ogTitle && 'og:title',
                !ogDesc && 'og:description',
                !ogImage && 'og:image'
            ].filter(Boolean);
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Incomplete Open Graph tags',
                description: `Missing ${missing.join(', ')}.`,
                url: url,
                recommendation: 'Add the missing Open Graph tags so shared links render a proper preview card.',
                evidence: `Missing: ${missing.join(', ')}\nPresent: ${[
                    ogTitle && 'og:title', ogDesc && 'og:description', ogImage && 'og:image'
                ].filter(Boolean).join(', ') || '(none)'}`
            });
        }

        // Language attribute
        const htmlLang = doc.documentElement.getAttribute('lang');
        if (!htmlLang) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.STRUCTURE,
                title: 'Missing language attribute',
                description: 'The HTML element is missing a lang attribute.',
                url: url,
                recommendation: 'Add a lang attribute to the <html> element (e.g., lang="en").',
                evidence: `<html> tag as served: ${(html.match(/<html[^>]*>/i) || ['(not found)'])[0]}`
            });
        }
    }

    /**
     * Check heading structure
     */
    function checkHeadings(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const h1s = doc.querySelectorAll('h1');
        const h2s = doc.querySelectorAll('h2');
        const h3s = doc.querySelectorAll('h3');

        // Check for H1
        if (h1s.length === 0) {
            // Headings rendered only after JS hydration won't be in the HTML
            // we fetched. Say so, and show what headings we did see, rather
            // than asserting the page has none.
            const anyHeading = doc.querySelector('h2, h3, h4');
            addIssue({
                severity: SEVERITY.HIGH,
                category: CATEGORY.CONTENT,
                title: 'Missing H1 heading',
                description: 'No H1 heading was found in the HTML served for this page. Note that headings rendered client-side by JavaScript will not appear here — nor to crawlers that do not execute your JS.',
                url: url,
                recommendation: 'Ensure a single descriptive H1 is present in the server-rendered HTML.',
                evidence: `Headings found in served HTML: ${
                    ['h1', 'h2', 'h3', 'h4'].map(tag => {
                        const n = doc.querySelectorAll(tag).length;
                        return n ? `${n}×${tag}` : null;
                    }).filter(Boolean).join(', ') || '(none)'
                }${anyHeading ? `\nFirst heading text: "${anyHeading.textContent.trim().slice(0, 80)}"` : ''}`
            });
        } else if (h1s.length > 1) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.CONTENT,
                title: 'Multiple H1 headings',
                description: `The page has ${h1s.length} H1 headings. Best practice is to have exactly one H1.`,
                url: url,
                recommendation: 'Keep only one H1 heading per page and use H2-H6 for subheadings.',
                evidence: [...h1s].map(h => '  • ' + h.textContent.trim().slice(0, 80)).join('\n')
            });
        } else {
            // "Pricing" is a perfectly good H1. Only flag one so short it
            // can't be describing anything.
            const h1Text = h1s[0].textContent.trim();
            if (h1Text.length < 5) {
                addIssue({
                    severity: SEVERITY.LOW,
                    category: CATEGORY.CONTENT,
                    title: 'H1 heading very short',
                    description: `The H1 heading is only ${h1Text.length} characters long.`,
                    url: url,
                    recommendation: 'Make your H1 descriptive of what the page actually covers.',
                    evidence: `Current H1: "${h1Text}"`
                });
            }
        }

        // Check heading hierarchy
        if (h1s.length > 0 && h2s.length === 0 && h3s.length > 0) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.STRUCTURE,
                title: 'Skipped heading level',
                description: 'The page skips from H1 to H3, missing H2 headings.',
                url: url,
                recommendation: 'Use proper heading hierarchy: H1 → H2 → H3, etc.'
            });
        }
    }

    /**
     * Check images
     */
    function checkImages(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const images = doc.querySelectorAll('img');
        let missingAlt = 0;
        let emptyAlt = 0;
        let missingSizes = 0;

        images.forEach(img => {
            const alt = img.getAttribute('alt');
            const width = img.getAttribute('width');
            const height = img.getAttribute('height');

            if (alt === null) {
                missingAlt++;
            } else if (alt.trim() === '') {
                emptyAlt++;
            }

            if (!width || !height) {
                missingSizes++;
            }
        });

        if (missingAlt > 0) {
            addIssue({
                severity: SEVERITY.HIGH,
                category: CATEGORY.IMAGES,
                title: 'Images missing alt attributes',
                description: `${missingAlt} image(s) are missing alt attributes, which impacts accessibility and SEO.`,
                url: url,
                recommendation: 'Add descriptive alt text to all images that convey meaning.'
            });
        }

        if (emptyAlt > 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.IMAGES,
                title: 'Images with empty alt attributes',
                description: `${emptyAlt} image(s) have empty alt attributes. This is fine for decorative images only.`,
                url: url,
                recommendation: 'Ensure empty alt attributes are only used for decorative images.'
            });
        }

        if (missingSizes > 0) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.PERFORMANCE,
                title: 'Images missing dimensions',
                description: `${missingSizes} image(s) are missing width/height attributes, which can cause layout shifts.`,
                url: url,
                recommendation: 'Add width and height attributes to images to prevent Cumulative Layout Shift (CLS).'
            });
        }
    }

    /**
     * Check links
     */
    function checkLinks(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const baseUrl = new URL(url);

        const links = doc.querySelectorAll('a[href]');
        let emptyLinks = 0;
        let noTextLinks = 0;
        let httpLinks = 0;
        const unsafeBlankLinks = [];

        links.forEach(link => {
            const href = link.getAttribute('href');
            const text = link.textContent.trim();
            const rel = (link.getAttribute('rel') || '').toLowerCase();

            if (!href || href === '#' || href === 'javascript:void(0)') {
                emptyLinks++;
            }

            if (!text && !link.querySelector('img')) {
                noTextLinks++;
            }

            // Check for http links on https site
            if (baseUrl.protocol === 'https:' && href?.startsWith('http://')) {
                httpLinks++;
            }

            // Reverse-tabnabbing only applies to links that open a new
            // browsing context — an ordinary external link navigates the
            // current tab and hands over no window.opener, so flagging it is
            // noise. And rel="noreferrer" already blocks window.opener access
            // on its own (it's a superset of noopener, not a weaker
            // alternative), so a link carrying either one is safe.
            try {
                const linkUrl = new URL(href, url);
                const opensNewContext = (link.getAttribute('target') || '').toLowerCase() === '_blank';
                const isExternal = linkUrl.hostname !== baseUrl.hostname;
                const isProtected = rel.includes('noopener') || rel.includes('noreferrer');

                if (isExternal && opensNewContext && !isProtected) {
                    unsafeBlankLinks.push(href);
                }
            } catch (e) {
                // Invalid URL
            }
        });

        if (emptyLinks > 0) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.LINKS,
                title: 'Empty or invalid links found',
                description: `${emptyLinks} link(s) have empty or invalid href attributes.`,
                url: url,
                recommendation: 'Remove or fix empty links that don\'t navigate anywhere.'
            });
        }

        if (noTextLinks > 0) {
            addIssue({
                severity: SEVERITY.HIGH,
                category: CATEGORY.LINKS,
                title: 'Links without descriptive text',
                description: `${noTextLinks} link(s) have no text content, hurting accessibility and SEO.`,
                url: url,
                recommendation: 'Add descriptive anchor text to all links.'
            });
        }

        if (httpLinks > 0) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.SECURITY,
                title: 'Mixed content: HTTP links on HTTPS page',
                description: `${httpLinks} link(s) use HTTP instead of HTTPS.`,
                url: url,
                recommendation: 'Update all internal links to use HTTPS.'
            });
        }

        if (unsafeBlankLinks.length > 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.SECURITY,
                title: 'External links missing rel="noopener"',
                description: `${unsafeBlankLinks.length} external link(s) open in a new tab (target="_blank") with neither rel="noopener" nor rel="noreferrer", so the opened page can reach back via window.opener.`,
                url: url,
                recommendation: 'Add rel="noopener" (or rel="noreferrer", which also covers it) to these links.',
                evidence: unsafeBlankLinks.slice(0, 10).map(h => '  • ' + h).join('\n') +
                    (unsafeBlankLinks.length > 10 ? `\n  …and ${unsafeBlankLinks.length - 10} more` : '')
            });
        }
    }

    /**
     * Check security
     */
    function checkSecurity(url) {
        const parsedUrl = new URL(url);

        if (parsedUrl.protocol !== 'https:') {
            addIssue({
                severity: SEVERITY.CRITICAL,
                category: CATEGORY.SECURITY,
                title: 'Site not using HTTPS',
                description: 'The website is not using HTTPS, which is a ranking factor and security concern.',
                url: url,
                recommendation: 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.',
                evidence: `URL audited used the "${parsedUrl.protocol}" scheme.`
            });
        }
    }

    /**
     * Parse robots.txt into the Allow/Disallow rules that apply to us.
     *
     * A crawler that ignores robots.txt doesn't just behave rudely — it
     * reports nonsense. Auth-gated paths are the usual case: /build and
     * /dashboard are disallowed precisely because they redirect anonymous
     * visitors to /login, so crawling them anyway "discovers" three URLs
     * serving one page and invents duplicate-title, missing-H1 and
     * thin-content findings that describe nothing real on the site.
     *
     * Collects the record for `*` plus any record naming our own UA
     * (a more specific record wins, per the spec).
     */
    function parseRobotsTxt(text) {
        const rules = { allow: [], disallow: [] };
        if (!text) return rules;

        const OUR_AGENTS = ['*', 'audema-seoaudit', 'audema'];
        let specificMatch = false;
        const groups = []; // { agents: [], allow: [], disallow: [] }
        let current = null;
        let lastLineWasAgent = false;

        for (const rawLine of text.split(/\r?\n/)) {
            const line = rawLine.replace(/#.*$/, '').trim();
            if (!line) continue;
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const field = line.slice(0, idx).trim().toLowerCase();
            const value = line.slice(idx + 1).trim();

            if (field === 'user-agent') {
                // Consecutive User-agent lines share one group of rules.
                if (!lastLineWasAgent || !current) {
                    current = { agents: [], allow: [], disallow: [] };
                    groups.push(current);
                }
                current.agents.push(value.toLowerCase());
                lastLineWasAgent = true;
                continue;
            }
            lastLineWasAgent = false;
            if (!current) continue;
            if (field === 'disallow') current.disallow.push(value);
            else if (field === 'allow') current.allow.push(value);
        }

        for (const group of groups) {
            const matchesUs = group.agents.some(a => OUR_AGENTS.includes(a));
            if (!matchesUs) continue;
            const isSpecific = group.agents.some(a => a !== '*' && OUR_AGENTS.includes(a));
            if (isSpecific && !specificMatch) {
                // A record naming us directly supersedes the wildcard record.
                rules.allow = [];
                rules.disallow = [];
                specificMatch = true;
            } else if (specificMatch && !isSpecific) {
                continue;
            }
            rules.allow.push(...group.allow);
            rules.disallow.push(...group.disallow);
        }

        return rules;
    }

    /** Turn a robots.txt path pattern (supports * and $) into a RegExp. */
    function robotsPatternToRegex(pattern) {
        const escaped = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // escape regex metachars, leave * alone
            .replace(/\*/g, '.*');
        const anchored = escaped.endsWith('\\$')
            ? '^' + escaped.slice(0, -2) + '$'
            : '^' + escaped;
        return new RegExp(anchored);
    }

    /**
     * Is this URL disallowed for us by robots.txt?
     * Longest matching rule wins; Allow beats Disallow at equal length.
     */
    function isDisallowedByRobots(url) {
        const rules = AuditState.robotsRules;
        if (!rules || (!rules.disallow.length && !rules.allow.length)) return false;

        let path;
        try {
            const u = new URL(url);
            path = u.pathname + u.search;
        } catch (e) {
            return false;
        }

        let bestDisallow = -1;
        let bestAllow = -1;
        for (const rule of rules.disallow) {
            if (rule === '') continue; // "Disallow:" with no value means allow everything
            try {
                if (robotsPatternToRegex(rule).test(path)) bestDisallow = Math.max(bestDisallow, rule.length);
            } catch (e) { /* malformed pattern — ignore it rather than blocking the crawl */ }
        }
        for (const rule of rules.allow) {
            if (rule === '') continue;
            try {
                if (robotsPatternToRegex(rule).test(path)) bestAllow = Math.max(bestAllow, rule.length);
            } catch (e) { /* ignore */ }
        }

        if (bestDisallow === -1) return false;
        return bestAllow < bestDisallow;
    }

    /**
     * Check robots.txt
     */
    async function checkRobotsTxt(url) {
        const baseUrl = new URL(url);
        const robotsUrl = `${baseUrl.origin}/robots.txt`;

        try {
            // Server-side fetch first (reliable, no CORS restriction), then
            // third-party proxies as a best-effort fallback.
            let text = await fetchViaServer(robotsUrl, 5000);

            if (!text) {
                for (const proxy of AUDIT_CONFIG.corsProxies) {
                    try {
                        const response = await fetch(proxy + encodeURIComponent(robotsUrl), {
                            signal: AbortSignal.timeout(5000)
                        });
                        if (response.ok) {
                            text = await response.text();
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            if (text) {
                // Parse the directives so the crawl below actually obeys them,
                // rather than only reporting on the file's existence.
                AuditState.robotsRules = parseRobotsTxt(text);

                // Entire site blocked = every rule is a bare "/" with nothing
                // allowing anything back in.
                const blocksRoot = AuditState.robotsRules.disallow.includes('/');
                if (blocksRoot && !AuditState.robotsRules.allow.length) {
                    addIssue({
                        severity: SEVERITY.CRITICAL,
                        category: CATEGORY.INDEXING,
                        title: 'robots.txt blocking entire site',
                        description: 'The robots.txt file is blocking all crawlers from the entire site.',
                        url: robotsUrl,
                        recommendation: 'Review your robots.txt file and ensure important pages are not blocked.',
                        evidence: `Disallow rules found: ${AuditState.robotsRules.disallow.join(', ')}`
                    });
                }
                return;
            }

            // If we can't fetch, add a warning
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.INDEXING,
                title: 'Could not verify robots.txt',
                description: 'Unable to fetch and verify robots.txt file.',
                url: robotsUrl,
                recommendation: 'Ensure your robots.txt file exists and is properly configured.'
            });
        } catch (e) {
            // Ignore errors
        }
    }

    /**
     * Check sitemap and extract URLs
     */
    async function checkSitemap(url) {
        const baseUrl = new URL(url);
        const sitemapUrl = `${baseUrl.origin}/sitemap.xml`;
        const extractedUrls = [];

        // Server-side fetch first (reliable), then proxies as fallback.
        async function fetchXml(targetUrl, timeoutMs) {
            const viaServer = await fetchViaServer(targetUrl, timeoutMs);
            if (viaServer) return viaServer;
            for (const proxy of AUDIT_CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(targetUrl), {
                        signal: AbortSignal.timeout(timeoutMs)
                    });
                    if (response.ok) return await response.text();
                } catch (e) {
                    continue;
                }
            }
            return null;
        }

        try {
            const text = await fetchXml(sitemapUrl, 10000);

            if (text) {
                // Check for sitemap index
                if (text.includes('<sitemapindex')) {
                    // Parse sitemap index and get first few sitemaps
                    const sitemapMatches = text.match(/<loc>([^<]+)<\/loc>/g) || [];
                    for (const match of sitemapMatches.slice(0, 3)) {
                        const nestedSitemapUrl = match.replace(/<\/?loc>/g, '');
                        const nestedText = await fetchXml(nestedSitemapUrl, 5000);
                        if (nestedText) {
                            const urlMatches = nestedText.match(/<loc>([^<]+)<\/loc>/g) || [];
                            urlMatches.forEach(m => {
                                const pageUrl = m.replace(/<\/?loc>/g, '');
                                if (pageUrl.startsWith(baseUrl.origin)) {
                                    extractedUrls.push(pageUrl);
                                }
                            });
                        }
                    }
                    return extractedUrls;
                }

                // Regular sitemap
                if (text.includes('<urlset')) {
                    const urlMatches = text.match(/<loc>([^<]+)<\/loc>/g) || [];
                    urlMatches.forEach(match => {
                        const pageUrl = match.replace(/<\/?loc>/g, '');
                        if (pageUrl.startsWith(baseUrl.origin)) {
                            extractedUrls.push(pageUrl);
                        }
                    });

                    // Check sitemap quality
                    if (extractedUrls.length === 0) {
                        addIssue({
                            severity: SEVERITY.MEDIUM,
                            category: CATEGORY.INDEXING,
                            title: 'Empty sitemap',
                            description: 'The sitemap exists but contains no URLs.',
                            url: sitemapUrl,
                            recommendation: 'Ensure your sitemap includes all important pages.'
                        });
                    } else if (extractedUrls.length < 5) {
                        addIssue({
                            severity: SEVERITY.LOW,
                            category: CATEGORY.INDEXING,
                            title: 'Sitemap has few URLs',
                            description: `The sitemap only contains ${extractedUrls.length} URLs.`,
                            url: sitemapUrl,
                            recommendation: 'Consider adding more pages to your sitemap for better indexing.'
                        });
                    }

                    return extractedUrls;
                }
            }

            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.INDEXING,
                title: 'Sitemap not found or invalid',
                description: 'No valid XML sitemap found at /sitemap.xml.',
                url: sitemapUrl,
                recommendation: 'Create an XML sitemap and submit it to Google Search Console. If your sitemap lives elsewhere, reference it from robots.txt.',
                evidence: `Requested ${sitemapUrl} and did not get parseable sitemap XML back.`
            });

            return extractedUrls;
        } catch (e) {
            return extractedUrls;
        }
    }

    /**
     * Check content quality
     */
    function checkContent(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Get text content
        const body = doc.body;
        if (!body) return;

        // Remove script and style elements
        const scripts = body.querySelectorAll('script, style, noscript');
        scripts.forEach(el => el.remove());

        const text = body.textContent.replace(/\s+/g, ' ').trim();
        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

        // Word count is not a ranking signal at this resolution, and plenty
        // of page types are *supposed* to be short: an index or hub page, a
        // changelog, a press kit, a demo, a login screen, a legal notice, a
        // contact page. Padding those to hit an arbitrary word target makes
        // them worse, not better. So the check only applies to pages whose
        // genre implies prose, and it never prescribes a word count.
        const SHORT_BY_DESIGN = /^\/?(|index|home|login|signup|sign-in|register|logout|account|dashboard|app|build|demo|pricing|contact|thanks|thank-you|changelog|releases|press|media|kit|blog|news|archive|category|tag|search|sitemap|legal|terms|privacy|cookies|status|404|500)\/?$/i;
        let pathSegment = '';
        try {
            const p = new URL(url).pathname.replace(/\/$/, '');
            pathSegment = p.split('/').filter(Boolean).pop() || '';
        } catch (e) { /* fall through with empty segment */ }

        const isShortByDesign = SHORT_BY_DESIGN.test(pathSegment);

        if (wordCount < 150 && !isShortByDesign) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.CONTENT,
                title: 'Very little text on page',
                description: `The page has only ~${wordCount} words of body text. If this page is meant to rank for a topic, there may not be enough on it for a search engine to understand what it covers.`,
                url: url,
                recommendation: 'If this is a landing, index or utility page, no action is needed. If it is meant to be a content page, cover the topic more fully — depth that serves the reader, not a word count.',
                evidence: `Extracted body text (~${wordCount} words): "${text.slice(0, 200)}${text.length > 200 ? '…' : ''}"`
            });
        }

        // Check for duplicate content indicators
        const paragraphs = doc.querySelectorAll('p');
        if (paragraphs.length < 3 && wordCount > 100) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.STRUCTURE,
                title: 'Poor content structure',
                description: 'Content is not well-structured with paragraphs.',
                url: url,
                recommendation: 'Break up content into logical paragraphs for better readability.'
            });
        }
    }

    /**
     * Add an issue to the audit results
     */
    function addIssue(issue) {
        issue.id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        issue.timestamp = new Date().toISOString();
        AuditState.issues.push(issue);
        updateIssuesCount();
    }

    /**
     * Update progress display
     */
    function updateProgress(percent, statusText) {
        AuditState.progress = percent;

        if (elements.progressBar) {
            elements.progressBar.style.width = percent + '%';
        }

        if (statusText && elements.auditStatus) {
            elements.auditStatus.textContent = statusText;
        }
    }

    /**
     * Update pages crawled count
     */
    function updatePagesCrawled() {
        if (elements.pagesCrawled) {
            elements.pagesCrawled.textContent = AuditState.pagesCrawled;
        }
    }

    /**
     * Update issues count display
     */
    function updateIssuesCount() {
        const counts = {
            total: AuditState.issues.length,
            critical: AuditState.issues.filter(i => i.severity === SEVERITY.CRITICAL).length,
            high: AuditState.issues.filter(i => i.severity === SEVERITY.HIGH).length,
            medium: AuditState.issues.filter(i => i.severity === SEVERITY.MEDIUM).length,
            low: AuditState.issues.filter(i => i.severity === SEVERITY.LOW).length
        };

        if (elements.issuesFound) {
            elements.issuesFound.textContent = counts.total;
        }
        if (elements.criticalIssues) {
            elements.criticalIssues.textContent = counts.critical;
        }
        if (elements.highIssues) {
            elements.highIssues.textContent = counts.high;
        }
        if (elements.mediumIssues) {
            elements.mediumIssues.textContent = counts.medium;
        }
        if (elements.lowIssues) {
            elements.lowIssues.textContent = counts.low;
        }

        // Update filter tabs
        updateFilterTabs(counts);
    }

    /**
     * Update filter tab counts
     */
    function updateFilterTabs(counts) {
        elements.filterTabs.forEach(tab => {
            const filter = tab.dataset.filter;
            const count = filter === 'all' ? counts.total : counts[filter] || 0;
            tab.textContent = `${capitalizeFirst(filter)} (${count})`;
        });
    }

    /**
     * Update status indicator
     */
    function updateStatusIndicator(status) {
        if (!elements.statusIndicator) return;

        elements.statusIndicator.classList.remove('neutral', 'running', 'complete', 'error', 'success', 'warning');

        switch (status) {
            case 'running':
                elements.statusIndicator.classList.add('running');
                break;
            case 'complete':
                const critical = AuditState.issues.filter(i => i.severity === SEVERITY.CRITICAL).length;
                if (critical > 0) {
                    elements.statusIndicator.classList.add('error');
                } else if (AuditState.issues.length > 0) {
                    elements.statusIndicator.classList.add('warning');
                } else {
                    elements.statusIndicator.classList.add('success');
                }
                break;
            case 'error':
                elements.statusIndicator.classList.add('error');
                break;
            default:
                elements.statusIndicator.classList.add('neutral');
        }
    }

    /**
     * Update run button state
     */
    function updateRunButton(isRunning) {
        if (!elements.runAuditBtn) return;

        if (isRunning) {
            elements.runAuditBtn.disabled = true;
            elements.runAuditBtn.innerHTML = `
                <svg class="spinner" viewBox="0 0 24 24" style="width:18px;height:18px;">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="60" stroke-linecap="round"/>
                </svg>
                Running Audit...
            `;
        } else {
            elements.runAuditBtn.disabled = false;
            elements.runAuditBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Run New Audit
            `;
        }
    }

    /**
     * Display audit results
     */
    function displayResults() {
        if (!elements.issuesTable) return;

        if (AuditState.issues.length === 0) {
            elements.issuesTable.innerHTML = `
                <div class="empty-state success-state">
                    <div class="empty-state-icon success">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </div>
                    <h3>No Issues Found!</h3>
                    <p>Your website passed all technical SEO checks. Great job!</p>
                </div>
            `;
            hideFixButton();
            return;
        }

        renderIssuesTable(AuditState.issues);
        showFixButton();

        // Dispatch event for fixer module
        window.dispatchEvent(new CustomEvent('audit-complete', {
            detail: { issues: AuditState.issues }
        }));
    }

    /**
     * Show the fix issues button
     */
    function showFixButton() {
        const fixButton = document.getElementById('fixIssues');
        if (fixButton) {
            fixButton.style.display = 'flex';
        }
    }

    /**
     * Hide the fix issues button
     */
    function hideFixButton() {
        const fixButton = document.getElementById('fixIssues');
        if (fixButton) {
            fixButton.style.display = 'none';
        }
    }

    /**
     * Render issues table
     */
    function renderIssuesTable(issues) {
        if (!elements.issuesTable) return;

        const tableHtml = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Severity</th>
                        <th>Issue</th>
                        <th>Category</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    ${issues.map(issue => `
                        <tr class="issue-row" data-severity="${issue.severity}">
                            <td>
                                <span class="severity-badge ${issue.severity}">${capitalizeFirst(issue.severity)}</span>
                            </td>
                            <td>
                                <strong>${escapeHtml(issue.title)}</strong>
                            </td>
                            <td>
                                <span class="category-tag">${escapeHtml(issue.category)}</span>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-ghost view-details" data-issue-id="${issue.id}">
                                    View Details
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        elements.issuesTable.innerHTML = tableHtml;

        // Add click handlers for details
        elements.issuesTable.querySelectorAll('.view-details').forEach(btn => {
            btn.addEventListener('click', () => showIssueDetails(btn.dataset.issueId));
        });
    }

    /**
     * Filter issues by severity
     */
    function filterIssues(filter) {
        // Update active tab
        elements.filterTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.filter === filter);
        });

        // Filter and display
        let filtered = AuditState.issues;
        if (filter !== 'all') {
            filtered = AuditState.issues.filter(i => i.severity === filter);
        }

        if (filtered.length === 0) {
            elements.issuesTable.innerHTML = `
                <div class="empty-state">
                    <p>No ${filter === 'all' ? '' : filter + ' '}issues found.</p>
                </div>
            `;
        } else {
            renderIssuesTable(filtered);
        }
    }

    /**
     * Show issue details modal
     */
    function showIssueDetails(issueId) {
        const issue = AuditState.issues.find(i => i.id === issueId);
        if (!issue) return;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal issue-modal">
                <div class="modal-header">
                    <h3>
                        <span class="severity-badge ${issue.severity}">${capitalizeFirst(issue.severity)}</span>
                        ${escapeHtml(issue.title)}
                    </h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="issue-detail-section">
                        <h4>Description</h4>
                        <p>${escapeHtml(issue.description)}</p>
                    </div>
                    <div class="issue-detail-section">
                        <h4>Affected URL</h4>
                        <code>${escapeHtml(issue.url)}</code>
                    </div>
                    ${issue.evidence ? `
                    <div class="issue-detail-section">
                        <h4>What we actually found on the page</h4>
                        <pre style="white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.25);padding:12px;border-radius:8px;font-size:0.85rem;margin:0;">${escapeHtml(issue.evidence)}</pre>
                    </div>` : ''}
                    <div class="issue-detail-section">
                        <h4>Recommendation</h4>
                        <p>${escapeHtml(issue.recommendation)}</p>
                    </div>
                    <div class="issue-detail-section">
                        <h4>Category</h4>
                        <span class="category-tag">${escapeHtml(issue.category)}</span>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary close-modal">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    /**
     * Save audit results to localStorage
     */
    function saveAuditResults() {
        const result = {
            id: 'audit_' + Date.now(),
            timestamp: new Date().toISOString(),
            url: AuditState.currentUrl,
            duration: Date.now() - AuditState.startTime,
            pagesCrawled: AuditState.pagesCrawled,
            issues: AuditState.issues,
            brokenLinks: AuditState.brokenLinks,
            crawledUrls: Array.from(AuditState.crawledUrls),
            linksChecked: AuditState.allLinks.length,
            summary: {
                total: AuditState.issues.length,
                critical: AuditState.issues.filter(i => i.severity === SEVERITY.CRITICAL).length,
                high: AuditState.issues.filter(i => i.severity === SEVERITY.HIGH).length,
                medium: AuditState.issues.filter(i => i.severity === SEVERITY.MEDIUM).length,
                low: AuditState.issues.filter(i => i.severity === SEVERITY.LOW).length,
                byCategory: {
                    meta: AuditState.issues.filter(i => i.category === CATEGORY.META).length,
                    content: AuditState.issues.filter(i => i.category === CATEGORY.CONTENT).length,
                    links: AuditState.issues.filter(i => i.category === CATEGORY.LINKS).length,
                    images: AuditState.issues.filter(i => i.category === CATEGORY.IMAGES).length,
                    performance: AuditState.issues.filter(i => i.category === CATEGORY.PERFORMANCE).length,
                    mobile: AuditState.issues.filter(i => i.category === CATEGORY.MOBILE).length,
                    security: AuditState.issues.filter(i => i.category === CATEGORY.SECURITY).length,
                    indexing: AuditState.issues.filter(i => i.category === CATEGORY.INDEXING).length,
                    structure: AuditState.issues.filter(i => i.category === CATEGORY.STRUCTURE).length
                }
            }
        };

        // Save to history
        const history = JSON.parse(localStorage.getItem('seo-audit-history') || '[]');
        history.unshift(result);

        // Keep last 20 audits
        if (history.length > 20) {
            history.pop();
        }

        localStorage.setItem('seo-audit-history', JSON.stringify(history));
        localStorage.setItem('seo-last-audit', JSON.stringify(result));

        // Also save broken links separately for the Broken Links page
        localStorage.setItem('seo-broken-links', JSON.stringify({
            timestamp: new Date().toISOString(),
            links: AuditState.brokenLinks,
            totalLinksChecked: AuditState.allLinks.length
        }));

        // Update last audit time in progress section
        const progressStats = document.querySelector('.progress-stats');
        if (progressStats) {
            const lastSpan = progressStats.querySelector('span:last-child');
            if (lastSpan) {
                lastSpan.textContent = 'Just now';
            }
        }
    }

    /**
     * Load last audit results
     */
    function loadLastAudit() {
        const lastAudit = localStorage.getItem('seo-last-audit');
        if (!lastAudit) return;

        try {
            const audit = JSON.parse(lastAudit);
            AuditState.issues = audit.issues || [];
            AuditState.pagesCrawled = audit.pagesCrawled || 0;
            AuditState.currentUrl = audit.url;

            // Update display
            updateIssuesCount();
            updatePagesCrawled();

            if (elements.progressBar) {
                elements.progressBar.style.width = '100%';
            }

            if (elements.auditStatus) {
                const timeAgo = getTimeAgo(new Date(audit.timestamp));
                elements.auditStatus.textContent = `Completed ${timeAgo}`;
            }

            updateStatusIndicator('complete');
            displayResults();

            // Update last audit time
            const progressStats = document.querySelector('.progress-stats');
            if (progressStats) {
                const lastSpan = progressStats.querySelector('span:last-child');
                if (lastSpan) {
                    lastSpan.textContent = getTimeAgo(new Date(audit.timestamp));
                }
            }
        } catch (e) {
            console.error('Error loading last audit:', e);
        }
    }

    /**
     * Helper: Sleep for ms
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Helper: Capitalize first letter
     */
    function capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Helper: Escape HTML
     */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Helper: Get time ago string
     */
    function getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
        if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';

        return date.toLocaleDateString();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /**
     * Programmatic constructor API used by analysis-engine.js and api-production.js:
     *   const audit = new window.SEOAudit(url, { maxPages, maxDepth, checkBrokenLinks, onProgress, onComplete, onError });
     *   audit.start();
     */
    function SEOAuditConstructor(url, options = {}) {
        this.url     = url;
        this.options = options;
    }

    SEOAuditConstructor.prototype.start = async function () {
        const { maxPages = AUDIT_CONFIG.maxPages, maxDepth = AUDIT_CONFIG.maxDepth,
                onProgress, onComplete, onError } = this.options;
        const url = this.url;

        if (AuditState.isRunning) {
            if (onError) onError(new Error('An audit is already running.'));
            return;
        }

        // Reset state
        AuditState.isRunning = true;
        AuditState.progress = 0;
        AuditState.pagesCrawled = 0;
        AuditState.totalPagesToCheck = 0;
        AuditState.issues = [];
        AuditState.startTime = Date.now();
        AuditState.currentUrl = url;
        AuditState.crawledUrls = new Set();
        AuditState.pendingUrls = [];
        AuditState.brokenLinks = [];
        AuditState.allLinks = [];
        AuditState.pageData = {};

        const fireProgress = (msg) => {
            if (onProgress) onProgress({
                crawledUrls: [...AuditState.crawledUrls],
                pagesCrawled: AuditState.pagesCrawled,
                issues: AuditState.issues,
                message: msg
            });
        };

        try {
            fireProgress('Checking security...');
            await checkSecurity(url);

            fireProgress('Checking robots.txt...');
            await checkRobotsTxt(url);

            fireProgress('Checking sitemap...');
            const sitemapUrls = await checkSitemap(url);

            fireProgress('Discovering pages...');
            AuditState.pendingUrls.push({ url: normalizeUrl(url), depth: 0 });
            if (sitemapUrls && sitemapUrls.length > 0) {
                sitemapUrls.slice(0, Math.floor(maxPages / 2)).forEach(u => {
                    if (!AuditState.crawledUrls.has(u)) {
                        AuditState.pendingUrls.push({ url: u, depth: 1 });
                    }
                });
            }

            // Override maxDepth for this run
            const origMaxDepth = AUDIT_CONFIG.maxDepth;
            AUDIT_CONFIG.maxDepth = maxDepth;

            await crawlPages(url, maxPages);
            AUDIT_CONFIG.maxDepth = origMaxDepth;

            fireProgress('Verifying links...');
            await verifyLinks();

            fireProgress('Analysing results...');
            generateSummaryIssues();

            AuditState.isRunning = false;

            if (onComplete) onComplete({
                crawledUrls: [...AuditState.crawledUrls],
                issues: AuditState.issues,
                pageData: AuditState.pageData,
                pageTitles: Object.fromEntries(
                    Object.entries(AuditState.pageData).map(([k, v]) => [k, v.title || ''])
                ),
                brokenLinks: AuditState.brokenLinks,
                duration: Date.now() - AuditState.startTime
            });

        } catch (error) {
            AuditState.isRunning = false;
            console.error('[SEOAudit] Crawl error:', error);
            if (onError) onError(error);
        }
    };

    // Expose both constructor (for programmatic use) and legacy object (for UI use)
    window.SEOAudit = SEOAuditConstructor;
    window.SEOAudit.start      = startAudit;
    window.SEOAudit.getResults = () => AuditState.issues;
    window.SEOAudit.getState   = () => AuditState;

})();
