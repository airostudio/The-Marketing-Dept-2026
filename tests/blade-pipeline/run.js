/**
 * api/_lib/blade-pipeline.js — Blade's find → audit → shortlist → contact
 * details as plain functions, so a Scotty mission can run it for real.
 * Everything external is mocked; this checks the pipeline's own decisions:
 * who counts as a lead, what order they come in, and that a missing email or
 * owner name stays missing instead of being invented.
 *
 *   node tests/blade-pipeline/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

let placesPages = [];
let placesCalls = [];
mockModule('api/_lib/places-search.js', {
  searchPlaces: async (key, q) => { placesCalls.push(q); return placesPages.shift() || { results: [], nextPageToken: null }; },
});
const siteResults = {};
mockModule('api/_lib/website-quickcheck.js', {
  quickCheckWebsite: async (url) => siteResults[url] || { status: 'modern', signals: {}, reasons: [] },
});
let emailImpl = async () => ({ email: null, dataSource: 'not_found' });
mockModule('api/_lib/email-lookup.js', { findContactEmail: (d) => emailImpl(d) });
let ownerImpl = async () => ({ firstName: '', source: '' });
mockModule('api/_lib/owner-lookup.js', { findOwnerName: (a) => ownerImpl(a) });

const { discoverLeads, enrichLead } = require(path.join(REPO, 'api/_lib/blade-pipeline.js'));

const place = (id, name, website, extra = {}) => ({ placeId: id, name, address: '1 St', phone: '555', website: website || '', rating: 4, reviewCount: 10, businessStatus: 'OPERATIONAL', mapsUrl: 'm', ...extra });

(async () => {

console.log('\n──── inputs are required before anything is spent ────');
{
  placesCalls = [];
  let err1, err2;
  try { await discoverLeads({ placesKey: 'k', sector: '', city: 'Austin' }); } catch (e) { err1 = e; }
  try { await discoverLeads({ placesKey: 'k', sector: 'plumbers', city: '  ' }); } catch (e) { err2 = e; }
  check('a missing trade is refused', !!err1 && /trade or sector/i.test(err1.message));
  check('a missing city is refused', !!err2 && /city or area/i.test(err2.message));
  check('no Places call was made for either', placesCalls.length === 0);
}

console.log('\n──── only genuine opportunities become leads ────');
{
  placesPages = [{ nextPageToken: null, results: [
    place('p1', 'Old Site Plumbing', 'https://old.example'),
    place('p2', 'Modern Plumbing', 'https://modern.example'),
    place('p3', 'No Site Plumbing', ''),
    place('p4', 'Wix Plumbing', 'https://wix.example'),
    place('p5', 'Closed Plumbing', '', { businessStatus: 'CLOSED_PERMANENTLY' }),
    place('p1', 'Duplicate Of P1', 'https://old.example'),
  ] }];
  siteResults['https://old.example'] = { status: 'outdated', signals: {}, reasons: ['No mobile-responsive (viewport) tag'] };
  siteResults['https://wix.example'] = { status: 'modern', signals: { platform: 'wix' }, reasons: [] };
  const { leads, stats } = await discoverLeads({ placesKey: 'k', sector: 'plumbers', city: 'Austin', country: 'USA' });
  const ids = leads.map(l => l.placeId);
  check('a modern site with no builder lock-in is not a lead', !ids.includes('p2'));
  check('a permanently closed business is never a lead', !ids.includes('p5'));
  check('a business seen twice is only counted once', ids.filter(i => i === 'p1').length === 1);
  check('no-website, builder-locked and outdated all qualify', ['p1', 'p3', 'p4'].every(i => ids.includes(i)));
  check('best opportunity first: no website, then builder-locked, then outdated', ids.join(',') === 'p3,p4,p1');
  check('the stats say what was actually checked', stats.candidatesChecked === 4 && stats.qualified === 3 && stats.noWebsite === 1 && stats.builderLocked === 1);
  check('the search query is the trade, place and country', stats.query === 'plumbers in Austin, USA');
  check('a no-website lead gets the honest Google-listing note', leads[0].note === 'Currently relies on Google listing');
  check('nothing is pre-filled — email and owner start empty and unenriched', leads.every(l => l.email === null && l.ownerFirstName === '' && l.enriched === false));
}

console.log('\n──── paging is bounded and the shortlist is capped ────');
{
  placesCalls = [];
  const mk = (n) => Array.from({ length: 20 }, (_, i) => place(`q${n}-${i}`, `B${n}-${i}`, ''));
  placesPages = [{ results: mk(1), nextPageToken: 't1' }, { results: mk(2), nextPageToken: 't2' }, { results: mk(3), nextPageToken: 't3' }, { results: mk(4), nextPageToken: 't4' }];
  const { leads } = await discoverLeads({ placesKey: 'k', sector: 'x', city: 'y', maxCandidates: 100, maxLeads: 7 });
  check('never fetches more than 3 pages of paid Places results', placesCalls.length === 3);
  check('the shortlist honours maxLeads', leads.length === 7);
  check('the second call pages with the token, not a fresh query', placesCalls[1].pageToken === 't1' && !placesCalls[1].textQuery);
}

console.log('\n──── enrichment never invents what it cannot find ────');
{
  let emailCalls = 0;
  emailImpl = async () => { emailCalls++; return { email: 'hi@real.example', dataSource: 'real' }; };
  ownerImpl = async () => ({ firstName: 'Dana', source: 'https://x' });
  process.env.PERPLEXITY_API_KEY = 'k';

  const withSite = await enrichLead({ name: 'A', area: 'Austin', website: 'https://real.example', enriched: false });
  check('a real email is carried through with its source', withSite.email === 'hi@real.example' && withSite.emailSource === 'real');
  check('a found owner is carried through with its source', withSite.ownerFirstName === 'Dana' && withSite.ownerSource === 'https://x');
  check('the lead is marked enriched', withSite.enriched === true && withSite.enrichError === null);

  emailCalls = 0;
  const noSite = await enrichLead({ name: 'B', area: 'Austin', website: '', enriched: false });
  check('a business with no website gets no email lookup — there is no domain to search', emailCalls === 0 && noSite.email === null);

  emailImpl = async () => ({ email: null, dataSource: 'not_found' });
  ownerImpl = async () => ({ firstName: '', source: '' });
  const nothing = await enrichLead({ name: 'C', area: 'Austin', website: 'https://c.example', enriched: false });
  check('an honest "not found" stays blank, with no error recorded', nothing.email === null && nothing.ownerFirstName === '' && nothing.enrichError === null);

  emailImpl = async () => { throw new Error('crawl exploded'); };
  ownerImpl = async () => { throw new Error('perplexity 500'); };
  const failed = await enrichLead({ name: 'D', area: 'Austin', website: 'https://d.example', enriched: false });
  check('a lookup that errors never throws out of enrichLead', failed.enriched === true);
  check('a failure is recorded as a failure, distinct from "searched, found nobody"', /email: crawl exploded/.test(failed.enrichError) && /owner: perplexity 500/.test(failed.enrichError));
  check('and the fields stay blank rather than becoming a guess', failed.email === null && failed.ownerFirstName === '');
}

console.log('\n──── no lookup keys configured means no owner lookup, not a fake one ────');
{
  delete process.env.APOLLO_API_KEY; delete process.env.PERPLEXITY_API_KEY;
  let ownerCalled = false;
  ownerImpl = async () => { ownerCalled = true; return { firstName: 'Ghost', source: '' }; };
  emailImpl = async () => ({ email: null, dataSource: 'not_found' });
  const out = await enrichLead({ name: 'E', area: 'Austin', website: 'https://e.example', enriched: false });
  check('owner lookup is skipped entirely', !ownerCalled && out.ownerFirstName === '');
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
