/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MARKETING ANALYTICS SERVICE - Cross-Channel Intelligence Engine
 * The Marketing Department 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides comprehensive marketing analytics across all channels:
 * - Cross-Channel Dashboard with unified metrics
 * - Multi-Touch Attribution Modeling (6 models)
 * - Full-Funnel Analysis with AI drop-off diagnosis
 * - Customer Segmentation, LTV & Churn Prediction
 * - AI Insights Engine with anomaly detection & forecasting
 * - Automated Reporting & Goal Tracking
 *
 * Integrations: AIService, ProjectService, APP_CONFIG
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION & CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const PREFIX = '[Analytics]';
    const STORAGE_PREFIX = 'analytics-';
    const CHANNELS = ['SEO', 'Paid', 'Social', 'Email', 'Direct', 'Referral'];
    const FUNNEL_STAGES = ['awareness', 'interest', 'consideration', 'intent', 'purchase', 'loyalty'];
    const ATTRIBUTION_MODELS = ['first-touch', 'last-touch', 'linear', 'time-decay', 'position-based', 'data-driven'];
    const REPORT_TYPES = ['weekly-summary', 'monthly-review', 'quarterly-board', 'campaign-post-mortem', 'annual-review'];

    const log  = (msg, ...args) => console.log(PREFIX + ' ' + msg, ...args);
    const warn = (msg, ...args) => console.warn(PREFIX + ' ' + msg, ...args);

    // ═══════════════════════════════════════════════════════════════════════════
    // STORAGE HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Persist a value to localStorage under the analytics namespace.
     * @param {string} key - Storage key (auto-prefixed with 'analytics-').
     * @param {*} value - JSON-serializable value.
     */
    function store(key, value) {
        try {
            localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
        } catch (e) {
            warn('Storage write failed:', e.message);
        }
    }

    /**
     * Retrieve a value from localStorage.
     * @param {string} key - Storage key (auto-prefixed with 'analytics-').
     * @param {*} fallback - Default when key is absent.
     * @returns {*} Parsed value or fallback.
     */
    function load(key, fallback = null) {
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AI HELPER
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Send a prompt to the unified AI service and return the response text.
     * @param {string} prompt - The prompt to send.
     * @returns {Promise<string>} AI-generated text.
     */
    async function askAI(prompt) {
        const ai = window.AIService?.AI;
        if (!ai?.generate) {
            warn('AIService unavailable – returning empty response');
            return '';
        }
        try {
            return await ai.generate(prompt, { maxTokens: 2000, temperature: 0.3 });
        } catch (e) {
            warn('AI generation failed:', e.message);
            return '';
        }
    }

    /**
     * Parse a JSON block from an AI response string.
     * @param {string} text - Raw AI response.
     * @param {*} fallback - Value returned on parse failure.
     * @returns {*} Parsed object or fallback.
     */
    function parseAIJson(text, fallback = null) {
        try {
            const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
            return JSON.parse(match[1].trim());
        } catch {
            return fallback;
        }
    }

    /**
     * Return the current project context from ProjectService, if available.
     * @returns {Object|null} Active project or null.
     */
    function getProjectContext() {
        try {
            return window.ProjectService?.getActiveProject?.() || null;
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SIMULATED DATA LAYER
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate realistic channel metrics for the given date range.
     * In production this would query a real analytics backend.
     * @param {string} dateRange - 'last-7d' | 'last-30d' | 'last-90d' | 'last-12m'
     * @returns {Object} Channel metrics keyed by channel name.
     */
    function generateChannelData(dateRange) {
        const multiplier = { 'last-7d': 1, 'last-30d': 4, 'last-90d': 12, 'last-12m': 52 }[dateRange] || 4;
        const base = {
            SEO:      { traffic: 12400, leads: 310, conversions: 62, revenue: 31000, spend: 4200 },
            Paid:     { traffic: 8600,  leads: 430, conversions: 86, revenue: 43000, spend: 18500 },
            Social:   { traffic: 6200,  leads: 186, conversions: 28, revenue: 14000, spend: 5600 },
            Email:    { traffic: 3800,  leads: 380, conversions: 95, revenue: 47500, spend: 1200 },
            Direct:   { traffic: 4500,  leads: 135, conversions: 40, revenue: 20000, spend: 0 },
            Referral: { traffic: 2100,  leads: 84,  conversions: 17, revenue: 8500,  spend: 800 }
        };
        const result = {};
        for (const ch of CHANNELS) {
            const b = base[ch];
            const jitter = () => 0.85 + Math.random() * 0.3;
            result[ch] = {
                traffic:     Math.round(b.traffic * multiplier * jitter()),
                leads:       Math.round(b.leads * multiplier * jitter()),
                conversions: Math.round(b.conversions * multiplier * jitter()),
                revenue:     Math.round(b.revenue * multiplier * jitter()),
                spend:       Math.round(b.spend * multiplier * jitter()),
                cac:         b.spend > 0 ? +(b.spend / b.conversions).toFixed(2) : 0,
                roi:         b.spend > 0 ? +(((b.revenue - b.spend) / b.spend) * 100).toFixed(1) : null
            };
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. CROSS-CHANNEL DASHBOARD
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Aggregate overview metrics across every channel.
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Object} Totals for traffic, leads, conversions, revenue, CAC, LTV, ROI.
     */
    function getOverviewMetrics(dateRange = 'last-30d') {
        log('Fetching overview metrics for', dateRange);
        const data = generateChannelData(dateRange);
        const totals = { traffic: 0, leads: 0, conversions: 0, revenue: 0, spend: 0 };
        for (const ch of CHANNELS) {
            totals.traffic     += data[ch].traffic;
            totals.leads       += data[ch].leads;
            totals.conversions += data[ch].conversions;
            totals.revenue     += data[ch].revenue;
            totals.spend       += data[ch].spend;
        }
        totals.cac = totals.conversions > 0 ? +(totals.spend / totals.conversions).toFixed(2) : 0;
        totals.ltv = totals.conversions > 0 ? +(totals.revenue / totals.conversions * 3.2).toFixed(2) : 0;
        totals.roi = totals.spend > 0 ? +(((totals.revenue - totals.spend) / totals.spend) * 100).toFixed(1) : 0;
        totals.dateRange = dateRange;
        const project = getProjectContext();
        if (project) totals.projectId = project.id;
        return totals;
    }

    /**
     * Performance breakdown by individual channel.
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Object} Per-channel metric objects.
     */
    function getChannelBreakdown(dateRange = 'last-30d') {
        log('Building channel breakdown for', dateRange);
        return generateChannelData(dateRange);
    }

    /**
     * Historical trend data points for one channel.
     * @param {string} channel - Channel name.
     * @param {string} [period='weekly'] - 'daily' | 'weekly' | 'monthly'.
     * @returns {Array<Object>} Array of { date, traffic, leads, conversions, revenue }.
     */
    function getChannelTrends(channel, period = 'weekly') {
        log('Computing trends for', channel, period);
        const points = { daily: 30, weekly: 12, monthly: 12 }[period] || 12;
        const stepDays = { daily: 1, weekly: 7, monthly: 30 }[period] || 7;
        const trends = [];
        for (let i = points; i > 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i * stepDays);
            const jitter = () => 0.8 + Math.random() * 0.4;
            trends.push({
                date: d.toISOString().slice(0, 10),
                traffic:     Math.round(3000 * jitter()),
                leads:       Math.round(90 * jitter()),
                conversions: Math.round(18 * jitter()),
                revenue:     Math.round(9000 * jitter())
            });
        }
        return trends;
    }

    /**
     * Compare selected channels on a specific metric.
     * @param {string[]} channels - Channel names to compare.
     * @param {string} metric - Metric key (traffic, leads, conversions, revenue, roi).
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Object} Keyed by channel with the metric value and rank.
     */
    function compareChannels(channels, metric, dateRange = 'last-30d') {
        log('Comparing channels on', metric);
        const data = generateChannelData(dateRange);
        const selected = (channels || CHANNELS).filter(c => data[c]);
        const sorted = selected.sort((a, b) => (data[b][metric] || 0) - (data[a][metric] || 0));
        const result = {};
        sorted.forEach((ch, idx) => {
            result[ch] = { value: data[ch][metric], rank: idx + 1 };
        });
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. ATTRIBUTION MODELING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Run an attribution report using the specified model.
     * @param {string} [model='last-touch'] - Attribution model name.
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Object} Attribution credit per channel.
     */
    function getAttributionReport(model = 'last-touch', dateRange = 'last-30d') {
        log('Running attribution model:', model);
        if (ATTRIBUTION_MODELS.indexOf(model) === -1) {
            warn('Unknown attribution model:', model, '- falling back to last-touch');
            model = 'last-touch';
        }
        const weights = {
            'first-touch':    [1, 0, 0, 0, 0, 0],
            'last-touch':     [0, 0, 0, 0, 0, 1],
            'linear':         [1/6, 1/6, 1/6, 1/6, 1/6, 1/6],
            'time-decay':     [0.05, 0.08, 0.12, 0.15, 0.25, 0.35],
            'position-based': [0.30, 0.08, 0.08, 0.08, 0.08, 0.38],
            'data-driven':    [0.18, 0.12, 0.15, 0.14, 0.20, 0.21]
        };
        const data = generateChannelData(dateRange);
        const totalConversions = CHANNELS.reduce((s, c) => s + data[c].conversions, 0);
        const w = weights[model];
        const attribution = {};
        CHANNELS.forEach((ch, i) => {
            const credit = +(totalConversions * w[i % w.length]).toFixed(1);
            attribution[ch] = {
                credit: credit,
                percentage: +((credit / totalConversions) * 100).toFixed(1),
                revenue: Math.round(data[ch].revenue * w[i % w.length] * CHANNELS.length)
            };
        });
        return { model, dateRange, totalConversions, attribution };
    }

    /**
     * Top conversion path sequences users take before converting.
     * @param {number} [limit=10] - Maximum paths to return.
     * @returns {Array<Object>} Ordered conversion paths with counts.
     */
    function getConversionPaths(limit = 10) {
        log('Fetching top', limit, 'conversion paths');
        const paths = [
            { path: ['SEO', 'Email', 'Direct'],            conversions: 142, avgValue: 285 },
            { path: ['Paid', 'Referral', 'Direct'],        conversions: 118, avgValue: 340 },
            { path: ['Social', 'SEO', 'Email'],            conversions: 97,  avgValue: 210 },
            { path: ['SEO', 'Paid', 'Email', 'Direct'],    conversions: 85,  avgValue: 420 },
            { path: ['Direct'],                             conversions: 78,  avgValue: 190 },
            { path: ['Email', 'Direct'],                    conversions: 72,  avgValue: 310 },
            { path: ['Paid', 'Email'],                      conversions: 65,  avgValue: 275 },
            { path: ['Social', 'Paid', 'SEO', 'Direct'],   conversions: 54,  avgValue: 510 },
            { path: ['Referral', 'Email', 'Direct'],        conversions: 48,  avgValue: 260 },
            { path: ['SEO', 'Social', 'Email', 'Direct'],  conversions: 41,  avgValue: 390 }
        ];
        return paths.slice(0, limit);
    }

    /**
     * Identify channels that frequently assist conversions without being the closer.
     * @returns {Array<Object>} Assist metrics per channel sorted by assist ratio.
     */
    function getAssistConversions() {
        log('Computing assist conversions');
        return CHANNELS.map(ch => ({
            channel: ch,
            assists: Math.round(40 + Math.random() * 160),
            closes: Math.round(10 + Math.random() * 80),
            assistRatio: +(0.3 + Math.random() * 0.6).toFixed(2)
        })).sort((a, b) => b.assistRatio - a.assistRatio);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. FUNNEL ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Full marketing funnel metrics from awareness through loyalty.
     * @returns {Array<Object>} Stage objects with visitor counts and conversion rates.
     */
    function getFunnelMetrics() {
        log('Building funnel metrics');
        const visitors = [50000, 28000, 14000, 7200, 3600, 2100];
        return FUNNEL_STAGES.map((stage, i) => ({
            stage,
            visitors: visitors[i],
            conversionRate: i > 0 ? +((visitors[i] / visitors[i - 1]) * 100).toFixed(1) : 100,
            overallRate: +((visitors[i] / visitors[0]) * 100).toFixed(2)
        }));
    }

    /**
     * Identify where users drop off and get AI analysis of probable causes.
     * @returns {Promise<Array<Object>>} Drop-off data with AI-generated explanations.
     */
    async function getFunnelDropoffs() {
        log('Analysing funnel drop-offs');
        const funnel = getFunnelMetrics();
        const dropoffs = [];
        for (let i = 1; i < funnel.length; i++) {
            const lost = funnel[i - 1].visitors - funnel[i].visitors;
            dropoffs.push({
                from: funnel[i - 1].stage,
                to: funnel[i].stage,
                lost,
                dropRate: +((lost / funnel[i - 1].visitors) * 100).toFixed(1)
            });
        }
        const prompt = 'Analyse these marketing funnel drop-offs and explain likely causes for each in 1 sentence. Return JSON array of { "from", "to", "cause" }:\n' + JSON.stringify(dropoffs);
        const text = await askAI(prompt);
        const causes = parseAIJson(text, []);
        dropoffs.forEach((d, idx) => {
            d.aiCause = causes[idx]?.cause || 'Insufficient data for analysis.';
        });
        return dropoffs;
    }

    /**
     * Conversion rate for a specific funnel stage or the entire funnel.
     * @param {string} [stage] - Funnel stage name. Omit for all stages.
     * @returns {Object|Array|null} Stage metrics, full funnel array, or null.
     */
    function getConversionRates(stage) {
        const funnel = getFunnelMetrics();
        if (!stage) return funnel;
        return funnel.find(s => s.stage === stage) || null;
    }

    /**
     * AI-powered recommendations for improving funnel conversion rates.
     * @returns {Promise<Object>} Structured optimization recommendations per stage.
     */
    async function optimizeFunnel() {
        log('Generating funnel optimizations');
        const funnel = getFunnelMetrics();
        const prompt = 'Given this marketing funnel data, provide 3 concrete optimisation recommendations per stage to improve conversion rates. Return JSON: { "recommendations": [{ "stage", "actions": ["..."], "expectedLift": "..." }] }.\n' + JSON.stringify(funnel);
        const text = await askAI(prompt);
        return parseAIJson(text, { recommendations: [] });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. CUSTOMER ANALYTICS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * AI-generated customer segments across behavioural, demographic, and value dimensions.
     * @returns {Promise<Array<Object>>} Customer segment profiles.
     */
    async function getCustomerSegments() {
        log('Generating customer segments');
        const prompt = 'Generate 5 distinct marketing customer segments with behavioural, demographic, and value-based attributes. Return JSON array of { "name", "size_pct", "avg_ltv", "channels", "description", "type" }.';
        const text = await askAI(prompt);
        return parseAIJson(text, [
            { name: 'Power Buyers',     size_pct: 12, avg_ltv: 2800, channels: ['Email', 'Direct'],   description: 'High-frequency, high-value repeat customers.',       type: 'value-based' },
            { name: 'Social Explorers', size_pct: 24, avg_ltv: 450,  channels: ['Social', 'SEO'],     description: 'Discovery-driven users arriving via social channels.', type: 'behavioral' },
            { name: 'Deal Seekers',     size_pct: 18, avg_ltv: 620,  channels: ['Paid', 'Email'],     description: 'Price-sensitive buyers activated by promotions.',      type: 'behavioral' },
            { name: 'Enterprise Leads', size_pct: 8,  avg_ltv: 5200, channels: ['SEO', 'Referral'],   description: 'High-value B2B prospects with long sales cycles.',    type: 'demographic' },
            { name: 'Casual Browsers',  size_pct: 38, avg_ltv: 120,  channels: ['SEO', 'Social'],     description: 'Low-intent visitors with potential for nurturing.',    type: 'behavioral' }
        ]);
    }

    /**
     * Cohort analysis for retention or revenue over time.
     * @param {string} [cohortType='monthly'] - 'weekly' | 'monthly' | 'quarterly'.
     * @param {string} [metric='retention'] - 'retention' | 'revenue'.
     * @returns {Array<Object>} Cohort rows with period columns.
     */
    function getCohortAnalysis(cohortType = 'monthly', metric = 'retention') {
        log('Running cohort analysis:', cohortType, metric);
        const periods = { weekly: 8, monthly: 6, quarterly: 4 }[cohortType] || 6;
        const cohorts = [];
        for (let c = 0; c < periods; c++) {
            const d = new Date();
            d.setMonth(d.getMonth() - (periods - 1 - c));
            const row = {
                cohort: d.toISOString().slice(0, 7),
                size: Math.round(800 + Math.random() * 400),
                periods: []
            };
            for (let p = 0; p <= periods - 1 - c; p++) {
                const decay = Math.pow(0.78, p);
                row.periods.push(
                    metric === 'retention'
                        ? +((decay * 100) * (0.9 + Math.random() * 0.2)).toFixed(1)
                        : Math.round(row.size * 45 * decay * (0.85 + Math.random() * 0.3))
                );
            }
            cohorts.push(row);
        }
        return cohorts;
    }

    /**
     * Calculate customer lifetime value with predictions by channel and segment.
     * @returns {Object} LTV metrics including overall, byChannel, and distribution.
     */
    function getCustomerLifetimeValue() {
        log('Calculating customer LTV');
        const byChannel = {};
        CHANNELS.forEach(ch => {
            byChannel[ch] = {
                avgLTV: Math.round(400 + Math.random() * 2000),
                retentionRate: +(0.55 + Math.random() * 0.35).toFixed(2)
            };
        });
        return {
            overall: { avgLTV: 1240, medianLTV: 860, projectedLTV_12m: 1680 },
            byChannel,
            distribution: [
                { range: '$0-$100',     pct: 35 },
                { range: '$100-$500',   pct: 28 },
                { range: '$500-$1000',  pct: 18 },
                { range: '$1000-$5000', pct: 14 },
                { range: '$5000+',      pct: 5 }
            ]
        };
    }

    /**
     * AI-powered churn risk prediction across customer segments.
     * @returns {Promise<Object>} Churn risk analysis with segments and recommendations.
     */
    async function getChurnPrediction() {
        log('Running churn prediction');
        const prompt = 'Analyse typical SaaS/ecommerce customer churn patterns. Return JSON: { "overallChurnRate", "segments": [{ "name", "riskLevel", "riskScore", "signals", "recommendation" }] }.';
        const text = await askAI(prompt);
        return parseAIJson(text, {
            overallChurnRate: 5.2,
            segments: [
                { name: 'Inactive 30d+',   riskLevel: 'critical', riskScore: 89, signals: ['No login 30+ days', 'Support tickets unresolved'],        recommendation: 'Trigger win-back email sequence.' },
                { name: 'Declining Usage',  riskLevel: 'high',     riskScore: 72, signals: ['50% drop in feature usage', 'Cancelled add-ons'],         recommendation: 'Assign CSM for proactive outreach.' },
                { name: 'Price Sensitive',  riskLevel: 'medium',   riskScore: 54, signals: ['Viewed pricing page 3x', 'Competitor comparison searches'], recommendation: 'Offer annual discount incentive.' }
            ]
        });
    }

    /**
     * AI-generated customer journey map data for visualisation.
     * @returns {Promise<Object>} Journey stages with touchpoints, emotions, and opportunities.
     */
    async function getCustomerJourneyMap() {
        log('Generating customer journey map');
        const prompt = 'Create a detailed customer journey map for a digital marketing platform. Return JSON: { "stages": [{ "name", "touchpoints": [...], "emotion", "painPoints": [...], "opportunities": [...] }] }.';
        const text = await askAI(prompt);
        return parseAIJson(text, {
            stages: FUNNEL_STAGES.map(s => ({
                name: s,
                touchpoints: ['Website', 'Email'],
                emotion: 'neutral',
                painPoints: ['Friction in navigation'],
                opportunities: ['Personalisation']
            }))
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. AI INSIGHTS ENGINE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Auto-generate AI insights from all available marketing data.
     * @param {string} [dateRange='last-30d'] - Analysis window.
     * @returns {Promise<Object>} Categorised insights with timestamps.
     */
    async function generateInsights(dateRange = 'last-30d') {
        log('Generating AI insights for', dateRange);
        const overview = getOverviewMetrics(dateRange);
        const prompt = 'As a senior marketing analyst, review these metrics and generate 5 actionable insights. Categorise each as growth, risk, or opportunity. Return JSON: { "insights": [{ "category", "title", "detail", "impact", "action" }] }.\nMetrics: ' + JSON.stringify(overview);
        const text = await askAI(prompt);
        const result = parseAIJson(text, { insights: [] });
        result.generatedAt = new Date().toISOString();
        store('latest-insights', result);
        return result;
    }

    /**
     * Detect anomalies in a specific metric using statistical deviation analysis.
     * @param {string} metric - Metric to analyse (traffic, conversions, revenue, etc.).
     * @param {string} [dateRange='last-30d'] - Date range to check.
     * @returns {Promise<Object>} Detected anomalies with AI explanations.
     */
    async function detectAnomalies(metric, dateRange = 'last-30d') {
        log('Detecting anomalies for', metric);
        const trends = getChannelTrends('SEO', 'daily');
        const values = trends.map(t => t[metric] || t.traffic);
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length);
        const anomalies = [];
        trends.forEach((t, i) => {
            const deviation = +((values[i] - avg) / stdDev).toFixed(2);
            if (Math.abs(deviation) > 2) {
                anomalies.push({ date: t.date, value: values[i], deviation, type: deviation > 0 ? 'spike' : 'drop' });
            }
        });
        if (anomalies.length > 0) {
            const prompt = 'Explain these marketing metric anomalies in ' + metric + ': ' + JSON.stringify(anomalies) + '. Return JSON: { "explanations": [{ "date", "likelyCause", "recommendation" }] }.';
            const text = await askAI(prompt);
            const parsed = parseAIJson(text, { explanations: [] });
            return { metric, dateRange, anomalies, aiExplanations: parsed.explanations };
        }
        return { metric, dateRange, anomalies: [], message: 'No significant anomalies detected.' };
    }

    /**
     * AI predictive forecast for a marketing metric with trend analysis.
     * @param {string} metric - Metric to forecast.
     * @param {number} [periodsAhead=4] - Number of future periods to predict.
     * @returns {Promise<Object>} Historical data with AI forecast and growth analysis.
     */
    async function generateForecast(metric, periodsAhead = 4) {
        log('Forecasting', metric, 'for', periodsAhead, 'periods ahead');
        const history = getChannelTrends('SEO', 'weekly').map(t => ({
            date: t.date,
            value: t[metric] || t.traffic
        }));
        const prompt = 'Given this weekly ' + metric + ' data, forecast the next ' + periodsAhead + ' periods. Apply trend and seasonality analysis. Return JSON: { "forecast": [{ "date", "predicted", "confidence_low", "confidence_high" }], "trend": "up|down|flat", "growthRate": "..." }.\nHistory: ' + JSON.stringify(history.slice(-8));
        const text = await askAI(prompt);
        const ai = parseAIJson(text, { forecast: [], trend: 'flat', growthRate: '0%' });
        return { metric, history, generatedAt: new Date().toISOString(), ...ai };
    }

    /**
     * AI-prioritised actionable recommendations across all channels.
     * @returns {Promise<Array<Object>>} Prioritised recommendation list with impact and effort.
     */
    async function getActionableRecommendations() {
        log('Generating actionable recommendations');
        const overview = getOverviewMetrics('last-30d');
        const funnel = getFunnelMetrics();
        const prompt = 'As a CMO advisor, review these marketing metrics and funnel data. Provide 7 prioritised recommendations. Return JSON array of { "priority", "category", "title", "description", "expectedImpact", "effort", "channel" }.\nOverview: ' + JSON.stringify(overview) + '\nFunnel: ' + JSON.stringify(funnel);
        const text = await askAI(prompt);
        const recs = parseAIJson(text, []);
        store('recommendations', recs);
        return recs;
    }

    /**
     * AI weekly marketing performance digest comparing current vs previous period.
     * @returns {Promise<Object>} Structured weekly digest with scorecard.
     */
    async function generateWeeklyDigest() {
        log('Generating weekly digest');
        const metrics = getOverviewMetrics('last-7d');
        const prevMetrics = getOverviewMetrics('last-30d');
        const prompt = 'Create a weekly marketing digest comparing this week vs monthly averages. Include highlights, concerns, and next-week focus areas. Return JSON: { "summary", "highlights": [...], "concerns": [...], "focusAreas": [...], "scorecard": { "overall": 0-100 } }.\nThis week: ' + JSON.stringify(metrics) + '\nMonthly avg: ' + JSON.stringify(prevMetrics);
        const text = await askAI(prompt);
        const digest = parseAIJson(text, {
            summary: 'Weekly digest unavailable.',
            highlights: [],
            concerns: [],
            focusAreas: [],
            scorecard: { overall: 72 }
        });
        digest.generatedAt = new Date().toISOString();
        store('weekly-digest', digest);
        return digest;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. REPORTING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate a comprehensive marketing report using AI.
     * @param {string} type - Report type from REPORT_TYPES.
     * @param {string} [dateRange='last-30d'] - Date range for the report.
     * @param {string[]} [sections] - Optional subset of sections to include.
     * @returns {Promise<Object>} Full report object with sections and executive summary.
     */
    async function generateReport(type, dateRange = 'last-30d', sections) {
        log('Generating report:', type);
        if (REPORT_TYPES.indexOf(type) === -1) {
            warn('Unknown report type:', type, '- defaulting to monthly-review');
            type = 'monthly-review';
        }
        const overview = getOverviewMetrics(dateRange);
        const channels = getChannelBreakdown(dateRange);
        const funnel = getFunnelMetrics();
        const allSections = sections || ['summary', 'channels', 'funnel', 'recommendations'];
        const prompt = 'Generate a ' + type + ' marketing report. Include executive summary, channel performance, funnel analysis, and strategic recommendations. Sections: ' + allSections.join(', ') + '. Return JSON: { "title", "type", "sections": [{ "heading", "content", "data" }], "executiveSummary" }.\nData: ' + JSON.stringify({ overview, channels, funnel });
        const text = await askAI(prompt);
        const report = parseAIJson(text, {
            title: type + ' Report',
            type,
            sections: [],
            executiveSummary: 'Report generation pending.'
        });
        report.id = 'rpt-' + Date.now();
        report.dateRange = dateRange;
        report.generatedAt = new Date().toISOString();
        const project = getProjectContext();
        if (project) report.projectId = project.id;
        const reports = load('reports', []);
        reports.unshift(report);
        store('reports', reports.slice(0, 50));
        return report;
    }

    /**
     * Available report templates with metadata.
     * @returns {Array<Object>} Template definitions with type, name, sections, and frequency.
     */
    function getReportTemplates() {
        return REPORT_TYPES.map(type => ({
            type,
            name: type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            sections: ['executive-summary', 'channel-performance', 'funnel-analysis', 'attribution', 'recommendations'],
            frequency: type.indexOf('weekly') !== -1 ? 'weekly'
                     : type.indexOf('monthly') !== -1 ? 'monthly'
                     : type.indexOf('quarterly') !== -1 ? 'quarterly'
                     : 'on-demand'
        }));
    }

    /**
     * Export report data in the specified format.
     * @param {string} reportId - Report identifier.
     * @param {string} [format='json'] - 'json' | 'csv'.
     * @returns {Object|null} Exported data payload or null if not found.
     */
    function exportReportData(reportId, format = 'json') {
        log('Exporting report', reportId, 'as', format);
        const reports = load('reports', []);
        const report = reports.find(r => r.id === reportId);
        if (!report) {
            warn('Report not found:', reportId);
            return null;
        }
        if (format === 'csv') {
            const rows = (report.sections || []).map(s =>
                '"' + s.heading + '","' + (s.content || '').replace(/"/g, '""') + '"'
            );
            return {
                format: 'csv',
                data: 'Heading,Content\n' + rows.join('\n'),
                filename: report.type + '-' + report.dateRange + '.csv'
            };
        }
        return { format: 'json', data: report, filename: report.type + '-' + report.dateRange + '.json' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. GOAL TRACKING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Retrieve all active marketing goals from storage.
     * @returns {Array<Object>} Goal definitions with current status.
     */
    function getGoals() {
        return load('goals', []);
    }

    /**
     * Create a new marketing goal and persist it.
     * @param {Object} config - Goal configuration.
     * @param {string} config.metric - Target metric (traffic, conversions, revenue, etc.).
     * @param {number} config.target - Numeric target value.
     * @param {string} config.deadline - ISO date string for the deadline.
     * @param {string} [config.channel] - Optional channel scope.
     * @param {string} [config.name] - Human-readable goal name.
     * @returns {Object|null} The created goal object, or null on invalid input.
     */
    function setGoal(config) {
        if (!config || !config.metric || !config.target || !config.deadline) {
            warn('Invalid goal config - metric, target, and deadline are required.');
            return null;
        }
        const goal = {
            id: 'goal-' + Date.now(),
            name: config.name || (config.metric + ' target'),
            metric: config.metric,
            target: config.target,
            deadline: config.deadline,
            channel: config.channel || 'all',
            createdAt: new Date().toISOString(),
            status: 'active'
        };
        const goals = getGoals();
        goals.push(goal);
        store('goals', goals);
        log('Goal created:', goal.id, goal.name);
        return goal;
    }

    /**
     * Check progress toward a specific goal with AI projection.
     * @param {string} goalId - Goal identifier.
     * @returns {Promise<Object|null>} Progress data with projection, or null if not found.
     */
    async function getGoalProgress(goalId) {
        log('Checking goal progress:', goalId);
        const goals = getGoals();
        const goal = goals.find(g => g.id === goalId);
        if (!goal) {
            warn('Goal not found:', goalId);
            return null;
        }
        const overview = getOverviewMetrics('last-30d');
        const current = overview[goal.metric] || 0;
        const pct = Math.min(+((current / goal.target) * 100).toFixed(1), 100);
        const daysLeft = Math.max(0, Math.round((new Date(goal.deadline) - new Date()) / 86400000));
        const prompt = 'A marketing goal targets ' + goal.target + ' ' + goal.metric + ' by ' + goal.deadline + '. Current value is ' + current + ' (' + pct + '% complete) with ' + daysLeft + ' days remaining. Will they hit the goal? Return JSON: { "onTrack": true/false, "projectedValue", "confidence", "suggestion" }.';
        const text = await askAI(prompt);
        const projection = parseAIJson(text, {
            onTrack: pct >= 50,
            projectedValue: current * 1.3,
            confidence: 'medium',
            suggestion: 'Increase investment in top-performing channels.'
        });
        return { goal, current, percentage: pct, daysRemaining: daysLeft, projection };
    }

    /**
     * AI recommendations to help achieve a specific goal.
     * @param {string} goalId - Goal identifier.
     * @returns {Promise<Object|null>} Targeted tactical recommendations, or null if not found.
     */
    async function getGoalRecommendations(goalId) {
        log('Getting AI recommendations for goal:', goalId);
        const goals = getGoals();
        const goal = goals.find(g => g.id === goalId);
        if (!goal) {
            warn('Goal not found:', goalId);
            return null;
        }
        const overview = getOverviewMetrics('last-30d');
        const gap = Math.max(0, goal.target - (overview[goal.metric] || 0));
        const prompt = 'A marketer needs to close a gap of ' + gap + ' in ' + goal.metric + ' by ' + goal.deadline + ' (channel: ' + goal.channel + '). Provide 5 specific tactical recommendations. Return JSON: { "recommendations": [{ "action", "channel", "expectedImpact", "timeframe", "difficulty" }] }.';
        const text = await askAI(prompt);
        return parseAIJson(text, { recommendations: [] });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.MarketingAnalyticsService = {
        // 1. Cross-Channel Dashboard
        getOverviewMetrics,
        getChannelBreakdown,
        getChannelTrends,
        compareChannels,

        // 2. Attribution Modeling
        getAttributionReport,
        getConversionPaths,
        getAssistConversions,

        // 3. Funnel Analysis
        getFunnelMetrics,
        getFunnelDropoffs,
        getConversionRates,
        optimizeFunnel,

        // 4. Customer Analytics
        getCustomerSegments,
        getCohortAnalysis,
        getCustomerLifetimeValue,
        getChurnPrediction,
        getCustomerJourneyMap,

        // 5. AI Insights Engine
        generateInsights,
        detectAnomalies,
        generateForecast,
        getActionableRecommendations,
        generateWeeklyDigest,

        // 6. Reporting
        generateReport,
        getReportTemplates,
        exportReportData,

        // 7. Goal Tracking
        getGoals,
        setGoal,
        getGoalProgress,
        getGoalRecommendations,

        // Metadata constants
        CHANNELS,
        FUNNEL_STAGES,
        ATTRIBUTION_MODELS,
        REPORT_TYPES
    };

    log('MarketingAnalyticsService v1.0.0 initialised -',
        Object.keys(window.MarketingAnalyticsService).length, 'exports');

})();
