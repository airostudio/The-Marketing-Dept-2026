/**
 * api/_lib/content-guard.js in isolation — the pattern-matching that decides
 * whether a draft still has unfinished copy in it. The integration into the
 * two send endpoints (blocking, per-recipient skip, status codes) is covered
 * by tests/email-delivery/run.js; this is just the matching logic itself.
 *
 *   node tests/content-guard/run.js
 */
'use strict';

const { checkSendableContent, findBracketPlaceholders, findUnresolvedMergeTags, findBrokenLinks } =
  require('../../api/_lib/content-guard.js');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

console.log('\n──── bracket placeholders ────');
check('finds a simple placeholder', findBracketPlaceholders('Hi [First Name],').includes('[First Name]'));
check('finds an editorial TODO-style placeholder', findBracketPlaceholders('[ADD: a real stat here]').length === 1);
check('finds multiple distinct placeholders', findBracketPlaceholders('[Sender Name] / [Company Address]').length === 2);
check('does not flag a numeric footnote marker', findBracketPlaceholders('See [1] and [42].').length === 0);
check('does not flag ordinary text with no brackets at all', findBracketPlaceholders('Hi Sam, welcome aboard.').length === 0);
check('a repeated identical placeholder is only reported once', findBracketPlaceholders('[X] and [X] again').length === 1);

console.log('\n──── unresolved merge tags ────');
check('finds an unresolved token', findUnresolvedMergeTags('Hi {{firstName}},').includes('{{firstName}}'));
check('tolerates whitespace inside the braces', findUnresolvedMergeTags('Hi {{ firstName }},').length === 1);
check('finds a dotted token', findUnresolvedMergeTags('{{company.name}}').length === 1);
check('finds nothing in plain resolved text', findUnresolvedMergeTags('Hi Sam,').length === 0);

console.log('\n──── broken links ────');
check('flags an empty href (labelled readably, not just an empty string)', findBrokenLinks('<a href="">Go</a>').includes('(empty)'));
check('flags a bare "#" href', findBrokenLinks('<a href="#">Go</a>').includes('#'));
check('flags a bracket-placeholder href', findBrokenLinks('<a href="[Try Free →]">Go</a>').length === 1);
check('a real https link is not flagged', findBrokenLinks('<a href="https://example.com/pricing">Go</a>').length === 0);
check('a real mailto link is not flagged', findBrokenLinks('<a href="mailto:hi@example.com">Email us</a>').length === 0);

console.log('\n──── checkSendableContent: the combined verdict ────');
{
  const clean = checkSendableContent({ subject: 'Hi Sam', html: '<p>Welcome, Sam! <a href="https://example.com">Start</a></p>' });
  check('clean, fully-resolved content has nothing blocking', clean.blocking.length === 0);
}
{
  const dirty = checkSendableContent({
    subject: 'Hi [First Name]',
    html: '<p>Sign off, [Sender Name]. <a href="[Try Free →]">Go</a></p>',
  });
  check('a template with real problems reports all of them', dirty.blocking.length === 2); // placeholders + broken link (no merge tags present)
  check('the placeholder issue names the actual placeholders', dirty.blocking.some(i => i.includes('[First Name]') && i.includes('[Sender Name]')));
}
{
  // allowMergeTags:true is what send-campaign.js's pre-merge template check
  // uses — a template legitimately contains {{tokens}} before merge, and
  // that must not be confused with a bracket placeholder or reported as if
  // it were already a defect.
  const preMerge = checkSendableContent({ subject: 'Hi {{firstName}}', html: '<p>Hi {{firstName}}!</p>' }, { allowMergeTags: true });
  check('a normal, not-yet-merged template with real {{tokens}} is not flagged when allowMergeTags is set', preMerge.blocking.length === 0);

  const postMerge = checkSendableContent({ subject: 'Hi {{firstName}}', html: '<p>Hi {{firstName}}!</p>' });
  check('the SAME content, checked without allowMergeTags (post-merge), is flagged', postMerge.blocking.length === 1);
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
