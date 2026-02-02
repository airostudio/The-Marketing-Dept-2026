/**
 * Content Strategist Service
 * The Marketing Department 2026
 *
 * A comprehensive content strategy management system that handles:
 * - Strategy Development & Planning
 * - Content Audits & Gap Analysis
 * - Editorial Calendar Management
 * - Brand Voice & Style Guide
 * - Performance Analytics
 * - Competitor Content Analysis
 * - Content Workflow Management
 * - User Journey Mapping
 */

(function() {
    'use strict';

    var TAG = '[ContentStrategist]';
    var STORAGE_PREFIX = 'content_strategist_';

    // ═══════════════════════════════════════════════════════════════════════════
    // STORAGE LAYER
    // ═══════════════════════════════════════════════════════════════════════════

    var Storage = {
        save: function(key, value) {
            try {
                localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
            } catch (err) {
                console.error(TAG, 'Storage save failed:', err);
            }
            // Persist to Supabase
            if (window.MarketingStore) {
                window.MarketingStore.set('content-strategist', key, value).catch(function(e) {
                    console.warn(TAG, 'MarketingStore persist failed:', e.message);
                });
            }
        },
        load: function(key, fallback) {
            try {
                var data = localStorage.getItem(STORAGE_PREFIX + key);
                return data ? JSON.parse(data) : fallback;
            } catch (err) {
                console.error(TAG, 'Storage load failed:', err);
                return fallback;
            }
        },
        loadAsync: async function(key, fallback) {
            if (window.MarketingStore) {
                try {
                    var data = await window.MarketingStore.get('content-strategist', key, null);
                    if (data !== null) {
                        try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data)); }
                        catch (_) { /* ignore */ }
                        return data;
                    }
                } catch (e) {
                    console.warn(TAG, 'MarketingStore load failed:', e.message);
                }
            }
            return this.load(key, fallback);
        },
        remove: function(key) {
            try {
                localStorage.removeItem(STORAGE_PREFIX + key);
            } catch (err) {
                console.error(TAG, 'Storage remove failed:', err);
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA MODELS
    // ═══════════════════════════════════════════════════════════════════════════

    // Content Strategy Template
    var defaultStrategy = {
        id: null,
        name: 'Untitled Strategy',
        description: '',
        goals: [],
        targetAudiences: [],
        contentPillars: [],
        channels: [],
        kpis: [],
        createdAt: null,
        updatedAt: null
    };

    // Content Item Template
    var defaultContentItem = {
        id: null,
        title: '',
        type: 'blog', // blog, social, email, video, landing-page, case-study, whitepaper
        status: 'idea', // idea, planned, in-progress, review, approved, published, archived
        priority: 'medium', // low, medium, high, urgent
        pillar: '',
        channel: '',
        targetAudience: '',
        author: '',
        dueDate: null,
        publishDate: null,
        description: '',
        outline: '',
        keywords: [],
        wordCount: 0,
        performanceScore: null,
        metrics: {
            views: 0,
            engagement: 0,
            conversions: 0,
            shares: 0
        },
        createdAt: null,
        updatedAt: null
    };

    // Brand Voice Template
    var defaultBrandVoice = {
        tone: [],
        personality: [],
        doList: [],
        dontList: [],
        vocabulary: {
            preferred: [],
            avoided: []
        },
        examples: []
    };

    // Competitor Template
    var defaultCompetitor = {
        id: null,
        name: '',
        website: '',
        contentTypes: [],
        publishingFrequency: '',
        strengths: [],
        weaknesses: [],
        topContent: [],
        socialChannels: [],
        notes: ''
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STRATEGY MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    var StrategyManager = {
        getStrategy: async function() {
            return await Storage.loadAsync('strategy', Object.assign({}, defaultStrategy, {
                id: generateId(),
                createdAt: new Date().toISOString()
            }));
        },

        saveStrategy: function(strategy) {
            strategy.updatedAt = new Date().toISOString();
            Storage.save('strategy', strategy);
            return strategy;
        },

        // Content Pillars - Core themes/topics
        addContentPillar: async function(pillar) {
            var strategy = await this.getStrategy();
            strategy.contentPillars.push({
                id: generateId(),
                name: pillar.name,
                description: pillar.description || '',
                keywords: pillar.keywords || [],
                contentCount: 0,
                createdAt: new Date().toISOString()
            });
            return this.saveStrategy(strategy);
        },

        removeContentPillar: async function(pillarId) {
            var strategy = await this.getStrategy();
            strategy.contentPillars = strategy.contentPillars.filter(function(p) {
                return p.id !== pillarId;
            });
            return this.saveStrategy(strategy);
        },

        // Target Audiences
        addTargetAudience: async function(audience) {
            var strategy = await this.getStrategy();
            strategy.targetAudiences.push({
                id: generateId(),
                name: audience.name,
                description: audience.description || '',
                demographics: audience.demographics || {},
                painPoints: audience.painPoints || [],
                goals: audience.goals || [],
                preferredChannels: audience.preferredChannels || [],
                buyerJourneyStage: audience.buyerJourneyStage || 'awareness',
                createdAt: new Date().toISOString()
            });
            return this.saveStrategy(strategy);
        },

        // Goals & KPIs
        addGoal: async function(goal) {
            var strategy = await this.getStrategy();
            strategy.goals.push({
                id: generateId(),
                name: goal.name,
                description: goal.description || '',
                metric: goal.metric || '',
                target: goal.target || '',
                deadline: goal.deadline || null,
                progress: 0,
                createdAt: new Date().toISOString()
            });
            return this.saveStrategy(strategy);
        },

        updateGoalProgress: async function(goalId, progress) {
            var strategy = await this.getStrategy();
            var goal = strategy.goals.find(function(g) { return g.id === goalId; });
            if (goal) {
                goal.progress = progress;
                goal.updatedAt = new Date().toISOString();
            }
            return this.saveStrategy(strategy);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CONTENT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    var ContentManager = {
        getAllContent: async function() {
            return await Storage.loadAsync('content_items', []);
        },

        getContentById: async function(id) {
            var items = await this.getAllContent();
            return items.find(function(item) { return item.id === id; });
        },

        createContent: async function(data) {
            var items = await this.getAllContent();
            var newItem = Object.assign({}, defaultContentItem, data, {
                id: generateId(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            items.push(newItem);
            Storage.save('content_items', items);
            return newItem;
        },

        updateContent: async function(id, updates) {
            var items = await this.getAllContent();
            var index = items.findIndex(function(item) { return item.id === id; });
            if (index !== -1) {
                items[index] = Object.assign({}, items[index], updates, {
                    updatedAt: new Date().toISOString()
                });
                Storage.save('content_items', items);
                return items[index];
            }
            return null;
        },

        deleteContent: async function(id) {
            var items = await this.getAllContent();
            items = items.filter(function(item) { return item.id !== id; });
            Storage.save('content_items', items);
            return true;
        },

        // Filter content by various criteria
        filterContent: async function(filters) {
            var items = await this.getAllContent();
            return items.filter(function(item) {
                if (filters.status && item.status !== filters.status) return false;
                if (filters.type && item.type !== filters.type) return false;
                if (filters.pillar && item.pillar !== filters.pillar) return false;
                if (filters.author && item.author !== filters.author) return false;
                if (filters.channel && item.channel !== filters.channel) return false;
                if (filters.priority && item.priority !== filters.priority) return false;
                return true;
            });
        },

        // Get content by status for workflow
        getContentByStatus: async function(status) {
            return await this.filterContent({ status: status });
        },

        // Move content through workflow
        moveToStatus: async function(id, newStatus) {
            return await this.updateContent(id, { status: newStatus });
        },

        // Get content calendar data
        getCalendarData: async function(startDate, endDate) {
            var items = await this.getAllContent();
            var start = new Date(startDate);
            var end = new Date(endDate);

            return items.filter(function(item) {
                if (!item.dueDate && !item.publishDate) return false;
                var itemDate = new Date(item.publishDate || item.dueDate);
                return itemDate >= start && itemDate <= end;
            }).sort(function(a, b) {
                var dateA = new Date(a.publishDate || a.dueDate);
                var dateB = new Date(b.publishDate || b.dueDate);
                return dateA - dateB;
            });
        },

        // Get content statistics
        getStatistics: async function() {
            var items = await this.getAllContent();
            var stats = {
                total: items.length,
                byStatus: {},
                byType: {},
                byPillar: {},
                byChannel: {},
                thisMonth: 0,
                published: 0,
                avgPerformance: 0
            };

            var now = new Date();
            var thisMonth = now.getMonth();
            var thisYear = now.getFullYear();
            var performanceSum = 0;
            var performanceCount = 0;

            items.forEach(function(item) {
                // By status
                stats.byStatus[item.status] = (stats.byStatus[item.status] || 0) + 1;

                // By type
                stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;

                // By pillar
                if (item.pillar) {
                    stats.byPillar[item.pillar] = (stats.byPillar[item.pillar] || 0) + 1;
                }

                // By channel
                if (item.channel) {
                    stats.byChannel[item.channel] = (stats.byChannel[item.channel] || 0) + 1;
                }

                // This month
                if (item.publishDate) {
                    var pubDate = new Date(item.publishDate);
                    if (pubDate.getMonth() === thisMonth && pubDate.getFullYear() === thisYear) {
                        stats.thisMonth++;
                    }
                }

                // Published count
                if (item.status === 'published') {
                    stats.published++;
                }

                // Performance
                if (item.performanceScore !== null) {
                    performanceSum += item.performanceScore;
                    performanceCount++;
                }
            });

            stats.avgPerformance = performanceCount > 0
                ? Math.round(performanceSum / performanceCount)
                : 0;

            return stats;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CONTENT AUDIT
    // ═══════════════════════════════════════════════════════════════════════════

    var ContentAudit = {
        // Run a content audit on existing content
        runAudit: async function(contentItems) {
            var auditResults = {
                id: generateId(),
                runDate: new Date().toISOString(),
                totalItems: contentItems.length,
                scores: {
                    overall: 0,
                    quality: 0,
                    seo: 0,
                    engagement: 0,
                    freshness: 0
                },
                recommendations: [],
                itemAudits: []
            };

            var qualitySum = 0;
            var seoSum = 0;
            var engagementSum = 0;
            var freshnessSum = 0;

            contentItems.forEach(function(item) {
                var itemAudit = ContentAudit.auditItem(item);
                auditResults.itemAudits.push(itemAudit);

                qualitySum += itemAudit.scores.quality;
                seoSum += itemAudit.scores.seo;
                engagementSum += itemAudit.scores.engagement;
                freshnessSum += itemAudit.scores.freshness;
            });

            var count = contentItems.length || 1;
            auditResults.scores.quality = Math.round(qualitySum / count);
            auditResults.scores.seo = Math.round(seoSum / count);
            auditResults.scores.engagement = Math.round(engagementSum / count);
            auditResults.scores.freshness = Math.round(freshnessSum / count);
            auditResults.scores.overall = Math.round(
                (auditResults.scores.quality * 0.3) +
                (auditResults.scores.seo * 0.25) +
                (auditResults.scores.engagement * 0.25) +
                (auditResults.scores.freshness * 0.2)
            );

            // Generate recommendations
            auditResults.recommendations = ContentAudit.generateRecommendations(auditResults);

            // Save audit
            var audits = Storage.load('content_audits', []);
            audits.unshift(auditResults);
            Storage.save('content_audits', audits.slice(0, 10)); // Keep last 10

            return auditResults;
        },

        // Audit a single content item
        auditItem: function(item) {
            var audit = {
                itemId: item.id,
                title: item.title,
                type: item.type,
                scores: {
                    quality: 0,
                    seo: 0,
                    engagement: 0,
                    freshness: 0,
                    overall: 0
                },
                issues: [],
                suggestions: []
            };

            // Quality Score (based on completeness)
            var qualityScore = 50;
            if (item.title && item.title.length > 10) qualityScore += 10;
            if (item.description && item.description.length > 50) qualityScore += 15;
            if (item.outline && item.outline.length > 100) qualityScore += 10;
            if (item.wordCount > 500) qualityScore += 15;
            audit.scores.quality = Math.min(100, qualityScore);

            // SEO Score
            var seoScore = 40;
            if (item.keywords && item.keywords.length > 0) seoScore += 20;
            if (item.keywords && item.keywords.length >= 3) seoScore += 10;
            if (item.title && item.title.length >= 30 && item.title.length <= 60) seoScore += 15;
            if (item.description && item.description.length >= 120 && item.description.length <= 160) seoScore += 15;
            audit.scores.seo = Math.min(100, seoScore);

            // Engagement Score (based on metrics)
            var engagementScore = 50;
            if (item.metrics) {
                if (item.metrics.views > 100) engagementScore += 15;
                if (item.metrics.engagement > 5) engagementScore += 15;
                if (item.metrics.shares > 10) engagementScore += 10;
                if (item.metrics.conversions > 0) engagementScore += 10;
            }
            audit.scores.engagement = Math.min(100, engagementScore);

            // Freshness Score
            var freshnessScore = 100;
            if (item.publishDate || item.updatedAt) {
                var contentDate = new Date(item.publishDate || item.updatedAt);
                var daysSince = Math.floor((Date.now() - contentDate) / (1000 * 60 * 60 * 24));
                if (daysSince > 30) freshnessScore -= 10;
                if (daysSince > 90) freshnessScore -= 20;
                if (daysSince > 180) freshnessScore -= 20;
                if (daysSince > 365) freshnessScore -= 30;
            } else {
                freshnessScore = 50; // No date info
            }
            audit.scores.freshness = Math.max(0, freshnessScore);

            // Overall
            audit.scores.overall = Math.round(
                (audit.scores.quality * 0.3) +
                (audit.scores.seo * 0.25) +
                (audit.scores.engagement * 0.25) +
                (audit.scores.freshness * 0.2)
            );

            // Generate issues and suggestions
            if (audit.scores.quality < 70) {
                audit.issues.push('Content quality needs improvement');
                audit.suggestions.push('Add more detailed description and outline');
            }
            if (audit.scores.seo < 60) {
                audit.issues.push('SEO optimization needed');
                audit.suggestions.push('Add target keywords and optimize title length');
            }
            if (audit.scores.freshness < 50) {
                audit.issues.push('Content may be outdated');
                audit.suggestions.push('Review and update content with fresh information');
            }

            return audit;
        },

        // Generate recommendations from audit results
        generateRecommendations: function(auditResults) {
            var recommendations = [];

            if (auditResults.scores.quality < 70) {
                recommendations.push({
                    type: 'quality',
                    priority: 'high',
                    title: 'Improve Content Quality',
                    description: 'Several content pieces lack detailed descriptions and outlines. Consider expanding content with more valuable information.'
                });
            }

            if (auditResults.scores.seo < 60) {
                recommendations.push({
                    type: 'seo',
                    priority: 'high',
                    title: 'Optimize for Search Engines',
                    description: 'Many content items are missing keywords or have suboptimal titles. Add relevant keywords and optimize title lengths (50-60 characters).'
                });
            }

            if (auditResults.scores.freshness < 50) {
                recommendations.push({
                    type: 'freshness',
                    priority: 'medium',
                    title: 'Update Stale Content',
                    description: 'Some content is outdated. Review and refresh older pieces to maintain relevance and accuracy.'
                });
            }

            if (auditResults.scores.engagement < 60) {
                recommendations.push({
                    type: 'engagement',
                    priority: 'medium',
                    title: 'Boost Content Engagement',
                    description: 'Consider adding more engaging elements like visuals, CTAs, or interactive components to increase engagement metrics.'
                });
            }

            // Check content distribution
            var typeDistribution = {};
            auditResults.itemAudits.forEach(function(audit) {
                typeDistribution[audit.type] = (typeDistribution[audit.type] || 0) + 1;
            });

            var types = Object.keys(typeDistribution);
            if (types.length < 3) {
                recommendations.push({
                    type: 'diversity',
                    priority: 'low',
                    title: 'Diversify Content Types',
                    description: 'Your content is limited to ' + types.length + ' type(s). Consider creating different content formats to reach a wider audience.'
                });
            }

            return recommendations;
        },

        // Get previous audits
        getAuditHistory: function() {
            return Storage.load('content_audits', []);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // BRAND VOICE & STYLE GUIDE
    // ═══════════════════════════════════════════════════════════════════════════

    var BrandVoice = {
        get: async function() {
            return await Storage.loadAsync('brand_voice', Object.assign({}, defaultBrandVoice));
        },

        save: function(brandVoice) {
            Storage.save('brand_voice', brandVoice);
            return brandVoice;
        },

        // Tone & Personality
        setTone: async function(tones) {
            var voice = await this.get();
            voice.tone = tones;
            return this.save(voice);
        },

        setPersonality: async function(traits) {
            var voice = await this.get();
            voice.personality = traits;
            return this.save(voice);
        },

        // Do's and Don'ts
        addDo: async function(item) {
            var voice = await this.get();
            voice.doList.push(item);
            return this.save(voice);
        },

        addDont: async function(item) {
            var voice = await this.get();
            voice.dontList.push(item);
            return this.save(voice);
        },

        // Vocabulary
        addPreferredWord: async function(word) {
            var voice = await this.get();
            if (!voice.vocabulary.preferred.includes(word)) {
                voice.vocabulary.preferred.push(word);
            }
            return this.save(voice);
        },

        addAvoidedWord: async function(word) {
            var voice = await this.get();
            if (!voice.vocabulary.avoided.includes(word)) {
                voice.vocabulary.avoided.push(word);
            }
            return this.save(voice);
        },

        // Examples
        addExample: async function(example) {
            var voice = await this.get();
            voice.examples.push({
                id: generateId(),
                title: example.title,
                content: example.content,
                context: example.context || '',
                isGood: example.isGood !== false
            });
            return this.save(voice);
        },

        // Check content against brand voice
        checkContent: async function(content) {
            var voice = await this.get();
            var issues = [];
            var contentLower = content.toLowerCase();

            // Check for avoided words
            voice.vocabulary.avoided.forEach(function(word) {
                if (contentLower.includes(word.toLowerCase())) {
                    issues.push({
                        type: 'avoided_word',
                        word: word,
                        message: 'Content contains avoided word: "' + word + '"'
                    });
                }
            });

            return {
                passed: issues.length === 0,
                issues: issues,
                suggestions: voice.vocabulary.preferred.slice(0, 5)
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPETITOR ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════

    var CompetitorAnalysis = {
        getAll: async function() {
            return await Storage.loadAsync('competitors', []);
        },

        add: async function(competitor) {
            var competitors = await this.getAll();
            var newCompetitor = Object.assign({}, defaultCompetitor, competitor, {
                id: generateId(),
                createdAt: new Date().toISOString()
            });
            competitors.push(newCompetitor);
            Storage.save('competitors', competitors);
            return newCompetitor;
        },

        update: async function(id, updates) {
            var competitors = await this.getAll();
            var index = competitors.findIndex(function(c) { return c.id === id; });
            if (index !== -1) {
                competitors[index] = Object.assign({}, competitors[index], updates, {
                    updatedAt: new Date().toISOString()
                });
                Storage.save('competitors', competitors);
                return competitors[index];
            }
            return null;
        },

        remove: async function(id) {
            var competitors = await this.getAll();
            competitors = competitors.filter(function(c) { return c.id !== id; });
            Storage.save('competitors', competitors);
            return true;
        },

        // Generate competitive analysis report
        generateReport: async function() {
            var competitors = await this.getAll();
            var report = {
                generatedAt: new Date().toISOString(),
                competitorCount: competitors.length,
                contentTypeAnalysis: {},
                channelAnalysis: {},
                strengths: [],
                opportunities: []
            };

            competitors.forEach(function(comp) {
                // Content types
                comp.contentTypes.forEach(function(type) {
                    report.contentTypeAnalysis[type] = (report.contentTypeAnalysis[type] || 0) + 1;
                });

                // Channels
                comp.socialChannels.forEach(function(channel) {
                    report.channelAnalysis[channel] = (report.channelAnalysis[channel] || 0) + 1;
                });

                // Collect strengths and weaknesses
                comp.strengths.forEach(function(s) {
                    report.strengths.push({ competitor: comp.name, strength: s });
                });

                comp.weaknesses.forEach(function(w) {
                    report.opportunities.push({ competitor: comp.name, opportunity: w });
                });
            });

            return report;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // USER JOURNEY MAPPING
    // ═══════════════════════════════════════════════════════════════════════════

    var UserJourney = {
        getJourneyMap: async function() {
            return await Storage.loadAsync('user_journey', {
                stages: [
                    { id: 'awareness', name: 'Awareness', description: 'User becomes aware of their problem/need', contentTypes: ['blog', 'social', 'video'], content: [] },
                    { id: 'consideration', name: 'Consideration', description: 'User researches solutions', contentTypes: ['whitepaper', 'case-study', 'webinar'], content: [] },
                    { id: 'decision', name: 'Decision', description: 'User evaluates specific products/services', contentTypes: ['demo', 'comparison', 'testimonial'], content: [] },
                    { id: 'retention', name: 'Retention', description: 'User becomes a customer', contentTypes: ['tutorial', 'newsletter', 'community'], content: [] },
                    { id: 'advocacy', name: 'Advocacy', description: 'User recommends to others', contentTypes: ['referral', 'review', 'user-story'], content: [] }
                ]
            });
        },

        saveJourneyMap: function(journeyMap) {
            Storage.save('user_journey', journeyMap);
            return journeyMap;
        },

        // Assign content to a journey stage
        assignContent: async function(contentId, stageId) {
            var journey = await this.getJourneyMap();
            var stage = journey.stages.find(function(s) { return s.id === stageId; });
            if (stage && !stage.content.includes(contentId)) {
                stage.content.push(contentId);
                return this.saveJourneyMap(journey);
            }
            return journey;
        },

        // Get content gaps in the journey
        getContentGaps: async function() {
            var journey = await this.getJourneyMap();
            var gaps = [];

            journey.stages.forEach(function(stage) {
                if (stage.content.length === 0) {
                    gaps.push({
                        stage: stage.name,
                        severity: 'high',
                        message: 'No content assigned to ' + stage.name + ' stage',
                        suggestedTypes: stage.contentTypes
                    });
                } else if (stage.content.length < 3) {
                    gaps.push({
                        stage: stage.name,
                        severity: 'medium',
                        message: 'Limited content (' + stage.content.length + ') in ' + stage.name + ' stage',
                        suggestedTypes: stage.contentTypes
                    });
                }
            });

            return gaps;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CONTENT IDEAS & BACKLOG
    // ═══════════════════════════════════════════════════════════════════════════

    var ContentIdeas = {
        getAll: async function() {
            return await Storage.loadAsync('content_ideas', []);
        },

        add: async function(idea) {
            var ideas = await this.getAll();
            var newIdea = {
                id: generateId(),
                title: idea.title,
                description: idea.description || '',
                type: idea.type || 'blog',
                pillar: idea.pillar || '',
                source: idea.source || 'manual', // manual, ai, competitor, keyword
                priority: idea.priority || 'medium',
                votes: 0,
                status: 'backlog', // backlog, approved, rejected
                createdAt: new Date().toISOString()
            };
            ideas.push(newIdea);
            Storage.save('content_ideas', ideas);
            return newIdea;
        },

        vote: async function(ideaId) {
            var ideas = await this.getAll();
            var idea = ideas.find(function(i) { return i.id === ideaId; });
            if (idea) {
                idea.votes++;
                Storage.save('content_ideas', ideas);
            }
            return idea;
        },

        approve: async function(ideaId) {
            var ideas = await this.getAll();
            var idea = ideas.find(function(i) { return i.id === ideaId; });
            if (idea) {
                idea.status = 'approved';
                Storage.save('content_ideas', ideas);
            }
            return idea;
        },

        convertToContent: async function(ideaId) {
            var ideas = await this.getAll();
            var idea = ideas.find(function(i) { return i.id === ideaId; });
            if (idea) {
                // Create content item from idea
                var content = await ContentManager.createContent({
                    title: idea.title,
                    description: idea.description,
                    type: idea.type,
                    pillar: idea.pillar,
                    status: 'planned'
                });

                // Remove from ideas
                ideas = ideas.filter(function(i) { return i.id !== ideaId; });
                Storage.save('content_ideas', ideas);

                return content;
            }
            return null;
        },

        // Generate AI-powered content ideas
        generateIdeas: async function(topic, count) {
            count = count || 5;
            // This would integrate with AI service
            // For now, return template-based suggestions
            var templates = [
                'The Ultimate Guide to {topic}',
                '{topic}: What You Need to Know in 2026',
                '10 {topic} Best Practices for Success',
                'How to Master {topic} in 30 Days',
                '{topic} vs. Traditional Approaches: A Comparison',
                'Common {topic} Mistakes and How to Avoid Them',
                'The Future of {topic}: Trends to Watch',
                '{topic} Case Study: Real Results'
            ];

            var ideas = [];
            for (var i = 0; i < Math.min(count, templates.length); i++) {
                ideas.push({
                    title: templates[i].replace(/{topic}/g, topic),
                    type: i < 3 ? 'blog' : (i < 5 ? 'video' : 'whitepaper'),
                    source: 'ai'
                });
            }

            return ideas;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EDITORIAL CALENDAR
    // ═══════════════════════════════════════════════════════════════════════════

    var EditorialCalendar = {
        // Get calendar events for a date range
        getEvents: async function(startDate, endDate) {
            var content = await ContentManager.getCalendarData(startDate, endDate);
            return content.map(function(item) {
                return {
                    id: item.id,
                    title: item.title,
                    date: item.publishDate || item.dueDate,
                    type: item.type,
                    status: item.status,
                    author: item.author,
                    channel: item.channel
                };
            });
        },

        // Schedule content
        scheduleContent: async function(contentId, publishDate) {
            return await ContentManager.updateContent(contentId, {
                publishDate: publishDate,
                status: 'planned'
            });
        },

        // Reschedule content
        rescheduleContent: async function(contentId, newDate) {
            return await ContentManager.updateContent(contentId, {
                publishDate: newDate
            });
        },

        // Get publishing frequency stats
        getFrequencyStats: async function() {
            var content = await ContentManager.getAllContent();
            var published = content.filter(function(c) { return c.publishDate; });

            var stats = {
                total: published.length,
                byMonth: {},
                byDayOfWeek: {},
                avgPerWeek: 0
            };

            var weekCount = 0;
            var firstDate = null;
            var lastDate = null;

            published.forEach(function(item) {
                var date = new Date(item.publishDate);
                var monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
                var dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });

                stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;
                stats.byDayOfWeek[dayOfWeek] = (stats.byDayOfWeek[dayOfWeek] || 0) + 1;

                if (!firstDate || date < firstDate) firstDate = date;
                if (!lastDate || date > lastDate) lastDate = date;
            });

            if (firstDate && lastDate) {
                var diffTime = Math.abs(lastDate - firstDate);
                var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                weekCount = Math.max(1, Math.ceil(diffDays / 7));
                stats.avgPerWeek = Math.round((published.length / weekCount) * 10) / 10;
            }

            return stats;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    function generateId() {
        return 'cs_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.ContentStrategist = {
        // Strategy
        Strategy: StrategyManager,

        // Content Management
        Content: ContentManager,

        // Content Audit
        Audit: ContentAudit,

        // Brand Voice
        BrandVoice: BrandVoice,

        // Competitor Analysis
        Competitors: CompetitorAnalysis,

        // User Journey
        Journey: UserJourney,

        // Content Ideas
        Ideas: ContentIdeas,

        // Editorial Calendar
        Calendar: EditorialCalendar,

        // Quick stats for dashboard
        getDashboardStats: async function() {
            var stats = await ContentManager.getStatistics();
            var strategy = await StrategyManager.getStrategy();
            var ideas = await ContentIdeas.getAll();
            var gaps = await UserJourney.getContentGaps();

            return {
                contentStats: stats,
                pillarsCount: strategy.contentPillars.length,
                audiencesCount: strategy.targetAudiences.length,
                goalsCount: strategy.goals.length,
                ideasCount: ideas.length,
                journeyGaps: gaps.length,
                recentAudit: ContentAudit.getAuditHistory()[0] || null
            };
        }
    };

    console.log(TAG, 'Content Strategist Service initialized');

})();
