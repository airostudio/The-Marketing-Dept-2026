/**
 * The first-run state.
 *
 * Every page in this product was built and reviewed with data in it. Nobody
 * had looked at what a brand-new account sees: no project, no roster, no
 * generated output, nothing in localStorage. Three customer-reported bugs in
 * a row turned out to be the same thing — the page is unusable until data
 * exists, and nothing on it says so.
 *
 * A browser sweep clicked all 604 visible controls across 76 pages with an
 * empty profile and classified what happened. Four failure shapes came out,
 * and this suite pins each one:
 *
 *   1. A handler that reads `event.target` inside a promise callback.
 *      `window.event` only exists while an event is being dispatched, so by
 *      the time the clipboard promise resolved it was undefined and the
 *      handler threw. The text was on the clipboard; the customer saw an
 *      error. The button must be passed in.
 *
 *   2. Copy and Download with no check for having anything to copy. On first
 *      run the output pane holds its placeholder, so Copy put "Your content
 *      will appear here…" on the clipboard and reported success.
 *
 *   3. `if (!x) return;` on an element that only exists after a generation has
 *      run. Nothing happens and nothing is said, which is indistinguishable
 *      from a broken button.
 *
 *   4. A button with no handler at all — including two on paid-media.html
 *      whose own empty state told people to press them, and two more that
 *      relabelled themselves "Syncing…" and "Applied!" while doing nothing
 *      whatsoever.
 *
 *   node tests/first-run/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

/**
 * Source with comments removed.
 *
 * Every assertion below is about code, and the fixes carry comments quoting
 * the exact broken pattern they replaced — `if (!body) return;` appears
 * verbatim in several of them. A scan over raw text reports the explanation
 * as the defect.
 */
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

/** The balanced-brace body of a named function, or '' if it is not there. */
function body(src, name) {
  const at = src.indexOf('function ' + name);
  if (at === -1) return '';
  let i = src.indexOf('{', at);
  if (i === -1) return '';
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return '';
}

console.log('\n──── 1. no handler reads `event` from inside a callback ────');

/* The agent pages that stream output all offer Copy and Download. */
const OUTPUT_PAGES = [
  'web/agents/content-studio-agent.html',
  'web/agents/email-agent.html',
  'web/agents/seo-agent.html',
  'web/agents/social-agent.html',
  'web/agents/competitive-agent.html',
  'web/agents/compliance-agent.html',
  'web/agents/compliance-automation.html',
  'web/agents/deck-agent.html',
  'web/agents/video-agent.html',
  'web/history.html',
];

for (const page of OUTPUT_PAGES) {
  const src = code(page);
  /* `event.target` / `event.currentTarget` with no `event` parameter in scope.
     An inline onclick="event.stopPropagation()" is fine — there `event` is a
     real argument the browser supplies — so only script-body uses count. */
  const scripts = src.replace(/<[^>]*\bon[a-z]+\s*=\s*"[^"]*"/g, '');
  check(`${path.basename(page)} — no bare event.target in a script body`,
    !/[^.\w]event\s*\.\s*(target|currentTarget)/.test(scripts));
}

console.log('\n──── 2. Copy and Download refuse an empty output ────');

for (const page of OUTPUT_PAGES) {
  const src = code(page);
  /* copyEntry()/copyModal() on history.html are deliberately not in this list.
     They copy a stored record, and the button that calls them only exists on a
     row that was rendered from that record — there is no placeholder for them
     to put on the clipboard. Their bug was #1, the `event` read, not this. */
  for (const fn of ['copyOutput', 'downloadOutput']) {
    const b = body(src, fn);
    if (!b) continue;
    /* A real guard is one of three shapes: the placeholder element is present,
       the extracted text is empty, or the collection being serialised is
       empty (social-agent copies its post list, not a DOM pane). What is not a
       guard is `if (!body) return;` — the container itself is absent on first
       run, and returning says nothing at all. */
    const guards = /output-empty/.test(b) || /!\s*text\b/.test(b) || /!\s*\w+\.length\b/.test(b);
    check(`${path.basename(page)} ${fn}() will not copy a placeholder`, guards);
    check(`${path.basename(page)} ${fn}() says so rather than returning silently`,
      !/if\s*\(\s*!\s*(body|out|el)\s*\)\s*return\s*;/.test(b));
  }
}

console.log('\n──── 3. an empty input is answered, not ignored ────');

