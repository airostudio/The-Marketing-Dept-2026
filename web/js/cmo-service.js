/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CMO SERVICE - Chief Marketing Officer Executive Orchestration
 * Audema Marketing 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Executive-level orchestration service that coordinates all marketing agents
 * and provides strategic insights for the CMO dashboard.
 *
 * Capabilities:
 *   - Executive Dashboard Data (KPIs, ROI, budgets, quarterly goals)
 *   - Strategic Planning (AI-generated strategies, plans, briefs)
 *   - Agent Orchestration (status, cross-channel campaigns, recommendations)
 *   - Reporting (executive reports, board decks, competitive snapshots)
 *   - Persistent Storage (localStorage with 'cmo-' prefix)
 *
 * Integrations:
 *   - window.AIService  (OpenAI / Gemini)
 *   - window.ProjectService (project data)
 *   - window.APP_CONFIG (configuration)
 */

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS & CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const VERSION = '1.0.0';
    const LOG_PREFIX = '[CMO]';

    /** Marketing department identifiers */
    const DEPARTMENTS = ['seo', 'content', 'social', 'paid-media', 'email', 'brand'];

    /** All agent identifiers managed by the CMO */
    const AGENT_IDS = [
        'search-intent', 'content-optimization', 'technical-seo', 'keyword-intelligence',
        'competitor-analysis', 'performance-prediction', 'roi-optimization', 'cross-channel'
    ];

    const STORAGE_PREFIX = 'cmo-';

    /** Default AI generation options by use-case */
    const AI_DEFAULTS = {
        strategy: { maxTokens: 2000, temperature: 0.3 },
        report:   { maxTokens: 2500, temperature: 0.25 },
        creative: { maxTokens: 1500, temperature: 0.5 },
        analysis: { maxTokens: 1800, temperature: 0.3 }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function log(...args)  { console.log(LOG_PREFIX, ...args); }
    function warn(...args) { console.warn(LOG_PREFIX, ...args); }
    function error(...args){ console.error(LOG_PREFIX, ...args); }

    /** @returns {boolean} Whether the AI backend is ready */
    function aiAvailable() {
        return !!(window.AIService && window.AIService.isAvailable());
    }

    /**
     * Send a prompt to the AI service and return the response text.
     * @param {string} prompt - The prompt to send
     * @param {Object} [options] - Generation options (maxTokens, temperature)
     * @returns {Promise<string>}
     */
    async function aiGenerate(prompt, options = {}) {
        if (!aiAvailable()) { warn('AI not available — returning empty result.'); return ''; }
        try {
            const result = await window.AIService.AI.prompt(prompt, {
                maxTokens: options.maxTokens || 2000,
                temperature: options.temperature ?? 0.3
            });
            return result || '';
        } catch (err) { error('AI generation failed:', err); return ''; }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA STORAGE (Supabase via MarketingStore + localStorage cache)
    // ═══════════════════════════════════════════════════════════════════════════

    const Storage = {
        /** Save a JSON-serialisable value (localStorage cache + Supabase persist). */
        save(key, value) {
            try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
            catch (err) { error('Storage save failed for', key, err); }
            // Async persist to Supabase
            if (window.MarketingStore) {
                window.MarketingStore.set('cmo', key, value).catch(function(e) {
                    warn('MarketingStore persist failed:', e.message);
                });
            }
        },
        /** Load a value synchronously (localStorage cache). */
        load(key, fallback = null) {
            try {
                const raw = localStorage.getItem(STORAGE_PREFIX + key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (err) { error('Storage load failed for', key, err); return fallback; }
        },
        /** Load a value from Supabase (async, falls back to localStorage). */
        async loadAsync(key, fallback = null) {
            if (window.MarketingStore) {
                try {
                    const data = await window.MarketingStore.get('cmo', key, null);
                    if (data !== null) {
                        // Update local cache
                        try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data)); }
                        catch (_) { /* ignore */ }
                        return data;
                    }
                } catch (e) { warn('MarketingStore load failed:', e.message); }
            }
            return this.load(key, fallback);
        },
        /** Remove a key. */
        remove(key) {
            localStorage.removeItem(STORAGE_PREFIX + key);
            if (window.MarketingStore) {
                window.MarketingStore.remove('cmo', key).catch(function() {});
            }
        },
        /** List all cmo- keys (without prefix). */
        keys() {
            const out = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(STORAGE_PREFIX)) out.push(k.slice(STORAGE_PREFIX.length));
            }
            return out;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. EXECUTIVE DASHBOARD DATA
    // ═══════════════════════════════════════════════════════════════════════════

    /** Default KPIs per department. @private */
    function _defaultKPIs(dept) {
        const m = {
            'seo':        { organicTraffic: 0, keywordRankings: 0, domainAuthority: 0, backlinks: 0 },
            'content':    { postsPublished: 0, avgEngagement: 0, contentScore: 0, pagesOptimized: 0 },
            'social':     { followers: 0, engagementRate: 0, impressions: 0, shares: 0 },
            'paid-media': { adSpend: 0, roas: 0, cpc: 0, conversions: 0 },
            'email':      { subscribers: 0, openRate: 0, clickRate: 0, conversionRate: 0 },
            'brand':      { brandMentions: 0, sentimentScore: 0, shareOfVoice: 0, nps: 0 }
        };
        return m[dept] || {};
    }

    /**
     * Aggregate KPIs across all marketing departments.
     * @returns {Promise<Object>} Department overview with per-channel KPIs
     */
    async function getDepartmentOverview() {
        log('Generating department overview...');
        const projects = window.ProjectService?.getProjects?.() || [];
        const cached = Storage.load('department-overview', {});
        const overview = {};
        DEPARTMENTS.forEach(dept => {
            overview[dept] = {
                name: dept,
                activeProjects: projects.filter(p => (p.department || '').toLowerCase() === dept).length,
                health: cached[dept]?.health || 'good',
                kpis: cached[dept]?.kpis || _defaultKPIs(dept),
                lastUpdated: new Date().toISOString()
            };
        });
        Storage.save('department-overview', overview);
        return overview;
    }

    /**
     * Calculate overall marketing ROI from all channels.
     * @returns {Promise<Object>} ROI breakdown by channel and aggregate totals
     */
    async function getMarketingROI() {
        log('Calculating marketing ROI...');
        const budgets = Storage.load('budgets', {}), revenue = Storage.load('revenue', {});
        let totalSpend = 0, totalRevenue = 0;
        const channelROI = {};
        DEPARTMENTS.forEach(dept => {
            const spend = budgets[dept] || 0, rev = revenue[dept] || 0;
            totalSpend += spend; totalRevenue += rev;
            channelROI[dept] = { spend, revenue: rev,
                roi: spend > 0 ? ((rev - spend) / spend * 100).toFixed(2) + '%' : 'N/A' };
        });
        const result = { totalSpend, totalRevenue,
            overallROI: totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend * 100).toFixed(2) + '%' : 'N/A',
            channelROI, calculatedAt: new Date().toISOString() };
        Storage.save('roi-snapshot', result);
        return result;
    }

    /**
     * Return current budget distribution and AI-generated recommendations.
     * @returns {Promise<Object>} Budget allocation data and suggestions
     */
    async function getBudgetAllocation() {
        log('Fetching budget allocation...');
        const budgets = Storage.load('budgets', {});
        const total = Object.values(budgets).reduce((s, v) => s + (v || 0), 0);
        const distribution = {};
        DEPARTMENTS.forEach(dept => {
            const amount = budgets[dept] || 0;
            distribution[dept] = { amount, percentage: total > 0 ? ((amount / total) * 100).toFixed(1) + '%' : '0%' };
        });
        let recommendation = '';
        if (total > 0) {
            recommendation = await aiGenerate(
                'As a CMO, review this marketing budget distribution (total $' + total + '):\n' +
                JSON.stringify(distribution, null, 2) +
                '\nProvide 3-5 concise reallocation recommendations to maximise ROI.', AI_DEFAULTS.analysis);
        }
        return { total, distribution, recommendation, updatedAt: new Date().toISOString() };
    }

    /**
     * Track quarterly OKRs and goals.
     * @returns {Promise<Object>} Goals with progress tracking
     */
    async function getQuarterlyGoals() {
        log('Loading quarterly goals...');
        const goals = Storage.load('quarterly-goals', []);
        const now = new Date();
        const currentQuarter = 'Q' + Math.ceil((now.getMonth() + 1) / 3);
        const completed = goals.filter(g => g.status === 'completed').length;
        return {
            quarter: currentQuarter, year: now.getFullYear(), goals,
            summary: goals.length > 0 ? completed + '/' + goals.length + ' goals completed'
                : 'No goals defined yet. Use setQuarterlyGoals() to add them.',
            updatedAt: now.toISOString()
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. STRATEGIC PLANNING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate a comprehensive AI marketing strategy. Cached for 24 hours.
     * @param {Object} businessData - Business context (industry, audience, budget, goals, channels)
     * @returns {Promise<string>} AI-generated strategy document
     */
    async function generateMarketingStrategy(businessData = {}) {
        log('Generating marketing strategy...');
        const cacheKey = 'strategy-' + (businessData.industry || 'general');
        const cached = Storage.load(cacheKey);
        if (cached && Date.now() - cached.timestamp < 86400000) {
            log('Returning cached strategy (< 24 h old).'); return cached.content;
        }
        const prompt = 'You are the CMO of a marketing agency. Create a comprehensive marketing strategy.\n\n' +
            'Business Context:\n' +
            '- Industry: ' + (businessData.industry || 'General') + '\n' +
            '- Target Audience: ' + (businessData.audience || 'Not specified') + '\n' +
            '- Annual Budget: $' + (businessData.budget || 'Not specified') + '\n' +
            '- Primary Goals: ' + (businessData.goals || 'Growth') + '\n' +
            '- Current Channels: ' + (businessData.channels || DEPARTMENTS.join(', ')) + '\n\n' +
            'Provide a detailed strategy covering:\n' +
            '1. Executive Summary\n2. Market Analysis & Positioning\n' +
            '3. Channel Strategy (SEO, Content, Social, Paid Media, Email, Brand)\n' +
            '4. Budget Allocation Recommendations\n5. KPI Targets by Quarter\n' +
            '6. Risk Mitigation\n7. 90-Day Quick Wins\n\nFormat with clear headers and actionable items.';
        const content = await aiGenerate(prompt, AI_DEFAULTS.strategy);
        if (content) Storage.save(cacheKey, { content, timestamp: Date.now() });
        return content;
    }

    /**
     * Generate an AI-powered quarterly marketing plan.
     * @param {string} quarter - e.g. "Q1", "Q2"
     * @param {number} year - Four-digit year
     * @returns {Promise<string>} Quarterly plan document
     */
    async function generateQuarterlyPlan(quarter, year) {
        log('Generating ' + quarter + ' ' + year + ' plan...');
        const goals = Storage.load('quarterly-goals', []);
        const budgets = Storage.load('budgets', {});
        const prompt = 'Create a detailed quarterly marketing plan for ' + quarter + ' ' + year + '.\n\n' +
            'Current Goals: ' + JSON.stringify(goals.slice(0, 5)) + '\n' +
            'Budget: ' + JSON.stringify(budgets) + '\nDepartments: ' + DEPARTMENTS.join(', ') + '\n\n' +
            'Include:\n1. Quarter Theme & Objectives\n2. Monthly Breakdown (Month 1, 2, 3)\n' +
            '3. Campaign Calendar\n4. Resource Allocation\n5. Key Milestones & Deadlines\n' +
            '6. Success Metrics\n7. Contingency Plans';
        const content = await aiGenerate(prompt, AI_DEFAULTS.strategy);
        if (content) Storage.save('plan-' + quarter + '-' + year, { content, createdAt: new Date().toISOString() });
        return content;
    }

    /**
     * Generate an AI campaign brief for cross-channel execution.
     * @param {Object} objectives - Campaign objectives (goal, audience, budget, duration, channels, message)
     * @returns {Promise<string>} Campaign brief document
     */
    async function generateCampaignBrief(objectives = {}) {
        log('Generating campaign brief...');
        const prompt = 'Create a cross-channel campaign brief for a marketing team.\n\n' +
            'Campaign Objective: ' + (objectives.goal || 'Brand awareness and lead generation') + '\n' +
            'Target Audience: ' + (objectives.audience || 'Not specified') + '\n' +
            'Budget: $' + (objectives.budget || 'Flexible') + '\n' +
            'Duration: ' + (objectives.duration || '4 weeks') + '\n' +
            'Channels: ' + (objectives.channels || DEPARTMENTS.join(', ')) + '\n' +
            'Key Message: ' + (objectives.message || 'Not specified') + '\n\n' +
            'Provide:\n1. Campaign Overview & Big Idea\n2. Target Audience Persona\n' +
            '3. Channel-Specific Tactics (SEO, Content, Social, Paid, Email, Brand)\n' +
            '4. Creative Requirements\n5. Timeline & Milestones\n' +
            '6. Budget Breakdown\n7. KPIs & Measurement Plan';
        return await aiGenerate(prompt, AI_DEFAULTS.creative);
    }

    /**
     * Analyse market opportunities in a given industry using AI.
     * @param {string} industry - Industry or market vertical
     * @returns {Promise<string>} Market opportunity analysis
     */
    async function analyzeMarketOpportunities(industry) {
        log('Analysing market opportunities for: ' + industry);
        const prompt = 'As a CMO, analyse market opportunities in the "' + industry + '" industry.\n\n' +
            'Provide:\n1. Market Size & Growth Trends\n2. Key Opportunities (top 5, ranked)\n' +
            '3. Competitive Landscape Summary\n4. Underserved Segments\n' +
            '5. Digital Marketing Gaps to Exploit\n6. Recommended Entry Strategy\n' +
            '7. Risk Assessment\n\nFocus on actionable, data-informed insights.';
        const content = await aiGenerate(prompt, AI_DEFAULTS.analysis);
        if (content) {
            Storage.save('opportunity-' + industry.toLowerCase().replace(/\s+/g, '-'),
                { industry, content, analysedAt: new Date().toISOString() });
        }
        return content;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. AGENT ORCHESTRATION
    // ═══════════════════════════════════════════════════════════════════════════

    /** Human-readable agent names. @private */
    const AGENT_NAMES = {
        'search-intent': 'Search Intent Agent', 'content-optimization': 'Content Optimization Agent',
        'technical-seo': 'Technical SEO Agent', 'keyword-intelligence': 'Keyword Intelligence Agent',
        'competitor-analysis': 'Competitor Analysis Agent', 'performance-prediction': 'Performance Prediction Agent',
        'roi-optimization': 'ROI Optimization Agent', 'cross-channel': 'Cross-Channel Coordinator'
    };

    /**
     * Get the live status of all 8 marketing agents.
     * @returns {Object[]} Array of agent status objects
     */
    function getAgentStatuses() {
        log('Collecting agent statuses...');
        const svc = window.AIAgentsService || null;
        return AGENT_IDS.map(id => {
            const s = svc?.getAgentStatus?.(id);
            return { id, name: AGENT_NAMES[id] || id, status: s?.status || 'idle',
                lastRun: s?.lastRun || null, actionsCompleted: s?.actionsCompleted || 0,
                health: s?.health || 'unknown' };
        });
    }

    /** Default tasks per channel. @private */
    const CHANNEL_TASKS = {
        'seo':        ['Keyword research for campaign terms', 'On-page optimisation', 'Technical audit', 'Link building outreach'],
        'content':    ['Blog post creation', 'Landing page copy', 'Case study development', 'Content calendar update'],
        'social':     ['Social calendar creation', 'Community engagement plan', 'Influencer outreach', 'Hashtag strategy'],
        'paid-media': ['Ad creative development', 'Audience targeting setup', 'Bid strategy configuration', 'A/B test plan'],
        'email':      ['Email sequence design', 'List segmentation', 'Template creation', 'Automation workflow setup'],
        'brand':      ['Brand guideline review', 'Messaging alignment check', 'Visual asset creation', 'PR pitch drafting']
    };

    /**
     * Orchestrate a campaign across multiple agents and channels.
     * @param {Object} campaignConfig - { name, channels, objective, budget, startDate, endDate }
     * @returns {Promise<Object>} Campaign execution plan with per-agent tasks
     */
    async function runCrossChannelCampaign(campaignConfig = {}) {
        log('Orchestrating cross-channel campaign:', campaignConfig.name || 'Untitled');
        const channels = campaignConfig.channels || DEPARTMENTS;
        const plan = {
            id: 'campaign-' + Date.now(), name: campaignConfig.name || 'Untitled Campaign',
            objective: campaignConfig.objective || 'awareness', budget: campaignConfig.budget || 0,
            startDate: campaignConfig.startDate || new Date().toISOString(),
            endDate: campaignConfig.endDate || null, status: 'planning',
            agentTasks: {}, createdAt: new Date().toISOString()
        };
        channels.forEach(ch => {
            plan.agentTasks[ch] = { channel: ch, status: 'queued',
                tasks: CHANNEL_TASKS[ch] || ['Research', 'Plan', 'Execute', 'Measure'] };
        });
        plan.coordinationBrief = await aiGenerate(
            'Given this cross-channel campaign configuration:\n' +
            JSON.stringify(campaignConfig, null, 2) + '\n\n' +
            'Provide a short coordination brief (5-8 bullet points) ensuring all channels work together cohesively.',
            AI_DEFAULTS.creative);
        plan.status = 'ready';
        const campaigns = Storage.load('campaigns', []);
        campaigns.push(plan);
        Storage.save('campaigns', campaigns);
        log('Campaign plan created:', plan.id);
        return plan;
    }

    /**
     * Collect AI-powered recommendations from all agents.
     * @returns {Promise<Object>} Aggregated recommendations keyed by department
     */
    async function getAgentRecommendations() {
        log('Gathering agent recommendations...');
        const overview = await getDepartmentOverview();
        const prompt = 'As a CMO reviewing these department metrics:\n' +
            JSON.stringify(overview, null, 2) + '\n\n' +
            'For each department (' + DEPARTMENTS.join(', ') + '), provide the single highest-impact recommendation.\n' +
            'Format: one bullet per department, starting with the department name in brackets.';
        const aiRecs = await aiGenerate(prompt, AI_DEFAULTS.analysis);
        return { recommendations: aiRecs, agentCount: AGENT_IDS.length, generatedAt: new Date().toISOString() };
    }

    /**
     * AI-prioritised action items across all departments.
     * @returns {Promise<Object>} Prioritised action list with metadata
     */
    async function prioritizeActions() {
        log('Prioritising actions across departments...');
        const overview = await getDepartmentOverview();
        const roi = await getMarketingROI();
        const prompt = 'As a CMO, you have these department metrics:\n' +
            JSON.stringify(overview, null, 2) + '\n\nAnd this ROI data:\n' +
            JSON.stringify(roi, null, 2) + '\n\n' +
            'List the top 10 prioritised actions across all departments, ranked by expected impact.\n' +
            'For each: priority number, department, action, expected impact, effort level (low/medium/high).';
        const actions = await aiGenerate(prompt, AI_DEFAULTS.strategy);
        return { actions, basedOn: { departments: DEPARTMENTS.length, dataPoints: Object.keys(overview).length },
            generatedAt: new Date().toISOString() };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. REPORTING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate an AI executive summary report.
     * @param {Object} [dateRange] - { start, end } ISO date strings
     * @returns {Promise<Object>} Report object with summary and sections
     */
    async function generateExecutiveReport(dateRange = {}) {
        const start = dateRange.start || new Date(Date.now() - 30 * 86400000).toISOString();
        const end   = dateRange.end   || new Date().toISOString();
        log('Generating executive report (' + start + ' to ' + end + ')...');
        const overview = await getDepartmentOverview();
        const roi = await getMarketingROI();
        const prompt = 'Write an executive marketing report for the period ' + start + ' to ' + end + '.\n\n' +
            'Department Data:\n' + JSON.stringify(overview, null, 2) + '\n\n' +
            'ROI Data:\n' + JSON.stringify(roi, null, 2) + '\n\n' +
            'Structure:\n1. Executive Summary (3-4 sentences)\n2. Key Wins\n3. Areas of Concern\n' +
            '4. Channel Performance Summary\n5. Budget Utilisation\n6. Recommendations for Next Period';
        const content = await aiGenerate(prompt, AI_DEFAULTS.report);
        const report = { title: 'Executive Marketing Report', period: { start, end },
            content, generatedAt: new Date().toISOString() };
        Storage.save('report-latest', report);
        return report;
    }

    /**
     * Generate board-ready presentation data for a given quarter.
     * @param {string} quarter - e.g. "Q1"
     * @returns {Promise<Object>} Board deck data with slide content
     */
    async function generateBoardDeck(quarter) {
        const year = new Date().getFullYear();
        log('Generating board deck for ' + quarter + ' ' + year + '...');
        const roi = await getMarketingROI();
        const goals = await getQuarterlyGoals();
        const prompt = 'Create board presentation content for the marketing department, ' + quarter + ' ' + year + '.\n\n' +
            'ROI Data: ' + JSON.stringify(roi, null, 2) + '\n' +
            'Goals: ' + JSON.stringify(goals, null, 2) + '\n\n' +
            'Generate content for these slides:\n' +
            '1. Title Slide (tagline + key metric)\n2. Quarter Highlights (top 3)\n' +
            '3. Financial Summary (spend, revenue, ROI)\n4. Channel Performance (one line per channel)\n' +
            '5. Goal Progress (vs targets)\n6. Competitive Position\n' +
            '7. Next Quarter Priorities\n8. Resource Requests\n\nKeep each slide concise - bullet points only.';
        const content = await aiGenerate(prompt, AI_DEFAULTS.report);
        const deck = { title: 'Marketing Board Deck - ' + quarter + ' ' + year,
            quarter, year, content, generatedAt: new Date().toISOString() };
        Storage.save('board-deck-' + quarter + '-' + year, deck);
        return deck;
    }

    /**
     * Build a competitive intelligence snapshot using available data and AI.
     * @returns {Promise<Object>} Competitive snapshot with analysis
     */
    async function getCompetitiveSnapshot() {
        log('Building competitive snapshot...');
        const projects = window.ProjectService?.getProjects?.() || [];
        const competitors = projects
            .filter(p => p.competitors && p.competitors.length)
            .flatMap(p => p.competitors).slice(0, 5);
        const prompt = 'As a CMO, provide a competitive intelligence snapshot.\n' +
            (competitors.length > 0 ? 'Known competitors: ' + competitors.join(', ') : 'No specific competitors identified yet.') +
            '\n\nInclude:\n1. Market Position Assessment\n2. Competitive Threats (top 3)\n' +
            '3. Differentiation Opportunities\n4. Recommended Defensive Actions\n' +
            '5. Offensive Strategies to Gain Share\n\nBe concise and strategic.';
        const content = await aiGenerate(prompt, AI_DEFAULTS.analysis);
        const snapshot = { competitors, analysis: content, generatedAt: new Date().toISOString() };
        Storage.save('competitive-snapshot', snapshot);
        return snapshot;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC SETTERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Save quarterly goals to persistent storage.
     * @param {Object[]} goals - Array of { title, target, current, status }
     */
    function setQuarterlyGoals(goals) {
        if (!Array.isArray(goals)) { warn('setQuarterlyGoals expects an array.'); return; }
        Storage.save('quarterly-goals', goals);
        log('Quarterly goals saved:', goals.length, 'goals');
    }

    /**
     * Update budget allocations by department.
     * @param {Object} budgets - Map of department id to dollar amount
     */
    function setBudgets(budgets) {
        if (typeof budgets !== 'object' || budgets === null) { warn('setBudgets expects an object.'); return; }
        Storage.save('budgets', budgets);
        log('Budgets updated:', budgets);
    }

    /**
     * Record revenue figures by department.
     * @param {Object} revenue - Map of department id to revenue amount
     */
    function setRevenue(revenue) {
        if (typeof revenue !== 'object' || revenue === null) { warn('setRevenue expects an object.'); return; }
        Storage.save('revenue', revenue);
        log('Revenue data updated:', revenue);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════════════════════════

    window.CMOService = {
        version: VERSION,

        // Executive Dashboard
        getDepartmentOverview,
        getMarketingROI,
        getBudgetAllocation,
        getQuarterlyGoals,

        // Strategic Planning
        generateMarketingStrategy,
        generateQuarterlyPlan,
        generateCampaignBrief,
        analyzeMarketOpportunities,

        // Agent Orchestration
        getAgentStatuses,
        runCrossChannelCampaign,
        getAgentRecommendations,
        prioritizeActions,

        // Reporting
        generateExecutiveReport,
        generateBoardDeck,
        getCompetitiveSnapshot,

        // Setters
        setQuarterlyGoals,
        setBudgets,
        setRevenue,

        // Storage (exposed for advanced use)
        Storage
    };

    log('CMO Service v' + VERSION + ' initialised. Departments: ' + DEPARTMENTS.length + ', Agents: ' + AGENT_IDS.length);
    log('AI available:', aiAvailable());

})();
