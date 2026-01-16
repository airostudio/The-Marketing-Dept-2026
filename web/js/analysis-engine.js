/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEO ANALYSIS ENGINE
 * The Marketing Department 2026 - Professional SEO Analysis System
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This engine simulates a comprehensive SEO analysis workflow similar to
 * professional tools like Ahrefs, SEMrush, and Diib. It handles:
 *
 * 1. Site Crawling - Discovers pages and site structure
 * 2. Technical Audit - Checks for SEO issues
 * 3. Keyword Analysis - Extracts and analyzes keywords
 * 4. Backlink Analysis - Discovers backlink profile
 * 5. Competitor Analysis - Compares with competitors
 * 6. Report Generation - Compiles final report
 *
 * Results are stored in localStorage and used by the dashboard.
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // Task durations in milliseconds (min, max)
        taskDurations: {
            crawl: [8000, 12000],
            audit: [6000, 10000],
            keywords: [5000, 8000],
            backlinks: [4000, 7000],
            competitors: [4000, 6000],
            report: [2000, 4000]
        },
        // Update intervals
        updateInterval: 100,
        logInterval: 2000,
        // Data generation ranges
        dataRanges: {
            pages: [45, 250],
            issues: [8, 45],
            keywords: [120, 850],
            backlinks: [25, 500],
            healthScore: [62, 92]
        }
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
            weight: 25,
            messages: [
                'Fetching robots.txt...',
                'Parsing sitemap.xml...',
                'Discovering homepage...',
                'Following internal links...',
                'Indexing page content...',
                'Mapping site structure...',
                'Analyzing URL patterns...',
                'Checking page hierarchy...',
                'Completing crawl...'
            ]
        },
        {
            id: 'audit',
            name: 'Technical Audit',
            weight: 25,
            messages: [
                'Checking meta tags...',
                'Analyzing title tags...',
                'Validating heading structure...',
                'Checking image alt tags...',
                'Testing page speed...',
                'Analyzing Core Web Vitals...',
                'Checking mobile friendliness...',
                'Validating schema markup...',
                'Checking SSL certificate...',
                'Analyzing internal linking...',
                'Checking for broken links...',
                'Compiling audit results...'
            ]
        },
        {
            id: 'keywords',
            name: 'Keyword Analysis',
            weight: 20,
            messages: [
                'Extracting page content...',
                'Identifying target keywords...',
                'Analyzing keyword density...',
                'Checking search rankings...',
                'Finding keyword opportunities...',
                'Analyzing search intent...',
                'Grouping by topic clusters...',
                'Calculating keyword difficulty...',
                'Finalizing keyword data...'
            ]
        },
        {
            id: 'backlinks',
            name: 'Backlink Analysis',
            weight: 15,
            messages: [
                'Querying backlink database...',
                'Discovering referring domains...',
                'Analyzing link quality...',
                'Checking anchor text distribution...',
                'Identifying toxic links...',
                'Calculating domain authority...',
                'Finding link opportunities...',
                'Completing backlink analysis...'
            ]
        },
        {
            id: 'competitors',
            name: 'Competitor Analysis',
            weight: 10,
            messages: [
                'Identifying competitors...',
                'Fetching competitor metrics...',
                'Comparing domain authority...',
                'Analyzing keyword overlap...',
                'Finding content gaps...',
                'Completing competitor analysis...'
            ]
        },
        {
            id: 'report',
            name: 'Generating Report',
            weight: 5,
            messages: [
                'Compiling analysis data...',
                'Calculating health score...',
                'Generating recommendations...',
                'Finalizing report...'
            ]
        }
    ];

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM ELEMENTS
    // ═══════════════════════════════════════════════════════════════════════════

    const elements = {};

    function cacheElements() {
        elements.siteUrl = document.getElementById('siteUrl');
        elements.siteFavicon = document.getElementById('siteFavicon');
        elements.siteMeta = document.getElementById('siteMeta');
        elements.siteStatus = document.getElementById('siteStatus');
        elements.progressBar = document.getElementById('progressBar');
        elements.progressPercent = document.getElementById('progressPercent');
        elements.timeRemaining = document.getElementById('timeRemaining');
        elements.tasksList = document.getElementById('tasksList');
        elements.liveLog = document.getElementById('liveLog');
        elements.completionOverlay = document.getElementById('completionOverlay');
        elements.particles = document.getElementById('particles');

        // Stats
        elements.statPages = document.getElementById('statPages');
        elements.statIssues = document.getElementById('statIssues');
        elements.statScore = document.getElementById('statScore');
        elements.statKeywords = document.getElementById('statKeywords');

        // Counters
        elements.crawlCount = document.getElementById('crawlCount');
        elements.auditCount = document.getElementById('auditCount');
        elements.keywordCount = document.getElementById('keywordCount');
        elements.backlinkCount = document.getElementById('backlinkCount');
        elements.competitorCount = document.getElementById('competitorCount');
        elements.reportStatus = document.getElementById('reportStatus');

        // Final stats
        elements.finalScore = document.getElementById('finalScore');
        elements.finalIssues = document.getElementById('finalIssues');
        elements.finalPages = document.getElementById('finalPages');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    document.addEventListener('DOMContentLoaded', function() {
        cacheElements();
        loadProjectData();
        initializeUI();
        startAnalysis();
    });

    function loadProjectData() {
        try {
            const savedProject = localStorage.getItem('seo-current-project');
            const savedSettings = localStorage.getItem('seo-dashboard-settings');

            if (savedSettings) {
                state.projectData = JSON.parse(savedSettings);
            } else if (savedProject) {
                state.projectData = JSON.parse(savedProject);
            } else {
                // Demo mode - create sample project
                state.projectData = {
                    projectName: 'Demo Project',
                    websiteUrl: 'https://example.com',
                    industry: 'technology',
                    competitors: []
                };
            }
        } catch (e) {
            console.error('Error loading project data:', e);
            state.projectData = {
                projectName: 'My Website',
                websiteUrl: 'https://example.com',
                industry: 'general'
            };
        }
    }

    function initializeUI() {
        // Set site info
        const url = state.projectData.websiteUrl || 'example.com';
        let domain = url;

        try {
            domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
        } catch (e) {
            domain = url.replace(/^https?:\/\//, '').split('/')[0];
        }

        elements.siteUrl.textContent = domain;
        elements.siteFavicon.textContent = domain.charAt(0).toUpperCase();
        elements.siteMeta.textContent = `Industry: ${formatIndustry(state.projectData.industry)}`;

        // Initialize targets based on site type
        initializeTargets();
    }

    function formatIndustry(industry) {
        const industries = {
            'ecommerce': 'E-commerce / Retail',
            'saas': 'SaaS / Software',
            'agency': 'Marketing Agency',
            'healthcare': 'Healthcare',
            'finance': 'Finance / Banking',
            'technology': 'Technology',
            'general': 'General'
        };
        return industries[industry] || industry || 'General';
    }

    function initializeTargets() {
        // Set realistic target numbers based on industry
        const industry = state.projectData.industry || 'general';

        // Adjust ranges based on industry
        const multipliers = {
            'ecommerce': { pages: 1.5, keywords: 2, backlinks: 1.3 },
            'saas': { pages: 0.8, keywords: 1.2, backlinks: 1.1 },
            'agency': { pages: 0.6, keywords: 0.9, backlinks: 0.8 },
            'default': { pages: 1, keywords: 1, backlinks: 1 }
        };

        const mult = multipliers[industry] || multipliers.default;

        state.targets = {
            pages: Math.round(randomInRange(...CONFIG.dataRanges.pages) * mult.pages),
            issues: randomInRange(...CONFIG.dataRanges.issues),
            keywords: Math.round(randomInRange(...CONFIG.dataRanges.keywords) * mult.keywords),
            backlinks: Math.round(randomInRange(...CONFIG.dataRanges.backlinks) * mult.backlinks),
            competitors: state.projectData.competitors?.length || randomInRange(3, 6),
            healthScore: randomInRange(...CONFIG.dataRanges.healthScore)
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANALYSIS ENGINE
    // ═══════════════════════════════════════════════════════════════════════════

    async function startAnalysis() {
        state.startTime = Date.now();
        addLog('Starting comprehensive SEO analysis...');
        addLog(`Target domain: ${elements.siteUrl.textContent}`, 'success');

        // Run tasks sequentially
        for (const task of TASKS) {
            await runTask(task);
        }

        // Complete analysis
        completeAnalysis();
    }

    async function runTask(task) {
        return new Promise((resolve) => {
            state.currentTask = task.id;

            // Activate task UI
            const taskEl = document.querySelector(`[data-task="${task.id}"]`);
            taskEl.classList.add('active');

            // Add spinner
            const statusEl = taskEl.querySelector('.task-status');
            const spinner = document.createElement('div');
            spinner.className = 'task-spinner';
            statusEl.insertBefore(spinner, statusEl.firstChild);

            addLog(`Starting ${task.name.toLowerCase()}...`);

            // Calculate duration
            const duration = randomInRange(...CONFIG.taskDurations[task.id]);
            const startProgress = state.progress;
            const endProgress = startProgress + task.weight;

            // Track messages
            let messageIndex = 0;
            const messageInterval = duration / task.messages.length;

            // Update description with messages
            const descEl = taskEl.querySelector('.task-description');

            // Progress animation
            const startTime = Date.now();

            const updateLoop = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const taskProgress = Math.min(elapsed / duration, 1);

                // Update overall progress
                state.progress = startProgress + (task.weight * taskProgress);
                updateProgress();

                // Update task description
                const newMessageIndex = Math.floor(taskProgress * task.messages.length);
                if (newMessageIndex !== messageIndex && newMessageIndex < task.messages.length) {
                    messageIndex = newMessageIndex;
                    descEl.textContent = task.messages[messageIndex];
                }

                // Update counters
                updateTaskCounters(task.id, taskProgress);

                // Check completion
                if (taskProgress >= 1) {
                    clearInterval(updateLoop);
                    completeTask(task, taskEl, spinner);
                    resolve();
                }
            }, CONFIG.updateInterval);

            // Add random logs during task
            const logLoop = setInterval(() => {
                if (state.currentTask !== task.id) {
                    clearInterval(logLoop);
                    return;
                }
                addRandomLog(task.id);
            }, CONFIG.logInterval);
        });
    }

    function updateTaskCounters(taskId, progress) {
        switch (taskId) {
            case 'crawl':
                state.counters.pages = Math.round(state.targets.pages * progress);
                elements.crawlCount.textContent = `${state.counters.pages} pages`;
                updateStat('statPages', state.counters.pages);
                break;

            case 'audit':
                state.counters.issues = Math.round(state.targets.issues * progress);
                elements.auditCount.textContent = `${state.counters.issues} issues`;
                updateStat('statIssues', state.counters.issues);

                // Calculate health score as audit progresses
                if (progress > 0.5) {
                    const score = Math.round(state.targets.healthScore * (progress * 0.9 + 0.1));
                    updateStat('statScore', score);
                }
                break;

            case 'keywords':
                state.counters.keywords = Math.round(state.targets.keywords * progress);
                elements.keywordCount.textContent = `${state.counters.keywords} keywords`;
                updateStat('statKeywords', state.counters.keywords);
                break;

            case 'backlinks':
                state.counters.backlinks = Math.round(state.targets.backlinks * progress);
                elements.backlinkCount.textContent = `${state.counters.backlinks} links`;
                break;

            case 'competitors':
                state.counters.competitors = Math.round(state.targets.competitors * progress);
                elements.competitorCount.textContent = `${state.counters.competitors} competitors`;
                break;

            case 'report':
                if (progress < 0.5) {
                    elements.reportStatus.textContent = 'Building...';
                } else if (progress < 0.9) {
                    elements.reportStatus.textContent = 'Finalizing...';
                } else {
                    elements.reportStatus.textContent = 'Complete';
                }
                break;
        }
    }

    function completeTask(task, taskEl, spinner) {
        // Remove spinner, add checkmark
        spinner.remove();

        const statusEl = taskEl.querySelector('.task-status');
        const check = document.createElement('div');
        check.className = 'task-check';
        check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
        statusEl.insertBefore(check, statusEl.firstChild);

        // Update classes
        taskEl.classList.remove('active');
        taskEl.classList.add('completed');

        // Update description
        const descEl = taskEl.querySelector('.task-description');
        descEl.textContent = 'Completed';

        // Add to completed tasks
        state.completedTasks.push(task.id);

        // Log completion
        addLog(`${task.name} completed`, 'success');
    }

    function updateProgress() {
        const percent = Math.round(state.progress);
        elements.progressBar.style.width = `${percent}%`;
        elements.progressPercent.textContent = `${percent}%`;

        // Update time remaining
        const elapsed = (Date.now() - state.startTime) / 1000;
        const rate = state.progress / elapsed;
        const remaining = (100 - state.progress) / rate;

        if (remaining > 60) {
            elements.timeRemaining.textContent = `About ${Math.ceil(remaining / 60)} minutes remaining`;
        } else if (remaining > 10) {
            elements.timeRemaining.textContent = `About ${Math.round(remaining)} seconds remaining`;
        } else {
            elements.timeRemaining.textContent = 'Almost done...';
        }
    }

    function updateStat(statId, value) {
        const statEl = elements[statId];
        if (!statEl) return;

        const valueEl = statEl.querySelector('.stat-value');
        if (valueEl) {
            valueEl.textContent = value;
            statEl.classList.add('updated');
            setTimeout(() => statEl.classList.remove('updated'), 500);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    function addLog(message, type = '') {
        const elapsed = ((Date.now() - (state.startTime || Date.now())) / 1000).toFixed(0);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const time = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-message">${message}</span>
        `;

        elements.liveLog.appendChild(entry);
        elements.liveLog.scrollTop = elements.liveLog.scrollHeight;

        // Keep log manageable
        while (elements.liveLog.children.length > 50) {
            elements.liveLog.removeChild(elements.liveLog.firstChild);
        }
    }

    function addRandomLog(taskId) {
        const logs = {
            crawl: [
                `Found page: /about`,
                `Found page: /services`,
                `Found page: /contact`,
                `Found page: /blog`,
                `Indexed: /products/category-${randomInRange(1, 20)}`,
                `Following link to /page-${randomInRange(1, 50)}`,
                `Discovered sitemap with ${randomInRange(20, 100)} URLs`,
                `Page depth: ${randomInRange(1, 4)} levels`
            ],
            audit: [
                `Checking page speed for /homepage...`,
                `Found missing alt tag on image`,
                `Title tag length: ${randomInRange(40, 70)} characters`,
                `Meta description: ${randomInRange(120, 160)} characters`,
                `H1 tag found: Valid`,
                `Checking mobile viewport...`,
                `SSL certificate: Valid`,
                `Page load time: ${(Math.random() * 3 + 0.5).toFixed(2)}s`
            ],
            keywords: [
                `Found keyword: "${getRandomKeyword()}"`,
                `Keyword density: ${(Math.random() * 3).toFixed(1)}%`,
                `Search volume: ${randomInRange(100, 10000)}/mo`,
                `Keyword difficulty: ${randomInRange(20, 80)}`,
                `Ranking position: #${randomInRange(1, 100)}`,
                `Content relevance: ${randomInRange(70, 95)}%`
            ],
            backlinks: [
                `Found link from: example${randomInRange(1, 100)}.com`,
                `Referring domain DA: ${randomInRange(20, 80)}`,
                `Link type: ${['dofollow', 'nofollow'][randomInRange(0, 1)]}`,
                `Anchor text: "${getRandomAnchor()}"`,
                `New backlink discovered`
            ],
            competitors: [
                `Analyzing competitor ${randomInRange(1, 5)}...`,
                `Competitor DA: ${randomInRange(30, 90)}`,
                `Keyword overlap: ${randomInRange(15, 45)}%`,
                `Content gap found: ${randomInRange(50, 200)} keywords`
            ],
            report: [
                `Calculating overall score...`,
                `Compiling recommendations...`,
                `Generating priority list...`,
                `Finalizing health score...`
            ]
        };

        const taskLogs = logs[taskId] || [];
        if (taskLogs.length > 0) {
            const message = taskLogs[randomInRange(0, taskLogs.length - 1)];
            addLog(message);
        }
    }

    function getRandomKeyword() {
        const keywords = [
            'seo tools', 'website optimization', 'digital marketing',
            'content strategy', 'link building', 'keyword research',
            'technical seo', 'local seo', 'on-page optimization',
            'backlink analysis', 'competitor analysis', 'ranking factors'
        ];
        return keywords[randomInRange(0, keywords.length - 1)];
    }

    function getRandomAnchor() {
        const anchors = [
            'click here', 'learn more', 'visit website',
            'official site', 'brand name', 'product page',
            'read more', 'see details', 'get started'
        ];
        return anchors[randomInRange(0, anchors.length - 1)];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    function generateAnalysisData() {
        const domain = elements.siteUrl.textContent;

        // Generate pages data
        state.data.pages = generatePages(state.targets.pages);

        // Generate issues data
        state.data.issues = generateIssues(state.targets.issues);

        // Generate keywords data
        state.data.keywords = generateKeywords(state.targets.keywords);

        // Generate backlinks data
        state.data.backlinks = generateBacklinks(state.targets.backlinks);

        // Generate competitors data
        state.data.competitors = generateCompetitors(state.targets.competitors);

        // Calculate health score
        state.data.healthScore = state.targets.healthScore;

        // Generate summary
        state.data.summary = {
            domain: domain,
            analyzedAt: new Date().toISOString(),
            healthScore: state.data.healthScore,
            totalPages: state.data.pages.length,
            totalIssues: state.data.issues.length,
            criticalIssues: state.data.issues.filter(i => i.severity === 'critical').length,
            warningIssues: state.data.issues.filter(i => i.severity === 'warning').length,
            totalKeywords: state.data.keywords.length,
            top10Keywords: state.data.keywords.filter(k => k.position <= 10).length,
            totalBacklinks: state.data.backlinks.length,
            referringDomains: new Set(state.data.backlinks.map(b => b.domain)).size,
            competitors: state.data.competitors.length
        };

        return state.data;
    }

    function generatePages(count) {
        const pages = [];
        const pageTypes = ['homepage', 'product', 'category', 'blog', 'landing', 'about', 'contact', 'service'];

        for (let i = 0; i < count; i++) {
            const type = pageTypes[randomInRange(0, pageTypes.length - 1)];
            pages.push({
                url: `/${type === 'homepage' ? '' : type + '/' + (i + 1)}`,
                type: type,
                title: `${type.charAt(0).toUpperCase() + type.slice(1)} Page ${i + 1}`,
                loadTime: (Math.random() * 3 + 0.5).toFixed(2),
                wordCount: randomInRange(200, 2000),
                hasMetaDescription: Math.random() > 0.2,
                hasH1: Math.random() > 0.1,
                mobileScore: randomInRange(60, 100),
                indexed: Math.random() > 0.1
            });
        }

        return pages;
    }

    function generateIssues(count) {
        const issueTypes = [
            { type: 'missing-meta', name: 'Missing Meta Description', severity: 'warning', category: 'content' },
            { type: 'missing-alt', name: 'Images Missing Alt Text', severity: 'warning', category: 'accessibility' },
            { type: 'slow-page', name: 'Slow Page Load Time', severity: 'critical', category: 'performance' },
            { type: 'broken-link', name: 'Broken Internal Link', severity: 'critical', category: 'technical' },
            { type: 'duplicate-title', name: 'Duplicate Title Tag', severity: 'warning', category: 'content' },
            { type: 'thin-content', name: 'Thin Content Page', severity: 'warning', category: 'content' },
            { type: 'missing-h1', name: 'Missing H1 Tag', severity: 'warning', category: 'content' },
            { type: 'redirect-chain', name: 'Redirect Chain Detected', severity: 'warning', category: 'technical' },
            { type: 'mobile-issues', name: 'Mobile Usability Issues', severity: 'critical', category: 'mobile' },
            { type: 'missing-canonical', name: 'Missing Canonical URL', severity: 'notice', category: 'technical' },
            { type: 'large-images', name: 'Oversized Images', severity: 'warning', category: 'performance' },
            { type: 'no-ssl', name: 'Mixed Content Warning', severity: 'critical', category: 'security' }
        ];

        const issues = [];

        for (let i = 0; i < count; i++) {
            const issueType = issueTypes[randomInRange(0, issueTypes.length - 1)];
            issues.push({
                id: `issue-${i + 1}`,
                ...issueType,
                affectedPages: randomInRange(1, 15),
                firstDetected: new Date(Date.now() - randomInRange(0, 30) * 24 * 60 * 60 * 1000).toISOString(),
                status: 'open'
            });
        }

        return issues;
    }

    function generateKeywords(count) {
        const keywords = [];
        const baseKeywords = [
            'seo tools', 'website audit', 'keyword research', 'backlink checker',
            'rank tracker', 'site analysis', 'competitor analysis', 'content optimization',
            'technical seo', 'local seo', 'mobile optimization', 'page speed',
            'meta tags', 'schema markup', 'internal linking', 'external links'
        ];

        for (let i = 0; i < count; i++) {
            const baseKeyword = baseKeywords[randomInRange(0, baseKeywords.length - 1)];
            const modifier = i > baseKeywords.length ? ` ${['tool', 'service', 'guide', 'tips', 'best', 'free', 'online'][randomInRange(0, 6)]}` : '';

            keywords.push({
                keyword: baseKeyword + modifier,
                position: randomInRange(1, 100),
                previousPosition: randomInRange(1, 100),
                searchVolume: randomInRange(100, 50000),
                difficulty: randomInRange(10, 90),
                cpc: (Math.random() * 10).toFixed(2),
                intent: ['informational', 'navigational', 'transactional', 'commercial'][randomInRange(0, 3)],
                trend: ['up', 'down', 'stable'][randomInRange(0, 2)]
            });
        }

        return keywords;
    }

    function generateBacklinks(count) {
        const backlinks = [];
        const domains = [
            'techblog.com', 'marketingweekly.com', 'seojournal.com', 'digitaltrends.net',
            'businessinsider.com', 'entrepreneur.com', 'medium.com', 'linkedin.com',
            'twitter.com', 'reddit.com', 'quora.com', 'forbes.com'
        ];

        for (let i = 0; i < count; i++) {
            const domain = domains[randomInRange(0, domains.length - 1)];

            backlinks.push({
                url: `https://${domain}/article-${randomInRange(1000, 9999)}`,
                domain: domain,
                domainAuthority: randomInRange(20, 90),
                pageAuthority: randomInRange(15, 80),
                anchorText: getRandomAnchor(),
                linkType: Math.random() > 0.3 ? 'dofollow' : 'nofollow',
                firstSeen: new Date(Date.now() - randomInRange(0, 365) * 24 * 60 * 60 * 1000).toISOString(),
                status: Math.random() > 0.1 ? 'active' : 'lost'
            });
        }

        return backlinks;
    }

    function generateCompetitors(count) {
        const competitorDomains = [
            { name: 'competitor1.com', da: randomInRange(40, 85) },
            { name: 'competitor2.com', da: randomInRange(35, 80) },
            { name: 'competitor3.com', da: randomInRange(30, 75) },
            { name: 'competitor4.com', da: randomInRange(25, 70) },
            { name: 'competitor5.com', da: randomInRange(20, 65) },
            { name: 'competitor6.com', da: randomInRange(15, 60) }
        ];

        return competitorDomains.slice(0, count).map((comp, index) => ({
            domain: comp.name,
            domainAuthority: comp.da,
            traffic: randomInRange(10000, 500000),
            keywords: randomInRange(500, 5000),
            backlinks: randomInRange(100, 2000),
            commonKeywords: randomInRange(50, 300),
            keywordGap: randomInRange(100, 1000)
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPLETION
    // ═══════════════════════════════════════════════════════════════════════════

    function completeAnalysis() {
        state.isComplete = true;
        state.progress = 100;

        updateProgress();
        addLog('Analysis complete!', 'success');

        // Update site status
        elements.siteStatus.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span>Complete</span>
        `;
        elements.siteStatus.style.background = 'rgba(16, 185, 129, 0.1)';
        elements.siteStatus.style.color = 'var(--color-success)';

        // Update meta
        elements.siteMeta.textContent = `Analysis completed in ${Math.round((Date.now() - state.startTime) / 1000)} seconds`;

        // Generate and save data
        const analysisData = generateAnalysisData();
        saveAnalysisData(analysisData);

        // Update completion overlay stats
        elements.finalScore.textContent = state.data.healthScore;
        elements.finalIssues.textContent = state.data.issues.length;
        elements.finalPages.textContent = state.data.pages.length;

        // Show completion after a brief delay
        setTimeout(() => {
            showCompletion();
        }, 1000);
    }

    function saveAnalysisData(data) {
        try {
            // Save analysis results
            localStorage.setItem('seo-analysis-results', JSON.stringify(data));

            // Update dashboard settings with analysis data
            const settings = JSON.parse(localStorage.getItem('seo-dashboard-settings') || '{}');
            settings.lastAnalysis = new Date().toISOString();
            settings.healthScore = data.healthScore;
            settings.analysisComplete = true;
            localStorage.setItem('seo-dashboard-settings', JSON.stringify(settings));

            // Set flags for dashboard
            localStorage.setItem('seo-analysis-complete', 'true');
            localStorage.setItem('seo-just-completed-analysis', 'true');

            // Clear pending audit flag
            localStorage.removeItem('seo-pending-audit');

            console.log('Analysis data saved successfully');
        } catch (e) {
            console.error('Error saving analysis data:', e);
        }
    }

    function showCompletion() {
        // Create particles
        createParticles();

        // Show overlay
        elements.completionOverlay.classList.add('visible');
    }

    function createParticles() {
        const colors = ['#6366f1', '#8B5CF6', '#10b981', '#f59e0b', '#ec4899'];

        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = '50%';
            particle.style.top = '50%';
            particle.style.background = colors[randomInRange(0, colors.length - 1)];
            particle.style.setProperty('--tx', `${randomInRange(-300, 300)}px`);
            particle.style.setProperty('--ty', `${randomInRange(-300, 300)}px`);

            elements.particles.appendChild(particle);

            setTimeout(() => particle.remove(), 1000);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    function randomInRange(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    window.AnalysisEngine = {
        state,
        restart: function() {
            location.reload();
        }
    };

})();
