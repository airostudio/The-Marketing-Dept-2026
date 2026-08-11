/**
 * Dynamic Creative Optimization (DCO) — combinatorial variant generation.
 * Smartly.io/Celtra-style: given N headlines × M subheadlines × K CTAs ×
 * J visual directions, assemble every valid combination as a distinct,
 * scoreable concept, rather than a marketer hand-writing each permutation.
 *
 * Deliberately bounded — an uncapped cartesian product across even modest
 * arrays explodes fast (5×5×5×5 = 625), and nobody needs 625 ad variants
 * scored and saved. maxCombinations defaults conservatively and is always
 * enforced, with the truncation made explicit rather than silent.
 */

export interface CombinationInputs {
  headlines: string[];
  subheadlines: string[];
  ctas: string[];
  visualDirections: string[];
  maxCombinations?: number;
}

export interface CreativeCombination {
  headline: string;
  subheadline: string;
  cta: string;
  visualDirection: string;
}

export interface CombinationResult {
  combinations: CreativeCombination[];
  totalPossible: number;
  truncated: boolean;
}

const DEFAULT_MAX_COMBINATIONS = 24;
const HARD_MAX_COMBINATIONS = 60; // absolute ceiling regardless of what's requested

export function generateCombinations(input: CombinationInputs): CombinationResult {
  const { headlines, subheadlines, ctas, visualDirections } = input;
  if (!headlines.length || !ctas.length || !visualDirections.length) {
    throw new Error('headlines, ctas, and visualDirections must each have at least one entry.');
  }
  const subs = subheadlines.length ? subheadlines : [''];

  const totalPossible = headlines.length * subs.length * ctas.length * visualDirections.length;
  const cap = Math.min(input.maxCombinations ?? DEFAULT_MAX_COMBINATIONS, HARD_MAX_COMBINATIONS);

  const combinations: CreativeCombination[] = [];
  outer: for (const headline of headlines) {
    for (const subheadline of subs) {
      for (const cta of ctas) {
        for (const visualDirection of visualDirections) {
          if (combinations.length >= cap) break outer;
          combinations.push({ headline, subheadline, cta, visualDirection });
        }
      }
    }
  }

  return { combinations, totalPossible, truncated: totalPossible > combinations.length };
}

export interface FilterResult {
  kept: CreativeCombination[];
  removed: { combination: CreativeCombination; matchedPhrase: string }[];
}

/** Drops any combination whose assembled copy contains a brand-forbidden phrase — never silently, the removal is reported. */
export function filterForbiddenPhrases(combinations: CreativeCombination[], forbiddenPhrases: string[]): FilterResult {
  if (!forbiddenPhrases.length) return { kept: combinations, removed: [] };

  const kept: CreativeCombination[] = [];
  const removed: FilterResult['removed'] = [];

  for (const combo of combinations) {
    const text = `${combo.headline} ${combo.subheadline} ${combo.cta} ${combo.visualDirection}`.toLowerCase();
    const match = forbiddenPhrases.find((phrase) => phrase && text.includes(phrase.toLowerCase()));
    if (match) {
      removed.push({ combination: combo, matchedPhrase: match });
    } else {
      kept.push(combo);
    }
  }

  return { kept, removed };
}
