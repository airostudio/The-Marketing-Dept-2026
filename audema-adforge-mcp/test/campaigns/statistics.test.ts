import { describe, it, expect } from 'vitest';
import { calculateSampleSize, checkSignificance } from '../../src/campaigns/statistics.js';

describe('calculateSampleSize', () => {
  it('returns a positive integer per-variant size, and total = 2x per-variant', () => {
    const result = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.2 });
    expect(Number.isInteger(result.perVariantSampleSize)).toBe(true);
    expect(result.perVariantSampleSize).toBeGreaterThan(0);
    expect(result.totalSampleSize).toBe(result.perVariantSampleSize * 2);
  });

  it('matches the well-known ballpark for a standard 10% baseline / 20% relative MDE / 80% power / 5% alpha case', () => {
    // This exact configuration (10% baseline, detect a 20% relative lift) is a
    // commonly cited reference case across A/B test calculators, landing in the
    // ~3,800-4,900 per-variant range depending on rounding/continuity-correction
    // choices. A wide-but-bounded tolerance checks the formula is in the right
    // universe without pinning to one calculator's exact rounding.
    const result = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.2 });
    expect(result.perVariantSampleSize).toBeGreaterThan(3000);
    expect(result.perVariantSampleSize).toBeLessThan(6000);
  });

  it('requires a larger sample to detect a smaller effect', () => {
    const bigEffect = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.5 });
    const smallEffect = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.1 });
    expect(smallEffect.perVariantSampleSize).toBeGreaterThan(bigEffect.perVariantSampleSize);
  });

  it('requires a larger sample for higher statistical power', () => {
    const lowPower = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.2, power: 0.7 });
    const highPower = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.2, power: 0.95 });
    expect(highPower.perVariantSampleSize).toBeGreaterThan(lowPower.perVariantSampleSize);
  });

  it('requires a larger sample for a stricter (lower) significance level', () => {
    const lenient = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.2, significanceLevel: 0.1 });
    const strict = calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0.2, significanceLevel: 0.01 });
    expect(strict.perVariantSampleSize).toBeGreaterThan(lenient.perVariantSampleSize);
  });

  it('rejects an out-of-range baseline conversion rate', () => {
    expect(() => calculateSampleSize({ baselineConversionRate: 0, minimumDetectableEffect: 0.2 })).toThrow();
    expect(() => calculateSampleSize({ baselineConversionRate: 1, minimumDetectableEffect: 0.2 })).toThrow();
  });

  it('rejects a non-positive minimum detectable effect', () => {
    expect(() => calculateSampleSize({ baselineConversionRate: 0.1, minimumDetectableEffect: 0 })).toThrow();
  });
});

describe('checkSignificance', () => {
  it('finds no significant difference between identical conversion rates', () => {
    const result = checkSignificance({ conversions: 100, visitors: 1000 }, { conversions: 100, visitors: 1000 });
    expect(result.isSignificant).toBe(false);
    expect(result.winner).toBe('inconclusive');
    expect(Math.abs(result.zScore)).toBeLessThan(0.01);
    expect(result.pValue).toBeGreaterThan(0.9);
  });

  it('detects a clear, large-sample difference as significant with the correct winner', () => {
    const result = checkSignificance({ conversions: 100, visitors: 1000 }, { conversions: 150, visitors: 1000 });
    expect(result.isSignificant).toBe(true);
    expect(result.winner).toBe('B');
    // z ≈ 3.38 for this configuration — a well-known reference value for a
    // 10% vs 15% two-proportion test at n=1000 each.
    expect(result.zScore).toBeGreaterThan(3.2);
    expect(result.zScore).toBeLessThan(3.5);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('picks A as the winner when A converts better', () => {
    const result = checkSignificance({ conversions: 150, visitors: 1000 }, { conversions: 100, visitors: 1000 });
    expect(result.winner).toBe('A');
  });

  it('computes the correct relative lift', () => {
    const result = checkSignificance({ conversions: 100, visitors: 1000 }, { conversions: 120, visitors: 1000 });
    expect(result.relativeLift).toBeCloseTo(0.2, 5); // (0.12 - 0.10) / 0.10
  });

  it('warns when either sample is below the trustworthy threshold, even if "significant"', () => {
    const result = checkSignificance({ conversions: 2, visitors: 20 }, { conversions: 8, visitors: 20 });
    expect(result.warning).toMatch(/small/i);
  });

  it('does not warn once both samples clear the trustworthy threshold', () => {
    const result = checkSignificance({ conversions: 100, visitors: 1000 }, { conversions: 150, visitors: 1000 });
    expect(result.warning).toBeUndefined();
  });

  it('throws on zero visitors', () => {
    expect(() => checkSignificance({ conversions: 0, visitors: 0 }, { conversions: 10, visitors: 100 })).toThrow();
  });

  it('throws when conversions exceed visitors', () => {
    expect(() => checkSignificance({ conversions: 200, visitors: 100 }, { conversions: 10, visitors: 100 })).toThrow();
  });
});
