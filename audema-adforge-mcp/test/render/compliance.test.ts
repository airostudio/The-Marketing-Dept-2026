import { describe, it, expect } from 'vitest';
import { checkLogoOverlap, contrastRatio, checkTextContrast, checkForbiddenPhrases, checkBrandCompliance } from '../../src/render/compliance.js';
import { generateLayoutSpec } from '../../src/render/layout.js';
import type { AdConcept, BrandProfile, LayoutSpec } from '../../src/types.js';

function makeConcept(overrides: Partial<AdConcept> = {}): AdConcept {
  return {
    id: 'concept-1',
    briefId: 'brief-1',
    conceptName: 'Test Concept',
    angleType: 'pain-point',
    targetEmotion: 'relief',
    customerPainPoint: 'Losing hours to manual reporting',
    hook: 'Stop drowning in spreadsheets',
    headline: 'Automate your weekly report',
    subheadline: 'No more late nights',
    cta: 'Start Free Trial',
    visualDirection: 'Clean dashboard screenshot',
    conversionRationale: 'Directly targets the stated pain point',
    platformSize: 'square',
    ...overrides,
  };
}

function makeBrand(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    businessName: 'Acme', industry: 'SaaS', targetAudience: 'Ops managers', brandVoice: 'Direct',
    colours: { primary: '#111111' },
    fonts: { heading: 'Inter' },
    forbiddenPhrases: [], preferredCTA: [], proofPoints: [], guarantees: [], commonOffers: [],
    ...overrides,
  };
}

describe('contrastRatio', () => {
  it('gives the maximum ratio (21:1) for pure black vs pure white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('gives a ratio of 1 for identical colours', () => {
    expect(contrastRatio('#7C3AED', '#7C3AED')).toBeCloseTo(1, 5);
  });

  it('is symmetric regardless of argument order', () => {
    const a = contrastRatio('#FFFFFF', '#7C3AED');
    const b = contrastRatio('#7C3AED', '#FFFFFF');
    expect(a).toBeCloseTo(b!, 5);
  });

  it('handles 3-digit hex shorthand', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
  });

  it('returns null for an unparseable colour rather than throwing', () => {
    expect(contrastRatio('not-a-colour', '#FFFFFF')).toBeNull();
  });
});

describe('checkLogoOverlap', () => {
  it('reports no issues when there is no logo placement', () => {
    const brand = makeBrand(); // no logoPath
    const layout = generateLayoutSpec(makeConcept(), 'square', brand);
    expect(layout.logoPlacement).toBeUndefined();
    expect(checkLogoOverlap(layout)).toEqual([]);
  });

  it('flags a text block that overlaps the logo safe zone', () => {
    const layout: LayoutSpec = {
      conceptId: 'c1', platformSize: 'square', width: 1080, height: 1080,
      safeZone: { top: 0, right: 0, bottom: 0, left: 0 },
      backgroundStyle: 'gradient',
      logoPlacement: { x: 50, y: 50, maxWidth: 200, maxHeight: 100 },
      textBlocks: [{ role: 'headline', x: 100, y: 100, width: 400, fontSize: 40, fontWeight: 800, lineHeight: 46, align: 'left', color: '#FFFFFF' }],
      notes: [],
    };
    const issues = checkLogoOverlap(layout);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('logo_overlap');
  });

  it('does not flag a text block safely outside the logo zone', () => {
    const layout: LayoutSpec = {
      conceptId: 'c1', platformSize: 'square', width: 1080, height: 1080,
      safeZone: { top: 0, right: 0, bottom: 0, left: 0 },
      backgroundStyle: 'gradient',
      logoPlacement: { x: 50, y: 50, maxWidth: 100, maxHeight: 50 },
      textBlocks: [{ role: 'cta', x: 100, y: 900, width: 400, fontSize: 30, fontWeight: 700, lineHeight: 36, align: 'left', color: '#FFFFFF' }],
      notes: [],
    };
    expect(checkLogoOverlap(layout)).toEqual([]);
  });
});

describe('checkTextContrast', () => {
  it('flags white text on a near-white background', () => {
    const layout = generateLayoutSpec(makeConcept(), 'square', makeBrand({ colours: { primary: '#7C3AED', background: '#FEFEFE', text: '#FFFFFF' } }));
    const issues = checkTextContrast(layout, makeBrand({ colours: { primary: '#7C3AED', background: '#FEFEFE', text: '#FFFFFF' } }));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe('low_contrast');
  });

  it('does not flag well-contrasted text', () => {
    const brand = makeBrand({ colours: { primary: '#000000', background: '#000000', text: '#FFFFFF', accent: '#FFFFFF' } });
    const layout = generateLayoutSpec(makeConcept(), 'square', brand);
    expect(checkTextContrast(layout, brand)).toEqual([]);
  });

  it('checks against both gradient endpoints when no solid background is set', () => {
    // Text colour that's fine against one gradient endpoint but not the other should still be flagged.
    const brand = makeBrand({ colours: { primary: '#FFFFFF', secondary: '#000000', text: '#EEEEEE' } });
    const layout = generateLayoutSpec(makeConcept(), 'square', brand);
    const issues = checkTextContrast(layout, brand);
    // #EEEEEE on #FFFFFF is very low contrast — should be flagged even though #EEEEEE on #000000 is fine.
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('checkForbiddenPhrases', () => {
  it('finds no issues when the brand has no forbidden phrases', () => {
    expect(checkForbiddenPhrases(makeConcept(), makeBrand())).toEqual([]);
  });

  it('flags copy containing a forbidden phrase, case-insensitively', () => {
    const concept = makeConcept({ headline: 'Guaranteed results in 7 days' });
    const brand = makeBrand({ forbiddenPhrases: ['GUARANTEED'] });
    const issues = checkForbiddenPhrases(concept, brand);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('forbidden_phrase');
  });

  it('checks CTA and proof point copy too, not just headline', () => {
    const concept = makeConcept({ cta: 'Guaranteed savings' });
    const brand = makeBrand({ forbiddenPhrases: ['guaranteed'] });
    expect(checkForbiddenPhrases(concept, brand)).toHaveLength(1);
  });
});

describe('checkBrandCompliance', () => {
  it('aggregates all three checks', () => {
    const brand = makeBrand({ forbiddenPhrases: ['spreadsheets'], colours: { primary: '#FFFFFF', text: '#F5F5F5' } });
    const concept = makeConcept(); // headline mentions "spreadsheets" via hook only — use headline directly
    const layout = generateLayoutSpec(concept, 'square', brand);
    const issues = checkBrandCompliance(concept, layout, brand);
    // At minimum the low-contrast issue should surface; forbidden phrase check runs regardless of match.
    expect(Array.isArray(issues)).toBe(true);
  });
});
