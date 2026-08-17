import { describe, it, expect } from 'vitest';
import { generateCombinations, filterForbiddenPhrases } from '../../src/campaigns/dco.js';

describe('generateCombinations', () => {
  it('produces the full cartesian product when under the cap', () => {
    const result = generateCombinations({
      headlines: ['H1', 'H2'],
      subheadlines: ['S1'],
      ctas: ['C1', 'C2'],
      visualDirections: ['V1'],
    });
    expect(result.totalPossible).toBe(4); // 2 * 1 * 2 * 1
    expect(result.combinations).toHaveLength(4);
    expect(result.truncated).toBe(false);
  });

  it('defaults subheadlines to a single blank entry when omitted', () => {
    const result = generateCombinations({
      headlines: ['H1'],
      subheadlines: [],
      ctas: ['C1'],
      visualDirections: ['V1'],
    });
    expect(result.combinations).toHaveLength(1);
    expect(result.combinations[0].subheadline).toBe('');
  });

  it('truncates to maxCombinations and reports it honestly', () => {
    const result = generateCombinations({
      headlines: ['H1', 'H2', 'H3'],
      subheadlines: ['S1', 'S2', 'S3'],
      ctas: ['C1', 'C2', 'C3'],
      visualDirections: ['V1', 'V2', 'V3'],
      maxCombinations: 10,
    });
    expect(result.totalPossible).toBe(81); // 3^4
    expect(result.combinations).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('never exceeds the hard 60-combination ceiling even if a huge maxCombinations is requested', () => {
    const result = generateCombinations({
      headlines: Array.from({ length: 5 }, (_, i) => `H${i}`),
      subheadlines: Array.from({ length: 5 }, (_, i) => `S${i}`),
      ctas: Array.from({ length: 5 }, (_, i) => `C${i}`),
      visualDirections: Array.from({ length: 5 }, (_, i) => `V${i}`),
      maxCombinations: 10_000,
    });
    expect(result.combinations.length).toBeLessThanOrEqual(60);
  });

  it('rejects empty required arrays', () => {
    expect(() => generateCombinations({ headlines: [], subheadlines: [], ctas: ['C1'], visualDirections: ['V1'] })).toThrow();
    expect(() => generateCombinations({ headlines: ['H1'], subheadlines: [], ctas: [], visualDirections: ['V1'] })).toThrow();
    expect(() => generateCombinations({ headlines: ['H1'], subheadlines: [], ctas: ['C1'], visualDirections: [] })).toThrow();
  });

  it('produces genuinely distinct combinations, not duplicates', () => {
    const result = generateCombinations({
      headlines: ['H1', 'H2'],
      subheadlines: [''],
      ctas: ['C1', 'C2'],
      visualDirections: ['V1'],
    });
    const serialized = result.combinations.map((c) => `${c.headline}|${c.cta}`);
    expect(new Set(serialized).size).toBe(serialized.length);
  });
});

describe('filterForbiddenPhrases', () => {
  const combos = [
    { headline: 'Best deal ever', subheadline: '', cta: 'Buy now', visualDirection: 'bright' },
    { headline: 'Guaranteed results', subheadline: '', cta: 'Sign up', visualDirection: 'dark' },
  ];

  it('passes everything through when there are no forbidden phrases', () => {
    const result = filterForbiddenPhrases(combos, []);
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('drops a combination whose text contains a forbidden phrase, case-insensitively', () => {
    const result = filterForbiddenPhrases(combos, ['guaranteed']);
    expect(result.kept).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].matchedPhrase).toBe('guaranteed');
  });

  it('checks all four text fields, not just the headline', () => {
    const withCtaViolation = [{ headline: 'Clean', subheadline: 'Clean', cta: 'Guaranteed savings', visualDirection: 'Clean' }];
    const result = filterForbiddenPhrases(withCtaViolation, ['guaranteed']);
    expect(result.kept).toHaveLength(0);
  });
});
