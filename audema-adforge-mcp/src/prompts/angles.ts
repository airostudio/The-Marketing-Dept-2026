import type { AdAngleType, AdBrief, BrandProfile } from '../types.js';

interface AngleDefinition {
  type: AdAngleType;
  name: string;
  description: string;
  whenToUse: string;
  requirements: string[];
}

export const ANGLE_DEFINITIONS: Record<AdAngleType, AngleDefinition> = {
  'pain-point': {
    type: 'pain-point',
    name: 'Pain-Point Ad',
    description: 'Opens by naming the customer\'s specific frustration in their own words, then positions the offer as the relief.',
    whenToUse: 'Best when the audience is already aware of their problem but hasn\'t found a solution they trust yet.',
    requirements: [
      'The hook must name ONE specific pain point from the brief — never a generic frustration',
      'Use the customer\'s own language, not marketing language, for the pain',
      'The relief (offer) should feel like the obvious next sentence, not a hard pivot',
    ],
  },
  offer: {
    type: 'offer',
    name: 'Offer Ad',
    description: 'Leads with the concrete deal, price, or bundle — the offer itself is the hook.',
    whenToUse: 'Best when the offer is genuinely strong (real discount, real bundle, real scarcity) and needs no dressing up.',
    requirements: [
      'The specific number, price, or deal mechanic must appear in the headline, not buried',
      'Must use a real offer from the brief/brand profile — never invent a discount or price',
      'CTA should match the offer\'s urgency (e.g. "Claim it" vs "Learn more")',
    ],
  },
  proof: {
    type: 'proof',
    name: 'Proof Ad',
    description: 'Leads with credibility — results, reviews, numbers, before/after — to overcome skepticism.',
    whenToUse: 'Best for audiences who are interested but skeptical, or in categories with a lot of noise/bad actors.',
    requirements: [
      'Must use a REAL proof point supplied in the brand profile — never fabricate a statistic, review count, or result',
      'If no proof points exist in the brand profile, this angle should be skipped or flagged as needing real data',
      'The proof should map directly to the customer\'s stated objection, not be generic praise',
    ],
  },
  urgency: {
    type: 'urgency',
    name: 'Urgency Ad',
    description: 'Uses a real time or quantity constraint to prompt immediate action.',
    whenToUse: 'Best for promotions with an actual deadline, limited stock, or seasonal relevance — never fabricated scarcity.',
    requirements: [
      'The urgency mechanic must be real and specific (a date, a quantity, an event) — no vague "limited time"',
      'Should pair with the offer or a strong pain point, not stand alone on urgency alone',
      'CTA must reflect the deadline, e.g. "Book before Friday" rather than a generic "Learn more"',
    ],
  },
  comparison: {
    type: 'comparison',
    name: 'Comparison Ad',
    description: 'Positions the business against the status quo, a competitor category, or "the old way" of doing things.',
    whenToUse: 'Best when the audience has tried alternatives (competitors, DIY, doing nothing) and is comparing options.',
    requirements: [
      'Compare against a category or "the old way", not a named competitor, unless the brief explicitly says otherwise',
      'The comparison must be fair and defensible — a real, specific differentiator from the brand profile',
      'Avoid generic "we\'re better" — name the exact dimension of difference (speed, price, guarantee, expertise)',
    ],
  },
  aspirational: {
    type: 'aspirational',
    name: 'Aspirational Ad',
    description: 'Sells the identity/outcome the customer wants to become, not the mechanics of the product.',
    whenToUse: 'Best for higher-consideration or lifestyle/status-driven categories where the transformation matters more than the feature list.',
    requirements: [
      'Describe the AFTER state specifically — not "feel great", but a concrete scene the customer recognises',
      'The desired action should feel like a small, low-friction step toward that identity',
      'Must stay grounded in what the business can actually deliver — no over-promising beyond the offer',
    ],
  },
};

