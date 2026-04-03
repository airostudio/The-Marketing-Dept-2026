/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OPTIMIZATION ENGINE — Audema - Your AI Marketing Department
 * Closed-loop feedback and optimization layer for autonomous marketing platform.
 *
 * This module manages the feedback loop from execution → analysis → optimization:
 *   1. PerformanceTracker    — Track workflow metrics and calculate trends
 *   2. CMOFeedbackLoop       — Analyze performance and generate recommendations
 *   3. BudgetOptimizer       — Auto-reallocate budget to winning channels
 *   4. ConflictResolver      — Handle inter-agent conflicts and priorities
 *   5. LearningEngine        — Learn patterns and optimize future campaigns
 *
 * The platform learns from every execution and continuously improves ROI.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & STORAGE KEYS
   ───────────────────────────────────────────────────────────────────────────── */

/** @enum {string} localStorage keys for optimization stores */
const OPTIMIZATION_STORAGE_KEYS = {
  PERFORMANCE_METRICS:  'optimization_performance_metrics',
  CMO_FEEDBACK:         'optimization_cmo_feedback',
  BUDGET_ALLOCATION:    'optimization_budget_allocation',
  CONFLICTS:            'optimization_conflicts',
  LEARNINGS:            'optimization_learnings'
};

/** @enum {string} Performance metric types */
const METRIC_TYPE = {
  EMAIL_OPEN_RATE:      'email_open_rate',
  EMAIL_CLICK_RATE:     'email_click_rate',
  EMAIL_CONVERSION:     'email_conversion',
  SOCIAL_ENGAGEMENT:    'social_engagement',
  SOCIAL_REACH:         'social_reach',
  AD_CTR:               'ad_ctr',
  AD_CPA:               'ad_cpa',
  AD_CONVERSION:        'ad_conversion',
  LEAD_CONVERSION:      'lead_conversion'
};

/** @enum {string} Optimization recommendation types */
const RECOMMENDATION_TYPE = {
  INCREASE_BUDGET:   'increase_budget',
  DECREASE_BUDGET:   'decrease_budget',
  PAUSE_VARIANT:     'pause_variant',
  REPLICATE_WINNER:  'replicate_winner',
  ADJUST_TIMING:     'adjust_timing',
  CHANGE_TARGETING:  'change_targeting',
  UPDATE_MESSAGING:  'update_messaging'
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
    console.warn('[OptimizationEngine] localStorage read failed:', e.message);
    return null;
  }
}

function _lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[OptimizationEngine] localStorage write failed:', e.message);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   1. PERFORMANCE TRACKER
   Tracks workflow execution metrics and calculates performance trends.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * PerformanceTracker manages metric collection and trend analysis.
 *
 * Tracks:
 * - Email: open rate, click rate, conversion rate, unsubscribe rate
 * - Social: engagement rate, reach, shares, comments
 * - Paid Media: CTR, CPA, conversion rate, ROAS
 * - Lead Scoring: conversion rate by tier, average score, routing accuracy
 */
class PerformanceTracker {
  constructor() {
    this._key = OPTIMIZATION_STORAGE_KEYS.PERFORMANCE_METRICS;
  }

  /**
   * Record performance metrics for a workflow execution.
   * @param {Object} metrics
   * @param {string} metrics.executionId - Workflow execution ID
   * @param {string} metrics.workflowType - Type (email_nurture, social_distribution, etc.)
   * @param {string} metrics.campaignName - Campaign name
   * @param {Object} metrics.data - Metric data (varies by workflow type)
   * @returns {Object} - Saved metric record
   */
  recordMetrics(metrics) {
    if (!metrics || !metrics.executionId || !metrics.workflowType) {
      throw new TypeError('[PerformanceTracker.recordMetrics] executionId and workflowType required');
    }

    const record = {
      id: _uid(),
      executionId: metrics.executionId,
      workflowType: metrics.workflowType,
      campaignName: metrics.campaignName || 'Unnamed Campaign',
      recordedAt: new Date().toISOString(),
      data: metrics.data || {}
    };

    const allMetrics = this._load();
    allMetrics.push(record);
    this._save(allMetrics);

    return record;
  }

  /**
   * Get performance metrics for a specific execution.
   * @param {string} executionId
   * @returns {Object|null}
   */
  getMetrics(executionId) {
    const allMetrics = this._load();
    return allMetrics.find(m => m.executionId === executionId) || null;
  }

  /**
   * Get all metrics for a workflow type.
   * @param {string} workflowType
   * @param {number} [limit=50] - Max number of records to return
   * @returns {Object[]}
   */
  getMetricsByWorkflow(workflowType, limit = 50) {
    const allMetrics = this._load();
    return allMetrics
      .filter(m => m.workflowType === workflowType)
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
      .slice(0, limit);
  }

