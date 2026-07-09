/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * REVENUE ENGINE — Audema - Your AI Marketing Department
 * Revenue planning, pipeline attribution, and sales enablement layer.
 *
 * This module bridges the gap between marketing execution and revenue accountability:
 *   1. RevenuePlanner       — Work backward from revenue targets to required campaigns
 *   2. PipelineTracker      — Track campaign → MQL → SQL → Opp → Closed-Won
 *   3. AttributionEngine    — Multi-touch attribution (first, last, linear, U-shaped)
 *   4. SalesEnablementEngine — SDR playbooks, intelligence packages, SLA tracking
 *   5. CampaignCalendar     — Prevent overload, coordinate timing, orchestrate journeys
 *   6. ExecutiveDashboard   — CEO/CFO-level reporting (pipeline, CAC, ROI)
 *
 * The missing link between marketing execution and revenue impact.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & STORAGE KEYS
   ───────────────────────────────────────────────────────────────────────────── */

/** @enum {string} localStorage keys for revenue stores */
const REVENUE_STORAGE_KEYS = {
  REVENUE_PLANS:        'revenue_plans',
  PIPELINE_DATA:        'revenue_pipeline_data',
  ATTRIBUTION_DATA:     'revenue_attribution_data',
  SALES_INTELLIGENCE:   'revenue_sales_intelligence',
  CAMPAIGN_CALENDAR:    'revenue_campaign_calendar',
  EXECUTIVE_REPORTS:    'revenue_executive_reports'
};

/** @enum {string} Attribution models */
const ATTRIBUTION_MODEL = {
  FIRST_TOUCH:   'first_touch',      // First campaign gets 100% credit
  LAST_TOUCH:    'last_touch',       // Last campaign gets 100% credit
  LINEAR:        'linear',           // Equal credit across all touches
  U_SHAPED:      'u_shaped',         // 40% first, 40% last, 20% middle
  TIME_DECAY:    'time_decay',       // Recent touches weighted higher
  W_SHAPED:      'w_shaped'          // 30% first, 30% conversion, 30% last, 10% middle
};

/** @enum {string} Lead stages */
const LEAD_STAGE = {
  VISITOR:       'visitor',          // Anonymous website visitor
  LEAD:          'lead',             // Known contact (form fill)
  MQL:           'mql',              // Marketing Qualified Lead
  SQL:           'sql',              // Sales Qualified Lead
  OPPORTUNITY:   'opportunity',      // Active sales opportunity
  CLOSED_WON:    'closed_won',       // Customer
  CLOSED_LOST:   'closed_lost'       // Lost deal
};

/** @enum {string} Campaign types */
const CAMPAIGN_TYPE = {
  WEBINAR:       'webinar',
  EMAIL_NURTURE: 'email_nurture',
  PAID_ADS:      'paid_ads',
  CONTENT:       'content',
  EVENT:         'event',
  SEO:           'seo',
  SOCIAL:        'social'
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[RevenueEngine] localStorage read failed:', e.message);
    return null;
  }
}

function _lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[RevenueEngine] localStorage write failed:', e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   1. REVENUE PLANNER
   Work backward from revenue target to required campaigns and budget.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * RevenuePlanner manages backward planning from revenue targets.
 *
 * Example:
 *   Target: $10M pipeline by Q3
 *   → 200 SQLs needed (50% win rate, $100K ACV)
 *   → 2,000 MQLs needed (10% SQL conversion)
 *   → Campaign mix: 4 webinars, 8 nurtures, $150K paid ads
 *   → Budget: $260K total ($60K events, $40K content, $150K ads, $10K tools)
 */
class RevenuePlanner {
  constructor() {
    this._key = REVENUE_STORAGE_KEYS.REVENUE_PLANS;
  }

  /**
   * Create a revenue plan by working backward from target.
   * @param {Object} config
   * @param {number} config.pipelineTarget - Target pipeline dollars (e.g., $10M)
   * @param {string} config.deadline - Target date (ISO format)
   * @param {Object} config.assumptions - Conversion assumptions
   * @param {number} config.assumptions.avgDealSize - Average deal size (e.g., $100K)
   * @param {number} config.assumptions.winRate - Win rate % (e.g., 50)
   * @param {number} config.assumptions.mqlToSqlRate - MQL→SQL conversion % (e.g., 10)
   * @param {Object} config.assumptions.campaignPerformance - Expected performance by type
   * @returns {Object} - Revenue plan with required campaigns and budget
   */
  planFromTarget(config) {
    if (!config || !config.pipelineTarget || !config.assumptions) {
      throw new TypeError('[RevenuePlanner.planFromTarget] pipelineTarget and assumptions required');
    }

    const { pipelineTarget, deadline, assumptions } = config;
    const {
      avgDealSize = 100000,
      winRate = 50,
      mqlToSqlRate = 10,
      campaignPerformance = this._getDefaultCampaignPerformance()
    } = assumptions;

    // STEP 1: Calculate required SQLs
    const sqlsNeeded = Math.ceil(pipelineTarget / avgDealSize);

    // STEP 2: Calculate required MQLs
    const mqlsNeeded = Math.ceil(sqlsNeeded / (mqlToSqlRate / 100));

    // STEP 3: Calculate campaign mix to generate MQLs
    const campaignMix = this._calculateCampaignMix(mqlsNeeded, campaignPerformance);

    // STEP 4: Calculate budget allocation
    const budgetAllocation = this._calculateBudget(campaignMix, campaignPerformance);

    // STEP 5: Create timeline
    const timeline = this._createTimeline(campaignMix, deadline);

    // STEP 6: Save plan
    const plan = {
      planId: _uid(),
      createdAt: new Date().toISOString(),
      pipelineTarget,
      deadline,
      assumptions: {
        avgDealSize,
        winRate,
        mqlToSqlRate
      },
      requirements: {
        sqlsNeeded,
        mqlsNeeded
      },
      campaignMix,
      budgetAllocation,
      timeline,
      status: 'draft'
    };

    this._savePlan(plan);
    return plan;
  }

  /**
   * Calculate optimal campaign mix to hit MQL target.
   * @private
   */
  _calculateCampaignMix(mqlTarget, campaignPerformance) {
    const mix = [];

    // Strategy: Balance high-ROI (webinars, content) with scalable (paid ads)

    // Webinars: High quality, medium scale
    const webinarCount = Math.min(Math.ceil(mqlTarget * 0.25 / campaignPerformance.webinar.mqlsPerCampaign), 6);
    mix.push({
      type: CAMPAIGN_TYPE.WEBINAR,
      count: webinarCount,
      mqlsPerCampaign: campaignPerformance.webinar.mqlsPerCampaign,
      totalMqls: webinarCount * campaignPerformance.webinar.mqlsPerCampaign
    });

    // Email Nurture: High quality, high scale
    const nurtureCount = Math.ceil(mqlTarget * 0.30 / campaignPerformance.email_nurture.mqlsPerCampaign);
    mix.push({
      type: CAMPAIGN_TYPE.EMAIL_NURTURE,
      count: nurtureCount,
      mqlsPerCampaign: campaignPerformance.email_nurture.mqlsPerCampaign,
      totalMqls: nurtureCount * campaignPerformance.email_nurture.mqlsPerCampaign
    });

    // Paid Ads: Medium quality, infinite scale
    const remainingMqls = mqlTarget - (mix.reduce((sum, c) => sum + c.totalMqls, 0));
    const adSpend = Math.ceil(remainingMqls / campaignPerformance.paid_ads.mqlsPerDollar);
    mix.push({
      type: CAMPAIGN_TYPE.PAID_ADS,
      count: 1, // Continuous campaign
      budget: adSpend,
      mqlsPerDollar: campaignPerformance.paid_ads.mqlsPerDollar,
      totalMqls: adSpend * campaignPerformance.paid_ads.mqlsPerDollar
    });

    // Content Marketing: SEO + organic
    const contentCount = Math.ceil(mqlTarget * 0.15 / campaignPerformance.content.mqlsPerCampaign);
    mix.push({
      type: CAMPAIGN_TYPE.CONTENT,
      count: contentCount,
      mqlsPerCampaign: campaignPerformance.content.mqlsPerCampaign,
      totalMqls: contentCount * campaignPerformance.content.mqlsPerCampaign
    });

    return mix;
  }

