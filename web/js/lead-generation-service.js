/**
 * Lead Generation Specialist Service
 * Aduma Marketing 2026
 *
 * Comprehensive lead generation and qualification system
 * for identifying, attracting, and nurturing potential customers.
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // STORAGE HELPER - Uses MarketingStore (Supabase-backed) with localStorage fallback
    // ═══════════════════════════════════════════════════════════════════════════
    const SERVICE_NAME = 'leadgen';

    const LeadStore = {
        async get(key) {
            // Try MarketingStore first (Supabase-backed)
            if (window.MarketingStore) {
                try {
                    const data = await window.MarketingStore.get(SERVICE_NAME, key, null);
                    if (data !== null) {
                        // Cache to localStorage
                        try {
                            localStorage.setItem(SERVICE_NAME + '_' + key, JSON.stringify(data));
                        } catch (_) { /* ignore */ }
                        return data;
                    }
                } catch (e) {
                    console.warn('[LeadGeneration] MarketingStore read failed:', e.message);
                }
            }
            // Fallback to localStorage
            try {
                const item = localStorage.getItem(SERVICE_NAME + '_' + key);
                return item ? JSON.parse(item) : null;
            } catch (e) {
                console.error('[LeadGeneration] localStorage read failed:', e);
                return null;
            }
        },
        async set(key, value) {
            // Always write to localStorage first (cache)
            try {
                localStorage.setItem(SERVICE_NAME + '_' + key, JSON.stringify(value));
            } catch (e) {
                console.warn('[LeadGeneration] localStorage write failed:', e.message);
            }
            // Persist to Supabase via MarketingStore
            if (window.MarketingStore) {
                try {
                    await window.MarketingStore.set(SERVICE_NAME, key, value);
                } catch (e) {
                    console.warn('[LeadGeneration] MarketingStore persist failed:', e.message);
                }
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // PROSPECT MANAGER
    // ═══════════════════════════════════════════════════════════════════════════
    const ProspectManager = {
        async getAll() {
            return await LeadStore.get('prospects') || [];
        },

        async getById(id) {
            const prospects = await this.getAll();
            return prospects.find(p => p.id === id);
        },

        async create(prospect) {
            const prospects = await this.getAll();
            const newProspect = {
                id: 'prospect_' + Date.now(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'new',
                score: 0,
                activities: [],
                tags: [],
                ...prospect
            };
            prospects.push(newProspect);
            await LeadStore.set('prospects', prospects);
            return newProspect;
        },

        async update(id, updates) {
            const prospects = await this.getAll();
            const index = prospects.findIndex(p => p.id === id);
            if (index !== -1) {
                prospects[index] = {
                    ...prospects[index],
                    ...updates,
                    updatedAt: new Date().toISOString()
                };
                await LeadStore.set('prospects', prospects);
                return prospects[index];
            }
            return null;
        },

        async delete(id) {
            let prospects = await this.getAll();
            prospects = prospects.filter(p => p.id !== id);
            await LeadStore.set('prospects', prospects);
        },

        async addActivity(prospectId, activity) {
            const prospect = await this.getById(prospectId);
            if (prospect) {
                prospect.activities.push({
                    id: 'activity_' + Date.now(),
                    timestamp: new Date().toISOString(),
                    ...activity
                });
                await this.update(prospectId, { activities: prospect.activities });
            }
        },

        async getByStatus(status) {
            const prospects = await this.getAll();
            return prospects.filter(p => p.status === status);
        },

        async search(query) {
            const prospects = await this.getAll();
            const q = query.toLowerCase();
            return prospects.filter(p =>
                p.name?.toLowerCase().includes(q) ||
                p.company?.toLowerCase().includes(q) ||
                p.email?.toLowerCase().includes(q) ||
                p.title?.toLowerCase().includes(q)
            );
        },

        async getStatistics() {
            const prospects = await this.getAll();
            const statusCounts = {};
            let totalScore = 0;

            prospects.forEach(p => {
                statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
                totalScore += p.score || 0;
            });

            return {
                total: prospects.length,
                byStatus: statusCounts,
                avgScore: prospects.length > 0 ? Math.round(totalScore / prospects.length) : 0,
                hotLeads: prospects.filter(p => p.score >= 80).length,
                warmLeads: prospects.filter(p => p.score >= 50 && p.score < 80).length,
                coldLeads: prospects.filter(p => p.score < 50).length
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // LEAD QUALIFICATION
    // ═══════════════════════════════════════════════════════════════════════════
    const LeadQualification = {
        // BANT criteria weights
        criteria: {
            budget: { weight: 25, questions: ['Has budget allocated?', 'Budget amount confirmed?', 'Budget timeline known?'] },
            authority: { weight: 25, questions: ['Decision maker?', 'Influences decision?', 'Access to decision maker?'] },
            need: { weight: 25, questions: ['Has identified pain point?', 'Urgency exists?', 'Problem is priority?'] },
            timeline: { weight: 25, questions: ['Has timeline?', 'Timeline is immediate?', 'Timeline is this quarter?'] }
        },

        async getScoringModel() {
            return await LeadStore.get('scoringModel') || {
                name: 'Default BANT Model',
                criteria: this.criteria,
                activityScores: {
                    email_opened: 5,
                    email_clicked: 10,
                    website_visit: 3,
                    form_submission: 20,
                    demo_requested: 30,
                    meeting_scheduled: 25,
                    proposal_viewed: 15,
                    pricing_viewed: 10,
                    content_downloaded: 8,
                    webinar_attended: 15,
                    phone_call: 12,
                    social_engagement: 3
                },
                demographicScores: {
                    job_title_match: 15,
                    company_size_match: 10,
                    industry_match: 10,
                    location_match: 5
                },
                decayRate: 0.95, // Score decay per week of inactivity
                thresholds: {
                    hot: 80,
                    warm: 50,
                    cold: 0
                }
            };
        },

        async saveScoringModel(model) {
            await LeadStore.set('scoringModel', model);
        },

        async calculateScore(prospect) {
            const model = await this.getScoringModel();
            let score = 0;

            // Activity-based scoring
            if (prospect.activities) {
                prospect.activities.forEach(activity => {
                    const activityScore = model.activityScores[activity.type] || 0;

                    // Apply time decay
                    const daysSince = (new Date() - new Date(activity.timestamp)) / (1000 * 60 * 60 * 24);
                    const weeksSince = daysSince / 7;
                    const decayFactor = Math.pow(model.decayRate, weeksSince);

                    score += activityScore * decayFactor;
                });
            }

            // Demographic scoring
            if (prospect.jobTitleMatch) score += model.demographicScores.job_title_match;
            if (prospect.companySizeMatch) score += model.demographicScores.company_size_match;
            if (prospect.industryMatch) score += model.demographicScores.industry_match;
            if (prospect.locationMatch) score += model.demographicScores.location_match;

            // BANT scoring
            if (prospect.qualification) {
                Object.entries(prospect.qualification).forEach(([key, value]) => {
                    if (model.criteria[key] && value) {
                        score += model.criteria[key].weight * (value / 100);
                    }
                });
            }

            return Math.min(100, Math.round(score));
        },

        async qualifyLead(prospectId, qualification) {
            const prospect = await ProspectManager.getById(prospectId);
            if (prospect) {
                prospect.qualification = { ...prospect.qualification, ...qualification };
                prospect.score = await this.calculateScore(prospect);

                // Update status based on score
                const model = await this.getScoringModel();
                if (prospect.score >= model.thresholds.hot) {
                    prospect.status = 'qualified';
                } else if (prospect.score >= model.thresholds.warm) {
                    prospect.status = 'nurturing';
                }

                await ProspectManager.update(prospectId, prospect);
                return prospect;
            }
            return null;
        },

        getScoreLabel(score) {
            if (score >= 80) return { label: 'Hot', color: '#ef4444', icon: '🔥' };
            if (score >= 50) return { label: 'Warm', color: '#f59e0b', icon: '☀️' };
            return { label: 'Cold', color: '#3b82f6', icon: '❄️' };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTREACH MANAGER
    // ═══════════════════════════════════════════════════════════════════════════
    const OutreachManager = {
        async getSequences() {
            return await LeadStore.get('sequences') || [];
        },

        async createSequence(sequence) {
            const sequences = await this.getSequences();
            const newSequence = {
                id: 'seq_' + Date.now(),
                createdAt: new Date().toISOString(),
                status: 'draft',
                steps: [],
                enrolled: 0,
                completed: 0,
                stats: {
                    sent: 0,
                    opened: 0,
                    clicked: 0,
                    replied: 0,
                    bounced: 0
                },
                ...sequence
            };
            sequences.push(newSequence);
            await LeadStore.set('sequences', sequences);
            return newSequence;
        },

        async updateSequence(id, updates) {
            const sequences = await this.getSequences();
            const index = sequences.findIndex(s => s.id === id);
            if (index !== -1) {
                sequences[index] = { ...sequences[index], ...updates };
                await LeadStore.set('sequences', sequences);
                return sequences[index];
            }
            return null;
        },

        async deleteSequence(id) {
            let sequences = await this.getSequences();
            sequences = sequences.filter(s => s.id !== id);
            await LeadStore.set('sequences', sequences);
        },

        async getTemplates() {
            return await LeadStore.get('emailTemplates') || this.getDefaultTemplates();
        },

        getDefaultTemplates() {
            return [
                {
                    id: 'tpl_intro',
                    name: 'Introduction Email',
                    category: 'outreach',
                    subject: 'Quick question about {{company}}',
                    body: `Hi {{firstName}},

I noticed {{company}} is {{observation}}. Many companies in {{industry}} are facing similar challenges with {{painPoint}}.

We've helped companies like {{referenceCompany}} achieve {{result}}.

Would you be open to a quick 15-minute call to see if we could help {{company}} achieve similar results?

Best,
{{senderName}}`
                },
                {
                    id: 'tpl_followup1',
                    name: 'Follow-up #1',
                    category: 'followup',
                    subject: 'Re: Quick question about {{company}}',
                    body: `Hi {{firstName}},

Just wanted to follow up on my previous email. I understand you're busy, but I believe we could really help {{company}} with {{painPoint}}.

Here's a quick case study that might interest you: {{caseStudyLink}}

Would 15 minutes this week work for a quick chat?

Best,
{{senderName}}`
                },
                {
                    id: 'tpl_breakup',
                    name: 'Breakup Email',
                    category: 'followup',
                    subject: 'Should I close your file?',
                    body: `Hi {{firstName}},

I've reached out a few times but haven't heard back. I understand timing might not be right.

I'll assume {{painPoint}} isn't a priority right now and close your file. If things change in the future, feel free to reach out.

Wishing you and {{company}} all the best!

Best,
{{senderName}}`
                }
            ];
        },

        async saveTemplate(template) {
            const templates = await this.getTemplates();
            const existing = templates.findIndex(t => t.id === template.id);
            if (existing !== -1) {
                templates[existing] = template;
            } else {
                template.id = 'tpl_' + Date.now();
                templates.push(template);
            }
            await LeadStore.set('emailTemplates', templates);
            return template;
        },

        async getOutreachLog() {
            return await LeadStore.get('outreachLog') || [];
        },

        async logOutreach(outreach) {
            const log = await this.getOutreachLog();
            const entry = {
                id: 'outreach_' + Date.now(),
                timestamp: new Date().toISOString(),
                status: 'sent',
                ...outreach
            };
            log.push(entry);
            await LeadStore.set('outreachLog', log);

            // Add activity to prospect
            if (outreach.prospectId) {
                await ProspectManager.addActivity(outreach.prospectId, {
                    type: outreach.type || 'email_sent',
                    details: outreach
                });
            }

            return entry;
        },

        async getOutreachStats(dateRange) {
            const log = await this.getOutreachLog();
            const start = dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const end = dateRange?.end || new Date();

            const filtered = log.filter(l => {
                const date = new Date(l.timestamp);
                return date >= start && date <= end;
            });

            return {
                totalSent: filtered.length,
                emails: filtered.filter(l => l.type === 'email').length,
                calls: filtered.filter(l => l.type === 'call').length,
                linkedin: filtered.filter(l => l.type === 'linkedin').length,
                responses: filtered.filter(l => l.response).length,
                responseRate: filtered.length > 0
                    ? Math.round((filtered.filter(l => l.response).length / filtered.length) * 100)
                    : 0
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CAMPAIGN MANAGER
    // ═══════════════════════════════════════════════════════════════════════════
    const CampaignManager = {
        async getCampaigns() {
            return await LeadStore.get('campaigns') || [];
        },

        async getCampaign(id) {
            const campaigns = await this.getCampaigns();
            return campaigns.find(c => c.id === id);
        },

        async createCampaign(campaign) {
            const campaigns = await this.getCampaigns();
            const newCampaign = {
                id: 'camp_' + Date.now(),
                createdAt: new Date().toISOString(),
                status: 'draft',
                type: 'outbound',
                budget: 0,
                spent: 0,
                leads: [],
                metrics: {
                    impressions: 0,
                    clicks: 0,
                    conversions: 0,
                    leadsGenerated: 0,
                    costPerLead: 0
                },
                ...campaign
            };
            campaigns.push(newCampaign);
            await LeadStore.set('campaigns', campaigns);
            return newCampaign;
        },

        async updateCampaign(id, updates) {
            const campaigns = await this.getCampaigns();
            const index = campaigns.findIndex(c => c.id === id);
            if (index !== -1) {
                campaigns[index] = { ...campaigns[index], ...updates };
                await LeadStore.set('campaigns', campaigns);
                return campaigns[index];
            }
            return null;
        },

        async deleteCampaign(id) {
            let campaigns = await this.getCampaigns();
            campaigns = campaigns.filter(c => c.id !== id);
            await LeadStore.set('campaigns', campaigns);
        },

        async addLeadToCampaign(campaignId, prospectId) {
            const campaign = await this.getCampaign(campaignId);
            if (campaign && !campaign.leads.includes(prospectId)) {
                campaign.leads.push(prospectId);
                campaign.metrics.leadsGenerated = campaign.leads.length;
                if (campaign.spent > 0) {
                    campaign.metrics.costPerLead = Math.round(campaign.spent / campaign.leads.length);
                }
                await this.updateCampaign(campaignId, campaign);
            }
        },

        async getCampaignStats() {
            const campaigns = await this.getCampaigns();
            const active = campaigns.filter(c => c.status === 'active');

            return {
                total: campaigns.length,
                active: active.length,
                totalBudget: campaigns.reduce((sum, c) => sum + (c.budget || 0), 0),
                totalSpent: campaigns.reduce((sum, c) => sum + (c.spent || 0), 0),
                totalLeads: campaigns.reduce((sum, c) => sum + (c.metrics?.leadsGenerated || 0), 0),
                avgCostPerLead: this.calculateAvgCPL(campaigns)
            };
        },

        calculateAvgCPL(campaigns) {
            const withLeads = campaigns.filter(c => c.metrics?.leadsGenerated > 0);
            if (withLeads.length === 0) return 0;
            const totalSpent = withLeads.reduce((sum, c) => sum + (c.spent || 0), 0);
            const totalLeads = withLeads.reduce((sum, c) => sum + c.metrics.leadsGenerated, 0);
            return totalLeads > 0 ? Math.round(totalSpent / totalLeads) : 0;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // PIPELINE MANAGER
    // ═══════════════════════════════════════════════════════════════════════════
    const PipelineManager = {
        stages: [
            { id: 'new', name: 'New Lead', color: '#6b7280' },
            { id: 'contacted', name: 'Contacted', color: '#3b82f6' },
            { id: 'qualifying', name: 'Qualifying', color: '#8b5cf6' },
            { id: 'nurturing', name: 'Nurturing', color: '#f59e0b' },
            { id: 'qualified', name: 'Qualified', color: '#10b981' },
            { id: 'converted', name: 'Converted', color: '#059669' },
            { id: 'lost', name: 'Lost', color: '#ef4444' }
        ],

        async getStages() {
            return await LeadStore.get('pipelineStages') || this.stages;
        },

        async saveStages(stages) {
            await LeadStore.set('pipelineStages', stages);
        },

        async getPipelineData() {
            const prospects = await ProspectManager.getAll();
            const stages = await this.getStages();

            return stages.map(stage => ({
                ...stage,
                prospects: prospects.filter(p => p.status === stage.id),
                count: prospects.filter(p => p.status === stage.id).length,
                value: prospects.filter(p => p.status === stage.id)
                    .reduce((sum, p) => sum + (p.estimatedValue || 0), 0)
            }));
        },

        async moveProspect(prospectId, newStage) {
            const prospect = await ProspectManager.getById(prospectId);
            if (prospect) {
                await ProspectManager.update(prospectId, { status: newStage });
                await ProspectManager.addActivity(prospectId, {
                    type: 'stage_changed',
                    from: prospect.status,
                    to: newStage
                });
            }
        },

        async getConversionRates() {
            const pipeline = await this.getPipelineData();
            const rates = [];

            for (let i = 0; i < pipeline.length - 1; i++) {
                const current = pipeline[i];
                const next = pipeline[i + 1];
                rates.push({
                    from: current.name,
                    to: next.name,
                    rate: current.count > 0 ? Math.round((next.count / current.count) * 100) : 0
                });
            }

            return rates;
        },

        async getPipelineValue() {
            const pipeline = await this.getPipelineData();
            return {
                total: pipeline.reduce((sum, stage) => sum + stage.value, 0),
                byStage: pipeline.map(s => ({ name: s.name, value: s.value })),
                qualified: pipeline.filter(s => s.id === 'qualified')[0]?.value || 0
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // NURTURING MANAGER
    // ═══════════════════════════════════════════════════════════════════════════
    const NurturingManager = {
        async getNurtureTracks() {
            return await LeadStore.get('nurtureTracks') || this.getDefaultTracks();
        },

        getDefaultTracks() {
            return [
                {
                    id: 'track_awareness',
                    name: 'Awareness Track',
                    description: 'For leads just learning about us',
                    duration: '4 weeks',
                    touchpoints: [
                        { day: 1, type: 'email', content: 'Welcome + Introduction' },
                        { day: 3, type: 'email', content: 'Educational Blog Post' },
                        { day: 7, type: 'email', content: 'Industry Insights' },
                        { day: 14, type: 'email', content: 'Case Study' },
                        { day: 21, type: 'email', content: 'Webinar Invitation' },
                        { day: 28, type: 'email', content: 'Free Resource Offer' }
                    ],
                    enrolled: 0
                },
                {
                    id: 'track_consideration',
                    name: 'Consideration Track',
                    description: 'For leads evaluating solutions',
                    duration: '3 weeks',
                    touchpoints: [
                        { day: 1, type: 'email', content: 'Product Overview' },
                        { day: 3, type: 'email', content: 'Comparison Guide' },
                        { day: 7, type: 'email', content: 'Customer Testimonials' },
                        { day: 10, type: 'call', content: 'Check-in Call' },
                        { day: 14, type: 'email', content: 'ROI Calculator' },
                        { day: 21, type: 'email', content: 'Demo Invitation' }
                    ],
                    enrolled: 0
                },
                {
                    id: 'track_decision',
                    name: 'Decision Track',
                    description: 'For leads ready to buy',
                    duration: '2 weeks',
                    touchpoints: [
                        { day: 1, type: 'email', content: 'Pricing Information' },
                        { day: 2, type: 'call', content: 'Needs Assessment Call' },
                        { day: 5, type: 'email', content: 'Custom Proposal' },
                        { day: 7, type: 'email', content: 'Implementation Timeline' },
                        { day: 10, type: 'call', content: 'Final Questions Call' },
                        { day: 14, type: 'email', content: 'Limited Time Offer' }
                    ],
                    enrolled: 0
                }
            ];
        },

        async createTrack(track) {
            const tracks = await this.getNurtureTracks();
            const newTrack = {
                id: 'track_' + Date.now(),
                createdAt: new Date().toISOString(),
                touchpoints: [],
                enrolled: 0,
                ...track
            };
            tracks.push(newTrack);
            await LeadStore.set('nurtureTracks', tracks);
            return newTrack;
        },

        async enrollProspect(prospectId, trackId) {
            const prospect = await ProspectManager.getById(prospectId);
            if (prospect) {
                await ProspectManager.update(prospectId, {
                    nurtureTrack: trackId,
                    nurtureStartDate: new Date().toISOString(),
                    nurtureTouchpoint: 0
                });
                await ProspectManager.addActivity(prospectId, {
                    type: 'nurture_enrolled',
                    trackId
                });
            }
        },

        async getProspectsInTrack(trackId) {
            const prospects = await ProspectManager.getAll();
            return prospects.filter(p => p.nurtureTrack === trackId);
        },

        async advanceTouchpoint(prospectId) {
            const prospect = await ProspectManager.getById(prospectId);
            if (prospect && prospect.nurtureTrack) {
                const tracks = await this.getNurtureTracks();
                const track = tracks.find(t => t.id === prospect.nurtureTrack);
                if (track && prospect.nurtureTouchpoint < track.touchpoints.length - 1) {
                    await ProspectManager.update(prospectId, {
                        nurtureTouchpoint: prospect.nurtureTouchpoint + 1
                    });
                }
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ANALYTICS
    // ═══════════════════════════════════════════════════════════════════════════
    const Analytics = {
        async getDashboardMetrics() {
            const [prospectStats, campaignStats, outreachStats, pipelineValue] = await Promise.all([
                ProspectManager.getStatistics(),
                CampaignManager.getCampaignStats(),
                OutreachManager.getOutreachStats(),
                PipelineManager.getPipelineValue()
            ]);

            return {
                prospects: prospectStats,
                campaigns: campaignStats,
                outreach: outreachStats,
                pipeline: pipelineValue
            };
        },

        async getLeadSources() {
            const prospects = await ProspectManager.getAll();
            const sources = {};

            prospects.forEach(p => {
                const source = p.source || 'Unknown';
                sources[source] = (sources[source] || 0) + 1;
            });

            return Object.entries(sources).map(([name, count]) => ({
                name,
                count,
                percentage: Math.round((count / prospects.length) * 100)
            })).sort((a, b) => b.count - a.count);
        },

        async getActivityTimeline(days = 30) {
            const prospects = await ProspectManager.getAll();
            const activities = [];

            prospects.forEach(p => {
                if (p.activities) {
                    p.activities.forEach(a => {
                        activities.push({
                            ...a,
                            prospectName: p.name,
                            prospectId: p.id
                        });
                    });
                }
            });

            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            return activities
                .filter(a => new Date(a.timestamp) >= cutoff)
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        },

        async getConversionFunnel() {
            const prospects = await ProspectManager.getAll();
            const total = prospects.length;

            return [
                { stage: 'Total Leads', count: total, percentage: 100 },
                { stage: 'Contacted', count: prospects.filter(p => ['contacted', 'qualifying', 'nurturing', 'qualified', 'converted'].includes(p.status)).length },
                { stage: 'Qualified', count: prospects.filter(p => ['qualified', 'converted'].includes(p.status)).length },
                { stage: 'Converted', count: prospects.filter(p => p.status === 'converted').length }
            ].map(item => ({
                ...item,
                percentage: total > 0 ? Math.round((item.count / total) * 100) : 0
            }));
        },

        async getTrendData(metric, days = 30) {
            const prospects = await ProspectManager.getAll();
            const data = [];
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            for (let i = 0; i < days; i++) {
                const date = new Date(cutoff);
                date.setDate(date.getDate() + i);
                const dateStr = date.toISOString().split('T')[0];

                let value = 0;
                switch (metric) {
                    case 'newLeads':
                        value = prospects.filter(p => p.createdAt?.startsWith(dateStr)).length;
                        break;
                    case 'qualified':
                        value = prospects.filter(p =>
                            p.status === 'qualified' &&
                            p.activities?.some(a => a.type === 'stage_changed' && a.to === 'qualified' && a.timestamp.startsWith(dateStr))
                        ).length;
                        break;
                    case 'converted':
                        value = prospects.filter(p =>
                            p.status === 'converted' &&
                            p.activities?.some(a => a.type === 'stage_changed' && a.to === 'converted' && a.timestamp.startsWith(dateStr))
                        ).length;
                        break;
                }

                data.push({ date: dateStr, value });
            }

            return data;
        },

        async generateReport(options = {}) {
            const [metrics, sources, funnel, pipeline] = await Promise.all([
                this.getDashboardMetrics(),
                this.getLeadSources(),
                this.getConversionFunnel(),
                PipelineManager.getPipelineData()
            ]);

            return {
                generatedAt: new Date().toISOString(),
                period: options.period || 'Last 30 days',
                summary: {
                    totalLeads: metrics.prospects.total,
                    hotLeads: metrics.prospects.hotLeads,
                    qualifiedLeads: funnel.find(f => f.stage === 'Qualified')?.count || 0,
                    convertedLeads: funnel.find(f => f.stage === 'Converted')?.count || 0,
                    conversionRate: funnel.find(f => f.stage === 'Converted')?.percentage || 0,
                    totalPipelineValue: metrics.pipeline.total,
                    activeCampaigns: metrics.campaigns.active,
                    avgCostPerLead: metrics.campaigns.avgCostPerLead
                },
                leadSources: sources,
                conversionFunnel: funnel,
                pipelineByStage: pipeline.map(s => ({
                    stage: s.name,
                    count: s.count,
                    value: s.value
                }))
            };
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // FORMS & LANDING PAGES
    // ═══════════════════════════════════════════════════════════════════════════
    const LeadCapture = {
        async getForms() {
            return await LeadStore.get('leadForms') || [];
        },

        async createForm(form) {
            const forms = await this.getForms();
            const newForm = {
                id: 'form_' + Date.now(),
                createdAt: new Date().toISOString(),
                status: 'draft',
                fields: ['name', 'email', 'company'],
                submissions: 0,
                conversionRate: 0,
                ...form
            };
            forms.push(newForm);
            await LeadStore.set('leadForms', forms);
            return newForm;
        },

        async logSubmission(formId, data) {
            const forms = await this.getForms();
            const form = forms.find(f => f.id === formId);
            if (form) {
                form.submissions = (form.submissions || 0) + 1;
                await LeadStore.set('leadForms', forms);

                // Create prospect from submission
                const prospect = await ProspectManager.create({
                    ...data,
                    source: 'form_' + form.name,
                    sourceFormId: formId
                });

                return prospect;
            }
            return null;
        },

        async getLandingPages() {
            return await LeadStore.get('landingPages') || [];
        },

        async createLandingPage(page) {
            const pages = await this.getLandingPages();
            const newPage = {
                id: 'lp_' + Date.now(),
                createdAt: new Date().toISOString(),
                status: 'draft',
                views: 0,
                conversions: 0,
                conversionRate: 0,
                ...page
            };
            pages.push(newPage);
            await LeadStore.set('landingPages', pages);
            return newPage;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // AI INTEGRATION
    // ═══════════════════════════════════════════════════════════════════════════
    const AIAssistant = {
        async generateOutreachEmail(prospect, options = {}) {
            if (!window.AIService) {
                console.warn('AI Service not available');
                return null;
            }

            const prompt = `Generate a personalized outreach email for a prospect:
Name: ${prospect.name}
Company: ${prospect.company}
Title: ${prospect.title || 'Not specified'}
Industry: ${prospect.industry || 'Not specified'}
Pain Point: ${options.painPoint || 'Not specified'}
Our Value Proposition: ${options.valueProposition || 'Not specified'}

Tone: ${options.tone || 'professional but friendly'}
Length: ${options.length || 'concise, under 150 words'}

Return a JSON object with:
{
    "subject": "email subject line",
    "body": "email body",
    "followUpSuggestion": "suggested follow-up timing and approach"
}`;

            try {
                const response = await window.AIService.generate(prompt, {
                    type: 'creative',
                    maxTokens: 500
                });
                return JSON.parse(response);
            } catch (e) {
                console.error('AI email generation failed:', e);
                return null;
            }
        },

        async suggestLeadScore(prospect) {
            if (!window.AIService) return null;

            const prompt = `Analyze this prospect and suggest a lead score (0-100):
Name: ${prospect.name}
Company: ${prospect.company}
Title: ${prospect.title}
Company Size: ${prospect.companySize || 'Unknown'}
Industry: ${prospect.industry || 'Unknown'}
Source: ${prospect.source || 'Unknown'}
Activities: ${JSON.stringify(prospect.activities?.slice(-5) || [])}

Return a JSON object with:
{
    "suggestedScore": number,
    "reasoning": "brief explanation",
    "nextBestAction": "recommended next step"
}`;

            try {
                const response = await window.AIService.generate(prompt, { type: 'analysis' });
                return JSON.parse(response);
            } catch (e) {
                console.error('AI scoring failed:', e);
                return null;
            }
        },

        async identifyIdealProspects(criteria) {
            if (!window.AIService) return null;

            const prompt = `Based on our ideal customer profile:
${JSON.stringify(criteria, null, 2)}

Generate 5 characteristics of ideal prospects we should target, including:
1. Job titles to target
2. Company characteristics
3. Signals that indicate buying intent
4. Best outreach channels
5. Key pain points to address

Return as structured JSON.`;

            try {
                const response = await window.AIService.generate(prompt, { type: 'analysis' });
                return JSON.parse(response);
            } catch (e) {
                console.error('AI prospect identification failed:', e);
                return null;
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT LEAD GENERATION SERVICE
    // ═══════════════════════════════════════════════════════════════════════════
    window.LeadGeneration = {
        Prospects: ProspectManager,
        Qualification: LeadQualification,
        Outreach: OutreachManager,
        Campaigns: CampaignManager,
        Pipeline: PipelineManager,
        Nurturing: NurturingManager,
        Analytics: Analytics,
        Forms: LeadCapture,
        AI: AIAssistant,

        // Quick access methods
        async getDashboardStats() {
            return await Analytics.getDashboardMetrics();
        },

        async createLead(data) {
            return await ProspectManager.create(data);
        },

        async qualifyLead(prospectId, qualification) {
            return await LeadQualification.qualifyLead(prospectId, qualification);
        },

        async logOutreach(data) {
            return await OutreachManager.logOutreach(data);
        }
    };

    console.log('Lead Generation Service initialized');
})();