  /**
   * Calculate performance trends for a workflow type.
   * @param {string} workflowType
   * @param {string} metricName - Metric to analyze (e.g., 'openRate', 'ctr', 'conversionRate')
   * @returns {Object} - Trend analysis
   */
  calculateTrend(workflowType, metricName) {
    const metrics = this.getMetricsByWorkflow(workflowType, 30);

    if (metrics.length === 0) {
      return {
        metricName,
        workflowType,
        dataPoints: 0,
        average: 0,
        trend: 'insufficient_data',
        message: 'Need at least 1 execution to calculate trends'
      };
    }

    // Extract metric values
    const values = metrics
      .map(m => m.data[metricName])
      .filter(v => typeof v === 'number' && !isNaN(v));

    if (values.length === 0) {
      return {
        metricName,
        workflowType,
        dataPoints: 0,
        average: 0,
        trend: 'no_data',
        message: `No data found for metric: ${metricName}`
      };
    }

    // Calculate statistics
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const recent = values.slice(0, Math.min(5, values.length));
    const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    const older = values.slice(5);
    const olderAvg = older.length > 0 ? older.reduce((sum, v) => sum + v, 0) / older.length : average;

    // Determine trend
    const improvement = ((recentAvg - olderAvg) / olderAvg) * 100;
    let trend = 'stable';
    if (improvement > 10) trend = 'improving';
    else if (improvement < -10) trend = 'declining';

    return {
      metricName,
      workflowType,
      dataPoints: values.length,
      average: Math.round(average * 100) / 100,
      recentAverage: Math.round(recentAvg * 100) / 100,
      olderAverage: Math.round(olderAvg * 100) / 100,
      improvement: Math.round(improvement * 10) / 10,
      trend,
      message: this._getTrendMessage(trend, improvement, metricName)
    };
  }

  /**
   * Get performance benchmarks for a workflow type.
   * @param {string} workflowType
   * @returns {Object} - Benchmark data
   */
  getBenchmarks(workflowType) {
    const benchmarks = {
      email_nurture: {
        openRate: { good: 35, average: 20, poor: 15 },
        clickRate: { good: 8, average: 3, poor: 1.5 },
        conversionRate: { good: 5, average: 2, poor: 0.5 }
      },
      social_distribution: {
        engagementRate: { good: 5, average: 2, poor: 0.5 },
        reach: { good: 5000, average: 1000, poor: 200 }
      },
      paid_media_launch: {
        ctr: { good: 3, average: 1.5, poor: 0.5 },
        cpa: { good: 50, average: 100, poor: 200 },
        conversionRate: { good: 5, average: 2, poor: 0.5 }
      },
      lead_scoring: {
        aTierConversion: { good: 40, average: 25, poor: 10 },
        bTierConversion: { good: 15, average: 8, poor: 3 }
      }
    };

    return benchmarks[workflowType] || {};
  }

  /**
   * Compare actual performance to benchmarks.
   * @param {string} workflowType
   * @param {Object} metrics - Actual metrics to compare
   * @returns {Object} - Comparison results
   */
  compareToBenchmarks(workflowType, metrics) {
    const benchmarks = this.getBenchmarks(workflowType);
    const comparison = {};

    Object.keys(benchmarks).forEach(metricName => {
      const benchmark = benchmarks[metricName];
      const actual = metrics[metricName];

      if (typeof actual !== 'number') {
        comparison[metricName] = { status: 'no_data', message: 'No data for this metric' };
        return;
      }

      let status = 'average';
      if (actual >= benchmark.good) status = 'good';
      else if (actual <= benchmark.poor) status = 'poor';

      comparison[metricName] = {
        actual,
        benchmark: benchmark.average,
        status,
        delta: actual - benchmark.average,
        percentile: this._calculatePercentile(actual, benchmark)
      };
    });

    return comparison;
  }

  /**
   * Calculate percentile of actual vs benchmark.
   * @private
   */
  _calculatePercentile(actual, benchmark) {
    if (actual >= benchmark.good) return 'top_10%';
    if (actual >= benchmark.average) return 'top_50%';
    if (actual >= benchmark.poor) return 'bottom_50%';
    return 'bottom_10%';
  }

  /**
   * Get trend message for display.
   * @private
   */
  _getTrendMessage(trend, improvement, metricName) {
    if (trend === 'improving') {
      return `${metricName} improving (+${improvement.toFixed(1)}%) — keep current strategy`;
    } else if (trend === 'declining') {
      return `${metricName} declining (${improvement.toFixed(1)}%) — consider optimization`;
    } else {
      return `${metricName} stable — maintain current approach`;
    }
  }

  /**
   * Load all metrics from storage.
   * @private
   */
  _load() {
    return _lsGet(this._key) || [];
  }

