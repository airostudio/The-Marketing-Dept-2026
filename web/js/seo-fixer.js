/**
 * SEO Issue Fixer Module
 * Analyzes audit issues and generates fixes/code snippets
 */

(function() {
    'use strict';

    // Fix categories
    const FIX_TYPE = {
        AUTO: 'auto',      // Can be automatically fixed with generated code
        MANUAL: 'manual',  // Requires manual intervention
        DOWNLOAD: 'download' // Generates a downloadable file
    };

    // Fixer state
    const FixerState = {
        isRunning: false,
        issues: [],
        fixes: [],
        progress: 0,
        fixed: 0,
        pending: 0,
        manual: 0,
        generatedFiles: {}
    };

    // DOM Elements
    let elements = {};

    /**
     * Initialize the fixer module
     */
    function init() {
        cacheElements();
        setupEventListeners();
        checkForIssues();
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements = {
            fixButton: document.getElementById('fixIssues'),
            fixModal: document.getElementById('fixModal'),
            closeModal: document.getElementById('closeFixModal'),
            startFix: document.getElementById('startFix'),
            cancelFix: document.getElementById('cancelFix'),
            downloadFixes: document.getElementById('downloadFixes'),
            progressBar: document.getElementById('fixProgressBar'),
            statusText: document.getElementById('fixStatusText'),
            fixedCount: document.getElementById('fixedCount'),
            pendingCount: document.getElementById('pendingCount'),
            manualCount: document.getElementById('manualCount'),
            fixResults: document.getElementById('fixResults')
        };
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        if (elements.fixButton) {
            elements.fixButton.addEventListener('click', openFixModal);
        }

        if (elements.closeModal) {
            elements.closeModal.addEventListener('click', closeFixModal);
        }

        if (elements.cancelFix) {
            elements.cancelFix.addEventListener('click', closeFixModal);
        }

        if (elements.startFix) {
            elements.startFix.addEventListener('click', startFixing);
        }

        if (elements.downloadFixes) {
            elements.downloadFixes.addEventListener('click', downloadAllFixes);
        }

        if (elements.fixModal) {
            elements.fixModal.addEventListener('click', (e) => {
                if (e.target === elements.fixModal) {
                    closeFixModal();
                }
            });
        }

        // Listen for audit completion to show fix button
        window.addEventListener('audit-complete', checkForIssues);
    }

    /**
     * Check if there are issues to fix and show/hide button
     */
    function checkForIssues() {
        const lastAudit = localStorage.getItem('seo-last-audit');
        if (!lastAudit) return;

        try {
            const audit = JSON.parse(lastAudit);
            if (audit.issues && audit.issues.length > 0) {
                FixerState.issues = audit.issues;
                showFixButton();
            }
        } catch (e) {
            console.error('Error checking issues:', e);
        }
    }

    /**
     * Show the fix issues button
     */
    function showFixButton() {
        if (elements.fixButton) {
            elements.fixButton.style.display = 'flex';
        }
    }

    /**
     * Open the fix modal
     */
    function openFixModal() {
        if (!elements.fixModal) return;

        // Reset state
        FixerState.fixes = [];
        FixerState.progress = 0;
        FixerState.fixed = 0;
        FixerState.pending = FixerState.issues.length;
        FixerState.manual = 0;
        FixerState.generatedFiles = {};

        // Reset UI
        updateProgress(0, 'Ready to analyze and fix issues...');
        updateCounts();
        elements.fixResults.innerHTML = '';
        elements.startFix.style.display = 'flex';
        elements.downloadFixes.style.display = 'none';

        elements.fixModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Close the fix modal
     */
    function closeFixModal() {
        if (!elements.fixModal) return;
        elements.fixModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    /**
     * Start the fixing process
     */
    async function startFixing() {
        if (FixerState.isRunning) return;

        FixerState.isRunning = true;
        elements.startFix.disabled = true;
        elements.startFix.innerHTML = `
            <svg class="spinner" viewBox="0 0 24 24" style="width:18px;height:18px;">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="60" stroke-linecap="round"/>
            </svg>
            Analyzing...
        `;

        try {
            await analyzeAndFix();
        } catch (error) {
            console.error('Fix error:', error);
            updateProgress(100, 'Error: ' + error.message);
        }

        FixerState.isRunning = false;
        elements.startFix.style.display = 'none';
        elements.downloadFixes.style.display = 'flex';
    }

    /**
     * Analyze issues and generate fixes
     */
    async function analyzeAndFix() {
        const issues = FixerState.issues;
        const total = issues.length;
        const project = getCurrentProject();
        const baseUrl = project?.websiteUrl || '';

        // Group issues by type for efficient processing
        const issueGroups = groupIssues(issues);

        updateProgress(5, 'Analyzing issues...');
        await sleep(300);

        let processed = 0;

        // Process Meta Tag Issues
        if (issueGroups.meta.length > 0) {
            updateProgress(10, 'Generating meta tag fixes...');
            await processMetaIssues(issueGroups.meta, baseUrl);
            processed += issueGroups.meta.length;
        }

        // Process Indexing Issues
        if (issueGroups.indexing.length > 0) {
            updateProgress(25, 'Generating indexing fixes...');
            await processIndexingIssues(issueGroups.indexing, baseUrl);
            processed += issueGroups.indexing.length;
        }

        // Process Structure Issues
        if (issueGroups.structure.length > 0) {
            updateProgress(40, 'Generating structure fixes...');
            await processStructureIssues(issueGroups.structure, baseUrl);
            processed += issueGroups.structure.length;
        }

        // Process Content Issues
        if (issueGroups.content.length > 0) {
            updateProgress(55, 'Analyzing content issues...');
            await processContentIssues(issueGroups.content, baseUrl);
            processed += issueGroups.content.length;
        }

        // Process Image Issues
        if (issueGroups.images.length > 0) {
            updateProgress(65, 'Analyzing image issues...');
            await processImageIssues(issueGroups.images, baseUrl);
            processed += issueGroups.images.length;
        }

        // Process Link Issues
        if (issueGroups.links.length > 0) {
            updateProgress(75, 'Analyzing link issues...');
            await processLinkIssues(issueGroups.links, baseUrl);
            processed += issueGroups.links.length;
        }

        // Process Performance Issues
        if (issueGroups.performance.length > 0) {
            updateProgress(85, 'Generating performance fixes...');
            await processPerformanceIssues(issueGroups.performance, baseUrl);
            processed += issueGroups.performance.length;
        }

        // Process Security Issues
        if (issueGroups.security.length > 0) {
            updateProgress(92, 'Analyzing security issues...');
            await processSecurityIssues(issueGroups.security, baseUrl);
            processed += issueGroups.security.length;
        }

        // Process Mobile Issues
        if (issueGroups.mobile.length > 0) {
            updateProgress(96, 'Analyzing mobile issues...');
            await processMobileIssues(issueGroups.mobile, baseUrl);
            processed += issueGroups.mobile.length;
        }

        updateProgress(100, 'Analysis complete!');
        await sleep(500);

        // Display results
        displayFixResults();
    }

    /**
     * Group issues by category
     */
    function groupIssues(issues) {
        const groups = {
            meta: [],
            indexing: [],
            structure: [],
            content: [],
            images: [],
            links: [],
            performance: [],
            security: [],
            mobile: []
        };

        issues.forEach(issue => {
            const category = issue.category?.toLowerCase() || 'other';
            if (category === 'meta tags') groups.meta.push(issue);
            else if (category === 'indexing') groups.indexing.push(issue);
            else if (category === 'structure') groups.structure.push(issue);
            else if (category === 'content') groups.content.push(issue);
            else if (category === 'images') groups.images.push(issue);
            else if (category === 'links') groups.links.push(issue);
            else if (category === 'performance') groups.performance.push(issue);
            else if (category === 'security') groups.security.push(issue);
            else if (category === 'mobile') groups.mobile.push(issue);
        });

        return groups;
    }

    /**
     * Process meta tag issues
     */
    async function processMetaIssues(issues, baseUrl) {
        const project = getCurrentProject();
        const siteName = project?.businessName || 'Your Site';

        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('missing title tag') || title.includes('title tag too short')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add/Update Title Tag',
                    description: 'Generated an optimized title tag for this page.',
                    code: generateTitleTag(issue.url, siteName),
                    language: 'html',
                    instructions: 'Add this to the <head> section of your HTML.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('missing meta description') || title.includes('meta description too short')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add/Update Meta Description',
                    description: 'Generated a compelling meta description.',
                    code: generateMetaDescription(issue.url, siteName),
                    language: 'html',
                    instructions: 'Add this to the <head> section of your HTML.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('open graph')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Open Graph Tags',
                    description: 'Generated complete Open Graph meta tags for social sharing.',
                    code: generateOpenGraphTags(issue.url, siteName),
                    language: 'html',
                    instructions: 'Add these tags to the <head> section of your HTML.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('duplicate title')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Duplicate Title Tags',
                    description: 'Multiple pages share the same title. Each page needs a unique title.',
                    instructions: 'Review the affected pages and create unique, descriptive titles for each.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('duplicate meta description')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Duplicate Meta Descriptions',
                    description: 'Multiple pages share the same description.',
                    instructions: 'Write unique meta descriptions for each page that accurately describe the content.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process indexing issues
     */
    async function processIndexingIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('missing canonical')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Canonical URL',
                    description: 'Generated canonical link tag for this page.',
                    code: `<link rel="canonical" href="${issue.url}">`,
                    language: 'html',
                    instructions: 'Add this to the <head> section of each affected page.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('sitemap not found') || title.includes('empty sitemap')) {
                const sitemapContent = generateSitemap(baseUrl);
                FixerState.generatedFiles['sitemap.xml'] = sitemapContent;

                addFix({
                    issue: issue,
                    type: FIX_TYPE.DOWNLOAD,
                    title: 'Generate XML Sitemap',
                    description: 'Created a basic XML sitemap for your website.',
                    code: sitemapContent,
                    language: 'xml',
                    fileName: 'sitemap.xml',
                    instructions: 'Upload this file to your website root directory and submit to Google Search Console.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('robots.txt blocking')) {
                const robotsContent = generateRobotsTxt(baseUrl);
                FixerState.generatedFiles['robots.txt'] = robotsContent;

                addFix({
                    issue: issue,
                    type: FIX_TYPE.DOWNLOAD,
                    title: 'Fix robots.txt',
                    description: 'Generated a proper robots.txt that allows crawling.',
                    code: robotsContent,
                    language: 'text',
                    fileName: 'robots.txt',
                    instructions: 'Replace your current robots.txt with this file.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('could not verify robots')) {
                const robotsContent = generateRobotsTxt(baseUrl);
                FixerState.generatedFiles['robots.txt'] = robotsContent;

                addFix({
                    issue: issue,
                    type: FIX_TYPE.DOWNLOAD,
                    title: 'Create robots.txt',
                    description: 'Generated a robots.txt file for your website.',
                    code: robotsContent,
                    language: 'text',
                    fileName: 'robots.txt',
                    instructions: 'Upload this file to your website root directory.'
                });
                FixerState.fixed++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process structure issues
     */
    async function processStructureIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('missing language')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Language Attribute',
                    description: 'Add the lang attribute to your HTML element.',
                    code: '<html lang="en">',
                    language: 'html',
                    instructions: 'Change your opening <html> tag to include the lang attribute.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('skipped heading')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Heading Hierarchy',
                    description: 'Your page skips heading levels. Use proper heading hierarchy.',
                    instructions: 'Restructure your headings to follow H1 → H2 → H3 order without skipping levels.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('poor content structure')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Improve Content Structure',
                    description: 'Your content lacks proper paragraph structure.',
                    instructions: 'Break up your content into logical paragraphs using <p> tags.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process content issues
     */
    async function processContentIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('missing h1') || title.includes('multiple h1')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix H1 Heading',
                    description: title.includes('missing') ? 'Add an H1 heading to this page.' : 'Reduce to a single H1 heading.',
                    instructions: 'Ensure each page has exactly one descriptive H1 heading that includes your main keyword.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('thin content')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Expand Page Content',
                    description: 'This page has insufficient content for good SEO.',
                    instructions: 'Add more valuable, relevant content. Aim for at least 500-1000 words for main pages.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process image issues
     */
    async function processImageIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('missing alt')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Alt Attributes',
                    description: 'Add descriptive alt text to all images.',
                    code: `<img src="image.jpg" alt="Descriptive text about the image" width="800" height="600">`,
                    language: 'html',
                    instructions: 'Add alt attributes to all images that convey meaning. Use descriptive text that explains what the image shows.'
                });
                FixerState.manual++; // Still needs manual review for proper descriptions
            }
            else if (title.includes('missing dimensions')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Image Dimensions',
                    description: 'Add width and height attributes to prevent layout shifts.',
                    code: `<img src="image.jpg" alt="Description" width="800" height="600">`,
                    language: 'html',
                    instructions: 'Add width and height attributes matching the actual image dimensions.'
                });
                FixerState.manual++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process link issues
     */
    async function processLinkIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('broken link')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Broken Link',
                    description: 'Remove or update the broken link.',
                    instructions: 'Either update the link to a valid URL or remove it entirely.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('empty or invalid')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Empty Links',
                    description: 'Remove or add proper href to empty links.',
                    instructions: 'Links with empty or # href should be removed or converted to buttons if they perform JavaScript actions.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('without descriptive text')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Link Text',
                    description: 'Add descriptive anchor text to links.',
                    code: `<a href="/page">Descriptive link text that explains where the link goes</a>`,
                    language: 'html',
                    instructions: 'Replace empty links with descriptive text or add aria-label for icon links.'
                });
                FixerState.manual++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process performance issues
     */
    async function processPerformanceIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('render-blocking')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Fix Render-Blocking Scripts',
                    description: 'Add async or defer to non-critical scripts.',
                    code: `<!-- For non-critical scripts, add async or defer -->
<script src="analytics.js" async></script>
<script src="non-critical.js" defer></script>

<!-- Move scripts to end of body when possible -->
</body>
</html>`,
                    language: 'html',
                    instructions: 'Add async for scripts that don\'t depend on other scripts, or defer for scripts that need to run after DOM is ready.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('resource hints')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Resource Hints',
                    description: 'Add preconnect and preload hints for faster loading.',
                    code: `<!-- Add to <head> for third-party domains -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://www.google-analytics.com">

<!-- Preload critical resources -->
<link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/css/critical.css" as="style">`,
                    language: 'html',
                    instructions: 'Add these to your <head> section, adjusting URLs for your actual resources.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('inline css')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Externalize Large CSS',
                    description: 'Move large inline styles to external files.',
                    instructions: 'Extract large <style> blocks to external CSS files that can be cached.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process security issues
     */
    async function processSecurityIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('not using https')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Enable HTTPS',
                    description: 'Your site needs an SSL certificate.',
                    instructions: 'Install an SSL certificate (many hosts offer free Let\'s Encrypt certificates) and configure your server to redirect HTTP to HTTPS.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('mixed content') || title.includes('http links')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Mixed Content',
                    description: 'Update HTTP links to HTTPS.',
                    instructions: 'Change all internal links from http:// to https:// or use protocol-relative URLs.',
                    recommendation: issue.recommendation
                });
                FixerState.manual++;
            }
            else if (title.includes('noopener')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add rel="noopener"',
                    description: 'Add security attribute to external links.',
                    code: `<a href="https://external-site.com" target="_blank" rel="noopener noreferrer">External Link</a>`,
                    language: 'html',
                    instructions: 'Add rel="noopener noreferrer" to all external links that open in new tabs.'
                });
                FixerState.fixed++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Process mobile issues
     */
    async function processMobileIssues(issues, baseUrl) {
        for (const issue of issues) {
            const title = issue.title.toLowerCase();

            if (title.includes('viewport')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Add Viewport Meta Tag',
                    description: 'Add responsive viewport configuration.',
                    code: `<meta name="viewport" content="width=device-width, initial-scale=1">`,
                    language: 'html',
                    instructions: 'Add this meta tag to the <head> section of all pages.'
                });
                FixerState.fixed++;
            }
            else if (title.includes('fixed-width')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.MANUAL,
                    title: 'Fix Fixed-Width Elements',
                    description: 'Replace fixed widths with responsive units.',
                    instructions: 'Change fixed pixel widths to percentages, max-width, or viewport units.',
                    recommendation: issue.recommendation,
                    code: `/* Instead of fixed widths */
.element {
  width: 100%;
  max-width: 600px;
}

/* Or use viewport units */
.element {
  width: 90vw;
  max-width: 600px;
}`
                });
                FixerState.manual++;
            }
            else if (title.includes('small text')) {
                addFix({
                    issue: issue,
                    type: FIX_TYPE.AUTO,
                    title: 'Increase Font Size',
                    description: 'Use larger font sizes for mobile readability.',
                    code: `/* Ensure readable text on mobile */
body {
  font-size: 16px; /* Minimum for mobile */
  line-height: 1.5;
}

/* For smaller text elements */
.small-text {
  font-size: 14px; /* Minimum */
}`,
                    language: 'css',
                    instructions: 'Update your CSS to use at least 16px for body text.'
                });
                FixerState.fixed++;
            }
            else {
                FixerState.pending--;
                FixerState.manual++;
            }

            await sleep(50);
        }
    }

    /**
     * Generate title tag
     */
    function generateTitleTag(url, siteName) {
        const path = new URL(url).pathname;
        let pageTitle = 'Home';

        if (path !== '/' && path !== '') {
            // Extract page name from URL
            const segments = path.split('/').filter(s => s);
            if (segments.length > 0) {
                pageTitle = segments[segments.length - 1]
                    .replace(/[-_]/g, ' ')
                    .replace(/\.\w+$/, '')
                    .replace(/\b\w/g, c => c.toUpperCase());
            }
        }

        return `<title>${pageTitle} | ${siteName}</title>`;
    }

    /**
     * Generate meta description
     */
    function generateMetaDescription(url, siteName) {
        const path = new URL(url).pathname;

        if (path === '/' || path === '') {
            return `<meta name="description" content="Welcome to ${siteName}. Discover our products and services designed to help you succeed. Learn more about what we offer today.">`;
        }

        const segments = path.split('/').filter(s => s);
        const pageName = segments[segments.length - 1]
            .replace(/[-_]/g, ' ')
            .replace(/\.\w+$/, '')
            .replace(/\b\w/g, c => c.toUpperCase());

        return `<meta name="description" content="Learn about ${pageName} at ${siteName}. Find detailed information, resources, and everything you need to know about ${pageName.toLowerCase()}.">`;
    }

    /**
     * Generate Open Graph tags
     */
    function generateOpenGraphTags(url, siteName) {
        const path = new URL(url).pathname;
        let pageTitle = siteName;

        if (path !== '/' && path !== '') {
            const segments = path.split('/').filter(s => s);
            if (segments.length > 0) {
                const pageName = segments[segments.length - 1]
                    .replace(/[-_]/g, ' ')
                    .replace(/\.\w+$/, '')
                    .replace(/\b\w/g, c => c.toUpperCase());
                pageTitle = `${pageName} | ${siteName}`;
            }
        }

        return `<!-- Open Graph / Facebook -->
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="Your page description here">
<meta property="og:image" content="${new URL(url).origin}/images/og-image.jpg">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${url}">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="Your page description here">
<meta name="twitter:image" content="${new URL(url).origin}/images/twitter-image.jpg">`;
    }

    /**
     * Generate sitemap
     */
    function generateSitemap(baseUrl) {
        const origin = new URL(baseUrl).origin;
        const lastAudit = JSON.parse(localStorage.getItem('seo-last-audit') || '{}');
        const crawledUrls = lastAudit.crawledUrls || [baseUrl];
        const today = new Date().toISOString().split('T')[0];

        let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

        crawledUrls.forEach(url => {
            sitemap += `  <url>
    <loc>${escapeXml(url)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${url === baseUrl ? '1.0' : '0.8'}</priority>
  </url>
`;
        });

        sitemap += `</urlset>`;
        return sitemap;
    }

    /**
     * Generate robots.txt
     */
    function generateRobotsTxt(baseUrl) {
        const origin = new URL(baseUrl).origin;
        return `# robots.txt for ${origin}
# Generated by SEO Agent

User-agent: *
Allow: /

# Sitemap location
Sitemap: ${origin}/sitemap.xml

# Disallow admin/private areas (adjust as needed)
Disallow: /admin/
Disallow: /private/
Disallow: /api/
`;
    }

    /**
     * Add a fix to the list
     */
    function addFix(fix) {
        FixerState.fixes.push(fix);
        FixerState.pending--;
        updateCounts();
    }

    /**
     * Update progress display
     */
    function updateProgress(percent, text) {
        FixerState.progress = percent;
        if (elements.progressBar) {
            elements.progressBar.style.width = percent + '%';
        }
        if (elements.statusText) {
            elements.statusText.textContent = text;
        }
    }

    /**
     * Update counts display
     */
    function updateCounts() {
        if (elements.fixedCount) elements.fixedCount.textContent = FixerState.fixed;
        if (elements.pendingCount) elements.pendingCount.textContent = Math.max(0, FixerState.pending);
        if (elements.manualCount) elements.manualCount.textContent = FixerState.manual;
    }

    /**
     * Display fix results
     */
    function displayFixResults() {
        if (!elements.fixResults) return;

        if (FixerState.fixes.length === 0) {
            elements.fixResults.innerHTML = `
                <div class="empty-state">
                    <p>No fixable issues found. All issues require manual review.</p>
                </div>
            `;
            return;
        }

        // Group fixes by type
        const autoFixes = FixerState.fixes.filter(f => f.type === FIX_TYPE.AUTO);
        const downloadFixes = FixerState.fixes.filter(f => f.type === FIX_TYPE.DOWNLOAD);
        const manualFixes = FixerState.fixes.filter(f => f.type === FIX_TYPE.MANUAL);

        let html = '';

        // Auto-fixable issues
        if (autoFixes.length > 0) {
            html += `
                <div class="fix-section">
                    <h4 class="fix-section-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:#10b981;">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        Code Fixes Ready (${autoFixes.length})
                    </h4>
                    ${autoFixes.map(fix => renderFix(fix)).join('')}
                </div>
            `;
        }

        // Downloadable files
        if (downloadFixes.length > 0) {
            html += `
                <div class="fix-section">
                    <h4 class="fix-section-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:#6366f1;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Generated Files (${downloadFixes.length})
                    </h4>
                    ${downloadFixes.map(fix => renderFix(fix)).join('')}
                </div>
            `;
        }

        // Manual review needed
        if (manualFixes.length > 0) {
            html += `
                <div class="fix-section">
                    <h4 class="fix-section-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:#f59e0b;">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        Manual Review Needed (${manualFixes.length})
                    </h4>
                    ${manualFixes.map(fix => renderFix(fix)).join('')}
                </div>
            `;
        }

        elements.fixResults.innerHTML = html;

        // Add event listeners
        elements.fixResults.querySelectorAll('.copy-code-btn').forEach(btn => {
            btn.addEventListener('click', () => copyCode(btn));
        });

        elements.fixResults.querySelectorAll('.download-file-btn').forEach(btn => {
            btn.addEventListener('click', () => downloadFile(btn.dataset.filename));
        });
    }

    /**
     * Render a single fix
     */
    function renderFix(fix) {
        const severityClass = fix.issue?.severity || 'medium';

        let actionHtml = '';
        if (fix.type === FIX_TYPE.AUTO && fix.code) {
            actionHtml = `
                <div class="fix-code-container">
                    <pre class="fix-code"><code>${escapeHtml(fix.code)}</code></pre>
                    <button class="btn btn-sm btn-ghost copy-code-btn" data-code="${escapeAttr(fix.code)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy
                    </button>
                </div>
            `;
        } else if (fix.type === FIX_TYPE.DOWNLOAD && fix.code) {
            actionHtml = `
                <div class="fix-code-container">
                    <pre class="fix-code"><code>${escapeHtml(fix.code.substring(0, 500))}${fix.code.length > 500 ? '...' : ''}</code></pre>
                    <button class="btn btn-sm btn-primary download-file-btn" data-filename="${fix.fileName}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download ${fix.fileName}
                    </button>
                </div>
            `;
        } else if (fix.type === FIX_TYPE.MANUAL && fix.code) {
            actionHtml = `
                <div class="fix-code-container">
                    <pre class="fix-code"><code>${escapeHtml(fix.code)}</code></pre>
                    <button class="btn btn-sm btn-ghost copy-code-btn" data-code="${escapeAttr(fix.code)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy
                    </button>
                </div>
            `;
        }

        return `
            <div class="fix-item ${fix.type}">
                <div class="fix-header">
                    <span class="severity-badge ${severityClass}">${capitalizeFirst(severityClass)}</span>
                    <h5 class="fix-title">${escapeHtml(fix.title)}</h5>
                </div>
                <p class="fix-description">${escapeHtml(fix.description)}</p>
                ${fix.instructions ? `<p class="fix-instructions"><strong>How to fix:</strong> ${escapeHtml(fix.instructions)}</p>` : ''}
                ${fix.issue?.url ? `<code class="fix-url">${escapeHtml(truncateUrl(fix.issue.url, 60))}</code>` : ''}
                ${actionHtml}
            </div>
        `;
    }

    /**
     * Copy code to clipboard
     */
    async function copyCode(btn) {
        const code = btn.dataset.code;
        try {
            await navigator.clipboard.writeText(code);
            const originalText = btn.innerHTML;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied!
            `;
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    }

    /**
     * Download a generated file
     */
    function downloadFile(fileName) {
        const content = FixerState.generatedFiles[fileName];
        if (!content) return;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Download all fixes as a zip (simplified - just downloads individual files)
     */
    function downloadAllFixes() {
        // Download each generated file
        Object.keys(FixerState.generatedFiles).forEach(fileName => {
            downloadFile(fileName);
        });

        // Generate a summary text file
        let summary = `SEO Fixes Summary\n`;
        summary += `Generated: ${new Date().toISOString()}\n\n`;
        summary += `Total Issues: ${FixerState.issues.length}\n`;
        summary += `Auto-Fixed: ${FixerState.fixed}\n`;
        summary += `Manual Review: ${FixerState.manual}\n\n`;
        summary += `---\n\n`;

        FixerState.fixes.forEach(fix => {
            summary += `[${fix.type.toUpperCase()}] ${fix.title}\n`;
            summary += `${fix.description}\n`;
            if (fix.instructions) {
                summary += `How to fix: ${fix.instructions}\n`;
            }
            if (fix.code && fix.type !== FIX_TYPE.DOWNLOAD) {
                summary += `Code:\n${fix.code}\n`;
            }
            summary += `\n---\n\n`;
        });

        const blob = new Blob([summary], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'seo-fixes-summary.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Get current project
     */
    function getCurrentProject() {
        const projectId = localStorage.getItem('seo-current-project');
        if (!projectId) return null;
        const projects = JSON.parse(localStorage.getItem('seo-projects') || '[]');
        return projects.find(p => p.id === projectId) || null;
    }

    /**
     * Helper: Sleep
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
     * Helper: Escape XML
     */
    function escapeXml(str) {
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&apos;');
    }

    /**
     * Helper: Escape attribute
     */
    function escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * Helper: Truncate URL
     */
    function truncateUrl(url, maxLength) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for external use
    window.SEOFixer = {
        open: openFixModal,
        start: startFixing,
        getState: () => FixerState
    };

})();
