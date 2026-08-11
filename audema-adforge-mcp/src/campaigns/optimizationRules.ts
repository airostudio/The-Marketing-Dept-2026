/**
 * Rule-based performance flagging (Revealbot-style), evaluated against
 * campaign results already saved via save_campaign_result. This is
 * recommendation-only by design — evaluateRules() never touches a live ad
 * platform, matching this server's draft-only/human-approved posture for
 * anything with real spend. It flags candidates for a human to review and
 * pause themselves.
 */

import type { CampaignResult } from '../types.js';

export type RuleMetric = 'cpa' | 'roas' | 'ctr' | 'cpc';
export type RuleComparator = 'above' | 'below';

export interface OptimizationRule {
  metric: RuleMetric;
  comparator: RuleComparator;
  threshold: number;
  /** Ignore results below this spend — avoids flagging a campaign on a tiny, noisy sample. */
  minSpend?: number;
  label?: string;
}

export interface FlaggedResult {
  result: CampaignResult;
  triggeredRules: OptimizationRule[];
}

function metricValue(result: CampaignResult, metric: RuleMetric): number | undefined {
  switch (metric) {
    case 'cpa': return result.cpa;
    case 'roas': return result.roas;
    case 'ctr': return result.ctr;
    case 'cpc': return result.cpc;
  }
}

function ruleTriggered(result: CampaignResult, rule: OptimizationRule): boolean {
  if (rule.minSpend !== undefined && result.spend < rule.minSpend) return false;
  const value = metricValue(result, rule.metric);
  if (value === undefined) return false;
  return rule.comparator === 'above' ? value > rule.threshold : value < rule.threshold;
}

export function evaluateRules(results: CampaignResult[], rules: OptimizationRule[]): FlaggedResult[] {
  return results
    .map((result) => ({ result, triggeredRules: rules.filter((rule) => ruleTriggered(result, rule)) }))
    .filter((flagged) => flagged.triggeredRules.length > 0);
}

function average(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

const MIN_RESULTS_FOR_DEFAULTS = 3;

/**
 * Derives sensible default rules from a brand's OWN historical average
 * performance, rather than arbitrary hardcoded thresholds — "flag anything
 * meaningfully worse than what you've already achieved," not a generic
 * industry number that may not fit this brand's category or price point.
 * Returns an empty array (with no rules) when there isn't enough history
 * to compute a trustworthy average — never guesses with too little data.
 */
export function suggestDefaultRules(results: CampaignResult[]): { rules: OptimizationRule[]; note: string } {
  if (results.length < MIN_RESULTS_FOR_DEFAULTS) {
    return {
      rules: [],
      note: `Only ${results.length} saved campaign result(s) for this brand — need at least ${MIN_RESULTS_FOR_DEFAULTS} to derive trustworthy default thresholds from history. Save more results, or pass explicit rules yourself.`,
    };
  }

  const avgCpa = average(results.map((r) => r.cpa).filter((v): v is number => v !== undefined));
  const avgRoas = average(results.map((r) => r.roas).filter((v): v is number => v !== undefined));
  const avgSpend = average(results.map((r) => r.spend)) ?? 0;

  const rules: OptimizationRule[] = [];
  if (avgCpa !== null) {
    rules.push({
      metric: 'cpa', comparator: 'above', threshold: Math.round(avgCpa * 1.5 * 100) / 100,
      minSpend: Math.round(avgSpend * 0.5),
      label: `CPA more than 50% above this brand's historical average ($${avgCpa.toFixed(2)})`,
    });
  }
  if (avgRoas !== null) {
    rules.push({
      metric: 'roas', comparator: 'below', threshold: Math.round(avgRoas * 0.6 * 100) / 100,
      minSpend: Math.round(avgSpend * 0.5),
      label: `ROAS less than 60% of this brand's historical average (${avgRoas.toFixed(2)}x)`,
    });
  }

  return {
    rules,
    note: rules.length
      ? `Derived from ${results.length} historical results (avg CPA $${avgCpa?.toFixed(2) ?? 'n/a'}, avg ROAS ${avgRoas?.toFixed(2) ?? 'n/a'}x). These are starting points, not a certification — adjust to your own risk tolerance.`
      : 'No CPA or ROAS data in historical results to derive defaults from — pass explicit rules instead.',
  };
}
