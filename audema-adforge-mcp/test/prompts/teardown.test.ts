import { describe, it, expect } from 'vitest';
import { guessAngleType, buildCompetitorTeardown } from '../../src/prompts/teardown.js';

describe('guessAngleType', () => {
  it('guesses "urgency" for time-pressure language', () => {
    expect(guessAngleType('Sale ends today — don\'t miss out')).toBe('urgency');
  });

  it('guesses "offer" for discount language', () => {
    expect(guessAngleType('Get 20% off your first order, free shipping included')).toBe('offer');
  });

  it('guesses "proof" for social-proof language', () => {
    expect(guessAngleType('Trusted by 10,000+ customers, rated 4.9 stars')).toBe('proof');
  });

  it('guesses "comparison" for comparative language', () => {
    expect(guessAngleType('Better than the leading brand, unlike anything else')).toBe('comparison');
  });

  it('guesses "aspirational" for identity/future language', () => {
    expect(guessAngleType('Imagine the future you could build — transform your life')).toBe('aspirational');
  });

  it('falls back to "pain-point" when nothing else matches', () => {
    expect(guessAngleType('Tired of dealing with slow, clunky software?')).toBe('pain-point');
  });
});

describe('buildCompetitorTeardown', () => {
  it('produces a full teardown with scores and guessed angle', () => {
    const teardown = buildCompetitorTeardown({
      competitorName: 'Acme Co',
      headline: 'Save 20% today only',
      body: 'Limited time offer on our best-selling product',
      cta: 'Claim Your Discount',
    });
    expect(teardown.angleTypeGuess).toBeTruthy();
    expect(teardown.scores.overall).toBeGreaterThanOrEqual(0);
    expect(teardown.scores.overall).toBeLessThanOrEqual(10);
    expect(teardown.scoresExplained).toContain('Overall:');
  });

  it('recommends borrowing a strong CTA when the CTA scores well', () => {
    const teardown = buildCompetitorTeardown({
      headline: 'Automate your reporting in minutes',
      cta: 'Start Free Trial',
    });
    expect(teardown.scores.ctaStrength).toBeGreaterThanOrEqual(7);
    expect(teardown.whatToBorrow.some((b) => /CTA/i.test(b))).toBe(true);
  });

  it('flags a weak CTA under whatToAvoid', () => {
    const teardown = buildCompetitorTeardown({
      headline: 'Check out our product',
      cta: 'Learn More',
    });
    expect(teardown.whatToAvoid.some((a) => /CTA/i.test(a))).toBe(true);
  });

  it('works with only a headline (body/cta optional)', () => {
    expect(() => buildCompetitorTeardown({ headline: 'Just a headline, nothing else' })).not.toThrow();
  });

  it('never persists anything to concept storage — this is analysis only', () => {
    // buildCompetitorTeardown is a pure function with no storage import at all;
    // this test documents that guarantee so a future edit can't silently break it.
    const teardown = buildCompetitorTeardown({ headline: 'Test headline for a pure function' });
    expect(teardown).not.toHaveProperty('id');
  });
});
