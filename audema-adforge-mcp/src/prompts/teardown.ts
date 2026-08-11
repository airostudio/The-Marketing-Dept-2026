/**
 * Competitor ad teardown — the honest alternative to a scraped ad library
 * (Foreplay-style Discovery). This server has no ongoing scraping
 * infrastructure and no crowd-sourced ad database, so instead of faking
 * that, a marketer pastes in a competitor ad's actual copy (screenshotted
 * or copy-pasted from wherever they found it) and gets it run through the
 * same deterministic analysis this server uses on its own concepts —
 * angle-type guess, the same 6-dimension scoring, and concrete "what to
 * borrow / what to avoid" notes.
 */

import { scoreConcept, explainScores } from './scoring.js';
import { CTA_POWER_VERBS } from './copywriting.js';
import { AD_ANGLE_TYPES } from '../types.js';
import type { AdAngleType, AdConcept, AdConceptScores } from '../types.js';

const ANGLE_KEYWORDS: Record<AdAngleType, string[]> = {
  urgency: ['now', 'today', 'ends', 'limited', 'hurry', 'last chance', 'don\'t miss', 'deadline', 'expires', 'only'],
  offer: ['%', 'off', 'free', 'discount', 'deal', 'save $', 'save up to', 'bundle', 'bonus'],
  proof: ['reviews', 'rated', 'trusted by', '#1', 'best-selling', 'testimonial', 'customers', 'award', 'certified', 'as seen in'],
  comparison: [' vs ', ' vs. ', 'better than', 'unlike', 'compare', 'instead of', 'switch from'],
  aspirational: ['imagine', 'dream', 'future', 'transform', 'become', 'unlock', 'elevate', 'life you'],
  'pain-point': [], // default/fallback — no distinctive keywords of its own
};

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary match — a plain .includes() would false-positive on e.g. "off" inside "software". */
function containsKeyword(text: string, keyword: string): boolean {
  const trimmed = keyword.trim();
  // Multi-word phrases (e.g. "last chance") and non-word symbols (e.g. "%") aren't
  // single \w-bounded tokens, so \b boundaries either don't apply cleanly or would
  // be wrong — a plain substring match is the correct check for those.
  if (trimmed.includes(' ') || !/^\w+$/.test(trimmed)) return text.includes(trimmed);
  return new RegExp(`\\b${escapeRegExp(trimmed)}\\b`).test(text);
}

/** Best-effort keyword heuristic — genuinely a guess, not a claim of certainty, and says so in the tool output. */
export function guessAngleType(text: string): AdAngleType {
  const lower = text.toLowerCase();
  let best: AdAngleType = 'pain-point';
  let bestHits = 0;

  for (const angle of AD_ANGLE_TYPES) {
    if (angle === 'pain-point') continue;
    const hits = ANGLE_KEYWORDS[angle].filter((kw) => containsKeyword(lower, kw)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = angle;
    }
  }
  return best;
}

export interface CompetitorAdInput {
  competitorName?: string;
  platform?: string;
  headline: string;
  body?: string;
  cta?: string;
  notes?: string;
}

export interface CompetitorTeardown {
  angleTypeGuess: AdAngleType;
  scores: AdConceptScores;
  scoresExplained: string;
  whatToBorrow: string[];
  whatToAvoid: string[];
}

export function buildCompetitorTeardown(input: CompetitorAdInput): CompetitorTeardown {
  const angleTypeGuess = guessAngleType(`${input.headline} ${input.body ?? ''} ${input.cta ?? ''}`);

  // Build a best-effort AdConcept-shaped object so the SAME scoring logic
  // this server trusts for its own concepts runs against the competitor's
  // copy too — apples-to-apples, not a separate, unvalidated "inspiration"
  // scoring path.
  const asConcept: AdConcept = {
    briefId: 'teardown', // not a real brief — this concept is never persisted
    conceptName: `Teardown: ${input.competitorName ?? 'competitor ad'}`,
    angleType: angleTypeGuess,
    targetEmotion: '',
    customerPainPoint: '',
    hook: input.headline,
    headline: input.headline,
    subheadline: input.body ?? '',
    cta: input.cta ?? '',
    visualDirection: input.notes ?? '',
    conversionRationale: '',
    platformSize: 'square',
  };

  const scores = scoreConcept(asConcept);

  const whatToBorrow: string[] = [];
  const whatToAvoid: string[] = [];

  if (scores.ctaStrength >= 7) {
    const ctaLower = (input.cta ?? '').toLowerCase();
    const verb = CTA_POWER_VERBS.find((v) => ctaLower.startsWith(v));
    whatToBorrow.push(verb ? `Strong CTA construction — leads with the power verb "${verb}", short and direct.` : 'Strong, concise CTA — worth studying the exact phrasing.');
  } else if (scores.ctaStrength <= 4) {
    whatToAvoid.push('Weak/generic CTA — don\'t copy this part.');
  }

  if (scores.clarity >= 7) {
    whatToBorrow.push('Clear, single-idea headline — not trying to cram multiple claims into one line.');
  } else if (scores.clarity <= 4) {
    whatToAvoid.push('Cluttered or overlong headline — a sign even the competitor may be underperforming here.');
  }

  if (scores.emotionalPull >= 6) {
    whatToBorrow.push('Genuine emotional language in the hook/headline — note which specific words did the work.');
  }

  if (scores.visualSimplicity <= 4) {
    whatToAvoid.push('Copy is dense/cluttered for the visual space — this angle would likely need a visual overhaul, not a straight copy.');
  }

  whatToBorrow.push(`Angle: this reads as a "${angleTypeGuess}" angle (best-effort keyword guess, verify against the actual creative) — a real gap-fill if you don\'t already have a concept using this angle.`);

  return { angleTypeGuess, scores, scoresExplained: explainScores(scores), whatToBorrow, whatToAvoid };
}