  /**
   * Calculate budget allocation across campaign mix.
   * @private
   */
  _calculateBudget(campaignMix, campaignPerformance) {
    const budget = {
      total: 0,
      byType: {},
      breakdown: []
    };

    campaignMix.forEach(campaign => {
      const perf = campaignPerformance[campaign.type];
      let campaignCost = 0;

      if (campaign.type === CAMPAIGN_TYPE.PAID_ADS) {
        campaignCost = campaign.budget;
      } else {
        campaignCost = campaign.count * perf.costPerCampaign;
      }

      budget.byType[campaign.type] = campaignCost;
      budget.total += campaignCost;

      budget.breakdown.push({
        type: campaign.type,
        count: campaign.count,
        cost: campaignCost,
        expectedMqls: campaign.totalMqls,
        costPerMql: Math.round(campaignCost / campaign.totalMqls)
      });
    });

    return budget;
  }

  /**
   * Create campaign timeline from now to deadline.
   * @private
   */
  _createTimeline(campaignMix, deadline) {
    const startDate = new Date();
    const endDate = new Date(deadline);
    const durationWeeks = Math.ceil((endDate - startDate) / (7 * 24 * 60 * 60 * 1000));

    const timeline = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      durationWeeks,
      schedule: []
    };

    // Distribute campaigns evenly across timeline
    let currentWeek = 0;
    campaignMix.forEach(campaign => {
      if (campaign.type === CAMPAIGN_TYPE.PAID_ADS) {
        // Paid ads run continuously
        timeline.schedule.push({
          type: campaign.type,
          startWeek: 1,
          endWeek: durationWeeks,
          status: 'continuous'
        });
      } else {
        // Other campaigns spread across timeline
        const weeksPerCampaign = Math.max(1, Math.floor(durationWeeks / campaign.count));
        for (let i = 0; i < campaign.count; i++) {
          currentWeek += weeksPerCampaign;
          timeline.schedule.push({
            type: campaign.type,
            week: Math.min(currentWeek, durationWeeks),
            status: 'planned'
          });
        }
      }
    });

