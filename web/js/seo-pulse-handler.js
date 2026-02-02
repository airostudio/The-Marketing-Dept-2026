/**
 * SEO Pulse Handler - Handles autofix navigation from SEO Pulse
 * The Marketing Department 2026
 *
 * When users click on issues in SEO Pulse, they're directed to the relevant
 * tool page with URL parameters. This handler processes those parameters
 * and triggers the appropriate actions.
 */

(function() {
    'use strict';

    var TAG = '[SEOPulseHandler]';

    // Action mappings for different tools
    var actionHandlers = {
        // Meta tags related actions
        'add-meta-description': function() {
            showIssueHighlight('Missing Meta Description', 'Add a unique, compelling meta description (150-160 characters) that summarizes the page content.');
            autoTriggerButton('runAudit');
        },
        'fix-duplicate-titles': function() {
            showIssueHighlight('Duplicate Title Tags', 'Each page should have a unique title tag. Review pages with duplicate titles below.');
            autoTriggerButton('runAudit');
        },
        'add-canonical': function() {
            showIssueHighlight('Missing Canonical URL', 'Add a canonical tag to prevent duplicate content issues.');
            autoTriggerButton('runAudit');
        },

        // Content related actions
        'add-h1': function() {
            showIssueHighlight('Missing H1 Tag', 'Add a single H1 heading that describes the main topic of your page.');
            autoTriggerButton('runAudit');
        },
        'improve-content': function() {
            showIssueHighlight('Low Text-to-HTML Ratio', 'Add more valuable text content to your page. Aim for at least 500 words of quality content.');
            autoTriggerButton('runAudit');
        },
        'add-alt-text': function() {
            showIssueHighlight('Images Without Alt Text', 'Add descriptive alt text to all images for better accessibility and SEO.');
            autoTriggerButton('runAudit');
        },

        // Performance related actions
        'optimize-speed': function() {
            showIssueHighlight('Slow Page Load', 'Run a Core Web Vitals test to identify specific performance bottlenecks.');
            autoTriggerButton('runCWVTest');
        },
        'compress-images': function() {
            showIssueHighlight('Large Image Files', 'Compress images to improve page load times. Use WebP format and lazy loading.');
            autoTriggerButton('runCWVTest');
        },

        // Security related actions
        'add-ssl': function() {
            showIssueHighlight('No SSL Certificate', 'Install an SSL certificate to enable HTTPS. Most hosting providers offer free SSL via Let\'s Encrypt.');
            autoTriggerButton('runAudit');
        },

        // Sitemap and indexing actions
        'generate-sitemap': function() {
            showIssueHighlight('No Sitemap Found', 'Create an XML sitemap and submit it to Google Search Console.');
            autoTriggerButton('runIndexCheck');
        },

        // Robots.txt actions
        'generate-robots': function() {
            showIssueHighlight('Missing Robots.txt', 'The tool below will help you generate a robots.txt file for your site.');
            // For robots tool, scroll to the generator
            scrollToGenerator();
        },

        // Schema markup actions
        'add-schema': function() {
            showIssueHighlight('No Schema Markup', 'Use the schema generator below to create structured data for your site.');
            scrollToGenerator();
        }
    };

    /**
     * Show issue highlight banner at the top of the page
     */
    function showIssueHighlight(issueName, recommendation) {
        var params = getUrlParams();
        var sourceUrl = params.url || 'your site';

        // Create the banner element
        var banner = document.createElement('div');
        banner.id = 'seoPulseIssueBanner';
        banner.className = 'seo-pulse-issue-banner';
        banner.innerHTML = [
            '<div class="seo-pulse-issue-content">',
            '  <div class="seo-pulse-issue-icon">',
            '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
            '      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
            '    </svg>',
            '  </div>',
            '  <div class="seo-pulse-issue-text">',
            '    <strong>SEO Pulse Issue: ' + escapeHtml(issueName) + '</strong>',
            '    <span>' + escapeHtml(recommendation) + '</span>',
            '  </div>',
            '</div>',
            '<button class="seo-pulse-issue-close" aria-label="Dismiss">&times;</button>'
        ].join('');

        // Add styles if not already present
        if (!document.getElementById('seoPulseStyles')) {
            var style = document.createElement('style');
            style.id = 'seoPulseStyles';
            style.textContent = [
                '.seo-pulse-issue-banner {',
                '  position: fixed;',
                '  top: 0;',
                '  left: 0;',
                '  right: 0;',
                '  z-index: 10000;',
                '  background: linear-gradient(135deg, #6366f1 0%, #8B5CF6 100%);',
                '  color: white;',
                '  padding: 12px 20px;',
                '  display: flex;',
                '  align-items: center;',
                '  justify-content: space-between;',
                '  gap: 16px;',
                '  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.3);',
                '  animation: slideDown 0.3s ease;',
                '}',
                '@keyframes slideDown {',
                '  from { transform: translateY(-100%); }',
                '  to { transform: translateY(0); }',
                '}',
                '.seo-pulse-issue-content {',
                '  display: flex;',
                '  align-items: center;',
                '  gap: 12px;',
                '  flex: 1;',
                '}',
                '.seo-pulse-issue-icon {',
                '  width: 32px;',
                '  height: 32px;',
                '  background: rgba(255,255,255,0.2);',
                '  border-radius: 8px;',
                '  display: flex;',
                '  align-items: center;',
                '  justify-content: center;',
                '  flex-shrink: 0;',
                '}',
                '.seo-pulse-issue-icon svg {',
                '  width: 18px;',
                '  height: 18px;',
                '}',
                '.seo-pulse-issue-text {',
                '  display: flex;',
                '  flex-direction: column;',
                '  gap: 2px;',
                '}',
                '.seo-pulse-issue-text strong {',
                '  font-size: 14px;',
                '  font-weight: 600;',
                '}',
                '.seo-pulse-issue-text span {',
                '  font-size: 13px;',
                '  opacity: 0.9;',
                '}',
                '.seo-pulse-issue-close {',
                '  background: rgba(255,255,255,0.2);',
                '  border: none;',
                '  color: white;',
                '  width: 28px;',
                '  height: 28px;',
                '  border-radius: 6px;',
                '  font-size: 18px;',
                '  cursor: pointer;',
                '  display: flex;',
                '  align-items: center;',
                '  justify-content: center;',
                '  transition: background 0.2s;',
                '}',
                '.seo-pulse-issue-close:hover {',
                '  background: rgba(255,255,255,0.3);',
                '}',
                '.dashboard-layout { padding-top: 56px; }',
                '.seo-pulse-issue-banner + * .dashboard-layout { padding-top: 56px; }'
            ].join('\n');
            document.head.appendChild(style);
        }

        // Insert banner at the start of body
        document.body.insertBefore(banner, document.body.firstChild);

        // Handle close button
        banner.querySelector('.seo-pulse-issue-close').addEventListener('click', function() {
            banner.style.animation = 'slideUp 0.3s ease forwards';
            banner.style.animationName = 'slideUp';
            setTimeout(function() {
                banner.remove();
                // Reset body padding
                var layout = document.querySelector('.dashboard-layout');
                if (layout) layout.style.paddingTop = '';
            }, 300);
        });

        // Add slideUp animation
        var slideUpStyle = document.createElement('style');
        slideUpStyle.textContent = '@keyframes slideUp { to { transform: translateY(-100%); } }';
        document.head.appendChild(slideUpStyle);

        console.log(TAG, 'Showing issue banner for:', issueName);
    }

    /**
     * Auto-trigger a button by ID
     */
    function autoTriggerButton(buttonId) {
        // Wait for DOM to be ready and any other scripts to initialize
        setTimeout(function() {
            var button = document.getElementById(buttonId);
            if (button) {
                console.log(TAG, 'Auto-triggering button:', buttonId);
                // Scroll the button into view
                button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Highlight the button briefly
                button.style.transition = 'box-shadow 0.3s';
                button.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.5)';
                setTimeout(function() {
                    button.style.boxShadow = '';
                }, 2000);
                // Click the button after a brief delay
                setTimeout(function() {
                    button.click();
                }, 500);
            } else {
                console.warn(TAG, 'Button not found:', buttonId);
            }
        }, 500);
    }

    /**
     * Scroll to generator section
     */
    function scrollToGenerator() {
        setTimeout(function() {
            // Try to find common generator elements
            var generator = document.querySelector('.generator-form, #generator, .tool-generator, form');
            if (generator) {
                generator.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 500);
    }

    /**
     * Get URL parameters
     */
    function getUrlParams() {
        var params = {};
        var search = window.location.search.substring(1);
        if (!search) return params;

        var pairs = search.split('&');
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            params[decodeURIComponent(pair[0])] = pair[1] ? decodeURIComponent(pair[1]) : '';
        }
        return params;
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Initialize handler
     */
    function init() {
        var params = getUrlParams();

        // Check if this is an SEO Pulse referral
        if (params.source !== 'seo-pulse' || params.autofix !== 'true') {
            return;
        }

        console.log(TAG, 'SEO Pulse referral detected:', params);

        var action = params.action;
        if (action && actionHandlers[action]) {
            console.log(TAG, 'Executing action:', action);
            actionHandlers[action]();
        } else if (params.issue) {
            // Fallback: just show the issue highlight
            showIssueHighlight(params.issue, 'Use the tools on this page to address this issue.');
        }

        // Clean URL after processing (optional - keeps URL clean)
        if (window.history && window.history.replaceState) {
            var cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        }
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for debugging
    window.SEOPulseHandler = {
        showIssueHighlight: showIssueHighlight,
        autoTriggerButton: autoTriggerButton,
        getUrlParams: getUrlParams
    };

})();
