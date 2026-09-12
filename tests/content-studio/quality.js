/**
 * Content Studio quality-metric checks.
 *
 * The audit these guard: the previous scorer reported four precise
 * percentages that were largely predetermined —
 *   Tone Match  could only ever be 85 or 100 (a test for "hey"/"gonna")
 *   Style Guide could only ever be 75, 90 or 100, and consulted none of the
 *               selected guide's actual rules
 *   SEO         had a floor of 50, so empty content scored 50/100
 *   Quality     averaged those, so it could never fall below about 53
 * A client reading "Tone Match 100%" would believe an analysis had happened.
 *
 *   node tests/content-studio/quality.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '../..');

global.window = {};
require(path.join(REPO, 'web/js/content-quality.js'));
const Q = global.window.ContentQuality;

// Long enough to clear the 40-word minimum below which rule checks are
// declined as vacuous. Contains no contractions, passives or long sentences
// of its own, so it never contaminates the case under test.
const pad = ' The team reviewed the material carefully and recorded what they found in the shared document for everyone to read later on before the next scheduled planning session began in earnest. Each person added a short note of their own.';

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

const GOOD = `# How mid-sized teams cut reporting time

Marketing teams lose hours each week rebuilding the same report. We looked at
how forty teams handled it, and the pattern was consistent.

## What the fast teams did

The fastest teams shared three habits. They agreed a single definition for
each metric. They automated collection once rather than each month. They
reviewed the report together, briefly, instead of circulating it.

- Agree definitions first
- Automate collection once
- Review together, briefly

You can read the full method at [our guide](https://example.com/guide) or in
the [summary](https://example.com/summary).

## What this means for you

Start with one report. Pick the one you rebuild most often, and agree its
definitions before you touch any tooling.`;

const BAD = 'Stuff.';

const RULES_DEFAULT = { oxford_comma: true, sentence_case_headings: true,
  avoid_passive_voice: true, max_sentence_length: 25, paragraph_max_sentences: 5 };
const RULES_CUSTOM = { brand_voice: 'consistent', terminology: 'approved_only',
  formatting: 'brand_guidelines' };

console.log('──── the floors are gone ────');
const badSeo = Q.seo(BAD, {});
console.log('  bad content SEO:', badSeo.value);
check('trivial content no longer scores 50 on SEO', badSeo.value !== null && badSeo.value < 20);
check('empty content is not scored at all', Q.seo('', {}).value === null);

const badRead = Q.readability(BAD);
check('two words is refused rather than scored', badRead.value === null && /Too little text/.test(badRead.reason));

console.log('\n──── tone is no longer two-valued ────');
// The old implementation could return only 85 or 100 for any input.
const toneValues = new Set();
[
  ['professional', GOOD],
  ['professional', 'Hey, we are gonna show you some amazing stuff!! It is kinda wild.' + pad],
  ['casual', 'The organisation shall provide documentation to all relevant parties.' + pad],
  ['casual', 'You will love this. We built it for you and your team.' + pad],
  ['authoritative', 'Maybe this works. I think it is probably fine, sort of.' + pad],
  ['authoritative', GOOD],
].forEach(([t, text]) => {
  const r = Q.tone(text, t);
  if (typeof r.value === 'number') toneValues.add(r.value);
});
console.log('  distinct tone scores observed:', [...toneValues].sort((a, b) => a - b).join(', '));
check('tone produces a real range, not just 85/100', toneValues.size > 2);
check('informal text fails a professional tone',
  Q.tone('Hey, we are gonna show you some amazing stuff!! It is kinda wild.' + pad, 'professional').value < 100);
check('clean text passes a professional tone', Q.tone(GOOD, 'professional').value === 100);
check('hedged text fails an authoritative tone',
  Q.tone('Maybe this works. I think it is probably fine, sort of.' + pad, 'authoritative').value < 50);

const unknownTone = Q.tone(GOOD, 'swashbuckling');
check('an unknown tone is declined, not guessed',
  unknownTone.value === null && /No automatic check exists/.test(unknownTone.reason));

console.log('\n──── style guide actually checks its rules ────');
const styleGood = Q.styleGuide(GOOD, RULES_DEFAULT);
const styleBad = Q.styleGuide(
  "It was decided by the committee that the report shouldn't be delayed, and the findings, conclusions and recommendations were reviewed by everyone " +
  "in a sentence that simply keeps going well past any reasonable limit on length because it never stops adding more clauses to itself.",
  RULES_DEFAULT);
console.log('  clean:', styleGood.value, '| messy:', styleBad.value);
console.log('  messy checks:', styleBad.checks.join(' | '));
check('a clean piece scores well against the default guide', styleGood.value >= 75);
check('a messy piece scores badly — below the old 75 floor', styleBad.value < 75);
check('passive voice is actually detected',
  styleBad.checks.some(c => /passive/i.test(c) && /FAIL/.test(c)));
check('over-long sentences are actually detected',
  styleBad.checks.some(c => /exceed 25 words/.test(c) && /FAIL/.test(c)));
check('contractions are detected when the guide forbids them',
  Q.styleGuide("The report shouldn't be late." + pad, { avoid_contractions: true }).value === 0);

const styleCustom = Q.styleGuide(GOOD, RULES_CUSTOM);
check('an editorial-only guide returns no score rather than a fake one',
  styleCustom.value === null && /cannot be checked automatically/.test(styleCustom.reason));

check('a scrap of text is declined for style rather than scored 100%',
  Q.styleGuide('Stuff. Things. Yeah.', RULES_DEFAULT).value === null);
check('a scrap of text is declined for tone rather than scored 100%',
  Q.tone('Stuff. Things. Yeah.', 'professional').value === null);

console.log('\n──── overall excludes what was not measured ────');
const full = Q.analyse(GOOD, { tone: 'professional', styleGuideRules: RULES_DEFAULT });
console.log('  good content:', JSON.stringify({
  readability: full.readability.value, seo: full.seo.value,
  style: full.style.value, tone: full.tone.value, overall: full.overall.value }));
check('a good piece scores across all four dimensions', full.overall.measuredCount === 4);

const partial = Q.analyse(GOOD, { tone: 'swashbuckling', styleGuideRules: RULES_CUSTOM });
console.log('  with two dimensions unmeasurable:', JSON.stringify({
  style: partial.style.value, tone: partial.tone.value,
  overall: partial.overall.value, measured: partial.overall.measuredCount }));
check('unmeasurable dimensions are excluded, not counted as a number',
  partial.overall.measuredCount === 2 && partial.overall.totalCount === 4);
check('the overall is the average of only what was measured',
  partial.overall.value === Math.round((partial.readability.value + partial.seo.value) / 2));

const nothing = Q.analyse('', { tone: 'professional', styleGuideRules: RULES_DEFAULT });
check('with nothing measurable the overall is null, not a number',
  nothing.overall.value === null && nothing.overall.measuredCount === 0);

console.log('\n──── the old floor is genuinely gone ────');
// Old behaviour: min possible overall was (0 + 50 + 85 + 75) / 4 ≈ 53.
const weak = Q.analyse('Stuff. Things. Yeah.', { tone: 'professional', styleGuideRules: RULES_DEFAULT });
console.log('  weak content overall:', weak.overall.value, `(measured ${weak.overall.measuredCount}/4)`);
check('weak content can now score below the old 53 floor',
  weak.overall.value === null || weak.overall.value < 53);

console.log('\n──── every score carries its working ────');
check('each measured dimension lists what was checked',
  [full.readability, full.seo, full.style, full.tone]
    .every(p => Array.isArray(p.checks) && p.checks.length > 0));
check('each unmeasured dimension gives a reason',
  [partial.style, partial.tone].every(p => typeof p.reason === 'string' && p.reason.length > 10));

console.log('\n' + (fail.length === 0
  ? 'ALL ASSERTIONS PASSED'
  : `${fail.length} FAILED: ${fail.join(' | ')}`));
process.exit(fail.length === 0 ? 0 : 1);
