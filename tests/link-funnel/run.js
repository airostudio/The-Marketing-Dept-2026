/**
 * web/tools/link-funnel.html lets someone drop a spreadsheet or document
 * full of URLs mixed in with ordinary notes, and splits the real URLs from
 * everything else before running a website-health check on them. The whole
 * feature stands or falls on that split being right: a real URL wrongly
 * rejected is a lead silently dropped, and junk wrongly accepted as a URL
 * wastes a check (and shows up as a nonsense row in the results).
 *
 * This loads the page's actual classification functions (not a
 * reimplementation of them) with a minimal DOM stub — the same technique
 * used for cro-agent.html's inline-script tests — and exercises them
 * directly.
 *
 *   node tests/link-funnel/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const html = fs.readFileSync(path.join(REPO, 'web/tools/link-funnel.html'), 'utf8');
const scriptMatch = html.match(/<script>\n\(function \(\) \{[\s\S]*?\n\}\)\(\);\n<\/script>/);
if (!scriptMatch) throw new Error('Could not find the inline IIFE in link-funnel.html');
const src = scriptMatch[0].replace('<script>', '').replace('</script>', '');

function makeGenericElement(id) {
  const el = { id, value: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  el.addEventListener = () => {};
  Object.defineProperty(el, 'innerHTML', { get: () => el._html || '', set: (v) => { el._html = v; } });
  return el;
}

function loadPage() {
  const cache = {};
  const get = (id) => cache[id] || (cache[id] = makeGenericElement(id));
  const fakeDocument = {
    getElementById: (id) => get(id),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const fakeWindow = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    location: { search: '' },
    scrollTo() {},
    escapeHtml: null,
    Supabase: null,
    Auth: null,
  };
  const fn = new Function('window', 'document', 'localStorage', `${src}
return window.__linkFunnelInternals;`);
  return fn(fakeWindow, fakeDocument, fakeWindow.localStorage);
}

const { classifyToken, extractCandidates, splitGoodFromBad } = loadPage();

console.log('\n──── real URLs are recognised in every shape someone actually pastes them ────');
[
  ['https://example.com', true],
  ['http://example.com/path?query=1', true],
  ['https://sub.example.co.uk/page', true],
  ['www.example.com', true],
  ['example.com', true],
  ['example.com/pricing', true],
  ['example.com:8080/admin', true],
  ['192.168.1.1', true],
].forEach(([input, expectGood]) => {
  const v = classifyToken(input);
  check(`"${input}" → ${expectGood ? 'good' : 'rejected'}`, v.good === expectGood);
});

console.log('\n──── obvious non-URLs are rejected, with an honest reason ────');
[
  ['hello@example.com', 'an email address, not a URL'],
  ['mailto:hello@example.com', null], // just needs to be rejected, reason wording checked separately
  ['12.99', 'not a URL'],
  ['3.5.1', 'not a URL'],
  ['Please', 'not a URL'],
  ['call us on 1300 555 888', null],
].forEach(([input, expectedReason]) => {
  const v = classifyToken(input);
  check(`"${input}" is rejected`, v.good === false);
  if (expectedReason) check(`  ...with reason "${expectedReason}"`, v.reason === expectedReason);
});

console.log('\n──── trailing/leading punctuation from real sentences doesn\'t break a real URL ────');
[
  ['Visit https://example.com.', 'https://example.com'],
  ['(https://example.com)', 'https://example.com'],
  ['"example.com",', 'example.com'],
].forEach(([input, expectedUrl]) => {
  const tokens = extractCandidates(input);
  const good = tokens.map(classifyToken).find(v => v.good);
  check(`"${input}" yields the clean URL ${expectedUrl}`, !!good && good.url === expectedUrl);
});

console.log('\n──── splitGoodFromBad separates a realistic mixed file, deduping repeats ────');
{
  const text = 'Company Notes,Website\n' +
    'Great lead - follow up Monday,https://example.com\n' +
    'Called twice no answer,www.another-example.org/contact\n' +
    'Not interested,\n' +
    'Duplicate of above,https://example.com\n' +
    'bad contact,not-a-real-url-just-text-without-a-dot\n' +
    'personal email on file,someone@example.com\n';
  const { good, rejected } = splitGoodFromBad(text);

  check('both distinct real URLs are found', good.some(g => g.url === 'https://example.com') && good.some(g => g.url === 'www.another-example.org/contact'));
  check('the duplicate URL is not double-counted', good.filter(g => g.url.toLowerCase() === 'https://example.com').length === 1);
  check('the email address is rejected, not treated as a URL', rejected.some(r => r.text === 'someone@example.com' && r.reason === 'an email address, not a URL'));
  check('ordinary sentence words never get misclassified as a URL',
    !good.some(g => /^(Great|lead|follow|Monday|Called|twice|no|answer|Not|interested|Duplicate|above|bad|contact)$/i.test(g.url)));
  // Every genuinely good URL from the fixture, and only those, ends up counted:
  check('exactly two distinct good URLs came out of the fixture', good.length === 2);
}

console.log('\n──── empty/whitespace-only tokens are dropped silently, not reported as "bad" ────');
{
  const { good, rejected } = splitGoodFromBad('https://example.com   ,,,   \n\n  ');
  check('the real URL is still found', good.length === 1);
  check('the surrounding blank cells are not reported as rejected junk', rejected.length === 0);
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
