import type { AdConcept, BrandProfile } from '../types.js';

export const CTA_POWER_VERBS = [
  'get', 'claim', 'book', 'start', 'try', 'grab', 'unlock', 'reserve', 'join', 'discover',
  'shop', 'save', 'call', 'text', 'schedule', 'download', 'see', 'compare',
];

export const HEADLINE_FORMULAS = [
  { name: 'Direct benefit', pattern: '[Outcome] without [pain]', example: 'A clean house without lifting a finger' },
  { name: 'Number-led', pattern: '[Number] [customers/results] [outcome]', example: '3,214 homeowners saved an average of $1,200 last winter' },
  { name: 'Question hook', pattern: 'Still [doing painful thing]?', example: 'Still chasing invoices by hand?' },
  { name: 'Before/after', pattern: 'From [before state] to [after state]', example: 'From overdue to paid in 48 hours' },
  { name: 'Direct offer', pattern: '[Specific deal], [specific deadline/condition]', example: '30% off all bookings made this week' },
];

/**
 * Copywriting guidance for refining an existing concept's copy fields —
 * used by generate_ad_copy when a user wants to iterate on one concept
 * (e.g. after scoring flags a weak CTA) without regenerating the whole
 * concept.
 */
export function buildCopyGuidance(concept: AdConcept, brand: BrandProfile | undefined): string {
  const lines: string[] = [];

  lines.push(`# Copy Refinement — "${concept.conceptName}" (${concept.angleType})`);
  lines.push('');
  lines.push(`**Current copy:**`);
  lines.push(`- Headline: ${concept.headline}`);
  lines.push(`- Subheadline: ${concept.subheadline}`);
  lines.push(`- CTA: ${concept.cta}`);
  if (concept.proofPoint) lines.push(`- Proof point: ${concept.proofPoint}`);
  if (concept.urgencyLine) lines.push(`- Urgency line: ${concept.urgencyLine}`);
  lines.push('');
  lines.push(`**Anchor context:** targets the pain point "${concept.customerPainPoint}", aiming for the emotion "${concept.targetEmotion}".`);
  lines.push('');

  lines.push('## Write five fields');
  lines.push('1. **Primary headline** — the single biggest idea, under ~8 words for square/story formats, up to ~12 for landscape.');
  lines.push('2. **Supporting line** — one sentence that earns the click by adding a specific detail the headline didn\'t have room for.');
  lines.push('3. **CTA** — a short, specific action phrase. Strong CTA verbs: ' + CTA_POWER_VERBS.slice(0, 8).join(', ') + '…');
  lines.push('4. **Proof point (optional)** — only include if there\'s a REAL number/review/result to cite.');
  lines.push('5. **Urgency line (optional)** — only include if there\'s a REAL deadline/scarcity mechanic.');
  lines.push('');

  lines.push('## Headline formulas to consider (pick what fits, don\'t force one)');
  HEADLINE_FORMULAS.forEach((f) => lines.push(`- **${f.name}**: ${f.pattern} — e.g. "${f.example}"`));
  lines.push('');

  if (brand) {
    lines.push(`**Match brand voice:** ${brand.brandVoice}`);
    if (brand.preferredCTA.length) lines.push(`**Prefer these CTA phrases if they fit:** ${brand.preferredCTA.join(' | ')}`);
    if (brand.forbiddenPhrases.length) lines.push(`**NEVER use:** ${brand.forbiddenPhrases.join(' | ')}`);
  }
  lines.push('');
  lines.push(`Submit the refined copy via \`save_ad_concepts\` with id = "${concept.id}" and briefId = "${concept.briefId}", keeping every other field unless it also needs a change.`);

  return lines.join('\n');
}
