import type { AdConcept, AdConceptScores, BrandProfile, PlatformSizeKey } from '../types.js';
import { CTA_POWER_VERBS } from './copywriting.js';

/**
 * Deterministic heuristic scoring — genuinely computed from the concept's
 * text, not delegated back to an LLM. This is intentionally conservative:
 * it catches clear weaknesses (generic CTAs, bloated headlines, missing
 * emotional language) so a human or the calling model can decide whether
 * to revise, rather than pretending to grade "quality" precisely.
 */

const GENERIC_CTA_PHRASES = ['learn more', 'click here', 'find out more', 'read more', 'submit', 'discover more'];

const EMOTION_WORDS = [
  'finally', 'relief', 'tired', 'stop', 'never again', 'imagine', 'feel', 'love', 'proud',
  'worry', 'stress', 'confident', 'peace of mind', 'frustrated', 'exhausted', 'excited',
  'afraid', 'fear', 'dream', 'freedom', 'effortless', 'trust',
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function containsNumber(s: string): boolean {
  return /\d/.test(s);
}

function scoreClarity(concept: AdConcept): number {
  let score = 10;
  const headlineWords = wordCount(concept.headline);
  const subWords = wordCount(concept.subheadline);

  if (headlineWords > 12) score -= 3;
  else if (headlineWords > 9) score -= 1.5;
  if (headlineWords === 0) score -= 6;

  if (subWords > 20) score -= 2;

  // Penalize headlines that try to cram multiple ideas (heuristic: many commas/"and")
  const conjunctionCount = (concept.headline.match(/,| and /gi) || []).length;
  if (conjunctionCount >= 2) score -= 2;

  return clamp(score);
}

function scoreConversionIntent(concept: AdConcept): number {
  let score = 5;
  const painLower = concept.customerPainPoint.toLowerCase();
  const hookLower = concept.hook.toLowerCase();
  const headlineLower = concept.headline.toLowerCase();

  // Does the hook or headline actually reference the stated pain point (word overlap)?
  const painWords = painLower.split(/\W+/).filter((w) => w.length > 3);
  const overlap = painWords.filter((w) => hookLower.includes(w) || headlineLower.includes(w));
  if (painWords.length > 0) {
    score += Math.min(3, (overlap.length / painWords.length) * 4);
  }

  if (containsNumber(concept.headline) || containsNumber(concept.subheadline)) score += 1;

  return clamp(score);
}

function scoreEmotionalPull(concept: AdConcept): number {
  let score = 4;
  const text = `${concept.hook} ${concept.headline} ${concept.subheadline}`.toLowerCase();
  const hits = EMOTION_WORDS.filter((w) => text.includes(w));
  score += Math.min(4, hits.length * 1.5);

  if (concept.targetEmotion && concept.targetEmotion.trim().length > 0) score += 1;

  return clamp(score);
}

function scoreVisualSimplicity(concept: AdConcept): number {
  let score = 8;
  const totalCopyLength =
    concept.headline.length +
    concept.subheadline.length +
    (concept.proofPoint?.length || 0) +
    (concept.urgencyLine?.length || 0);

  if (totalCopyLength > 220) score -= 3;
  else if (totalCopyLength > 150) score -= 1.5;

  const visualElementCount = (concept.visualDirection.match(/,|;| and /gi) || []).length;
  if (visualElementCount > 5) score -= 2;

  return clamp(score);
}

function scorePlatformFit(concept: AdConcept): number {
  let score = 7;
  const size = concept.platformSize as PlatformSizeKey;
  const totalWords = wordCount(concept.headline) + wordCount(concept.subheadline);

  // Story/portrait formats are consumed fast — punish long copy harder.
  if ((size === 'story' || size === 'portrait') && totalWords > 22) score -= 3;
  // Landscape link ads can carry a bit more copy.
  if (size === 'landscape' && totalWords > 30) score -= 2;
  if (size === 'square' && totalWords > 26) score -= 2;

  return clamp(score);
}

function scoreCtaStrength(concept: AdConcept): number {
  let score = 5;
  const ctaLower = concept.cta.toLowerCase().trim();
  const words = wordCount(concept.cta);

  if (GENERIC_CTA_PHRASES.some((g) => ctaLower === g || ctaLower.includes(g))) score -= 3;
  if (CTA_POWER_VERBS.some((v) => ctaLower.startsWith(v))) score += 2.5;
  if (words >= 2 && words <= 4) score += 1.5;
  if (words > 6) score -= 1.5;
  if (containsNumber(concept.cta)) score += 1;

  return clamp(score);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

export type ScoreDimension = 'clarity' | 'conversionIntent' | 'emotionalPull' | 'visualSimplicity' | 'platformFit' | 'ctaStrength';
export type ScoreWeights = Record<ScoreDimension, number>;

export const DEFAULT_WEIGHTS: ScoreWeights = {
  clarity: 0.2,
  conversionIntent: 0.2,
  emotionalPull: 0.15,
  visualSimplicity: 0.15,
  platformFit: 0.1,
  ctaStrength: 0.2,
};

/**
 * @param weights Defaults to the fixed global weights. Pass a per-brand
 * calibrated set (see src/prompts/calibration.ts) to weight dimensions by
 * what has actually correlated with this brand's real results — the
 * individual dimension scores themselves are unaffected either way.
 */
export function scoreConcept(concept: AdConcept, _brand?: BrandProfile, weights: ScoreWeights = DEFAULT_WEIGHTS): AdConceptScores {
  const clarity = scoreClarity(concept);
  const conversionIntent = scoreConversionIntent(concept);
  const emotionalPull = scoreEmotionalPull(concept);
  const visualSimplicity = scoreVisualSimplicity(concept);
  const platformFit = scorePlatformFit(concept);
  const ctaStrength = scoreCtaStrength(concept);

  const overall =
    clarity * weights.clarity +
    conversionIntent * weights.conversionIntent +
    emotionalPull * weights.emotionalPull +
    visualSimplicity * weights.visualSimplicity +
    platformFit * weights.platformFit +
    ctaStrength * weights.ctaStrength;

  return {
    clarity,
    conversionIntent,
    emotionalPull,
    visualSimplicity,
    platformFit,
    ctaStrength,
    overall: clamp(overall),
  };
}

export function explainScores(scores: AdConceptScores): string {
  const lines: string[] = [];
  const entries: [string, number][] = [
    ['Clarity', scores.clarity],
    ['Conversion intent', scores.conversionIntent],
    ['Emotional pull', scores.emotionalPull],
    ['Visual simplicity', scores.visualSimplicity],
    ['Platform fit', scores.platformFit],
    ['CTA strength', scores.ctaStrength],
  ];
  entries.forEach(([label, val]) => {
    const flag = val < 5 ? ' ⚠️ weak' : val >= 8 ? ' ✓ strong' : '';
    lines.push(`  - ${label}: ${val}/10${flag}`);
  });
  lines.push(`  **Overall: ${scores.overall}/10**`);
  return lines.join('\n');
}
