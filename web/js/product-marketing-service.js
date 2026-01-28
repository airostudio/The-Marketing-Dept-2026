/**
 * Product Marketing Manager Agent Service
 * =========================================
 * Manages product launches, market research, competitive positioning,
 * sales enablement, customer personas, pricing strategy, and messaging.
 * Integrates with AIService (OpenAI/Gemini), ProjectService, and APP_CONFIG.
 * @namespace ProductMarketingService
 */
(function () {
    'use strict';

    const LOG = '[ProductMarketing]';
    const KEYS = {
        launches: 'pmm-launches', research: 'pmm-market-research',
        personas: 'pmm-personas', competitors: 'pmm-competitors',
        salesAssets: 'pmm-sales-assets', pricing: 'pmm-pricing-strategy',
        messaging: 'pmm-messaging'
    };

    /* ---- Storage & utility helpers ---- */

    /** @param {string} k @param {*} fb @returns {*} */
    function load(k, fb) {
        try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; }
        catch (e) { console.warn(LOG, 'Storage read error:', e); return fb; }
    }
    /** @param {string} k @param {*} v */
    function save(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); }
        catch (e) { console.error(LOG, 'Storage write error:', e); }
        // Async persist to Supabase
        if (window.MarketingStore) {
            window.MarketingStore.set('product-marketing', k, v).catch(function(e) {
                console.warn(LOG, 'MarketingStore persist failed:', e.message);
            });
        }
    }
    /** Async load from Supabase (falls back to localStorage) */
    async function loadAsync(k, fb) {
        if (window.MarketingStore) {
            try {
                var data = await window.MarketingStore.get('product-marketing', k, null);
                if (data !== null) {
                    try { localStorage.setItem(k, JSON.stringify(data)); } catch (_) {}
                    return data;
                }
            } catch (e) { console.warn(LOG, 'MarketingStore load failed:', e.message); }
        }
        return load(k, fb);
    }
    function uid() { return 'pmm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
    function now() { return new Date().toISOString(); }

    /* ---- AI helper ---- */

    /** @param {string} prompt @param {object} [opts] @returns {Promise<string>} */
    async function ai(prompt, opts) {
        var cfg = Object.assign({ maxTokens: 2000, temperature: 0.5 }, opts || {});
        if (!window.AIService?.AI?.generate) {
            console.warn(LOG, 'AIService not available');
            return '[AI unavailable] Please configure AIService to generate content.';
        }
        try {
            console.log(LOG, 'AI request (' + prompt.length + ' chars)');
            var result = await window.AIService.AI.generate(prompt, cfg);
            console.log(LOG, 'AI response received');
            return result;
        } catch (e) {
            console.error(LOG, 'AI generation failed:', e);
            throw new Error('AI generation failed: ' + (e.message || e));
        }
    }

    /* ================================================================== */
    /*  1. Product Launch Planning                                        */
    /* ================================================================== */
    var PHASES = ['pre-launch', 'soft-launch', 'launch-day', 'post-launch', 'optimization'];

    /** @returns {Array<object>} All product launches */
    function getLaunches() { console.log(LOG, 'Fetching launches'); return load(KEYS.launches, []); }

    /**
     * Create a new product launch plan.
     * @param {object} cfg - { product, launchDate, phases, channels, goals }
     * @returns {object}
     */
    function createLaunch(cfg) {
        if (!cfg || !cfg.product) throw new Error('Launch config must include a product name.');
        var l = {
            id: uid(), product: cfg.product, launchDate: cfg.launchDate || null,
            phases: cfg.phases || PHASES.slice(), channels: cfg.channels || [],
            goals: cfg.goals || [], currentPhase: 'pre-launch', status: 'planning',
            checklist: [], createdAt: now(), updatedAt: now()
        };
        var arr = getLaunches(); arr.push(l); save(KEYS.launches, arr);
        console.log(LOG, 'Launch created:', l.id, '-', l.product);
        return l;
    }

    /** @param {string} id @param {object} updates @returns {object|null} */
    function updateLaunch(id, updates) {
        var arr = getLaunches(), idx = arr.findIndex(function (l) { return l.id === id; });
        if (idx === -1) { console.warn(LOG, 'Launch not found:', id); return null; }
        Object.assign(arr[idx], updates, { updatedAt: now() });
        save(KEYS.launches, arr); console.log(LOG, 'Launch updated:', id);
        return arr[idx];
    }

    /** @param {string} launchId @returns {object} Checklist grouped by phase */
    function getLaunchChecklist(launchId) {
        console.log(LOG, 'Building checklist for:', launchId);
        return {
            'pre-launch': [
                { task: 'Define target personas', done: false },
                { task: 'Finalize positioning & messaging', done: false },
                { task: 'Create press kit & media outreach list', done: false },
                { task: 'Prepare landing page and demo', done: false },
                { task: 'Set up analytics & tracking', done: false },
                { task: 'Brief sales team & create battlecards', done: false },
                { task: 'Schedule social & email campaigns', done: false }
            ],
            'launch-day': [
                { task: 'Publish landing page & blog post', done: false },
                { task: 'Send press release', done: false },
                { task: 'Activate paid campaigns', done: false },
                { task: 'Post on social channels', done: false },
                { task: 'Send email announcement', done: false },
                { task: 'Monitor social mentions & respond', done: false }
            ],
            'post-launch': [
                { task: 'Analyze launch metrics vs. goals', done: false },
                { task: 'Gather customer feedback', done: false },
                { task: 'Publish case studies & testimonials', done: false },
                { task: 'Iterate on messaging based on data', done: false },
                { task: 'Conduct internal retrospective', done: false }
            ]
        };
    }

    /** @param {string} product @param {string} market @param {string} timeline @returns {Promise<string>} */
    async function generateLaunchPlan(product, market, timeline) {
        console.log(LOG, 'Generating launch plan:', product);
        return ai(
            'You are a senior product marketing manager. Create a comprehensive go-to-market launch plan.\n\n' +
            'Product: ' + product + '\nTarget Market: ' + market + '\nTimeline: ' + timeline + '\n\n' +
            'Include: 1) Executive Summary 2) Target Audience & Personas 3) Positioning & Messaging ' +
            '4) Channel Strategy (paid, organic, partnerships) 5) Content Plan (blog, social, email, PR) ' +
            '6) Sales Enablement Materials 7) Launch Phases (pre-launch, soft-launch, launch day, post-launch, ' +
            'optimization) 8) KPIs & Success Metrics 9) Budget Allocation 10) Risk Mitigation.\nFormat as Markdown.'
        );
    }

    /** @param {string} product @param {string} launchDate @returns {Promise<string>} */
    async function generateLaunchTimeline(product, launchDate) {
        console.log(LOG, 'Generating launch timeline:', product);
        return ai(
            'Create a detailed product launch timeline.\n\nProduct: ' + product + '\nLaunch Date: ' + launchDate +
            '\n\nProvide week-by-week plan from 8 weeks before through 4 weeks after. For each week: ' +
            'milestones, deliverables, responsible teams, dependencies.\nFormat as Markdown timeline.'
        );
    }

    /* ================================================================== */
    /*  2. Market Research                                                 */
    /* ================================================================== */

    /** @returns {Array<object>} Saved research entries */
    function getMarketResearch() { console.log(LOG, 'Fetching research'); return load(KEYS.research, []); }

    /** @private */
    function _saveResearch(entry) {
        var d = getMarketResearch(); entry.id = entry.id || uid(); entry.savedAt = now();
        d.push(entry); save(KEYS.research, d);
    }

    /** @param {string} industry @param {string} geography @returns {Promise<string>} */
    async function generateMarketAnalysis(industry, geography) {
        console.log(LOG, 'Market analysis:', industry, geography);
        var r = await ai(
            'Provide a detailed market analysis for ' + industry + ' in ' + geography + '.\n' +
            'Include: 1) TAM/SAM/SOM 2) Market size & CAGR 3) Key trends & drivers 4) Regulatory landscape ' +
            '5) Barriers to entry 6) Customer segmentation 7) Revenue model insights.\nFormat as Markdown.'
        );
        _saveResearch({ type: 'market-analysis', industry: industry, geography: geography, content: r });
        return r;
    }

    /** @param {string} product @param {string} market @returns {Promise<string>} */
    async function generateSWOTAnalysis(product, market) {
        console.log(LOG, 'SWOT:', product);
        var r = await ai(
            'Perform a comprehensive SWOT analysis.\n\nProduct: ' + product + '\nMarket: ' + market + '\n\n' +
            'For each category provide at least 5 items with explanations and strategic recommendations. ' +
            'End with a strategic action plan.'
        );
        _saveResearch({ type: 'swot', product: product, market: market, content: r });
        return r;
    }

    /** @param {string} industry @returns {Promise<string>} */
    async function identifyMarketTrends(industry) {
        console.log(LOG, 'Trends:', industry);
        var r = await ai(
            'Identify the top 10 emerging trends in ' + industry + '. For each: description, adoption stage, ' +
            'market impact, opportunities, mainstream timeline.\nFormat as numbered Markdown list.'
        );
        _saveResearch({ type: 'trends', industry: industry, content: r });
        return r;
    }

    /** @param {string} product @param {string} market @returns {Promise<string>} */
    async function analyzeMarketFit(product, market) {
        console.log(LOG, 'PMF analysis:', product);
        return ai(
            'Analyze product-market fit.\n\nProduct: ' + product + '\nMarket: ' + market + '\n\n' +
            'Evaluate: 1) Problem-solution alignment 2) Value proposition 3) Audience readiness ' +
            '4) Differentiation 5) Willingness to pay 6) Timing 7) Distribution viability ' +
            '8) Retention potential.\nProvide PMF score (1-10) with justification and recommendations.'
        );
    }

    /** @param {string} industry @returns {Promise<string>} */
    async function generateIndustryReport(industry) {
        console.log(LOG, 'Industry report:', industry);
        var r = await ai(
            'Create a comprehensive industry report for ' + industry + '. Include: 1) Overview 2) Market Size ' +
            '& Growth 3) Key Players & Share 4) Value Chain 5) Tech Trends 6) Consumer Behavior 7) Regulatory ' +
            'Environment 8) Investment Landscape 9) Future Outlook (3-5yr) 10) Recommendations.\nFormat as Markdown.'
        );
        _saveResearch({ type: 'industry-report', industry: industry, content: r });
        return r;
    }

    /* ================================================================== */
    /*  3. Customer Personas                                               */
    /* ================================================================== */

    /** @returns {Array<object>} All personas */
    function getPersonas() { console.log(LOG, 'Fetching personas'); return load(KEYS.personas, []); }

    /**
     * Create persona.
     * @param {object} cfg - { name, demographics, goals, painPoints, behaviors, channels }
     * @returns {object}
     */
    function createPersona(cfg) {
        if (!cfg || !cfg.name) throw new Error('Persona config must include a name.');
        var p = {
            id: uid(), name: cfg.name, demographics: cfg.demographics || {},
            goals: cfg.goals || [], painPoints: cfg.painPoints || [],
            behaviors: cfg.behaviors || [], channels: cfg.channels || [],
            createdAt: now(), updatedAt: now()
        };
        var arr = getPersonas(); arr.push(p); save(KEYS.personas, arr);
        console.log(LOG, 'Persona created:', p.id, '-', p.name);
        return p;
    }

    /** @param {string} id @param {object} updates @returns {object|null} */
    function updatePersona(id, updates) {
        var arr = getPersonas(), idx = arr.findIndex(function (p) { return p.id === id; });
        if (idx === -1) { console.warn(LOG, 'Persona not found:', id); return null; }
        Object.assign(arr[idx], updates, { updatedAt: now() });
        save(KEYS.personas, arr); console.log(LOG, 'Persona updated:', id);
        return arr[idx];
    }

    /** @param {string} product @param {string} market @returns {Promise<string>} */
    async function generatePersona(product, market) {
        console.log(LOG, 'Generating persona:', product);
        return ai(
            'Create a detailed buyer persona.\n\nProduct: ' + product + '\nMarket: ' + market + '\n\n' +
            'Include: Name & Avatar, Demographics (age, role, company size, income), Psychographics, ' +
            'Goals & Motivations, Pain Points, Buying Behavior, Preferred Channels, Tech Proficiency, ' +
            'Common Objections, Messaging That Resonates.\nFormat as Markdown.'
        );
    }

    /** @param {string} personaId @returns {Promise<string>} */
    async function generatePersonaJourney(personaId) {
        var all = getPersonas(), p = all.find(function (x) { return x.id === personaId; });
        var desc = p ? p.name + ' (' + JSON.stringify(p.demographics) + ')' : 'general buyer persona';
        console.log(LOG, 'Generating journey:', personaId);
        return ai(
            'Map the complete customer journey for: ' + desc + '.\n\nStages: 1) Awareness 2) Consideration ' +
            '3) Decision 4) Onboarding 5) Retention 6) Advocacy.\nFor each: touchpoints, emotions, actions, ' +
            'pain points, opportunities.\nFormat as Markdown.'
        );
    }

    /** @param {string} personaId @returns {Promise<string>} */
    async function getPersonaInsights(personaId) {
        var all = getPersonas(), p = all.find(function (x) { return x.id === personaId; });
        var desc = p
            ? p.name + ' - Goals: ' + (p.goals || []).join(', ') + ' - Pain Points: ' + (p.painPoints || []).join(', ')
            : 'unknown persona';
        console.log(LOG, 'Persona insights:', personaId);
        return ai(
            'Provide actionable marketing insights for targeting:\n\n' + desc + '\n\n' +
            'Include: 1) Best content types 2) Optimal channels 3) Messaging angles 4) Ad targeting ' +
            '5) Email subject strategies 6) Offer types & CTAs 7) Timing & frequency.\nFormat as Markdown.'
        );
    }

    /* ================================================================== */
    /*  4. Competitive Positioning                                         */
    /* ================================================================== */

    /** @returns {Array<object>} Tracked competitors */
    function getCompetitors() { console.log(LOG, 'Fetching competitors'); return load(KEYS.competitors, []); }

    /**
     * Add competitor.
     * @param {object} cfg - { name, url, products, positioning, strengths, weaknesses }
     * @returns {object}
     */
    function addCompetitor(cfg) {
        if (!cfg || !cfg.name) throw new Error('Competitor config must include a name.');
        var c = {
            id: uid(), name: cfg.name, url: cfg.url || '', products: cfg.products || [],
            positioning: cfg.positioning || '', strengths: cfg.strengths || [],
            weaknesses: cfg.weaknesses || [], createdAt: now(), updatedAt: now()
        };
        var arr = getCompetitors(); arr.push(c); save(KEYS.competitors, arr);
        console.log(LOG, 'Competitor added:', c.id, '-', c.name);
        return c;
    }

    /** @param {string} competitorUrl @returns {Promise<string>} */
    async function generateCompetitorProfile(competitorUrl) {
        console.log(LOG, 'Competitor profile:', competitorUrl);
        return ai(
            'Create a comprehensive competitor profile for: ' + competitorUrl + '\n\n' +
            'Include: 1) Company Overview 2) Product Portfolio & Pricing 3) Target Market & Positioning ' +
            '4) Strengths & Weaknesses 5) Marketing Strategy 6) Tech Stack 7) Customer Sentiment ' +
            '8) Recent News 9) Market Share Estimate 10) Threat Level (1-10).\nFormat as Markdown.'
        );
    }

    /** @param {string} competitorId @returns {Promise<string>} */
    async function generateBattlecard(competitorId) {
        var comps = getCompetitors(), c = comps.find(function (x) { return x.id === competitorId; });
        var desc = c
            ? c.name + ' (' + c.url + ') - Strengths: ' + (c.strengths || []).join(', ') + ' - Weaknesses: ' + (c.weaknesses || []).join(', ')
            : 'unknown competitor';
        console.log(LOG, 'Battlecard:', competitorId);
        return ai(
            'Create a sales battlecard vs:\n\n' + desc + '\n\nInclude: 1) Quick Overview 2) Key Selling Points ' +
            '3) Weaknesses to Exploit 4) Feature Comparison 5) Pricing Comparison 6) Common Objections ' +
            '7) Winning Talk Tracks 8) Proof Points 9) Land Mines 10) Knock-Out Questions.\nFormat as Markdown.'
        );
    }

    /** @param {string} feature @returns {object} */
    function getCompetitiveMatrix(feature) {
        console.log(LOG, 'Competitive matrix:', feature);
        return {
            feature: feature, generatedAt: now(),
            competitors: getCompetitors().map(function (c) {
                return { id: c.id, name: c.name, products: c.products, positioning: c.positioning, strengths: c.strengths, weaknesses: c.weaknesses };
            })
        };
    }

    /** @param {Array<object>} deals @returns {Promise<string>} */
    async function generateWinLossAnalysis(deals) {
        console.log(LOG, 'Win/loss analysis:', (deals || []).length, 'deals');
        return ai(
            'Analyze this win/loss deal data:\n\n' + JSON.stringify(deals || [], null, 2) + '\n\n' +
            'Include: 1) Win Rate Summary 2) Top Win Reasons 3) Top Loss Reasons 4) Competitor Patterns ' +
            '5) Deal Size Trends 6) Sales Cycle Insights 7) Recommendations.\nFormat as Markdown.'
        );
    }

    /** @param {Array<object>} competitors @returns {Promise<string>} */
    async function generateDifferentiationStrategy(competitors) {
        console.log(LOG, 'Differentiation strategy');
        var s = (competitors || []).map(function (c) { return (c.name || 'Unknown') + ': ' + (c.positioning || 'N/A'); }).join('\n');
        return ai(
            'Given these competitors:\n\n' + s + '\n\nRecommend differentiation: 1) Unique Value Props ' +
            '2) White Space Analysis 3) Feature Differentiation 4) Brand Angles 5) Pricing Tactics ' +
            '6) Experience Ideas 7) Messaging Framework.\nFormat as Markdown.'
        );
    }

    /* ================================================================== */
    /*  5. Sales Enablement                                                */
    /* ================================================================== */

    /** @returns {Array<object>} All sales assets */
    function getSalesAssets() { console.log(LOG, 'Fetching sales assets'); return load(KEYS.salesAssets, []); }

    /** @private */
    function _saveAsset(a) {
        var arr = getSalesAssets(); a.id = a.id || uid(); a.createdAt = now();
        arr.push(a); save(KEYS.salesAssets, arr);
    }

    /** @param {string} product @param {string} audience @returns {Promise<string>} */
    async function generatePitchDeck(product, audience) {
        console.log(LOG, 'Pitch deck:', product);
        var r = await ai(
            'Create a pitch deck outline.\n\nProduct: ' + product + '\nAudience: ' + audience + '\n\n' +
            'Provide 12-15 slides: title, key message, bullets, visual suggestions, speaker notes.\n' +
            'Slides: Title, Problem, Solution, Demo, Market, Business Model, Traction, Team, Competition, ' +
            'Go-to-Market, Financials, Ask/CTA.\nFormat as Markdown.'
        );
        _saveAsset({ type: 'pitch-deck', product: product, audience: audience, content: r });
        return r;
    }

    /** @param {string} product @param {string[]} commonObjections @returns {Promise<string>} */
    async function generateObjectionHandling(product, commonObjections) {
        console.log(LOG, 'Objection handling:', product);
        var r = await ai(
            'Create objection handling guide.\n\nProduct: ' + product + '\nObjections:\n- ' +
            (commonObjections || []).join('\n- ') + '\n\nFor each: 1) Acknowledge 2) Clarify 3) Respond ' +
            '4) Evidence 5) Redirect. Also add 5 anticipated objections.\nFormat as Markdown.'
        );
        _saveAsset({ type: 'objection-handling', product: product, content: r });
        return r;
    }

    /** @param {string} customer @param {object} results @returns {Promise<string>} */
    async function generateCaseStudy(customer, results) {
        console.log(LOG, 'Case study:', customer);
        var r = await ai(
            'Write a compelling case study.\n\nCustomer: ' + customer + '\nResults:\n' +
            JSON.stringify(results || {}, null, 2) + '\n\nStructure: 1) Executive Summary 2) Background ' +
            '3) Challenge 4) Solution 5) Results & Metrics 6) Quote 7) Takeaways 8) CTA.\nFormat as Markdown.'
        );
        _saveAsset({ type: 'case-study', customer: customer, content: r });
        return r;
    }

    /** @param {string} product @param {string} persona @param {string} stage @returns {Promise<string>} */
    async function generateSalesEmail(product, persona, stage) {
        console.log(LOG, 'Sales email:', product, stage);
        var r = await ai(
            'Create a 5-email sales sequence.\n\nProduct: ' + product + '\nPersona: ' + persona +
            '\nStage: ' + stage + '\n\nFor each: subject line (A/B variant), preview text, body, CTA, ' +
            'send timing, goal.\nConversational tone. Format as Markdown.'
        );
        _saveAsset({ type: 'sales-email', product: product, persona: persona, stage: stage, content: r });
        return r;
    }

    /** @param {string} product @param {object} metrics @returns {Promise<string>} */
    async function generateROICalculator(product, metrics) {
        console.log(LOG, 'ROI calculator:', product);
        var r = await ai(
            'Create ROI talking points.\n\nProduct: ' + product + '\nMetrics:\n' +
            JSON.stringify(metrics || {}, null, 2) + '\n\nInclude: 1) Value Drivers 2) ROI Formula ' +
            '3) Payback Period 4) TCO Comparison 5) Benchmarks 6) Objection Responses 7) Sales Script.\n' +
            'Format as Markdown.'
        );
        _saveAsset({ type: 'roi-calculator', product: product, content: r });
        return r;
    }

    /* ================================================================== */
    /*  6. Pricing & Packaging                                             */
    /* ================================================================== */

    /** @returns {object|null} Current pricing model */
    function getPricingStrategy() { console.log(LOG, 'Fetching pricing'); return load(KEYS.pricing, null); }

    /** @param {object} strategy */
    function savePricingStrategy(strategy) {
        if (!strategy) throw new Error('Pricing strategy object is required.');
        strategy.updatedAt = now(); save(KEYS.pricing, strategy);
        console.log(LOG, 'Pricing strategy saved');
    }

    /** @param {string} product @param {string} market @param {Array<object>} competitors @returns {Promise<string>} */
    async function analyzePricing(product, market, competitors) {
        console.log(LOG, 'Pricing analysis:', product);
        var cp = (competitors || []).map(function (c) { return (c.name || '?') + ': ' + (c.pricing || 'N/A'); }).join('\n');
        return ai(
            'Provide pricing analysis.\n\nProduct: ' + product + '\nMarket: ' + market +
            '\nCompetitor Pricing:\n' + cp + '\n\nInclude: 1) Model Recommendations 2) Price Points ' +
            '3) Tier Structure 4) Psychological Tactics 5) Discount Strategy 6) Annual vs Monthly ' +
            '7) Enterprise Approach 8) Positioning Map.\nFormat as Markdown.'
        );
    }

    /** @param {Array<object>} tiers @returns {Promise<string>} */
    async function generatePricingPage(tiers) {
        console.log(LOG, 'Pricing page copy');
        return ai(
            'Write pricing page copy for:\n\n' + JSON.stringify(tiers || [], null, 2) + '\n\n' +
            'Include: 1) Headline & subheadline 2) Tier descriptions 3) Feature lists 4) Recommended tier ' +
            '5) FAQ (8-10 questions) 6) Social proof 7) CTA copy 8) Annual savings.\nFormat as Markdown.'
        );
    }

    /** @param {string} product @param {object} data @returns {Promise<string>} */
    async function modelPriceElasticity(product, data) {
        console.log(LOG, 'Price elasticity:', product);
        return ai(
            'Analyze price sensitivity.\n\nProduct: ' + product + '\nData:\n' +
            JSON.stringify(data || {}, null, 2) + '\n\nProvide: 1) Elasticity Assessment 2) Van Westendorp ' +
            '3) Gabor-Granger 4) Optimal Price 5) Revenue vs Penetration 6) Change Projections ' +
            '7) Segment-Level Sensitivity.\nFormat as Markdown.'
        );
    }

    /* ================================================================== */
    /*  7. Messaging & Positioning                                         */
    /* ================================================================== */

    /** @param {string} product @param {string} market @param {Array<object>} competitors @returns {Promise<string>} */
    async function generatePositioningFramework(product, market, competitors) {
        console.log(LOG, 'Positioning framework:', product);
        var cl = (competitors || []).map(function (c) { return c.name || 'Unknown'; }).join(', ');
        return ai(
            'Create positioning framework.\n\nProduct: ' + product + '\nMarket: ' + market +
            '\nCompetitors: ' + cl + '\n\nInclude: 1) Positioning Statement (Moore template) 2) Value Prop ' +
            'Canvas 3) Category Design 4) Messaging Pillars (3-4) 5) Elevator Pitch (30s/60s) 6) Taglines (5) ' +
            '7) Boilerplate (short/medium/long) 8) Tone & Voice 9) Keywords 10) Words to Avoid.\nFormat as Markdown.'
        );
    }

    /** @param {Array<object>} features - [{ name, description }] @returns {Promise<string>} */
    async function generateFeatureBenefitMatrix(features) {
        console.log(LOG, 'Feature-benefit matrix');
        var fl = (features || []).map(function (f) { return (f.name || 'Feature') + ': ' + (f.description || ''); }).join('\n');
        return ai(
            'Create feature-to-benefit matrix:\n\n' + fl + '\n\nFor each: 1) Feature Name 2) Functional Benefit ' +
            '3) Emotional Benefit 4) Business Benefit 5) Marketing One-liner 6) Target Persona.\n' +
            'Format as Markdown table then expanded descriptions.'
        );
    }

    /** @param {string} product @param {Array<object>} personas @returns {Promise<string>} */
    async function generateUseCases(product, personas) {
        console.log(LOG, 'Use cases:', product);
        var pl = (personas || []).map(function (p) { return p.name || 'User'; }).join(', ');
        return ai(
            'Create use case narratives.\n\nProduct: ' + product + '\nPersonas: ' + pl + '\n\n' +
            'Per persona 2-3 use cases: 1) Title 2) Scenario 3) User Story 4) Workflow 5) Outcome ' +
            '6) Value Delivered 7) Testimonial Quote Draft.\nFormat as Markdown.'
        );
    }

    /* ================================================================== */
    /*  Public API                                                         */
    /* ================================================================== */
    var svc = {
        getLaunches: getLaunches, createLaunch: createLaunch, updateLaunch: updateLaunch,
        getLaunchChecklist: getLaunchChecklist, generateLaunchPlan: generateLaunchPlan,
        generateLaunchTimeline: generateLaunchTimeline,
        getMarketResearch: getMarketResearch, generateMarketAnalysis: generateMarketAnalysis,
        generateSWOTAnalysis: generateSWOTAnalysis, identifyMarketTrends: identifyMarketTrends,
        analyzeMarketFit: analyzeMarketFit, generateIndustryReport: generateIndustryReport,
        getPersonas: getPersonas, createPersona: createPersona, updatePersona: updatePersona,
        generatePersona: generatePersona, generatePersonaJourney: generatePersonaJourney,
        getPersonaInsights: getPersonaInsights,
        getCompetitors: getCompetitors, addCompetitor: addCompetitor,
        generateCompetitorProfile: generateCompetitorProfile, generateBattlecard: generateBattlecard,
        getCompetitiveMatrix: getCompetitiveMatrix, generateWinLossAnalysis: generateWinLossAnalysis,
        generateDifferentiationStrategy: generateDifferentiationStrategy,
        getSalesAssets: getSalesAssets, generatePitchDeck: generatePitchDeck,
        generateObjectionHandling: generateObjectionHandling, generateCaseStudy: generateCaseStudy,
        generateSalesEmail: generateSalesEmail, generateROICalculator: generateROICalculator,
        getPricingStrategy: getPricingStrategy, savePricingStrategy: savePricingStrategy,
        analyzePricing: analyzePricing, generatePricingPage: generatePricingPage,
        modelPriceElasticity: modelPriceElasticity,
        generatePositioningFramework: generatePositioningFramework,
        generateFeatureBenefitMatrix: generateFeatureBenefitMatrix,
        generateUseCases: generateUseCases
    };

    window.ProductMarketingService = svc;
    console.log(LOG, 'Service initialized -', Object.keys(svc).length, 'methods exposed');
})();
