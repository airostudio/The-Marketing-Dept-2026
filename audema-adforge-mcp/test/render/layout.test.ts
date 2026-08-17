import { describe, it, expect } from 'vitest';
import { generateLayoutSpec } from '../../src/render/layout.js';
import { PLATFORM_SIZES } from '../../src/types.js';
import type { AdConcept, BrandProfile, PlatformSizeKey } from '../../src/types.js';

function makeConcept(overrides: Partial<AdConcept> = {}): AdConcept {
  return {
    id: 'concept-1',
    briefId: 'brief-1',
    conceptName: 'Test Concept',
    angleType: 'pain-point',
    targetEmotion: 'relief',
    customerPainPoint: 'Losing hours to manual reporting',
    hook: 'Stop drowning in spreadsheets',
    headline: 'Automate your weekly report in minutes',
    subheadline: 'No more late nights fighting pivot tables',
    cta: 'Start Free Trial',
    visualDirection: 'Clean dashboard screenshot on a gradient background',
    conversionRationale: 'Directly targets the stated pain point with a fast, low-friction CTA',
    platformSize: 'square',
    ...overrides,
  };
}

const ALL_SIZES: PlatformSizeKey[] = ['square', 'portrait', 'landscape', 'story'];

describe('generateLayoutSpec', () => {
  it.each(ALL_SIZES)('returns canvas dimensions matching PLATFORM_SIZES for %s', (size) => {
    const layout = generateLayoutSpec(makeConcept({ platformSize: size }), size, undefined);
    expect(layout.width).toBe(PLATFORM_SIZES[size].width);
    expect(layout.height).toBe(PLATFORM_SIZES[size].height);
  });

  it('always includes headline, subheadline, and cta blocks', () => {
    const layout = generateLayoutSpec(makeConcept(), 'square', undefined);
    const roles = layout.textBlocks.map((b) => b.role);
    expect(roles).toContain('headline');
    expect(roles).toContain('subheadline');
    expect(roles).toContain('cta');
  });

  it('only includes proofPoint/urgencyLine blocks when the concept has that copy', () => {
    const withoutExtras = generateLayoutSpec(makeConcept(), 'square', undefined);
    expect(withoutExtras.textBlocks.some((b) => b.role === 'proofPoint')).toBe(false);
    expect(withoutExtras.textBlocks.some((b) => b.role === 'urgencyLine')).toBe(false);

    const withExtras = generateLayoutSpec(
      makeConcept({ proofPoint: '4.9 stars from 2,000+ customers', urgencyLine: 'Offer ends Friday' }),
      'square',
      undefined
    );
    expect(withExtras.textBlocks.some((b) => b.role === 'proofPoint')).toBe(true);
    expect(withExtras.textBlocks.some((b) => b.role === 'urgencyLine')).toBe(true);
  });

  it('keeps the CTA block within the canvas bounds', () => {
    for (const size of ALL_SIZES) {
      const layout = generateLayoutSpec(makeConcept({ platformSize: size }), size, undefined);
      const cta = layout.textBlocks.find((b) => b.role === 'cta')!;
      expect(cta.y).toBeGreaterThanOrEqual(0);
      expect(cta.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it('gives vertical formats (story/portrait) a larger top safe-zone margin than square/landscape', () => {
    const story = generateLayoutSpec(makeConcept({ platformSize: 'story' }), 'story', undefined);
    const square = generateLayoutSpec(makeConcept({ platformSize: 'square' }), 'square', undefined);
    // Compare as a fraction of height since the two formats have different absolute heights.
    expect(story.safeZone.top / story.height).toBeGreaterThan(square.safeZone.top / square.height);
  });

  it('only includes logoPlacement when the brand profile has a logoPath', () => {
    const brandWithLogo: BrandProfile = {
      businessName: 'Acme',
      industry: 'SaaS',
      targetAudience: 'Ops managers',
      brandVoice: 'Direct, confident',
      colours: { primary: '#111111' },
      fonts: { heading: 'Inter' },
      logoPath: '/tmp/logo.png',
      forbiddenPhrases: [],
      preferredCTA: [],
      proofPoints: [],
      guarantees: [],
      commonOffers: [],
    };

    const withLogo = generateLayoutSpec(makeConcept(), 'square', brandWithLogo);
    expect(withLogo.logoPlacement).toBeDefined();

    const withoutLogo = generateLayoutSpec(makeConcept(), 'square', undefined);
    expect(withoutLogo.logoPlacement).toBeUndefined();
  });
});
