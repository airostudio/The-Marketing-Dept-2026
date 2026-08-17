import { describe, it, expect } from 'vitest';
import { scoreConcept, explainScores } from '../../src/prompts/scoring.js';
import type { AdConcept } from '../../src/types.js';

function makeConcept(overrides: Partial<AdConcept> = {}): AdConcept {
  return {
    id: 'concept-1',
    briefId: 'brief-1',
    conceptName: 'Test Concept',
    angleType: 'pain-point',
    targetEmotion: 'relief',
    customerPainPoint: 'Losing hours to manual weekly reporting',
    hook: 'Stop drowning in spreadsheets every Friday',
    headline: 'Automate your weekly report in minutes',
    subheadline: 'No more late nights fighting pivot tables',
    cta: 'Start Free Trial',
    visualDirection: 'Clean dashboard screenshot on a gradient background',
    conversionRationale: 'Directly targets the stated pain point with a fast, low-friction CTA',
    platformSize: 'square',
    ...overrides,
  };
}

describe('scoreConcept', () => {
  it('returns every dimension and overall within 0-10', () => {
    const scores = scoreConcept(makeConcept());
    for (const key of ['clarity', 'conversionIntent', 'emotionalPull', 'visualSimplicity', 'platformFit', 'ctaStrength', 'overall'] as const) {
      expect(scores[key]).toBeGreaterThanOrEqual(0);
      expect(scores[key]).toBeLessThanOrEqual(10);
    }
  });

  it('scores a power-verb, short CTA higher than a generic one', () => {
    const strong = scoreConcept(makeConcept({ cta: 'Claim Your Spot' }));
    const generic = scoreConcept(makeConcept({ cta: 'Learn More' }));
    expect(strong.ctaStrength).toBeGreaterThan(generic.ctaStrength);
  });

  it('rewards headline/hook copy that echoes the stated pain point', () => {
    const onTarget = scoreConcept(
      makeConcept({
        customerPainPoint: 'Losing hours to manual reporting spreadsheets',
        hook: 'Tired of manual reporting spreadsheets eating your Friday?',
        headline: 'Kill manual reporting spreadsheets for good',
      })
    );
    const offTarget = scoreConcept(
      makeConcept({
        customerPainPoint: 'Losing hours to manual reporting spreadsheets',
        hook: 'A totally unrelated opening line',
        headline: 'Something about pricing plans',
      })
    );
    expect(onTarget.conversionIntent).toBeGreaterThan(offTarget.conversionIntent);
  });

  it('penalizes an empty headline heavily on clarity', () => {
    const empty = scoreConcept(makeConcept({ headline: '' }));
    const normal = scoreConcept(makeConcept());
    expect(empty.clarity).toBeLessThan(normal.clarity);
  });

  it('penalizes very long, comma-heavy headlines on clarity', () => {
    const bloated = scoreConcept(
      makeConcept({
        headline: 'Save time, save money, save stress, and finally get your evenings back, guaranteed',
      })
    );
    const concise = scoreConcept(makeConcept({ headline: 'Get your evenings back' }));
    expect(bloated.clarity).toBeLessThan(concise.clarity);
  });
});

describe('explainScores', () => {
  it('includes every dimension label and the overall line', () => {
    const scores = scoreConcept(makeConcept());
    const text = explainScores(scores);
    expect(text).toContain('Clarity');
    expect(text).toContain('Conversion intent');
    expect(text).toContain('Emotional pull');
    expect(text).toContain('Visual simplicity');
    expect(text).toContain('Platform fit');
    expect(text).toContain('CTA strength');
    expect(text).toContain('Overall:');
  });

  it('flags dimensions below 5 as weak', () => {
    const text = explainScores({
      clarity: 2, conversionIntent: 8, emotionalPull: 8, visualSimplicity: 8, platformFit: 8, ctaStrength: 8, overall: 7,
    });
    expect(text).toContain('⚠️ weak');
  });
});