/**
 * Builds the guidance block returned to the calling model. This is NOT a
 * canned template the model fills in — it forces the model to reason about
 * the SPECIFIC brief and brand before writing anything, and explicitly bans
 * generic filler.
 */
export function buildAngleGuidance(
  brief: AdBrief,
  brand: BrandProfile | undefined,
  angleTypes: AdAngleType[]
): string {
  const analysis = brief.analysis;
  const lines: string[] = [];

  lines.push(`# Ad Angle Generation Brief`);
  lines.push('');
  lines.push(`**Business:** ${brief.businessDescription}`);
  if (brief.campaignGoal) lines.push(`**Campaign goal:** ${brief.campaignGoal}`);
  lines.push('');

  if (!analysis) {
    lines.push('⚠️ No customer analysis has been submitted for this brief yet. Call `submit_customer_analysis` first — angles generated without a real target customer, pain points, and offer will be generic and should be rejected.');
    return lines.join('\n');
  }

  lines.push(`**Target customer:** ${analysis.targetCustomer}`);
  lines.push(`**Pain points:**`);
  analysis.painPoints.forEach((p) => lines.push(`  - ${p}`));
  lines.push(`**Offer:** ${analysis.offer}`);
  if (analysis.objections.length) {
    lines.push(`**Objections to address:**`);
    analysis.objections.forEach((o) => lines.push(`  - ${o}`));
  }
  lines.push(`**Desired action:** ${analysis.desiredAction}`);
  lines.push('');

  if (brand) {
    lines.push(`**Brand voice:** ${brand.brandVoice}`);
    if (brand.proofPoints.length) lines.push(`**Real proof points available:** ${brand.proofPoints.join(' | ')}`);
    if (brand.guarantees.length) lines.push(`**Real guarantees available:** ${brand.guarantees.join(' | ')}`);
    if (brand.commonOffers.length) lines.push(`**Offers this business runs:** ${brand.commonOffers.join(' | ')}`);
    if (brand.preferredCTA.length) lines.push(`**Preferred CTA phrasing:** ${brand.preferredCTA.join(' | ')}`);
    if (brand.forbiddenPhrases.length) lines.push(`**NEVER use these words/phrases:** ${brand.forbiddenPhrases.join(' | ')}`);
    lines.push('');
  } else {
    lines.push('⚠️ No brand profile linked. Concepts will lack brand voice, real proof points, and forbidden-phrase guardrails — recommend calling `create_brand_profile` first for production-ready output.');
    lines.push('');
  }

  lines.push(`## Angles to generate: ${angleTypes.join(', ')}`);
  lines.push('');
  angleTypes.forEach((type) => {
    const def = ANGLE_DEFINITIONS[type];
    lines.push(`### ${def.name} (${def.type})`);
    lines.push(def.description);
    lines.push(`*When this works:* ${def.whenToUse}`);
    lines.push(`*Requirements:*`);
    def.requirements.forEach((r) => lines.push(`  - ${r}`));
    lines.push('');
  });

  lines.push('## Hard rules for every concept');
  lines.push('- Generate ONE concept per requested angle unless asked for more per angle.');
  lines.push('- Every field must reference something SPECIFIC from this brief or brand profile — the pain point, the offer, the proof point, the audience\'s actual words. If a concept could run for any business in this industry unchanged, discard it and try again.');
  lines.push('- Do not invent statistics, reviews, guarantees, or urgency that isn\'t backed by the brief or brand profile.');
  lines.push('- Write the hook, headline, and subheadline as if you are the copywriter who has actually read this brief — not a template with blanks filled in.');
  lines.push('');
  lines.push('When ready, submit the concepts with `save_ad_concepts`. Each concept must satisfy the full AdConcept schema (conceptName, angleType, targetEmotion, customerPainPoint, hook, headline, subheadline, cta, visualDirection, conversionRationale, and briefId = ' + (brief.id ?? '<this brief id>') + ').');

  return lines.join('\n');
}
