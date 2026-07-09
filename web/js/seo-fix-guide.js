/**
 * SEO Fix Guide - Comprehensive Fix Instructions Database
 * Audema Marketing 2026
 *
 * Provides actionable, easy-to-understand fix instructions for every SEO issue.
 * Acts as a Senior SEO Analyst providing expert guidance.
 */

window.SEOFixGuide = (function() {
    'use strict';

    // Comprehensive fix instructions for all issues
    const fixInstructions = {

        // ═══════════════════════════════════════════════════════════════════════════
        // META & SEO ISSUES
        // ═══════════════════════════════════════════════════════════════════════════

        'Missing Meta Description': {
            severity: 'critical',
            impact: 'High - Directly affects click-through rates from search results',
            whatItMeans: 'Your page doesn\'t have a meta description tag, which is the snippet shown in search results below your title.',
            whyItMatters: 'Meta descriptions act as "ad copy" for your page in search results. Without one, Google will auto-generate text that may not be compelling or relevant.',
            canFixOnline: true,
            toolLink: '/tools/meta-tags.html',
            toolName: 'Meta Tag Generator',
            steps: [
                'Open your page\'s HTML file or CMS editor',
                'Find the <head> section of your page',
                'Add this tag: <meta name="description" content="Your description here">',
                'Write a compelling description (150-160 characters)',
                'Include your primary keyword naturally',
                'Add a call-to-action when appropriate'
            ],
            codeExample: '<meta name="description" content="Learn how to boost your website\'s SEO with our comprehensive guide. Get actionable tips and see results in 30 days. Free tools included.">',
            bestPractices: [
                'Keep it between 150-160 characters',
                'Make each page\'s description unique',
                'Include your target keyword',
                'Write for humans, not search engines',
                'Include a value proposition or CTA'
            ],
            commonMistakes: [
                'Duplicating the same description across pages',
                'Keyword stuffing',
                'Making it too short or too long',
                'Not including a call-to-action'
            ]
        },

        'Missing Page Title': {
            severity: 'critical',
            impact: 'Critical - Title tags are the #1 on-page SEO factor',
            whatItMeans: 'Your page doesn\'t have a <title> tag, which is shown as the clickable headline in search results.',
            whyItMatters: 'The title tag is the most important on-page SEO element. It tells search engines and users what your page is about.',
            canFixOnline: true,
            toolLink: '/tools/meta-tags.html',
            toolName: 'Meta Tag Generator',
            steps: [
                'Open your page\'s HTML file',
                'Find the <head> section',
                'Add: <title>Your Page Title | Brand Name</title>',
                'Include your primary keyword near the beginning',
                'Keep it under 60 characters'
            ],
            codeExample: '<title>Complete SEO Guide for Beginners | Audema Marketing</title>',
            bestPractices: [
                'Keep titles under 60 characters',
                'Put important keywords first',
                'Make each title unique',
                'Include your brand name',
                'Write for click-through, not just keywords'
            ],
            commonMistakes: [
                'Using the same title on all pages',
                'Making titles too long (gets truncated)',
                'Not including keywords',
                'Using vague titles like "Home" or "Welcome"'
            ]
        },

        'Duplicate Title Tags': {
            severity: 'warning',
            impact: 'Medium - Causes keyword cannibalization and confuses search engines',
            whatItMeans: 'Multiple pages on your site have the same title tag.',
            whyItMatters: 'Duplicate titles make it hard for search engines to understand which page to rank for a query, potentially hurting all pages\' rankings.',
            canFixOnline: false,
            steps: [
                'Export a list of all your page titles (use our Audit tool)',
                'Identify pages with duplicate titles',
                'Create unique titles for each page based on its content',
                'Focus each title on different keywords/topics',
                'Update titles in your CMS or HTML files'
            ],
            bestPractices: [
                'Use a spreadsheet to track all page titles',
                'Ensure each page targets different keywords',
                'Follow a consistent naming convention',
                'Include page-specific information'
            ],
            commonMistakes: [
                'Using template titles without customization',
                'Ignoring category and tag pages',
                'Not auditing titles regularly'
            ]
        },

        'Missing Canonical URL': {
            severity: 'notice',
            impact: 'Medium - Can cause duplicate content issues',
            whatItMeans: 'Your page doesn\'t specify a canonical URL, which tells search engines which version of a page is the "main" one.',
            whyItMatters: 'Without canonical tags, search engines might index multiple versions of the same content (with/without www, trailing slashes, URL parameters), diluting your SEO.',
            canFixOnline: true,
            toolLink: '/tools/meta-tags.html',
            toolName: 'Meta Tag Generator',
            steps: [
                'Identify the preferred URL for each page',
                'Add a canonical tag to your page\'s <head> section',
                'Use the full absolute URL',
                'Ensure it points to the correct version (https, www preference)'
            ],
            codeExample: '<link rel="canonical" href="https://www.example.com/page-url/">',
            bestPractices: [
                'Always use absolute URLs',
                'Be consistent with trailing slashes',
                'Match your canonical to your sitemap URLs',
                'Self-reference on unique pages'
            ],
            commonMistakes: [
                'Using relative URLs',
                'Pointing to non-existent pages',
                'Inconsistent URL formats',
                'Forgetting to update after URL changes'
            ]
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // PERFORMANCE ISSUES
        // ═══════════════════════════════════════════════════════════════════════════

        'Slow Page Load': {
            severity: 'critical',
            impact: 'Critical - Page speed is a direct ranking factor and affects user experience',
            whatItMeans: 'Your page takes too long to load. The Largest Contentful Paint (LCP) should be under 2.5 seconds.',
            whyItMatters: 'Google uses page speed as a ranking factor. Slow pages also have higher bounce rates and lower conversions.',
            canFixOnline: false,
            steps: [
                'Run a detailed performance audit using our Core Web Vitals tool',
                'Optimize and compress images (use WebP format)',
                'Enable browser caching',
                'Minify CSS, JavaScript, and HTML',
                'Use a Content Delivery Network (CDN)',
                'Reduce server response time',
                'Remove unused CSS and JavaScript'
            ],
            quickWins: [
                'Compress images - often the biggest improvement',
                'Enable GZIP compression on your server',
                'Remove unused plugins/scripts',
                'Lazy load images below the fold'
            ],
            advancedFixes: [
                'Implement critical CSS inlining',
                'Use HTTP/2 or HTTP/3',
                'Preload key resources',
                'Consider a faster hosting provider'
            ],
            toolLink: '/seo/vitals.html',
            toolName: 'Core Web Vitals'
        },

        'Layout Shift Issues': {
            severity: 'warning',
            impact: 'Medium - Affects user experience and is a Core Web Vital',
            whatItMeans: 'Elements on your page move around as it loads, causing a poor user experience.',
            whyItMatters: 'Cumulative Layout Shift (CLS) is a Core Web Vital. High CLS frustrates users and can hurt rankings.',
            canFixOnline: false,
            steps: [
                'Add explicit width and height to images and videos',
                'Reserve space for ads and embeds',
                'Avoid inserting content above existing content',
                'Use CSS transform for animations instead of properties that trigger layout',
                'Preload fonts to prevent font swap shifts'
            ],
            codeExample: '<img src="image.jpg" width="800" height="600" alt="Description">\n\n/* For responsive images */\nimg {\n  aspect-ratio: 16/9;\n  width: 100%;\n  height: auto;\n}',
            bestPractices: [
                'Always specify image dimensions',
                'Use aspect-ratio CSS for responsive media',
                'Load web fonts with font-display: swap',
                'Reserve space for dynamic content'
            ],
            toolLink: '/seo/vitals.html',
            toolName: 'Core Web Vitals'
        },

        'Large Image Files': {
            severity: 'warning',
            impact: 'High - Images are often the largest page resources',
            whatItMeans: 'Your images are larger than necessary, slowing down page load.',
            whyItMatters: 'Unoptimized images can account for 50-80% of a page\'s total weight. Optimizing them is often the easiest performance win.',
            canFixOnline: false,
            steps: [
                'Convert images to WebP format (30% smaller than JPEG)',
                'Compress images using tools like TinyPNG or Squoosh',
                'Resize images to the actual display size',
                'Implement lazy loading for below-fold images',
                'Use responsive images with srcset'
            ],
            codeExample: '<!-- Responsive images with WebP -->\n<picture>\n  <source srcset="image.webp" type="image/webp">\n  <source srcset="image.jpg" type="image/jpeg">\n  <img src="image.jpg" alt="Description" loading="lazy" width="800" height="600">\n</picture>',
            recommendedTools: [
                'Squoosh.app - Free online compression',
                'TinyPNG - Batch compression',
                'ImageOptim - Mac desktop app',
                'ShortPixel - WordPress plugin'
            ],
            toolLink: '/seo/vitals.html',
            toolName: 'Core Web Vitals'
        },

        'Render Blocking Resources': {
            severity: 'warning',
            impact: 'Medium - Delays page rendering and first paint',
            whatItMeans: 'CSS and JavaScript files are blocking the browser from rendering your page quickly.',
            whyItMatters: 'Render-blocking resources delay when users see content, increasing bounce rates and hurting Core Web Vitals.',
            canFixOnline: false,
            steps: [
                'Identify render-blocking resources in PageSpeed Insights',
                'Inline critical CSS (above-the-fold styles)',
                'Defer non-critical CSS with media="print" onload trick',
                'Add async or defer to non-critical JavaScript',
                'Move JavaScript to the bottom of <body>'
            ],
            codeExample: '<!-- Defer non-critical CSS -->\n<link rel="preload" href="styles.css" as="style" onload="this.onload=null;this.rel=\'stylesheet\'">\n\n<!-- Defer JavaScript -->\n<script src="script.js" defer></script>\n\n<!-- Async JavaScript (for independent scripts) -->\n<script src="analytics.js" async></script>',
            bestPractices: [
                'Use defer for scripts that need DOM',
                'Use async for independent scripts (analytics)',
                'Inline critical CSS for above-fold content',
                'Remove unused CSS and JavaScript'
            ],
            toolLink: '/seo/vitals.html',
            toolName: 'Core Web Vitals'
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // SECURITY ISSUES
        // ═══════════════════════════════════════════════════════════════════════════

        'No SSL Certificate': {
            severity: 'critical',
            impact: 'Critical - HTTPS is a ranking factor and required for user trust',
            whatItMeans: 'Your site doesn\'t use HTTPS encryption, meaning data between users and your site isn\'t secure.',
            whyItMatters: 'Google has confirmed HTTPS as a ranking signal. Browsers also show "Not Secure" warnings for HTTP sites, scaring away visitors.',
            canFixOnline: false,
            steps: [
                'Get a free SSL certificate from Let\'s Encrypt',
                'Or purchase one from your hosting provider',
                'Install the certificate on your server',
                'Update your site to use HTTPS URLs',
                'Set up 301 redirects from HTTP to HTTPS',
                'Update internal links to HTTPS',
                'Update your sitemap and Google Search Console'
            ],
            hostingGuides: {
                'cPanel': 'Go to SSL/TLS → Install SSL → Select Let\'s Encrypt',
                'Cloudflare': 'Enable "Always Use HTTPS" in SSL/TLS settings',
                'WordPress': 'Use Really Simple SSL plugin for easy migration',
                'Shopify': 'SSL is automatic - just enable it in settings'
            },
            bestPractices: [
                'Use HSTS headers for added security',
                'Set up automatic certificate renewal',
                'Test your SSL configuration at ssllabs.com',
                'Ensure all resources load over HTTPS'
            ]
        },

        'HTTP Not Redirecting': {
            severity: 'warning',
            impact: 'Medium - Users and search engines might access insecure version',
            whatItMeans: 'When someone visits your HTTP URL, they\'re not automatically redirected to HTTPS.',
            whyItMatters: 'Without proper redirects, you might have duplicate content issues and some users will access the insecure version.',
            canFixOnline: false,
            steps: [
                'Add a 301 redirect in your server configuration',
                'For Apache, add to .htaccess file',
                'For Nginx, add to server configuration',
                'Test by visiting http://yoursite.com',
                'Verify redirect in browser developer tools'
            ],
            codeExample: '# Apache .htaccess\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]\n\n# Nginx\nserver {\n    listen 80;\n    server_name example.com;\n    return 301 https://$server_name$request_uri;\n}',
            toolLink: '/tools/htaccess.html',
            toolName: '.htaccess Generator'
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // CONTENT & ACCESSIBILITY ISSUES
        // ═══════════════════════════════════════════════════════════════════════════

        'Missing H1 Tag': {
            severity: 'warning',
            impact: 'Medium - H1 helps search engines understand page topic',
            whatItMeans: 'Your page doesn\'t have an H1 heading tag.',
            whyItMatters: 'The H1 tag is the main heading of your page. It helps search engines and screen readers understand your content\'s primary topic.',
            canFixOnline: false,
            steps: [
                'Identify the main topic of your page',
                'Add one H1 tag near the top of your content',
                'Include your primary keyword naturally',
                'Make it descriptive and compelling'
            ],
            codeExample: '<h1>Complete Guide to SEO for Small Businesses</h1>',
            bestPractices: [
                'Use only ONE H1 per page',
                'Place it near the top of the content',
                'Make it different from the title tag',
                'Include your target keyword'
            ],
            commonMistakes: [
                'Multiple H1 tags on one page',
                'Using H1 for logo or navigation',
                'Making H1 identical to title tag',
                'Hiding H1 with CSS'
            ]
        },

        'Heading Structure Issues': {
            severity: 'warning',
            impact: 'Medium - Proper hierarchy helps SEO and accessibility',
            whatItMeans: 'Your heading tags (H1-H6) don\'t follow a logical hierarchy.',
            whyItMatters: 'Screen readers use headings for navigation. Search engines use them to understand content structure. Skipping levels confuses both.',
            canFixOnline: false,
            steps: [
                'Audit your page\'s heading structure',
                'Ensure you have one H1',
                'Use H2 for main sections',
                'Use H3 for subsections under H2',
                'Don\'t skip levels (H1 → H3)',
                'Use headings for structure, not styling'
            ],
            codeExample: '<h1>Main Page Topic</h1>\n  <h2>First Major Section</h2>\n    <h3>Subsection</h3>\n    <h3>Another Subsection</h3>\n  <h2>Second Major Section</h2>\n    <h3>Subsection</h3>',
            bestPractices: [
                'Think of headings as an outline',
                'Don\'t use headings for visual styling',
                'Keep heading text concise',
                'Include keywords where natural'
            ]
        },

        'Images Without Alt Text': {
            severity: 'warning',
            impact: 'Medium - Affects accessibility and image SEO',
            whatItMeans: 'Some images on your page don\'t have alt text descriptions.',
            whyItMatters: 'Alt text helps visually impaired users understand images, and helps search engines index your images for Image Search.',
            canFixOnline: false,
            steps: [
                'Find all images without alt text',
                'Write descriptive alt text for each image',
                'Describe what\'s IN the image, not around it',
                'Include keywords only when relevant',
                'Leave alt="" empty for decorative images'
            ],
            codeExample: '<!-- Good alt text -->\n<img src="team-meeting.jpg" alt="Marketing team discussing Q4 strategy around conference table">\n\n<!-- Decorative image -->\n<img src="decorative-line.png" alt="">\n\n<!-- Bad: keyword stuffing -->\n<img src="shoes.jpg" alt="buy cheap shoes best shoes online shoes sale">',
            bestPractices: [
                'Be specific and descriptive',
                'Keep it under 125 characters',
                'Don\'t start with "Image of" or "Picture of"',
                'Include keywords naturally when relevant',
                'Use empty alt="" for decorative images'
            ]
        },

        'Low Text-to-HTML Ratio': {
            severity: 'notice',
            impact: 'Low-Medium - May indicate thin content',
            whatItMeans: 'Your page has more HTML code than actual text content.',
            whyItMatters: 'A low text ratio might indicate thin content that provides little value to users. Search engines prefer content-rich pages.',
            canFixOnline: false,
            steps: [
                'Add more valuable text content to the page',
                'Reduce unnecessary HTML markup',
                'Remove inline CSS and JavaScript',
                'Consolidate external CSS and JS files',
                'Remove comments and whitespace from production code'
            ],
            bestPractices: [
                'Aim for at least 500 words on important pages',
                'Focus on quality over quantity',
                'Remove unnecessary div wrappers',
                'Externalize CSS and JavaScript'
            ]
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // MOBILE ISSUES
        // ═══════════════════════════════════════════════════════════════════════════

        'Missing Viewport Meta': {
            severity: 'warning',
            impact: 'High - Critical for mobile usability',
            whatItMeans: 'Your page doesn\'t have a viewport meta tag, which controls how the page displays on mobile devices.',
            whyItMatters: 'Without a viewport tag, mobile browsers will render your page at desktop width, making it tiny and unusable on phones.',
            canFixOnline: true,
            toolLink: '/tools/meta-tags.html',
            toolName: 'Meta Tag Generator',
            steps: [
                'Add the viewport meta tag to your page\'s <head>',
                'This is a one-line fix that immediately improves mobile display'
            ],
            codeExample: '<meta name="viewport" content="width=device-width, initial-scale=1">',
            bestPractices: [
                'Include on every page',
                'Don\'t disable zoom (user-scalable=no)',
                'Don\'t set maximum-scale=1',
                'Use responsive CSS alongside'
            ]
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // TECHNICAL SEO ISSUES
        // ═══════════════════════════════════════════════════════════════════════════

        'No Sitemap Found': {
            severity: 'notice',
            impact: 'Medium - Helps search engines discover your pages',
            whatItMeans: 'Your site doesn\'t have an XML sitemap at the standard location (/sitemap.xml).',
            whyItMatters: 'Sitemaps help search engines discover and index all your pages, especially new or deeply nested ones.',
            canFixOnline: true,
            toolLink: '/seo/indexing.html',
            toolName: 'Indexing & Sitemap Tools',
            steps: [
                'Generate an XML sitemap for your site',
                'Include all important pages',
                'Upload to your site\'s root directory',
                'Submit to Google Search Console',
                'Add sitemap location to robots.txt'
            ],
            codeExample: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://www.example.com/</loc>\n    <lastmod>2024-01-15</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>',
            bestPractices: [
                'Update sitemap when adding new pages',
                'Include only canonical URLs',
                'Keep under 50,000 URLs per sitemap',
                'Use sitemap index for large sites'
            ]
        },

        'Missing Robots.txt': {
            severity: 'notice',
            impact: 'Low-Medium - Controls search engine crawling',
            whatItMeans: 'Your site doesn\'t have a robots.txt file at the root.',
            whyItMatters: 'Robots.txt tells search engines which pages to crawl or ignore. Without one, you have no control over crawler behavior.',
            canFixOnline: true,
            toolLink: '/tools/robots.html',
            toolName: 'Robots.txt Generator',
            steps: [
                'Create a robots.txt file',
                'Define rules for search engine bots',
                'Include your sitemap location',
                'Upload to your site\'s root directory',
                'Test with Google\'s robots.txt tester'
            ],
            codeExample: '# robots.txt for example.com\nUser-agent: *\nAllow: /\n\n# Block admin areas\nDisallow: /admin/\nDisallow: /private/\n\n# Sitemap location\nSitemap: https://www.example.com/sitemap.xml',
            bestPractices: [
                'Don\'t block CSS and JavaScript',
                'Include sitemap reference',
                'Test before deploying',
                'Use specific user-agent rules when needed'
            ]
        },

        'No Schema Markup': {
            severity: 'notice',
            impact: 'Medium - Enables rich results in search',
            whatItMeans: 'Your page doesn\'t have structured data (schema.org markup).',
            whyItMatters: 'Schema markup helps search engines understand your content and can enable rich results (stars, prices, FAQs) in search results.',
            canFixOnline: true,
            toolLink: '/tools/schema.html',
            toolName: 'Schema Markup Generator',
            steps: [
                'Identify what type of content you have',
                'Choose the appropriate schema type',
                'Generate the JSON-LD markup',
                'Add it to your page\'s <head> or <body>',
                'Test with Google\'s Rich Results Test'
            ],
            schemaTypes: [
                'Article - Blog posts and news',
                'Product - E-commerce products',
                'LocalBusiness - Physical locations',
                'FAQ - Frequently asked questions',
                'HowTo - Step-by-step guides',
                'Recipe - Cooking recipes',
                'Event - Events and conferences'
            ],
            codeExample: '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "Your Article Title",\n  "author": {\n    "@type": "Person",\n    "name": "Author Name"\n  },\n  "datePublished": "2024-01-15",\n  "image": "https://example.com/image.jpg"\n}\n</script>',
            bestPractices: [
                'Use JSON-LD format (Google recommended)',
                'Don\'t markup hidden content',
                'Keep data accurate and up-to-date',
                'Test with Google\'s testing tools'
            ]
        },

        'Uncrawlable Links': {
            severity: 'warning',
            impact: 'Medium - Search engines may not discover linked pages',
            whatItMeans: 'Some links on your page use JavaScript or other methods that search engines can\'t follow.',
            whyItMatters: 'If search engines can\'t follow your links, they won\'t discover and index those pages.',
            canFixOnline: false,
            steps: [
                'Identify links using onclick handlers or JavaScript',
                'Replace with standard <a href> tags',
                'Ensure hrefs contain actual URLs',
                'Avoid using javascript: in href attributes',
                'Test with "View Page Source" (not inspect element)'
            ],
            codeExample: '<!-- Bad: JavaScript-only link -->\n<a onclick="goToPage(\'products\')">Products</a>\n<a href="javascript:void(0)" onclick="navigate()">Link</a>\n\n<!-- Good: Standard crawlable link -->\n<a href="/products">Products</a>\n<a href="/page" onclick="trackClick()">Link</a>',
            bestPractices: [
                'Always use real href attributes',
                'JavaScript can enhance, not replace links',
                'Use progressive enhancement',
                'Test with JavaScript disabled'
            ]
        }
    };

    /**
     * Get fix instructions for an issue
     */
    function getFixInstructions(issueName) {
        return fixInstructions[issueName] || null;
    }

    /**
     * Get all available issues
     */
    function getAllIssues() {
        return Object.keys(fixInstructions);
    }

    /**
     * Check if issue can be fixed online
     */
    function canFixOnline(issueName) {
        const instructions = fixInstructions[issueName];
        return instructions ? instructions.canFixOnline === true : false;
    }

    /**
     * Get tool link for an issue
     */
    function getToolLink(issueName) {
        const instructions = fixInstructions[issueName];
        return instructions ? { url: instructions.toolLink, name: instructions.toolName } : null;
    }

    /**
     * Generate HTML for fix instructions modal/panel
     */
    function generateFixHTML(issueName) {
        const fix = fixInstructions[issueName];
        if (!fix) {
            return '<p>No fix instructions available for this issue.</p>';
        }

        let html = `
            <div class="fix-guide">
                <div class="fix-header">
                    <span class="fix-severity ${fix.severity}">${fix.severity.toUpperCase()}</span>
                    <span class="fix-impact">${fix.impact}</span>
                </div>

                <div class="fix-section">
                    <h4>What This Means</h4>
                    <p>${fix.whatItMeans}</p>
                </div>

                <div class="fix-section">
                    <h4>Why It Matters</h4>
                    <p>${fix.whyItMatters}</p>
                </div>

                <div class="fix-section">
                    <h4>How to Fix It</h4>
                    <ol class="fix-steps">
                        ${fix.steps.map(step => `<li>${step}</li>`).join('')}
                    </ol>
                </div>
        `;

        if (fix.codeExample) {
            html += `
                <div class="fix-section">
                    <h4>Code Example</h4>
                    <pre class="fix-code"><code>${escapeHtml(fix.codeExample)}</code></pre>
                    <button class="copy-code-btn" onclick="SEOFixGuide.copyCode(this)">Copy Code</button>
                </div>
            `;
        }

        if (fix.bestPractices) {
            html += `
                <div class="fix-section">
                    <h4>Best Practices</h4>
                    <ul class="fix-list">
                        ${fix.bestPractices.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        if (fix.commonMistakes) {
            html += `
                <div class="fix-section">
                    <h4>Common Mistakes to Avoid</h4>
                    <ul class="fix-list warning">
                        ${fix.commonMistakes.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        if (fix.canFixOnline && fix.toolLink) {
            html += `
                <div class="fix-section fix-cta">
                    <h4>Fix It Now</h4>
                    <p>Use our ${fix.toolName} to generate the fix automatically.</p>
                    <a href="${fix.toolLink}" class="fix-tool-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                        </svg>
                        Open ${fix.toolName}
                    </a>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    /**
     * Escape HTML for safe display
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Copy code to clipboard
     */
    function copyCode(button) {
        const code = button.previousElementSibling.textContent;
        navigator.clipboard.writeText(code).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        });
    }

    /**
     * Show fix modal
     */
    function showFixModal(issueName) {
        // Remove existing modal
        const existing = document.getElementById('seoFixModal');
        if (existing) existing.remove();

        const fix = fixInstructions[issueName];
        if (!fix) return;

        const modal = document.createElement('div');
        modal.id = 'seoFixModal';
        modal.className = 'seo-fix-modal';
        modal.innerHTML = `
            <div class="seo-fix-modal-backdrop"></div>
            <div class="seo-fix-modal-content">
                <div class="seo-fix-modal-header">
                    <h3>How to Fix: ${issueName}</h3>
                    <button class="seo-fix-modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="seo-fix-modal-body">
                    ${generateFixHTML(issueName)}
                </div>
            </div>
        `;

        // Add styles if not present
        if (!document.getElementById('seoFixModalStyles')) {
            const style = document.createElement('style');
            style.id = 'seoFixModalStyles';
            style.textContent = getSEOFixModalStyles();
            document.head.appendChild(style);
        }

        document.body.appendChild(modal);

        // Close handlers
        modal.querySelector('.seo-fix-modal-backdrop').addEventListener('click', () => modal.remove());
        modal.querySelector('.seo-fix-modal-close').addEventListener('click', () => modal.remove());
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handler);
            }
        });

        // Animate in
        requestAnimationFrame(() => modal.classList.add('active'));
    }

    /**
     * Get modal styles
     */
    function getSEOFixModalStyles() {
        return `
            .seo-fix-modal {
                position: fixed;
                inset: 0;
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            .seo-fix-modal.active {
                opacity: 1;
            }
            .seo-fix-modal-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            }
            .seo-fix-modal-content {
                position: relative;
                background: var(--color-bg-secondary, #1a1a25);
                border: 1px solid var(--color-border, rgba(255,255,255,0.1));
                border-radius: 16px;
                width: 90%;
                max-width: 700px;
                max-height: 85vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transform: translateY(20px);
                transition: transform 0.3s ease;
            }
            .seo-fix-modal.active .seo-fix-modal-content {
                transform: translateY(0);
            }
            .seo-fix-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 20px 24px;
                border-bottom: 1px solid var(--color-border, rgba(255,255,255,0.1));
            }
            .seo-fix-modal-header h3 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                color: var(--color-text-primary, #fff);
            }
            .seo-fix-modal-close {
                background: none;
                border: none;
                color: var(--color-text-secondary, #a1a1aa);
                font-size: 24px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
                transition: all 0.2s;
            }
            .seo-fix-modal-close:hover {
                background: var(--color-bg-tertiary, #252530);
                color: var(--color-text-primary, #fff);
            }
            .seo-fix-modal-body {
                padding: 24px;
                overflow-y: auto;
            }
            .fix-guide {
                color: var(--color-text-primary, #fff);
            }
            .fix-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 24px;
            }
            .fix-severity {
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
            }
            .fix-severity.critical {
                background: rgba(239, 68, 68, 0.15);
                color: #ef4444;
            }
            .fix-severity.warning {
                background: rgba(245, 158, 11, 0.15);
                color: #f59e0b;
            }
            .fix-severity.notice {
                background: rgba(59, 130, 246, 0.15);
                color: #3b82f6;
            }
            .fix-impact {
                font-size: 13px;
                color: var(--color-text-secondary, #a1a1aa);
            }
            .fix-section {
                margin-bottom: 24px;
            }
            .fix-section h4 {
                font-size: 14px;
                font-weight: 600;
                color: var(--color-primary-light, #818cf8);
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .fix-section p {
                color: var(--color-text-secondary, #a1a1aa);
                line-height: 1.6;
                margin: 0;
            }
            .fix-steps {
                margin: 0;
                padding-left: 20px;
                color: var(--color-text-secondary, #a1a1aa);
            }
            .fix-steps li {
                margin-bottom: 8px;
                line-height: 1.5;
            }
            .fix-list {
                margin: 0;
                padding-left: 20px;
                color: var(--color-text-secondary, #a1a1aa);
            }
            .fix-list li {
                margin-bottom: 6px;
            }
            .fix-list.warning li::marker {
                color: #f59e0b;
            }
            .fix-code {
                background: var(--color-bg-primary, #0a0a0f);
                border: 1px solid var(--color-border, rgba(255,255,255,0.1));
                border-radius: 8px;
                padding: 16px;
                overflow-x: auto;
                font-family: 'JetBrains Mono', monospace;
                font-size: 13px;
                color: #10b981;
                margin: 0 0 8px 0;
            }
            .copy-code-btn {
                background: var(--color-bg-tertiary, #252530);
                border: 1px solid var(--color-border, rgba(255,255,255,0.1));
                color: var(--color-text-secondary, #a1a1aa);
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .copy-code-btn:hover {
                background: var(--color-primary, #6366f1);
                color: white;
                border-color: var(--color-primary, #6366f1);
            }
            .copy-code-btn.copied {
                background: #10b981;
                border-color: #10b981;
                color: white;
            }
            .fix-cta {
                background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1));
                border: 1px solid rgba(99, 102, 241, 0.2);
                border-radius: 12px;
                padding: 20px;
            }
            .fix-tool-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 600;
                font-size: 14px;
                margin-top: 12px;
                transition: all 0.2s;
            }
            .fix-tool-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(99, 102, 241, 0.3);
            }
            .fix-tool-btn svg {
                width: 18px;
                height: 18px;
            }
        `;
    }

    // Public API
    return {
        getFixInstructions: getFixInstructions,
        getAllIssues: getAllIssues,
        canFixOnline: canFixOnline,
        getToolLink: getToolLink,
        generateFixHTML: generateFixHTML,
        showFixModal: showFixModal,
        copyCode: copyCode
    };

})();
