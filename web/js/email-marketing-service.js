/**
 * Email Marketing Service for The Marketing Department 2026
 * Manages email campaigns, automation flows, list management, and analytics.
 * Integrates with AIService for intelligent copy generation and optimization.
 * @module EmailMarketingService
 */
(function () {
    'use strict';

    const TAG = '[EmailMarketing]';

    const STORAGE_KEYS = {
        CAMPAIGNS: 'email-campaigns',
        FLOWS: 'email-flows',
        LISTS: 'email-lists',
        SEGMENTS: 'email-segments',
        TEMPLATES: 'email-templates',
        ANALYTICS: 'email-analytics'
    };

    const CAMPAIGN_TYPES = [
        'newsletter', 'promotional', 'transactional', 'drip',
        'welcome-series', 're-engagement', 'abandoned-cart'
    ];

    const FLOW_TYPES = [
        'welcome', 'abandoned-cart', 'post-purchase', 're-engagement',
        'birthday', 'lead-nurture', 'onboarding'
    ];

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    /** Generate a unique identifier. */
    function uid() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }

    /** Read a JSON array from localStorage. */
    function loadStore(key) {
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch (err) {
            console.warn(TAG, 'Failed to read', key, err);
            return [];
        }
    }

    /** Write a JSON value to localStorage. */
    function saveStore(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            if (window.MarketingStore) { window.MarketingStore.set('email', key, data).catch(function(){}); }
        } catch (err) {
            console.error(TAG, 'Failed to write', key, err);
        }
    }

    /** Read a JSON array from Supabase (via MarketingStore) first, falling back to localStorage. */
    async function loadStoreAsync(key) {
        try {
            if (window.MarketingStore) {
                var remote = await window.MarketingStore.get('email', key);
                if (remote !== null && remote !== undefined) {
                    return Array.isArray(remote) ? remote : [];
                }
            }
        } catch (err) {
            console.warn(TAG, 'MarketingStore.get failed for', key, err);
        }
        return loadStore(key);
    }

    /**
     * Call the AI generation backend.
     * @param {string} prompt
     * @param {object} [opts]
     * @returns {Promise<string>}
     */
    async function aiGenerate(prompt, opts = {}) {
        const defaults = { maxTokens: 2000, temperature: 0.6 };
        const merged = Object.assign({}, defaults, opts);
        if (window.AIService?.AI?.generate) {
            return window.AIService.AI.generate(prompt, merged);
        }
        console.warn(TAG, 'AIService unavailable – returning placeholder');
        return '[AI content unavailable – AIService not loaded]';
    }

    /** Return the current project context when available. */
    function projectContext() {
        try {
            const proj = window.ProjectService?.getCurrentProject?.();
            return proj || {};
        } catch (_) {
            return {};
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Internal: filter & merge helpers for API integration               */
    /* ------------------------------------------------------------------ */

    /** Apply standard campaign filters to an array. */
    function _applyFilters(campaigns, filters) {
        if (filters.status) campaigns = campaigns.filter(function (c) { return c.status === filters.status; });
        if (filters.type) campaigns = campaigns.filter(function (c) { return c.type === filters.type; });
        if (filters.listId) campaigns = campaigns.filter(function (c) { return c.listId === filters.listId; });
        if (filters.dateRange) {
            var start = filters.dateRange.start;
            var end = filters.dateRange.end;
            campaigns = campaigns.filter(function (c) {
                var d = new Date(c.createdAt);
                return (!start || d >= new Date(start)) && (!end || d <= new Date(end));
            });
        }
        return campaigns;
    }

    /** Merge API-sourced campaigns into local list by ID.  API data takes precedence. */
    function _mergeApiCampaigns(local, api) {
        var byId = {};
        local.forEach(function (c) { byId[c.id] = c; });
        api.forEach(function (c) {
            var key = c.id || c.externalId || uid();
            byId[key] = Object.assign({}, byId[key] || {}, c);
        });
        return Object.keys(byId).map(function (k) { return byId[k]; });
    }

    /* ================================================================== */
    /*  1. Campaign Management                                            */
    /* ================================================================== */

    /**
     * Retrieve campaigns, optionally filtered.
     * Kicks off a background API refresh from Mailchimp when available.
     * @param {object} [filters] - { status, type, listId, dateRange }
     * @returns {object[]}
     */
    function getCampaigns(filters = {}) {
        console.log(TAG, 'getCampaigns', filters);
        var campaigns = loadStore(STORAGE_KEYS.CAMPAIGNS);

        // Background refresh from real Mailchimp API when available
        if (window.ApiConnector && window.ApiConnector.EmailMarketing &&
            window.ApiConnector.EmailMarketing.mailchimp &&
            window.ApiConnector.EmailMarketing.mailchimp.isAvailable()) {
            window.ApiConnector.EmailMarketing.mailchimp.getCampaigns(filters)
                .then(function (apiCampaigns) {
                    if (apiCampaigns && Array.isArray(apiCampaigns) && apiCampaigns.length) {
                        var merged = _mergeApiCampaigns(loadStore(STORAGE_KEYS.CAMPAIGNS), apiCampaigns);
                        saveStore(STORAGE_KEYS.CAMPAIGNS, merged);
                        console.log(TAG, 'Campaigns refreshed from Mailchimp API:', merged.length);
                    }
                })
                .catch(function (err) {
                    console.warn(TAG, 'Mailchimp API fetch failed, using stored data', err);
                });
        }

        return _applyFilters(campaigns, filters);
    }

    /**
     * Async version of getCampaigns -- awaits real API data when available,
     * falls back to Supabase / localStorage.
     * @param {object} [filters] - { status, type, listId, dateRange }
     * @returns {Promise<object[]>}
     */
    async function getCampaignsAsync(filters) {
        filters = filters || {};
        console.log(TAG, 'getCampaignsAsync', filters);

        // Try real API first
        if (window.ApiConnector && window.ApiConnector.EmailMarketing &&
            window.ApiConnector.EmailMarketing.mailchimp &&
            window.ApiConnector.EmailMarketing.mailchimp.isAvailable()) {
            try {
                var apiCampaigns = await window.ApiConnector.EmailMarketing.mailchimp.getCampaigns(filters);
                if (apiCampaigns && Array.isArray(apiCampaigns) && apiCampaigns.length) {
                    var merged = _mergeApiCampaigns(loadStore(STORAGE_KEYS.CAMPAIGNS), apiCampaigns);
                    saveStore(STORAGE_KEYS.CAMPAIGNS, merged);
                    return _applyFilters(merged, filters);
                }
            } catch (err) {
                console.warn(TAG, 'API getCampaigns failed, falling back to stored data', err);
            }
        }

        // Fall back to Supabase, then localStorage
        var campaigns = await loadStoreAsync(STORAGE_KEYS.CAMPAIGNS);
        return _applyFilters(campaigns, filters);
    }

    /**
     * Create a new email campaign.
     * @param {object} config - { name, type, subject, preheader, content, listId, sendDate }
     * @returns {object} The created campaign.
     */
    function createCampaign(config = {}) {
        if (!config.name) throw new Error('Campaign name is required');
        if (config.type && !CAMPAIGN_TYPES.includes(config.type)) {
            throw new Error('Invalid campaign type: ' + config.type);
        }
        const campaign = {
            id: uid(),
            name: config.name,
            type: config.type || 'newsletter',
            subject: config.subject || '',
            preheader: config.preheader || '',
            content: config.content || '',
            listId: config.listId || null,
            sendDate: config.sendDate || null,
            status: config.sendDate ? 'scheduled' : 'draft',
            stats: { opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, revenue: 0, sent: 0 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const campaigns = loadStore(STORAGE_KEYS.CAMPAIGNS);
        campaigns.push(campaign);
        saveStore(STORAGE_KEYS.CAMPAIGNS, campaigns);
        console.log(TAG, 'Campaign created', campaign.id, campaign.name);
        return campaign;
    }

    /**
     * Update an existing campaign.
     * @param {string} id
     * @param {object} updates
     * @returns {object|null}
     */
    function updateCampaign(id, updates = {}) {
        const campaigns = loadStore(STORAGE_KEYS.CAMPAIGNS);
        const idx = campaigns.findIndex(c => c.id === id);
        if (idx === -1) { console.warn(TAG, 'Campaign not found', id); return null; }
        if (campaigns[idx].status === 'sent') {
            console.warn(TAG, 'Cannot update a sent campaign');
            return campaigns[idx];
        }
        Object.assign(campaigns[idx], updates, { updatedAt: new Date().toISOString() });
        saveStore(STORAGE_KEYS.CAMPAIGNS, campaigns);
        console.log(TAG, 'Campaign updated', id);
        return campaigns[idx];
    }

    /**
     * Delete a campaign by ID.
     * @param {string} id
     * @returns {boolean}
     */
    function deleteCampaign(id) {
        let campaigns = loadStore(STORAGE_KEYS.CAMPAIGNS);
        const before = campaigns.length;
        campaigns = campaigns.filter(c => c.id !== id);
        if (campaigns.length === before) { console.warn(TAG, 'Campaign not found', id); return false; }
        saveStore(STORAGE_KEYS.CAMPAIGNS, campaigns);
        console.log(TAG, 'Campaign deleted', id);
        return true;
    }

    /**
     * Schedule a campaign for sending.
     * @param {string} id
     * @param {string} sendDate - ISO date string
     * @returns {object|null}
     */
    function scheduleCampaign(id, sendDate) {
        if (!sendDate) throw new Error('sendDate is required');
        if (new Date(sendDate) <= new Date()) {
            throw new Error('sendDate must be in the future');
        }
        return updateCampaign(id, { sendDate, status: 'scheduled' });
    }

    /**
     * Retrieve performance stats for a campaign.
     * Kicks off a background API refresh from Mailchimp / SendGrid when available.
     * @param {string} id
     * @returns {object|null}
     */
    function getCampaignStats(id) {
        var campaign = loadStore(STORAGE_KEYS.CAMPAIGNS).find(function (c) { return c.id === id; });
        if (!campaign) { console.warn(TAG, 'Campaign not found', id); return null; }
        var s = campaign.stats;

        // Background refresh from real API when available (Mailchimp or SendGrid)
        if (window.ApiConnector && window.ApiConnector.EmailMarketing) {
            var mc = window.ApiConnector.EmailMarketing.mailchimp;
            var sg = window.ApiConnector.EmailMarketing.sendgrid;
            var provider = (mc && mc.isAvailable && mc.isAvailable()) ? mc
                         : (sg && sg.isAvailable && sg.isAvailable()) ? sg
                         : null;
            if (provider && provider.getCampaignStats) {
                provider.getCampaignStats(id)
                    .then(function (apiStats) {
                        if (apiStats) {
                            var campaigns = loadStore(STORAGE_KEYS.CAMPAIGNS);
                            var idx = campaigns.findIndex(function (c) { return c.id === id; });
                            if (idx !== -1) {
                                campaigns[idx].stats = Object.assign({}, campaigns[idx].stats, apiStats);
                                saveStore(STORAGE_KEYS.CAMPAIGNS, campaigns);
                                console.log(TAG, 'Campaign stats refreshed from API:', id);
                            }
                        }
                    })
                    .catch(function (err) {
                        console.warn(TAG, 'API getCampaignStats failed, using stored data', err);
                    });
            }
        }

        var openRate = s.sent ? ((s.opens / s.sent) * 100).toFixed(1) : '0.0';
        var clickRate = s.opens ? ((s.clicks / s.opens) * 100).toFixed(1) : '0.0';
        var bounceRate = s.sent ? ((s.bounces / s.sent) * 100).toFixed(1) : '0.0';
        console.log(TAG, 'getCampaignStats', id);
        return {
            opens: s.opens, clicks: s.clicks, bounces: s.bounces,
            unsubscribes: s.unsubscribes, revenue: s.revenue, sent: s.sent,
            openRate: openRate, clickRate: clickRate, bounceRate: bounceRate,
            campaignId: id, campaignName: campaign.name
        };
    }

    /**
     * Async version of getCampaignStats -- awaits real API data when available,
     * falls back to Supabase / localStorage.
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async function getCampaignStatsAsync(id) {
        console.log(TAG, 'getCampaignStatsAsync', id);

        // Try real API first (Mailchimp or SendGrid)
        if (window.ApiConnector && window.ApiConnector.EmailMarketing) {
            var mc = window.ApiConnector.EmailMarketing.mailchimp;
            var sg = window.ApiConnector.EmailMarketing.sendgrid;
            var provider = (mc && mc.isAvailable && mc.isAvailable()) ? mc
                         : (sg && sg.isAvailable && sg.isAvailable()) ? sg
                         : null;
            if (provider && provider.getCampaignStats) {
                try {
                    var apiStats = await provider.getCampaignStats(id);
                    if (apiStats) {
                        // Persist the fresh stats back to storage
                        var campaigns = loadStore(STORAGE_KEYS.CAMPAIGNS);
                        var idx = campaigns.findIndex(function (c) { return c.id === id; });
                        if (idx !== -1) {
                            campaigns[idx].stats = Object.assign({}, campaigns[idx].stats, apiStats);
                            saveStore(STORAGE_KEYS.CAMPAIGNS, campaigns);
                        }
                        var sa = apiStats;
                        var name = idx !== -1 ? campaigns[idx].name : '';
                        return {
                            opens: sa.opens || 0, clicks: sa.clicks || 0, bounces: sa.bounces || 0,
                            unsubscribes: sa.unsubscribes || 0, revenue: sa.revenue || 0, sent: sa.sent || 0,
                            openRate: sa.sent ? ((sa.opens / sa.sent) * 100).toFixed(1) : '0.0',
                            clickRate: sa.opens ? ((sa.clicks / sa.opens) * 100).toFixed(1) : '0.0',
                            bounceRate: sa.sent ? ((sa.bounces / sa.sent) * 100).toFixed(1) : '0.0',
                            campaignId: id, campaignName: name
                        };
                    }
                } catch (err) {
                    console.warn(TAG, 'API getCampaignStats failed, falling back to stored data', err);
                }
            }
        }

        // Fall back to Supabase, then localStorage
        var campaigns = await loadStoreAsync(STORAGE_KEYS.CAMPAIGNS);
        var campaign = campaigns.find(function (c) { return c.id === id; });
        if (!campaign) { return null; }
        var s = campaign.stats;
        return {
            opens: s.opens, clicks: s.clicks, bounces: s.bounces,
            unsubscribes: s.unsubscribes, revenue: s.revenue, sent: s.sent,
            openRate: s.sent ? ((s.opens / s.sent) * 100).toFixed(1) : '0.0',
            clickRate: s.opens ? ((s.clicks / s.opens) * 100).toFixed(1) : '0.0',
            bounceRate: s.sent ? ((s.bounces / s.sent) * 100).toFixed(1) : '0.0',
            campaignId: id, campaignName: campaign.name
        };
    }

    /* ================================================================== */
    /*  2. AI Email Generation                                            */
    /* ================================================================== */

    /**
     * Generate AI-powered subject line variations.
     * @param {string} topic
     * @param {string} audience
     * @param {number} [count=5]
     * @returns {Promise<string[]>}
     */
    async function generateSubjectLines(topic, audience, count = 5) {
        console.log(TAG, 'generateSubjectLines', topic, audience, count);
        const prompt = 'Generate ' + count + ' compelling email subject lines for the topic "' + topic + '" ' +
            'targeting "' + audience + '". Include a mix of curiosity-driven, benefit-focused, and ' +
            'urgency-based styles. Keep each under 60 characters. Return as a JSON array of strings.';
        const raw = await aiGenerate(prompt, { temperature: 0.8 });
        try { return JSON.parse(raw); } catch (_) { return raw.split('\n').filter(Boolean).slice(0, count); }
    }

    /**
     * Generate an email body using AI.
     * @param {string} purpose
     * @param {string} audience
     * @param {string} [tone='professional']
     * @param {string} [length='medium']
     * @returns {Promise<string>}
     */
    async function generateEmailBody(purpose, audience, tone = 'professional', length = 'medium') {
        console.log(TAG, 'generateEmailBody', purpose, tone, length);
        const wordMap = { short: 150, medium: 300, long: 500 };
        const words = wordMap[length] || 300;
        const prompt = 'Write a ' + tone + ' marketing email (~' + words + ' words) for "' + purpose + '" ' +
            'targeting "' + audience + '". Include a compelling opening, value proposition, clear CTA, ' +
            'and a professional sign-off. Use HTML formatting with inline styles suitable for email clients.';
        return aiGenerate(prompt);
    }

    /**
     * Generate a complete welcome email series.
     * @param {string} brand
     * @param {string} productInfo
     * @param {number} [seriesLength=5]
     * @returns {Promise<object[]>}
     */
    async function generateWelcomeSeries(brand, productInfo, seriesLength = 5) {
        console.log(TAG, 'generateWelcomeSeries', brand, seriesLength);
        const prompt = 'Create a ' + seriesLength + '-email welcome series for brand "' + brand + '". ' +
            'Product info: "' + productInfo + '". For each email provide: subject, preheader, ' +
            'body (HTML), sendDelay (hours after signup), and goal. Return as JSON array.';
        const raw = await aiGenerate(prompt, { maxTokens: 3000 });
        try { return JSON.parse(raw); } catch (_) { return [{ raw: raw, note: 'Parse failed - raw AI output' }]; }
    }

    /**
     * Generate newsletter content from topic list.
     * @param {string[]} topics
     * @param {string} brand
     * @returns {Promise<string>}
     */
    async function generateNewsletterContent(topics, brand) {
        console.log(TAG, 'generateNewsletterContent', topics);
        const list = Array.isArray(topics) ? topics.join(', ') : topics;
        const prompt = 'Write an engaging newsletter for "' + brand + '" covering these topics: ' + list + '. ' +
            'Include a brief intro, a section per topic with a headline and 2-3 sentences, and ' +
            'a closing CTA. Format in clean HTML for email clients.';
        return aiGenerate(prompt);
    }

    /**
     * Optimize email content for higher conversion.
     * @param {string} emailContent
     * @returns {Promise<object>}
     */
    async function optimizeForConversion(emailContent) {
        console.log(TAG, 'optimizeForConversion');
        const prompt = 'Analyze this marketing email and provide conversion rate optimization ' +
            'suggestions. Return JSON with keys: score (1-100), suggestions (array of strings), ' +
            'revisedSubject, revisedCTA, revisedContent.\n\nEmail:\n' + emailContent;
        const raw = await aiGenerate(prompt);
        try { return JSON.parse(raw); } catch (_) { return { raw: raw, score: null, suggestions: [] }; }
    }

    /**
     * Generate A/B test variants for a given email element.
     * @param {string} original - The original content
     * @param {string} element - 'subject' | 'cta' | 'body'
     * @param {number} [count=3]
     * @returns {Promise<string[]>}
     */
    async function generateABTestVariants(original, element, count) {
        element = element || 'subject';
        count = count || 3;
        console.log(TAG, 'generateABTestVariants', element, count);
        const prompt = 'Given the original email ' + element + ': "' + original + '", generate ' + count + ' ' +
            'A/B test variants. Each should test a different psychological angle (urgency, ' +
            'curiosity, social proof, benefit-first, etc.). Return as a JSON array of strings.';
        const raw = await aiGenerate(prompt, { temperature: 0.85 });
        try { return JSON.parse(raw); } catch (_) { return raw.split('\n').filter(Boolean).slice(0, count); }
    }

    /* ================================================================== */
    /*  3. Automation Flows                                               */
    /* ================================================================== */

    /**
     * Retrieve all automation flows.
     * @returns {object[]}
     */
    function getFlows() {
        console.log(TAG, 'getFlows');
        return loadStore(STORAGE_KEYS.FLOWS);
    }

    /**
     * Create an automation flow.
     * @param {object} config - { name, type, trigger, steps[], delays, conditions }
     * @returns {object}
     */
    function createFlow(config = {}) {
        if (!config.name) throw new Error('Flow name is required');
        if (config.type && !FLOW_TYPES.includes(config.type)) {
            throw new Error('Invalid flow type: ' + config.type);
        }
        const flow = {
            id: uid(),
            name: config.name,
            type: config.type || 'welcome',
            trigger: config.trigger || { event: 'subscribe' },
            steps: Array.isArray(config.steps) ? config.steps : [],
            delays: config.delays || {},
            conditions: config.conditions || [],
            status: 'inactive',
            stats: { entered: 0, completed: 0, converted: 0, revenue: 0 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const flows = loadStore(STORAGE_KEYS.FLOWS);
        flows.push(flow);
        saveStore(STORAGE_KEYS.FLOWS, flows);
        console.log(TAG, 'Flow created', flow.id, flow.name);
        return flow;
    }

    /**
     * Update an automation flow.
     * @param {string} id
     * @param {object} updates
     * @returns {object|null}
     */
    function updateFlow(id, updates = {}) {
        const flows = loadStore(STORAGE_KEYS.FLOWS);
        const idx = flows.findIndex(function (f) { return f.id === id; });
        if (idx === -1) { console.warn(TAG, 'Flow not found', id); return null; }
        Object.assign(flows[idx], updates, { updatedAt: new Date().toISOString() });
        saveStore(STORAGE_KEYS.FLOWS, flows);
        console.log(TAG, 'Flow updated', id);
        return flows[idx];
    }

    /**
     * Get performance metrics for an automation flow.
     * @param {string} id
     * @returns {object|null}
     */
    function getFlowPerformance(id) {
        var flow = loadStore(STORAGE_KEYS.FLOWS).find(function (f) { return f.id === id; });
        if (!flow) { console.warn(TAG, 'Flow not found', id); return null; }
        var s = flow.stats;
        var completionRate = s.entered ? ((s.completed / s.entered) * 100).toFixed(1) : '0.0';
        var conversionRate = s.entered ? ((s.converted / s.entered) * 100).toFixed(1) : '0.0';
        console.log(TAG, 'getFlowPerformance', id);
        return {
            entered: s.entered,
            completed: s.completed,
            converted: s.converted,
            revenue: s.revenue,
            completionRate: completionRate,
            conversionRate: conversionRate,
            flowId: id,
            flowName: flow.name
        };
    }

    /**
     * Generate an AI-powered automation flow template.
     * @param {string} type - One of FLOW_TYPES
     * @param {string} business - Business description
     * @returns {Promise<object>}
     */
    async function generateFlowTemplate(type, business) {
        console.log(TAG, 'generateFlowTemplate', type, business);
        var prompt = 'Design a complete "' + type + '" email automation flow for a business: "' + business + '". ' +
            'Return JSON with: name, trigger (event + conditions), steps (array of {type, subject, ' +
            'bodyOutline, delayHours}), and expectedMetrics (openRate, clickRate, conversionRate).';
        var raw = await aiGenerate(prompt, { maxTokens: 2500 });
        try { return JSON.parse(raw); } catch (_) { return { raw: raw, type: type, note: 'Parse failed - raw AI output' }; }
    }

    /* ================================================================== */
    /*  4. List Management                                                */
    /* ================================================================== */

    /**
     * Retrieve all subscriber lists.
     * @returns {object[]}
     */
    function getLists() {
        console.log(TAG, 'getLists');
        return loadStore(STORAGE_KEYS.LISTS);
    }

    /**
     * Create a new subscriber list.
     * @param {string} name
     * @param {string} [description='']
     * @returns {object}
     */
    function createList(name, description) {
        description = description || '';
        if (!name) throw new Error('List name is required');
        var list = {
            id: uid(),
            name: name,
            description: description,
            subscriberCount: 0,
            growthRate: 0,
            avgOpenRate: 0,
            avgClickRate: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        var lists = loadStore(STORAGE_KEYS.LISTS);
        lists.push(list);
        saveStore(STORAGE_KEYS.LISTS, lists);
        console.log(TAG, 'List created', list.id, name);
        return list;
    }

    /**
     * Get stats for a specific subscriber list.
     * @param {string} listId
     * @returns {object|null}
     */
    function getListStats(listId) {
        var list = loadStore(STORAGE_KEYS.LISTS).find(function (l) { return l.id === listId; });
        if (!list) { console.warn(TAG, 'List not found', listId); return null; }
        console.log(TAG, 'getListStats', listId);
        return {
            id: list.id,
            name: list.name,
            subscriberCount: list.subscriberCount,
            growthRate: list.growthRate,
            avgOpenRate: list.avgOpenRate,
            avgClickRate: list.avgClickRate,
            engagement: list.avgOpenRate > 30 ? 'high' : list.avgOpenRate > 15 ? 'medium' : 'low'
        };
    }

    /**
     * Retrieve all smart segments.
     * @returns {object[]}
     */
    function getSegments() {
        console.log(TAG, 'getSegments');
        return loadStore(STORAGE_KEYS.SEGMENTS);
    }

    /**
     * Create a smart segment with filtering conditions.
     * @param {string} name
     * @param {object[]} conditions - Array of { field, operator, value, type }
     * @returns {object}
     */
    function createSegment(name, conditions) {
        conditions = conditions || [];
        if (!name) throw new Error('Segment name is required');
        var segment = {
            id: uid(),
            name: name,
            conditions: conditions,
            type: deriveSegmentType(conditions),
            estimatedSize: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        var segments = loadStore(STORAGE_KEYS.SEGMENTS);
        segments.push(segment);
        saveStore(STORAGE_KEYS.SEGMENTS, segments);
        console.log(TAG, 'Segment created', segment.id, name);
        return segment;
    }

    /**
     * Derive segment type from its conditions.
     * @param {object[]} conditions
     * @returns {string}
     */
    function deriveSegmentType(conditions) {
        if (!conditions.length) return 'manual';
        var fields = conditions.map(function (c) { return (c.type || c.field || '').toLowerCase(); });
        if (fields.some(function (f) { return f.includes('behavior') || f.includes('click') || f.includes('open'); })) return 'behavior';
        if (fields.some(function (f) { return f.includes('demo') || f.includes('age') || f.includes('location'); })) return 'demographics';
        if (fields.some(function (f) { return f.includes('engage') || f.includes('active'); })) return 'engagement';
        return 'custom';
    }

    /* ================================================================== */
    /*  5. Analytics                                                      */
    /* ================================================================== */

    /**
     * Get dashboard metrics for a date range.
     * @param {object} [dateRange] - { start, end }
     * @returns {object}
     */
    function getDashboardMetrics(dateRange) {
        dateRange = dateRange || {};
        console.log(TAG, 'getDashboardMetrics', dateRange);
        var campaigns = getCampaigns({ status: 'sent', dateRange: dateRange });
        var lists = getLists();
        var totalSubscribers = lists.reduce(function (sum, l) { return sum + (l.subscriberCount || 0); }, 0);
        var totalSent = 0, totalOpens = 0, totalClicks = 0, totalRevenue = 0;
        campaigns.forEach(function (c) {
            totalSent += c.stats.sent || 0;
            totalOpens += c.stats.opens || 0;
            totalClicks += c.stats.clicks || 0;
            totalRevenue += c.stats.revenue || 0;
        });
        var openRate = totalSent ? ((totalOpens / totalSent) * 100).toFixed(1) : '0.0';
        var clickRate = totalOpens ? ((totalClicks / totalOpens) * 100).toFixed(1) : '0.0';
        var conversionRate = totalClicks
            ? ((totalRevenue > 0 ? totalClicks * 0.03 : 0) / totalClicks * 100).toFixed(1)
            : '0.0';
        var avgGrowth = lists.length
            ? (lists.reduce(function (s, l) { return s + (l.growthRate || 0); }, 0) / lists.length).toFixed(1)
            : '0.0';
        return {
            totalSubscribers: totalSubscribers,
            totalCampaignsSent: campaigns.length,
            totalSent: totalSent,
            openRate: parseFloat(openRate),
            clickRate: parseFloat(clickRate),
            conversionRate: parseFloat(conversionRate),
            revenue: totalRevenue,
            listGrowthRate: parseFloat(avgGrowth),
            dateRange: dateRange
        };
    }

    /**
     * Get email deliverability metrics across all sent campaigns.
     * @returns {object}
     */
    function getDeliverabilityMetrics() {
        console.log(TAG, 'getDeliverabilityMetrics');
        var campaigns = getCampaigns({ status: 'sent' });
        var totalSent = 0, totalBounces = 0, totalSpam = 0;
        campaigns.forEach(function (c) {
            totalSent += c.stats.sent || 0;
            totalBounces += c.stats.bounces || 0;
            totalSpam += c.stats.spam || 0;
        });
        var bounceRate = totalSent ? ((totalBounces / totalSent) * 100).toFixed(2) : '0.00';
        var spamRate = totalSent ? ((totalSpam / totalSent) * 100).toFixed(3) : '0.000';
        var inboxPlacement = totalSent
            ? (100 - parseFloat(bounceRate) - parseFloat(spamRate)).toFixed(1)
            : '100.0';
        return {
            totalSent: totalSent,
            bounceRate: parseFloat(bounceRate),
            spamRate: parseFloat(spamRate),
            inboxPlacement: parseFloat(inboxPlacement),
            healthStatus: parseFloat(bounceRate) < 2 && parseFloat(spamRate) < 0.1 ? 'healthy' : 'needs-attention'
        };
    }

    /**
     * Get AI-recommended best send times based on engagement data.
     * @returns {Promise<object>}
     */
    async function getBestSendTimes() {
        console.log(TAG, 'getBestSendTimes');
        var metrics = getDashboardMetrics();
        var campaigns = getCampaigns({ status: 'sent' });
        var sendHistory = campaigns.map(function (c) {
            return {
                sentAt: c.sendDate || c.createdAt,
                openRate: c.stats.sent ? ((c.stats.opens / c.stats.sent) * 100).toFixed(1) : 0
            };
        });
        var prompt = 'Based on this email campaign send history, recommend the best days and ' +
            'times to send marketing emails. Data: ' + JSON.stringify(sendHistory.slice(0, 20)) + '. ' +
            'Overall open rate: ' + metrics.openRate + '%. Return JSON with: bestDays (array), ' +
            'bestTimes (array of {hour, label}), reasoning (string).';
        var raw = await aiGenerate(prompt, { temperature: 0.4 });
        try {
            return JSON.parse(raw);
        } catch (_) {
            return {
                raw: raw,
                bestDays: ['Tuesday', 'Thursday'],
                bestTimes: [{ hour: 10, label: '10:00 AM' }, { hour: 14, label: '2:00 PM' }]
            };
        }
    }

    /**
     * Generate a comprehensive AI email marketing report.
     * @param {object} [dateRange] - { start, end }
     * @returns {Promise<object>}
     */
    async function generateEmailReport(dateRange) {
        dateRange = dateRange || {};
        console.log(TAG, 'generateEmailReport', dateRange);
        var dashboard = getDashboardMetrics(dateRange);
        var deliverability = getDeliverabilityMetrics();
        var flows = getFlows();
        var prompt = 'Generate a comprehensive email marketing performance report. ' +
            'Dashboard metrics: ' + JSON.stringify(dashboard) + '. ' +
            'Deliverability: ' + JSON.stringify(deliverability) + '. ' +
            'Active flows: ' + flows.length + '. ' +
            'Return JSON with: summary (string), highlights (array), concerns (array), ' +
            'recommendations (array), projections (object with nextMonth estimates).';
        var raw = await aiGenerate(prompt, { maxTokens: 2500 });
        try {
            var report = JSON.parse(raw);
            report.generatedAt = new Date().toISOString();
            report.dateRange = dateRange;
            return report;
        } catch (_) {
            return { raw: raw, generatedAt: new Date().toISOString(), dateRange: dateRange };
        }
    }

    /* ================================================================== */
    /*  6. Templates                                                      */
    /* ================================================================== */

    /**
     * Retrieve all saved email templates.
     * @returns {object[]}
     */
    function getTemplates() {
        console.log(TAG, 'getTemplates');
        return loadStore(STORAGE_KEYS.TEMPLATES);
    }

    /**
     * Save a reusable email template.
     * @param {string} name
     * @param {string} html
     * @param {string} [category='general']
     * @returns {object}
     */
    function saveTemplate(name, html, category) {
        category = category || 'general';
        if (!name) throw new Error('Template name is required');
        if (!html) throw new Error('Template HTML is required');
        var template = {
            id: uid(),
            name: name,
            html: html,
            category: category,
            usageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        var templates = loadStore(STORAGE_KEYS.TEMPLATES);
        templates.push(template);
        saveStore(STORAGE_KEYS.TEMPLATES, templates);
        console.log(TAG, 'Template saved', template.id, name);
        return template;
    }

    /**
     * Generate an AI-designed email template.
     * @param {string} purpose - e.g. 'product-launch', 'newsletter', 'event-invite'
     * @param {string} brand - Brand name or description
     * @returns {Promise<object>}
     */
    async function generateTemplate(purpose, brand) {
        console.log(TAG, 'generateTemplate', purpose, brand);
        var prompt = 'Design an email template for "' + purpose + '" for brand "' + brand + '". ' +
            'Return JSON with: name, category, subject, preheader, html (complete responsive ' +
            'HTML email with inline CSS, mobile-friendly, includes header, hero section, ' +
            'content blocks, CTA button, and footer). Use placeholder text that is contextual.';
        var raw = await aiGenerate(prompt, { maxTokens: 3000 });
        try {
            return JSON.parse(raw);
        } catch (_) {
            return { name: purpose + ' Template', html: raw, category: purpose };
        }
    }

    /* ================================================================== */
    /*  Public API                                                        */
    /* ================================================================== */

    /**
     * @namespace EmailMarketingService
     */
    window.EmailMarketingService = {
        /* Campaign Management */
        getCampaigns: getCampaigns,
        getCampaignsAsync: getCampaignsAsync,
        createCampaign: createCampaign,
        updateCampaign: updateCampaign,
        deleteCampaign: deleteCampaign,
        scheduleCampaign: scheduleCampaign,
        getCampaignStats: getCampaignStats,
        getCampaignStatsAsync: getCampaignStatsAsync,

        /* AI Email Generation */
        generateSubjectLines: generateSubjectLines,
        generateEmailBody: generateEmailBody,
        generateWelcomeSeries: generateWelcomeSeries,
        generateNewsletterContent: generateNewsletterContent,
        optimizeForConversion: optimizeForConversion,
        generateABTestVariants: generateABTestVariants,

        /* Automation Flows */
        getFlows: getFlows,
        createFlow: createFlow,
        updateFlow: updateFlow,
        getFlowPerformance: getFlowPerformance,
        generateFlowTemplate: generateFlowTemplate,

        /* List Management */
        getLists: getLists,
        createList: createList,
        getListStats: getListStats,
        getSegments: getSegments,
        createSegment: createSegment,

        /* Analytics */
        getDashboardMetrics: getDashboardMetrics,
        getDeliverabilityMetrics: getDeliverabilityMetrics,
        getBestSendTimes: getBestSendTimes,
        generateEmailReport: generateEmailReport,

        /* Templates */
        getTemplates: getTemplates,
        saveTemplate: saveTemplate,
        generateTemplate: generateTemplate,

        /* Constants */
        CAMPAIGN_TYPES: CAMPAIGN_TYPES,
        FLOW_TYPES: FLOW_TYPES
    };

    console.log(TAG, 'EmailMarketingService initialized');
})();