  /**
   * Save metrics to storage.
   * @private
   */
  _save(metrics) {
    _lsSet(this._key, metrics);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. CMO FEEDBACK LOOP
   Receives performance metrics and generates optimization recommendations.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * CMOFeedbackLoop analyzes performance and generates actionable recommendations.
 *
 * Workflow:
 * 1. Receive metrics from workflow execution
 * 2. Compare to benchmarks and historical trends
 * 3. Generate optimization recommendations
 * 4. Create directives for agents to execute
 * 5. Track recommendation adoption and impact
 */
class CMOFeedbackLoop {
  constructor(performanceTracker, claudeService) {
    this.performanceTracker = performanceTracker;
    this.claudeService = claudeService;
    this._key = OPTIMIZATION_STORAGE_KEYS.CMO_FEEDBACK;
  }

  /**
   * Analyze workflow performance and generate recommendations.
   * @param {Object} execution - Workflow execution result
   * @param {Object} metrics - Performance metrics for this execution
   * @returns {Promise<Object>} - Feedback with recommendations
   */
  async generateFeedback(execution, metrics) {
    const feedbackId = _uid();
    const timestamp = new Date().toISOString();

    console.log(`[CMOFeedbackLoop] Generating feedback for execution ${execution.executionId}`);

    try {
      // STEP 1: Record metrics
      this.performanceTracker.recordMetrics({
        executionId: execution.executionId,
        workflowType: execution.workflowType,
        campaignName: execution.config.campaignName || 'Unnamed',
        data: metrics
      });

      // STEP 2: Calculate trends
      const trends = this._calculateTrends(execution.workflowType, metrics);

      // STEP 3: Compare to benchmarks
      const benchmarkComparison = this.performanceTracker.compareToBenchmarks(
        execution.workflowType,
        metrics
      );

      // STEP 4: Generate recommendations using Claude
      const recommendations = await this._generateRecommendations(
        execution,
        metrics,
        trends,
        benchmarkComparison
      );

      // STEP 5: Create feedback record
      const feedback = {
        feedbackId,
        executionId: execution.executionId,
        workflowType: execution.workflowType,
        campaignName: execution.config.campaignName,
        timestamp,
        metrics,
        trends,
        benchmarkComparison,
        recommendations,
        status: 'pending'
      };

      this._saveFeedback(feedback);
      return feedback;

    } catch (error) {
      console.error('[CMOFeedbackLoop] Feedback generation failed:', error);
      throw error;
    }
  }

  /**
   * Calculate performance trends for all relevant metrics.
   * @private
   */
  _calculateTrends(workflowType, metrics) {
    const trends = {};
    const metricNames = Object.keys(metrics);

    metricNames.forEach(metricName => {
      trends[metricName] = this.performanceTracker.calculateTrend(workflowType, metricName);
    });

    return trends;
  }

  /**
   * Generate optimization recommendations using Claude.
   * @private
   */
  async _generateRecommendations(execution, metrics, trends, benchmarkComparison) {
    const systemPrompt = `You are a Chief Marketing Officer analyzing campaign performance.

Review this campaign execution and provide actionable optimization recommendations.

## Campaign Details
Type: ${execution.workflowType}
Name: ${execution.config.campaignName || 'Unnamed'}
Execution ID: ${execution.executionId}

## Performance Metrics
${JSON.stringify(metrics, null, 2)}

## Performance Trends
${JSON.stringify(trends, null, 2)}

## Benchmark Comparison
${JSON.stringify(benchmarkComparison, null, 2)}

## Your Task
Analyze the data and provide 3-5 specific, actionable recommendations to improve performance.

For each recommendation, include:
1. **Type**: ${Object.values(RECOMMENDATION_TYPE).join(', ')}
2. **Priority**: high / medium / low
3. **Action**: Specific action to take (e.g., "Increase budget for Email Variant 2 by 50%")
4. **Rationale**: Why this will improve performance (based on data)
5. **Expected Impact**: Quantitative improvement estimate (e.g., "+15% open rate")

Output as JSON array:
[
  {
    "type": "increase_budget",
    "priority": "high",
    "action": "Increase budget for Email Variant 2 by 50%",
    "rationale": "Variant 2 has 42% open rate vs 18% average, indicating strong ICP resonance",
    "expectedImpact": "+25% overall campaign conversions",
    "targetMetric": "conversionRate"
  },
  ...
]

Output ONLY valid JSON. No markdown, no explanation.`;

    try {
      const response = await this.claudeService.callAgent({
        systemPrompt,
        messages: [{ role: 'user', content: 'Analyze the campaign and generate recommendations.' }]
      });

      const cleaned = response.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleaned);

    } catch (error) {
      console.error('[CMOFeedbackLoop] Claude recommendation generation failed:', error);
      // Return fallback recommendations based on benchmarks
      return this._generateFallbackRecommendations(benchmarkComparison);
    }
  }

  /**
   * Generate fallback recommendations when Claude is unavailable.
   * @private
   */
  _generateFallbackRecommendations(benchmarkComparison) {
    const recommendations = [];

    Object.entries(benchmarkComparison).forEach(([metric, comparison]) => {
      if (comparison.status === 'poor') {
        recommendations.push({
          type: RECOMMENDATION_TYPE.UPDATE_MESSAGING,
          priority: 'high',
          action: `Optimize ${metric} (currently ${comparison.actual} vs benchmark ${comparison.benchmark})`,
          rationale: `Performance is in bottom ${comparison.percentile}`,
          expectedImpact: `+${Math.round((comparison.benchmark - comparison.actual) / comparison.actual * 100)}% improvement`,
          targetMetric: metric
        });
      } else if (comparison.status === 'good') {
        recommendations.push({
          type: RECOMMENDATION_TYPE.INCREASE_BUDGET,
          priority: 'medium',
          action: `Increase budget for this campaign (${metric} performing well)`,
          rationale: `Performance is in top ${comparison.percentile}`,
          expectedImpact: 'Scale winning strategy',
          targetMetric: metric
        });
      }
    });

    if (recommendations.length === 0) {
      recommendations.push({
        type: RECOMMENDATION_TYPE.REPLICATE_WINNER,
        priority: 'low',
        action: 'Maintain current strategy',
        rationale: 'All metrics performing at or above benchmark',
        expectedImpact: 'Sustain performance',
        targetMetric: 'overall'
      });
    }

    return recommendations;
  }

  /**
   * Get all feedback records.
   * @param {Object} [filter] - Optional filter
   * @param {string} [filter.workflowType] - Filter by workflow type
   * @param {string} [filter.status] - Filter by status
   * @param {number} [filter.limit=20] - Max records to return
   * @returns {Object[]}
   */
  getAllFeedback(filter = {}) {
    let feedback = _lsGet(this._key) || [];

    if (filter.workflowType) {
      feedback = feedback.filter(f => f.workflowType === filter.workflowType);
    }

    if (filter.status) {
      feedback = feedback.filter(f => f.status === filter.status);
    }

    return feedback
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, filter.limit || 20);
  }

