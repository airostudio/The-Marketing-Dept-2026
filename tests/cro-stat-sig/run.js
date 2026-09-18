/**
 * CRO Lab's Statistical Significance Calculator rendered the literal text
 * "+Infinity% lift" or "NaN% lift" whenever Control CR was entered as 0% —
 * a completely normal input for a brand-new page/test with no conversions
 * recorded yet. twoProportionZTest() already computed the safe (null)
 * version of this same lift figure for its own z/p-value math; calcStatSig()
 * just recomputed it separately, unguarded, a few lines below.
 *
 *   node tests/cro-stat-sig/run.js
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

const html = fs.readFileSync(path.join(REPO, 'web/agents/cro-agent.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not find the inline <script> in cro-agent.html');
const src = scriptMatch[1];

function makeGenericElement(id) {
  const el = { id, value: '', textContent: '', style: {} };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html || '', set: (v) => { el._html = v; } });
  return el;
}

function makeFakeWindow() {
  // The script's top-level code (outside any function) reads a handful of
  // globals during its own initial render — none of it relevant to
  // calcStatSig()/twoProportionZTest(), so a minimal stand-in that answers
  // "nothing configured yet" is enough to let those top-level lines run
  // without pulling in the rest of the page's real state.
  return {
    CroBacklogStore: null,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    location: { search: '' },
  };
}

function loadPage(values) {
  const cache = {};
  const get = (id) => cache[id] || (cache[id] = makeGenericElement(id));
  Object.entries(values).forEach(([id, value]) => { get(id).value = value; });
  const fakeDocument = {
    getElementById: (id) => get(id),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  const fakeWindow = makeFakeWindow();
  const fn = new Function('window', 'document', 'localStorage', `${src}
return { calcStatSig, twoProportionZTest };`);
  const mod = fn(fakeWindow, fakeDocument, fakeWindow.localStorage);
  mod.calcStatSig();
  return { mod, cache };
}

console.log('\n──── twoProportionZTest itself already handles a 0% control rate safely ────');
{
  const fakeWindow = makeFakeWindow();
  const fakeDocument = { getElementById: () => makeGenericElement('x'), addEventListener() {}, querySelectorAll: () => [] };
  const fn = new Function('window', 'document', 'localStorage', `${src}
return { twoProportionZTest };`);
  const { twoProportionZTest } = fn(fakeWindow, fakeDocument, fakeWindow.localStorage);
  const r = twoProportionZTest(0, 0.05, 1000);
  check('lift is null (not Infinity/NaN) when control CR is 0', r.lift === null);
  check('the z-test itself is still measured and meaningful', r.measured === true);
}

console.log('\n──── calcStatSig(): Control CR of 0% no longer shows "Infinity%"/"NaN%" ────');
{
  const { cache } = loadPage({ calcControl: '0', calcVariant: '5', calcVisitors: '1000', calcMDE: '20' });
  const verdict = cache.sigVerdict.textContent;
  const stats = cache.sigStats.innerHTML;
  check('the verdict never contains the literal word "Infinity"', !/Infinity/.test(verdict));
  check('the verdict never contains the literal word "NaN"', !/NaN/.test(verdict));
  check('the Relative Lift tile never contains "Infinity" or "NaN"', !/Infinity|NaN/.test(stats));
  check('the Relative Lift tile shows an honest "N/A" instead', /N\/A/.test(stats));
  check('the tile explains why (control has 0% CR)', /control has 0% CR/.test(stats));
}

console.log('\n──── a real, non-zero control rate still shows a real percentage (no regression) ────');
{
  const { cache } = loadPage({ calcControl: '4', calcVariant: '5', calcVisitors: '2000', calcMDE: '20' });
  const verdict = cache.sigVerdict.textContent;
  const stats = cache.sigStats.innerHTML;
  check('a real lift percentage is computed', /25\.0%/.test(verdict) || /25\.0%/.test(stats));
  check('no fabricated N/A when the math is real', !/N\/A/.test(stats));
}

console.log('\n──── both variants at 0% (nothing measurable yet) stays as "not yet significant", not broken math ────');
{
  const { cache } = loadPage({ calcControl: '0', calcVariant: '0', calcVisitors: '500', calcMDE: '20' });
  const verdict = cache.sigVerdict.textContent;
  check('reports "not yet significant" rather than a bogus win/loss claim', /Not Yet Significant/.test(verdict));
  check('still no Infinity/NaN leaking through', !/Infinity|NaN/.test(verdict));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
