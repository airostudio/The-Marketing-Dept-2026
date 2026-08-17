/**
 * Real statistics for A/B testing — sample-size planning and significance
 * testing, not just qualitative advice. Pure math (two-proportion z-test),
 * no external stats library and no proprietary data required.
 */

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation (~1e-7 accurate). */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;

  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1 + sign * y);
}

/** Inverse standard normal CDF (probit) via Acklam's rational approximation (~1.15e-9 accurate). */
function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error('inverseNormalCdf: p must be strictly between 0 and 1');

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

export interface SampleSizeInput {
  baselineConversionRate: number; // 0-1, e.g. 0.03 for 3%
  minimumDetectableEffect: number; // relative, e.g. 0.20 for "detect a 20% relative lift"
  power?: number; // default 0.8 (80% power — standard)
  significanceLevel?: number; // default 0.05 (two-sided)
}

export interface SampleSizeResult {
  perVariantSampleSize: number;
  totalSampleSize: number;
  baselineConversionRate: number;
  targetConversionRate: number;
  minimumDetectableEffect: number;
  power: number;
  significanceLevel: number;
}

/**
 * Two-proportion sample size formula (per variant), standard for a two-sided
 * z-test comparing a control rate to a variant rate with a given relative MDE.
 */
export function calculateSampleSize(input: SampleSizeInput): SampleSizeResult {
  const { baselineConversionRate: p1, minimumDetectableEffect } = input;
  const power = input.power ?? 0.8;
  const alpha = input.significanceLevel ?? 0.05;

  if (p1 <= 0 || p1 >= 1) throw new Error('baselineConversionRate must be strictly between 0 and 1');
  if (minimumDetectableEffect <= 0) throw new Error('minimumDetectableEffect must be positive');

  const p2 = Math.min(0.999999, p1 * (1 + minimumDetectableEffect));
  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const zBeta = inverseNormalCdf(power);

  const pBar = (p1 + p2) / 2;
  const term1 = zAlpha * Math.sqrt(2 * pBar * (1 - pBar));
  const term2 = zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const n = Math.pow(term1 + term2, 2) / Math.pow(p2 - p1, 2);

  const perVariant = Math.ceil(n);
  return {
    perVariantSampleSize: perVariant,
    totalSampleSize: perVariant * 2,
    baselineConversionRate: p1,
    targetConversionRate: p2,
    minimumDetectableEffect,
    power,
    significanceLevel: alpha,
  };
}

export interface VariantData {
  conversions: number;
  visitors: number;
}

export interface SignificanceResult {
  variantAConversionRate: number;
  variantBConversionRate: number;
  relativeLift: number; // (B - A) / A
  zScore: number;
  pValue: number;
  isSignificant: boolean;
  significanceLevel: number;
  winner: 'A' | 'B' | 'inconclusive';
  confidenceLevel: number;
  warning?: string; // e.g. sample too small to trust the result
}

/**
 * Two-proportion z-test. Reports the raw numbers honestly rather than just
 * a verdict — including a warning when the sample is thin enough that the
 * result shouldn't be trusted regardless of what the p-value says.
 */
export function checkSignificance(variantA: VariantData, variantB: VariantData, significanceLevel = 0.05): SignificanceResult {
  if (variantA.visitors <= 0 || variantB.visitors <= 0) {
    throw new Error('Both variants must have at least 1 visitor.');
  }
  if (variantA.conversions > variantA.visitors || variantB.conversions > variantB.visitors) {
    throw new Error('conversions cannot exceed visitors.');
  }

  const p1 = variantA.conversions / variantA.visitors;
  const p2 = variantB.conversions / variantB.visitors;
  const pPooled = (variantA.conversions + variantB.conversions) / (variantA.visitors + variantB.visitors);

  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / variantA.visitors + 1 / variantB.visitors));
  const zScore = se > 0 ? (p2 - p1) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  const isSignificant = pValue < significanceLevel;

  let winner: 'A' | 'B' | 'inconclusive' = 'inconclusive';
  if (isSignificant) winner = p2 > p1 ? 'B' : 'A';

  const MIN_TRUSTWORTHY_SAMPLE = 100; // per variant — below this, even a "significant" result is likely noise
  let warning: string | undefined;
  if (variantA.visitors < MIN_TRUSTWORTHY_SAMPLE || variantB.visitors < MIN_TRUSTWORTHY_SAMPLE) {
    warning = `Sample size is small (A: ${variantA.visitors}, B: ${variantB.visitors} visitors) — even a statistically significant result here is at higher risk of being noise. Prefer waiting for calculate_sample_size's recommended sample before calling a winner.`;
  }

  return {
    variantAConversionRate: p1,
    variantBConversionRate: p2,
    relativeLift: p1 > 0 ? (p2 - p1) / p1 : 0,
    zScore,
    pValue,
    isSignificant,
    significanceLevel,
    winner,
    confidenceLevel: 1 - significanceLevel,
    warning,
  };
}
