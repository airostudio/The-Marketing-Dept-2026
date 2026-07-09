/**
 * Social Media Manager Agent Service
 * Audema Marketing 2026
 *
 * Manages social media content scheduling, AI-powered content generation,
 * platform analytics, engagement tracking, social listening, and reporting.
 *
 * @requires window.AIService   - OpenAI/Gemini AI integration
 * @requires window.ProjectService - Project data persistence
 * @requires window.APP_CONFIG  - Platform configuration (META, SOCIAL keys)
 */
(function () {
    'use strict';

    const TAG = '[SocialMedia]';

    /* ------------------------------------------------------------------ */
    /*  Supported platforms                                                */
    /* ------------------------------------------------------------------ */

    /** @type {string[]} */
    const PLATFORMS = [
        'facebook',
        'instagram',
        'twitter',
        'linkedin',
        'tiktok',
        'youtube',
        'pinterest'
    ];

    /** Platform-specific character limits */
    const PLATFORM_LIMITS = {
        facebook: 63206,
        instagram: 2200,
        twitter: 280,
        linkedin: 3000,
        tiktok: 2200,
        youtube: 5000,
        pinterest: 500
    };

    /** Platform display labels */
    const PLATFORM_LABELS = {
        facebook: 'Facebook',
        instagram: 'Instagram',
        twitter: 'Twitter / X',
        linkedin: 'LinkedIn',
        tiktok: 'TikTok',
        youtube: 'YouTube',
        pinterest: 'Pinterest'
    };

    /* ------------------------------------------------------------------ */
    /*  Local-storage helpers                                              */
    /* ------------------------------------------------------------------ */

    const STORAGE_KEYS = {
        posts: 'social-posts',
        mentions: 'social-mentions',
        platforms: 'social-platforms',
        metrics: 'social-metrics',
        calendar: 'social-calendar'
    };

    /**
     * Read a JSON value from localStorage.
     * @param {string} key
     * @param {*} fallback
     * @returns {*}
     */
    function storageGet(key, fallback) {
        if (fallback === undefined) { fallback = null; }
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            console.warn(TAG, 'Storage read error:', err.message);
            return fallback;
        }
    }

    /**
     * Write a JSON value to localStorage.
     * @param {string} key
     * @param {*} value
     */
    function storageSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            if (window.MarketingStore) { window.MarketingStore.set('social', key, value).catch(function(){}); }
        } catch (err) {
            console.error(TAG, 'Storage write error:', err.message);
        }
    }

    /**
     * Async read from Supabase via MarketingStore, falling back to localStorage.
     * @param {string} key
     * @param {*} fallback
     * @returns {Promise<*>}
     */
    async function storageGetAsync(key, fallback) {
        if (fallback === undefined) { fallback = null; }
        if (window.MarketingStore) {
            try {
                var data = await window.MarketingStore.get('social', key, null);
                if (data !== null && data !== undefined) {
                    try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {}
                    return data;
                }
            } catch (err) {
                console.warn(TAG, 'MarketingStore load failed:', err.message);
            }
        }
        return storageGet(key, fallback);
    }

    /* ------------------------------------------------------------------ */
    /*  AI helper                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Send a prompt to the connected AI service.
     * @param {string} prompt
     * @param {object} [opts]
     * @returns {Promise<string>}
     */
    async function aiGenerate(prompt, opts) {
        var defaults = { maxTokens: 1500, temperature: 0.7 };
        var merged = Object.assign({}, defaults, opts || {});
        try {
            if (window.AIService && window.AIService.AI && window.AIService.AI.generate) {
                var result = await window.AIService.AI.generate(prompt, merged);
                return typeof result === 'string' ? result : JSON.stringify(result);
            }
            console.warn(TAG, 'AIService not available - returning empty result');
            return '';
        } catch (err) {
            console.error(TAG, 'AI generation failed:', err.message);
            throw err;
        }
    }

    /**
     * Attempt to parse an AI response as JSON, falling back to raw text.
     * @param {string} text
     * @returns {object|string}
     */
    function parseAIJson(text) {
        try {
            var match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            var toParse = match ? match[1].trim() : text.trim();
            return JSON.parse(toParse);
        } catch (_) {
            return text;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Utility helpers                                                    */
    /* ------------------------------------------------------------------ */

    /** Generate a short unique id */
    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /** Get current ISO timestamp */
    function now() {
        return new Date().toISOString();
    }

    /** Resolve APP_CONFIG section safely */
    function cfg(section) {
        return (window.APP_CONFIG && window.APP_CONFIG[section]) || {};
    }

    /* ================================================================== */
    /*  1. CONTENT SCHEDULING                                              */
    /* ================================================================== */

    /**
     * Retrieve all posts, optionally filtered by a date range.
     * @param {{ start?: string, end?: string }} [dateRange]
     * @returns {object[]}
     */
    function getScheduledPosts(dateRange) {
        console.log(TAG, 'Fetching scheduled posts', dateRange || '(all)');
        var posts = storageGet(STORAGE_KEYS.posts, []);
        if (dateRange) {
            var startMs = dateRange.start ? new Date(dateRange.start).getTime() : 0;
            var endMs = dateRange.end ? new Date(dateRange.end).getTime() : Infinity;
            posts = posts.filter(function (p) {
                var t = new Date(p.scheduledDate).getTime();
                return t >= startMs && t <= endMs;
            });
        }
        return posts.sort(function (a, b) {
            return new Date(a.scheduledDate) - new Date(b.scheduledDate);
        });
    }

    /**
     * Schedule a new social media post.
     * @param {{ platform: string, content: string, media?: string[], scheduledDate: string, hashtags?: string[] }} post
     * @returns {object} The created post with generated id.
     */
    function schedulePost(post) {
        if (!post || !post.platform || !post.content || !post.scheduledDate) {
            throw new Error('platform, content, and scheduledDate are required');
        }
        if (PLATFORMS.indexOf(post.platform) === -1) {
            throw new Error('Unsupported platform: ' + post.platform);
        }
        var limit = PLATFORM_LIMITS[post.platform];
        if (post.content.length > limit) {
            console.warn(TAG, 'Content exceeds ' + post.platform + ' limit (' + limit + ' chars)');
        }

        var entry = {
            id: uid(),
            platform: post.platform,
            content: post.content,
            media: post.media || [],
            scheduledDate: post.scheduledDate,
            hashtags: post.hashtags || [],
            status: 'scheduled',
            createdAt: now(),
            updatedAt: now()
        };

        var posts = storageGet(STORAGE_KEYS.posts, []);
        posts.push(entry);
        storageSet(STORAGE_KEYS.posts, posts);
        console.log(TAG, 'Post scheduled:', entry.id, '->', PLATFORM_LABELS[post.platform]);
        return entry;
    }

    /**
     * Update an existing scheduled post.
     * @param {string} id
     * @param {object} updates
     * @returns {object|null}
     */
    function updatePost(id, updates) {
        var posts = storageGet(STORAGE_KEYS.posts, []);
        var idx = -1;
        for (var i = 0; i < posts.length; i++) {
            if (posts[i].id === id) { idx = i; break; }
        }
        if (idx === -1) {
            console.warn(TAG, 'Post not found:', id);
            return null;
        }
        Object.assign(posts[idx], updates, { updatedAt: now() });
        storageSet(STORAGE_KEYS.posts, posts);
        console.log(TAG, 'Post updated:', id);
        return posts[idx];
    }

    /**
     * Delete a scheduled post.
     * @param {string} id
     * @returns {boolean}
     */
    function deletePost(id) {
        var posts = storageGet(STORAGE_KEYS.posts, []);
        var before = posts.length;
        posts = posts.filter(function (p) { return p.id !== id; });
        if (posts.length === before) {
            console.warn(TAG, 'Post not found for deletion:', id);
            return false;
        }
        storageSet(STORAGE_KEYS.posts, posts);
        console.log(TAG, 'Post deleted:', id);
        return true;
    }

    /**
     * Build a visual content calendar for a given month.
     * @param {number} month - 1-12
     * @param {number} year
     * @returns {object} Calendar object keyed by day-of-month.
     */
    function getContentCalendar(month, year) {
        console.log(TAG, 'Building content calendar: ' + year + '-' + String(month).padStart(2, '0'));
        var start = new Date(year, month - 1, 1);
        var end = new Date(year, month, 0, 23, 59, 59);
        var posts = getScheduledPosts({
            start: start.toISOString(),
            end: end.toISOString()
        });

        var daysInMonth = end.getDate();
        var calendar = { month: month, year: year, daysInMonth: daysInMonth, days: {} };
        for (var d = 1; d <= daysInMonth; d++) {
            calendar.days[d] = [];
        }
        posts.forEach(function (p) {
            var day = new Date(p.scheduledDate).getDate();
            if (calendar.days[day]) {
                calendar.days[day].push(p);
            }
        });
        return calendar;
    }

    /* ================================================================== */
    /*  2. AI CONTENT GENERATION                                           */
    /* ================================================================== */

    /**
     * Generate an AI-powered social media post.
     * @param {string} topic
     * @param {string} platform
     * @param {string} [tone='professional'] - e.g. professional, casual, humorous
     * @returns {Promise<object>}
     */
    async function generatePost(topic, platform, tone) {
        if (!tone) { tone = 'professional'; }
        console.log(TAG, 'Generating post:', topic, '|', platform, '|', tone);
        var label = PLATFORM_LABELS[platform] || platform;
        var limit = PLATFORM_LIMITS[platform] || 2000;
        var prompt = [
            'You are a social media marketing expert. Create a compelling ' + label + ' post.',
            'Topic: ' + topic,
            'Tone: ' + tone,
            'Character limit: ' + limit,
            'Return JSON with keys: content, hashtags (array), callToAction, estimatedEngagement (low/medium/high).'
        ].join('\n');

        var raw = await aiGenerate(prompt);
        var parsed = parseAIJson(raw);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
        return { content: raw, hashtags: [], callToAction: '', estimatedEngagement: 'medium' };
    }

    /**
     * Generate hashtag suggestions for a topic on a platform.
     * @param {string} topic
     * @param {string} platform
     * @returns {Promise<string[]>}
     */
    async function generateHashtags(topic, platform) {
        console.log(TAG, 'Generating hashtags:', topic, '|', platform);
        var label = PLATFORM_LABELS[platform] || platform;
        var prompt = [
            'Suggest 10-15 high-performing hashtags for a ' + label + ' post about "' + topic + '".',
            'Mix popular, niche, and branded hashtags.',
            'Return a JSON array of strings, each starting with #.'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 500 });
        var parsed = parseAIJson(raw);
        return Array.isArray(parsed) ? parsed : [];
    }

    /**
     * Generate a full content calendar using AI.
     * @param {string[]} themes
     * @param {string[]} platforms
     * @param {number} [weeksAhead=4]
     * @returns {Promise<object>}
     */
    async function generateContentCalendar(themes, platforms, weeksAhead) {
        if (!weeksAhead) { weeksAhead = 4; }
        console.log(TAG, 'Generating content calendar:', themes, '|', platforms, '|', weeksAhead, 'weeks');
        var platformLabels = platforms.map(function (p) { return PLATFORM_LABELS[p] || p; }).join(', ');
        var prompt = [
            'You are a social media strategist. Create a detailed content calendar.',
            'Themes: ' + themes.join(', '),
            'Platforms: ' + platformLabels,
            'Duration: ' + weeksAhead + ' weeks starting from today.',
            'For each day that has content, provide: date (YYYY-MM-DD), platform, contentIdea, postType (image/video/text/carousel/story), suggestedTime (HH:MM), hashtags.',
            'Return JSON: { weeks: [ { weekNumber, posts: [...] } ] }'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 2000 });
        var parsed = parseAIJson(raw);
        if (typeof parsed === 'object' && parsed !== null) {
            storageSet(STORAGE_KEYS.calendar, { generatedAt: now(), data: parsed });
        }
        return parsed;
    }

    /**
     * Repurpose existing content for a different platform.
     * @param {string} originalContent
     * @param {string} targetPlatform
     * @returns {Promise<object>}
     */
    async function repurposeContent(originalContent, targetPlatform) {
        var label = PLATFORM_LABELS[targetPlatform] || targetPlatform;
        console.log(TAG, 'Repurposing content for', label);
        var limit = PLATFORM_LIMITS[targetPlatform] || 2000;
        var prompt = [
            'Adapt the following content for ' + label + ' (max ' + limit + ' chars).',
            'Keep the core message but adjust tone, length, and format for the target platform.',
            'Original content:\n"""' + originalContent + '"""',
            'Return JSON: { content, hashtags, platformTips }.'
        ].join('\n');

        var raw = await aiGenerate(prompt);
        return parseAIJson(raw);
    }

    /**
     * Generate captions for image content.
     * @param {string} imageDescription
     * @param {string} platform
     * @returns {Promise<object>}
     */
    async function generateCaptions(imageDescription, platform) {
        var label = PLATFORM_LABELS[platform] || platform;
        console.log(TAG, 'Generating captions for', label);
        var prompt = [
            'Write 3 engaging caption options for a ' + label + ' image post.',
            'Image description: ' + imageDescription,
            'Each caption should have a different style: informative, engaging, humorous.',
            'Return JSON: { captions: [ { style, text, hashtags } ] }'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 1000 });
        return parseAIJson(raw);
    }

    /* ================================================================== */
    /*  3. PLATFORM MANAGEMENT                                             */
    /* ================================================================== */

    /**
     * Get performance stats for a specific platform.
     * @param {string} platform
     * @returns {object}
     */
    function getPlatformStats(platform) {
        console.log(TAG, 'Getting stats for', PLATFORM_LABELS[platform] || platform);
        var allMetrics = storageGet(STORAGE_KEYS.metrics, {});
        var platformMetrics = allMetrics[platform] || {};

        var posts = storageGet(STORAGE_KEYS.posts, []).filter(function (p) {
            return p.platform === platform;
        });
        var published = posts.filter(function (p) { return p.status === 'published'; });

        return {
            platform: platform,
            label: PLATFORM_LABELS[platform] || platform,
            totalPosts: posts.length,
            publishedPosts: published.length,
            scheduledPosts: posts.filter(function (p) { return p.status === 'scheduled'; }).length,
            followers: platformMetrics.followers || 0,
            engagementRate: platformMetrics.engagementRate || 0,
            impressions: platformMetrics.impressions || 0,
            reach: platformMetrics.reach || 0,
            lastUpdated: platformMetrics.lastUpdated || null
        };
    }

    /**
     * Return the list of connected / configured platforms.
     * @returns {object[]}
     */
    function getConnectedPlatforms() {
        console.log(TAG, 'Checking connected platforms');
        var meta = cfg('META');
        var social = cfg('SOCIAL');
        var stored = storageGet(STORAGE_KEYS.platforms, {});

        return PLATFORMS.map(function (p) {
            var hasConfig = !!(meta[p] || social[p] || stored[p]);
            return {
                platform: p,
                label: PLATFORM_LABELS[p],
                connected: hasConfig,
                characterLimit: PLATFORM_LIMITS[p],
                config: hasConfig ? { configured: true } : null
            };
        });
    }

    /**
     * Get AI-recommended best posting times for a platform.
     * @param {string} platform
     * @returns {Promise<object>}
     */
    async function getBestPostingTimes(platform) {
        var label = PLATFORM_LABELS[platform] || platform;
        console.log(TAG, 'Fetching best posting times for', label);
        var prompt = [
            'What are the optimal posting times for ' + label + ' in 2026?',
            'Consider global audiences, weekday vs weekend, and content type.',
            'Return JSON: { bestTimes: [ { day, time, timezone, reason } ], peakEngagementWindows: [ { start, end } ] }'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 800 });
        return parseAIJson(raw);
    }

    /**
     * Fetch real channel metrics from platform APIs when available.
     * Falls back to stored metrics or zeros.
     * @param {string} platform
     * @returns {Promise<object>}
     */
    async function getChannelMetrics(platform) {
        console.log(TAG, 'Fetching channel metrics for', PLATFORM_LABELS[platform] || platform);

        // Try real API connections first
        try {
            var api = window.ApiConnector && window.ApiConnector.Social;
            if (api) {
                if (platform === 'twitter' && api.twitter && api.twitter.isAvailable()) {
                    var twData = await api.twitter.getMetrics();
                    if (twData) {
                        storageSet(STORAGE_KEYS.metrics + '-twitter', twData);
                        return twData;
                    }
                }
                if (platform === 'linkedin' && api.linkedin && api.linkedin.isAvailable()) {
                    var liData = await api.linkedin.getOrganizationStats();
                    if (liData) {
                        storageSet(STORAGE_KEYS.metrics + '-linkedin', liData);
                        return liData;
                    }
                }
                if (platform === 'tiktok' && api.tiktok && api.tiktok.isAvailable()) {
                    var ttData = await api.tiktok.getVideoStats();
                    if (ttData) {
                        storageSet(STORAGE_KEYS.metrics + '-tiktok', ttData);
                        return ttData;
                    }
                }
                if (platform === 'facebook') {
                    var fbApi = window.ApiConnector.MetaAds;
                    if (fbApi && fbApi.isAvailable && fbApi.isAvailable()) {
                        var fbData = await fbApi.getCampaigns();
                        if (fbData) {
                            storageSet(STORAGE_KEYS.metrics + '-facebook', fbData);
                            return fbData;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(TAG, 'API fetch failed for', platform, ':', err.message);
        }

        // Fall back to stored metrics or zeros
        var stored = await storageGetAsync(STORAGE_KEYS.metrics, {});
        return stored[platform] || {
            followers: 0,
            engagementRate: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            likes: 0,
            comments: 0,
            shares: 0
        };
    }

    /**
     * Fetch follower growth data from platform APIs when available.
     * Falls back to stored data or zeros.
     * @param {string} platform
     * @param {string} [period='30d']
     * @returns {Promise<object>}
     */
    async function getFollowerGrowth(platform, period) {
        if (!period) { period = '30d'; }
        console.log(TAG, 'Fetching follower growth for', PLATFORM_LABELS[platform] || platform, '|', period);

        // Try real API connections first
        try {
            var api = window.ApiConnector && window.ApiConnector.Social;
            if (api) {
                if (platform === 'twitter' && api.twitter && api.twitter.isAvailable()) {
                    var twData = await api.twitter.getFollowers();
                    if (twData && twData.data) {
                        var twMetrics = twData.data.public_metrics || {};
                        var twResult = {
                            platform: platform,
                            period: period,
                            followers: twMetrics.followers_count || 0,
                            following: twMetrics.following_count || 0,
                            growth: 0,
                            source: 'api'
                        };
                        storageSet(STORAGE_KEYS.metrics + '-twitter-followers', twResult);
                        return twResult;
                    }
                }
                if (platform === 'linkedin' && api.linkedin && api.linkedin.isAvailable()) {
                    var liData = await api.linkedin.getOrganizationStats();
                    if (liData) {
                        var liFollowers = 0;
                        if (liData.elements && liData.elements[0] &&
                            liData.elements[0].totalShareStatistics) {
                            liFollowers = liData.elements[0].totalShareStatistics.followerCount || 0;
                        }
                        var liResult = {
                            platform: platform,
                            period: period,
                            followers: liFollowers,
                            growth: 0,
                            source: 'api'
                        };
                        storageSet(STORAGE_KEYS.metrics + '-linkedin-followers', liResult);
                        return liResult;
                    }
                }
                if (platform === 'tiktok' && api.tiktok && api.tiktok.isAvailable()) {
                    var ttData = await api.tiktok.getVideoStats();
                    if (ttData) {
                        var ttResult = {
                            platform: platform,
                            period: period,
                            followers: 0,
                            growth: 0,
                            source: 'api'
                        };
                        storageSet(STORAGE_KEYS.metrics + '-tiktok-followers', ttResult);
                        return ttResult;
                    }
                }
            }
        } catch (err) {
            console.warn(TAG, 'API follower fetch failed for', platform, ':', err.message);
        }

        // Fall back to stored data or zeros
        var stored = await storageGetAsync(STORAGE_KEYS.metrics, {});
        var pm = stored[platform] || {};
        return {
            platform: platform,
            period: period,
            followers: pm.followers || 0,
            growth: pm.followerGrowth || 0,
            source: 'stored'
        };
    }

    /* ================================================================== */
    /*  4. ENGAGEMENT & COMMUNITY                                          */
    /* ================================================================== */

    /**
     * Get engagement metrics across platforms for a date range.
     * @param {{ start?: string, end?: string }} [dateRange]
     * @returns {object}
     */
    function getEngagementMetrics(dateRange) {
        console.log(TAG, 'Calculating engagement metrics', dateRange || '(all time)');
        var posts = getScheduledPosts(dateRange).filter(function (p) {
            return p.status === 'published';
        });

        var totals = { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0, clicks: 0 };
        var byPlatform = {};

        posts.forEach(function (p) {
            var eng = p.engagement || {};
            totals.likes += eng.likes || 0;
            totals.comments += eng.comments || 0;
            totals.shares += eng.shares || 0;
            totals.reach += eng.reach || 0;
            totals.impressions += eng.impressions || 0;
            totals.clicks += eng.clicks || 0;

            if (!byPlatform[p.platform]) {
                byPlatform[p.platform] = { likes: 0, comments: 0, shares: 0, reach: 0, posts: 0 };
            }
            byPlatform[p.platform].likes += eng.likes || 0;
            byPlatform[p.platform].comments += eng.comments || 0;
            byPlatform[p.platform].shares += eng.shares || 0;
            byPlatform[p.platform].reach += eng.reach || 0;
            byPlatform[p.platform].posts += 1;
        });

        var totalInteractions = totals.likes + totals.comments + totals.shares;
        totals.engagementRate = totals.impressions > 0
            ? ((totalInteractions / totals.impressions) * 100).toFixed(2)
            : '0.00';

        return { totals: totals, byPlatform: byPlatform, postCount: posts.length };
    }

    /**
     * Get the top performing posts for a platform.
     * @param {string} platform
     * @param {string} [metric='likes'] - likes | comments | shares | reach
     * @param {number} [limit=10]
     * @returns {object[]}
     */
    function getTopPosts(platform, metric, limit) {
        if (!metric) { metric = 'likes'; }
        if (!limit) { limit = 10; }
        console.log(TAG, 'Getting top posts:', platform, '|', metric, '| top', limit);
        var posts = storageGet(STORAGE_KEYS.posts, []).filter(function (p) {
            return p.status === 'published';
        });
        if (platform && platform !== 'all') {
            posts = posts.filter(function (p) { return p.platform === platform; });
        }
        return posts
            .sort(function (a, b) {
                return ((b.engagement && b.engagement[metric]) || 0) -
                       ((a.engagement && a.engagement[metric]) || 0);
            })
            .slice(0, limit);
    }

    /**
     * Generate AI-powered reply suggestions for a user comment.
     * @param {string} comment
     * @returns {Promise<object>}
     */
    async function generateResponseSuggestions(comment) {
        console.log(TAG, 'Generating response suggestions');
        var prompt = [
            'You are a community manager. Suggest 3 professional, on-brand replies to this social media comment:',
            'Comment: "' + comment + '"',
            'Return JSON: { responses: [ { tone, text } ] }',
            'Tones: friendly, professional, witty.'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 600 });
        return parseAIJson(raw);
    }

    /**
     * Get AI sentiment analysis of audience interactions on a platform.
     * @param {string} platform
     * @returns {Promise<object>}
     */
    async function getSentimentAnalysis(platform) {
        var label = PLATFORM_LABELS[platform] || platform;
        console.log(TAG, 'Running sentiment analysis for', label);
        var posts = storageGet(STORAGE_KEYS.posts, [])
            .filter(function (p) { return p.platform === platform && p.status === 'published'; })
            .slice(-20);

        var snippet = posts.map(function (p) { return p.content; }).join('\n---\n');
        var prompt = [
            'Analyze the audience sentiment for our recent ' + label + ' presence based on these posts:',
            snippet || '(No recent posts available - provide general guidance.)',
            'Return JSON: { overallSentiment, positivePercent, neutralPercent, negativePercent, themes: [], recommendations: [] }'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 800 });
        return parseAIJson(raw);
    }

    /* ================================================================== */
    /*  5. SOCIAL LISTENING                                                */
    /* ================================================================== */

    /**
     * Track brand mentions (stored locally for demo / MVP).
     * @param {string} brand
     * @returns {object}
     */
    function trackMentions(brand) {
        console.log(TAG, 'Tracking mentions for brand:', brand);
        var mentions = storageGet(STORAGE_KEYS.mentions, {});
        if (!mentions[brand]) {
            mentions[brand] = {
                brand: brand,
                firstTracked: now(),
                entries: [],
                totalCount: 0
            };
        }
        storageSet(STORAGE_KEYS.mentions, mentions);
        return mentions[brand];
    }

    /**
     * Get AI-identified trending topics for an industry.
     * @param {string} industry
     * @returns {Promise<object>}
     */
    async function getTrendingTopics(industry) {
        console.log(TAG, 'Finding trending topics for', industry);
        var prompt = [
            'Identify 10 current trending social media topics and themes in the "' + industry + '" industry.',
            'For each, estimate relevance and suggest a content angle.',
            'Return JSON: { topics: [ { topic, relevance (high/medium/low), suggestedAngle, platforms } ] }'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 1000 });
        return parseAIJson(raw);
    }

    /**
     * Get AI competitive social media analysis.
     * @param {string[]} competitors - List of competitor names / handles.
     * @returns {Promise<object>}
     */
    async function getCompetitorSocialAnalysis(competitors) {
        console.log(TAG, 'Analyzing competitors:', competitors);
        var competitorList = competitors.map(function (c) { return '- ' + c; }).join('\n');
        var prompt = [
            'Provide a competitive social media analysis for the following brands:',
            competitorList,
            'For each, estimate posting frequency, content themes, engagement style, and strengths/weaknesses.',
            'Return JSON: { competitors: [ { name, platforms, postingFrequency, themes, strengths, weaknesses, opportunities } ] }'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 1500 });
        return parseAIJson(raw);
    }

    /* ================================================================== */
    /*  6. ANALYTICS & REPORTING                                           */
    /* ================================================================== */

    /**
     * Calculate social media ROI.
     * @returns {object}
     */
    function getSocialROI() {
        console.log(TAG, 'Calculating social ROI');
        var posts = storageGet(STORAGE_KEYS.posts, []).filter(function (p) {
            return p.status === 'published';
        });
        var metrics = getEngagementMetrics();

        var storedPerf = storageGet('social-roi-performance', {});
        var estimatedReach = metrics.totals.reach || storedPerf.reach || 0;
        var estimatedClicks = metrics.totals.clicks || storedPerf.clicks || 0;
        var estimatedConversions = storedPerf.conversions || 0;
        var estimatedRevenue = storedPerf.revenue || 0;
        var estimatedCost = storedPerf.cost || 0;

        var roi = estimatedCost > 0
            ? (((estimatedRevenue - estimatedCost) / estimatedCost) * 100).toFixed(1)
            : '0.0';

        return {
            totalPosts: posts.length,
            estimatedReach: estimatedReach,
            estimatedClicks: estimatedClicks,
            estimatedConversions: estimatedConversions,
            estimatedRevenue: '$' + estimatedRevenue.toLocaleString(),
            estimatedCost: '$' + estimatedCost.toLocaleString(),
            roi: roi + '%',
            costPerClick: estimatedClicks > 0 ? '$' + (estimatedCost / estimatedClicks).toFixed(2) : 'N/A',
            costPerConversion: estimatedConversions > 0 ? '$' + (estimatedCost / estimatedConversions).toFixed(2) : 'N/A',
            calculatedAt: now()
        };
    }

    /**
     * Get growth metrics for a platform over a period.
     * @param {string} platform
     * @param {string} [period='30d'] - e.g. 7d, 30d, 90d
     * @returns {object}
     */
    function getGrowthMetrics(platform, period) {
        if (!period) { period = '30d'; }
        console.log(TAG, 'Growth metrics:', platform, '|', period);
        var days = parseInt(period, 10) || 30;
        var cutoff = new Date(Date.now() - days * 86400000).toISOString();
        var posts = storageGet(STORAGE_KEYS.posts, []).filter(function (p) {
            return p.platform === platform && p.createdAt >= cutoff;
        });

        var allMetrics = storageGet(STORAGE_KEYS.metrics, {});
        var pm = allMetrics[platform] || {};

        var totalEng = posts.reduce(function (sum, p) {
            var e = p.engagement || {};
            return sum + (e.likes || 0) + (e.comments || 0) + (e.shares || 0);
        }, 0);

        return {
            platform: platform,
            period: period,
            postsPublished: posts.filter(function (p) { return p.status === 'published'; }).length,
            postsScheduled: posts.filter(function (p) { return p.status === 'scheduled'; }).length,
            followers: pm.followers || 0,
            followerGrowth: pm.followerGrowth || 0,
            engagementRate: posts.length > 0 ? (totalEng / posts.length).toFixed(2) : '0.00',
            totalEngagements: totalEng,
            impressions: pm.impressions || 0,
            calculatedAt: now()
        };
    }

    /**
     * Generate a comprehensive AI social media report.
     * @param {{ start?: string, end?: string }} [dateRange]
     * @returns {Promise<object>}
     */
    async function generateSocialReport(dateRange) {
        console.log(TAG, 'Generating social report', dateRange || '(all time)');
        var engagement = getEngagementMetrics(dateRange);
        var roi = getSocialROI();

        var platformSummaries = PLATFORMS.map(function (p) {
            var stats = getPlatformStats(p);
            return stats.label + ': ' + stats.publishedPosts + ' posts, ' +
                   stats.engagementRate + '% engagement, ' + stats.followers + ' followers';
        }).join('\n');

        var prompt = [
            'You are a social media analyst. Create an executive summary report based on this data:',
            'Total posts: ' + engagement.postCount,
            'Engagement: ' + JSON.stringify(engagement.totals),
            'ROI: ' + roi.roi,
            'Platform breakdown:\n' + platformSummaries,
            'Return JSON: { executiveSummary, keyFindings: [], platformInsights: [], recommendations: [], overallGrade }.'
        ].join('\n');

        var raw = await aiGenerate(prompt, { maxTokens: 1500 });
        var report = parseAIJson(raw);

        return {
            generatedAt: now(),
            dateRange: dateRange || { start: null, end: null },
            engagement: engagement,
            roi: roi,
            aiAnalysis: report
        };
    }

    /* ================================================================== */
    /*  Public API                                                         */
    /* ================================================================== */

    /** @namespace SocialMediaService */
    var SocialMediaService = {
        /* Constants */
        PLATFORMS: PLATFORMS,
        PLATFORM_LABELS: PLATFORM_LABELS,
        PLATFORM_LIMITS: PLATFORM_LIMITS,

        /* 1. Content Scheduling */
        getScheduledPosts: getScheduledPosts,
        schedulePost: schedulePost,
        updatePost: updatePost,
        deletePost: deletePost,
        getContentCalendar: getContentCalendar,

        /* 2. AI Content Generation */
        generatePost: generatePost,
        generateHashtags: generateHashtags,
        generateContentCalendar: generateContentCalendar,
        repurposeContent: repurposeContent,
        generateCaptions: generateCaptions,

        /* 3. Platform Management */
        getPlatformStats: getPlatformStats,
        getConnectedPlatforms: getConnectedPlatforms,
        getBestPostingTimes: getBestPostingTimes,
        getChannelMetrics: getChannelMetrics,
        getFollowerGrowth: getFollowerGrowth,

        /* 4. Engagement & Community */
        getEngagementMetrics: getEngagementMetrics,
        getTopPosts: getTopPosts,
        generateResponseSuggestions: generateResponseSuggestions,
        getSentimentAnalysis: getSentimentAnalysis,

        /* 5. Social Listening */
        trackMentions: trackMentions,
        getTrendingTopics: getTrendingTopics,
        getCompetitorSocialAnalysis: getCompetitorSocialAnalysis,

        /* 6. Analytics */
        getSocialROI: getSocialROI,
        getGrowthMetrics: getGrowthMetrics,
        generateSocialReport: generateSocialReport
    };

    /* Expose globally */
    window.SocialMediaService = SocialMediaService;

    console.log(TAG, 'Service initialised -', PLATFORMS.length, 'platforms supported');
})();
