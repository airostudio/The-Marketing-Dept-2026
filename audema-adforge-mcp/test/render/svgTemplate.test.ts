import { describe, it, expect } from 'vitest';
import { buildAdSvg } from '../../src/render/svgTemplate.js';
import { generateLayoutSpec } from '../../src/render/layout.js';
import type { AdConcept, BrandProfile } from '../../src/types.js';

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

describe('buildAdSvg', () => {
  it('produces a well-formed SVG document with the canvas dimensions', () => {
    const concept = makeConcept();
    const layout = generateLayoutSpec(concept, 'square', undefined);
    const svg = buildAdSvg(concept, layout, undefined);

    expect(svg).toContain('<?xml');
    expect(svg).toContain(`<svg width="${layout.width}" height="${layout.height}"`);
    expect(svg).toContain('</svg>');
  });

  it('includes the headline and CTA text', () => {
    const concept = makeConcept({ headline: 'Uniquely Identifiable Headline', cta: 'Uniquely Identifiable CTA' });
    const layout = generateLayoutSpec(concept, 'square', undefined);
    const svg = buildAdSvg(concept, layout, undefined);

    expect(svg).toContain('Uniquely');
    expect(svg).toContain('Headline');
    expect(svg).toContain('CTA');
  });

  it('escapes XML-unsafe characters in copy instead of embedding them raw', () => {
    const concept = makeConcept({ headline: 'Save 20% & get more <done>' });
    const layout = generateLayoutSpec(concept, 'square', undefined);
    const svg = buildAdSvg(concept, layout, undefined);

    expect(svg).not.toContain('& get');
    expect(svg).not.toContain('<done>');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;done&gt;');
  });

  it('wraps a long headline into multiple tspans on a narrow canvas', () => {
    const concept = makeConcept({
      headline: 'This is a deliberately long headline written to force multi-line wrapping in the render',
    });
    // Landscape is the narrowest relative canvas with the smallest headline font — most likely to wrap.
    const layout = generateLayoutSpec(concept, 'landscape', undefined);
    const svg = buildAdSvg(concept, layout, undefined);

    const tspanCount = (svg.match(/<tspan/g) || []).length;
    expect(tspanCount).toBeGreaterThan(1);
  });

  it('uses the brand solid background colour when set, otherwise a gradient', () => {
    const concept = makeConcept();
    const layout = generateLayoutSpec(concept, 'square', undefined);

    const brand: BrandProfile = {
      businessName: 'Acme', industry: 'SaaS', targetAudience: 'Ops managers', brandVoice: 'Direct',
      colours: { primary: '#111111', background: '#00FF00' },
      fonts: { heading: 'Inter' },
      forbiddenPhrases: [], preferredCTA: [], proofPoints: [], guarantees: [], commonOffers: [],
    };
    const svgWithBg = buildAdSvg(concept, layout, brand);
    expect(svgWithBg).toContain('fill="#00FF00"');

    const svgWithoutBg = buildAdSvg(concept, layout, undefined);
    expect(svgWithoutBg).toContain('linearGradient');
  });
});
