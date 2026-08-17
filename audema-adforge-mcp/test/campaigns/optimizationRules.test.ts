import { describe, it, expect } from 'vitest';
import { evaluateRules, suggestDefaultRules } from '../../src/campaigns/optimizationRules.js';
import type { OptimizationRule } from '../../src/campaigns/optimizationRules.js';
import type { CampaignResult } from '../../src/types.js';

function makeResult(overrides: Partial<CampaignResult> = {}): CampaignResult {
  return {
    id: 'r1',
    brandProfileId: 'brand-1',
    platform: 'Meta',
    dateRange: '2026-01-01 to 2026-01-07',
    spend: 500,
    impressions: 10000,
    clicks: 200,
    cpa: 20,
    roas: 3,
    ctr: 2,
    cpc: 2.5,
    ...overrides,
  };
}

describe('evaluateRules', () => {
  it('flags a result that breaches an "above" rule', () => {
    const rules: OptimizationRule[] = [{ metric: 'cpa', comparator: 'above', threshold: 15 }];
    const flagged = evaluateRules([makeResult({ cpa: 25 })], rules);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].triggeredRules).toHaveLength(1);
  });

  it('flags a result that breaches a "below" rule', () => {
    const rules: OptimizationRule[] = [{ metric: 'roas', comparator: 'below', threshold: 2 }];
    const flagged = evaluateRules([makeResult({ roas: 1.5 })], rules);
    expect(flagged).toHaveLength(1);
  });

  it('does not flag a result within bounds', () => {
    const rules: OptimizationRule[] = [{ metric: 'cpa', comparator: 'above', threshold: 100 }];
    expect(evaluateRules([makeResult({ cpa: 20 })], rules)).toHaveLength(0);
  });

  it('respects minSpend — ignores a breach on a too-small sample', () => {
    const rules: OptimizationRule[] = [{ metric: 'cpa', comparator: 'above', threshold: 5, minSpend: 200 }];
    expect(evaluateRules([makeResult({ cpa: 50, spend: 50 })], rules)).toHaveLength(0);
    expect(evaluateRules([makeResult({ cpa: 50, spend: 500 })], rules)).toHaveLength(1);
  });

  it('collects every rule triggered, not just the first', () => {
    const rules: OptimizationRule[] = [
      { metric: 'cpa', comparator: 'above', threshold: 10 },
      { metric: 'roas', comparator: 'below', threshold: 5 },
    ];
    const flagged = evaluateRules([makeResult({ cpa: 20, roas: 1 })], rules);
    expect(flagged[0].triggeredRules).toHaveLength(2);
  });

  it('skips a rule whose metric is undefined on the result rather than crashing', () => {
    const rules: OptimizationRule[] = [{ metric: 'roas', comparator: 'below', threshold: 5 }];
    expect(() => evaluateRules([makeResult({ roas: undefined })], rules)).not.toThrow();
    expect(evaluateRules([makeResult({ roas: undefined })], rules)).toHaveLength(0);
  });
});

describe('suggestDefaultRules', () => {
  it('refuses to derive defaults with fewer than 3 results', () => {
    const { rules, note } = suggestDefaultRules([makeResult(), makeResult()]);
    expect(rules).toEqual([]);
    expect(note).toMatch(/at least 3/);
  });

  it('derives CPA and ROAS rules from historical averages with enough data', () => {
    const results = [
      makeResult({ cpa: 10, roas: 4 }),
      makeResult({ cpa: 20, roas: 3 }),
      makeResult({ cpa: 30, roas: 2 }),
    ];
    const { rules } = suggestDefaultRules(results);
    const cpaRule = rules.find((r) => r.metric === 'cpa');
    const roasRule = rules.find((r) => r.metric === 'roas');
    expect(cpaRule).toBeDefined();
    expect(roasRule).toBeDefined();
    // avg cpa = 20, threshold should be 1.5x = 30
    expect(cpaRule!.threshold).toBeCloseTo(30, 5);
    // avg roas = 3, threshold should be 0.6x = 1.8
    expect(roasRule!.threshold).toBeCloseTo(1.8, 5);
  });

  it('derived defaults actually flag a result that is meaningfully worse than the historical average', () => {
    const history = [
      makeResult({ cpa: 10, roas: 4 }),
      makeResult({ cpa: 20, roas: 3 }),
      makeResult({ cpa: 30, roas: 2 }),
    ];
    const { rules } = suggestDefaultRules(history);
    const badResult = makeResult({ cpa: 200, roas: 0.5, spend: 500 });
    const flagged = evaluateRules([...history, badResult], rules);
    expect(flagged.some((f) => f.result === badResult)).toBe(true);
  });
});
