/**
 * Brand & Positioning Agent Service
 * Manages brand identity, guidelines, monitoring, messaging frameworks, and brand health.
 * Part of "The Marketing Department 2026" platform.
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[Brand]';
    const STORAGE_KEYS = {
        guidelines: 'brand-guidelines',
        messaging: 'brand-messaging-framework',
        assets: 'brand-assets',
        voiceProfile: 'brand-voice-profile',
        healthCache: 'brand-health-cache',
        mentions: 'brand-mentions',
        alerts: 'brand-reputation-alerts'
    };
    const ASSET_CATEGORIES = [
        'logos', 'colors', 'fonts', 'templates',
        'photography', 'icons', 'social-templates'
    ];

    // --------------- Helpers ---------------

    /** @param {string} key @returns {any|null} Parsed localStorage value */
    function loadStorage(key) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (err) { console.error(LOG_PREFIX, 'Storage read error:', err); return null; }
    }

    /** @param {string} key @param {any} value */
    function saveStorage(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (err) { console.error(LOG_PREFIX, 'Storage write error:', err); }
    }

    /** @param {string} prompt @param {object} [opts] @returns {Promise<string>} AI result */
    async function aiGenerate(prompt, opts) {
        var options = Object.assign({ maxTokens: 2000, temperature: 0.5 }, opts || {});
        if (!window.AIService?.AI?.generate) {
            console.warn(LOG_PREFIX, 'AIService not available – returning empty result');
            return '';
        }
        try {
            var result = await window.AIService.AI.generate(prompt, options);
            return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (err) { console.error(LOG_PREFIX, 'AI generation failed:', err); throw err; }
    }

    /** @returns {object} Current project context */
    function getProjectContext() {
        try {
            var p = window.ProjectService?.getCurrentProject?.() || {};
            return { name: p.name || '', industry: p.industry || '', website: p.website || '' };
        } catch (_) { return {}; }
    }

    /** @param {string} path @param {any} fallback @returns {any} APP_CONFIG value */
    function getConfig(path, fallback) {
        try { return path.split('.').reduce(function (o, k) { return (o || {})[k]; }, window.APP_CONFIG) ?? fallback; }
        catch (_) { return fallback; }
    }

    /** @param {string} raw @returns {object} Parsed JSON or fallback */
    function safeParse(raw) {
        try { return JSON.parse(raw); } catch (_) { return { raw: raw }; }
    }

    // =======================================
    // 1. Brand Guidelines
    // =======================================

    /** @returns {object|null} Brand guidelines (mission, vision, values, voice, tone, colors, typography, imagery) */
    function getGuidelines() {
        console.log(LOG_PREFIX, 'Loading brand guidelines');
        return loadStorage(STORAGE_KEYS.guidelines);
    }

    /** @param {object} guidelines @returns {object} Saved guidelines with timestamp */
    function saveGuidelines(guidelines) {
        if (!guidelines || typeof guidelines !== 'object') throw new Error('Guidelines must be a valid object');
        var record = Object.assign({}, guidelines, { updatedAt: new Date().toISOString() });
        saveStorage(STORAGE_KEYS.guidelines, record);
        console.log(LOG_PREFIX, 'Guidelines saved successfully');
        return record;
    }

    /** @param {object} companyInfo - name, description, industry, audience @returns {Promise<object>} AI-generated guidelines */
    async function generateGuidelines(companyInfo) {
        console.log(LOG_PREFIX, 'Generating brand guidelines via AI');
        var ctx = getProjectContext();
        var prompt = [
            'Generate comprehensive brand guidelines in JSON format for the following company.',
            'Company Name: ' + (companyInfo.name || ctx.name || 'N/A'),
            'Industry: ' + (companyInfo.industry || ctx.industry || 'N/A'),
            'Description: ' + (companyInfo.description || ''),
            'Target Audience: ' + (companyInfo.audience || ''),
            '', 'Return a JSON object with keys: mission, vision, values (array),',
            'voice (object with personality, tone, language), tone (object with formal/informal scale, humor, emotion),',
            'colors (object with primary, secondary, accent, neutrals),',
            'typography (object with headings, body, accents),',
            'imagery (object with style, subjects, moodKeywords). Respond ONLY with valid JSON.'
        ].join('\n');
        var raw = await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.6 });
        var parsed = safeParse(raw);
        if (!parsed.raw) {
            parsed.generatedAt = new Date().toISOString();
            saveStorage(STORAGE_KEYS.guidelines, parsed);
            console.log(LOG_PREFIX, 'AI guidelines generated and saved');
        }
        return parsed;
    }

    /** @param {string} content @returns {Promise<object>} Consistency report with score and recommendations */
    async function checkBrandConsistency(content) {
        console.log(LOG_PREFIX, 'Checking brand consistency');
        var guidelines = getGuidelines();
        if (!guidelines) return { score: 0, note: 'No brand guidelines saved yet.' };
        var prompt = [
            'Evaluate the following content for brand consistency against the brand guidelines.',
            '', 'Brand Guidelines:', JSON.stringify(guidelines, null, 2),
            '', 'Content to evaluate:', content,
            '', 'Return JSON with: score (0-100), voiceMatch (boolean), toneMatch (boolean),',
            'issues (array of strings), recommendations (array of strings). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1500, temperature: 0.3 }));
    }

    // =======================================
    // 2. Messaging Framework
    // =======================================

    /** @returns {object|null} Saved messaging framework */
    function getMessagingFramework() {
        console.log(LOG_PREFIX, 'Loading messaging framework');
        return loadStorage(STORAGE_KEYS.messaging);
    }

    /** @param {object} framework @returns {object} Saved framework */
    function saveMessagingFramework(framework) {
        if (!framework || typeof framework !== 'object') throw new Error('Framework must be a valid object');
        var record = Object.assign({}, framework, { updatedAt: new Date().toISOString() });
        saveStorage(STORAGE_KEYS.messaging, record);
        console.log(LOG_PREFIX, 'Messaging framework saved');
        return record;
    }

    /** @param {string} product @param {string} audience @param {string[]} differentiators @returns {Promise<object>} */
    async function generateValueProposition(product, audience, differentiators) {
        console.log(LOG_PREFIX, 'Generating value proposition');
        var prompt = [
            'Create a compelling value proposition for "' + product + '".',
            'Target audience: ' + audience,
            'Key differentiators: ' + (differentiators || []).join(', '),
            '', 'Return JSON with: headline, subheadline, supportingPoints (array), fullStatement.',
            'Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1000, temperature: 0.6 }));
    }

    /** @param {object|string} brand @param {number} [count=5] @returns {Promise<object[]>} Tagline suggestions */
    async function generateTaglines(brand, count) {
        count = count || 5;
        console.log(LOG_PREFIX, 'Generating ' + count + ' tagline suggestions');
        var name = typeof brand === 'string' ? brand : (brand.name || '');
        var desc = typeof brand === 'object' ? (brand.description || '') : '';
        var prompt = [
            'Generate ' + count + ' creative tagline options for the brand "' + name + '".',
            'Brand description: ' + desc,
            'Return a JSON array of objects each with: tagline, rationale. Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1000, temperature: 0.8 }));
    }

    /** @param {object} company @param {string} [duration='30s'] - '30s', '60s', or '2min' @returns {Promise<object>} */
    async function generateElevatorPitch(company, duration) {
        duration = duration || '30s';
        console.log(LOG_PREFIX, 'Generating ' + duration + ' elevator pitch');
        var words = { '30s': 75, '60s': 150, '2min': 300 }[duration] || 75;
        var prompt = [
            'Write a ' + duration + ' elevator pitch (~' + words + ' words) for the following company.',
            'Company: ' + (company.name || '') + ' | Industry: ' + (company.industry || ''),
            'Product/Service: ' + (company.product || '') + ' | Unique value: ' + (company.uniqueValue || ''),
            '', 'Return JSON with: pitch, duration, wordCount, tips (array). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1000, temperature: 0.6 }));
    }

    /** @param {string[]} audiences @returns {Promise<object[]>} Tailored messaging per audience */
    async function generateMessagingByAudience(audiences) {
        console.log(LOG_PREFIX, 'Generating audience-specific messaging');
        var guidelines = getGuidelines();
        var prompt = [
            'Create tailored key messages for each of the following audience segments.',
            'Audiences: ' + (audiences || []).join(', '),
            guidelines ? ('Brand voice: ' + JSON.stringify(guidelines.voice || {})) : '',
            '', 'For each audience return: segment, headline, keyMessages (array), cta, tone.',
            'Return a JSON array. Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.5 }));
    }

    /** @param {string} product @param {string} market @param {string} differentiator @returns {Promise<object>} */
    async function generatePositioningStatement(product, market, differentiator) {
        console.log(LOG_PREFIX, 'Generating positioning statement');
        var prompt = [
            'Create a brand positioning statement using the classic format:',
            '"For [target market] who [need], [product] is a [category] that [benefit].',
            'Unlike [competitors], [product] [differentiator]."',
            '', 'Product: ' + product + ' | Target market: ' + market + ' | Key differentiator: ' + differentiator,
            '', 'Return JSON with: statement, targetMarket, category, benefit, differentiator.',
            'Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 800, temperature: 0.5 }));
    }

    // =======================================
    // 3. Brand Health Monitoring
    // =======================================

    /** @returns {Promise<object>} Health metrics: awareness, sentiment, shareOfVoice, loyalty, overall */
    async function getBrandHealthScore() {
        console.log(LOG_PREFIX, 'Calculating brand health score');
        var cached = loadStorage(STORAGE_KEYS.healthCache);
        var maxAge = getConfig('brand.healthCacheTTL', 3600000);
        if (cached && Date.now() - new Date(cached.calculatedAt).getTime() < maxAge) {
            console.log(LOG_PREFIX, 'Returning cached health score');
            return cached;
        }
        var ctx = getProjectContext();
        var prompt = [
            'Estimate brand health metrics for "' + (ctx.name || 'the brand') + '" in the ' + (ctx.industry || 'general') + ' industry.',
            'Return JSON with: awareness (0-100), sentiment (0-100), shareOfVoice (0-100),',
            'loyalty (0-100), overall (0-100), trends (object with each metric trend: up/down/stable),',
            'summary (string). Respond ONLY with valid JSON.'
        ].join('\n');
        var result = safeParse(await aiGenerate(prompt, { maxTokens: 1000, temperature: 0.4 }));
        if (!result.raw) {
            result.calculatedAt = new Date().toISOString();
            saveStorage(STORAGE_KEYS.healthCache, result);
        }
        return result;
    }

    /** @param {string} [period='30d'] - '7d', '30d', '90d' @returns {Promise<object>} Sentiment breakdown */
    async function getSentimentAnalysis(period) {
        period = period || '30d';
        console.log(LOG_PREFIX, 'Running sentiment analysis for period: ' + period);
        var ctx = getProjectContext();
        var prompt = [
            'Provide a brand sentiment analysis for "' + (ctx.name || 'the brand') + '" over the last ' + period + '.',
            'Return JSON with: overall (positive/negative/neutral), score (-1 to 1),',
            'breakdown (object with positive%, negative%, neutral%), topThemes (array),',
            'notableChanges (array of strings). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1200, temperature: 0.4 }));
    }

    /** @param {string[]} competitors @returns {Promise<object>} Share of voice by brand and channel */
    async function getShareOfVoice(competitors) {
        console.log(LOG_PREFIX, 'Analyzing share of voice');
        var ctx = getProjectContext();
        var prompt = [
            'Estimate share of voice for "' + (ctx.name || 'our brand') + '" compared to: ' + (competitors || []).join(', ') + '.',
            'Return JSON with: brand (object with name, percentage), competitors (array of {name, percentage}),',
            'channels (object with search, social, media percentages), insights (array). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1200, temperature: 0.4 }));
    }

    /** @param {object} dateRange - { start, end } ISO strings @returns {object[]} Filtered mention records */
    function getBrandMentions(dateRange) {
        console.log(LOG_PREFIX, 'Fetching brand mentions');
        var all = loadStorage(STORAGE_KEYS.mentions) || [];
        if (!dateRange || (!dateRange.start && !dateRange.end)) return all;
        var start = dateRange.start ? new Date(dateRange.start).getTime() : 0;
        var end = dateRange.end ? new Date(dateRange.end).getTime() : Date.now();
        return all.filter(function (m) {
            var ts = new Date(m.date).getTime();
            return ts >= start && ts <= end;
        });
    }

    /** @returns {object[]} Reputation alerts for negative sentiment or PR issues */
    function getReputationAlerts() {
        console.log(LOG_PREFIX, 'Loading reputation alerts');
        return loadStorage(STORAGE_KEYS.alerts) || [];
    }

    // =======================================
    // 4. Competitive Brand Analysis
    // =======================================

    /** @param {string[]} competitors @returns {Promise<object[]>} Competitor brand profiles */
    async function getCompetitorBrands(competitors) {
        console.log(LOG_PREFIX, 'Fetching competitor brand profiles');
        var prompt = [
            'Provide brand profiles for these competitors: ' + (competitors || []).join(', ') + '.',
            'For each return: name, tagline, positioning, targetAudience, strengths (array),',
            'weaknesses (array), brandPersonality. Return a JSON array. Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.4 }));
    }

    /** @param {string[]} competitors @returns {Promise<object>} Side-by-side brand comparison */
    async function generateBrandComparison(competitors) {
        console.log(LOG_PREFIX, 'Generating brand comparison');
        var ctx = getProjectContext();
        var prompt = [
            'Create a side-by-side brand comparison between "' + (ctx.name || 'our brand') + '" and: ' + (competitors || []).join(', ') + '.',
            'Compare on: positioning, messaging, visual identity, target audience, perceived value, digital presence.',
            'Return JSON with: dimensions (array of {dimension, brands: {name: rating}}),',
            'summary, opportunityGaps (array). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.5 }));
    }

    /** @param {string[]} competitors @returns {Promise<object>} Differentiators with strength ratings */
    async function identifyDifferentiators(competitors) {
        console.log(LOG_PREFIX, 'Identifying brand differentiators');
        var ctx = getProjectContext();
        var guidelines = getGuidelines();
        var prompt = [
            'Identify unique brand differentiators for "' + (ctx.name || 'our brand') + '" against: ' + (competitors || []).join(', ') + '.',
            guidelines ? ('Our brand values: ' + JSON.stringify(guidelines.values || [])) : '',
            'Return JSON with: differentiators (array of {area, description, strength: 1-10}),',
            'underutilized (array), recommendations (array). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1500, temperature: 0.5 }));
    }

    /** @param {string} competitor @returns {Promise<object>} Competitive battlecard */
    async function generateBattlecard(competitor) {
        console.log(LOG_PREFIX, 'Generating battlecard for: ' + competitor);
        var ctx = getProjectContext();
        var prompt = [
            'Create a competitive battlecard for "' + (ctx.name || 'our brand') + '" vs "' + competitor + '".',
            'Include: overview, strengths, weaknesses, commonObjections (array of {objection, response}),',
            'winStrategies (array), landmines (array), keyDifferentiators (array), pricingNotes.',
            'Return as JSON. Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.5 }));
    }

    // =======================================
    // 5. Brand Assets Management
    // =======================================

    /** @returns {object[]} All brand assets */
    function getAssets() {
        console.log(LOG_PREFIX, 'Loading brand assets');
        return loadStorage(STORAGE_KEYS.assets) || [];
    }

    /** @param {object} asset - { name, type, url, category } @returns {object} Saved asset with id */
    function addAsset(asset) {
        if (!asset || !asset.name || !asset.category) {
            throw new Error('Asset must include at least name and category');
        }
        if (ASSET_CATEGORIES.indexOf(asset.category) === -1) {
            console.warn(LOG_PREFIX, 'Unknown category "' + asset.category + '". Allowed: ' + ASSET_CATEGORIES.join(', '));
        }
        var assets = getAssets();
        var record = Object.assign({}, asset, {
            id: 'asset-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
            createdAt: new Date().toISOString()
        });
        assets.push(record);
        saveStorage(STORAGE_KEYS.assets, assets);
        console.log(LOG_PREFIX, 'Asset added: ' + record.name + ' [' + record.category + ']');
        return record;
    }

    /** @param {string} category @returns {object[]} Assets filtered by category */
    function getAssetsByCategory(category) {
        console.log(LOG_PREFIX, 'Filtering assets by category: ' + category);
        return getAssets().filter(function (a) { return a.category === category; });
    }

    // =======================================
    // 6. Brand Voice
    // =======================================

    /** @returns {object|null} Brand voice profile (personality traits, do/don't, example phrases) */
    function getVoiceProfile() {
        console.log(LOG_PREFIX, 'Loading voice profile');
        return loadStorage(STORAGE_KEYS.voiceProfile);
    }

    /** @param {object} profile @returns {object} Saved voice profile with timestamp */
    function saveVoiceProfile(profile) {
        if (!profile || typeof profile !== 'object') throw new Error('Voice profile must be a valid object');
        var record = Object.assign({}, profile, { updatedAt: new Date().toISOString() });
        saveStorage(STORAGE_KEYS.voiceProfile, record);
        console.log(LOG_PREFIX, 'Voice profile saved');
        return record;
    }

    /** @param {string[]} contentSamples @returns {Promise<object>} Consistency score and detected traits */
    async function analyzeVoiceConsistency(contentSamples) {
        console.log(LOG_PREFIX, 'Analyzing voice consistency across ' + (contentSamples || []).length + ' samples');
        var voiceProfile = getVoiceProfile();
        var prompt = [
            'Analyze the following content samples for brand voice consistency.',
            voiceProfile ? ('Target voice profile: ' + JSON.stringify(voiceProfile)) : '',
            '', 'Content samples:',
            (contentSamples || []).map(function (s, i) { return (i + 1) + '. ' + s.substring(0, 500); }).join('\n\n'),
            '', 'Return JSON with: overallConsistency (0-100), voiceTraitsDetected (array),',
            'inconsistencies (array of {sample, issue}), recommendations (array). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 1500, temperature: 0.4 }));
    }

    /** @param {string} content @returns {Promise<object>} Rewritten content with changes and voice score */
    async function rewriteInBrandVoice(content) {
        console.log(LOG_PREFIX, 'Rewriting content in brand voice');
        var voiceProfile = getVoiceProfile();
        var guidelines = getGuidelines();
        var prompt = [
            'Rewrite the following content to match the brand voice described below.',
            voiceProfile ? ('Voice profile: ' + JSON.stringify(voiceProfile)) : '',
            guidelines ? ('Brand tone: ' + JSON.stringify(guidelines.tone || {})) : '',
            '', 'Original content:', content,
            '', 'Return JSON with: rewritten (string), changesApplied (array of strings),',
            'voiceScore (0-100 how well it now matches). Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.5 }));
    }

    /** @returns {Promise<object>} Comprehensive writing style guide */
    async function generateStyleGuide() {
        console.log(LOG_PREFIX, 'Generating writing style guide');
        var guidelines = getGuidelines();
        var voiceProfile = getVoiceProfile();
        var prompt = [
            'Create a comprehensive writing style guide for a brand with the following attributes.',
            guidelines ? ('Brand guidelines: ' + JSON.stringify(guidelines)) : 'No existing guidelines.',
            voiceProfile ? ('Voice profile: ' + JSON.stringify(voiceProfile)) : '',
            '', 'Include sections: voicePrinciples (array), grammarRules (array),',
            'formattingGuidelines (array), wordChoiceDos (array), wordChoiceDonts (array),',
            'examplePhrases (array of {context, preferred, avoid}),',
            'toneByChannel (object with email, social, web, ads). Return as JSON. Respond ONLY with valid JSON.'
        ].join('\n');
        return safeParse(await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.5 }));
    }

    // =======================================
    // Public API
    // =======================================

    window.BrandService = {
        // Brand Guidelines
        getGuidelines: getGuidelines,
        saveGuidelines: saveGuidelines,
        generateGuidelines: generateGuidelines,
        checkBrandConsistency: checkBrandConsistency,
        // Messaging Framework
        getMessagingFramework: getMessagingFramework,
        saveMessagingFramework: saveMessagingFramework,
        generateValueProposition: generateValueProposition,
        generateTaglines: generateTaglines,
        generateElevatorPitch: generateElevatorPitch,
        generateMessagingByAudience: generateMessagingByAudience,
        generatePositioningStatement: generatePositioningStatement,
        // Brand Health Monitoring
        getBrandHealthScore: getBrandHealthScore,
        getSentimentAnalysis: getSentimentAnalysis,
        getShareOfVoice: getShareOfVoice,
        getBrandMentions: getBrandMentions,
        getReputationAlerts: getReputationAlerts,
        // Competitive Brand Analysis
        getCompetitorBrands: getCompetitorBrands,
        generateBrandComparison: generateBrandComparison,
        identifyDifferentiators: identifyDifferentiators,
        generateBattlecard: generateBattlecard,
        // Brand Assets Management
        getAssets: getAssets,
        addAsset: addAsset,
        getAssetsByCategory: getAssetsByCategory,
        ASSET_CATEGORIES: ASSET_CATEGORIES,
        // Brand Voice
        getVoiceProfile: getVoiceProfile,
        saveVoiceProfile: saveVoiceProfile,
        analyzeVoiceConsistency: analyzeVoiceConsistency,
        rewriteInBrandVoice: rewriteInBrandVoice,
        generateStyleGuide: generateStyleGuide
    };

    console.log(LOG_PREFIX, 'BrandService initialized | Methods:', Object.keys(window.BrandService).length);
})();
