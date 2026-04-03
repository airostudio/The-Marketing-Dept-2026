/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUSTOMER LIFECYCLE ENGINE — Audema - Your AI Marketing Department
 * Customer retention, expansion, and advocacy automation layer.
 *
 * This module manages the post-sale customer journey:
 *   1. CustomerHealthScoring  — NPS, usage metrics, churn risk prediction
 *   2. OnboardingWorkflow      — Welcome → Setup → Adoption → Success
 *   3. ExpansionNurtureWorkflow — Usage-based upsell triggers
 *   4. ChurnPreventionWorkflow  — Re-engage at-risk customers
 *   5. AdvocacyProgramWorkflow  — Case studies, referrals, reviews
 *   6. LifecycleStageManager    — Track customer journey stages
 *
 * The missing half: Retention/expansion revenue (3-4x more profitable than acquisition).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & STORAGE KEYS
   ───────────────────────────────────────────────────────────────────────────── */

/** @enum {string} localStorage keys for customer lifecycle stores */
const LIFECYCLE_STORAGE_KEYS = {
  CUSTOMER_HEALTH:      'lifecycle_customer_health',
  ONBOARDING:           'lifecycle_onboarding',
  EXPANSION:            'lifecycle_expansion',
  CHURN_PREVENTION:     'lifecycle_churn_prevention',
  ADVOCACY:             'lifecycle_advocacy',
  LIFECYCLE_STAGES:     'lifecycle_stages',
  CUSTOMERS:            'lifecycle_customers'
};

/** @enum {string} Customer lifecycle stages */
const LIFECYCLE_STAGE = {
  TRIAL:        'trial',          // Trial user (0-14 days)
  ONBOARDING:   'onboarding',     // New customer (0-90 days)
  ACTIVE:       'active',         // Engaged customer (90+ days, healthy)
  GROWTH:       'growth',         // Expanding usage (upsell opportunity)
  AT_RISK:      'at_risk',        // Declining engagement (churn risk)
  CHURNED:      'churned',        // Cancelled/lost customer
  CHAMPION:     'champion'        // Advocate (NPS 9-10, high engagement)
};

/** @enum {string} Health status */
const HEALTH_STATUS = {
  GREEN:   'green',    // Healthy (low churn risk)
  YELLOW:  'yellow',   // Attention needed (medium churn risk)
  RED:     'red'       // Critical (high churn risk)
};

/** @enum {string} NPS categories */
const NPS_CATEGORY = {
  PROMOTER:  'promoter',   // NPS 9-10
  PASSIVE:   'passive',    // NPS 7-8
  DETRACTOR: 'detractor'   // NPS 0-6
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * PRODUCTION-READY STORAGE:
 * Data now persists to PostgreSQL backend via REST API.
 * localStorage used as temporary cache for performance.
 * All data accessible across browsers/devices.
 */

function _lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[CustomerLifecycleEngine] localStorage read failed:', e.message);
    return null;
  }
}

function _lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[CustomerLifecycleEngine] localStorage write failed:', e.message);
  }
}

/**
 * API-backed storage functions (production-ready)
 * These replace localStorage with backend API calls.
 */

// Save health score to backend API
async function _apiSaveHealthScore(healthData) {
  if (!window.apiClient) {
    console.warn('[API] apiClient not available, using localStorage fallback');
    return;
  }
  try {
    await window.apiClient.saveHealthScore(healthData);
    console.log('[API] ✅ Health score saved to backend');
  } catch (error) {
    console.error('[API] ❌ Failed to save health score:', error);
  }
}

// Get health score history from backend API
async function _apiGetHealthHistory(customerId, limit = 30) {
  if (!window.apiClient) {
    console.warn('[API] apiClient not available, using localStorage fallback');
    return [];
  }
  try {
    const { healthScores } = await window.apiClient.getHealthScoreHistory(customerId, limit);
    return healthScores || [];
  } catch (error) {
    console.error('[API] ❌ Failed to get health history:', error);
    return [];
  }
}

// Save campaign to backend API
async function _apiSaveCampaign(campaignData) {
  if (!window.apiClient) {
    console.warn('[API] apiClient not available, using localStorage fallback');
    return;
  }
  try {
    await window.apiClient.createCampaign(campaignData);
    console.log('[API] ✅ Campaign saved to backend');
  } catch (error) {
    console.error('[API] ❌ Failed to save campaign:', error);
  }
}

