/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTENT STRATEGY SERVICE - Content Creation & Editorial Management
 * The Marketing Department 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages the full content lifecycle:
 * - Editorial Calendar (CRUD with localStorage persistence)
 * - AI-Powered Content Brief Generation
 * - Content Performance Analytics
 * - Topic Authority & Cluster Mapping
 *
 * Integrations: window.AIService, window.ProjectService, window.APP_CONFIG
 */
(function () {
    'use strict';

    var TAG = '[ContentStrategy]';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    var STORAGE_KEYS = {
        CALENDAR: 'content-calendar',
        PERFORMANCE: 'content-performance',
        TOPICS: 'content-topics',
        BRIEFS: 'content-briefs'
    };

    /** @type {string[]} Supported content types across the platform */
    var CONTENT_TYPES = [
        'blog', 'social-post', 'email', 'landing-page', 'video-script',
        'podcast-outline', 'infographic-brief', 'whitepaper', 'case-study',
        'press-release'
    ];

    var CALENDAR_STATUSES = ['idea', 'planned', 'in-progress', 'review', 'approved', 'published'];

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /** @param {string} key  @param {*} fallback  @returns {*} */
    function storageGet(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : (fallback !== undefined ? fallback : null);
        } catch (err) {
            console.warn(TAG, 'Storage read error for', key, err);
            return fallback !== undefined ? fallback : null;
        }
    }

    /** @param {string} key  @param {*} value */
    function storageSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.error(TAG, 'Storage write error for', key, err);
        }
        // Async persist to Supabase via MarketingStore
        if (window.MarketingStore) {
            window.MarketingStore.set('content', key, value).catch(function(e) {
                console.warn(TAG, 'MarketingStore persist failed:', e.message);
            });
        }
    }

    /** Async load from Supabase (falls back to localStorage) */
    async function storageGetAsync(key, fallback) {
        if (window.MarketingStore) {
            try {
                var data = await window.MarketingStore.get('content', key, null);
                if (data !== null) {
                    try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
                    return data;
                }
            } catch (e) { console.warn(TAG, 'MarketingStore load failed:', e.message); }
        }
        return storageGet(key, fallback);
    }

    /** Generate a unique identifier */
    function generateId() {
        return 'cs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    /** Get the active project name for AI prompt context */
    function getProjectContext() {
        try {
            var p = window.ProjectService?.getCurrentProject?.();
            return p?.name || p?.domain || 'the client';
        } catch (_) { return 'the client'; }
    }

    /**
     * Call the AI backend. Falls back to a placeholder when unavailable.
     * @param {string} prompt
     * @param {object} [opts] - { maxTokens, temperature }
     * @returns {Promise<string>}
     */
    async function aiGenerate(prompt, opts) {
        var o = opts || {};
        if (window.AIService?.isAvailable()) {
            try {
                var result = await window.AIService.AI.generate(prompt, {
                    maxTokens: o.maxTokens || 2000,
                    temperature: o.temperature || 0.7
                });
                return result;
            } catch (err) {
                console.error(TAG, 'AI generation failed:', err);
            }
        } else {
            console.warn(TAG, 'AIService unavailable — returning template response');
        }
        return '[AI-generated content unavailable] Prompt: ' + prompt.slice(0, 120) + '...';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. EDITORIAL CALENDAR
    // ═══════════════════════════════════════════════════════════════════════════

    /** @returns {Array<object>} Full calendar from storage */
    function loadCalendar() { return storageGet(STORAGE_KEYS.CALENDAR, []); }

    /** @param {Array<object>} items */
    function saveCalendar(items) { storageSet(STORAGE_KEYS.CALENDAR, items); }

    /**
     * Get calendar items for a specific month and year.
     * @param {number} month - 1-12
     * @param {number} year  - e.g. 2026
     * @returns {Array<object>} Matching items sorted by date ascending
     */
    function getCalendar(month, year) {
        console.log(TAG, 'Loading calendar for ' + year + '-' + String(month).padStart(2, '0'));
        var filtered = loadCalendar().filter(function (item) {
            var d = new Date(item.date);
            return d.getMonth() + 1 === month && d.getFullYear() === year;
        });
        filtered.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
        console.log(TAG, 'Found ' + filtered.length + ' calendar items');
        return filtered;
    }

    /**
     * Add a content piece to the editorial calendar.
     * @param {object} item - { title, type, channel, date, status?, assignee? }
     * @returns {object} Created calendar item with generated id
     */
    function addCalendarItem(item) {
        if (!item || !item.title || !item.date) {
            throw new Error('Calendar item requires at least a title and date');
        }
        var entry = {
            id: generateId(),
            title: item.title,
            type: CONTENT_TYPES.includes(item.type) ? item.type : 'blog',
            channel: item.channel || 'organic',
            date: item.date,
            status: CALENDAR_STATUSES.includes(item.status) ? item.status : 'planned',
            assignee: item.assignee || 'Unassigned',
            createdAt: new Date().toISOString()
        };
        var all = loadCalendar();
        all.push(entry);
        saveCalendar(all);
        console.log(TAG, 'Added calendar item:', entry.id, entry.title);
        return entry;
    }

    /**
     * Update an existing calendar item by id.
     * @param {string} id      - Item identifier
     * @param {object} updates - Fields to merge
     * @returns {object|null} Updated item or null if not found
     */
    function updateCalendarItem(id, updates) {
        var all = loadCalendar();
        var idx = all.findIndex(function (i) { return i.id === id; });
        if (idx === -1) { console.warn(TAG, 'Calendar item not found:', id); return null; }
        var safe = Object.assign({}, updates);
        if (safe.type && !CONTENT_TYPES.includes(safe.type)) delete safe.type;
        if (safe.status && !CALENDAR_STATUSES.includes(safe.status)) delete safe.status;
        delete safe.id;
        all[idx] = Object.assign({}, all[idx], safe, { id: id, updatedAt: new Date().toISOString() });
        saveCalendar(all);
        console.log(TAG, 'Updated calendar item:', id);
        return all[idx];
    }

    /**
     * Delete a calendar item by id.
     * @param {string} id
     * @returns {boolean} True if item was found and removed
     */
    function deleteCalendarItem(id) {
        var all = loadCalendar();
        var filtered = all.filter(function (i) { return i.id !== id; });
        if (filtered.length === all.length) {
            console.warn(TAG, 'Calendar item not found for deletion:', id);
            return false;
        }
        saveCalendar(filtered);
        console.log(TAG, 'Deleted calendar item:', id);
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. CONTENT BRIEF GENERATION (AI-POWERED)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate a comprehensive content brief for a given topic.
     * @param {string} topic          - Primary topic
     * @param {string} contentType    - One of CONTENT_TYPES
     * @param {string} targetAudience - Audience description
     * @returns {Promise<string>} AI-generated content brief in Markdown
     */
    async function generateContentBrief(topic, contentType, targetAudience) {
        console.log(TAG, 'Generating content brief:', topic, contentType, targetAudience);
        var prompt = [
            'You are a senior content strategist working for ' + getProjectContext() + '.',
            'Create a detailed content brief for: "' + topic + '"',
            'Content type: ' + (contentType || 'blog'),
            'Target audience: ' + (targetAudience || 'general audience'),
            '',
            'Include these sections:',
            '1. Objective & KPIs',
            '2. Target audience persona snapshot',
            '3. Key messages (3-5 bullet points)',
            '4. SEO keywords (primary + secondary)',
            '5. Content outline with section headings',
            '6. Tone and style guidance',
            '7. Call-to-action recommendation',
            '8. Distribution channels',
            '9. Competitive references (2-3)',
            '10. Success metrics',
            '',
            'Format in clean Markdown.'
        ].join('\n');
        var brief = await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.7 });
        saveBrief({ topic: topic, contentType: contentType, targetAudience: targetAudience, brief: brief });
        return brief;
    }

    /**
     * Generate a structured blog post outline with SEO considerations.
     * @param {string} topic      - Blog post topic
     * @param {string[]} keywords - Target SEO keywords
     * @returns {Promise<string>} AI-generated outline
     */
    async function generateBlogOutline(topic, keywords) {
        console.log(TAG, 'Generating blog outline for:', topic);
        var kwList = Array.isArray(keywords) ? keywords.join(', ') : (keywords || '');
        var lines = ['Create a detailed blog post outline for: "' + topic + '"'];
        if (kwList) lines.push('Target keywords: ' + kwList);
        lines.push(
            '', 'Provide:',
            '- A compelling working title (H1)',
            '- Meta description (under 160 characters)',
            '- Introduction hook',
            '- 5-8 main sections with H2 headings and 2-3 sub-points each',
            '- Key statistics or data points to include',
            '- Conclusion with CTA',
            '- Internal and external linking suggestions',
            '', 'Format in Markdown.'
        );
        return aiGenerate(lines.join('\n'), { maxTokens: 1500, temperature: 0.7 });
    }

    /**
     * Generate social media posts tailored to multiple platforms.
     * @param {string} topic       - Content topic
     * @param {string[]} platforms - e.g. ['twitter', 'linkedin', 'instagram']
     * @returns {Promise<string>} Posts per platform in Markdown
     */
    async function generateSocialPosts(topic, platforms) {
        var platList = Array.isArray(platforms) ? platforms : ['twitter', 'linkedin', 'instagram'];
        console.log(TAG, 'Generating social posts for:', topic, 'on', platList.join(', '));
        var prompt = [
            'Create engaging social media posts about: "' + topic + '"',
            'Platforms: ' + platList.join(', '),
            '', 'For each platform provide:',
            '- Primary post copy (respecting character limits)',
            '- 3-5 relevant hashtags',
            '- Suggested image or media description',
            '- Best time to post recommendation',
            '- One alternative variation',
            '', "Adapt tone and format to each platform's best practices. Format in Markdown."
        ].join('\n');
        return aiGenerate(prompt, { maxTokens: 1500, temperature: 0.8 });
    }

    /**
     * Generate email marketing copy with A/B test variants.
     * @param {string} purpose  - e.g. 'product launch', 'newsletter'
     * @param {string} audience - Target audience description
     * @returns {Promise<string>} AI-generated email copy
     */
    async function generateEmailCopy(purpose, audience) {
        console.log(TAG, 'Generating email copy:', purpose);
        var prompt = [
            'Write marketing email copy for: "' + purpose + '"',
            'Target audience: ' + (audience || 'general subscribers'),
            '', 'Include:',
            '- Subject line (plus 2 A/B test variants)',
            '- Preview text',
            '- Email body with clear structure',
            '- Primary CTA button text',
            '- P.S. line',
            '', 'Tone: professional yet conversational. Format in Markdown.'
        ].join('\n');
        return aiGenerate(prompt, { maxTokens: 1200, temperature: 0.7 });
    }

    /**
     * Generate advertising copy for a specific platform and objective.
     * @param {string} product   - Product or service name
     * @param {string} platform  - e.g. 'google-ads', 'meta', 'linkedin'
     * @param {string} objective - e.g. 'conversions', 'awareness'
     * @returns {Promise<string>} AI-generated ad copy variants
     */
    async function generateAdCopy(product, platform, objective) {
        console.log(TAG, 'Generating ad copy:', product, platform, objective);
        var prompt = [
            'Create advertising copy for: "' + product + '"',
            'Platform: ' + (platform || 'google-ads'),
            'Objective: ' + (objective || 'conversions'),
            '', 'Provide 3 ad variations, each with:',
            '- Headline(s) respecting platform character limits',
            '- Description / body text',
            '- Display URL path (if applicable)',
            '- Call-to-action',
            '', 'Include a brief rationale for each variation. Format in Markdown.'
        ].join('\n');
        return aiGenerate(prompt, { maxTokens: 1200, temperature: 0.75 });
    }

    /** Persist a generated brief to localStorage history (max 50 entries). */
    function saveBrief(data) {
        var history = storageGet(STORAGE_KEYS.BRIEFS, []);
        history.unshift({
            id: generateId(), topic: data.topic, contentType: data.contentType,
            targetAudience: data.targetAudience, brief: data.brief,
            createdAt: new Date().toISOString()
        });
        if (history.length > 50) history.length = 50;
        storageSet(STORAGE_KEYS.BRIEFS, history);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. CONTENT PERFORMANCE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Retrieve aggregate content performance metrics.
     * @returns {object} Performance summary keyed by content type
     */
    function getContentPerformance() {
        console.log(TAG, 'Loading content performance metrics');
        var stored = storageGet(STORAGE_KEYS.PERFORMANCE, null);
        if (stored && stored.updatedAt) return stored;

        var defaults = {
            totalPieces: 0, publishedPieces: 0, totalViews: 0,
            totalShares: 0, totalConversions: 0, avgEngagementRate: 0,
            byType: {}, updatedAt: new Date().toISOString()
        };
        CONTENT_TYPES.forEach(function (type) {
            defaults.byType[type] = { count: 0, views: 0, shares: 0, conversions: 0 };
        });
        storageSet(STORAGE_KEYS.PERFORMANCE, defaults);
        return defaults;
    }

    /**
     * Get best performing content sorted by a given metric.
     * @param {string} metric  - 'views' | 'shares' | 'conversions' | 'engagement'
     * @param {number} [limit=10]
     * @returns {Array<object>} Sorted content type entries
     */
    function getTopContent(metric, limit) {
        var count = (typeof limit === 'number' && limit > 0) ? limit : 10;
        console.log(TAG, 'Getting top ' + count + ' content by ' + metric);
        var perf = getContentPerformance();
        var entries = Object.keys(perf.byType).map(function (type) {
            return Object.assign({ type: type }, perf.byType[type]);
        }).filter(function (item) {
            return typeof item[metric] === 'number';
        });
        entries.sort(function (a, b) { return (b[metric] || 0) - (a[metric] || 0); });
        return entries.slice(0, count);
    }

    /**
     * Use AI to identify content gaps relative to competitors.
     * @param {string|string[]} competitors - Competitor names or domains
     * @returns {Promise<string>} AI-generated gap analysis
     */
    async function getContentGaps(competitors) {
        var compList = Array.isArray(competitors) ? competitors.join(', ') : (competitors || 'top industry competitors');
        console.log(TAG, 'Analyzing content gaps against:', compList);
        var prompt = [
            'You are a content strategist for ' + getProjectContext() + '.',
            'Competitors: ' + compList,
            '', 'Identify content gaps by analyzing:',
            '1. Topics competitors cover that we likely do not',
            '2. Content formats we may be underutilizing',
            '3. Audience questions that remain unanswered',
            '4. Keyword opportunities with low competition',
            '5. Seasonal or trending topics to capitalize on',
            '', 'Provide actionable recommendations ranked by impact. Format in Markdown.'
        ].join('\n');
        return aiGenerate(prompt, { maxTokens: 1500, temperature: 0.7 });
    }

    /**
     * Analyze content quality using AI and return structured scores.
     * @param {string} content - Text to evaluate (min 20 chars)
     * @returns {Promise<string>} Quality analysis with dimension scores
     */
    async function analyzeContentQuality(content) {
        if (!content || typeof content !== 'string' || content.trim().length < 20) {
            throw new Error('Content must be a string of at least 20 characters');
        }
        console.log(TAG, 'Analyzing content quality, length:', content.length);
        var prompt = [
            'Evaluate the following content for quality. Score each dimension 1-10:',
            '', '1. Readability & clarity',
            '2. SEO optimization',
            '3. Engagement potential',
            '4. Originality',
            '5. Accuracy & credibility',
            '6. Structure & formatting',
            '7. CTA effectiveness',
            '', 'Provide an overall score (1-100), brief summary, and 3 improvement suggestions.',
            'Format as Markdown.',
            '', '--- CONTENT START ---',
            content.slice(0, 3000),
            '--- CONTENT END ---'
        ].join('\n');
        return aiGenerate(prompt, { maxTokens: 1000, temperature: 0.5 });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. TOPIC AUTHORITY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate a topic cluster map around a seed topic for pillar-page strategy.
     * @param {string} seedTopic - Central pillar topic
     * @returns {Promise<string>} AI-generated cluster structure
     */
    async function generateTopicClusters(seedTopic) {
        console.log(TAG, 'Generating topic clusters for:', seedTopic);
        var prompt = [
            'Build a comprehensive topic cluster map with "' + seedTopic + '" as the pillar.',
            '', 'Provide:',
            '1. Pillar page concept and working title',
            '2. 8-12 cluster subtopics with:',
            '   - Suggested title',
            '   - Primary keyword',
            '   - Content type recommendation',
            '   - Internal linking strategy to the pillar',
            '3. Supporting long-tail keyword opportunities',
            '4. Content creation priority order',
            '', 'Format as a structured Markdown document.'
        ].join('\n');
        var result = await aiGenerate(prompt, { maxTokens: 2000, temperature: 0.7 });

        // Persist topic cluster to history (max 30)
        var topics = storageGet(STORAGE_KEYS.TOPICS, []);
        topics.unshift({ id: generateId(), seedTopic: seedTopic, result: result, createdAt: new Date().toISOString() });
        if (topics.length > 30) topics.length = 30;
        storageSet(STORAGE_KEYS.TOPICS, topics);
        return result;
    }

    /**
     * Get AI-suggested content topics for a given industry and audience.
     * @param {string} industry - Industry vertical (e.g. 'SaaS', 'ecommerce')
     * @param {string} audience - Target audience description
     * @returns {Promise<string>} Ranked topic suggestions
     */
    async function getSuggestedTopics(industry, audience) {
        console.log(TAG, 'Getting suggested topics for:', industry);
        var lines = ['Suggest 15 high-potential content topics for the ' + (industry || 'digital marketing') + ' industry.'];
        if (audience) lines.push('Target audience: ' + audience);
        lines.push(
            '', 'For each topic provide:',
            '- Title idea',
            '- Estimated search demand (high / medium / low)',
            '- Competition level (high / medium / low)',
            '- Recommended content type',
            '- Brief angle or unique hook',
            '', 'Prioritize high demand + low-to-medium competition. Format as numbered Markdown list.'
        );
        return aiGenerate(lines.join('\n'), { maxTokens: 1500, temperature: 0.8 });
    }

    /**
     * Build a keyword-to-content mapping from the editorial calendar.
     * Extracts title keywords (>3 chars) and groups calendar items by keyword.
     * @returns {object} Map of keyword stems to content item references
     */
    function getKeywordToContentMap() {
        console.log(TAG, 'Building keyword-to-content map');
        var all = loadCalendar();
        var map = {};
        all.forEach(function (item) {
            var words = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/).filter(function (w) { return w.length > 3; });
            words.forEach(function (word) {
                if (!map[word]) map[word] = [];
                map[word].push({ id: item.id, title: item.title, type: item.type, status: item.status, date: item.date });
            });
        });
        console.log(TAG, 'Keyword map contains', Object.keys(map).length, 'keywords');
        return map;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    /** @namespace ContentStrategyService */
    window.ContentStrategyService = {
        // Constants
        CONTENT_TYPES: CONTENT_TYPES,
        CALENDAR_STATUSES: CALENDAR_STATUSES,

        // Editorial Calendar
        getCalendar: getCalendar,
        addCalendarItem: addCalendarItem,
        updateCalendarItem: updateCalendarItem,
        deleteCalendarItem: deleteCalendarItem,

        // Content Brief Generation (AI-powered)
        generateContentBrief: generateContentBrief,
        generateBlogOutline: generateBlogOutline,
        generateSocialPosts: generateSocialPosts,
        generateEmailCopy: generateEmailCopy,
        generateAdCopy: generateAdCopy,

        // Content Performance
        getContentPerformance: getContentPerformance,
        getTopContent: getTopContent,
        getContentGaps: getContentGaps,
        analyzeContentQuality: analyzeContentQuality,

        // Topic Authority
        generateTopicClusters: generateTopicClusters,
        getSuggestedTopics: getSuggestedTopics,
        getKeywordToContentMap: getKeywordToContentMap
    };

    console.log(TAG, 'Service initialized —', CONTENT_TYPES.length, 'content types supported');
})();
