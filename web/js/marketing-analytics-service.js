/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MARKETING ANALYTICS SERVICE - Cross-Channel Intelligence Engine
 * Audema Marketing 2026
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
            if (window.MarketingStore) { window.MarketingStore.set('analytics', key, value).catch(function(){}); }
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

    /**
     * Asynchronously retrieve a value, checking MarketingStore first then localStorage.
     * @param {string} key - Storage key (auto-prefixed for localStorage).
     * @param {*} fallback - Default when key is absent in both stores.
     * @returns {Promise<*>} Resolved value or fallback.
     */
    async function loadAsync(key, fallback = null) {
        try {
            if (window.MarketingStore) {
                const remote = await window.MarketingStore.get('analytics', key);
                if (remote !== null && remote !== undefined) return remote;
            }
        } catch {
            // MarketingStore unavailable, fall through to localStorage
        }
        return load(key, fallback);
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
    // MEASUREMENT LAYER
    //
    // Every number in this module has to come from somewhere real. Google
    // Analytics is the only source of channel/traffic/conversion figures here,
    // so when it is not connected the honest answer is "not measured" — not a
    // demo table, and not zeros either. Zeros are their own kind of lie: a
    // dashboard that says "0 conversions, 0% ROI" is telling the customer
    // their marketing failed, when in fact nothing was ever counted.
    //
    // Every reader below therefore returns { measured, reason, ... } and
    // callers render the reason rather than a number.
    // ═══════════════════════════════════════════════════════════════════════════

    /** Uniform "we have no measurement" answer, with the reason the UI shows. */
    function unmeasured(reason, extra) {
        return Object.assign({ measured: false, reason: reason }, extra || {});
    }

    const GA_NOT_CONNECTED =
        'Google Analytics is not connected, so there is nothing to report yet. ' +
        'Connect GA4 in Settings to see your real traffic, channels and conversions.';

    function gaAvailable() {
        try { return !!window.ApiConnector?.GoogleAnalytics?.isAvailable?.(); }
        catch { return false; }
    }

    /**
     * GA4's runReport returns { dimensionHeaders, metricHeaders, rows:[{dimensionValues,metricValues}] }.
     * Nothing used to map it, so even a successful call produced an object no
     * caller could read. This turns one report into { <dimension>: {metric: n} }.
     */
    function mapGaRows(report) {
        const out = {};
        if (!report || !Array.isArray(report.rows)) return out;
        const metricNames = (report.metricHeaders || []).map(h => h.name);
        for (const row of report.rows) {
            const key = row.dimensionValues?.[0]?.value;
            if (!key) continue;
            const entry = {};
            (row.metricValues || []).forEach((mv, i) => {
                const n = Number(mv.value);
                entry[metricNames[i] || ('metric' + i)] = isFinite(n) ? n : null;
            });
            out[key] = entry;
        }
        return out;
    }

    // GA4's own channel-group names, mapped onto the labels this module uses.
    const GA_CHANNEL_MAP = {
        'Organic Search': 'SEO', 'Paid Search': 'Paid', 'Paid Shopping': 'Paid',
        'Paid Social': 'Paid', 'Display': 'Paid', 'Paid Video': 'Paid',
        'Organic Social': 'Social', 'Organic Video': 'Social',
        'Email': 'Email', 'Direct': 'Direct', 'Referral': 'Referral',
    };

    function emptyChannelRow() {
        return { traffic: 0, leads: null, conversions: 0, revenue: 0, spend: null, cac: null, roi: null };
    }

    /**
     * Real per-channel figures from GA4, or an explicit non-answer.
     *
     * Note what GA4 can and cannot tell us. Sessions and conversions are real.
     * Ad SPEND is not in GA4 at all, so leads/spend/CAC/ROI stay null rather
     * than being derived from a number we do not have — an ROI computed
     * against an unknown spend is not an ROI.
     */
    async function readChannels(dateRange) {
        if (!gaAvailable()) return unmeasured(GA_NOT_CONNECTED);
        let report;
        try {
            report = await window.ApiConnector.GoogleAnalytics.getChannelPerformance(gaDateRange(dateRange));
        } catch (e) {
            warn('GA4 channel report failed:', e.message);
            return unmeasured('Google Analytics did not answer: ' + e.message);
        }
        if (!report || !Array.isArray(report.rows)) {
            return unmeasured('Google Analytics returned no rows for this period.');
        }

        const raw = mapGaRows(report);
        const channels = {};
        for (const ch of CHANNELS) channels[ch] = emptyChannelRow();
        for (const [gaName, metrics] of Object.entries(raw)) {
            const ch = GA_CHANNEL_MAP[gaName];
            if (!ch) continue;                       // an unmapped group is dropped, not guessed at
            channels[ch].traffic     += metrics.sessions    || 0;
            channels[ch].conversions += metrics.conversions || 0;
            channels[ch].revenue     += metrics.totalRevenue || 0;
        }
        return { measured: true, channels, dateRange };
    }

    /** Translates this module's range labels into GA4's own date syntax. */
    function gaDateRange(range) {
        const days = { 'last-7d': 7, 'last-30d': 30, 'last-90d': 90, 'last-12m': 365 }[range] || 30;
        return { startDate: days + 'daysAgo', endDate: 'today' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. CROSS-CHANNEL DASHBOARD
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Aggregate overview metrics across every channel.
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Promise<Object>} { measured, reason } or real totals.
     */
    async function getOverviewMetrics(dateRange = 'last-30d') {
        log('Fetching overview metrics for', dateRange);
        const read = await readChannels(dateRange);
        if (!read.measured) return read;

        const totals = { traffic: 0, conversions: 0, revenue: 0 };
        for (const ch of CHANNELS) {
            totals.traffic     += read.channels[ch].traffic;
            totals.conversions += read.channels[ch].conversions;
            totals.revenue     += read.channels[ch].revenue;
        }
        // Ad spend lives in the ad platforms, not GA4. Without it there is no
        // CAC and no ROI — the old code divided by a spend of 0 and reported
        // the result as a percentage.
        totals.spend = null;
        totals.cac   = null;
        totals.roi   = null;
        // LTV was revenue-per-conversion multiplied by a hardcoded 3.2. There
        // is no repeat-purchase data behind that number, so it is not reported.
        totals.ltv   = null;
        totals.avgOrderValue = totals.conversions > 0
            ? +(totals.revenue / totals.conversions).toFixed(2)
            : null;
        totals.measured  = true;
        totals.dateRange = dateRange;
        const project = getProjectContext();
        if (project) totals.projectId = project.id;
        store('overview-' + dateRange, totals);
        return totals;
    }

    /**
     * Performance breakdown by individual channel.
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Promise<Object>} { measured, reason } or per-channel metrics.
     */
    async function getChannelBreakdown(dateRange = 'last-30d') {
        log('Building channel breakdown for', dateRange);
        const read = await readChannels(dateRange);
        if (!read.measured) return read;
        store('channel-breakdown-' + dateRange, read.channels);
        return { measured: true, channels: read.channels, dateRange };
    }

    /**
     * Historical trend points for one channel, from GA4's date dimension.
     *
     * This used to return a flat invented series — traffic 3000, leads 90,
     * conversions 18, revenue 9000 on every single point, dated backwards from
     * today — which was then charted as the customer's performance history and
     * fed into the anomaly detector and the forecaster.
     *
     * @param {string} channel - Channel name.
     * @param {string} [period='weekly'] - 'daily' | 'weekly' | 'monthly'.
     * @returns {Promise<Object>} { measured, reason } or { measured, points }.
     */
    async function getChannelTrends(channel, period = 'weekly') {
        log('Fetching trends for', channel, period);
        if (!gaAvailable()) return unmeasured(GA_NOT_CONNECTED);

        const days = { daily: 30, weekly: 84, monthly: 365 }[period] || 84;
        let report;
        try {
            report = await window.ApiConnector.GoogleAnalytics.getReport({
                dateRange: { startDate: days + 'daysAgo', endDate: 'today' },
                metrics: ['sessions', 'conversions', 'totalRevenue'],
                dimensions: ['date', 'sessionDefaultChannelGroup'],
            });
        } catch (e) {
            return unmeasured('Google Analytics did not answer: ' + e.message);
        }
        if (!report || !Array.isArray(report.rows) || !report.rows.length) {
            return unmeasured('Google Analytics returned no data for this period.');
        }

        const metricNames = (report.metricHeaders || []).map(h => h.name);
        const byDate = new Map();
        for (const row of report.rows) {
            const date  = row.dimensionValues?.[0]?.value;
            const group = row.dimensionValues?.[1]?.value;
            if (!date) continue;
            if (channel && GA_CHANNEL_MAP[group] !== channel) continue;
            const point = byDate.get(date) || { date: isoDate(date), traffic: 0, conversions: 0, revenue: 0 };
            (row.metricValues || []).forEach((mv, i) => {
                const n = Number(mv.value) || 0;
                if (metricNames[i] === 'sessions')     point.traffic     += n;
                if (metricNames[i] === 'conversions')  point.conversions += n;
                if (metricNames[i] === 'totalRevenue') point.revenue     += n;
            });
            byDate.set(date, point);
        }
        const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        if (!points.length) {
            return unmeasured('No ' + (channel || 'channel') + ' traffic recorded in this period.');
        }
        return { measured: true, channel, period, points };
    }

    /** GA4 returns dates as YYYYMMDD. */
    function isoDate(ga) {
        return /^\d{8}$/.test(ga) ? ga.slice(0, 4) + '-' + ga.slice(4, 6) + '-' + ga.slice(6) : ga;
    }

    /**
     * Compare selected channels on a specific metric.
     * @param {string[]} channels - Channel names to compare.
     * @param {string} metric - Metric key.
     * @param {string} [dateRange='last-30d'] - Date range filter.
     * @returns {Promise<Object>} { measured, reason } or ranked results.
     */
    async function compareChannels(channels, metric, dateRange = 'last-30d') {
        log('Comparing channels on', metric);
        const read = await readChannels(dateRange);
        if (!read.measured) return read;
        const data = read.channels;
        const selected = (channels || CHANNELS).filter(c => data[c]);
        // A channel whose metric was never measured (spend, CAC, ROI) cannot be
        // ranked against one that was, so it is reported separately.
        const measurable = selected.filter(c => typeof data[c][metric] === 'number');
        const unrankable = selected.filter(c => typeof data[c][metric] !== 'number');
        const sorted = measurable.sort((a, b) => data[b][metric] - data[a][metric]);
        const result = {};
        sorted.forEach((ch, idx) => { result[ch] = { value: data[ch][metric], rank: idx + 1 }; });
        return { measured: true, metric, dateRange, ranked: result, notMeasured: unrankable };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. ATTRIBUTION MODELING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Attribution weights per model, applied to a real touch SEQUENCE.
     * The index is the touch's position in that customer's own path — which is
     * what attribution means. The previous version indexed a fixed weight table
     * by the channel's position in the CHANNELS array, so "first-touch" gave
     * 100% of the credit to whichever channel happened to be listed first (SEO)
     * and "last-touch" gave it to whichever was last (Referral), for every
     * account, regardless of what anyone actually did.
     */
    function weightsFor(model, n) {
        if (n <= 0) return [];
        if (n === 1) return [1];
        switch (model) {
            case 'first-touch': return Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));
            case 'last-touch':  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0));
            case 'linear':      return Array.from({ length: n }, () => 1 / n);
            case 'time-decay': {
                // Half-life of one touch: the closer to conversion, the more credit.
                const raw = Array.from({ length: n }, (_, i) => Math.pow(2, i));
                const sum = raw.reduce((a, b) => a + b, 0);
                return raw.map(v => v / sum);
            }
            case 'position-based': {
                if (n === 2) return [0.5, 0.5];
                const middle = 0.2 / (n - 2);
                return Array.from({ length: n }, (_, i) =>
                    i === 0 || i === n - 1 ? 0.4 : middle);
            }
            default:            return Array.from({ length: n }, () => 1 / n);
        }
    }

    /**
     * Real multi-touch attribution over real conversion paths.
     *
     * @param {Array<{path: string[], revenue?: number}>} paths - One entry per conversion.
     * @param {string} [model='linear'] - Attribution model.
     * @returns {Object} { measured, model, totalConversions, attribution }
     */
    function computeAttribution(paths, model = 'linear') {
        if (!Array.isArray(paths) || !paths.length) {
            return unmeasured(
                'Attribution needs the touchpoint sequence behind each conversion — which channels a ' +
                'customer saw, in order, before converting. Nothing in this account records that yet.');
        }
        if (ATTRIBUTION_MODELS.indexOf(model) === -1) {
            warn('Unknown attribution model:', model, '- falling back to linear');
            model = 'linear';
        }
        const credit = {};
        let totalRevenue = 0;
        for (const entry of paths) {
            const touches = (entry.path || []).filter(Boolean);
            if (!touches.length) continue;
            const w = weightsFor(model, touches.length);
            const revenue = Number(entry.revenue) || 0;
            totalRevenue += revenue;
            touches.forEach((ch, i) => {
                credit[ch] = credit[ch] || { credit: 0, revenue: 0 };
                credit[ch].credit  += w[i];
                credit[ch].revenue += revenue * w[i];
            });
        }
        const totalCredit = Object.values(credit).reduce((s2, c) => s2 + c.credit, 0);
        const attribution = {};
        for (const [ch, c] of Object.entries(credit)) {
            attribution[ch] = {
                credit: +c.credit.toFixed(2),
                // Guarded: the old version divided by a conversion count that
                // was zero whenever nothing was measured, and rendered NaN%.
                percentage: totalCredit > 0 ? +((c.credit / totalCredit) * 100).toFixed(1) : null,
                revenue: Math.round(c.revenue),
            };
        }
        return {
            measured: true, model,
            totalConversions: paths.length,
            totalRevenue: Math.round(totalRevenue),
            attribution,
        };
    }

    /**
     * Run an attribution report over this account's stored conversion paths.
     * @param {string} [model='linear'] - Attribution model name.
     * @returns {Object} { measured, reason } or a real attribution report.
     */
    function getAttributionReport(model = 'linear') {
        log('Running attribution model:', model);
        return computeAttribution(getConversionPaths(), model);
    }

    /**
     * Conversion path sequences recorded for this account.
     *
     * This used to return ten invented paths ("SEO → Email → Direct, 142
     * conversions, $285 average") which were charted as the customer's own
     * behaviour. Nothing in the product records multi-touch paths yet, so the
     * honest answer is an empty list until something does; anything stored by
     * a real integration is returned as-is.
     *
     * @param {number} [limit=10] - Maximum paths to return.
     * @returns {Array<Object>} Recorded conversion paths — empty when none.
     */
    function getConversionPaths(limit = 10) {
        const stored = load('conversion-paths', null);
        if (Array.isArray(stored)) return stored.slice(0, limit);
        return [];
    }

    /**
     * Channels that assist conversions without closing them.
     * Derived from the same real paths; without them there is nothing to derive.
     * @returns {Object} { measured, reason } or per-channel assist metrics.
     */
    function getAssistConversions() {
        log('Computing assist conversions');
        const paths = getConversionPaths(1000);
        if (!paths.length) {
            return unmeasured(
                'Assist analysis needs recorded touchpoint paths. None are recorded for this account yet.');
        }
        const stats = {};
        for (const entry of paths) {
            const touches = (entry.path || []).filter(Boolean);
            touches.forEach((ch, i) => {
                stats[ch] = stats[ch] || { channel: ch, assists: 0, closes: 0 };
                if (i === touches.length - 1) stats[ch].closes++;
                else stats[ch].assists++;
            });
        }
        const rows = Object.values(stats).map(s2 => ({
            ...s2,
            assistRatio: s2.closes > 0 ? +(s2.assists / s2.closes).toFixed(2) : null,
        })).sort((a, b) => (b.assistRatio ?? -1) - (a.assistRatio ?? -1));
        return { measured: true, channels: rows };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. FUNNEL ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Full marketing funnel metrics.
     *
     * The stage counts were hardcoded — [50000, 28000, 14000, 7200, 3600,
     * 2100] — with conversion rates computed off them to one decimal place and
     * then handed to Claude to explain the drop-offs. Every customer saw the
     * same funnel and read AI advice about a business that did not exist.
     *
     * GA4 gives us two real stages: sessions (awareness) and conversions
     * (purchase). The middle of the funnel needs event tracking this product
     * does not configure, so those stages are reported as unmeasured rather
     * than interpolated.
     *
     * @returns {Promise<Object>} { measured, reason } or real funnel stages.
     */
    async function getFunnelMetrics() {
        log('Building funnel metrics');
        const overview = await getOverviewMetrics('last-30d');
        if (!overview.measured) return overview;

        const stages = [
            { stage: 'awareness',     visitors: overview.traffic,     measured: true },
            { stage: 'interest',      visitors: null, measured: false, reason: 'Needs an engagement event in GA4.' },
            { stage: 'consideration', visitors: null, measured: false, reason: 'Needs a consideration event in GA4.' },
            { stage: 'intent',        visitors: null, measured: false, reason: 'Needs an add-to-cart or enquiry event in GA4.' },
            { stage: 'purchase',      visitors: overview.conversions, measured: true },
            { stage: 'loyalty',       visitors: null, measured: false, reason: 'Needs a repeat-purchase event in GA4.' },
        ];

        // Overall rate is only computable between two stages we actually have.
        const top = stages[0].visitors;
        for (const st of stages) {
            st.overallRate = (st.measured && top > 0)
                ? +((st.visitors / top) * 100).toFixed(2)
                : null;
        }
        return { measured: true, stages, unmeasuredStages: stages.filter(s2 => !s2.measured).length };
    }

    /**
     * Where users drop off, with AI analysis of probable causes.
     * @returns {Promise<Object>} { measured, reason } or drop-offs with causes.
     */
    async function getFunnelDropoffs() {
        log('Analysing funnel drop-offs');
        const funnel = await getFunnelMetrics();
        if (!funnel.measured) return funnel;

        // Only between stages we measured — a drop-off computed against an
        // interpolated stage is a drop-off we invented.
        const known = funnel.stages.filter(s2 => s2.measured);
        const dropoffs = [];
        for (let i = 1; i < known.length; i++) {
            const lost = known[i - 1].visitors - known[i].visitors;
            dropoffs.push({
                from: known[i - 1].stage,
                to: known[i].stage,
                lost,
                dropRate: known[i - 1].visitors > 0
                    ? +((lost / known[i - 1].visitors) * 100).toFixed(1)
                    : null,
            });
        }
        if (!dropoffs.length) return unmeasured('Not enough measured funnel stages to compare.');

        const prompt = 'Analyse these marketing funnel drop-offs and explain likely causes for each in 1 sentence. ' +
            'Only the stages listed are measured; do not speculate about stages that are not present. ' +
            'Return JSON array of { "from", "to", "cause" }:\n' + JSON.stringify(dropoffs);
        const text = await askAI(prompt);
        const causes = parseAIJson(text, []);
        dropoffs.forEach((d, idx) => {
            // No filler sentence: either the model explained it or it did not.
            d.aiCause = causes[idx]?.cause || null;
        });
        return { measured: true, dropoffs, unmeasuredStages: funnel.unmeasuredStages };
    }

    /**
     * Conversion rate for a specific funnel stage or the entire funnel.
     * @param {string} [stage] - Funnel stage name. Omit for all stages.
     * @returns {Promise<Object|Array|null>} Stage metrics, full funnel, or null.
     */
    async function getConversionRates(stage) {
        const funnel = await getFunnelMetrics();
        if (!funnel.measured) return funnel;
        if (!stage) return funnel;
        return funnel.stages.find(s2 => s2.stage === stage) || null;
    }

    /**
     * AI recommendations for improving funnel conversion rates.
     * @returns {Promise<Object>} Structured optimization recommendations.
     */
    async function optimizeFunnel() {
        log('Generating funnel optimizations');
        const funnel = await getFunnelMetrics();
        if (!funnel.measured) return funnel;
        const prompt = 'Given this marketing funnel data, provide 3 concrete optimisation recommendations per ' +
            'MEASURED stage to improve conversion rates. Stages marked measured:false have no data — do not ' +
            'invent numbers for them; you may recommend tracking them. ' +
            'Return JSON: { "recommendations": [{ "stage", "actions": ["..."], "expectedLift": "..." }] }.\n' +
            JSON.stringify(funnel.stages);
        const text = await askAI(prompt);
        return parseAIJson(text, { recommendations: [] });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. CUSTOMER ANALYTICS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * AI-generated customer segments integrated with ICP from BusinessBrain.
     * PRODUCTION-READY: Uses Intelligence Layer for ICP-specific segmentation.
     * @returns {Promise<Array<Object>>} Customer segment profiles.
     */
    async function getCustomerSegments() {
        log('Generating customer segments');

        let prompt = 'Generate 5 distinct marketing customer segments with behavioural, demographic, and value-based attributes. Return JSON array of { "name", "size_pct", "avg_ltv", "channels", "description", "type" }.';

        // ADD ICP CONTEXT FROM BUSINESSBRAIN
        if (window.IntelligenceEngine && window.IntelligenceEngine.brain) {
            const data = window.IntelligenceEngine.brain.load();
            if (data && data.icp) {
                prompt += `\n\nStart with this ICP definition:\n`;
                prompt += `Persona: ${data.icp.persona || 'Not specified'}\n`;
                if (data.icp.painPoints && data.icp.painPoints.length > 0) {
                    prompt += `Pain Points: ${data.icp.painPoints.filter(p => p).join(', ')}\n`;
                }
                if (data.icp.buyerJourney) {
                    prompt += `Buyer Journey: ${JSON.stringify(data.icp.buyerJourney)}\n`;
                }
                if (data.icp.firmographics) {
                    prompt += `Firmographics: ${JSON.stringify(data.icp.firmographics)}\n`;
                }
                prompt += `\nCreate segments that map to different sub-segments of this ICP, considering pain point severity, buyer journey stage, and firmographic attributes.`;
            }
        }

        const text = await askAI(prompt);
        return parseAIJson(text, []); // Empty array fallback - NO fake segments
    }

    /**
     * Cohort analysis for retention or revenue over time.
     *
     * Cohorts need per-customer first-seen dates and repeat activity. Nothing
     * in this product stores that, so the grid of zeros this used to build was
     * a shaped answer to a question never asked — and a zero retention rate
     * reads as "every customer churned", which is a claim, not a blank.
     *
     * @param {string} [cohortType='monthly'] - 'weekly' | 'monthly' | 'quarterly'.
     * @param {string} [metric='retention'] - 'retention' | 'revenue'.
     * @returns {Object} { measured, reason } or stored cohorts.
     */
    function getCohortAnalysis(cohortType = 'monthly', metric = 'retention') {
        log('Running cohort analysis:', cohortType, metric);
        const stored = load('cohort-' + cohortType + '-' + metric, null);
        if (Array.isArray(stored) && stored.length) return { measured: true, cohorts: stored };
        return unmeasured(
            'Cohort analysis needs per-customer first-purchase dates and repeat activity. ' +
            'Connect a source that records them to see retention cohorts.');
    }

    /**
     * Customer lifetime value.
     *
     * The old version returned a fixed avgLTV of $1,240, a median of $860, a
     * 12-month projection of $1,680 and a five-bucket distribution — the same
     * figures for every account, none of them derived from anything.
     *
     * Real LTV needs repeat-purchase history per customer. GA4 gives revenue
     * and conversions for a window, which yields average order value — a real
     * number, and a different one. It is reported as what it is.
     *
     * @returns {Promise<Object>} { measured, reason } or real value metrics.
     */
    async function getCustomerLifetimeValue() {
        log('Calculating customer value');
        const overview = await getOverviewMetrics('last-30d');
        if (!overview.measured) return overview;
        if (!overview.conversions) {
            return unmeasured('No conversions were recorded in the last 30 days, so there is no order value to average.');
        }
        return {
            measured: true,
            avgOrderValue: overview.avgOrderValue,
            conversions: overview.conversions,
            revenue: overview.revenue,
            window: 'last-30d',
            // Named explicitly so no caller mistakes this for lifetime value.
            lifetimeValue: null,
            lifetimeValueReason:
                'Lifetime value needs repeat-purchase history per customer, which is not recorded yet. ' +
                'The figure above is average order value over the last 30 days.',
        };
    }

    /**
     * AI churn risk analysis.
     *
     * The fallback used to invent an overall churn rate of 5.2% and three
     * segments with risk scores of 89, 72 and 54 — precise-looking numbers
     * about customers the product has never seen.
     *
     * @returns {Promise<Object>} { measured, reason } or AI analysis.
     */
    async function getChurnPrediction() {
        log('Running churn prediction');
        const prompt = 'Describe the churn-risk signals a marketing team should watch for, and how to act on each. ' +
            'Do NOT invent rates or scores for this business — no data about it has been provided. ' +
            'Return JSON: { "signals": [{ "name", "whyItMatters", "howToDetect", "recommendation" }] }.';
        const text = await askAI(prompt);
        const parsed = parseAIJson(text, null);
        if (!parsed) return unmeasured('Churn guidance is unavailable right now.');
        return {
            measured: false,
            isGuidance: true,
            reason: 'These are general churn signals to watch for, not a measurement of your customers — ' +
                    'churn scoring needs per-customer activity history, which is not connected yet.',
            ...parsed,
        };
    }

    /**
     * AI customer journey map.
     * Marked as guidance, because nothing here observes this account's customers.
     * @returns {Promise<Object>} Journey stages, flagged as illustrative.
     */
    async function getCustomerJourneyMap() {
        log('Generating customer journey map');
        const intel = getBusinessContext();
        const prompt = 'Create a customer journey map' + (intel ? ' for this business:\n' + intel : ' for a digital marketing platform') +
            '. Return JSON: { "stages": [{ "name", "touchpoints": [...], "emotion", "painPoints": [...], "opportunities": [...] }] }.';
        const text = await askAI(prompt);
        const parsed = parseAIJson(text, null);
        if (!parsed) return unmeasured('Journey map is unavailable right now.');
        return {
            measured: false,
            isGuidance: true,
            reason: 'A suggested journey map based on your business profile — not observed behaviour from your analytics.',
            ...parsed,
        };
    }

    /** Business context from the Intelligence Layer, when one has been built. */
    function getBusinessContext() {
        try {
            const intel = window.IntelligenceEngine?.extractStructuredContext?.();
            return intel ? JSON.stringify(intel).slice(0, 4000) : '';
        } catch { return ''; }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. AI INSIGHTS ENGINE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * AI insights from real measured metrics.
     * @param {string} [dateRange='last-30d'] - Analysis window.
     * @returns {Promise<Object>} { measured, reason } or categorised insights.
     */
    async function generateInsights(dateRange = 'last-30d') {
        log('Generating AI insights for', dateRange);
        const overview = await getOverviewMetrics(dateRange);
        if (!overview.measured) return overview;

        const prompt = 'As a senior marketing analyst, review these metrics and generate up to 5 actionable insights. ' +
            'Fields that are null were NOT measured — say so if it limits the analysis, and never estimate them. ' +
            'Categorise each insight as growth, risk, or opportunity. ' +
            'Return JSON: { "insights": [{ "category", "title", "detail", "impact", "action" }] }.\nMetrics: ' +
            JSON.stringify(overview);
        const text = await askAI(prompt);
        const result = parseAIJson(text, { insights: [] });
        result.measured = true;
        result.generatedAt = new Date().toISOString();
        store('latest-insights', result);
        return result;
    }

    /**
     * Statistical anomaly detection over a real trend series.
     *
     * This used to run over the invented flat series, where every value was
     * identical — so the standard deviation was 0, every deviation was 0/0 =
     * NaN, `Math.abs(NaN) > 2` was false, and the function always returned
     * "No significant anomalies detected." A confident all-clear derived from
     * nothing at all.
     *
     * @param {string} metric - 'traffic' | 'conversions' | 'revenue'.
     * @param {string} [channel] - Optional channel filter.
     * @returns {Promise<Object>} { measured, reason } or detected anomalies.
     */
    async function detectAnomalies(metric, channel) {
        log('Detecting anomalies for', metric);
        const trend = await getChannelTrends(channel || null, 'daily');
        if (!trend.measured) return trend;

        const values = trend.points.map(t => t[metric]).filter(v => typeof v === 'number');
        // Below this there is no distribution to speak of, and a "2 standard
        // deviations" claim over four points is not a finding.
        if (values.length < 14) {
            return unmeasured('Anomaly detection needs at least 14 days of data; this account has ' +
                values.length + '.');
        }
        const avg = values.reduce((s2, v) => s2 + v, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((s2, v) => s2 + Math.pow(v - avg, 2), 0) / values.length);
        if (!(stdDev > 0)) {
            return { measured: true, metric, anomalies: [],
                     note: 'Every day in this period had the same value, so there is no variation to flag.' };
        }
        const anomalies = [];
        trend.points.forEach((t, i) => {
            if (typeof t[metric] !== 'number') return;
            const deviation = +((t[metric] - avg) / stdDev).toFixed(2);
            if (Math.abs(deviation) > 2) {
                anomalies.push({ date: t.date, value: t[metric], deviation, type: deviation > 0 ? 'spike' : 'drop' });
            }
        });
        if (!anomalies.length) {
            return { measured: true, metric, anomalies: [], note: 'No day deviated more than 2 standard deviations from the mean.' };
        }
        const prompt = 'Explain these marketing metric anomalies in ' + metric + ': ' + JSON.stringify(anomalies) +
            '. Return JSON: { "explanations": [{ "date", "likelyCause", "recommendation" }] }.';
        const text = await askAI(prompt);
        const parsed = parseAIJson(text, { explanations: [] });
        return { measured: true, metric, anomalies, aiExplanations: parsed.explanations };
    }

    /**
     * Predictive forecast for a metric, from real history.
     * @param {string} metric - Metric to forecast.
     * @param {number} [periodsAhead=4] - Number of future periods to predict.
     * @returns {Promise<Object>} { measured, reason } or forecast.
     */
    async function generateForecast(metric, periodsAhead = 4) {
        log('Forecasting', metric, 'for', periodsAhead, 'periods ahead');
        const trend = await getChannelTrends(null, 'weekly');
        if (!trend.measured) return trend;

        const history = trend.points
            .map(t => ({ date: t.date, value: t[metric] }))
            .filter(h => typeof h.value === 'number');
        // Forecasting off two or three points is guessing with extra steps.
        if (history.length < 8) {
            return unmeasured('A forecast needs at least 8 periods of history; this account has ' +
                history.length + '.');
        }
        const prompt = 'Given this ' + metric + ' history, forecast the next ' + periodsAhead + ' periods. ' +
            'Apply trend and seasonality analysis. Return JSON: { "forecast": [{ "date", "predicted", ' +
            '"confidence_low", "confidence_high" }], "trend": "up|down|flat", "growthRate": "..." }.\nHistory: ' +
            JSON.stringify(history.slice(-26));
        const text = await askAI(prompt);
        const ai = parseAIJson(text, null);
        if (!ai) return unmeasured('The forecast could not be generated right now.');
        return { measured: true, metric, history, generatedAt: new Date().toISOString(), ...ai };
    }

    /**
     * AI-prioritised recommendations across all channels.
     * @returns {Promise<Object>} { measured, reason } or recommendations.
     */
    async function getActionableRecommendations() {
        log('Generating actionable recommendations');
        const overview = await getOverviewMetrics('last-30d');
        if (!overview.measured) return overview;
        const funnel = await getFunnelMetrics();
        const prompt = 'As a CMO advisor, review these marketing metrics and funnel data. Provide up to 7 ' +
            'prioritised recommendations. Null fields and stages marked measured:false were NOT measured — ' +
            'do not invent values for them. Return JSON: { "recommendations": [{ "priority", "category", ' +
            '"title", "description", "expectedImpact", "effort", "channel" }] }.\nOverview: ' +
            JSON.stringify(overview) + '\nFunnel: ' + JSON.stringify(funnel.stages || []);
        const text = await askAI(prompt);
        const parsed = parseAIJson(text, { recommendations: [] });
        const recs = parsed.recommendations || parsed;
        store('recommendations', recs);
        return { measured: true, recommendations: recs };
    }

    /**
     * Weekly performance digest comparing the last 7 days against a
     * seven-day-equivalent of the last 30.
     * @returns {Promise<Object>} { measured, reason } or the digest.
     */
    async function generateWeeklyDigest() {
        log('Generating weekly digest');
        const metrics = await getOverviewMetrics('last-7d');
        if (!metrics.measured) return metrics;

        // last-30d is a 30-day TOTAL, not a weekly average — comparing a week
        // against it directly made every week look like a collapse.
        const monthly = await getOverviewMetrics('last-30d');
        const prevMetrics = monthly.measured ? {
            traffic:     Math.round(monthly.traffic / 30 * 7),
            conversions: Math.round(monthly.conversions / 30 * 7),
            revenue:     Math.round(monthly.revenue / 30 * 7),
            note: 'Thirty-day totals scaled to a seven-day equivalent.',
        } : monthly;

        const prompt = 'Create a weekly marketing digest comparing this week against the seven-day-equivalent ' +
            'baseline. Null fields were NOT measured — do not estimate them. Return JSON: { "summary", ' +
            '"highlights": [...], "concerns": [...], "focusAreas": [...] }.\nThis week: ' +
            JSON.stringify(metrics) + '\nBaseline: ' + JSON.stringify(prevMetrics);
        const text = await askAI(prompt);
        // The old fallback returned a scorecard of 72/100 whenever the model
        // failed to answer — a grade for a week nobody had graded.
        const digest = parseAIJson(text, null);
        if (!digest) return unmeasured('The weekly digest could not be generated right now.');
        digest.measured = true;
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
        const overview = await getOverviewMetrics(dateRange);
        if (!overview.measured) return overview;
        const channels = await getChannelBreakdown(dateRange);
        const funnel = await getFunnelMetrics();
        const allSections = sections || ['summary', 'channels', 'funnel', 'recommendations'];
        const prompt = 'Generate a ' + type + ' marketing report. Include executive summary, channel performance, funnel analysis, and strategic recommendations. Sections: ' + allSections.join(', ') + '. Return JSON: { "title", "type", "sections": [{ "heading", "content", "data" }], "executiveSummary" }.\nData: ' + JSON.stringify({ overview, channels: channels.channels || null, funnel: funnel.stages || null }) +
            '\n\nAny null value or measured:false stage was NOT measured. Say so plainly in the report ' +
            'rather than estimating it — a report that invents a number is worse than one that names a gap.';
        const text = await askAI(prompt);
        const report = parseAIJson(text, null);
        if (!report) return unmeasured('The report could not be generated right now.');
        report.measured = true;
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
        const overview = await getOverviewMetrics('last-30d');
        if (!overview.measured) return { goal, measured: false, reason: overview.reason };
        const current = typeof overview[goal.metric] === 'number' ? overview[goal.metric] : null;
        if (current === null) {
            return { goal, measured: false,
                     reason: '"' + goal.metric + '" is not measured by the connected sources, so progress ' +
                             'toward this goal cannot be calculated.' };
        }
        const pct = goal.target > 0 ? Math.min(+((current / goal.target) * 100).toFixed(1), 100) : null;
        const daysLeft = Math.max(0, Math.round((new Date(goal.deadline) - new Date()) / 86400000));
        const prompt = 'A marketing goal targets ' + goal.target + ' ' + goal.metric + ' by ' + goal.deadline + '. Current value is ' + current + ' (' + pct + '% complete) with ' + daysLeft + ' days remaining. Will they hit the goal? Return JSON: { "onTrack": true/false, "projectedValue", "confidence", "suggestion" }.';
        const text = await askAI(prompt);
        // The fallback projected current * 1.3 — an invented 30% growth rate
        // presented to the customer as a forecast of their own goal.
        const projection = parseAIJson(text, null);
        return { goal, measured: true, current, percentage: pct, daysRemaining: daysLeft, projection };
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
        const overview = await getOverviewMetrics('last-30d');
        if (!overview.measured) return { goal, measured: false, reason: overview.reason };
        const currentValue = typeof overview[goal.metric] === 'number' ? overview[goal.metric] : null;
        if (currentValue === null) {
            return { goal, measured: false,
                     reason: '"' + goal.metric + '" is not measured by the connected sources.' };
        }
        const gap = Math.max(0, goal.target - currentValue);
        const prompt = 'A marketer needs to close a gap of ' + gap + ' in ' + goal.metric + ' by ' + goal.deadline + ' (channel: ' + goal.channel + '). Provide 5 specific tactical recommendations. Return JSON: { "recommendations": [{ "action", "channel", "expectedImpact", "timeframe", "difficulty" }] }.';
        const text = await askAI(prompt);
        return parseAIJson(text, { recommendations: [] });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARD FACADE
    //
    // web/marketing/analytics.html has always called getDashboardData() and
    // getAIInsights(). Neither existed, so its only data path threw a
    // TypeError on every load, was swallowed by a catch, and the page fell
    // through to its placeholder render. Nothing a customer saw there had ever
    // touched their account.
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Everything the dashboard needs, in one call.
     * @param {string} [dateRange='last-30d']
     * @returns {Promise<Object>} { measured, reason } plus whatever IS measured.
     */
    async function getDashboardData(dateRange = 'last-30d') {
        log('Building dashboard payload for', dateRange);
        const overview = await getOverviewMetrics(dateRange);
        if (!overview.measured) {
            return { measured: false, reason: overview.reason, dateRange };
        }
        const [breakdown, funnel] = await Promise.all([
            getChannelBreakdown(dateRange),
            getFunnelMetrics(),
        ]);
        return {
            measured: true,
            dateRange,
            kpis: {
                conversions:   { value: overview.conversions, measured: true },
                revenue:       { value: overview.revenue, measured: true },
                traffic:       { value: overview.traffic, measured: true },
                avgOrderValue: { value: overview.avgOrderValue, measured: overview.avgOrderValue !== null },
                // Named honestly: these need ad spend and repeat-purchase data
                // that no connected source provides.
                roi: { value: null, measured: false, reason: 'Needs ad spend, which Google Analytics does not hold.' },
                ltv: { value: null, measured: false, reason: 'Needs repeat-purchase history per customer.' },
            },
            channels: breakdown.measured ? breakdown.channels : null,
            channelsReason: breakdown.measured ? null : breakdown.reason,
            funnel: funnel.measured ? funnel.stages : null,
            funnelReason: funnel.measured ? null : funnel.reason,
            attribution: getAttributionReport('linear'),
            goals: getGoals(),
        };
    }

    /**
     * Insights for the dashboard's "AI Insights" panel.
     * @returns {Promise<Object>} { measured, reason } or { measured, insights }.
     */
    async function getAIInsights(dateRange = 'last-30d') {
        const result = await generateInsights(dateRange);
        if (!result.measured) return result;
        return { measured: true, insights: result.insights || [], generatedAt: result.generatedAt };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.MarketingAnalyticsService = {
        // 0. Dashboard facade
        getDashboardData,
        getAIInsights,

        // 1. Cross-Channel Dashboard
        getOverviewMetrics,
        getChannelBreakdown,
        getChannelTrends,
        compareChannels,

        // 2. Attribution Modeling
        getAttributionReport,
        computeAttribution,
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
