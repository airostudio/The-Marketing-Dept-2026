/**
 * Per-brand score calibration — the honest, small-sample alternative to
 * AdCreative.ai/Madgicx's "predicts CTR with 90% accuracy" claims, which
 * depend on proprietary cross-account training data this server doesn't
 * have. Instead of a black-box prediction, this computes a transparent
 * correlation between each of the six heuristic scoring dimensions and a
 * brand's OWN actual campaign outcomes (via save_campaign_result), and
 * nudges that brand's scoring weights — modestly, boundedly — toward
 * whatever has actually correlated with success for THEM specifically.
 *
 * Deliberately conservative: requires a minimum sample before adjusting
 * anything, and caps how far any single weight can move, so a handful of
 * noisy results can't wildly distort scoring. Below the minimum sample,
 * this returns the unmodified default weights and says so plainly.
 */

import { DEFAULT_WEIGHTS } from './scoring.js';
import type { ScoreDimension, ScoreWeights } from './scoring.js';
import type { AdConcept, CampaignResult } from '../types.js';

const DIMENSIONS: ScoreDimension[] = ['clarity', 'conversionIntent', 'emotionalPull', 'visualSimplicity', 'platformFit', 'ctaStrength'];
const MIN_SAMPLE_SIZE = 5;
const MAX_WEIGHT_SHIFT = 0.4; // correlation is clamped to [-0.5, 0.5] then scaled by this — max ±20% weight change per dimension

/** Pearson correlation coefficient. Returns 0 for a degenerate (zero-variance) series rather than NaN. */
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n !== ys.length || n === 0) return 0;

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return 0;
  return cov / Math.sqrt(varX * varY);
}

function outcomeMetric(result: CampaignResult): number | undefined {
  return result.roas ?? result.ctr;
}

export interface CalibrationSample {
  scores: AdConcept['scores'];
  outcome: number;
}

export interface BrandCalibration {
  weights: ScoreWeights;
  calibrated: boolean;
  sampleSize: number;
  correlations: Partial<Record<ScoreDimension, number>>;
  insights: string[];
  note: string;
}

/**
 * Pure function over paired (concept scores, outcome) samples — kept
 * separate from storage lookups so it's directly unit-testable and reusable
 * (the calling tool does the store lookups and passes in the pairs).
 */
export function computeCalibration(samples: CalibrationSample[]): BrandCalibration {
  const valid = samples.filter((s) => s.scores);
  if (valid.length < MIN_SAMPLE_SIZE) {
    return {
      weights: DEFAULT_WEIGHTS,
      calibrated: false,
      sampleSize: valid.length,
      correlations: {},
      insights: [],
      note: `Only ${valid.length} scored concept(s) have linked campaign results — need at least ${MIN_SAMPLE_SIZE} to calibrate. Using default scoring weights for now. Link more save_campaign_result calls to conceptId to build this up.`,
    };
  }

  const correlations: Partial<Record<ScoreDimension, number>> = {};
  const outcomes = valid.map((s) => s.outcome);

  for (const dim of DIMENSIONS) {
    const dimScores = valid.map((s) => s.scores![dim]);
    correlations[dim] = pearsonCorrelation(dimScores, outcomes);
  }

  const rawWeights: ScoreWeights = { ...DEFAULT_WEIGHTS };
  for (const dim of DIMENSIONS) {
    const corr = Math.max(-0.5, Math.min(0.5, correlations[dim] ?? 0));
    rawWeights[dim] = DEFAULT_WEIGHTS[dim] * (1 + corr * MAX_WEIGHT_SHIFT);
  }

  // Renormalize so weights still sum to 1 — otherwise "overall" would drift
  // out of its documented 0-10 range.
  const total = DIMENSIONS.reduce((sum, dim) => sum + rawWeights[dim], 0);
  const weights: ScoreWeights = DIMENSIONS.reduce((acc, dim) => {
    acc[dim] = rawWeights[dim] / total;
    return acc;
  }, {} as ScoreWeights);

  const insights = DIMENSIONS
    .filter((dim) => Math.abs(correlations[dim] ?? 0) >= 0.3)
    .sort((a, b) => Math.abs(correlations[b] ?? 0) - Math.abs(correlations[a] ?? 0))
    .map((dim) => {
      const corr = correlations[dim]!;
      return `${dim} ${corr > 0 ? 'correlates positively' : 'correlates negatively'} with this brand's real performance (r=${corr.toFixed(2)}) — weighted ${corr > 0 ? 'up' : 'down'} accordingly.`;
    });

  return {
    weights,
    calibrated: true,
    sampleSize: valid.length,
    correlations,
    insights,
    note: `Calibrated from ${valid.length} linked campaign result(s). This is a lightweight per-brand tendency signal from a small sample, not a validated predictive model — treat it as directional, not certain.`,
  };
}