const pulse = code('web/seo-pulse.html');
check('seo-pulse startScan() names the problem for an empty URL',
  /hintProblem\(/.test(body(pulse, 'startScan')));
check('seo-pulse has somewhere to put that answer',
  /id="inputHint"/.test(read('web/seo-pulse.html')));

const research = code('web/keywords/research.html');
check('keyword research runResearch() names the problem for empty seeds',
  /hintSeedsRequired\(/.test(body(research, 'runResearch')));

const history = code('web/history.html');
check('history clearAll() says there is nothing to clear',
  /No reports to clear/.test(body(history, 'clearAll')));

const compliance = code('web/agents/compliance-agent.html');
check('compliance attachToCampaign() handles a missing output pane',
  !/if\s*\(\s*!\s*body\s*\)\s*return\s*;/.test(body(compliance, 'attachToCampaign')));

console.log('\n──── 4. a missing project is explained, not alerted ────');

for (const page of ['web/seo/indexing.html', 'web/seo/mobile.html', 'web/seo/vitals.html']) {
  const src = code(page);
  check(`${path.basename(page)} has a first-run panel`, /function showNeedsProject/.test(src));
  check(`${path.basename(page)} links to where a project is made`,
    /project-wizard\.html/.test(body(src, 'showNeedsProject')));
  /* vitals.html has no noDataState element. An earlier version of this fix
     wrote into one anyway and returned silently when it was not found — the
     alert was gone and nothing replaced it. */
  const target = (body(src, 'showNeedsProject').match(/getElementById\('([^']+)'\)/g) || [])
    .map(m => m.match(/'([^']+)'/)[1]);
  check(`${path.basename(page)} writes into an element the page actually has`,
    target.length > 0 && target.some(id => new RegExp(`id="${id}"`).test(read(page))));
  check(`${path.basename(page)} no longer alert()s about a missing project`,
    !/alert\(\s*['"][^'"]*project[^'"]*first/i.test(src));
}

console.log('\n──── 5. paid media: no button without a handler ────');

const paid = read('web/marketing/paid-media.html');
const paidCode = code('web/marketing/paid-media.html');
for (const id of ['btn-new-campaign', 'btn-export-campaigns', 'btn-new-test',
                  'btn-sync-data', 'btn-generate-ad']) {
  check(`${id} is bound`,
    new RegExp(`getElementById\\('${id}'\\)`).test(paidCode) &&
    new RegExp(`id="${id}"`).test(paid));
}

/* The inverse of the above, and how the orphan was found: a handler bound to
   an id that is not on the page is dead code, and it hides what it claims to
   do. #btn-apply-budget was exactly that. */
const bound = [...paidCode.matchAll(/getElementById\('(btn-[^']+)'\)/g)].map(m => m[1]);
for (const id of new Set(bound)) {
  check(`${id} exists in the markup it is bound to`, new RegExp(`id="${id}"`).test(paid));
}

/* Sync Platforms set its own label to "Syncing…" on a timer and did nothing.
   Apply Recommendations turned green and said "Applied!" without touching a
   budget. Announcing work that did not happen is the one thing this product
   must never do. */
check('Sync Platforms does real work or says why it cannot',
  /connectedPlatforms\(\)/.test(paidCode) && /loadCampaignData\(\)/.test(paidCode));
check('Apply Recommendations no longer claims to have applied anything',
  !/textContent\s*=\s*'Applied!'/.test(paidCode));
check('Export CSV exports what is on screen, or says there is nothing',
  /function exportCampaigns/.test(paidCode) && /no campaigns to export/i.test(paidCode));

console.log('\n──── 6. paid media states nothing it has not measured ────');

/* Six campaigns with invented spend, impressions and ROAS shipped in the HTML
   itself — what a new account saw before any script ran. */
check('the campaign table ships no fabricated rows',
  !/Brand Awareness Q1|Retargeting - Cart Abandon|Holiday Promo 2025/.test(paid));
check('the A/B section reads real experiments',
  /ExperimentsStore\.listExperiments/.test(paidCode));
check('experiments-store.js is actually loaded there',
  /src="\/js\/experiments-store\.js"/.test(paid));
/* A conversion rate over zero visitors is unknown, not 0%. */
check('a variant with no visitors shows no rate',
  /convRate === null/.test(paidCode));

console.log('\n──── 7. the content writer\'s project list exists ────');

const writer = code('web/js/content-writer-service.js');
check('viewAllProjects() is implemented', /function viewAllProjects/.test(writer));
check('and exported', /viewAllProjects[,:\s]/.test(writer.split('return {').pop() || ''));
check('and offers a way out when there are no projects',
  /Create your first project/i.test(writer));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