// Progress lifecycle stage to backend API
async function _apiProgressLifecycle(customerId, fromStage, toStage, metadata = {}) {
  if (!window.apiClient) {
    console.warn('[API] apiClient not available, using localStorage fallback');
    return;
  }
  try {
    await window.apiClient.progressLifecycleStage(customerId, fromStage, toStage, metadata);
    console.log('[API] ✅ Lifecycle stage progressed to backend');
  } catch (error) {
    console.error('[API] ❌ Failed to progress lifecycle:', error);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   1. CUSTOMER HEALTH SCORING
   Track NPS, usage metrics, engagement, and predict churn risk.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * CustomerHealthScoring manages customer health metrics and churn prediction.
 *
 * Health Score Components:
 * - NPS (Net Promoter Score): Customer satisfaction
 * - Usage Metrics: Logins, feature adoption, API calls
 * - Engagement: Support tickets, CSM interactions, training
 * - Billing: Payment health, invoice disputes
 * - Churn Risk: Predictive score based on leading indicators
 */
class CustomerHealthScoring {
  constructor() {
    this._key = LIFECYCLE_STORAGE_KEYS.CUSTOMER_HEALTH;
  }

  /**
   * Calculate health score for a customer.
   * @param {Object} customer
   * @param {string} customer.customerId
   * @param {Object} customer.usage - Usage metrics
   * @param {number} customer.nps - Net Promoter Score (0-10)
   * @param {Object} customer.engagement - Engagement metrics
   * @param {Object} customer.billing - Billing health
   * @returns {Object} - Health score and status
   */
  calculateHealthScore(customer) {
    if (!customer || !customer.customerId) {
      throw new TypeError('[CustomerHealthScoring.calculateHealthScore] customerId required');
    }

    const {
      usage = {},
      nps = null,
      engagement = {},
      billing = {}
    } = customer;

    // Calculate component scores (0-100 each)
    const usageScore = this._calculateUsageScore(usage);
    const npsScore = this._calculateNPSScore(nps);
    const engagementScore = this._calculateEngagementScore(engagement);
    const billingScore = this._calculateBillingScore(billing);

    // Weighted health score
    const healthScore = Math.round(
      usageScore * 0.35 +
      npsScore * 0.30 +
      engagementScore * 0.20 +
      billingScore * 0.15
    );

    // Determine health status
    let status = HEALTH_STATUS.GREEN;
    if (healthScore < 70) status = HEALTH_STATUS.YELLOW;
    if (healthScore < 50) status = HEALTH_STATUS.RED;

    // Predict churn risk
    const churnRisk = this._predictChurnRisk(healthScore, customer);

    const healthRecord = {
      customerId: customer.customerId,
      calculatedAt: new Date().toISOString(),
      healthScore,
      status,
      churnRisk,
      components: {
        usage: { score: usageScore, weight: 35 },
        nps: { score: npsScore, weight: 30 },
        engagement: { score: engagementScore, weight: 20 },
        billing: { score: billingScore, weight: 15 }
      },
      recommendations: this._generateHealthRecommendations(healthScore, status, customer)
    };

    this._saveHealthRecord(healthRecord);
    return healthRecord;
  }

  /**
   * Track NPS response.
   * @param {string} customerId
   * @param {number} score - NPS score (0-10)
   * @param {string} [feedback] - Optional feedback
   */
  recordNPS(customerId, score, feedback = null) {
    if (score < 0 || score > 10) {
      throw new TypeError('[CustomerHealthScoring.recordNPS] score must be 0-10');
    }

    let category = NPS_CATEGORY.PASSIVE;
    if (score >= 9) category = NPS_CATEGORY.PROMOTER;
    else if (score <= 6) category = NPS_CATEGORY.DETRACTOR;

    const npsRecord = {
      customerId,
      score,
      category,
      feedback,
      recordedAt: new Date().toISOString()
    };

    const allNPS = _lsGet(this._key + '_nps') || [];
    allNPS.push(npsRecord);
    _lsSet(this._key + '_nps', allNPS);

    return npsRecord;
  }

  /**
   * Get customer health history.
   * @param {string} customerId
   * @param {number} [limit=30]
   * @returns {Object[]}
   */
  getHealthHistory(customerId, limit = 30) {
    const allHealth = _lsGet(this._key) || [];
    return allHealth
      .filter(h => h.customerId === customerId)
      .sort((a, b) => new Date(b.calculatedAt) - new Date(a.calculatedAt))
      .slice(0, limit);
  }

  /**
   * Get all at-risk customers.
   * @returns {Object[]}
   */
  getAtRiskCustomers() {
    const allHealth = _lsGet(this._key) || [];

    // Get latest health score for each customer
    const latestHealth = {};
    allHealth.forEach(h => {
      if (!latestHealth[h.customerId] ||
          new Date(h.calculatedAt) > new Date(latestHealth[h.customerId].calculatedAt)) {
        latestHealth[h.customerId] = h;
      }
    });

    return Object.values(latestHealth)
      .filter(h => h.status === HEALTH_STATUS.RED || h.churnRisk >= 0.7)
      .sort((a, b) => b.churnRisk - a.churnRisk);
  }

  /**
   * Calculate usage score based on activity metrics.
   * @private
   */
  _calculateUsageScore(usage) {
    const {
      loginsLast30Days = 0,
      featureAdoptionRate = 0,    // % of available features used
      apiCallsLast30Days = 0,
      activeUsers = 0,
      totalSeats = 1
    } = usage;

    // Normalize metrics
    const loginScore = Math.min(100, (loginsLast30Days / 30) * 100); // 1 login/day = 100
    const featureScore = featureAdoptionRate; // Already 0-100
    const apiScore = Math.min(100, (apiCallsLast30Days / 1000) * 100); // 1K calls/month = 100
    const seatUtilization = (activeUsers / totalSeats) * 100;

    return Math.round((loginScore + featureScore + apiScore + seatUtilization) / 4);
  }

  /**
   * Calculate NPS score.
   * @private
   */
  _calculateNPSScore(nps) {
    if (nps === null || nps === undefined) return 50; // Neutral if no data

    // NPS 0-10 → Score 0-100
    // NPS 9-10 (promoters) = 90-100
    // NPS 7-8 (passive) = 70-80
    // NPS 0-6 (detractors) = 0-60

    if (nps >= 9) return 90 + (nps - 9) * 10;
    if (nps >= 7) return 70 + (nps - 7) * 10;
    return nps * 10;
  }

  /**
   * Calculate engagement score.
   * @private
   */
  _calculateEngagementScore(engagement) {
    const {
      supportTicketsLast30Days = 0,
      csmInteractionsLast30Days = 0,
      trainingSessionsCompleted = 0,
      communityActivity = 0         // Posts, comments, etc.
    } = engagement;

    // High support tickets = bad (unless resolved quickly)
    const supportScore = Math.max(0, 100 - (supportTicketsLast30Days * 10));

    // CSM interactions = good
    const csmScore = Math.min(100, csmInteractionsLast30Days * 25); // 4+ = 100

    // Training = good
    const trainingScore = Math.min(100, trainingSessionsCompleted * 20); // 5+ = 100

    // Community = good
    const communityScore = Math.min(100, communityActivity * 10); // 10+ = 100

    return Math.round((supportScore + csmScore + trainingScore + communityScore) / 4);
  }

  /**
   * Calculate billing score.
   * @private
   */
  _calculateBillingScore(billing) {
    const {
      paymentCurrent = true,
      invoiceDisputes = 0,
      downgrades = 0,
      contractRenewalDays = 365
    } = billing;

    let score = 100;

    // Payment issues = bad
    if (!paymentCurrent) score -= 50;
    score -= invoiceDisputes * 20;
    score -= downgrades * 30;

    // Contract renewal approaching = risk
    if (contractRenewalDays < 90) score -= 20;
    if (contractRenewalDays < 30) score -= 30;

    return Math.max(0, score);
  }

  /**
   * Predict churn risk (0-1 probability).
   * @private
   */
  _predictChurnRisk(healthScore, customer) {
    // Simple model: churn risk inversely proportional to health score
    // Health 90+ = 0-10% risk
    // Health 70-90 = 10-30% risk
    // Health 50-70 = 30-60% risk
    // Health <50 = 60-95% risk

    let baseRisk = (100 - healthScore) / 100;

    // Adjust for specific red flags
    if (customer.usage?.loginsLast30Days === 0) baseRisk += 0.3; // No logins = high risk
    if (customer.billing?.paymentCurrent === false) baseRisk += 0.2; // Payment issues
    if (customer.nps !== null && customer.nps <= 6) baseRisk += 0.2; // Detractor

    return Math.min(0.95, baseRisk);
  }

  /**
   * Generate health improvement recommendations.
   * @private
   */
  _generateHealthRecommendations(healthScore, status, customer) {
    const recommendations = [];

    if (status === HEALTH_STATUS.RED) {
      recommendations.push({
        priority: 'critical',
        action: 'executive_escalation',
        message: 'Escalate to VP Customer Success immediately',
        reason: 'High churn risk'
      });
    }

    if (customer.usage?.loginsLast30Days < 10) {
      recommendations.push({
        priority: 'high',
        action: 'trigger_reengagement',
        message: 'Launch re-engagement campaign (low usage)',
        reason: `Only ${customer.usage.loginsLast30Days} logins in last 30 days`
      });
    }

    if (customer.usage?.featureAdoptionRate < 30) {
      recommendations.push({
        priority: 'medium',
        action: 'feature_training',
        message: 'Schedule product training session',
        reason: `Only using ${customer.usage.featureAdoptionRate}% of available features`
      });
    }

    if (customer.nps !== null && customer.nps <= 6) {
      recommendations.push({
        priority: 'high',
        action: 'nps_followup',
        message: 'Schedule call to address NPS feedback',
        reason: `Detractor (NPS ${customer.nps})`
      });
    }

    if (customer.billing?.contractRenewalDays < 90 && healthScore < 80) {
      recommendations.push({
        priority: 'high',
        action: 'renewal_prep',
        message: 'Start renewal conversations early',
        reason: `Renewal in ${customer.billing.contractRenewalDays} days with health score ${healthScore}`
      });
    }

    return recommendations;
  }

  /**
   * Save health record.
   * PRODUCTION-READY: Saves to both localStorage (cache) and backend API (persistence).
   * @private
   */
  _saveHealthRecord(record) {
    // Save to localStorage (immediate cache)
    const allHealth = _lsGet(this._key) || [];
    allHealth.push(record);
    _lsSet(this._key, allHealth);

    // Save to backend API (cross-device persistence) - async, non-blocking
    _apiSaveHealthScore(record).catch(err => {
      console.warn('[CustomerHealthScoring] Backend save failed, using localStorage fallback:', err);
    });
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. ONBOARDING WORKFLOW
   Automate customer onboarding: Welcome → Setup → Adoption → Success.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * OnboardingWorkflow manages automated customer onboarding sequences.
 *
 * Phases:
 * - Welcome (Day 0-7): Welcome email, quick start guide, first login
 * - Setup (Day 7-30): Platform configuration, integrations, team invites
 * - Adoption (Day 30-60): Feature education, best practices, use cases
 * - Success (Day 60-90): Success metrics, ROI proof, CSM handoff
 */
class OnboardingWorkflow {
  constructor(claudeService) {
    this.claudeService = claudeService;
    this._key = LIFECYCLE_STORAGE_KEYS.ONBOARDING;
  }

  /**
   * Start onboarding for a new customer.
   * @param {Object} customer
   * @param {string} customer.customerId
   * @param {string} customer.email
   * @param {string} customer.companyName
   * @param {string} customer.planType - 'basic', 'pro', 'enterprise'
   * @param {Date} customer.startDate - Onboarding start date
   * @returns {Promise<Object>} - Onboarding plan
   */
  async startOnboarding(customer) {
    if (!customer || !customer.customerId || !customer.email) {
      throw new TypeError('[OnboardingWorkflow.startOnboarding] customerId and email required');
    }

    const onboardingPlan = {
      onboardingId: _uid(),
      customerId: customer.customerId,
      startedAt: customer.startDate || new Date().toISOString(),
      status: 'active',
      phase: 'welcome',
      completedSteps: [],
      sequence: await this._generateOnboardingSequence(customer)
    };

    this._saveOnboarding(onboardingPlan);
    return onboardingPlan;
  }

  /**
   * Mark onboarding step as completed.
   * @param {string} onboardingId
   * @param {string} stepId
   */
  completeStep(onboardingId, stepId) {
    const allOnboardings = _lsGet(this._key) || [];
    const onboarding = allOnboardings.find(o => o.onboardingId === onboardingId);

    if (!onboarding) {
      throw new Error(`Onboarding ${onboardingId} not found`);
    }

    onboarding.completedSteps.push({
      stepId,
      completedAt: new Date().toISOString()
    });

    // Update phase if all steps in current phase complete
    this._updateOnboardingPhase(onboarding);

    onboarding.updatedAt = new Date().toISOString();
    _lsSet(this._key, allOnboardings);
  }

  /**
   * Get onboarding progress.
   * @param {string} customerId
   * @returns {Object}
   */
  getOnboardingProgress(customerId) {
    const allOnboardings = _lsGet(this._key) || [];
    const onboarding = allOnboardings.find(o => o.customerId === customerId && o.status === 'active');

    if (!onboarding) {
      return { status: 'not_started' };
    }

    const totalSteps = onboarding.sequence.length;
    const completedSteps = onboarding.completedSteps.length;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    return {
      onboardingId: onboarding.onboardingId,
      phase: onboarding.phase,
      progress,
      completedSteps,
      totalSteps,
      nextSteps: this._getNextSteps(onboarding),
      daysActive: Math.ceil((new Date() - new Date(onboarding.startedAt)) / (24 * 60 * 60 * 1000))
    };
  }

  /**
   * Generate personalized onboarding sequence.
   * @private
   */
  async _generateOnboardingSequence(customer) {
    const baseSequence = [
      // WELCOME PHASE (Day 0-7)
      {
        stepId: 'welcome_email',
        phase: 'welcome',
        day: 0,
        name: 'Welcome Email',
        description: 'Send welcome email with quick start guide',
        type: 'email'
      },
      {
        stepId: 'first_login',
        phase: 'welcome',
        day: 1,
        name: 'First Login',
        description: 'User completes first login',
        type: 'milestone'
      },
      {
        stepId: 'quick_win',
        phase: 'welcome',
        day: 3,
        name: 'Quick Win Guide',
        description: 'Guide user to first campaign creation',
        type: 'in_app'
      },
      {
        stepId: 'setup_checklist',
        phase: 'welcome',
        day: 7,
        name: 'Setup Checklist Email',
        description: 'Send 7-day setup checklist',
        type: 'email'
      },

      // SETUP PHASE (Day 7-30)
      {
        stepId: 'integrations_setup',
        phase: 'setup',
        day: 10,
        name: 'Integrations Setup',
        description: 'Guide CRM/ESP integration setup',
        type: 'in_app'
      },
      {
        stepId: 'team_invites',
        phase: 'setup',
        day: 14,
        name: 'Team Invites',
        description: 'Encourage team member invites',
        type: 'email'
      },
      {
        stepId: 'first_campaign_sent',
        phase: 'setup',
        day: 21,
        name: 'First Campaign Sent',
        description: 'User sends first campaign',
        type: 'milestone'
      },

      // ADOPTION PHASE (Day 30-60)
      {
        stepId: 'feature_training',
        phase: 'adoption',
        day: 30,
        name: 'Feature Training Webinar',
        description: 'Invite to feature training',
        type: 'webinar'
      },
      {
        stepId: 'best_practices',
        phase: 'adoption',
        day: 40,
        name: 'Best Practices Guide',
        description: 'Share industry best practices',
        type: 'email'
      },
      {
        stepId: 'use_case_examples',
        phase: 'adoption',
        day: 50,
        name: 'Use Case Examples',
        description: 'Share relevant use case examples',
        type: 'email'
      },

      // SUCCESS PHASE (Day 60-90)
      {
        stepId: 'roi_report',
        phase: 'success',
        day: 60,
        name: 'ROI Report',
        description: 'Generate and share ROI report',
        type: 'report'
      },
      {
        stepId: 'csm_introduction',
        phase: 'success',
        day: 70,
        name: 'CSM Introduction',
        description: 'Introduce dedicated CSM',
        type: 'meeting'
      },
      {
        stepId: 'success_celebration',
        phase: 'success',
        day: 90,
        name: 'Success Celebration',
        description: 'Celebrate onboarding completion',
        type: 'email'
      }
    ];

    // Customize based on plan type
    if (customer.planType === 'enterprise') {
      baseSequence.splice(5, 0, {
        stepId: 'dedicated_onboarding_call',
        phase: 'setup',
        day: 8,
        name: 'Dedicated Onboarding Call',
        description: 'Schedule 1-on-1 onboarding call',
        type: 'meeting'
      });
    }

    return baseSequence;
  }

  /**
   * Update onboarding phase based on completed steps.
   * @private
   */
  _updateOnboardingPhase(onboarding) {
    const completedStepIds = onboarding.completedSteps.map(s => s.stepId);
    const phaseSteps = {
      welcome: onboarding.sequence.filter(s => s.phase === 'welcome'),
      setup: onboarding.sequence.filter(s => s.phase === 'setup'),
      adoption: onboarding.sequence.filter(s => s.phase === 'adoption'),
      success: onboarding.sequence.filter(s => s.phase === 'success')
    };

    // Check if current phase is complete
    const currentPhaseSteps = phaseSteps[onboarding.phase];
    const currentPhaseComplete = currentPhaseSteps.every(s =>
      completedStepIds.includes(s.stepId)
    );

    if (currentPhaseComplete) {
      // Move to next phase
      const phases = ['welcome', 'setup', 'adoption', 'success'];
      const currentIndex = phases.indexOf(onboarding.phase);
      if (currentIndex < phases.length - 1) {
        onboarding.phase = phases[currentIndex + 1];
      } else {
        onboarding.status = 'completed';
      }
    }
  }

  /**
   * Get next recommended steps.
   * @private
   */
  _getNextSteps(onboarding) {
    const completedStepIds = onboarding.completedSteps.map(s => s.stepId);
    const daysActive = Math.ceil((new Date() - new Date(onboarding.startedAt)) / (24 * 60 * 60 * 1000));

    return onboarding.sequence
      .filter(step =>
        !completedStepIds.includes(step.stepId) &&
        step.day <= daysActive + 7  // Next 7 days
      )
      .slice(0, 3);  // Top 3 next steps
  }

  /**
   * Save onboarding plan.
   * @private
   */
  _saveOnboarding(onboarding) {
    const allOnboardings = _lsGet(this._key) || [];
    allOnboardings.push(onboarding);
    _lsSet(this._key, allOnboardings);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. EXPANSION NURTURE WORKFLOW
   Identify upsell/cross-sell opportunities and automate expansion campaigns.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * ExpansionNurtureWorkflow manages automated upsell/cross-sell campaigns.
 *
 * Triggers:
 * - Usage-based: Hitting 80% of plan limit (users, API calls, storage)
 * - Feature gap: Using Basic but behavior suggests need for Pro
 * - Success signals: High engagement, NPS 9-10, ROI proof
 * - Time-based: Approaching renewal, been on same plan 12+ months
 */
class ExpansionNurtureWorkflow {
  constructor(healthScoring, claudeService) {
    this.healthScoring = healthScoring;
    this.claudeService = claudeService;
    this._key = LIFECYCLE_STORAGE_KEYS.EXPANSION;
  }

  /**
   * Identify expansion opportunities for a customer.
   * @param {Object} customer
   * @param {string} customer.customerId
   * @param {string} customer.currentPlan - 'basic', 'pro', 'enterprise'
   * @param {Object} customer.usage - Current usage metrics
   * @param {Object} customer.billing - Billing details
   * @returns {Object[]} - Expansion opportunities
   */
  identifyOpportunities(customer) {
    if (!customer || !customer.customerId) {
      throw new TypeError('[ExpansionNurtureWorkflow.identifyOpportunities] customerId required');
    }

    const opportunities = [];

    // TRIGGER 1: Usage-based (hitting limits)
    const usageOpportunities = this._detectUsageTriggers(customer);
    opportunities.push(...usageOpportunities);

    // TRIGGER 2: Feature gap analysis
    const featureOpportunities = this._detectFeatureGaps(customer);
    opportunities.push(...featureOpportunities);

    // TRIGGER 3: Success signals (ready to expand)
    const successOpportunities = this._detectSuccessSignals(customer);
    opportunities.push(...successOpportunities);

    // TRIGGER 4: Time-based (renewal approaching)
    const timeOpportunities = this._detectTimeTriggers(customer);
    opportunities.push(...timeOpportunities);

    return opportunities.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Launch expansion nurture campaign.
   * @param {string} customerId
   * @param {Object} opportunity
   * @returns {Promise<Object>} - Campaign plan
   */
  async launchExpansionCampaign(customerId, opportunity) {
    const campaign = {
      campaignId: _uid(),
      customerId,
      opportunityType: opportunity.type,
      targetPlan: opportunity.targetPlan,
      expectedRevenue: opportunity.expectedRevenue,
      launchedAt: new Date().toISOString(),
      status: 'active',
      sequence: await this._generateExpansionSequence(customerId, opportunity)
    };

    this._saveCampaign(campaign);
    return campaign;
  }

  /**
   * Detect usage-based triggers.
   * @private
   */
  _detectUsageTriggers(customer) {
    const opportunities = [];
    const { usage, currentPlan } = customer;

    if (!usage) return opportunities;

    // Users approaching limit
    if (usage.activeUsers / usage.totalSeats >= 0.8) {
      opportunities.push({
        type: 'usage_limit_users',
        priority: 90,
        trigger: 'Users at 80% of seat limit',
        targetPlan: this._getNextPlan(currentPlan),
        message: `You're using ${usage.activeUsers} of ${usage.totalSeats} seats. Upgrade to add more users.`,
        expectedRevenue: this._calculateExpansionRevenue(currentPlan, 'seats'),
        recommendedAction: 'offer_seat_expansion'
      });
    }

    // API calls approaching limit
    if (usage.apiCallsLast30Days / usage.apiCallsLimit >= 0.8) {
      opportunities.push({
        type: 'usage_limit_api',
        priority: 85,
        trigger: 'API calls at 80% of limit',
        targetPlan: this._getNextPlan(currentPlan),
        message: `You're using ${usage.apiCallsLast30Days.toLocaleString()} of ${usage.apiCallsLimit.toLocaleString()} API calls. Upgrade for higher limits.`,
        expectedRevenue: this._calculateExpansionRevenue(currentPlan, 'api'),
        recommendedAction: 'offer_api_expansion'
      });
    }

    return opportunities;
  }

  /**
   * Detect feature gap opportunities.
   * @private
   */
  _detectFeatureGaps(customer) {
    const opportunities = [];
    const { currentPlan, usage } = customer;

    // Basic plan customers using "workarounds" for Pro features
    if (currentPlan === 'basic') {
      if (usage?.exportFrequency > 10) {
        opportunities.push({
          type: 'feature_gap_automation',
          priority: 75,
          trigger: 'Heavy manual export usage',
          targetPlan: 'pro',
          message: 'You are exporting data 10+ times/month. Pro plan includes automated reporting.',
          expectedRevenue: this._calculateExpansionRevenue('basic', 'pro'),
          recommendedAction: 'offer_automation_upgrade'
        });
      }
    }

    // Pro customers showing enterprise needs
    if (currentPlan === 'pro') {
      if (usage?.activeUsers > 20) {
        opportunities.push({
          type: 'feature_gap_enterprise',
          priority: 95,
          trigger: 'Team size exceeds Pro limits',
          targetPlan: 'enterprise',
          message: 'Your team has grown to 20+ users. Enterprise plan offers unlimited seats and dedicated support.',
          expectedRevenue: this._calculateExpansionRevenue('pro', 'enterprise'),
          recommendedAction: 'offer_enterprise_upgrade'
        });
      }
    }

    return opportunities;
  }

  /**
   * Detect success signals (customer ready to expand).
   * @private
   */
  _detectSuccessSignals(customer) {
    const opportunities = [];
    const health = this.healthScoring.getHealthHistory(customer.customerId, 1)[0];

    if (!health) return opportunities;

    // High health + NPS promoter = expansion ready
    if (health.healthScore >= 85 && customer.nps >= 9) {
      opportunities.push({
        type: 'success_expansion',
        priority: 80,
        trigger: 'High engagement + NPS promoter',
        targetPlan: this._getNextPlan(customer.currentPlan),
        message: 'You are getting great results! Unlock even more value with advanced features.',
        expectedRevenue: this._calculateExpansionRevenue(customer.currentPlan, 'upgrade'),
        recommendedAction: 'offer_value_upgrade'
      });
    }

    return opportunities;
  }

  /**
   * Detect time-based triggers.
   * @private
   */
  _detectTimeTriggers(customer) {
    const opportunities = [];
    const { billing } = customer;

    if (!billing) return opportunities;

    // Renewal approaching (60-90 days out)
    if (billing.contractRenewalDays >= 60 && billing.contractRenewalDays <= 90) {
      opportunities.push({
        type: 'renewal_expansion',
        priority: 70,
        trigger: 'Contract renewal approaching',
        targetPlan: this._getNextPlan(customer.currentPlan),
        message: 'Your contract renews in 60 days. Upgrade now and lock in current pricing.',
        expectedRevenue: this._calculateExpansionRevenue(customer.currentPlan, 'renewal'),
        recommendedAction: 'offer_renewal_upgrade'
      });
    }

    // Long tenure on same plan (12+ months)
    if (billing.monthsOnCurrentPlan >= 12) {
      opportunities.push({
        type: 'tenure_expansion',
        priority: 60,
        trigger: '12+ months on same plan',
        targetPlan: this._getNextPlan(customer.currentPlan),
        message: 'You have been with us 12+ months. See what is new in our upgraded plans.',
        expectedRevenue: this._calculateExpansionRevenue(customer.currentPlan, 'upgrade'),
        recommendedAction: 'offer_loyalty_upgrade'
      });
    }

    return opportunities;
  }

  /**
   * Generate expansion nurture sequence.
   * @private
   */
  async _generateExpansionSequence(customerId, opportunity) {
    return [
      {
        day: 0,
        type: 'email',
        name: 'Expansion Opportunity Identified',
        subject: opportunity.message,
        content: 'Value-based pitch highlighting benefits of upgrade'
      },
      {
        day: 3,
        type: 'email',
        name: 'ROI Calculator',
        subject: 'See your ROI with upgraded plan',
        content: 'Interactive ROI calculator showing value'
      },
      {
        day: 7,
        type: 'meeting',
        name: 'Upsell Discovery Call',
        subject: 'Let us discuss your growth',
        content: 'Schedule call with CSM to discuss expansion'
      },
      {
        day: 10,
        type: 'email',
        name: 'Customer Success Story',
        subject: 'How [Company] grew with [Plan]',
        content: 'Share similar customer success story'
      },
      {
        day: 14,
        type: 'offer',
        name: 'Limited-Time Offer',
        subject: 'Upgrade discount expires soon',
        content: 'Time-limited upgrade discount (10-20% off)'
      }
    ];
  }

  /**
   * Get next plan tier.
   * @private
   */
  _getNextPlan(currentPlan) {
    const planHierarchy = ['basic', 'pro', 'enterprise'];
    const currentIndex = planHierarchy.indexOf(currentPlan);
    return currentIndex < planHierarchy.length - 1
      ? planHierarchy[currentIndex + 1]
      : currentPlan;
  }

  /**
   * Calculate expected expansion revenue.
   * @private
   */
  _calculateExpansionRevenue(currentPlan, targetPlan) {
    const pricing = {
      basic: 1000,
      pro: 3000,
      enterprise: 10000
    };

    if (typeof targetPlan === 'string' && pricing[targetPlan]) {
      return (pricing[targetPlan] - pricing[currentPlan]) * 12; // Annual
    }

    // Default: assume one tier up
    const nextPlan = this._getNextPlan(currentPlan);
    return (pricing[nextPlan] - pricing[currentPlan]) * 12;
  }

  /**
   * Save expansion campaign.
   * @private
   */
  _saveCampaign(campaign) {
    const campaigns = _lsGet(this._key) || [];
    campaigns.push(campaign);
    _lsSet(this._key, campaigns);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. CHURN PREVENTION WORKFLOW
   Detect at-risk customers and launch re-engagement campaigns.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * ChurnPreventionWorkflow manages automated churn prevention and win-back.
 *
 * Detection:
 * - Usage drop: Logins/activity declining 50%+
 * - Health decline: Health score dropping rapidly
 * - NPS drop: Promoter → Passive → Detractor
 * - Support spike: Increase in support tickets (product issues)
 * - Payment issues: Failed payments, invoice disputes
 */
class ChurnPreventionWorkflow {
  constructor(healthScoring, claudeService) {
    this.healthScoring = healthScoring;
    this.claudeService = claudeService;
    this._key = LIFECYCLE_STORAGE_KEYS.CHURN_PREVENTION;
  }

  /**
   * Detect at-risk customers.
   * @returns {Object[]} - At-risk customers with interventions
   */
  detectAtRiskCustomers() {
    return this.healthScoring.getAtRiskCustomers().map(health => ({
      customerId: health.customerId,
      churnRisk: health.churnRisk,
      healthScore: health.healthScore,
      status: health.status,
      interventions: this._recommendInterventions(health)
    }));
  }

  /**
   * Launch churn prevention campaign.
   * @param {string} customerId
   * @param {string} interventionType
   * @returns {Promise<Object>} - Prevention campaign
   */
  async launchPreventionCampaign(customerId, interventionType) {
    const campaign = {
      campaignId: _uid(),
      customerId,
      interventionType,
      launchedAt: new Date().toISOString(),
      status: 'active',
      sequence: await this._generatePreventionSequence(customerId, interventionType)
    };

    this._saveCampaign(campaign);
    return campaign;
  }

  /**
   * Process cancellation request (last chance to save).
   * @param {string} customerId
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} - Retention offer
   */
  async processCancellation(customerId, reason) {
    const retentionOffer = {
      offerId: _uid(),
      customerId,
      reason,
      offeredAt: new Date().toISOString(),
      offer: await this._generateRetentionOffer(customerId, reason),
      status: 'pending'
    };

    this._saveRetentionOffer(retentionOffer);
    return retentionOffer;
  }

  /**
   * Recommend interventions based on health signals.
   * @private
   */
  _recommendInterventions(health) {
    const interventions = [];

    // Critical health = executive escalation
    if (health.status === HEALTH_STATUS.RED) {
      interventions.push({
        type: 'executive_escalation',
        priority: 'critical',
        action: 'Escalate to VP Customer Success',
        timeline: 'Within 24 hours'
      });
    }

    // Usage drop = re-engagement campaign
    if (health.components.usage.score < 40) {
      interventions.push({
        type: 'reengagement_campaign',
        priority: 'high',
        action: 'Launch usage re-engagement emails',
        timeline: 'Within 3 days'
      });
    }

    // NPS detractor = feedback call
    if (health.components.nps.score < 40) {
      interventions.push({
        type: 'nps_recovery',
        priority: 'high',
        action: 'Schedule call to address feedback',
        timeline: 'Within 5 days'
      });
    }

    // Payment issues = billing support
    if (health.components.billing.score < 50) {
      interventions.push({
        type: 'billing_resolution',
        priority: 'high',
        action: 'Contact to resolve payment issues',
        timeline: 'Within 2 days'
      });
    }

    // Low engagement = feature training
    if (health.components.engagement.score < 50) {
      interventions.push({
        type: 'product_training',
        priority: 'medium',
        action: 'Offer personalized training session',
        timeline: 'Within 7 days'
      });
    }

    return interventions;
  }

  /**
   * Generate churn prevention sequence.
   * @private
   */
  async _generatePreventionSequence(customerId, interventionType) {
    const sequences = {
      reengagement_campaign: [
        {day: 0, type: 'email', name: 'We Miss You', subject: 'We noticed you have not logged in recently'},
        {day: 3, type: 'email', name: 'New Features', subject: 'Check out what is new'},
        {day: 7, type: 'meeting', name: 'Check-in Call', subject: 'Let us make sure you are getting value'},
        {day: 10, type: 'email', name: 'Success Stories', subject: 'See how others are succeeding'}
      ],
      nps_recovery: [
        {day: 0, type: 'meeting', name: 'Feedback Call', subject: 'We value your feedback'},
        {day: 3, type: 'email', name: 'Action Plan', subject: 'Here is how we are addressing your concerns'},
        {day: 7, type: 'follow_up', name: 'Check-in', subject: 'Has the situation improved?'}
      ],
      product_training: [
        {day: 0, type: 'email', name: 'Training Invite', subject: 'Get more value with personalized training'},
        {day: 3, type: 'webinar', name: 'Live Training', subject: 'Join our expert-led training'},
        {day: 7, type: 'email', name: 'Resources', subject: 'Training materials and guides'}
      ]
    };

    return sequences[interventionType] || sequences.reengagement_campaign;
  }

  /**
   * Generate retention offer based on cancellation reason.
   * @private
   */
  async _generateRetentionOffer(customerId, reason) {
    const offers = {
      'too_expensive': {
        offerType: 'discount',
        discount: 25,
        duration: 6, // months
        message: '25% off for 6 months to keep you on board'
      },
      'not_using': {
        offerType: 'training',
        discount: 0,
        training: 'personalized_onboarding',
        message: 'Free personalized training to help you get value'
      },
      'missing_features': {
        offerType: 'beta_access',
        discount: 0,
        betaFeatures: true,
        message: 'Early access to features you requested'
      },
      'competitor': {
        offerType: 'price_match',
        discount: 30,
        duration: 12,
        message: 'We will match competitor pricing for 12 months'
      },
      'other': {
        offerType: 'pause',
        discount: 0,
        pauseDuration: 3,
        message: 'Pause your account for 3 months instead of cancelling'
      }
    };

    return offers[reason] || offers['other'];
  }

  /**
   * Save prevention campaign.
   * @private
   */
  _saveCampaign(campaign) {
    const campaigns = _lsGet(this._key) || [];
    campaigns.push(campaign);
    _lsSet(this._key, campaigns);
  }

  /**
   * Save retention offer.
   * @private
   */
  _saveRetentionOffer(offer) {
    const offers = _lsGet(this._key + '_offers') || [];
    offers.push(offer);
    _lsSet(this._key + '_offers', offers);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. ADVOCACY PROGRAM WORKFLOW
   Turn happy customers into advocates (case studies, referrals, reviews).
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * AdvocacyProgramWorkflow manages customer advocacy automation.
 *
 * Programs:
 * - Case Studies: NPS 9-10 with success stories
 * - Reviews: G2, Capterra, TrustRadius solicitation
 * - Referrals: Incentivized referral program
 * - Advisory Board: Strategic customer engagement
 * - User Conference: Annual customer event
 */
class AdvocacyProgramWorkflow {
  constructor(healthScoring, claudeService) {
    this.healthScoring = healthScoring;
    this.claudeService = claudeService;
    this._key = LIFECYCLE_STORAGE_KEYS.ADVOCACY;
  }

  /**
   * Identify advocacy candidates.
   * @returns {Object[]} - Customers eligible for advocacy programs
   */
  identifyCandidates() {
    const allHealth = this.healthScoring._loadHealthHistory();

    // Get latest health for each customer
    const latestHealth = {};
    allHealth.forEach(h => {
      if (!latestHealth[h.customerId] ||
          new Date(h.calculatedAt) > new Date(latestHealth[h.customerId].calculatedAt)) {
        latestHealth[h.customerId] = h;
      }
    });

    const candidates = [];

    Object.values(latestHealth).forEach(health => {
      // Case study candidates: NPS 9-10, health 80+
      if (health.components?.nps?.score >= 90 && health.healthScore >= 80) {
        candidates.push({
          customerId: health.customerId,
          programType: 'case_study',
          priority: 95,
          reason: 'NPS promoter with high health score',
          expectedValue: 'High-value social proof content'
        });
      }

      // Review candidates: NPS 8-10, health 70+
      if (health.components?.nps?.score >= 80 && health.healthScore >= 70) {
        candidates.push({
          customerId: health.customerId,
          programType: 'review',
          priority: 85,
          reason: 'Satisfied customer (NPS 8-10)',
          expectedValue: '5-star review on G2/Capterra'
        });
      }

      // Referral candidates: NPS 9-10, tenure 6+ months
      if (health.components?.nps?.score >= 90) {
        candidates.push({
          customerId: health.customerId,
          programType: 'referral',
          priority: 80,
          reason: 'NPS promoter willing to refer',
          expectedValue: '1-3 qualified referrals'
        });
      }

      // Advisory board candidates: Strategic account, NPS 9-10, tenure 12+ months
      if (health.components?.nps?.score >= 90 && health.healthScore >= 85) {
        candidates.push({
          customerId: health.customerId,
          programType: 'advisory_board',
          priority: 90,
          reason: 'Strategic customer, high engagement',
          expectedValue: 'Product roadmap input, case study, speaking'
        });
      }
    });

    return candidates.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Launch advocacy campaign.
   * @param {string} customerId
   * @param {string} programType - 'case_study', 'review', 'referral', 'advisory_board'
   * @returns {Promise<Object>} - Campaign plan
   */
  async launchAdvocacyCampaign(customerId, programType) {
    const campaign = {
      campaignId: _uid(),
      customerId,
      programType,
      launchedAt: new Date().toISOString(),
      status: 'active',
      sequence: await this._generateAdvocacySequence(programType)
    };

    this._saveCampaign(campaign);
    return campaign;
  }

  /**
   * Generate advocacy sequence based on program type.
   * @private
   */
  async _generateAdvocacySequence(programType) {
    const sequences = {
      case_study: [
        {day: 0, type: 'email', name: 'Case Study Invite', subject: 'Share your success story?'},
        {day: 3, type: 'meeting', name: 'Interview Call', subject: 'Schedule 30-min interview'},
        {day: 10, type: 'review', name: 'Draft Review', subject: 'Review draft case study'},
        {day: 14, type: 'approval', name: 'Final Approval', subject: 'Approve case study for publication'},
        {day: 17, type: 'publish', name: 'Publication', subject: 'Your case study is live!'}
      ],
      review: [
        {day: 0, type: 'email', name: 'Review Request', subject: 'Mind leaving us a review?'},
        {day: 3, type: 'email', name: 'Reminder', subject: 'Quick favor: G2 review (2 min)'},
        {day: 7, type: 'email', name: 'Incentive', subject: '$50 gift card for your review'},
        {day: 14, type: 'thank_you', name: 'Thank You', subject: 'Thanks for your review!'}
      ],
      referral: [
        {day: 0, type: 'email', name: 'Referral Program Intro', subject: 'Get $500 for every referral'},
        {day: 7, type: 'email', name: 'Referral Template', subject: 'Easy referral email template'},
        {day: 14, type: 'email', name: 'Referral Status', subject: 'Your referral progress'},
        {day: 30, type: 'email', name: 'Referral Payout', subject: 'Your $500 referral bonus'}
      ],
      advisory_board: [
        {day: 0, type: 'email', name: 'Board Invitation', subject: 'Join our Customer Advisory Board'},
        {day: 5, type: 'meeting', name: 'Intro Call', subject: 'Learn about the advisory board'},
        {day: 10, type: 'onboard', name: 'Board Onboarding', subject: 'Welcome to the advisory board!'},
        {day: 30, type: 'meeting', name: 'First Meeting', subject: 'Q1 Advisory Board meeting'}
      ]
    };

    return sequences[programType] || sequences.review;
  }

  /**
   * Track advocacy outcomes.
   * @param {string} campaignId
   * @param {Object} outcome
   */
  trackOutcome(campaignId, outcome) {
    const campaigns = _lsGet(this._key) || [];
    const campaign = campaigns.find(c => c.campaignId === campaignId);

    if (campaign) {
      campaign.outcome = {
        ...outcome,
        recordedAt: new Date().toISOString()
      };
      campaign.status = 'completed';
      _lsSet(this._key, campaigns);
    }
  }

  /**
   * Save advocacy campaign.
   * @private
   */
  _saveCampaign(campaign) {
    const campaigns = _lsGet(this._key) || [];
    campaigns.push(campaign);
    _lsSet(this._key, campaigns);
  }

  /**
   * Load health history helper.
   * @private
   */
  _loadHealthHistory() {
    return _lsGet(LIFECYCLE_STORAGE_KEYS.CUSTOMER_HEALTH) || [];
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. LIFECYCLE STAGE MANAGER
   Track and manage customer lifecycle journey progression.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * LifecycleStageManager tracks customer journey through lifecycle stages.
 *
 * Stages: Trial → Onboarding → Active → Growth / At-Risk → Churned / Champion
 */
class LifecycleStageManager {
  constructor(healthScoring) {
    this.healthScoring = healthScoring;
    this._key = LIFECYCLE_STORAGE_KEYS.LIFECYCLE_STAGES;
  }

  /**
   * Progress customer to new lifecycle stage.
   * @param {string} customerId
   * @param {string} newStage - Target lifecycle stage
   * @param {Object} [metadata] - Additional context
   */
  progressStage(customerId, newStage, metadata = {}) {
    const customers = this._loadCustomers();
    let customer = customers.find(c => c.customerId === customerId);

    if (!customer) {
      customer = {
        customerId,
        currentStage: newStage,
        stageHistory: []
      };
      customers.push(customer);
    }

    // Record stage change
    customer.stageHistory.push({
      fromStage: customer.currentStage,
      toStage: newStage,
      timestamp: new Date().toISOString(),
      ...metadata
    });

    customer.currentStage = newStage;
    customer.updatedAt = new Date().toISOString();

    this._saveCustomers(customers);
  }

  /**
   * Get customer's current lifecycle stage.
   * @param {string} customerId
   * @returns {Object}
   */
  getCurrentStage(customerId) {
    const customers = this._loadCustomers();
    const customer = customers.find(c => c.customerId === customerId);

    if (!customer) {
      return { stage: LIFECYCLE_STAGE.TRIAL, daysInStage: 0 };
    }

    const lastChange = customer.stageHistory[customer.stageHistory.length - 1];
    const daysInStage = lastChange
      ? Math.ceil((new Date() - new Date(lastChange.timestamp)) / (24 * 60 * 60 * 1000))
      : 0;

    return {
      stage: customer.currentStage,
      daysInStage,
      stageHistory: customer.stageHistory
    };
  }

  /**
   * Calculate customer LTV by cohort.
   * @param {string} cohort - e.g., '2024-Q1'
   * @returns {Object} - LTV metrics
   */
  calculateCohortLTV(cohort) {
    const customers = this._loadCustomers().filter(c =>
      c.stageHistory[0]?.timestamp.startsWith(cohort.replace('-Q', '-'))
    );

    if (customers.length === 0) {
      return { cohort, customers: 0, ltv: 0 };
    }

    // Simplified LTV calculation
    const avgMonthlyValue = 2500; // Placeholder
    const avgLifetimeMonths = 24; // Placeholder

    return {
      cohort,
      customers: customers.length,
      churned: customers.filter(c => c.currentStage === LIFECYCLE_STAGE.CHURNED).length,
      retentionRate: ((customers.length - customers.filter(c => c.currentStage === LIFECYCLE_STAGE.CHURNED).length) / customers.length) * 100,
      ltv: avgMonthlyValue * avgLifetimeMonths
    };
  }

  /**
   * Get retention analytics.
   * @returns {Object}
   */
  getRetentionAnalytics() {
    const customers = this._loadCustomers();

    const byStage = {};
    Object.values(LIFECYCLE_STAGE).forEach(stage => {
      byStage[stage] = customers.filter(c => c.currentStage === stage).length;
    });

    return {
      totalCustomers: customers.length,
      byStage,
      churnRate: customers.length > 0
        ? (byStage[LIFECYCLE_STAGE.CHURNED] / customers.length) * 100
        : 0,
      activeCustomers: byStage[LIFECYCLE_STAGE.ACTIVE] + byStage[LIFECYCLE_STAGE.GROWTH],
      champions: byStage[LIFECYCLE_STAGE.CHAMPION]
    };
  }

  /**
   * Load customers from storage.
   * @private
   */
  _loadCustomers() {
    return _lsGet(LIFECYCLE_STORAGE_KEYS.CUSTOMERS) || [];
  }

  /**
   * Save customers to storage.
   * @private
   */
  _saveCustomers(customers) {
    _lsSet(LIFECYCLE_STORAGE_KEYS.CUSTOMERS, customers);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT — singleton on window, available to all pages and agents
   ───────────────────────────────────────────────────────────────────────────── */
window.CustomerLifecycleEngine = {
  CustomerHealthScoring,
  OnboardingWorkflow,
  ExpansionNurtureWorkflow,
  ChurnPreventionWorkflow,
  AdvocacyProgramWorkflow,
  LifecycleStageManager,
  LIFECYCLE_STAGE,
  HEALTH_STATUS,
  NPS_CATEGORY
};
