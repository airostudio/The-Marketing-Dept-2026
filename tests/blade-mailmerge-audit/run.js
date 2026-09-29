/**
 * The repeatable mail-merge audit workflow: "find 100-150 [any trade],
 * audit them, shortlist the best 50, find the owner's name, generate a
 * personalised observation, export a mail-merge-ready CSV." Nothing here
 * is specific to plumbers — the trade and area are already chosen by
 * steps 1-3 of Blade's existing wizard; this only adds the shortlist/
 * owner-lookup/export layer on top.
 *
 * opportunityRank() and personalizedNote() are executed directly (via
 * window.__bladeInternals, the same debug-hook pattern link-funnel.html
 * uses) rather than just grep-checked, since their exact behavior — not
 * just their presence — is what the workflow's output quality depends on.
 *
 *   node tests/blade-mailmerge-audit/run.js
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

const page = fs.readFileSync(path.join(REPO, 'web/agents/blade-agent.html'), 'utf8');

function makeGenericElement(id) {
  const el = { id, value: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  el.addEventListener = () => {};
  el.appendChild = () => {};
  el.focus = () => {};
  el.querySelector = () => null;
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
    createElement: () => makeGenericElement('_created'),
    body: { appendChild() {}, removeChild() {} },
  };
  const fakeWindow = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    location: { search: '' },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    setTimeout: () => {},
  };
  const src = fs.readFileSync(path.join(REPO, 'web/agents/blade-agent.html'), 'utf8')
    .match(/<script>\n\(function \(\) \{[\s\S]*?\n\}\)\(\);\n<\/script>/)[0]
    .replace('<script>', '').replace('</script>', '');
  const fn = new Function('window', 'document', 'localStorage', 'URL', 'setTimeout', `${src}\nreturn window.__bladeInternals;`);
  return fn(fakeWindow, fakeDocument, fakeWindow.localStorage, fakeWindow.URL, fakeWindow.setTimeout);
}

const { opportunityRank, personalizedNote } = loadPage();

console.log('\n──── opportunityRank: no-website and platform-locked leads rank ahead of merely-outdated ones ────');
check('no website ranks highest priority', opportunityRank({ siteStatus: 'no_website' }) === 0);
check('a GoDaddy/Wix/Squarespace lead ranks next, even if siteStatus alone says nothing', opportunityRank({ siteStatus: 'modern', sitePlatform: 'wix' }) === 1);
check('platform-locked outranks merely outdated', opportunityRank({ siteStatus: 'modern', sitePlatform: 'wix' }) < opportunityRank({ siteStatus: 'outdated' }));
check('outdated outranks unreachable/check_failed', opportunityRank({ siteStatus: 'outdated' }) < opportunityRank({ siteStatus: 'unreachable' }));
check('a genuinely modern site with no platform lock-in ranks lowest', opportunityRank({ siteStatus: 'modern' }) === 5);

console.log('\n──── personalizedNote: grounded in the real evidence already gathered, never invented ────');
check('no-website leads get the exact observation from the user\'s own example', personalizedNote({ siteStatus: 'no_website' }) === 'Currently relies on Google listing');
check('a platform-locked lead names the actual platform', /Wix/.test(personalizedNote({ sitePlatform: 'wix', siteReasons: [] })));
check('a missing-viewport reason becomes the mobile-usability observation from the user\'s own example',
  personalizedNote({ siteStatus: 'outdated', siteReasons: ['No mobile-responsive (viewport) tag'] }) === 'Mobile layout is difficult to use');
check('a stale-copyright reason becomes an honest "hasn\'t updated" note',
  /hasn.t updated/i.test(personalizedNote({ siteStatus: 'outdated', siteReasons: ['Footer copyright still says 2014'] })));
check('a genuinely modern site with nothing notable gets an HONEST BLANK note, not a fabricated compliment',
  personalizedNote({ siteStatus: 'modern', siteReasons: [] }) === '');

console.log('\n──── the workflow is wired into the UI, repeatable for any trade/area ────');
check('a shortlist-to-top-N control exists', /btn-shortlist/.test(page) && /in-shortlist-count/.test(page));
check('shortlisting uses opportunityRank, not an arbitrary or random order', /opportunityRank\(a\) - opportunityRank\(b\)/.test(page));
check('an owner-name finder exists as its own step, separate from the email finder', /btn-find-owners/.test(page) && /api\/blade-find-owner/.test(page));
check('the owner lookup passes the actual business name/suburb/country — not hardcoded to any one trade or area',
  /businessName: r\.name,[\s\S]{0,120}suburb: r\.searchPoint/.test(page));

console.log('\n──── the export matches the exact requested mail-merge column order ────');
check('exportMailMergeCsv exists as its own export, separate from the general CSV export', /function exportMailMergeCsv/.test(page));
check('the header row matches the exact requested column order',
  /First Name,Business,Suburb,Email,Website,Website Status,Personal Note,Sent,Replied/.test(page));
check('Sent/Replied are always written as "No" — this file is an input to sending, not a record of one',
  /personalizedNote\(r\), 'No', 'No',/.test(page));
check('a missing website is written as "None", matching the user\'s own example row', /r\.website \|\| 'None'/.test(page));

console.log('\n──── failed owner lookups are distinguished from a genuine "nobody found", same as the email finder ────');
check('a loading state exists', /_ownerLoading/.test(page));
check('a failed lookup is tracked separately from a confirmed empty result', /_ownerError/.test(page) && /_ownerChecked/.test(page));
check('a failed lookup is retried on the next press, not left stuck', /!r\._ownerChecked \|\| r\._ownerError/.test(page));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
