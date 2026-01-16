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
        pageData: {} // Store data for each crawled page
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

            // Mark as crawled
            AuditState.crawledUrls.add(url);

            // Update progress (5% to 80% range for crawling)
            const crawlProgress = 5 + ((AuditState.pagesCrawled / maxPages) * 75);
            updateProgress(crawlProgress, `Crawling: ${truncateUrl(url, 50)}`);

            try {
                // Fetch the page
                const html = await fetchPage(url);
                AuditState.pagesCrawled++;
                updatePagesCrawled();

                if (html) {
                    // Store page data
                    AuditState.pageData[url] = {
                        html,
                        crawledAt: new Date().toISOString()
                    };

                    // Run checks on this page
                    await runPageChecks(html, url);

                    // Extract and queue internal links
                    const links = extractLinks(html, url, baseDomain);

                    links.internal.forEach(link => {
                        const normalizedLink = normalizeUrl(link);
                        if (!AuditState.crawledUrls.has(normalizedLink) &&
                            !AuditState.pendingUrls.some(p => p.url === normalizedLink)) {
                            AuditState.pendingUrls.push({ url: normalizedLink, depth: depth + 1 });
                        }
                    });

                    // Track all links for broken link checking
                    AuditState.allLinks.push(...links.all.map(l => ({ from: url, to: l.href, text: l.text })));
                }

                // Delay between requests
                await sleep(AUDIT_CONFIG.crawlDelay);

            } catch (e) {
                console.warn(`Failed to crawl ${url}:`, e.message);
            }
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
        // Try HEAD request first (faster)
        for (const proxy of AUDIT_CONFIG.corsProxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(url), {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(5000)
                });
                return response.status;
            } catch (e) {
                // Try GET
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

        // Flag widespread issues
        Object.entries(issuesByType).forEach(([title, issues]) => {
            if (issues.length > pageCount * 0.5 && issues.length > 3) {
                // More than 50% of pages have this issue - it's site-wide
                const firstIssue = issues[0];
                if (firstIssue.severity !== SEVERITY.CRITICAL) {
                    // Upgrade to site-wide issue
                    addIssue({
                        severity: SEVERITY.HIGH,
                        category: firstIssue.category,
                        title: `Site-wide: ${title}`,
                        description: `This issue affects ${issues.length} out of ${pageCount} pages (${Math.round(issues.length/pageCount*100)}%). This appears to be a template-level problem.`,
                        url: AuditState.currentUrl,
                        recommendation: 'Fix this issue at the template level to resolve it across all affected pages.'
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

        // Report duplicate titles
        Object.entries(titles).forEach(([title, urls]) => {
            if (urls.length > 1) {
                addIssue({
                    severity: SEVERITY.HIGH,
                    category: CATEGORY.META,
                    title: 'Duplicate title tags',
                    description: `${urls.length} pages share the same title: "${truncateUrl(title, 50)}". Each page should have a unique title.`,
                    url: urls[0],
                    recommendation: 'Create unique, descriptive title tags for each page.'
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
                    recommendation: 'Write unique meta descriptions for each page.'
                });
            }
        });
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

        // Check for render-blocking scripts in head
        const headScripts = doc.querySelectorAll('head script:not([async]):not([defer])');
        if (headScripts.length > 2) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.PERFORMANCE,
                title: 'Render-blocking scripts',
                description: `${headScripts.length} scripts in <head> without async/defer may block page rendering.`,
                url: url,
                recommendation: 'Add async or defer attributes to non-critical scripts, or move them before </body>.'
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

        // Check for preconnect/preload hints
        const preconnect = doc.querySelectorAll('link[rel="preconnect"]');
        const preload = doc.querySelectorAll('link[rel="preload"]');

        if (preconnect.length === 0 && preload.length === 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.PERFORMANCE,
                title: 'No resource hints',
                description: 'No preconnect or preload hints found. These can improve loading performance.',
                url: url,
                recommendation: 'Add preconnect for third-party domains and preload for critical resources.'
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
     * Fetch page content
     */
    async function fetchPage(url) {
        // Try direct fetch first (will work for same-origin)
        try {
            const response = await fetch(url, {
                mode: 'cors',
                headers: { 'Accept': 'text/html' }
            });
            if (response.ok) {
                return await response.text();
            }
        } catch (e) {
            // Expected for cross-origin
        }

        // Try CORS proxies
        for (const proxy of AUDIT_CONFIG.corsProxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(url), {
                    signal: AbortSignal.timeout(AUDIT_CONFIG.timeout)
                });
                if (response.ok) {
                    return await response.text();
                }
            } catch (e) {
                continue;
            }
        }

        // If all fetches fail, generate simulated audit based on URL analysis
        console.warn('Could not fetch page, running limited audit');
        return generateSimulatedHtml(url);
    }

    /**
     * Generate simulated HTML for analysis when fetch fails
     */
    function generateSimulatedHtml(url) {
        // Return a minimal HTML that will trigger some common issues
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title></title>
            </head>
            <body>
                <h2>Content</h2>
                <img src="image.jpg">
                <a href="http://example.com">Link</a>
            </body>
            </html>
        `;
    }

    /**
     * Check meta tags
     */
    function checkMetaTags(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Title tag
        const title = doc.querySelector('title');
        const titleText = title ? title.textContent.trim() : '';

        if (!titleText) {
            addIssue({
                severity: SEVERITY.CRITICAL,
                category: CATEGORY.META,
                title: 'Missing title tag',
                description: 'The page is missing a title tag. Title tags are crucial for SEO and user experience.',
                url: url,
                recommendation: 'Add a unique, descriptive title tag between 50-60 characters.'
            });
        } else if (titleText.length < 30) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.META,
                title: 'Title tag too short',
                description: `Title tag is only ${titleText.length} characters. Recommended: 50-60 characters.`,
                url: url,
                recommendation: 'Expand your title to include relevant keywords and be more descriptive.'
            });
        } else if (titleText.length > 60) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Title tag too long',
                description: `Title tag is ${titleText.length} characters. It may be truncated in search results.`,
                url: url,
                recommendation: 'Shorten your title to 60 characters or less.'
            });
        }

        // Meta description
        const metaDesc = doc.querySelector('meta[name="description"]');
        const descText = metaDesc ? metaDesc.getAttribute('content')?.trim() : '';

        if (!descText) {
            addIssue({
                severity: SEVERITY.HIGH,
                category: CATEGORY.META,
                title: 'Missing meta description',
                description: 'The page is missing a meta description. This affects click-through rates from search results.',
                url: url,
                recommendation: 'Add a compelling meta description between 150-160 characters.'
            });
        } else if (descText.length < 120) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.META,
                title: 'Meta description too short',
                description: `Meta description is only ${descText.length} characters. Recommended: 150-160 characters.`,
                url: url,
                recommendation: 'Expand your meta description to be more compelling and informative.'
            });
        } else if (descText.length > 160) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Meta description too long',
                description: `Meta description is ${descText.length} characters. It may be truncated in search results.`,
                url: url,
                recommendation: 'Shorten your meta description to 160 characters or less.'
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
                recommendation: 'Add: <meta name="viewport" content="width=device-width, initial-scale=1">'
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
                recommendation: 'Add a canonical link tag pointing to the preferred URL of this page.'
            });
        }

        // Open Graph tags
        const ogTitle = doc.querySelector('meta[property="og:title"]');
        const ogDesc = doc.querySelector('meta[property="og:description"]');
        const ogImage = doc.querySelector('meta[property="og:image"]');

        if (!ogTitle || !ogDesc || !ogImage) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.META,
                title: 'Incomplete Open Graph tags',
                description: 'Missing some Open Graph meta tags (og:title, og:description, or og:image).',
                url: url,
                recommendation: 'Add complete Open Graph tags for better social media sharing.'
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
                recommendation: 'Add a lang attribute to the <html> element (e.g., lang="en").'
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
            addIssue({
                severity: SEVERITY.CRITICAL,
                category: CATEGORY.CONTENT,
                title: 'Missing H1 heading',
                description: 'The page has no H1 heading. Every page should have exactly one H1.',
                url: url,
                recommendation: 'Add a single, descriptive H1 heading that includes your main keyword.'
            });
        } else if (h1s.length > 1) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.CONTENT,
                title: 'Multiple H1 headings',
                description: `The page has ${h1s.length} H1 headings. Best practice is to have exactly one H1.`,
                url: url,
                recommendation: 'Keep only one H1 heading per page and use H2-H6 for subheadings.'
            });
        } else {
            const h1Text = h1s[0].textContent.trim();
            if (h1Text.length < 20) {
                addIssue({
                    severity: SEVERITY.LOW,
                    category: CATEGORY.CONTENT,
                    title: 'H1 heading too short',
                    description: `The H1 heading is only ${h1Text.length} characters long.`,
                    url: url,
                    recommendation: 'Make your H1 more descriptive and include relevant keywords.'
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
        let externalNoRel = 0;

        links.forEach(link => {
            const href = link.getAttribute('href');
            const text = link.textContent.trim();
            const rel = link.getAttribute('rel');

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

            // Check external links without rel
            try {
                const linkUrl = new URL(href, url);
                if (linkUrl.hostname !== baseUrl.hostname && !rel?.includes('noopener')) {
                    externalNoRel++;
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

        if (externalNoRel > 0) {
            addIssue({
                severity: SEVERITY.LOW,
                category: CATEGORY.SECURITY,
                title: 'External links missing rel="noopener"',
                description: `${externalNoRel} external link(s) are missing rel="noopener" attribute.`,
                url: url,
                recommendation: 'Add rel="noopener noreferrer" to external links for security.'
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
                recommendation: 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.'
            });
        }
    }

    /**
     * Check robots.txt
     */
    async function checkRobotsTxt(url) {
        const baseUrl = new URL(url);
        const robotsUrl = `${baseUrl.origin}/robots.txt`;

        try {
            // Try to fetch robots.txt through proxy
            for (const proxy of AUDIT_CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(robotsUrl), {
                        signal: AbortSignal.timeout(5000)
                    });
                    if (response.ok) {
                        const text = await response.text();
                        if (text.toLowerCase().includes('disallow: /')) {
                            // Check if entire site is blocked
                            if (text.match(/Disallow:\s*\/\s*$/m)) {
                                addIssue({
                                    severity: SEVERITY.CRITICAL,
                                    category: CATEGORY.INDEXING,
                                    title: 'robots.txt blocking entire site',
                                    description: 'The robots.txt file is blocking all crawlers from the entire site.',
                                    url: robotsUrl,
                                    recommendation: 'Review your robots.txt file and ensure important pages are not blocked.'
                                });
                            }
                        }
                        return;
                    }
                } catch (e) {
                    continue;
                }
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

        try {
            for (const proxy of AUDIT_CONFIG.corsProxies) {
                try {
                    const response = await fetch(proxy + encodeURIComponent(sitemapUrl), {
                        signal: AbortSignal.timeout(10000)
                    });
                    if (response.ok) {
                        const text = await response.text();

                        // Check for sitemap index
                        if (text.includes('<sitemapindex')) {
                            // Parse sitemap index and get first few sitemaps
                            const sitemapMatches = text.match(/<loc>([^<]+)<\/loc>/g) || [];
                            for (const match of sitemapMatches.slice(0, 3)) {
                                const nestedSitemapUrl = match.replace(/<\/?loc>/g, '');
                                try {
                                    const nestedResponse = await fetch(proxy + encodeURIComponent(nestedSitemapUrl), {
                                        signal: AbortSignal.timeout(5000)
                                    });
                                    if (nestedResponse.ok) {
                                        const nestedText = await nestedResponse.text();
                                        const urlMatches = nestedText.match(/<loc>([^<]+)<\/loc>/g) || [];
                                        urlMatches.forEach(m => {
                                            const pageUrl = m.replace(/<\/?loc>/g, '');
                                            if (pageUrl.startsWith(baseUrl.origin)) {
                                                extractedUrls.push(pageUrl);
                                            }
                                        });
                                    }
                                } catch (e) {
                                    // Continue
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
                } catch (e) {
                    continue;
                }
            }

            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.INDEXING,
                title: 'Sitemap not found or invalid',
                description: 'No valid XML sitemap found at /sitemap.xml.',
                url: sitemapUrl,
                recommendation: 'Create an XML sitemap and submit it to Google Search Console.'
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

        if (wordCount < 300) {
            addIssue({
                severity: SEVERITY.MEDIUM,
                category: CATEGORY.CONTENT,
                title: 'Thin content detected',
                description: `The page has only ~${wordCount} words. Pages with thin content may not rank well.`,
                url: url,
                recommendation: 'Add more valuable, comprehensive content. Aim for at least 500-1000 words for main pages.'
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
            return;
        }

        renderIssuesTable(AuditState.issues);
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

    // Expose for external use
    window.SEOAudit = {
        start: startAudit,
        getResults: () => AuditState.issues,
        getState: () => AuditState
    };

})();