  /**
   * Mark recommendation as executed.
   * @param {string} feedbackId
   * @param {number} recommendationIndex
   */
  markRecommendationExecuted(feedbackId, recommendationIndex) {
    const allFeedback = _lsGet(this._key) || [];
    const feedback = allFeedback.find(f => f.feedbackId === feedbackId);

    if (feedback && feedback.recommendations[recommendationIndex]) {
      feedback.recommendations[recommendationIndex].executed = true;
      feedback.recommendations[recommendationIndex].executedAt = new Date().toISOString();
      _lsSet(this._key, allFeedback);
    }
  }

  /**
   * Save feedback record.
   * @private
   */
  _saveFeedback(feedback) {
    const allFeedback = _lsGet(this._key) || [];
    allFeedback.push(feedback);
    _lsSet(this._key, allFeedback);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. BUDGET OPTIMIZER
   Auto-reallocates budget from low-performing to high-performing channels.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * BudgetOptimizer manages automated budget reallocation based on performance.
 *
 * Logic:
 * - Identify winning variants (above benchmark performance)
 * - Identify losing variants (below benchmark performance)
 * - Shift budget from losers to winners
 * - Respect min/max budget constraints
 * - Track ROI by channel/variant
 */
class BudgetOptimizer {
  constructor(performanceTracker) {
    this.performanceTracker = performanceTracker;
    this._key = OPTIMIZATION_STORAGE_KEYS.BUDGET_ALLOCATION;
  }

  /**
   * Optimize budget allocation for a campaign based on performance.
   * @param {Object} config
   * @param {string} config.campaignId - Campaign to optimize
   * @param {number} config.totalBudget - Total available budget
   * @param {Object[]} config.variants - Variants with current allocation
   * @param {Object} config.performance - Performance metrics by variant
   * @param {Object} [config.constraints] - Budget constraints
   * @returns {Object} - Optimized budget allocation
   */
  optimizeBudget(config) {
    if (!config || !config.variants || !config.performance) {
      throw new TypeError('[BudgetOptimizer.optimizeBudget] variants and performance required');
    }

    const constraints = config.constraints || {
      minBudgetPerVariant: config.totalBudget * 0.05, // Min 5% per variant
      maxBudgetPerVariant: config.totalBudget * 0.50, // Max 50% per variant
      pauseThreshold: 0.5 // Pause if performance < 50% of benchmark
    };

    // STEP 1: Score each variant
    const scoredVariants = this._scoreVariants(config.variants, config.performance);

    // STEP 2: Identify winners and losers
    const { winners, losers, paused } = this._categorizeVariants(scoredVariants, constraints);

    // STEP 3: Calculate new budget allocation
    const newAllocation = this._reallocateBudget(
      scoredVariants,
      winners,
      losers,
      paused,
      config.totalBudget,
      constraints
    );

    // STEP 4: Calculate expected impact
    const impact = this._calculateImpact(config.variants, newAllocation);

    // STEP 5: Save allocation
    const allocation = {
      id: _uid(),
      campaignId: config.campaignId,
      timestamp: new Date().toISOString(),
      totalBudget: config.totalBudget,
      previousAllocation: config.variants.map(v => ({ variant: v.variant, budget: v.budget })),
      newAllocation,
      winners: winners.map(v => v.variant),
      losers: losers.map(v => v.variant),
      paused: paused.map(v => v.variant),
      expectedImpact: impact
    };

    this._saveAllocation(allocation);
    return allocation;
  }

  /**
   * Score variants based on performance metrics.
   * @private
   */
  _scoreVariants(variants, performance) {
    return variants.map(variant => {
      const variantPerf = performance[variant.variant] || {};
      const roi = variantPerf.conversions ? (variantPerf.revenue || 0) / variant.budget : 0;
      const efficiencyScore = variantPerf.ctr ? (variantPerf.ctr / variantPerf.cpa) * 100 : 0;

      return {
        ...variant,
        performance: variantPerf,
        roi,
        efficiencyScore,
        score: roi * 0.7 + efficiencyScore * 0.3 // Weighted score
      };
    });
  }

  /**
   * Categorize variants into winners, losers, and paused.
   * @private
   */
  _categorizeVariants(scoredVariants, constraints) {
    const sorted = [...scoredVariants].sort((a, b) => b.score - a.score);
    const median = sorted[Math.floor(sorted.length / 2)]?.score || 0;

    const winners = sorted.filter(v => v.score >= median && v.score > 0);
    const losers = sorted.filter(v => v.score < median && v.score >= median * constraints.pauseThreshold);
    const paused = sorted.filter(v => v.score < median * constraints.pauseThreshold);

    return { winners, losers, paused };
  }

  /**
   * Reallocate budget from losers to winners.
   * @private
   */
  _reallocateBudget(scoredVariants, winners, losers, paused, totalBudget, constraints) {
    // Calculate budget to redistribute
    const pausedBudget = paused.reduce((sum, v) => sum + v.budget, 0);
    const loserReduction = losers.reduce((sum, v) => sum + v.budget * 0.25, 0); // Take 25% from losers
    const redistributableBudget = pausedBudget + loserReduction;

    // Calculate new allocation
    const newAllocation = [];
    const winnerCount = winners.length;

    scoredVariants.forEach(variant => {
      let newBudget = variant.budget;

      if (paused.find(v => v.variant === variant.variant)) {
        // Pause this variant
        newBudget = 0;
      } else if (losers.find(v => v.variant === variant.variant)) {
        // Reduce loser budget by 25%
        newBudget = variant.budget * 0.75;
      } else if (winners.find(v => v.variant === variant.variant)) {
        // Increase winner budget proportionally
        const extraBudget = redistributableBudget / winnerCount;
        newBudget = variant.budget + extraBudget;
      }

      // Apply constraints
      newBudget = Math.max(constraints.minBudgetPerVariant, newBudget);
      newBudget = Math.min(constraints.maxBudgetPerVariant, newBudget);

      newAllocation.push({
        variant: variant.variant,
        name: variant.name,
        previousBudget: variant.budget,
        newBudget: Math.round(newBudget),
        change: Math.round(newBudget - variant.budget),
        changePercent: Math.round(((newBudget - variant.budget) / variant.budget) * 100),
        status: newBudget === 0 ? 'paused' : newBudget > variant.budget ? 'increased' : 'decreased'
      });
    });

    return newAllocation;
  }

  /**
   * Calculate expected impact of reallocation.
   * @private
   */
  _calculateImpact(previousAllocation, newAllocation) {
    const totalPreviousBudget = previousAllocation.reduce((sum, v) => sum + v.budget, 0);
    const totalNewBudget = newAllocation.reduce((sum, v) => sum + v.newBudget, 0);
    const budgetShift = totalNewBudget - totalPreviousBudget;

    const increasedVariants = newAllocation.filter(v => v.status === 'increased').length;
    const pausedVariants = newAllocation.filter(v => v.status === 'paused').length;

    return {
      budgetShift,
      increasedVariants,
      pausedVariants,
      expectedROIImprovement: increasedVariants > 0 ? '+15-30%' : '0%',
      message: `Shifted $${Math.abs(budgetShift)} from ${pausedVariants} low performers to ${increasedVariants} winners`
    };
  }

  /**
   * Get allocation history.
   * @param {string} [campaignId] - Filter by campaign
   * @returns {Object[]}
   */
  getAllocations(campaignId = null) {
    let allocations = _lsGet(this._key) || [];

    if (campaignId) {
      allocations = allocations.filter(a => a.campaignId === campaignId);
    }

    return allocations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Save allocation record.
   * @private
   */
  _saveAllocation(allocation) {
    const allocations = _lsGet(this._key) || [];
    allocations.push(allocation);
    _lsSet(this._key, allocations);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   4. CONFLICT RESOLVER
   Handles inter-agent conflicts (same segment targeting, timing conflicts, etc.)
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * ConflictResolver manages conflicts between multiple agents/campaigns.
 *
 * Conflict Types:
 * - Audience overlap: Multiple campaigns targeting same segment
 * - Timing conflict: Multiple campaigns scheduled same day
 * - Budget competition: Multiple campaigns exceeding total budget
 * - Channel saturation: Too many messages on same channel
 */
class ConflictResolver {
  constructor() {
    this._key = OPTIMIZATION_STORAGE_KEYS.CONFLICTS;
  }

  /**
   * Detect and resolve conflicts between campaigns.
   * @param {Object[]} campaigns - Active campaigns to check
   * @param {Object} [constraints] - Conflict resolution constraints
   * @returns {Object} - Detected conflicts and resolutions
   */
  resolveConflicts(campaigns, constraints = {}) {
    const defaults = {
      maxCampaignsPerSegment: 2,
      maxCampaignsPerDay: 3,
      minDaysBetweenEmails: 2,
      totalBudget: null
    };

    const settings = { ...defaults, ...constraints };

    // STEP 1: Detect conflicts
    const conflicts = {
      audienceOverlap: this._detectAudienceOverlap(campaigns, settings),
      timingConflicts: this._detectTimingConflicts(campaigns, settings),
      budgetConflicts: this._detectBudgetConflicts(campaigns, settings),
      channelSaturation: this._detectChannelSaturation(campaigns, settings)
    };

    // STEP 2: Generate resolutions
    const resolutions = this._generateResolutions(conflicts, campaigns, settings);

    // STEP 3: Save conflict record
    const record = {
      id: _uid(),
      timestamp: new Date().toISOString(),
      campaignCount: campaigns.length,
      conflicts,
      resolutions,
      status: resolutions.length > 0 ? 'conflicts_detected' : 'no_conflicts'
    };

    this._saveConflict(record);
    return record;
  }

  /**
   * Detect audience overlap conflicts.
   * @private
   */
  _detectAudienceOverlap(campaigns, settings) {
    const conflicts = [];
    const segmentMap = {};

    campaigns.forEach(campaign => {
      const segment = campaign.targetSegment || 'default';

      if (!segmentMap[segment]) segmentMap[segment] = [];
      segmentMap[segment].push(campaign);
    });

    Object.entries(segmentMap).forEach(([segment, campaignList]) => {
      if (campaignList.length > settings.maxCampaignsPerSegment) {
        conflicts.push({
          type: 'audience_overlap',
          severity: 'high',
          segment,
          campaigns: campaignList.map(c => c.campaignName),
          message: `${campaignList.length} campaigns targeting ${segment} (max: ${settings.maxCampaignsPerSegment})`
        });
      }
    });

    return conflicts;
  }

  /**
   * Detect timing conflicts.
   * @private
   */
  _detectTimingConflicts(campaigns, settings) {
    const conflicts = [];
    const dateMap = {};

    campaigns.forEach(campaign => {
      if (!campaign.scheduledDate) return;

      const date = campaign.scheduledDate.split('T')[0];
      if (!dateMap[date]) dateMap[date] = [];
      dateMap[date].push(campaign);
    });

    Object.entries(dateMap).forEach(([date, campaignList]) => {
      if (campaignList.length > settings.maxCampaignsPerDay) {
        conflicts.push({
          type: 'timing_conflict',
          severity: 'medium',
          date,
          campaigns: campaignList.map(c => c.campaignName),
          message: `${campaignList.length} campaigns scheduled for ${date} (max: ${settings.maxCampaignsPerDay})`
        });
      }
    });

    return conflicts;
  }

  /**
   * Detect budget conflicts.
   * @private
   */
  _detectBudgetConflicts(campaigns, settings) {
    if (!settings.totalBudget) return [];

    const totalRequested = campaigns.reduce((sum, c) => sum + (c.budget || 0), 0);

    if (totalRequested > settings.totalBudget) {
      return [{
        type: 'budget_conflict',
        severity: 'high',
        totalRequested,
        totalBudget: settings.totalBudget,
        overage: totalRequested - settings.totalBudget,
        campaigns: campaigns.map(c => ({ name: c.campaignName, budget: c.budget })),
        message: `Total budget requested ($${totalRequested}) exceeds available ($${settings.totalBudget})`
      }];
    }

    return [];
  }

  /**
   * Detect channel saturation conflicts.
   * @private
   */
  _detectChannelSaturation(campaigns, settings) {
    const conflicts = [];
    const channelMap = {};

    campaigns.forEach(campaign => {
      const channel = campaign.channel || 'unknown';
      if (!channelMap[channel]) channelMap[channel] = [];
      channelMap[channel].push(campaign);
    });

    // Email channel: max 1 email per 2 days to same segment
    if (channelMap.email && channelMap.email.length > 1) {
      const emailsBySegment = {};
      channelMap.email.forEach(campaign => {
        const segment = campaign.targetSegment || 'default';
        if (!emailsBySegment[segment]) emailsBySegment[segment] = [];
        emailsBySegment[segment].push(campaign);
      });

      Object.entries(emailsBySegment).forEach(([segment, emails]) => {
        if (emails.length > 3) { // More than 3 emails to same segment
          conflicts.push({
            type: 'channel_saturation',
            severity: 'medium',
            channel: 'email',
            segment,
            campaigns: emails.map(e => e.campaignName),
            message: `${emails.length} emails targeting ${segment} may cause fatigue`
          });
        }
      });
    }

    return conflicts;
  }

  /**
   * Generate conflict resolutions.
   * @private
   */
  _generateResolutions(conflicts, campaigns, settings) {
    const resolutions = [];

    // Resolve audience overlap
    conflicts.audienceOverlap?.forEach(conflict => {
      resolutions.push({
        conflict: conflict.type,
        action: 'stagger_timing',
        details: `Stagger ${conflict.campaigns.join(', ')} by 3-5 days to reduce audience fatigue`,
        priority: 'high'
      });
    });

    // Resolve timing conflicts
    conflicts.timingConflicts?.forEach(conflict => {
      resolutions.push({
        conflict: conflict.type,
        action: 'reschedule',
        details: `Reschedule lower-priority campaigns from ${conflict.date} to adjacent days`,
        priority: 'medium'
      });
    });

    // Resolve budget conflicts
    conflicts.budgetConflicts?.forEach(conflict => {
      resolutions.push({
        conflict: conflict.type,
        action: 'reduce_budgets',
        details: `Reduce each campaign budget by ${Math.round((conflict.overage / conflict.totalRequested) * 100)}% to fit within $${conflict.totalBudget}`,
        priority: 'high'
      });
    });

    // Resolve channel saturation
    conflicts.channelSaturation?.forEach(conflict => {
      resolutions.push({
        conflict: conflict.type,
        action: 'diversify_channels',
        details: `Move some ${conflict.segment} campaigns to social/paid media to reduce email fatigue`,
        priority: 'medium'
      });
    });

    return resolutions;
  }

  /**
   * Get conflict history.
   * @returns {Object[]}
   */
  getConflictHistory() {
    const conflicts = _lsGet(this._key) || [];
    return conflicts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Save conflict record.
   * @private
   */
  _saveConflict(conflict) {
    const conflicts = _lsGet(this._key) || [];
    conflicts.push(conflict);
    _lsSet(this._key, conflicts);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   5. LEARNING ENGINE
   Learns patterns from historical performance and optimizes future campaigns.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * LearningEngine analyzes historical data and builds optimization playbooks.
 *
 * Learns:
 * - Which psychological triggers work best (pain vs benefit hooks)
 * - Optimal send times by audience segment
 * - Best-performing ad copy patterns
 * - Subject line formulas with highest open rates
 * - ICP segment preferences
 */
class LearningEngine {
  constructor(performanceTracker) {
    this.performanceTracker = performanceTracker;
    this._key = OPTIMIZATION_STORAGE_KEYS.LEARNINGS;
  }

  /**
   * Analyze historical data and extract learnings.
   * @param {string} workflowType - Type of workflow to analyze
   * @param {number} [lookbackDays=90] - Days of history to analyze
   * @returns {Object} - Extracted learnings and patterns
   */
  extractLearnings(workflowType, lookbackDays = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const metrics = this.performanceTracker.getMetricsByWorkflow(workflowType, 100);
    const recentMetrics = metrics.filter(m => new Date(m.recordedAt) >= cutoffDate);

    if (recentMetrics.length < 5) {
      return {
        workflowType,
        status: 'insufficient_data',
        dataPoints: recentMetrics.length,
        message: 'Need at least 5 executions to extract meaningful learnings'
      };
    }

    const learnings = {
      id: _uid(),
      workflowType,
      analyzedAt: new Date().toISOString(),
      dataPoints: recentMetrics.length,
      lookbackDays,
      patterns: []
    };

    // Extract workflow-specific patterns
    if (workflowType === 'email_nurture') {
      learnings.patterns = this._extractEmailPatterns(recentMetrics);
    } else if (workflowType === 'paid_media_launch') {
      learnings.patterns = this._extractAdPatterns(recentMetrics);
    } else if (workflowType === 'social_distribution') {
      learnings.patterns = this._extractSocialPatterns(recentMetrics);
    }

    // Save learnings
    this._saveLearning(learnings);
    return learnings;
  }

  /**
   * Extract email-specific patterns.
   * @private
   */
  _extractEmailPatterns(metrics) {
    const patterns = [];

    // Pattern 1: Best subject line hooks
    const subjectLinePerformance = {};
    metrics.forEach(m => {
      if (m.data.subjectLineType && m.data.openRate) {
        if (!subjectLinePerformance[m.data.subjectLineType]) {
          subjectLinePerformance[m.data.subjectLineType] = [];
        }
        subjectLinePerformance[m.data.subjectLineType].push(m.data.openRate);
      }
    });

    if (Object.keys(subjectLinePerformance).length > 0) {
      const avgByType = {};
      Object.entries(subjectLinePerformance).forEach(([type, rates]) => {
        avgByType[type] = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      });

      const winner = Object.entries(avgByType).sort(([,a], [,b]) => b - a)[0];
      patterns.push({
        pattern: 'best_subject_line_hook',
        finding: `${winner[0]} subject lines perform best`,
        metric: 'openRate',
        value: Math.round(winner[1] * 10) / 10,
        confidence: rates.length > 10 ? 'high' : 'medium',
        recommendation: `Use ${winner[0]} hooks for future email campaigns`
      });
    }

    // Pattern 2: Optimal send time
    const sendTimePerformance = {};
    metrics.forEach(m => {
      if (m.data.sendTime && m.data.clickRate) {
        const hour = new Date(m.data.sendTime).getHours();
        if (!sendTimePerformance[hour]) sendTimePerformance[hour] = [];
        sendTimePerformance[hour].push(m.data.clickRate);
      }
    });

    if (Object.keys(sendTimePerformance).length > 0) {
      const avgByHour = {};
      Object.entries(sendTimePerformance).forEach(([hour, rates]) => {
        avgByHour[hour] = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      });

      const bestHour = Object.entries(avgByHour).sort(([,a], [,b]) => b - a)[0];
      patterns.push({
        pattern: 'optimal_send_time',
        finding: `${bestHour[0]}:00 has highest engagement`,
        metric: 'clickRate',
        value: Math.round(bestHour[1] * 10) / 10,
        confidence: 'medium',
        recommendation: `Schedule emails for ${bestHour[0]}:00 local time`
      });
    }

    return patterns;
  }

  /**
   * Extract ad-specific patterns.
   * @private
   */
  _extractAdPatterns(metrics) {
    const patterns = [];

    // Pattern: Best psychological trigger
    const triggerPerformance = {};
    metrics.forEach(m => {
      if (m.data.trigger && m.data.ctr) {
        if (!triggerPerformance[m.data.trigger]) triggerPerformance[m.data.trigger] = [];
        triggerPerformance[m.data.trigger].push(m.data.ctr);
      }
    });

    if (Object.keys(triggerPerformance).length > 0) {
      const avgByTrigger = {};
      Object.entries(triggerPerformance).forEach(([trigger, ctrs]) => {
        avgByTrigger[trigger] = ctrs.reduce((sum, c) => sum + c, 0) / ctrs.length;
      });

      const winner = Object.entries(avgByTrigger).sort(([,a], [,b]) => b - a)[0];
      patterns.push({
        pattern: 'best_psychological_trigger',
        finding: `${winner[0]} ads outperform others`,
        metric: 'ctr',
        value: Math.round(winner[1] * 100) / 100,
        confidence: 'high',
        recommendation: `Prioritize ${winner[0]} variants in future ad campaigns`
      });
    }

    return patterns;
  }

  /**
   * Extract social-specific patterns.
   * @private
   */
  _extractSocialPatterns(metrics) {
    const patterns = [];

    // Pattern: Best platform
    const platformPerformance = {};
    metrics.forEach(m => {
      if (m.data.platform && m.data.engagementRate) {
        if (!platformPerformance[m.data.platform]) platformPerformance[m.data.platform] = [];
        platformPerformance[m.data.platform].push(m.data.engagementRate);
      }
    });

    if (Object.keys(platformPerformance).length > 0) {
      const avgByPlatform = {};
      Object.entries(platformPerformance).forEach(([platform, rates]) => {
        avgByPlatform[platform] = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      });

      const winner = Object.entries(avgByPlatform).sort(([,a], [,b]) => b - a)[0];
      patterns.push({
        pattern: 'best_platform',
        finding: `${winner[0]} drives highest engagement`,
        metric: 'engagementRate',
        value: Math.round(winner[1] * 100) / 100,
        confidence: 'high',
        recommendation: `Allocate more content to ${winner[0]}`
      });
    }

    return patterns;
  }

  /**
   * Get all learnings.
   * @param {string} [workflowType] - Filter by workflow type
   * @returns {Object[]}
   */
  getAllLearnings(workflowType = null) {
    let learnings = _lsGet(this._key) || [];

    if (workflowType) {
      learnings = learnings.filter(l => l.workflowType === workflowType);
    }

    return learnings.sort((a, b) => new Date(b.analyzedAt) - new Date(a.analyzedAt));
  }

  /**
   * Apply learnings to a new campaign configuration.
   * @param {string} workflowType
   * @param {Object} config - Campaign config to optimize
   * @returns {Object} - Optimized config with learnings applied
   */
  applyLearnings(workflowType, config) {
    const learnings = this.getAllLearnings(workflowType);

    if (learnings.length === 0) {
      return { ...config, learningsApplied: false };
    }

    const latestLearning = learnings[0];
    const optimizedConfig = { ...config };
    const appliedLearnings = [];

    latestLearning.patterns.forEach(pattern => {
      if (pattern.pattern === 'best_subject_line_hook' && workflowType === 'email_nurture') {
        optimizedConfig.preferredSubjectLineType = pattern.finding.split(' ')[0];
        appliedLearnings.push(`Using ${pattern.finding} based on historical performance`);
      } else if (pattern.pattern === 'optimal_send_time' && workflowType === 'email_nurture') {
        optimizedConfig.sendTime = pattern.finding.split(' ')[0];
        appliedLearnings.push(`Scheduling for ${pattern.finding}`);
      } else if (pattern.pattern === 'best_psychological_trigger' && workflowType === 'paid_media_launch') {
        optimizedConfig.prioritizeTrigger = pattern.finding.split(' ')[0];
        appliedLearnings.push(`Prioritizing ${pattern.finding}`);
      }
    });

    optimizedConfig.learningsApplied = appliedLearnings.length > 0;
    optimizedConfig.appliedLearnings = appliedLearnings;

    return optimizedConfig;
  }

  /**
   * Save learning record.
   * @private
   */
  _saveLearning(learning) {
    const learnings = _lsGet(this._key) || [];
    learnings.push(learning);
    _lsSet(this._key, learnings);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   EXPORT — singleton on window, available to all pages and agents
   ───────────────────────────────────────────────────────────────────────────── */
window.OptimizationEngine = {
  PerformanceTracker,
  CMOFeedbackLoop,
  BudgetOptimizer,
  ConflictResolver,
  LearningEngine,
  METRIC_TYPE,
  RECOMMENDATION_TYPE
};
