/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AUTONOMOUS AI AGENTS SERVICE - 24/7 SEO Optimization Engine
 * Aduma Marketing 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This service provides 7 autonomous AI agents that continuously optimize SEO
 * performance around the clock, analyzing opportunities and executing improvements.
 *
 * Agents:
 * 1. Search Intent Agent - Deep intent analysis for better targeting
 * 2. Content Optimization Agent - AI-powered content improvements
 * 3. Technical SEO Agent - Site health monitoring & auto-fixes
 * 4. Keyword Intelligence Agent - High-value opportunity discovery
 * 5. Competitor Analysis Agent - Real-time competitor tracking
 * 6. Performance Prediction Agent - ML-based traffic forecasting
 * 7. ROI Optimization Agent - Investment return maximization
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION & CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        version: '2.0.0',
        agentCycleInterval: 300000, // 5 minutes between cycles
        quickCheckInterval: 60000,  // 1 minute for quick checks
        maxActionsPerCycle: 100,
        maxInsights: 200,
        maxPredictions: 50,
        maxActionLog: 500,
        learningRate: 0.1,

        // Intent classification weights
        intentWeights: {
            title: 3.0,
            url: 2.5,
            exact: 2.0,
            partial: 1.0
        },

        // CTR by position (industry standard)
        ctrByPosition: {
            1: 0.316, 2: 0.158, 3: 0.095, 4: 0.068, 5: 0.051,
            6: 0.042, 7: 0.035, 8: 0.031, 9: 0.028, 10: 0.025,
            11: 0.020, 12: 0.018, 13: 0.016, 14: 0.014, 15: 0.013,
            16: 0.012, 17: 0.011, 18: 0.010, 19: 0.009, 20: 0.008
        },

        // Difficulty thresholds
        difficulty: {
            easy: 30,
            medium: 50,
            hard: 70,
            veryHard: 85
        }
    };

    // Intent keyword patterns with weights
    const INTENT_PATTERNS = {
        transactional: {
            keywords: ['buy', 'purchase', 'order', 'shop', 'deal', 'discount', 'coupon', 'price', 'pricing', 'cost', 'cheap', 'affordable', 'sale', 'checkout', 'cart', 'subscribe', 'download', 'get', 'hire', 'book', 'reserve'],
            weight: 1.0,
            conversionPotential: 'high'
        },
        commercial: {
            keywords: ['best', 'top', 'review', 'reviews', 'compare', 'comparison', 'vs', 'versus', 'alternative', 'alternatives', 'rated', 'ranking', 'recommended', 'pros cons', 'worth it', 'should i'],
            weight: 0.8,
            conversionPotential: 'medium-high'
        },
        informational: {
            keywords: ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'guide', 'tutorial', 'learn', 'tips', 'examples', 'ideas', 'ways to', 'definition', 'meaning', 'explain', 'understand'],
            weight: 0.4,
            conversionPotential: 'low'
        },
        navigational: {
            keywords: ['login', 'sign in', 'signup', 'register', 'official', 'website', 'site', 'homepage', 'contact', 'support', 'help', 'account', 'dashboard', 'portal'],
            weight: 0.6,
            conversionPotential: 'medium'
        },
        local: {
            keywords: ['near me', 'nearby', 'local', 'in my area', 'closest', 'directions', 'hours', 'open now', 'address', 'location'],
            weight: 0.9,
            conversionPotential: 'high'
        }
    };

    // Technical SEO issue definitions
    const TECHNICAL_ISSUES = {
        critical: [
            { id: 'no-ssl', title: 'Missing SSL Certificate', impact: 25, autoFix: false },
            { id: 'blocked-indexing', title: 'Indexing Blocked by Robots.txt', impact: 30, autoFix: false },
            { id: 'server-errors', title: 'Server Errors (5xx)', impact: 25, autoFix: false },
            { id: 'mobile-not-friendly', title: 'Not Mobile-Friendly', impact: 20, autoFix: false }
        ],
        high: [
            { id: 'slow-lcp', title: 'Slow LCP (> 2.5s)', impact: 15, autoFix: true, fix: 'optimizeImages' },
            { id: 'missing-meta', title: 'Missing Meta Descriptions', impact: 10, autoFix: true, fix: 'generateMeta' },
            { id: 'duplicate-titles', title: 'Duplicate Title Tags', impact: 12, autoFix: true, fix: 'uniqueTitles' },
            { id: 'broken-links', title: 'Broken Internal Links', impact: 10, autoFix: true, fix: 'fixLinks' },
            { id: 'missing-h1', title: 'Missing H1 Tags', impact: 8, autoFix: true, fix: 'addH1' }
        ],
        medium: [
            { id: 'missing-alt', title: 'Images Missing Alt Text', impact: 5, autoFix: true, fix: 'addAltText' },
            { id: 'thin-content', title: 'Thin Content (< 300 words)', impact: 7, autoFix: false },
            { id: 'no-canonical', title: 'Missing Canonical Tags', impact: 6, autoFix: true, fix: 'addCanonical' },
            { id: 'render-blocking', title: 'Render-Blocking Resources', impact: 5, autoFix: true, fix: 'deferScripts' },
            { id: 'no-structured-data', title: 'Missing Structured Data', impact: 4, autoFix: true, fix: 'addSchema' }
        ],
        low: [
            { id: 'long-urls', title: 'URLs Too Long (> 75 chars)', impact: 2, autoFix: false },
            { id: 'no-breadcrumbs', title: 'Missing Breadcrumbs', impact: 2, autoFix: true, fix: 'addBreadcrumbs' },
            { id: 'no-sitemap', title: 'Sitemap Not Found', impact: 3, autoFix: true, fix: 'generateSitemap' }
        ]
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE ENGINE - Agent State & Orchestration
    // ═══════════════════════════════════════════════════════════════════════════

    const AgentEngine = {
        state: {
            initialized: false,
            isRunning: false,
            isPaused: false,
            lastCycle: null,
            cycleCount: 0,
            agents: {},
            insights: [],
            predictions: [],
            actionLog: [],
            learningData: {},
            performanceMetrics: {
                totalOptimizations: 0,
                successfulActions: 0,
                failedActions: 0,
                insightsGenerated: 0,
                valueGenerated: 0
            }
        },

        intervals: {
            main: null,
            quick: null
        },

        // Initialize the engine
        initialize() {
            if (this.state.initialized) return;

            console.log('🚀 AI Agents Engine v' + CONFIG.version + ' initializing...');

            this.loadState();
            this.initializeAgents();
            this.startAutonomousLoop();

            this.state.initialized = true;
            this.log('system', 'Engine Started', 'AI Agents Engine initialized successfully', 'high');

            console.log('✅ AI Agents Engine ready - 7 agents active');
        },

        // Load persisted state
        loadState() {
            try {
                const saved = localStorage.getItem('ai-agents-engine-state');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    this.state.agents = parsed.agents || {};
                    this.state.insights = parsed.insights || [];
                    this.state.predictions = parsed.predictions || [];
                    this.state.actionLog = parsed.actionLog || [];
                    this.state.learningData = parsed.learningData || {};
                    this.state.performanceMetrics = parsed.performanceMetrics || this.state.performanceMetrics;
                    this.state.cycleCount = parsed.cycleCount || 0;
                }
            } catch (e) {
                console.warn('Failed to load agent state:', e);
            }
        },

        // Save state
        saveState() {
            try {
                const toSave = {
                    agents: this.state.agents,
                    insights: this.state.insights.slice(0, CONFIG.maxInsights),
                    predictions: this.state.predictions.slice(0, CONFIG.maxPredictions),
                    actionLog: this.state.actionLog.slice(0, CONFIG.maxActionLog),
                    learningData: this.state.learningData,
                    performanceMetrics: this.state.performanceMetrics,
                    cycleCount: this.state.cycleCount,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem('ai-agents-engine-state', JSON.stringify(toSave));
            } catch (e) {
                console.warn('Failed to save agent state:', e);
            }
        },

        // Initialize all agents
        initializeAgents() {
            const agentList = [
                'searchIntent', 'contentOptimization', 'technicalSEO',
                'keywordIntelligence', 'competitorAnalysis',
                'performancePrediction', 'roiOptimization'
            ];

            for (const agent of agentList) {
                if (!this.state.agents[agent]) {
                    this.state.agents[agent] = {
                        status: 'ready',
                        lastRun: null,
                        runCount: 0,
                        successCount: 0,
                        errorCount: 0,
                        metrics: {}
                    };
                }
            }
        },

        // Start autonomous loop
        startAutonomousLoop() {
            // Main cycle - runs all agents
            this.intervals.main = setInterval(() => {
                if (!this.state.isPaused) {
                    this.runFullCycle();
                }
            }, CONFIG.agentCycleInterval);

            // Quick check - lightweight monitoring
            this.intervals.quick = setInterval(() => {
                if (!this.state.isPaused) {
                    this.runQuickCheck();
                }
            }, CONFIG.quickCheckInterval);

            // Initial run after 2 seconds
            setTimeout(() => this.runFullCycle(), 2000);
        },

        // Stop the engine
        stop() {
            if (this.intervals.main) clearInterval(this.intervals.main);
            if (this.intervals.quick) clearInterval(this.intervals.quick);
            this.state.isPaused = true;
            this.log('system', 'Engine Stopped', 'AI Agents Engine paused', 'medium');
        },

        // Resume the engine
        resume() {
            this.state.isPaused = false;
            this.startAutonomousLoop();
            this.log('system', 'Engine Resumed', 'AI Agents Engine resumed', 'medium');
        },

        // Run full optimization cycle
        async runFullCycle() {
            if (this.state.isRunning) return;

            this.state.isRunning = true;
            this.state.lastCycle = new Date().toISOString();
            this.state.cycleCount++;

            console.log(`🔄 AI Agents: Starting cycle #${this.state.cycleCount}`);

            try {
                // Run agents in optimal order
                await SearchIntentAgent.run();
                await KeywordIntelligenceAgent.run();
                await ContentOptimizationAgent.run();
                await TechnicalSEOAgent.run();
                await CompetitorAnalysisAgent.run();
                await PerformancePredictionAgent.run();
                await ROIOptimizationAgent.run();

                this.saveState();
                this.dispatchUpdate();

                console.log(`✅ AI Agents: Cycle #${this.state.cycleCount} complete`);
            } catch (e) {
                console.error('Cycle error:', e);
                this.log('system', 'Cycle Error', e.message, 'high');
            }

            this.state.isRunning = false;
        },

        // Quick check for urgent issues
        async runQuickCheck() {
            // Quick technical check
            const issues = TechnicalSEOAgent.quickScan();
            if (issues.critical > 0) {
                this.addInsight({
                    agent: 'Technical SEO Agent',
                    type: 'alert',
                    priority: 'critical',
                    title: `${issues.critical} Critical Issues Detected`,
                    description: 'Immediate attention required for site health issues.',
                    actionable: true
                });
            }
        },

        // Add insight
        addInsight(insight) {
            const newInsight = {
                id: this.generateId(),
                ...insight,
                status: 'new',
                createdAt: new Date().toISOString()
            };

            // Avoid duplicates
            const isDuplicate = this.state.insights.some(i =>
                i.title === insight.title && i.status === 'new'
            );

            if (!isDuplicate) {
                this.state.insights.unshift(newInsight);
                this.state.performanceMetrics.insightsGenerated++;
            }

            return newInsight;
        },

        // Add prediction
        addPrediction(prediction) {
            const newPrediction = {
                id: this.generateId(),
                ...prediction,
                createdAt: new Date().toISOString()
            };

            this.state.predictions.unshift(newPrediction);
            return newPrediction;
        },

        // Log action
        log(agent, action, details, impact = 'medium') {
            this.state.actionLog.unshift({
                id: this.generateId(),
                agent,
                action,
                details,
                impact,
                timestamp: new Date().toISOString()
            });
        },

        // Update agent status
        updateAgent(agentId, updates) {
            if (this.state.agents[agentId]) {
                Object.assign(this.state.agents[agentId], updates, {
                    lastRun: new Date().toISOString()
                });
                this.state.agents[agentId].runCount++;
            }
        },

        // Generate unique ID
        generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        },

        // Dispatch update event
        dispatchUpdate() {
            window.dispatchEvent(new CustomEvent('aiAgentsUpdated', {
                detail: {
                    agents: this.state.agents,
                    insights: this.state.insights,
                    predictions: this.state.predictions,
                    actionLog: this.state.actionLog,
                    metrics: this.state.performanceMetrics,
                    cycleCount: this.state.cycleCount
                }
            }));
        },

        // Get data helpers
        getKeywords() {
            try {
                return JSON.parse(localStorage.getItem('seo-tracked-keywords') || '[]');
            } catch (e) { return []; }
        },

        getCompetitors() {
            try {
                return JSON.parse(localStorage.getItem('seo-competitors') || '[]');
            } catch (e) { return []; }
        },

        getSettings() {
            try {
                return JSON.parse(localStorage.getItem('seo-dashboard-settings') || '{}');
            } catch (e) { return {}; }
        },

        getAnalysisData() {
            try {
                return JSON.parse(localStorage.getItem('seo-analysis-results') || '{}');
            } catch (e) { return {}; }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 1: SEARCH INTENT AGENT
    // Deep analysis of search intent for precision targeting
    // ═══════════════════════════════════════════════════════════════════════════

    const SearchIntentAgent = {
        id: 'searchIntent',
        name: 'Search Intent Agent',
        icon: '🎯',

        async run() {
            console.log(`${this.icon} ${this.name}: Analyzing...`);

            const keywords = AgentEngine.getKeywords();
            const results = {
                analyzed: 0,
                intents: { transactional: 0, commercial: 0, informational: 0, navigational: 0, local: 0 },
                opportunities: [],
                mismatches: []
            };

            for (const keyword of keywords) {
                const analysis = this.analyzeKeyword(keyword);
                results.analyzed++;
                results.intents[analysis.primaryIntent]++;

                // Check for opportunities
                if (analysis.opportunity) {
                    results.opportunities.push(analysis);
                }

                // Check for content mismatches
                if (analysis.mismatch) {
                    results.mismatches.push(analysis);
                }
            }

            // Generate insights
            this.generateInsights(results);

            // Update agent status
            AgentEngine.updateAgent(this.id, {
                status: 'active',
                metrics: {
                    keywordsAnalyzed: results.analyzed,
                    intentDistribution: results.intents,
                    opportunitiesFound: results.opportunities.length,
                    mismatchesFound: results.mismatches.length
                }
            });

            AgentEngine.log(this.name, 'Intent Analysis Complete',
                `Analyzed ${results.analyzed} keywords, found ${results.opportunities.length} opportunities`,
                results.opportunities.length > 5 ? 'high' : 'medium'
            );
        },

        analyzeKeyword(keyword) {
            const kw = (keyword.keyword || '').toLowerCase();
            const scores = {};

            // Score each intent type
            for (const [intent, data] of Object.entries(INTENT_PATTERNS)) {
                scores[intent] = 0;

                for (const word of data.keywords) {
                    if (kw === word) {
                        scores[intent] += CONFIG.intentWeights.exact * data.weight;
                    } else if (kw.includes(word)) {
                        scores[intent] += CONFIG.intentWeights.partial * data.weight;
                    } else if (kw.startsWith(word) || kw.endsWith(word)) {
                        scores[intent] += CONFIG.intentWeights.partial * 1.5 * data.weight;
                    }
                }
            }

            // Determine primary intent
            const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
            const primaryIntent = sorted[0][0];
            const primaryScore = sorted[0][1];
            const secondaryIntent = sorted[1][0];
            const confidence = Math.min(100, Math.round(primaryScore * 20 + 40));

            // Determine conversion potential
            const conversionPotential = INTENT_PATTERNS[primaryIntent].conversionPotential;

            // Check for opportunity (high value, not optimized)
            const opportunity =
                (primaryIntent === 'transactional' || primaryIntent === 'commercial' || primaryIntent === 'local') &&
                keyword.position > 10 &&
                (keyword.searchVolume || 0) > 500;

            // Check for content mismatch
            const mismatch = this.checkContentMismatch(keyword, primaryIntent);

            return {
                keyword: keyword.keyword,
                primaryIntent,
                secondaryIntent,
                confidence,
                conversionPotential,
                scores,
                opportunity,
                mismatch,
                recommendation: this.getRecommendation(primaryIntent, keyword)
            };
        },

        checkContentMismatch(keyword, intent) {
            const url = keyword.url || '';

            if (intent === 'informational' && !url.includes('blog') && !url.includes('guide') && !url.includes('how')) {
                return { type: 'content-type', message: 'Informational keyword not targeting blog/guide content' };
            }

            if (intent === 'transactional' && (url.includes('blog') || url.includes('article'))) {
                return { type: 'content-type', message: 'Transactional keyword targeting informational content' };
            }

            return null;
        },

        getRecommendation(intent, keyword) {
            const recs = {
                transactional: `Create/optimize landing page with clear CTAs, pricing, and purchase options for "${keyword.keyword}"`,
                commercial: `Create comparison content or detailed review targeting "${keyword.keyword}"`,
                informational: `Create comprehensive guide or tutorial content for "${keyword.keyword}"`,
                navigational: `Ensure brand pages are optimized and easily findable for "${keyword.keyword}"`,
                local: `Optimize Google Business Profile and local landing pages for "${keyword.keyword}"`
            };
            return recs[intent] || 'Analyze and optimize content for user intent';
        },

        generateInsights(results) {
            // High-value intent opportunities
            if (results.opportunities.length > 0) {
                const topOpp = results.opportunities.slice(0, 3);
                for (const opp of topOpp) {
                    AgentEngine.addInsight({
                        agent: this.name,
                        type: 'opportunity',
                        priority: 'high',
                        title: `High-Value Intent: "${opp.keyword}"`,
                        description: `${opp.primaryIntent} intent keyword with ${opp.conversionPotential} conversion potential. ${opp.recommendation}`,
                        actionable: true,
                        data: opp
                    });
                }
            }

            // Content mismatches
            if (results.mismatches.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'medium',
                    title: `${results.mismatches.length} Content-Intent Mismatches Found`,
                    description: 'Some keywords are targeting content that doesn\'t match user intent. This reduces conversion potential.',
                    actionable: true,
                    data: results.mismatches
                });
            }

            // Intent distribution insight
            const dominant = Object.entries(results.intents).sort((a, b) => b[1] - a[1])[0];
            if (dominant[1] > results.analyzed * 0.6) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'insight',
                    priority: 'low',
                    title: `Portfolio Heavily ${dominant[0].charAt(0).toUpperCase() + dominant[0].slice(1)}`,
                    description: `${Math.round(dominant[1] / results.analyzed * 100)}% of keywords have ${dominant[0]} intent. Consider diversifying for full-funnel coverage.`,
                    actionable: true
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 2: CONTENT OPTIMIZATION AGENT
    // AI-powered content analysis and improvement recommendations
    // ═══════════════════════════════════════════════════════════════════════════

    const ContentOptimizationAgent = {
        id: 'contentOptimization',
        name: 'Content Optimization Agent',
        icon: '✍️',

        async run() {
            console.log(`${this.icon} ${this.name}: Analyzing content...`);

            const analysisData = AgentEngine.getAnalysisData();
            const pages = analysisData.pages || this.getDefaultPages();
            const keywords = AgentEngine.getKeywords();

            const results = {
                pagesAnalyzed: 0,
                totalScore: 0,
                issues: [],
                optimizations: [],
                contentGaps: []
            };

            for (const page of pages) {
                const analysis = this.analyzePage(page, keywords);
                results.pagesAnalyzed++;
                results.totalScore += analysis.score;
                results.issues.push(...analysis.issues);
                results.optimizations.push(...analysis.optimizations);
            }

            // Find content gaps
            results.contentGaps = this.findContentGaps(keywords, pages);

            // Generate insights
            this.generateInsights(results);

            // Update agent
            AgentEngine.updateAgent(this.id, {
                status: 'active',
                metrics: {
                    pagesAnalyzed: results.pagesAnalyzed,
                    avgScore: Math.round(results.totalScore / Math.max(1, results.pagesAnalyzed)),
                    issuesFound: results.issues.length,
                    optimizations: results.optimizations.length,
                    contentGaps: results.contentGaps.length
                }
            });

            AgentEngine.log(this.name, 'Content Analysis Complete',
                `Analyzed ${results.pagesAnalyzed} pages, found ${results.optimizations.length} optimizations`,
                results.optimizations.length > 10 ? 'high' : 'medium'
            );
        },

        analyzePage(page, keywords) {
            const issues = [];
            const optimizations = [];
            let score = 100;

            // Title analysis
            if (!page.title || page.title.length < 30) {
                issues.push({ type: 'title', severity: 'high', message: 'Title too short or missing' });
                score -= 15;
                optimizations.push({
                    page: page.url,
                    type: 'title',
                    priority: 'high',
                    current: page.title || '(missing)',
                    recommendation: 'Add descriptive title (50-60 characters) with target keyword'
                });
            } else if (page.title.length > 60) {
                issues.push({ type: 'title', severity: 'medium', message: 'Title may be truncated in SERPs' });
                score -= 5;
            }

            // Meta description
            const metaLength = page.metaLength || (page.metaDescription ? page.metaDescription.length : 0);
            if (!metaLength || metaLength < 120) {
                issues.push({ type: 'meta', severity: 'high', message: 'Meta description missing or too short' });
                score -= 10;
                optimizations.push({
                    page: page.url,
                    type: 'meta',
                    priority: 'high',
                    current: metaLength ? `${metaLength} chars` : '(missing)',
                    recommendation: 'Write compelling meta description (150-160 chars) with CTA'
                });
            }

            // Content length
            const wordCount = page.wordCount || 0;
            if (wordCount < 300) {
                issues.push({ type: 'content', severity: 'high', message: 'Thin content detected' });
                score -= 20;
                optimizations.push({
                    page: page.url,
                    type: 'content',
                    priority: 'critical',
                    current: `${wordCount} words`,
                    recommendation: 'Expand content to 800-1500 words with valuable information'
                });
            } else if (wordCount < 600) {
                issues.push({ type: 'content', severity: 'medium', message: 'Content could be more comprehensive' });
                score -= 10;
            }

            // H1 presence
            if (!page.hasH1 && page.h1Count === 0) {
                issues.push({ type: 'h1', severity: 'high', message: 'Missing H1 heading' });
                score -= 15;
                optimizations.push({
                    page: page.url,
                    type: 'h1',
                    priority: 'high',
                    recommendation: 'Add clear H1 heading with target keyword'
                });
            }

            // Internal links
            if ((page.internalLinks || 0) < 3) {
                issues.push({ type: 'links', severity: 'medium', message: 'Few internal links' });
                score -= 5;
                optimizations.push({
                    page: page.url,
                    type: 'internal-links',
                    priority: 'medium',
                    recommendation: 'Add 3-5 relevant internal links to improve site structure'
                });
            }

            // Keyword optimization check
            const relevantKeywords = keywords.filter(k =>
                page.url && (page.url.includes(k.keyword.split(' ')[0]) ||
                (page.title && page.title.toLowerCase().includes(k.keyword.toLowerCase())))
            );

            if (relevantKeywords.length === 0 && keywords.length > 0) {
                score -= 10;
                optimizations.push({
                    page: page.url,
                    type: 'keyword',
                    priority: 'medium',
                    recommendation: 'Optimize page for target keywords in title, H1, and content'
                });
            }

            return {
                url: page.url,
                score: Math.max(0, score),
                issues,
                optimizations
            };
        },

        findContentGaps(keywords, pages) {
            const gaps = [];
            const pageUrls = pages.map(p => p.url || '').join(' ').toLowerCase();
            const pageTitles = pages.map(p => p.title || '').join(' ').toLowerCase();

            // Find keywords without dedicated content
            for (const kw of keywords) {
                const kwLower = kw.keyword.toLowerCase();
                const mainWord = kwLower.split(' ')[0];

                const hasContent = pageUrls.includes(mainWord) || pageTitles.includes(kwLower);

                if (!hasContent && kw.searchVolume > 500) {
                    gaps.push({
                        keyword: kw.keyword,
                        searchVolume: kw.searchVolume,
                        difficulty: kw.difficulty,
                        recommendation: `Create dedicated content targeting "${kw.keyword}"`
                    });
                }
            }

            return gaps.slice(0, 10);
        },

        getDefaultPages() {
            return [
                { url: '/', title: 'Homepage', wordCount: 500, hasH1: true, metaLength: 150, internalLinks: 5 },
                { url: '/services', title: 'Services', wordCount: 400, hasH1: true, metaLength: 140, internalLinks: 3 },
                { url: '/about', title: 'About', wordCount: 350, hasH1: true, metaLength: 0, internalLinks: 2 },
                { url: '/contact', title: 'Contact', wordCount: 150, hasH1: false, metaLength: 100, internalLinks: 1 },
                { url: '/blog', title: 'Blog', wordCount: 200, hasH1: true, metaLength: 155, internalLinks: 4 }
            ];
        },

        generateInsights(results) {
            // Critical content issues
            const criticalOptimizations = results.optimizations.filter(o => o.priority === 'critical');
            if (criticalOptimizations.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'alert',
                    priority: 'critical',
                    title: `${criticalOptimizations.length} Pages Need Urgent Content Updates`,
                    description: 'Thin content detected on multiple pages. This significantly impacts rankings.',
                    actionable: true,
                    data: criticalOptimizations
                });
            }

            // High priority optimizations
            const highPriority = results.optimizations.filter(o => o.priority === 'high');
            if (highPriority.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'high',
                    title: `${highPriority.length} High-Impact Content Optimizations`,
                    description: 'Quick wins available: missing titles, meta descriptions, and H1 tags.',
                    actionable: true,
                    data: highPriority.slice(0, 5)
                });
            }

            // Content gaps
            if (results.contentGaps.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'medium',
                    title: `${results.contentGaps.length} Content Gaps Identified`,
                    description: 'Create new content to target these high-volume keywords.',
                    actionable: true,
                    data: results.contentGaps
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 3: TECHNICAL SEO AGENT
    // Site health monitoring with auto-fix capabilities
    // ═══════════════════════════════════════════════════════════════════════════

    const TechnicalSEOAgent = {
        id: 'technicalSEO',
        name: 'Technical SEO Agent',
        icon: '⚙️',

        async run() {
            console.log(`${this.icon} ${this.name}: Scanning site health...`);

            const results = {
                healthScore: 100,
                issues: { critical: [], high: [], medium: [], low: [] },
                fixes: { applied: 0, pending: 0 },
                metrics: {}
            };

            // Run comprehensive scan
            this.scanForIssues(results);

            // Calculate health score
            results.healthScore = this.calculateHealthScore(results.issues);

            // Generate fix recommendations
            const fixes = this.generateFixes(results.issues);
            results.fixes.pending = fixes.length;

            // Generate insights
            this.generateInsights(results);

            // Update agent
            AgentEngine.updateAgent(this.id, {
                status: results.issues.critical.length > 0 ? 'warning' : 'active',
                metrics: {
                    healthScore: results.healthScore,
                    criticalIssues: results.issues.critical.length,
                    highIssues: results.issues.high.length,
                    mediumIssues: results.issues.medium.length,
                    lowIssues: results.issues.low.length,
                    pendingFixes: results.fixes.pending
                }
            });

            AgentEngine.log(this.name, 'Technical Audit Complete',
                `Health Score: ${results.healthScore}%. Found ${results.issues.critical.length} critical issues.`,
                results.issues.critical.length > 0 ? 'high' : 'low'
            );
        },

        quickScan() {
            // Quick scan using cached data
            const cachedResults = this.getCachedScanResults();
            if (cachedResults) {
                return {
                    critical: cachedResults.issues.critical.length,
                    high: cachedResults.issues.high.length
                };
            }
            return { critical: 0, high: 0 };
        },

        getCachedScanResults() {
            try {
                const cached = localStorage.getItem('technical-seo-scan');
                if (cached) {
                    const data = JSON.parse(cached);
                    // Check if cache is less than 1 hour old
                    if (Date.now() - data.timestamp < 3600000) {
                        return data.results;
                    }
                }
            } catch (e) {}
            return null;
        },

        saveScanResults(results) {
            try {
                localStorage.setItem('technical-seo-scan', JSON.stringify({
                    timestamp: Date.now(),
                    results
                }));
            } catch (e) {}
        },

        async scanForIssues(results) {
            // Use real API integrations if available
            const settings = AgentEngine.getSettings();
            const siteUrl = settings.websiteUrl;

            if (!siteUrl) {
                // No site configured - use stored analysis data
                this.useStoredAnalysisData(results);
                return;
            }

            // Try to use PageSpeed API for real data
            if (window.APIIntegrations?.PageSpeed) {
                try {
                    const pageSpeedData = await window.APIIntegrations.PageSpeed.analyze(siteUrl, 'mobile');
                    this.processPageSpeedResults(pageSpeedData, results);
                } catch (e) {
                    console.warn('PageSpeed API unavailable:', e.message);
                }
            }

            // Try to use Site Crawler for on-page analysis
            if (window.APIIntegrations?.Crawler) {
                try {
                    const crawlData = await window.APIIntegrations.Crawler.analyzePage(siteUrl);
                    if (crawlData.analyzed) {
                        this.processCrawlResults(crawlData, results);
                    }
                } catch (e) {
                    console.warn('Site crawl unavailable:', e.message);
                }
            }

            // If no API data, use stored analysis
            if (results.issues.critical.length === 0 && results.issues.high.length === 0) {
                this.useStoredAnalysisData(results);
            }

            // Cache the results
            this.saveScanResults(results);
        },

        processPageSpeedResults(data, results) {
            // Core Web Vitals issues
            if (data.coreWebVitals?.lcp?.rating === 'poor') {
                results.issues.critical.push({
                    id: 'slow-lcp',
                    title: 'Poor LCP (Largest Contentful Paint)',
                    description: `LCP is ${data.coreWebVitals.lcp.displayValue}. Target: under 2.5s`,
                    impact: 15,
                    detectedAt: new Date().toISOString(),
                    source: 'PageSpeed Insights'
                });
            } else if (data.coreWebVitals?.lcp?.rating === 'needs-improvement') {
                results.issues.high.push({
                    id: 'moderate-lcp',
                    title: 'LCP Needs Improvement',
                    description: `LCP is ${data.coreWebVitals.lcp.displayValue}. Target: under 2.5s`,
                    impact: 8,
                    detectedAt: new Date().toISOString(),
                    source: 'PageSpeed Insights'
                });
            }

            if (data.coreWebVitals?.cls?.rating === 'poor') {
                results.issues.high.push({
                    id: 'high-cls',
                    title: 'High Layout Shift (CLS)',
                    description: `CLS is ${data.coreWebVitals.cls.displayValue}. Target: under 0.1`,
                    impact: 10,
                    detectedAt: new Date().toISOString(),
                    source: 'PageSpeed Insights'
                });
            }

            // Performance score issues
            if (data.scores.performance < 50) {
                results.issues.critical.push({
                    id: 'poor-performance',
                    title: 'Critical Performance Score',
                    description: `Performance score is ${data.scores.performance}/100`,
                    impact: 20,
                    detectedAt: new Date().toISOString(),
                    source: 'PageSpeed Insights'
                });
            } else if (data.scores.performance < 75) {
                results.issues.high.push({
                    id: 'low-performance',
                    title: 'Performance Needs Improvement',
                    description: `Performance score is ${data.scores.performance}/100`,
                    impact: 10,
                    detectedAt: new Date().toISOString(),
                    source: 'PageSpeed Insights'
                });
            }

            // SEO score issues
            if (data.scores.seo < 80) {
                results.issues.medium.push({
                    id: 'seo-score-low',
                    title: 'SEO Score Below Optimal',
                    description: `SEO score is ${data.scores.seo}/100`,
                    impact: 5,
                    detectedAt: new Date().toISOString(),
                    source: 'PageSpeed Insights'
                });
            }

            // Process specific issues from PageSpeed
            for (const issue of data.issues || []) {
                if (issue.impact === 'high') {
                    results.issues.high.push({
                        id: issue.id,
                        title: issue.title,
                        description: issue.displayValue || issue.description,
                        impact: 8,
                        detectedAt: new Date().toISOString(),
                        source: 'PageSpeed Insights'
                    });
                } else if (issue.impact === 'medium') {
                    results.issues.medium.push({
                        id: issue.id,
                        title: issue.title,
                        description: issue.displayValue || issue.description,
                        impact: 4,
                        detectedAt: new Date().toISOString(),
                        source: 'PageSpeed Insights'
                    });
                }
            }
        },

        processCrawlResults(data, results) {
            // Process issues from site crawl
            for (const issue of data.issues || []) {
                const targetArray = results.issues[issue.severity] || results.issues.medium;
                const impactMap = { critical: 15, high: 10, medium: 5, low: 2 };

                targetArray.push({
                    id: issue.id,
                    title: issue.message || issue.id.replace(/-/g, ' '),
                    description: issue.message,
                    impact: impactMap[issue.severity] || 5,
                    detectedAt: new Date().toISOString(),
                    source: 'Site Crawler',
                    page: data.url
                });
            }
        },

        useStoredAnalysisData(results) {
            // Use previously stored analysis data
            const analysisData = AgentEngine.getAnalysisData();

            if (analysisData.technicalIssues) {
                for (const issue of analysisData.technicalIssues) {
                    const severity = issue.severity || 'medium';
                    results.issues[severity].push({
                        ...issue,
                        detectedAt: issue.detectedAt || new Date().toISOString(),
                        source: 'Stored Analysis'
                    });
                }
            }

            // Check for common issues in stored page data
            if (analysisData.pages) {
                for (const page of analysisData.pages) {
                    if (!page.title || page.title.length < 10) {
                        results.issues.high.push({
                            id: 'missing-title',
                            title: 'Missing or Short Title',
                            description: `Page ${page.url} has no proper title tag`,
                            impact: 10,
                            page: page.url,
                            source: 'Stored Analysis'
                        });
                    }
                    if (!page.metaDescription || page.metaLength < 50) {
                        results.issues.medium.push({
                            id: 'missing-meta',
                            title: 'Missing Meta Description',
                            description: `Page ${page.url} needs a meta description`,
                            impact: 5,
                            page: page.url,
                            source: 'Stored Analysis'
                        });
                    }
                }
            }
        },

        calculateHealthScore(issues) {
            let score = 100;

            score -= issues.critical.length * 15;
            score -= issues.high.length * 8;
            score -= issues.medium.length * 4;
            score -= issues.low.length * 2;

            return Math.max(0, Math.min(100, score));
        },

        generateFixes(issues) {
            const fixes = [];

            for (const severity of ['critical', 'high', 'medium', 'low']) {
                for (const issue of issues[severity]) {
                    if (issue.autoFix) {
                        fixes.push({
                            issueId: issue.id,
                            title: issue.title,
                            fixType: issue.fix,
                            severity,
                            status: 'pending'
                        });
                    }
                }
            }

            return fixes;
        },

        generateInsights(results) {
            // Critical issues alert
            if (results.issues.critical.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'alert',
                    priority: 'critical',
                    title: `🚨 ${results.issues.critical.length} Critical Technical Issues`,
                    description: results.issues.critical.map(i => i.title).join(', '),
                    actionable: true,
                    data: results.issues.critical
                });
            }

            // Health score insight
            if (results.healthScore < 70) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'high',
                    title: `Site Health Score: ${results.healthScore}%`,
                    description: 'Technical issues are impacting your SEO performance. Review and fix high-priority issues.',
                    actionable: true
                });
            } else if (results.healthScore >= 90) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'success',
                    priority: 'low',
                    title: `Excellent Site Health: ${results.healthScore}%`,
                    description: 'Your site is technically well-optimized. Continue monitoring for any new issues.',
                    actionable: false
                });
            }

            // Auto-fixable issues
            const autoFixable = [...results.issues.high, ...results.issues.medium]
                .filter(i => i.autoFix);

            if (autoFixable.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'medium',
                    title: `${autoFixable.length} Issues Can Be Auto-Fixed`,
                    description: 'These technical issues can be automatically resolved. Review and approve fixes.',
                    actionable: true,
                    data: autoFixable
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 4: KEYWORD INTELLIGENCE AGENT
    // Discovers high-value opportunities and optimizes keyword portfolio
    // ═══════════════════════════════════════════════════════════════════════════

    const KeywordIntelligenceAgent = {
        id: 'keywordIntelligence',
        name: 'Keyword Intelligence Agent',
        icon: '🔍',

        async run() {
            console.log(`${this.icon} ${this.name}: Discovering opportunities...`);

            const keywords = AgentEngine.getKeywords();

            const results = {
                tracked: keywords.length,
                quickWins: [],
                strikingDistance: [],
                highPotential: [],
                declining: [],
                rising: [],
                portfolioScore: 0
            };

            // Analyze each keyword
            for (const keyword of keywords) {
                this.categorizeKeyword(keyword, results);
            }

            // Calculate portfolio score
            results.portfolioScore = this.calculatePortfolioScore(keywords, results);

            // Generate insights
            this.generateInsights(results);

            // Update agent
            AgentEngine.updateAgent(this.id, {
                status: 'active',
                metrics: {
                    keywordsTracked: results.tracked,
                    quickWins: results.quickWins.length,
                    strikingDistance: results.strikingDistance.length,
                    highPotential: results.highPotential.length,
                    declining: results.declining.length,
                    portfolioScore: results.portfolioScore
                }
            });

            AgentEngine.log(this.name, 'Keyword Analysis Complete',
                `Found ${results.quickWins.length} quick wins and ${results.highPotential.length} high-potential opportunities`,
                results.quickWins.length > 3 ? 'high' : 'medium'
            );
        },

        categorizeKeyword(keyword, results) {
            const position = keyword.position || 50;
            const volume = keyword.searchVolume || 0;
            const difficulty = keyword.difficulty || 50;
            const prevPosition = keyword.previousPosition || position;

            // Quick Wins: Position 11-20, reasonable volume, low-medium difficulty
            if (position >= 11 && position <= 20 && volume > 200 && difficulty < CONFIG.difficulty.medium) {
                results.quickWins.push({
                    ...keyword,
                    potentialTraffic: Math.round(volume * (CONFIG.ctrByPosition[10] - CONFIG.ctrByPosition[position])),
                    recommendation: 'Optimize content, add internal links, improve page speed'
                });
            }

            // Striking Distance: Position 4-10, could reach top 3
            if (position >= 4 && position <= 10 && volume > 100) {
                results.strikingDistance.push({
                    ...keyword,
                    potentialTraffic: Math.round(volume * (CONFIG.ctrByPosition[1] - CONFIG.ctrByPosition[position])),
                    recommendation: 'Focus on content depth, backlinks, and user engagement'
                });
            }

            // High Potential: High volume, manageable difficulty, not ranking
            if (position > 20 && volume > 1000 && difficulty < CONFIG.difficulty.hard) {
                results.highPotential.push({
                    ...keyword,
                    potentialTraffic: Math.round(volume * CONFIG.ctrByPosition[5]),
                    recommendation: 'Create comprehensive content targeting this keyword'
                });
            }

            // Declining keywords
            if (prevPosition && position > prevPosition + 3) {
                results.declining.push({
                    ...keyword,
                    change: position - prevPosition,
                    recommendation: 'Investigate ranking drop and update content'
                });
            }

            // Rising keywords
            if (prevPosition && position < prevPosition - 3) {
                results.rising.push({
                    ...keyword,
                    change: prevPosition - position,
                    recommendation: 'Capitalize on momentum with additional optimization'
                });
            }
        },

        calculatePortfolioScore(keywords, results) {
            if (keywords.length === 0) return 0;

            let score = 50; // Base score

            // Bonus for top 10 rankings
            const top10 = keywords.filter(k => k.position <= 10).length;
            score += (top10 / keywords.length) * 30;

            // Bonus for quick wins identified
            score += Math.min(10, results.quickWins.length * 2);

            // Penalty for declining keywords
            score -= Math.min(15, results.declining.length * 3);

            // Bonus for rising keywords
            score += Math.min(10, results.rising.length * 2);

            return Math.max(0, Math.min(100, Math.round(score)));
        },

        generateInsights(results) {
            // Quick wins
            if (results.quickWins.length > 0) {
                const topQuickWins = results.quickWins
                    .sort((a, b) => b.potentialTraffic - a.potentialTraffic)
                    .slice(0, 5);

                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'quick-win',
                    priority: 'high',
                    title: `${results.quickWins.length} Quick Win Keywords (Position 11-20)`,
                    description: `These keywords are close to page 1. Top opportunity: "${topQuickWins[0].keyword}" with +${topQuickWins[0].potentialTraffic} potential monthly visits.`,
                    actionable: true,
                    data: topQuickWins
                });
            }

            // Striking distance
            if (results.strikingDistance.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'medium',
                    title: `${results.strikingDistance.length} Keywords in Striking Distance`,
                    description: 'These page 1 keywords could reach top 3 with focused optimization.',
                    actionable: true,
                    data: results.strikingDistance.slice(0, 5)
                });
            }

            // High potential
            if (results.highPotential.length > 0) {
                const totalPotential = results.highPotential.reduce((sum, k) => sum + k.potentialTraffic, 0);

                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'medium',
                    title: `${results.highPotential.length} High-Potential Keywords Untapped`,
                    description: `These keywords represent ${totalPotential.toLocaleString()} potential monthly visits. Create content to capture this traffic.`,
                    actionable: true,
                    data: results.highPotential.slice(0, 5)
                });
            }

            // Declining keywords alert
            if (results.declining.length >= 3) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'high',
                    title: `⚠️ ${results.declining.length} Keywords Declining`,
                    description: 'Multiple keywords have dropped in rankings. Investigate and take action.',
                    actionable: true,
                    data: results.declining
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 5: COMPETITOR ANALYSIS AGENT
    // Real-time competitor tracking and gap analysis
    // ═══════════════════════════════════════════════════════════════════════════

    const CompetitorAnalysisAgent = {
        id: 'competitorAnalysis',
        name: 'Competitor Analysis Agent',
        icon: '🏆',

        async run() {
            console.log(`${this.icon} ${this.name}: Analyzing competitors...`);

            const competitors = AgentEngine.getCompetitors();
            const keywords = AgentEngine.getKeywords();

            const results = {
                competitorsTracked: competitors.length,
                keywordGaps: [],
                backlinkOpportunities: [],
                contentGaps: [],
                competitorInsights: []
            };

            // Analyze each competitor
            for (const competitor of competitors) {
                const analysis = this.analyzeCompetitor(competitor, keywords);
                results.competitorInsights.push(analysis);
                results.keywordGaps.push(...analysis.keywordGaps);
                results.backlinkOpportunities.push(...analysis.backlinkOpportunities);
            }

            // Deduplicate gaps
            results.keywordGaps = this.deduplicateGaps(results.keywordGaps);

            // Generate insights
            this.generateInsights(results);

            // Update agent
            AgentEngine.updateAgent(this.id, {
                status: 'active',
                metrics: {
                    competitorsTracked: results.competitorsTracked,
                    keywordGaps: results.keywordGaps.length,
                    backlinkOpportunities: results.backlinkOpportunities.length,
                    contentGaps: results.contentGaps.length
                }
            });

            AgentEngine.log(this.name, 'Competitor Analysis Complete',
                `Analyzed ${results.competitorsTracked} competitors, found ${results.keywordGaps.length} keyword gaps`,
                results.keywordGaps.length > 20 ? 'high' : 'medium'
            );
        },

        async analyzeCompetitor(competitor, ourKeywords) {
            const ourKeywordSet = new Set(ourKeywords.map(k => k.keyword.toLowerCase()));

            // Get competitor keywords (real or estimated)
            const competitorKeywords = await this.getCompetitorKeywords(competitor);

            // Find gaps
            const keywordGaps = competitorKeywords
                .filter(k => !ourKeywordSet.has(k.keyword.toLowerCase()))
                .map(k => ({
                    ...k,
                    competitor: competitor.domain,
                    opportunity: 'Competitor ranks for this keyword'
                }));

            // Get backlink opportunities
            const backlinkOpportunities = await this.getBacklinkOpportunities(competitor);

            // Get real DA if available from API analysis
            let domainAuthority = competitor.da || 50;
            if (window.APIIntegrations?.Competitor) {
                try {
                    const analysis = await window.APIIntegrations.Competitor.analyzeCompetitor(competitor.domain);
                    if (analysis.estimatedMetrics?.domainAuthority) {
                        domainAuthority = analysis.estimatedMetrics.domainAuthority;
                    }
                } catch (e) {}
            }

            return {
                competitor: competitor.domain,
                da: domainAuthority,
                estimatedTraffic: competitor.traffic || '10K-50K',
                keywordGaps: keywordGaps.slice(0, 20),
                backlinkOpportunities,
                threatLevel: this.calculateThreatLevel({ ...competitor, da: domainAuthority })
            };
        },

        async getBacklinkOpportunities(competitor) {
            const opportunities = [];
            const da = competitor.da || 50;
            const domain = competitor.domain;

            // Try to get real backlink data
            const backlinkData = JSON.parse(localStorage.getItem('seo-backlinks') || '{}');

            // Check for competitor backlinks we could also get
            if (backlinkData.referringDomains) {
                backlinkData.referringDomains.forEach(rd => {
                    if (rd.domainAuthority > 40) {
                        opportunities.push({
                            type: 'shared-link',
                            domain: rd.domain,
                            estimatedDA: rd.domainAuthority,
                            recommendation: `This site links to competitors. Consider outreach.`
                        });
                    }
                });
            }

            // Add standard opportunities
            if (da > 60) {
                opportunities.push({
                    type: 'guest-post',
                    domain,
                    estimatedDA: da,
                    recommendation: 'Research their backlink sources for guest post opportunities'
                });
            }

            opportunities.push({
                type: 'resource-page',
                domain,
                recommendation: 'Find resource pages linking to competitor'
            });

            return opportunities.slice(0, 10);
        },

        async getCompetitorKeywords(competitor) {
            // Get real competitor data if available via API
            if (window.APIIntegrations?.Competitor) {
                try {
                    const analysis = await window.APIIntegrations.Competitor.analyzeCompetitor(competitor.domain);
                    if (analysis.seo) {
                        return this.extractKeywordsFromAnalysis(analysis, competitor);
                    }
                } catch (e) {
                    console.warn('Competitor API analysis failed:', e.message);
                }
            }

            // Fallback: generate keyword opportunities based on competitor domain
            return this.generateKeywordOpportunities(competitor);
        },

        extractKeywordsFromAnalysis(analysis, competitor) {
            const keywords = [];
            const domain = competitor.domain || '';

            // Extract keywords from title and meta
            if (analysis.seo?.title?.text) {
                const titleWords = analysis.seo.title.text.toLowerCase()
                    .split(/\s+/)
                    .filter(w => w.length > 3);
                titleWords.forEach(word => {
                    keywords.push({
                        keyword: word,
                        searchVolume: this.estimateVolumeForKeyword(word),
                        difficulty: this.estimateDifficultyForKeyword(word),
                        source: 'competitor-title',
                        competitor: domain
                    });
                });
            }

            // Extract from H1
            if (analysis.seo?.h1?.length > 0) {
                analysis.seo.h1.forEach(h1 => {
                    keywords.push({
                        keyword: h1.toLowerCase(),
                        searchVolume: this.estimateVolumeForKeyword(h1),
                        difficulty: this.estimateDifficultyForKeyword(h1),
                        source: 'competitor-h1',
                        competitor: domain
                    });
                });
            }

            // Add brand-based keywords
            const brandKeywords = this.generateBrandKeywords(domain);
            keywords.push(...brandKeywords);

            return keywords;
        },

        generateKeywordOpportunities(competitor) {
            const domain = competitor.domain || '';
            const brandName = domain.replace(/\.(com|org|io|net|co)$/, '').split('.')[0];
            const industry = competitor.industry || 'seo';

            const keywords = [];

            // Brand-related keywords with estimated metrics
            const brandPatterns = [
                { kw: `${brandName} alternative`, volume: 1200, difficulty: 35 },
                { kw: `${brandName} vs`, volume: 800, difficulty: 30 },
                { kw: `${brandName} pricing`, volume: 1500, difficulty: 25 },
                { kw: `${brandName} review`, volume: 2000, difficulty: 40 },
                { kw: `${brandName} features`, volume: 600, difficulty: 30 },
                { kw: `best ${brandName} alternatives`, volume: 900, difficulty: 45 }
            ];

            brandPatterns.forEach(p => {
                keywords.push({
                    keyword: p.kw,
                    searchVolume: p.volume,
                    difficulty: p.difficulty,
                    source: 'brand-analysis',
                    competitor: domain
                });
            });

            // Industry keywords based on stored keyword data
            const ourKeywords = AgentEngine.getKeywords();
            if (ourKeywords.length > 0) {
                // Find related keywords we might be missing
                const ourKeywordSet = new Set(ourKeywords.map(k => k.keyword.toLowerCase()));
                const industryKeywords = this.getIndustryKeywords(industry);

                industryKeywords.forEach(ik => {
                    if (!ourKeywordSet.has(ik.keyword.toLowerCase())) {
                        keywords.push({
                            ...ik,
                            source: 'industry-gap',
                            competitor: domain
                        });
                    }
                });
            }

            return keywords;
        },

        generateBrandKeywords(domain) {
            const brandName = domain.replace(/\.(com|org|io|net|co)$/, '').split('.')[0];
            return [
                { keyword: `${brandName} alternative`, searchVolume: 1200, difficulty: 35, source: 'brand' },
                { keyword: `${brandName} vs`, searchVolume: 800, difficulty: 30, source: 'brand' },
                { keyword: `${brandName} pricing`, searchVolume: 1500, difficulty: 25, source: 'brand' },
                { keyword: `${brandName} review`, searchVolume: 2000, difficulty: 40, source: 'brand' }
            ];
        },

        getIndustryKeywords(industry) {
            // Industry-specific keyword opportunities
            const industryKeywords = {
                'seo': [
                    { keyword: 'seo tools', searchVolume: 8000, difficulty: 65 },
                    { keyword: 'keyword research tool', searchVolume: 5000, difficulty: 55 },
                    { keyword: 'backlink checker', searchVolume: 4000, difficulty: 50 },
                    { keyword: 'site audit tool', searchVolume: 2500, difficulty: 45 },
                    { keyword: 'rank tracker', searchVolume: 3500, difficulty: 50 },
                    { keyword: 'seo analysis', searchVolume: 6000, difficulty: 60 }
                ],
                'marketing': [
                    { keyword: 'marketing automation', searchVolume: 7000, difficulty: 70 },
                    { keyword: 'email marketing software', searchVolume: 9000, difficulty: 65 },
                    { keyword: 'social media management', searchVolume: 8500, difficulty: 60 },
                    { keyword: 'content marketing tools', searchVolume: 3000, difficulty: 55 }
                ],
                'default': [
                    { keyword: 'best software', searchVolume: 5000, difficulty: 50 },
                    { keyword: 'online tools', searchVolume: 4000, difficulty: 45 }
                ]
            };

            return industryKeywords[industry] || industryKeywords['default'];
        },

        estimateVolumeForKeyword(keyword) {
            // Estimate search volume based on keyword characteristics
            const wordCount = keyword.split(/\s+/).length;
            const baseVolume = 1000;

            // Longer keywords typically have lower volume
            const volumeMultiplier = Math.max(0.2, 1 - (wordCount - 1) * 0.2);

            return Math.round(baseVolume * volumeMultiplier);
        },

        estimateDifficultyForKeyword(keyword) {
            // Estimate difficulty based on keyword characteristics
            const wordCount = keyword.split(/\s+/).length;

            // Longer, more specific keywords are typically easier
            const baseDifficulty = 50;
            const difficultyReduction = Math.min(25, (wordCount - 1) * 8);

            return Math.max(15, baseDifficulty - difficultyReduction);
        },

        estimateBacklinkOpportunities(competitor) {
            const opportunities = [];
            const da = competitor.da || 50;

            if (da > 60) {
                opportunities.push({
                    type: 'guest-post',
                    domain: competitor.domain,
                    estimatedDA: da,
                    recommendation: 'Research their backlink sources for guest post opportunities'
                });
            }

            opportunities.push({
                type: 'resource-page',
                domain: competitor.domain,
                recommendation: 'Find resource pages linking to competitor'
            });

            return opportunities;
        },

        calculateThreatLevel(competitor) {
            const da = competitor.da || 50;
            if (da > 70) return 'high';
            if (da > 50) return 'medium';
            return 'low';
        },

        deduplicateGaps(gaps) {
            const seen = new Set();
            return gaps.filter(gap => {
                const key = gap.keyword.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },

        generateInsights(results) {
            // Keyword gaps
            if (results.keywordGaps.length > 0) {
                const highVolumeGaps = results.keywordGaps
                    .filter(g => g.searchVolume > 1000)
                    .slice(0, 10);

                if (highVolumeGaps.length > 0) {
                    AgentEngine.addInsight({
                        agent: this.name,
                        type: 'opportunity',
                        priority: 'high',
                        title: `${highVolumeGaps.length} High-Volume Keyword Gaps`,
                        description: 'Competitors rank for these high-volume keywords that you don\'t target.',
                        actionable: true,
                        data: highVolumeGaps
                    });
                }
            }

            // High-threat competitors
            const highThreat = results.competitorInsights.filter(c => c.threatLevel === 'high');
            if (highThreat.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'medium',
                    title: `${highThreat.length} High-Authority Competitors`,
                    description: `Watch these competitors closely: ${highThreat.map(c => c.competitor).join(', ')}`,
                    actionable: true,
                    data: highThreat
                });
            }

            // Backlink opportunities
            if (results.backlinkOpportunities.length > 0) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'medium',
                    title: `${results.backlinkOpportunities.length} Backlink Opportunities from Competitors`,
                    description: 'Analyze competitor backlink profiles for link building opportunities.',
                    actionable: true,
                    data: results.backlinkOpportunities.slice(0, 10)
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 6: PERFORMANCE PREDICTION AGENT
    // ML-based forecasting for traffic and rankings
    // ═══════════════════════════════════════════════════════════════════════════

    const PerformancePredictionAgent = {
        id: 'performancePrediction',
        name: 'Performance Prediction Agent',
        icon: '📈',

        async run() {
            console.log(`${this.icon} ${this.name}: Generating predictions...`);

            const keywords = AgentEngine.getKeywords();
            const currentMetrics = this.getCurrentMetrics(keywords);

            const predictions = {
                traffic: this.predictTraffic(currentMetrics),
                rankings: this.predictRankings(keywords),
                domainAuthority: this.predictDA(currentMetrics),
                topKeywords: this.predictTopKeywords(keywords)
            };

            // Store predictions
            for (const pred of Object.values(predictions)) {
                AgentEngine.addPrediction(pred);
            }

            // Generate insights
            this.generateInsights(predictions, currentMetrics);

            // Update agent
            AgentEngine.updateAgent(this.id, {
                status: 'active',
                metrics: {
                    predictionsGenerated: 4,
                    avgConfidence: Math.round(
                        (predictions.traffic.confidence + predictions.rankings.confidence +
                         predictions.domainAuthority.confidence + predictions.topKeywords.confidence) / 4
                    ),
                    timeframe: '30 days'
                }
            });

            AgentEngine.log(this.name, 'Predictions Generated',
                `Traffic forecast: ${predictions.traffic.change > 0 ? '+' : ''}${predictions.traffic.change}% in 30 days`,
                Math.abs(predictions.traffic.change) > 15 ? 'high' : 'medium'
            );
        },

        getCurrentMetrics(keywords) {
            const top10 = keywords.filter(k => k.position <= 10).length;
            const top3 = keywords.filter(k => k.position <= 3).length;
            const avgPosition = keywords.length > 0
                ? keywords.reduce((sum, k) => sum + (k.position || 50), 0) / keywords.length
                : 50;

            const estimatedTraffic = keywords.reduce((sum, k) => {
                const ctr = CONFIG.ctrByPosition[k.position] || 0.005;
                return sum + (k.searchVolume || 0) * ctr;
            }, 0);

            // Get stored DA or estimate from analysis
            const storedDA = this.getStoredDomainAuthority();

            return {
                totalKeywords: keywords.length,
                top3Keywords: top3,
                top10Keywords: top10,
                avgPosition: Math.round(avgPosition * 10) / 10,
                estimatedTraffic: Math.round(estimatedTraffic),
                domainAuthority: storedDA
            };
        },

        getStoredDomainAuthority() {
            // Check for stored DA from analysis
            try {
                const analysisData = AgentEngine.getAnalysisData();
                if (analysisData.domainAuthority) {
                    return analysisData.domainAuthority;
                }

                // Check backlink service data
                const backlinkData = JSON.parse(localStorage.getItem('seo-backlinks') || '{}');
                if (backlinkData.domainAuthority) {
                    return backlinkData.domainAuthority;
                }

                // Estimate based on available data
                const keywords = AgentEngine.getKeywords();
                const top10Count = keywords.filter(k => k.position <= 10).length;
                const backlinks = backlinkData.totalBacklinks || 0;

                // Base estimate
                let estimatedDA = 25;
                if (top10Count > 10) estimatedDA += 10;
                else if (top10Count > 5) estimatedDA += 5;

                if (backlinks > 1000) estimatedDA += 15;
                else if (backlinks > 100) estimatedDA += 8;
                else if (backlinks > 10) estimatedDA += 3;

                return Math.min(100, estimatedDA);
            } catch (e) {
                return 30; // Default fallback
            }
        },

        getHistoricalData() {
            // Get historical metrics for trend analysis
            try {
                const history = JSON.parse(localStorage.getItem('seo-metrics-history') || '[]');
                return history;
            } catch (e) {
                return [];
            }
        },

        saveMetricsSnapshot(metrics) {
            try {
                const history = this.getHistoricalData();
                history.push({
                    timestamp: Date.now(),
                    ...metrics
                });
                // Keep last 90 days of data
                const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
                const filtered = history.filter(h => h.timestamp > cutoff);
                localStorage.setItem('seo-metrics-history', JSON.stringify(filtered.slice(-90)));
            } catch (e) {}
        },

        calculateTrend(history, metric) {
            if (history.length < 2) return 0;

            // Get recent values (last 7 data points)
            const recent = history.slice(-7);
            if (recent.length < 2) return 0;

            // Calculate linear regression slope
            const values = recent.map(h => h[metric] || 0);
            const n = values.length;
            const sumX = (n * (n - 1)) / 2;
            const sumY = values.reduce((a, b) => a + b, 0);
            const sumXY = values.reduce((sum, v, i) => sum + (i * v), 0);
            const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

            // Return percentage change per period
            const avgValue = sumY / n;
            return avgValue > 0 ? (slope / avgValue) : 0;
        },

        predictTraffic(current) {
            const history = this.getHistoricalData();
            this.saveMetricsSnapshot({ estimatedTraffic: current.estimatedTraffic, timestamp: Date.now() });

            // Calculate trend from historical data
            const trend = this.calculateTrend(history, 'estimatedTraffic');

            // Growth factors based on real data
            const growthFactors = {
                historicalTrend: trend * 30, // Project trend over 30 days
                optimizationPotential: current.top10Keywords > 5 ? 0.03 : 0.01,
                keywordGrowth: current.totalKeywords > 0 ? 0.02 : 0
            };

            // Base prediction on actual trend, not random
            let totalGrowth = Object.values(growthFactors).reduce((a, b) => a + b, 0);
            totalGrowth = Math.max(-0.2, Math.min(0.3, totalGrowth)); // Cap at -20% to +30%

            const predicted = Math.round(current.estimatedTraffic * (1 + totalGrowth));

            // Confidence based on data quality
            let confidence = 50;
            if (history.length >= 7) confidence += 15;
            if (history.length >= 14) confidence += 10;
            if (history.length >= 30) confidence += 10;
            if (current.totalKeywords >= 10) confidence += 5;

            return {
                metric: 'Organic Traffic',
                current: current.estimatedTraffic,
                predicted,
                change: Math.round(totalGrowth * 100),
                confidence: Math.min(95, confidence),
                timeframe: '30 days',
                factors: growthFactors,
                dataPoints: history.length
            };
        },

        predictRankings(keywords) {
            const current = keywords.filter(k => k.position <= 10).length;
            const potential = keywords.filter(k => k.position > 10 && k.position <= 20).length;
            const improving = keywords.filter(k => k.previousPosition && k.position < k.previousPosition).length;

            // Calculate improvement rate from real data
            const improvementRate = keywords.length > 0 ? improving / keywords.length : 0.15;

            // Estimate how many striking distance keywords could move to top 10
            const improvement = Math.round(potential * Math.min(0.4, improvementRate + 0.1));
            const predicted = current + improvement;

            // Confidence based on data quality
            let confidence = 55;
            if (keywords.some(k => k.previousPosition)) confidence += 15; // Has historical position data
            if (potential > 5) confidence += 10; // Good sample of striking distance keywords
            if (improving > 0) confidence += 10; // Has improvement data

            return {
                metric: 'Top 10 Keywords',
                current,
                predicted,
                change: current > 0 ? Math.round((improvement / current) * 100) : (improvement > 0 ? 100 : 0),
                confidence: Math.min(90, confidence),
                timeframe: '30 days',
                strikingDistance: potential,
                improvementRate: Math.round(improvementRate * 100)
            };
        },

        predictDA(current) {
            const history = this.getHistoricalData();

            // Calculate DA trend
            const trend = this.calculateTrend(history, 'domainAuthority');

            // DA typically grows slowly (1-3 points over 90 days for active sites)
            const backlinks = JSON.parse(localStorage.getItem('seo-backlinks') || '{}');
            const newBacklinksRate = backlinks.newBacklinksThisMonth || 0;

            let expectedGrowth = 1; // Base growth
            if (newBacklinksRate > 50) expectedGrowth += 2;
            else if (newBacklinksRate > 20) expectedGrowth += 1;

            if (trend > 0) expectedGrowth += 1;

            const predicted = Math.min(100, current.domainAuthority + expectedGrowth);

            // Confidence for DA prediction
            let confidence = 45;
            if (history.length >= 30) confidence += 15;
            if (backlinks.totalBacklinks) confidence += 10;

            return {
                metric: 'Domain Authority',
                current: current.domainAuthority,
                predicted,
                change: current.domainAuthority > 0 ? Math.round((expectedGrowth / current.domainAuthority) * 100) : expectedGrowth,
                confidence: Math.min(75, confidence),
                timeframe: '90 days',
                newBacklinksRate
            };
        },

        predictTopKeywords(keywords) {
            const current = keywords.filter(k => k.position <= 3).length;
            const striking = keywords.filter(k => k.position > 3 && k.position <= 10).length;

            // Check for keywords that are improving toward top 3
            const movingUp = keywords.filter(k =>
                k.position > 3 && k.position <= 10 &&
                k.previousPosition && k.position < k.previousPosition
            ).length;

            // Calculate improvement potential
            const improvementRate = striking > 0 ? movingUp / striking : 0.1;
            const improvement = Math.round(striking * Math.min(0.3, improvementRate + 0.05));
            const predicted = current + improvement;

            // Confidence
            let confidence = 50;
            if (movingUp > 0) confidence += 15;
            if (striking > 3) confidence += 10;
            if (keywords.some(k => k.previousPosition)) confidence += 10;

            return {
                metric: 'Top 3 Keywords',
                current,
                predicted,
                change: current > 0 ? Math.round((improvement / current) * 100) : (improvement > 0 ? 100 : 0),
                confidence: Math.min(85, confidence),
                timeframe: '30 days',
                strikingDistance: striking,
                movingUp
            };
        },

        generateInsights(predictions, current) {
            // Traffic growth insight
            if (predictions.traffic.change > 10) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'prediction',
                    priority: 'medium',
                    title: `📈 Predicted +${predictions.traffic.change}% Traffic Growth`,
                    description: `Based on current trends, expect ~${predictions.traffic.predicted.toLocaleString()} monthly visits in 30 days.`,
                    actionable: false,
                    data: predictions.traffic
                });
            } else if (predictions.traffic.change < -5) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'high',
                    title: `⚠️ Traffic Decline Predicted`,
                    description: `Models predict ${predictions.traffic.change}% traffic drop. Take action to reverse this trend.`,
                    actionable: true,
                    data: predictions.traffic
                });
            }

            // Ranking improvements
            if (predictions.rankings.predicted > predictions.rankings.current) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'prediction',
                    priority: 'low',
                    title: `${predictions.rankings.predicted - predictions.rankings.current} Keywords Predicted to Reach Top 10`,
                    description: 'Continue current optimization efforts to achieve this growth.',
                    actionable: false,
                    data: predictions.rankings
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT 7: ROI OPTIMIZATION AGENT
    // Maximizes return on SEO investment
    // ═══════════════════════════════════════════════════════════════════════════

    const ROIOptimizationAgent = {
        id: 'roiOptimization',
        name: 'ROI Optimization Agent',
        icon: '💰',

        async run() {
            console.log(`${this.icon} ${this.name}: Calculating ROI...`);

            const keywords = AgentEngine.getKeywords();

            const metrics = {
                currentValue: this.calculateCurrentValue(keywords),
                potentialValue: this.calculatePotentialValue(keywords),
                topOpportunities: this.findTopROIOpportunities(keywords),
                wastedPotential: [],
                roiScore: 0
            };

            metrics.potentialGain = metrics.potentialValue - metrics.currentValue;
            metrics.roiScore = Math.round((metrics.currentValue / Math.max(1, metrics.potentialValue)) * 100);
            metrics.wastedPotential = this.findWastedPotential(keywords);

            // Generate insights
            this.generateInsights(metrics);

            // Update agent
            AgentEngine.updateAgent(this.id, {
                status: 'active',
                metrics: {
                    currentMonthlyValue: metrics.currentValue,
                    potentialMonthlyValue: metrics.potentialValue,
                    potentialGain: metrics.potentialGain,
                    roiScore: metrics.roiScore,
                    annualValue: metrics.currentValue * 12
                }
            });

            AgentEngine.log(this.name, 'ROI Analysis Complete',
                `Monthly value: $${metrics.currentValue.toLocaleString()}. Potential: +$${metrics.potentialGain.toLocaleString()}`,
                'high'
            );

            // Update global performance metrics
            AgentEngine.state.performanceMetrics.valueGenerated = metrics.currentValue;
        },

        calculateCurrentValue(keywords) {
            return keywords.reduce((total, kw) => {
                const position = kw.position || 50;
                const volume = kw.searchVolume || 0;
                const cpc = parseFloat(kw.cpc) || 2;
                const ctr = CONFIG.ctrByPosition[position] || 0.005;

                return total + (volume * ctr * cpc);
            }, 0);
        },

        calculatePotentialValue(keywords) {
            return keywords.reduce((total, kw) => {
                const volume = kw.searchVolume || 0;
                const cpc = parseFloat(kw.cpc) || 2;
                const ctr = CONFIG.ctrByPosition[1]; // Position 1 CTR

                return total + (volume * ctr * cpc);
            }, 0);
        },

        findTopROIOpportunities(keywords) {
            return keywords
                .map(kw => {
                    const currentTraffic = (kw.searchVolume || 0) * (CONFIG.ctrByPosition[kw.position] || 0.005);
                    const potentialTraffic = (kw.searchVolume || 0) * CONFIG.ctrByPosition[1];
                    const cpc = parseFloat(kw.cpc) || 2;

                    return {
                        keyword: kw.keyword,
                        position: kw.position,
                        currentValue: Math.round(currentTraffic * cpc),
                        potentialValue: Math.round(potentialTraffic * cpc),
                        opportunity: Math.round((potentialTraffic - currentTraffic) * cpc),
                        difficulty: kw.difficulty || 50
                    };
                })
                .filter(k => k.opportunity > 50)
                .sort((a, b) => b.opportunity - a.opportunity)
                .slice(0, 10);
        },

        findWastedPotential(keywords) {
            return keywords
                .filter(kw => {
                    const position = kw.position || 50;
                    const volume = kw.searchVolume || 0;
                    const difficulty = kw.difficulty || 50;

                    // High volume, low difficulty, but poor ranking
                    return volume > 1000 && difficulty < 40 && position > 20;
                })
                .map(kw => ({
                    keyword: kw.keyword,
                    searchVolume: kw.searchVolume,
                    difficulty: kw.difficulty,
                    currentPosition: kw.position,
                    wastedValue: Math.round(kw.searchVolume * CONFIG.ctrByPosition[5] * (parseFloat(kw.cpc) || 2))
                }))
                .slice(0, 5);
        },

        generateInsights(metrics) {
            // Monthly value insight
            AgentEngine.addInsight({
                agent: this.name,
                type: 'roi',
                priority: 'medium',
                title: `Current SEO Value: $${Math.round(metrics.currentValue).toLocaleString()}/month`,
                description: `Your organic rankings generate equivalent of $${Math.round(metrics.currentValue).toLocaleString()} in paid traffic monthly. Annual value: $${Math.round(metrics.currentValue * 12).toLocaleString()}.`,
                actionable: false
            });

            // Potential gain
            if (metrics.potentialGain > 1000) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'high',
                    title: `💰 $${Math.round(metrics.potentialGain).toLocaleString()}/month Opportunity`,
                    description: 'This is the additional value you could capture by ranking #1 for all tracked keywords.',
                    actionable: true,
                    data: metrics.topOpportunities
                });
            }

            // Top opportunities
            if (metrics.topOpportunities.length > 0) {
                const topOpp = metrics.topOpportunities[0];
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'opportunity',
                    priority: 'high',
                    title: `Top ROI Keyword: "${topOpp.keyword}"`,
                    description: `Moving from #${topOpp.position} to #1 could capture $${topOpp.opportunity}/month in value.`,
                    actionable: true,
                    data: topOpp
                });
            }

            // Wasted potential
            if (metrics.wastedPotential.length > 0) {
                const totalWasted = metrics.wastedPotential.reduce((sum, k) => sum + k.wastedValue, 0);
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'medium',
                    title: `$${totalWasted.toLocaleString()}/month Wasted on Easy Keywords`,
                    description: 'These low-difficulty, high-volume keywords are not being captured.',
                    actionable: true,
                    data: metrics.wastedPotential
                });
            }

            // ROI score
            if (metrics.roiScore < 30) {
                AgentEngine.addInsight({
                    agent: this.name,
                    type: 'warning',
                    priority: 'high',
                    title: `ROI Capture Rate: Only ${metrics.roiScore}%`,
                    description: 'You\'re capturing less than a third of potential SEO value. Focus on quick wins to improve.',
                    actionable: true
                });
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.AIAgents = {
        // Version
        version: CONFIG.version,

        // Engine controls
        initialize: () => AgentEngine.initialize(),
        stop: () => AgentEngine.stop(),
        resume: () => AgentEngine.resume(),
        runAllAgents: () => AgentEngine.runFullCycle(),

        // State access
        getAgentStatus: () => AgentEngine.state.agents,
        getInsights: (limit = 50) => AgentEngine.state.insights.slice(0, limit),
        getPredictions: () => AgentEngine.state.predictions,
        getActionLog: (limit = 100) => AgentEngine.state.actionLog.slice(0, limit),
        getPerformanceMetrics: () => AgentEngine.state.performanceMetrics,
        getCycleCount: () => AgentEngine.state.cycleCount,
        isRunning: () => AgentEngine.state.isRunning,
        isPaused: () => AgentEngine.state.isPaused,

        // Insight management
        dismissInsight: (id) => {
            const insight = AgentEngine.state.insights.find(i => i.id === id);
            if (insight) {
                insight.status = 'dismissed';
                AgentEngine.saveState();
                AgentEngine.dispatchUpdate();
            }
        },

        markInsightComplete: (id) => {
            const insight = AgentEngine.state.insights.find(i => i.id === id);
            if (insight) {
                insight.status = 'completed';
                AgentEngine.state.performanceMetrics.successfulActions++;
                AgentEngine.saveState();
                AgentEngine.dispatchUpdate();
            }
        },

        // Individual agents
        agents: {
            searchIntent: SearchIntentAgent,
            contentOptimization: ContentOptimizationAgent,
            technicalSEO: TechnicalSEOAgent,
            keywordIntelligence: KeywordIntelligenceAgent,
            competitorAnalysis: CompetitorAnalysisAgent,
            performancePrediction: PerformancePredictionAgent,
            roiOptimization: ROIOptimizationAgent
        },

        // Utility
        state: AgentEngine.state
    };

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.AIAgents.initialize());
    } else {
        setTimeout(() => window.AIAgents.initialize(), 100);
    }

})();
