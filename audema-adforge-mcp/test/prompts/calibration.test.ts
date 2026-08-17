import { describe, it, expect } from 'vitest';
import { pearsonCorrelation, computeCalibration } from '../../src/prompts/calibration.js';
import { DEFAULT_WEIGHTS } from '../../src/prompts/scoring.js';
import type { AdConceptScores } from '../../src/types.js';
import type { CalibrationSample } from '../../src/prompts/calibration.js';

function makeScores(overrides: Partial<AdConceptScores> = {}): AdConceptScores {
  return {
    clarity: 5, conversionIntent: 5, emotionalPull: 5, visualSimplicity: 5, platformFit: 5, ctaStrength: 5,
    overall: 5,
    ...overrides,
  };
}

describe('pearsonCorrelation', () => {
  it('is 1 for a perfect positive linear relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
  });

  it('is -1 for a perfect negative linear relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
  });

  it('is 0 for a constant (zero-variance) series rather than NaN', () => {
    expect(pearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
  });

  it('is 0 for empty or mismatched-length input rather than throwing', () => {
    expect(pearsonCorrelation([], [])).toBe(0);
    expect(pearsonCorrelation([1, 2], [1])).toBe(0);
  });
});

describe('computeCalibration', () => {
  it('refuses to calibrate below the minimum sample size and returns default weights unchanged', () => {
    const samples: CalibrationSample[] = [
      { scores: makeScores(), outcome: 3 },
      { scores: makeScores(), outcome: 4 },
    ];
    const result = computeCalibration(samples);
    expect(result.calibrated).toBe(false);
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
    expect(result.note).toMatch(/at least 5/);
  });

  it('calibrates once the minimum sample is met, and weights still sum to 1', () => {
    const samples: CalibrationSample[] = [
      { scores: makeScores({ ctaStrength: 9 }), outcome: 8 },
      { scores: makeScores({ ctaStrength: 8 }), outcome: 7 },
      { scores: makeScores({ ctaStrength: 2 }), outcome: 1 },
      { scores: makeScores({ ctaStrength: 3 }), outcome: 2 },
      { scores: makeScores({ ctaStrength: 7 }), outcome: 6 },
    ];
    const result = computeCalibration(samples);
    expect(result.calibrated).toBe(true);
    expect(result.sampleSize).toBe(5);

    const total = Object.values(result.weights).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('weights a dimension UP when it strongly, positively correlates with outcome', () => {
    // ctaStrength tracks outcome almost perfectly; other dimensions are flat/uncorrelated.
    const samples: CalibrationSample[] = [
      { scores: makeScores({ ctaStrength: 9 }), outcome: 9 },
      { scores: makeScores({ ctaStrength: 7 }), outcome: 7 },
      { scores: makeScores({ ctaStrength: 5 }), outcome: 5 },
      { scores: makeScores({ ctaStrength: 3 }), outcome: 3 },
      { scores: makeScores({ ctaStrength: 1 }), outcome: 1 },
    ];
    const result = computeCalibration(samples);
    expect(result.weights.ctaStrength).toBeGreaterThan(DEFAULT_WEIGHTS.ctaStrength);
    expect(result.correlations.ctaStrength).toBeGreaterThan(0.9);
  });

  it('weights a dimension DOWN when it strongly, negatively correlates with outcome', () => {
    const samples: CalibrationSample[] = [
      { scores: makeScores({ clarity: 9 }), outcome: 1 },
      { scores: makeScores({ clarity: 7 }), outcome: 3 },
      { scores: makeScores({ clarity: 5 }), outcome: 5 },
      { scores: makeScores({ clarity: 3 }), outcome: 7 },
      { scores: makeScores({ clarity: 1 }), outcome: 9 },
    ];
    const result = computeCalibration(samples);
    expect(result.weights.clarity).toBeLessThan(DEFAULT_WEIGHTS.clarity);
  });

  it('never shifts a single weight by more than the bounded cap (±20%)', () => {
    // Perfect correlation is the maximum possible signal — even then, the shift must stay bounded.
    const samples: CalibrationSample[] = [
      { scores: makeScores({ ctaStrength: 10 }), outcome: 10 },
      { scores: makeScores({ ctaStrength: 8 }), outcome: 8 },
      { scores: makeScores({ ctaStrength: 6 }), outcome: 6 },
      { scores: makeScores({ ctaStrength: 4 }), outcome: 4 },
      { scores: makeScores({ ctaStrength: 2 }), outcome: 2 },
    ];
    const result = computeCalibration(samples);
    // Compare the RAW (pre-normalization) shift bound conceptually: normalized
    // weight can move further due to renormalization, but should stay sane —
    // assert it's not wildly larger than the ~20% raw cap would suggest.
    const ratio = result.weights.ctaStrength / DEFAULT_WEIGHTS.ctaStrength;
    expect(ratio).toBeLessThan(1.3);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it('filters out samples with no scores before checking the minimum', () => {
    const samples: CalibrationSample[] = [
      { scores: undefined, outcome: 3 },
      { scores: undefined, outcome: 4 },
      { scores: makeScores(), outcome: 5 },
    ];
    const result = computeCalibration(samples);
    expect(result.calibrated).toBe(false);
    expect(result.sampleSize).toBe(1);
  });

  it('surfaces an insight line only for dimensions with meaningful correlation (|r| >= 0.3)', () => {
    const samples: CalibrationSample[] = [
      { scores: makeScores({ ctaStrength: 9, clarity: 5 }), outcome: 9 },
      { scores: makeScores({ ctaStrength: 7, clarity: 5 }), outcome: 7 },
      { scores: makeScores({ ctaStrength: 5, clarity: 5 }), outcome: 5 },
      { scores: makeScores({ ctaStrength: 3, clarity: 5 }), outcome: 3 },
      { scores: makeScores({ ctaStrength: 1, clarity: 5 }), outcome: 1 },
    ];
    const result = computeCalibration(samples);
    expect(result.insights.some((i) => i.includes('ctaStrength'))).toBe(true);
    expect(result.insights.some((i) => i.includes('clarity'))).toBe(false); // constant clarity → 0 correlation, no variance
  });
});
