/**
 * Blade could only search one city/town per run. This pins the shape of the
 * multi-area rework in web/agents/blade-agent.html: `state.areas` (an array)
 * replaces the old singular `state.city`, each area can optionally expand to
 * its surrounding suburbs/towns (via api/blade-nearby-areas.js), and running
 * a search fans out across every picked area plus every included suburb —
 * deduplicated, since the same suburb can be "nearby" for two different
 * picked areas.
 *
 * This is a source-level check (no DOM available in this test runner, same
 * constraint as tests/xss's admin-console checks) rather than executing the
 * page, but every assertion is against the actual current source, not a
 * guess at what it should say.
 *
 *   node tests/blade-multi-area/run.js
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

console.log('\n──── state holds MULTIPLE areas, not one city ────');
check('state.areas is an array, not a singular city object', /areas:\s*\[\]/.test(page));
check('the old singular state.city is gone entirely', !/state\.city\b/.test(page));

console.log('\n──── each area can be expanded to its surrounding suburbs/towns ────');
check('a per-area toggle exists for including surrounding areas', /includeSurrounding/.test(page));
check('expanding an area calls the new nearby-areas endpoint', /\/api\/blade-nearby-areas/.test(page));
check('the request carries the countryCode (the endpoint needs it to pick km vs miles)',
  /countryCode:\s*state\.country \? state\.country\.code : null/.test(page));
check('a resolved suburb can be excluded again without losing the rest', /suburb\.included = !suburb\.included/.test(page));

console.log('\n──── the radius shown to the user matches what the backend actually searches ────');
check('US (and the other mile-measuring countries) show 30 miles', /IMPERIAL_COUNTRIES = \{ US: 1, LR: 1, MM: 1 \}/.test(page));
check('everyone else shows 50 km', /'50 km'/.test(page) && /'30 miles'/.test(page));

console.log('\n──── running a search fans out across every area + included suburb, deduplicated ────');
const spMatch = page.match(/function searchPoints\(\)[\s\S]*?\n  \}/);
check('searchPoints() exists', !!spMatch);
const sp = spMatch ? spMatch[0] : '';
check('it dedupes by placeId across areas and suburbs (a suburb can be "nearby" to two picked areas)',
  /seen\.has\(area\.placeId\)/.test(sp) && /seen\.has\(s\.placeId\)/.test(sp));
check('only suburbs still marked included are searched', /s\.included/.test(sp));

console.log('\n──── results and exports know WHICH area each lead came from ────');
check('every merged result is tagged with the search point it came from', /r\.searchPoint = fromDescription/.test(page));
check('the CSV has a per-row search area column instead of one fixed city column',
  /'Search Area'/.test(page) && !/'City'/.test(page));
check('CSV rows use the per-result search point, not one global city', /r\.searchPoint \|\| ''/.test(page));

console.log('\n──── "load more" only resumes a single-point run (Google page tokens are per-query) ────');
check('a multi-point run does not carry a stale page token forward', /state\._lastSinglePoint = points\.length === 1/.test(page));
check('load-more explicitly requires the single-point condition', /loadMore && state\.nextPageToken && state\._lastSinglePoint/.test(page));

console.log('\n──── the new backend file itself exists and is wired the way the page expects ────');
const api = fs.readFileSync(path.join(REPO, 'api/blade-nearby-areas.js'), 'utf8');
check('takes placeId + countryCode', /placeId,\s*countryCode/.test(api));
check('is auth-gated like every other paid Blade endpoint', /requireUser\(req, res\)/.test(api));
check('is rate-limited like every other paid Blade endpoint', /rateLimited\(req, res/.test(api));
check('caps the radius at or under Nearby Search\'s own 50,000m ceiling',
  /METRIC_RADIUS_METERS = 50000/.test(api) && /IMPERIAL_RADIUS_METERS = Math\.round\(30 \* MILES_TO_METERS\)/.test(api));

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