    return timeline;
  }

  /**
   * Get default campaign performance assumptions.
   * @private
   */
  _getDefaultCampaignPerformance() {
    return {
      webinar: {
        mqlsPerCampaign: 100,      // 500 attendees * 20% MQL rate
        costPerCampaign: 15000,     // $15K per webinar (promotion + production)
        conversionRate: 20          // 20% attendees → MQL
      },
      email_nurture: {
        mqlsPerCampaign: 50,        // 5K contacts * 1% MQL rate
        costPerCampaign: 5000,      // $5K per nurture sequence
        conversionRate: 1           // 1% contacts → MQL
      },
      paid_ads: {
        mqlsPerDollar: 0.02,        // $50 CPL = 0.02 MQLs per dollar
        cpl: 50,                    // $50 cost per lead
        conversionRate: 2           // 2% CTR → MQL
      },
      content: {
        mqlsPerCampaign: 40,        // 2K downloads * 2% MQL rate
        costPerCampaign: 8000,      // $8K per content asset (creation + promotion)
        conversionRate: 2           // 2% downloads → MQL
      },
      event: {
        mqlsPerCampaign: 150,       // 300 attendees * 50% MQL rate
        costPerCampaign: 30000,     // $30K per event
        conversionRate: 50          // 50% attendees → MQL
      }
    };
  }

  /**
   * Get all revenue plans.
   * @param {Object} [filter]
   * @returns {Object[]}
   */
  getAllPlans(filter = {}) {
    let plans = _lsGet(this._key) || [];

    if (filter.status) {
      plans = plans.filter(p => p.status === filter.status);
    }

    return plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Update plan status.
   * @param {string} planId
   * @param {string} status - 'draft', 'active', 'completed', 'archived'
   */
  updatePlanStatus(planId, status) {
    const plans = _lsGet(this._key) || [];
    const plan = plans.find(p => p.planId === planId);

    if (plan) {
      plan.status = status;
      plan.updatedAt = new Date().toISOString();
      _lsSet(this._key, plans);
    }
  }

  /**
   * Save plan to storage.
   * @private
   */
  _savePlan(plan) {
    const plans = _lsGet(this._key) || [];
    plans.push(plan);
    _lsSet(this._key, plans);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. PIPELINE TRACKER
   Track campaign → MQL → SQL → Opp → Closed-Won pipeline progression.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * PipelineTracker manages pipeline attribution and conversion tracking.
 *
 * Tracks:
 * - Lead progression: Visitor → Lead → MQL → SQL → Opp → Won/Lost
 * - Pipeline created (campaign → opportunity created)
 * - Pipeline influenced (campaign touched opportunity at any stage)
 * - Conversion rates at each stage
 * - Deal velocity (days from MQL → Won)
 */
class PipelineTracker {
  constructor() {
    this._key = REVENUE_STORAGE_KEYS.PIPELINE_DATA;
  }

  /**
   * Create a new lead record.
   * @param {Object} lead
   * @param {string} lead.email
   * @param {string} lead.company
   * @param {string} lead.source - First campaign that created the lead
   * @returns {Object} - Created lead record
   */
  createLead(lead) {
    if (!lead || !lead.email) {
      throw new TypeError('[PipelineTracker.createLead] email required');
    }

    const leadRecord = {
      leadId: _uid(),
      email: lead.email,
      company: lead.company,
      firstName: lead.firstName,
      lastName: lead.lastName,
      title: lead.title,
      source: lead.source,
      createdAt: new Date().toISOString(),
      stage: LEAD_STAGE.LEAD,
      touchpoints: [],
      stageHistory: [{
        stage: LEAD_STAGE.LEAD,
        timestamp: new Date().toISOString(),
        campaign: lead.source
      }]
    };

    this._saveLead(leadRecord);
    return leadRecord;
  }

  /**
   * Add touchpoint (campaign interaction) to lead.
   * @param {string} leadId
   * @param {Object} touchpoint
   * @param {string} touchpoint.campaignId
   * @param {string} touchpoint.campaignName
   * @param {string} touchpoint.campaignType
   * @param {string} touchpoint.interaction - 'email_open', 'click', 'form_fill', 'webinar_attend'
   */
  addTouchpoint(leadId, touchpoint) {
    const leads = this._loadLeads();
    const lead = leads.find(l => l.leadId === leadId);

    if (!lead) {
      console.warn(`[PipelineTracker] Lead ${leadId} not found`);
      return;
    }

    lead.touchpoints.push({
      ...touchpoint,
      timestamp: new Date().toISOString()
    });

    lead.updatedAt = new Date().toISOString();
    this._saveLeads(leads);
  }

  /**
   * Progress lead to next stage.
   * @param {string} leadId
   * @param {string} newStage - Target stage (mql, sql, opportunity, closed_won, closed_lost)
   * @param {Object} [metadata] - Additional metadata (deal size, close date, etc.)
   */
  progressLead(leadId, newStage, metadata = {}) {
    const leads = this._loadLeads();
    const lead = leads.find(l => l.leadId === leadId);

    if (!lead) {
      console.warn(`[PipelineTracker] Lead ${leadId} not found`);
      return;
    }

    // Update stage
    lead.stage = newStage;
    lead.updatedAt = new Date().toISOString();

    // Add to stage history
    lead.stageHistory.push({
      stage: newStage,
      timestamp: new Date().toISOString(),
      ...metadata
    });

    // If opportunity or won, track deal data
    if (newStage === LEAD_STAGE.OPPORTUNITY || newStage === LEAD_STAGE.CLOSED_WON) {
      lead.dealSize = metadata.dealSize;
      lead.expectedCloseDate = metadata.expectedCloseDate;
    }

    if (newStage === LEAD_STAGE.CLOSED_WON) {
      lead.closeDate = metadata.closeDate || new Date().toISOString();
      lead.dealSize = metadata.dealSize;
    }

    this._saveLeads(leads);
    return lead;
  }

  /**
   * Get pipeline metrics for a campaign.
   * @param {string} campaignId
   * @returns {Object} - Pipeline metrics
   */
  getCampaignPipeline(campaignId) {
    const leads = this._loadLeads();

    // Find leads that touched this campaign
    const touchedLeads = leads.filter(lead =>
      lead.touchpoints.some(t => t.campaignId === campaignId) ||
      lead.source === campaignId
    );

    // Leads where this was first touch (pipeline created)
    const createdLeads = leads.filter(l => l.source === campaignId);

    // Calculate metrics
    const metrics = {
      campaignId,
      totalLeads: touchedLeads.length,
      pipelineCreated: this._calculatePipelineCreated(createdLeads),
      pipelineInfluenced: this._calculatePipelineInfluenced(touchedLeads),
      conversionRates: this._calculateConversionRates(createdLeads),
      closedWonRevenue: this._calculateClosedWonRevenue(createdLeads),
      avgDealSize: this._calculateAvgDealSize(createdLeads),
      avgDealVelocity: this._calculateAvgDealVelocity(createdLeads)
    };

    return metrics;
  }

  /**
   * Get overall pipeline health metrics.
   * @returns {Object}
   */
  getPipelineHealth() {
    const leads = this._loadLeads();

    const health = {
      totalLeads: leads.length,
      byStage: {},
      conversionRates: {},
      avgDealVelocity: this._calculateAvgDealVelocity(leads),
      pipelineValue: 0,
      forecastRevenue: 0
    };

    // Count by stage
    Object.values(LEAD_STAGE).forEach(stage => {
      health.byStage[stage] = leads.filter(l => l.stage === stage).length;
    });

    // Calculate conversion rates
    health.conversionRates = this._calculateConversionRates(leads);

    // Calculate pipeline value (opportunities)
    const opportunities = leads.filter(l => l.stage === LEAD_STAGE.OPPORTUNITY);
    health.pipelineValue = opportunities.reduce((sum, l) => sum + (l.dealSize || 0), 0);

    // Forecast revenue (opportunities * historical win rate)
    const winRate = health.conversionRates.opportunityToWon || 50;
    health.forecastRevenue = health.pipelineValue * (winRate / 100);

    return health;
  }

  /**
   * Calculate pipeline created (opportunities from first-touch leads).
   * @private
   */
  _calculatePipelineCreated(leads) {
    const opportunities = leads.filter(l =>
      l.stage === LEAD_STAGE.OPPORTUNITY ||
      l.stage === LEAD_STAGE.CLOSED_WON ||
      l.stage === LEAD_STAGE.CLOSED_LOST
    );

    return {
      opportunities: opportunities.length,
      pipelineValue: opportunities.reduce((sum, l) => sum + (l.dealSize || 0), 0)
    };
  }

  /**
   * Calculate pipeline influenced (opportunities that touched campaign).
   * @private
   */
  _calculatePipelineInfluenced(leads) {
    const opportunities = leads.filter(l =>
      l.stage === LEAD_STAGE.OPPORTUNITY ||
      l.stage === LEAD_STAGE.CLOSED_WON ||
      l.stage === LEAD_STAGE.CLOSED_LOST
    );

    return {
      opportunities: opportunities.length,
      pipelineValue: opportunities.reduce((sum, l) => sum + (l.dealSize || 0), 0)
    };
  }

  /**
   * Calculate conversion rates at each stage.
   * @private
   */
  _calculateConversionRates(leads) {
    const stages = {
      lead: leads.length,
      mql: leads.filter(l => [LEAD_STAGE.MQL, LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      sql: leads.filter(l => [LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      opportunity: leads.filter(l => [LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      won: leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON).length
    };

    return {
      leadToMql: stages.lead > 0 ? Math.round((stages.mql / stages.lead) * 100) : 0,
      mqlToSql: stages.mql > 0 ? Math.round((stages.sql / stages.mql) * 100) : 0,
      sqlToOpportunity: stages.sql > 0 ? Math.round((stages.opportunity / stages.sql) * 100) : 0,
      opportunityToWon: stages.opportunity > 0 ? Math.round((stages.won / stages.opportunity) * 100) : 0,
      leadToWon: stages.lead > 0 ? Math.round((stages.won / stages.lead) * 100) : 0
    };
  }

  /**
   * Calculate closed-won revenue.
   * @private
   */
  _calculateClosedWonRevenue(leads) {
    const won = leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON);
    return won.reduce((sum, l) => sum + (l.dealSize || 0), 0);
  }

  /**
   * Calculate average deal size.
   * @private
   */
  _calculateAvgDealSize(leads) {
    const won = leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON && l.dealSize);
    if (won.length === 0) return 0;
    return Math.round(won.reduce((sum, l) => sum + l.dealSize, 0) / won.length);
  }

  /**
   * Calculate average deal velocity (days from MQL to Won).
   * @private
   */
  _calculateAvgDealVelocity(leads) {
    const won = leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON);
    if (won.length === 0) return 0;

    const velocities = won.map(lead => {
      const mqlStage = lead.stageHistory.find(s => s.stage === LEAD_STAGE.MQL);
      const wonStage = lead.stageHistory.find(s => s.stage === LEAD_STAGE.CLOSED_WON);

      if (!mqlStage || !wonStage) return null;

      const mqlDate = new Date(mqlStage.timestamp);
      const wonDate = new Date(wonStage.timestamp);
      return Math.ceil((wonDate - mqlDate) / (24 * 60 * 60 * 1000)); // Days
    }).filter(v => v !== null);

    if (velocities.length === 0) return 0;
    return Math.round(velocities.reduce((sum, v) => sum + v, 0) / velocities.length);
  }

  /**
   * Load all leads.
   * @private
   */
  _loadLeads() {
    return _lsGet(this._key) || [];
  }

  /**
   * Save lead record.
   * @private
   */
  _saveLead(lead) {
    const leads = this._loadLeads();
    leads.push(lead);
    _lsSet(this._key, leads);
  }

  /**
   * Save all leads.
   * @private
   */
  _saveLeads(leads) {
    _lsSet(this._key, leads);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. ATTRIBUTION ENGINE
   Multi-touch attribution across campaign touchpoints.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * AttributionEngine manages multi-touch attribution models.
 *
 * Models:
 * - First-Touch: 100% credit to first campaign
 * - Last-Touch: 100% credit to last campaign before conversion
 * - Linear: Equal credit across all touchpoints
 * - U-Shaped: 40% first, 40% last, 20% middle
 * - Time-Decay: Recent touchpoints weighted higher
 * - W-Shaped: 30% first, 30% conversion, 30% last, 10% middle
 */
class AttributionEngine {
  constructor(pipelineTracker) {
    this.pipelineTracker = pipelineTracker;
    this._key = REVENUE_STORAGE_KEYS.ATTRIBUTION_DATA;
  }

  /**
   * Calculate attribution credits for a lead's journey.
   * @param {string} leadId
   * @param {string} model - Attribution model to use
   * @returns {Object} - Attribution credits by campaign
   */
  calculateAttribution(leadId, model = ATTRIBUTION_MODEL.U_SHAPED) {
    const leads = this.pipelineTracker._loadLeads();
    const lead = leads.find(l => l.leadId === leadId);

    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    // Get all touchpoints including source
    const touchpoints = [
      { campaignId: lead.source, timestamp: lead.createdAt, position: 0 },
      ...lead.touchpoints.map((t, i) => ({ ...t, position: i + 1 }))
    ];

    if (touchpoints.length === 0) {
      return {};
    }

    // Calculate credits based on model
    let credits = {};

    switch (model) {
      case ATTRIBUTION_MODEL.FIRST_TOUCH:
        credits = this._firstTouchAttribution(touchpoints, lead);
        break;
      case ATTRIBUTION_MODEL.LAST_TOUCH:
        credits = this._lastTouchAttribution(touchpoints, lead);
        break;
      case ATTRIBUTION_MODEL.LINEAR:
        credits = this._linearAttribution(touchpoints, lead);
        break;
      case ATTRIBUTION_MODEL.U_SHAPED:
        credits = this._uShapedAttribution(touchpoints, lead);
        break;
      case ATTRIBUTION_MODEL.TIME_DECAY:
        credits = this._timeDecayAttribution(touchpoints, lead);
        break;
      case ATTRIBUTION_MODEL.W_SHAPED:
        credits = this._wShapedAttribution(touchpoints, lead);
        break;
      default:
        credits = this._linearAttribution(touchpoints, lead);
    }

    return credits;
  }

  /**
   * Get attribution report for all closed-won deals.
   * @param {string} model - Attribution model
   * @returns {Object} - Campaign-level attribution report
   */
  getAttributionReport(model = ATTRIBUTION_MODEL.U_SHAPED) {
    const leads = this.pipelineTracker._loadLeads();
    const won = leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON);

    const report = {
      model,
      totalRevenue: won.reduce((sum, l) => sum + (l.dealSize || 0), 0),
      totalDeals: won.length,
      byCampaign: {}
    };

    // Calculate attribution for each won deal
    won.forEach(lead => {
      const credits = this.calculateAttribution(lead.leadId, model);

      Object.entries(credits).forEach(([campaignId, credit]) => {
        if (!report.byCampaign[campaignId]) {
          report.byCampaign[campaignId] = {
            campaignId,
            deals: 0,
            revenue: 0,
            credit: 0
          };
        }

        report.byCampaign[campaignId].deals++;
        report.byCampaign[campaignId].revenue += (lead.dealSize || 0) * credit;
        report.byCampaign[campaignId].credit += credit;
      });
    });

    // Sort by revenue
    report.topCampaigns = Object.values(report.byCampaign)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return report;
  }

  /**
   * First-touch attribution: 100% credit to first campaign.
   * @private
   */
  _firstTouchAttribution(touchpoints, lead) {
    return {
      [touchpoints[0].campaignId]: 1.0
    };
  }

  /**
   * Last-touch attribution: 100% credit to last campaign.
   * @private
   */
  _lastTouchAttribution(touchpoints, lead) {
    return {
      [touchpoints[touchpoints.length - 1].campaignId]: 1.0
    };
  }

  /**
   * Linear attribution: Equal credit across all touchpoints.
   * @private
   */
  _linearAttribution(touchpoints, lead) {
    const credits = {};
    const creditPerTouch = 1.0 / touchpoints.length;

    touchpoints.forEach(t => {
      credits[t.campaignId] = (credits[t.campaignId] || 0) + creditPerTouch;
    });

    return credits;
  }

  /**
   * U-shaped attribution: 40% first, 40% last, 20% middle.
   * @private
   */
  _uShapedAttribution(touchpoints, lead) {
    if (touchpoints.length === 1) {
      return { [touchpoints[0].campaignId]: 1.0 };
    }

    if (touchpoints.length === 2) {
      return {
        [touchpoints[0].campaignId]: 0.5,
        [touchpoints[1].campaignId]: 0.5
      };
    }

    const credits = {};
    const middleCount = touchpoints.length - 2;
    const middleCreditPerTouch = 0.2 / middleCount;

    touchpoints.forEach((t, i) => {
      let credit = 0;
      if (i === 0) credit = 0.4; // First
      else if (i === touchpoints.length - 1) credit = 0.4; // Last
      else credit = middleCreditPerTouch; // Middle

      credits[t.campaignId] = (credits[t.campaignId] || 0) + credit;
    });

    return credits;
  }

  /**
   * Time-decay attribution: Recent touchpoints weighted higher.
   * @private
   */
  _timeDecayAttribution(touchpoints, lead) {
    const credits = {};
    const halfLife = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    const now = new Date(lead.updatedAt || Date.now());
    let totalWeight = 0;

    // Calculate weights
    const weights = touchpoints.map(t => {
      const timestamp = new Date(t.timestamp);
      const age = now - timestamp;
      const weight = Math.pow(0.5, age / halfLife);
      totalWeight += weight;
      return { campaignId: t.campaignId, weight };
    });

    // Normalize to sum to 1.0
    weights.forEach(w => {
      credits[w.campaignId] = (credits[w.campaignId] || 0) + (w.weight / totalWeight);
    });

    return credits;
  }

  /**
   * W-shaped attribution: 30% first, 30% conversion, 30% last, 10% middle.
   * @private
   */
  _wShapedAttribution(touchpoints, lead) {
    if (touchpoints.length === 1) {
      return { [touchpoints[0].campaignId]: 1.0 };
    }

    if (touchpoints.length === 2) {
      return {
        [touchpoints[0].campaignId]: 0.5,
        [touchpoints[1].campaignId]: 0.5
      };
    }

    // Find conversion touchpoint (when became MQL or opportunity)
    const conversionIndex = this._findConversionTouchpoint(touchpoints, lead);
    const credits = {};

    // If no clear conversion touchpoint, fall back to U-shaped
    if (conversionIndex === -1) {
      return this._uShapedAttribution(touchpoints, lead);
    }

    const middleCount = touchpoints.length - 3;
    const middleCreditPerTouch = middleCount > 0 ? 0.1 / middleCount : 0;

    touchpoints.forEach((t, i) => {
      let credit = 0;
      if (i === 0) credit = 0.3; // First
      else if (i === conversionIndex) credit = 0.3; // Conversion
      else if (i === touchpoints.length - 1) credit = 0.3; // Last
      else credit = middleCreditPerTouch; // Middle

      credits[t.campaignId] = (credits[t.campaignId] || 0) + credit;
    });

    return credits;
  }

  /**
   * Find touchpoint closest to MQL/SQL conversion.
   * @private
   */
  _findConversionTouchpoint(touchpoints, lead) {
    const mqlStage = lead.stageHistory?.find(s => s.stage === LEAD_STAGE.MQL);
    if (!mqlStage) return -1;

    const mqlDate = new Date(mqlStage.timestamp);

    // Find touchpoint closest to MQL date
    let closestIndex = -1;
    let closestDiff = Infinity;

    touchpoints.forEach((t, i) => {
      const touchDate = new Date(t.timestamp);
      const diff = Math.abs(mqlDate - touchDate);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    });

    return closestIndex;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. SALES ENABLEMENT ENGINE
   SDR playbooks, sales intelligence, and SLA tracking.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * SalesEnablementEngine manages SDR automation and sales intelligence.
 *
 * Features:
 * - Auto-generate SDR playbooks based on lead behavior
 * - Create sales intelligence packages for each lead
 * - Track SLA compliance (MQL → contact time)
 * - Monitor sales conversion rates
 */
class SalesEnablementEngine {
  constructor(pipelineTracker, intelligenceEngine) {
    this.pipelineTracker = pipelineTracker;
    this.intelligenceEngine = intelligenceEngine; // window.IntelligenceEngine
    this._key = REVENUE_STORAGE_KEYS.SALES_INTELLIGENCE;
  }

  /**
   * Generate SDR playbook for a lead.
   * @param {string} leadId
   * @returns {Object} - SDR playbook with call script, email template, objection handling
   */
  generateSDRPlaybook(leadId) {
    const leads = this.pipelineTracker._loadLeads();
    const lead = leads.find(l => l.leadId === leadId);

    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    // Analyze lead behavior
    const behavior = this._analyzeLeadBehavior(lead);

    // Generate playbook
    const playbook = {
      leadId,
      generatedAt: new Date().toISOString(),
      lead: {
        name: `${lead.firstName} ${lead.lastName}`,
        title: lead.title,
        company: lead.company,
        email: lead.email
      },
      callScript: this._generateCallScript(lead, behavior),
      emailTemplate: this._generateEmailTemplate(lead, behavior),
      objectionHandling: this._generateObjectionHandling(lead, behavior),
      battleCards: this._getRelevantBattleCards(behavior),
      nextSteps: this._suggestNextSteps(lead, behavior)
    };

    this._savePlaybook(playbook);
    return playbook;
  }

  /**
   * Create sales intelligence package for a lead.
   * @param {string} leadId
   * @returns {Object} - Intelligence dossier
   */
  createIntelligencePackage(leadId) {
    const leads = this.pipelineTracker._loadLeads();
    const lead = leads.find(l => l.leadId === leadId);

    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    const intelligencePackage = {
      leadId,
      generatedAt: new Date().toISOString(),
      recentActivity: this._getRecentActivity(lead),
      painPoints: this._inferPainPoints(lead),
      competitorSignals: this._detectCompetitorSignals(lead),
      buyingStage: this._identifyBuyingStage(lead),
      engagementScore: this._calculateEngagementScore(lead),
      recommendedAssets: this._recommendSalesAssets(lead)
    };

    return intelligencePackage;
  }

  /**
   * Track SLA compliance (MQL → SDR contact time).
   * @param {string} leadId
   * @param {Date} contactTime
   * @returns {Object} - SLA compliance record
   */
  trackSLA(leadId, contactTime) {
    const leads = this.pipelineTracker._loadLeads();
    const lead = leads.find(l => l.leadId === leadId);

    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    const mqlStage = lead.stageHistory?.find(s => s.stage === LEAD_STAGE.MQL);
    if (!mqlStage) {
      return { status: 'not_mql', message: 'Lead is not MQL yet' };
    }

    const mqlTime = new Date(mqlStage.timestamp);
    const contact = new Date(contactTime);
    const minutesElapsed = Math.round((contact - mqlTime) / (60 * 1000));

    // SLA thresholds
    const sla = {
      leadId,
      mqlTime: mqlTime.toISOString(),
      contactTime: contact.toISOString(),
      minutesElapsed,
      tier: lead.tier || 'B',
      compliant: false,
      status: 'breached'
    };

    // A-tier: 5 minutes, B-tier: 4 hours, C-tier: 24 hours
    if (lead.tier === 'A' && minutesElapsed <= 5) {
      sla.compliant = true;
      sla.status = 'compliant';
    } else if (lead.tier === 'B' && minutesElapsed <= 240) {
      sla.compliant = true;
      sla.status = 'compliant';
    } else if (lead.tier === 'C' && minutesElapsed <= 1440) {
      sla.compliant = true;
      sla.status = 'compliant';
    }

    this._saveSLA(sla);
    return sla;
  }

  /**
   * Get SLA compliance report.
   * @param {Object} [filter]
   * @returns {Object} - SLA metrics
   */
  getSLAReport(filter = {}) {
    const slaRecords = _lsGet(this._key + '_sla') || [];

    let filtered = slaRecords;
    if (filter.tier) {
      filtered = filtered.filter(s => s.tier === filter.tier);
    }

    const report = {
      totalRecords: filtered.length,
      compliant: filtered.filter(s => s.compliant).length,
      breached: filtered.filter(s => !s.compliant).length,
      complianceRate: filtered.length > 0
        ? Math.round((filtered.filter(s => s.compliant).length / filtered.length) * 100)
        : 0,
      avgResponseTime: filtered.length > 0
        ? Math.round(filtered.reduce((sum, s) => sum + s.minutesElapsed, 0) / filtered.length)
        : 0,
      byTier: {}
    };

    ['A', 'B', 'C'].forEach(tier => {
      const tierRecords = filtered.filter(s => s.tier === tier);
      report.byTier[tier] = {
        total: tierRecords.length,
        compliant: tierRecords.filter(s => s.compliant).length,
        complianceRate: tierRecords.length > 0
          ? Math.round((tierRecords.filter(s => s.compliant).length / tierRecords.length) * 100)
          : 0
      };
    });

    return report;
  }

  /**
   * Analyze lead behavior from touchpoints.
   * @private
   */
  _analyzeLeadBehavior(lead) {
    const behavior = {
      contentConsumed: [],
      engagementLevel: 'low',
      primaryInterest: 'unknown',
      competitorAware: false
    };

    lead.touchpoints?.forEach(t => {
      if (t.interaction === 'webinar_attend') behavior.engagementLevel = 'high';
      if (t.interaction === 'demo_request') behavior.engagementLevel = 'very_high';
      if (t.campaignName?.includes('vs') || t.campaignName?.includes('comparison')) {
        behavior.competitorAware = true;
      }
      behavior.contentConsumed.push(t.campaignName);
    });

    return behavior;
  }

  /**
   * Generate call script based on lead behavior.
   * @private
   */
  _generateCallScript(lead, behavior) {
    const name = lead.firstName || 'there';
    const company = lead.company || 'your company';

    return `
Hi ${name}, this is [Your Name] from Audema.

I saw you ${behavior.contentConsumed.length > 0 ? `recently downloaded our ${behavior.contentConsumed[0]}` : 'visited our website'}.

I wanted to reach out because I work with ${lead.title || 'leaders'} at companies like ${company} who are looking to [solve pain point].

Quick question: Are you currently evaluating solutions to [relevant pain point]?

[If yes → Schedule demo]
[If no → What's your timeline? Can I send you [resource]?]
    `.trim();
  }

  /**
   * Generate email template.
   * @private
   */
  _generateEmailTemplate(lead, behavior) {
    return {
      subject: `Following up on ${behavior.contentConsumed[0] || 'your interest'}`,
      body: `
Hi ${lead.firstName || 'there'},

I noticed you ${behavior.contentConsumed.length > 0 ? `downloaded our ${behavior.contentConsumed[0]}` : 'visited our website recently'}.

Are you currently evaluating ways to [solve pain point]?

I'd love to share how companies like ${lead.company} are using Audema to [achieve outcome].

Open to a quick 15-minute call this week?

Best,
[Your Name]
      `.trim()
    };
  }

  /**
   * Generate objection handling guide.
   * @private
   */
  _generateObjectionHandling(lead, behavior) {
    return [
      {
        objection: "We're already using [Competitor]",
        response: "Great! Many of our customers came from [Competitor]. What's working well? What could be better?"
      },
      {
        objection: "Not in the budget right now",
        response: "I understand. What's your planning cycle? Can I send you an ROI calculator to help build the business case?"
      },
      {
        objection: "Just looking/researching",
        response: "Perfect timing. What triggered your research? Happy to share what we're seeing in the market."
      }
    ];
  }

  /**
   * Get relevant battle cards.
   * @private
   */
  _getRelevantBattleCards(behavior) {
    if (behavior.competitorAware) {
      return ['vs_salesforce', 'vs_hubspot', 'vs_marketo'];
    }
    return [];
  }

  /**
   * Suggest next steps based on lead behavior.
   * @private
   */
  _suggestNextSteps(lead, behavior) {
    if (behavior.engagementLevel === 'very_high') {
      return ['Schedule demo immediately', 'Send ROI calculator', 'Intro to customer success'];
    } else if (behavior.engagementLevel === 'high') {
      return ['Schedule discovery call', 'Send case study', 'Invite to webinar'];
    } else {
      return ['Send nurture email', 'Connect on LinkedIn', 'Monitor for engagement'];
    }
  }

  /**
   * Get recent activity for lead.
   * @private
   */
  _getRecentActivity(lead) {
    return (lead.touchpoints || [])
      .slice(-5)
      .map(t => ({
        campaign: t.campaignName,
        interaction: t.interaction,
        timestamp: t.timestamp
      }));
  }

  /**
   * Infer pain points from behavior.
   * @private
   */
  _inferPainPoints(lead) {
    const painPoints = [];
    lead.touchpoints?.forEach(t => {
      if (t.campaignName?.includes('ROI')) painPoints.push('Proving marketing ROI');
      if (t.campaignName?.includes('automation')) painPoints.push('Manual processes');
      if (t.campaignName?.includes('attribution')) painPoints.push('Attribution tracking');
    });
    return [...new Set(painPoints)];
  }

  /**
   * Detect competitor signals.
   * @private
   */
  _detectCompetitorSignals(lead) {
    const signals = [];
    lead.touchpoints?.forEach(t => {
      if (t.campaignName?.includes('vs') || t.campaignName?.includes('comparison')) {
        signals.push({ type: 'comparison', campaign: t.campaignName });
      }
    });
    return signals;
  }

  /**
   * Identify buying stage.
   * @private
   */
  _identifyBuyingStage(lead) {
    const touchpointCount = lead.touchpoints?.length || 0;
    if (touchpointCount === 0) return 'awareness';
    if (touchpointCount <= 3) return 'consideration';
    return 'decision';
  }

  /**
   * Calculate engagement score (0-100).
   * @private
   */
  _calculateEngagementScore(lead) {
    let score = 0;
    score += (lead.touchpoints?.length || 0) * 5; // 5 points per touchpoint
    score += lead.stage === LEAD_STAGE.MQL ? 20 : 0;
    score += lead.stage === LEAD_STAGE.SQL ? 40 : 0;
    return Math.min(100, score);
  }

  /**
   * Recommend sales assets.
   * @private
   */
  _recommendSalesAssets(lead) {
    const stage = this._identifyBuyingStage(lead);
    if (stage === 'awareness') return ['Product overview deck', 'Industry trends report'];
    if (stage === 'consideration') return ['Case studies', 'ROI calculator', 'Comparison guide'];
    return ['Demo recording', 'Implementation plan', 'Pricing sheet'];
  }

  /**
   * Save playbook.
   * @private
   */
  _savePlaybook(playbook) {
    const playbooks = _lsGet(this._key) || [];
    playbooks.push(playbook);
    _lsSet(this._key, playbooks);
  }

  /**
   * Save SLA record.
   * @private
   */
  _saveSLA(sla) {
    const slaRecords = _lsGet(this._key + '_sla') || [];
    slaRecords.push(sla);
    _lsSet(this._key + '_sla', slaRecords);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. CAMPAIGN CALENDAR
   Prevent campaign overload, coordinate timing, orchestrate multi-channel journeys.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * CampaignCalendar manages campaign scheduling and cross-channel orchestration.
 *
 * Features:
 * - Prevent campaign overload (max 2 emails/week per segment)
 * - Coordinate multi-channel timing (email → ad → SDR)
 * - Block out holidays, events, sales kickoffs
 * - Orchestrate sequential journeys
 */
class CampaignCalendar {
  constructor() {
    this._key = REVENUE_STORAGE_KEYS.CAMPAIGN_CALENDAR;
  }

  /**
   * Schedule a campaign and check for conflicts.
   * @param {Object} campaign
   * @param {string} campaign.campaignId
   * @param {string} campaign.campaignName
   * @param {string} campaign.campaignType
   * @param {string} campaign.scheduledDate - ISO date string
   * @param {string} campaign.targetSegment
   * @param {string} campaign.channel - email, social, ads, webinar
   * @returns {Object} - Schedule result with conflicts if any
   */
  scheduleCampaign(campaign) {
    if (!campaign || !campaign.scheduledDate || !campaign.targetSegment) {
      throw new TypeError('[CampaignCalendar.scheduleCampaign] scheduledDate and targetSegment required');
    }

    const existingCampaigns = this.getAllCampaigns();

    // Check for conflicts
    const conflicts = this._detectConflicts(campaign, existingCampaigns);

    const result = {
      campaignId: campaign.campaignId || _uid(),
      ...campaign,
      createdAt: new Date().toISOString(),
      status: conflicts.length > 0 ? 'conflicts_detected' : 'scheduled',
      conflicts
    };

    // Save campaign if no blocking conflicts
    if (!conflicts.some(c => c.severity === 'blocking')) {
      this._saveCampaign(result);
    }

    return result;
  }

  /**
   * Get campaign calendar view for date range.
   * @param {string} startDate - ISO date
   * @param {string} endDate - ISO date
   * @returns {Object} - Calendar view with campaigns by day
   */
  getCalendarView(startDate, endDate) {
    const campaigns = this.getAllCampaigns();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const view = {
      startDate,
      endDate,
      byDay: {},
      bySegment: {},
      byChannel: {}
    };

    campaigns.forEach(campaign => {
      const campDate = new Date(campaign.scheduledDate);
      if (campDate >= start && campDate <= end) {
        const dateKey = campDate.toISOString().split('T')[0];

        // By day
        if (!view.byDay[dateKey]) view.byDay[dateKey] = [];
        view.byDay[dateKey].push(campaign);

        // By segment
        if (!view.bySegment[campaign.targetSegment]) view.bySegment[campaign.targetSegment] = [];
        view.bySegment[campaign.targetSegment].push(campaign);

        // By channel
        if (!view.byChannel[campaign.channel]) view.byChannel[campaign.channel] = [];
        view.byChannel[campaign.channel].push(campaign);
      }
    });

    return view;
  }

  /**
   * Orchestrate multi-channel journey.
   * @param {Object} journey
   * @param {string} journey.journeyName
   * @param {string} journey.targetSegment
   * @param {string} journey.startDate
   * @param {Object[]} journey.steps - Journey steps
   * @returns {Object} - Orchestrated journey with scheduled campaigns
   */
  orchestrateJourney(journey) {
    const { journeyName, targetSegment, startDate, steps } = journey;

    const orchestrated = {
      journeyId: _uid(),
      journeyName,
      targetSegment,
      startDate,
      createdAt: new Date().toISOString(),
      steps: [],
      scheduledCampaigns: []
    };

    let currentDate = new Date(startDate);

    steps.forEach((step, index) => {
      const campaign = {
        campaignId: _uid(),
        campaignName: `${journeyName} - ${step.name}`,
        campaignType: step.type,
        channel: step.channel,
        targetSegment,
        scheduledDate: new Date(currentDate).toISOString(),
        journeyId: orchestrated.journeyId,
        journeyStep: index + 1
      };

      orchestrated.scheduledCampaigns.push(campaign);
      orchestrated.steps.push({
        stepNumber: index + 1,
        name: step.name,
        channel: step.channel,
        scheduledDate: campaign.scheduledDate,
        daysFromStart: Math.ceil((currentDate - new Date(startDate)) / (24 * 60 * 60 * 1000))
      });

      // Move to next step date
      currentDate.setDate(currentDate.getDate() + (step.daysAfter || 0));
    });

    this._saveJourney(orchestrated);
    return orchestrated;
  }

  /**
   * Block out dates (holidays, events, blackout periods).
   * @param {Object} blackout
   * @param {string} blackout.name - Reason for blackout
   * @param {string} blackout.startDate
   * @param {string} blackout.endDate
   */
  addBlackoutPeriod(blackout) {
    const blackouts = _lsGet(this._key + '_blackouts') || [];
    blackouts.push({
      id: _uid(),
      ...blackout,
      createdAt: new Date().toISOString()
    });
    _lsSet(this._key + '_blackouts', blackouts);
  }

  /**
   * Get all campaigns.
   * @returns {Object[]}
   */
  getAllCampaigns() {
    return _lsGet(this._key) || [];
  }

  /**
   * Get all journeys.
   * @returns {Object[]}
   */
  getAllJourneys() {
    return _lsGet(this._key + '_journeys') || [];
  }

  /**
   * Detect scheduling conflicts.
   * @private
   */
  _detectConflicts(campaign, existingCampaigns) {
    const conflicts = [];
    const campaignDate = new Date(campaign.scheduledDate).toISOString().split('T')[0];

    // Check blackout periods
    const blackouts = _lsGet(this._key + '_blackouts') || [];
    blackouts.forEach(blackout => {
      const start = new Date(blackout.startDate);
      const end = new Date(blackout.endDate);
      const date = new Date(campaign.scheduledDate);

      if (date >= start && date <= end) {
        conflicts.push({
          type: 'blackout_period',
          severity: 'blocking',
          message: `Date falls within blackout period: ${blackout.name}`,
          blackout
        });
      }
    });

    // Check email frequency per segment
    if (campaign.channel === 'email') {
      const sameSegment = existingCampaigns.filter(c =>
        c.targetSegment === campaign.targetSegment &&
        c.channel === 'email' &&
        c.status !== 'cancelled'
      );

      // Count emails to this segment in same week
      const sameWeekEmails = sameSegment.filter(c => {
        const cDate = new Date(c.scheduledDate);
        const thisDate = new Date(campaign.scheduledDate);
        const diffDays = Math.abs((thisDate - cDate) / (24 * 60 * 60 * 1000));
        return diffDays <= 7;
      });

      if (sameWeekEmails.length >= 2) {
        conflicts.push({
          type: 'email_frequency',
          severity: 'warning',
          message: `${sameWeekEmails.length} emails already scheduled to ${campaign.targetSegment} this week (max recommended: 2)`,
          existingCampaigns: sameWeekEmails.map(c => c.campaignName)
        });
      }
    }

    // Check same-day overload
    const sameDay = existingCampaigns.filter(c => {
      const cDate = new Date(c.scheduledDate).toISOString().split('T')[0];
      return cDate === campaignDate && c.targetSegment === campaign.targetSegment;
    });

    if (sameDay.length >= 3) {
      conflicts.push({
        type: 'same_day_overload',
        severity: 'warning',
        message: `${sameDay.length} campaigns already scheduled for ${campaignDate} (max recommended: 3)`,
        existingCampaigns: sameDay.map(c => c.campaignName)
      });
    }

    return conflicts;
  }

  /**
   * Save campaign to calendar.
   * @private
   */
  _saveCampaign(campaign) {
    const campaigns = _lsGet(this._key) || [];
    campaigns.push(campaign);
    _lsSet(this._key, campaigns);
  }

  /**
   * Save journey.
   * @private
   */
  _saveJourney(journey) {
    const journeys = _lsGet(this._key + '_journeys') || [];
    journeys.push(journey);
    _lsSet(this._key + '_journeys', journeys);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. EXECUTIVE DASHBOARD
   CEO/CFO-level reporting: pipeline, CAC, ROI, forecasts.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * ExecutiveDashboard generates executive-level marketing reports.
 *
 * Reports:
 * - Weekly CMO report (pipeline created, CAC, ROI)
 * - Monthly performance summary
 * - Revenue forecast
 * - Campaign leaderboard
 */
class ExecutiveDashboard {
  constructor(pipelineTracker, attributionEngine) {
    this.pipelineTracker = pipelineTracker;
    this.attributionEngine = attributionEngine;
    this._key = REVENUE_STORAGE_KEYS.EXECUTIVE_REPORTS;
  }

  /**
   * Generate weekly CMO report.
   * @param {Date} [weekStart] - Start of week (defaults to last Monday)
   * @returns {Object} - Weekly report
   */
  generateWeeklyReport(weekStart = null) {
    if (!weekStart) {
      const today = new Date();
      const dayOfWeek = today.getDay();
      weekStart = new Date(today);
      weekStart.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)); // Last Monday
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const leads = this.pipelineTracker._loadLeads();

    // Filter leads created/updated this week
    const weekLeads = leads.filter(l => {
      const created = new Date(l.createdAt);
      return created >= weekStart && created <= weekEnd;
    });

    const report = {
      reportType: 'weekly',
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),

      // Lead generation
      newLeads: weekLeads.length,
      newMQLs: weekLeads.filter(l => l.stage === LEAD_STAGE.MQL || l.stage === LEAD_STAGE.SQL || l.stage === LEAD_STAGE.OPPORTUNITY || l.stage === LEAD_STAGE.CLOSED_WON).length,
      newSQLs: weekLeads.filter(l => l.stage === LEAD_STAGE.SQL || l.stage === LEAD_STAGE.OPPORTUNITY || l.stage === LEAD_STAGE.CLOSED_WON).length,

      // Pipeline
      pipelineCreated: this._calculateWeeklyPipeline(weekLeads),
      closedWonRevenue: weekLeads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON).reduce((sum, l) => sum + (l.dealSize || 0), 0),

      // Campaign performance
      topCampaigns: this._getTopCampaigns(weekLeads, 5),

      // Overall health
      pipelineHealth: this.pipelineTracker.getPipelineHealth(),

      // YoY comparison
      yoyComparison: this._getYoYComparison(weekStart)
    };

    this._saveReport(report);
    return report;
  }

  /**
   * Generate monthly performance summary.
   * @param {number} [year]
   * @param {number} [month] - 0-indexed (0 = January)
   * @returns {Object} - Monthly report
   */
  generateMonthlyReport(year = null, month = null) {
    const now = new Date();
    year = year || now.getFullYear();
    month = month !== null ? month : now.getMonth();

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    const leads = this.pipelineTracker._loadLeads();

    // Filter leads from this month
    const monthLeads = leads.filter(l => {
      const created = new Date(l.createdAt);
      return created >= monthStart && created <= monthEnd;
    });

    const report = {
      reportType: 'monthly',
      year,
      month: monthStart.toLocaleString('default', { month: 'long' }),
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      generatedAt: new Date().toISOString(),

      // Lead metrics
      newLeads: monthLeads.length,
      newMQLs: monthLeads.filter(l => [LEAD_STAGE.MQL, LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      newSQLs: monthLeads.filter(l => [LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      newOpportunities: monthLeads.filter(l => [LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      closedWonDeals: monthLeads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON).length,

      // Revenue metrics
      pipelineCreated: this._calculateMonthlyPipeline(monthLeads),
      closedWonRevenue: monthLeads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON).reduce((sum, l) => sum + (l.dealSize || 0), 0),

      // Conversion rates
      conversionRates: this.pipelineTracker._calculateConversionRates(monthLeads),

      // Attribution
      attributionReport: this.attributionEngine.getAttributionReport(ATTRIBUTION_MODEL.U_SHAPED),

      // Top performers
      topCampaigns: this._getTopCampaigns(monthLeads, 10),

      // CAC
      averageCAC: this._calculateAverageCAC(monthLeads)
    };

    this._saveReport(report);
    return report;
  }

  /**
   * Generate revenue forecast.
   * @param {number} quarterCount - Number of quarters to forecast
   * @returns {Object} - Forecast
   */
  generateForecast(quarterCount = 4) {
    const health = this.pipelineTracker.getPipelineHealth();
    const leads = this.pipelineTracker._loadLeads();

    // Calculate historical win rate and velocity
    const won = leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON);
    const avgDealSize = won.length > 0
      ? won.reduce((sum, l) => sum + (l.dealSize || 0), 0) / won.length
      : 100000;

    const forecast = {
      generatedAt: new Date().toISOString(),
      quarters: []
    };

    for (let i = 1; i <= quarterCount; i++) {
      const quarterStart = new Date();
      quarterStart.setMonth(quarterStart.getMonth() + ((i - 1) * 3));

      forecast.quarters.push({
        quarter: `Q${i}`,
        startDate: quarterStart.toISOString(),
        currentPipeline: i === 1 ? health.pipelineValue : 0,
        forecastRevenue: health.forecastRevenue,
        expectedDeals: Math.round(health.forecastRevenue / avgDealSize),
        confidence: i === 1 ? 'high' : i === 2 ? 'medium' : 'low'
      });
    }

    return forecast;
  }

  /**
   * Get campaign leaderboard.
   * @param {number} [limit=10]
   * @returns {Object[]}
   */
  getCampaignLeaderboard(limit = 10) {
    const attributionReport = this.attributionEngine.getAttributionReport(ATTRIBUTION_MODEL.U_SHAPED);

    return attributionReport.topCampaigns.slice(0, limit).map((campaign, index) => ({
      rank: index + 1,
      campaignId: campaign.campaignId,
      revenue: Math.round(campaign.revenue),
      deals: campaign.deals,
      credit: Math.round(campaign.credit * 100) / 100,
      avgDealSize: campaign.deals > 0 ? Math.round(campaign.revenue / campaign.deals) : 0
    }));
  }

  /**
   * Calculate weekly pipeline created.
   * @private
   */
  _calculateWeeklyPipeline(weekLeads) {
    const opportunities = weekLeads.filter(l =>
      l.stage === LEAD_STAGE.OPPORTUNITY ||
      l.stage === LEAD_STAGE.CLOSED_WON
    );

    return {
      opportunities: opportunities.length,
      value: opportunities.reduce((sum, l) => sum + (l.dealSize || 0), 0)
    };
  }

  /**
   * Calculate monthly pipeline created.
   * @private
   */
  _calculateMonthlyPipeline(monthLeads) {
    const opportunities = monthLeads.filter(l =>
      l.stage === LEAD_STAGE.OPPORTUNITY ||
      l.stage === LEAD_STAGE.CLOSED_WON ||
      l.stage === LEAD_STAGE.CLOSED_LOST
    );

    return {
      opportunities: opportunities.length,
      value: opportunities.reduce((sum, l) => sum + (l.dealSize || 0), 0)
    };
  }

  /**
   * Get top performing campaigns.
   * @private
   */
  _getTopCampaigns(leads, limit) {
    const campaignStats = {};

    leads.forEach(lead => {
      const source = lead.source;
      if (!campaignStats[source]) {
        campaignStats[source] = {
          campaignId: source,
          leads: 0,
          mqls: 0,
          sqls: 0,
          opportunities: 0,
          revenue: 0
        };
      }

      campaignStats[source].leads++;
      if ([LEAD_STAGE.MQL, LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(lead.stage)) {
        campaignStats[source].mqls++;
      }
      if ([LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(lead.stage)) {
        campaignStats[source].sqls++;
      }
      if ([LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(lead.stage)) {
        campaignStats[source].opportunities++;
        campaignStats[source].revenue += (lead.dealSize || 0);
      }
    });

    return Object.values(campaignStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  /**
   * Get year-over-year comparison.
   * @private
   */
  _getYoYComparison(currentWeekStart) {
    const lastYearWeekStart = new Date(currentWeekStart);
    lastYearWeekStart.setFullYear(lastYearWeekStart.getFullYear() - 1);

    const lastYearWeekEnd = new Date(lastYearWeekStart);
    lastYearWeekEnd.setDate(lastYearWeekStart.getDate() + 6);

    const leads = this.pipelineTracker._loadLeads();
    const lastYearLeads = leads.filter(l => {
      const created = new Date(l.createdAt);
      return created >= lastYearWeekStart && created <= lastYearWeekEnd;
    });

    return {
      lastYearLeads: lastYearLeads.length,
      lastYearMQLs: lastYearLeads.filter(l => [LEAD_STAGE.MQL, LEAD_STAGE.SQL, LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).length,
      lastYearPipeline: lastYearLeads.filter(l => [LEAD_STAGE.OPPORTUNITY, LEAD_STAGE.CLOSED_WON].includes(l.stage)).reduce((sum, l) => sum + (l.dealSize || 0), 0)
    };
  }

  /**
   * Calculate average CAC from recent deals.
   * @private
   */
  _calculateAverageCAC(leads) {
    const won = leads.filter(l => l.stage === LEAD_STAGE.CLOSED_WON);
    if (won.length === 0) return 0;

    // Simplified CAC calculation (would need actual spend data)
    // Assuming $50 cost per lead as placeholder
    return 50 * (leads.length / won.length);
  }

  /**
   * Save report.
   * @private
   */
  _saveReport(report) {
    const reports = _lsGet(this._key) || [];
    reports.push(report);
    _lsSet(this._key, reports);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT — singleton on window, available to all pages and agents
   ───────────────────────────────────────────────────────────────────────────── */
window.RevenueEngine = {
  RevenuePlanner,
  PipelineTracker,
  AttributionEngine,
  SalesEnablementEngine,
  CampaignCalendar,
  ExecutiveDashboard,
  ATTRIBUTION_MODEL,
  LEAD_STAGE,
  CAMPAIGN_TYPE
};
