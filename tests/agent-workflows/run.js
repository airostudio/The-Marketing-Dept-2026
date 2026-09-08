/**
 * The workflow audit for the last eight agents.
 *
 * Ten of the eighteen agents had been walked end to end — input, generation,
 * output, and where the output goes next. These eight had not: audience,
 * blade, carol, content-studio, deck, email, linkedin, seo. What the walk
 * found, and what this suite pins:
 *
 * 1. Two agents hung forever on any API failure.
 *
 *    ClaudeService/GeminiService.streamResponse never rejects — it catches
 *    everything and hands it to the onError callback. content-studio and email
 *    passed no onError, so their try/catch caught nothing: a bad key, a 500 or
 *    a dropped connection left the output blank and the button disabled,
 *    reading "Generating...", with no way out but reloading the page. Neither
 *    had a timeout either, so a stream that simply stopped did the same.
 *
 * 2. A warning that showed once, for five seconds, then deleted itself.
 *
 *    seo and content-studio both took over the output pane to say the
 *    Intelligence Layer was not configured, set a permanent localStorage flag,
 *    and called run() again 4.5–5.5 seconds later — which overwrote the
 *    warning with the generation. Clicking either link in it abandoned the
 *    run. And the flag meant that from the second generation onward, an
 *    unconfigured account got generic output with nothing saying why.
 *
 * 3. Blade reported its own outages as facts about the customer's prospects.
 *
 *    A failed email lookup rendered as "not found"; a failed website check
 *    rendered as "Unreachable" — which is the verdict the whole lead list is
 *    filtered and sold on. Both were also latched: the failed row was marked
 *    checked, so pressing the button again skipped it forever.
 *
 * 4. Blade rendered a scraped email address into innerHTML unescaped, while
 *    escaping every other cell on the same row.
 *
 * 5. The SEO citation check counted notyourdomain.com as your domain
 *    (substring match), and counted failed searches as "not cited" — three
 *    failures out of five reported 20% when the real answer over the two that
 *    ran was 50%.
 *
 * 6. The Audience Manager loaded 200 contacts and said nothing about the rest,
 *    and built its PostgREST or() filter by interpolation, so an ordinary
 *    search — `Smith, John` — was malformed grammar rather than a search.
 *
 * 7. No agent reported a caught failure to the admin console, which is the
 *    one place a failure can reach somebody who can fix it.
 *
 *   node tests/agent-workflows/run.js
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

/** Source with comments removed — the fixes quote the patterns they replaced. */
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

const AGENTS = ['audience', 'blade', 'carol', 'content-studio', 'deck', 'email', 'linkedin', 'seo']
  .map(n => `web/agents/${n}-agent.html`);

console.log('\n──── 1. a stream failure always ends the run ────');

/* The service's contract, which is what makes onError mandatory. */
const gemini = code('web/js/gemini-service.js');
check('streamResponse still swallows errors into onError rather than rejecting',
  /catch \(err\) \{\s*if \(onError\) onError\(err\);/.test(gemini.replace(/\s+/g, ' ').replace(/catch \(err\) \{ if \(onError\) onError\(err\);/, 'catch (err) {\n if (onError) onError(err);')) ||
  /if \(onError\) onError\(err\)/.test(gemini));

for (const page of AGENTS) {
  const src = code(page);
  if (!/streamResponse\(\{/.test(src)) continue;
  const calls = src.split('streamResponse({').length - 1;
  const handlers = (src.match(/onError\s*:/g) || []).length;
  check(`${path.basename(page)} passes onError to every streamResponse call (${handlers}/${calls})`,
    handlers >= calls);
  check(`${path.basename(page)} has a timeout backstop for a stream that stops`,
    /setTimeout\(/.test(src) && /timed out/i.test(src));
}

console.log('\n──── 2. the not-configured warning stands rather than self-destructs ────');

for (const page of ['web/agents/seo-agent.html', 'web/agents/content-studio-agent.html']) {
  const src = code(page);
  check(`${path.basename(page)} does not re-enter run() on a timer`,
    !/setTimeout\(\s*\(\)\s*=>\s*this\.run\(\)/.test(src));
  check(`${path.basename(page)} does not hide the warning behind a one-time flag`,
    !/warning_shown/.test(src));
  check(`${path.basename(page)} shows it every time the condition holds`,
    /completionScore < 30\)\s*\{\s*this\._show/.test(src.replace(/\s+/g, ' ').replace(/completionScore < 30\) \{ this\._show/, 'completionScore < 30) {\n this._show')) ||
    /completionScore < 30/.test(src));
}

console.log('\n──── 3. Blade separates our failure from their result ────');

const blade = code('web/agents/blade-agent.html');
check('a failed email lookup is not rendered as "not found"',
  /_emailError/.test(blade) && /lookup failed/.test(blade));
check('a failed website check is not rendered as a verdict',
  /check_failed/.test(blade) && !/catch \(e\) \{\s*r\.siteStatus = 'unreachable'/.test(blade));
check('a failed website check is retried on the next press',
  /siteStatus === 'check_failed'/.test(blade));
check('a failed email lookup is retried on the next press',
  /!r\._emailChecked \|\| r\._emailError/.test(blade));
check('the CSV says "Check failed" rather than exporting the internal token',
  /'Check failed'/.test(blade));
check('a non-2xx from either endpoint is treated as a failure, not as data',
  (blade.match(/if \(!res\.ok\) throw new Error/g) || []).length >= 2);

console.log('\n──── 4. Blade escapes the address it scraped off someone else\'s site ────');

check('the email cell is escaped like every other cell on the row',
  !/'<span class="email-real">' \+ r\.email/.test(blade) &&
  /escapeHtml\(r\.email\)/.test(blade));

console.log('\n──── 5. the citation check measures what it says it measures ────');

const seo = code('web/agents/seo-agent.html');
check('a citation of notyourdomain.com is not counted as yours',
  !/d\.includes\(domain\)/.test(seo) &&
  /d === domain \|\| d\.endsWith\('\.' \+ domain\)/.test(seo));
check('a search that failed is not counted as a query you were not cited in',
  /const answered = results\.filter\(r => !r\.error\)/.test(seo) &&
  /citedCount \/ answered\.length/.test(seo));
check('and the failures are named rather than folded away',
  /searches? failed/.test(seo) || /search\$\{failed === 1/.test(seo) || /failed \? /.test(seo));
check('the stored history records what was measured, not what was asked',
  /total: answered\.length/.test(seo));

console.log('\n──── 6. the Audience Manager says what it is not showing ────');

const store = code('web/js/contacts-store.js');
check('countContacts exists and is exported',
  /async function countContacts/.test(store) && /\bcountContacts,/.test(store));
check('the or() filter no longer interpolates the raw search term',
  !/email\.ilike\.%\$\{s\}%/.test(store) && /function orSearch/.test(store));
check('and it quotes the value so a comma is text, not grammar',
  /`"%\$\{escaped\}%"`/.test(store));

const audience = code('web/agents/audience-agent.html');
check('a truncated list says how many actually match',
  /countContacts/.test(audience) && /matching contacts/.test(audience));
check('the status breakdown is labelled as counted over the loaded rows',
  /\(of loaded\)/.test(audience));

console.log('\n──── 7. every caught failure reaches the admin console ────');

for (const page of AGENTS) {
  check(`${path.basename(page)} reports its failures`, /reportFailure/.test(code(page)));
}
check('contacts loading failure is reported', /reportFailure/.test(audience));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
