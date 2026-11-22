/**
 * findEmailByBusiness — finding a contact email for a business by searching
 * Google/social listings, for the many small businesses with no website that
 * publish a gmail address on a Facebook page or directory listing.
 *
 * Search results are the one place an address could be invented, so this
 * checks the guards: an address must appear in the text AND come with a cited
 * page; it is confirmed by actually finding it on that page, and if it can't
 * be confirmed it is labelled 'estimate', never 'verified'.
 *
 *   node tests/email-search-by-business/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

let searchResult = null, searchCalls = [];
mockModule('api/_lib/nancy-providers.js', { searchProvider: async (q, o) => { searchCalls.push({ q, o }); return searchResult; } });
let pages = {};
mockModule('api/_lib/safe-fetch.js', {
  safeFetchText: async (url) => {
    if (!(url in pages)) throw new Error('unreachable');
    return { status: 200, text: pages[url], headers: new Map([['content-type', 'text/html']]) };
  },
});

const { findEmailByBusiness } = require(path.join(REPO, 'api/_lib/email-lookup.js'));
const biz = { businessName: 'Bobs Plumbing', area: 'Austin', country: 'USA' };

(async () => {
  console.log('\n──── an address confirmed on the page it was cited from is verified ────');
  {
    searchCalls = [];
    pages = { 'https://facebook.com/bobs': '<html>Contact us: <a href="mailto:Bobsplumbing@Gmail.com">email</a></html>' };
    searchResult = { available: true, text: 'Bob\'s Plumbing publishes bobsplumbing@gmail.com on its Facebook page.', citations: ['https://facebook.com/bobs'] };
    const r = await findEmailByBusiness(biz);
    check('the address is returned, verified, with the page that proved it', r.email === 'bobsplumbing@gmail.com' && r.dataSource === 'search_verified' && r.source === 'https://facebook.com/bobs');
    check('a gmail address is accepted — small businesses use them', /gmail\.com$/.test(r.email));
    check('the search names the business and the place', /Bobs Plumbing/.test(searchCalls[0].q) && /Austin, USA/.test(searchCalls[0].q));
    check('the search is told never to guess an address', /never guess/i.test(searchCalls[0].o.systemPrompt));
  }

  console.log('\n──── cited but not confirmable on the page: kept, but labelled estimate ────');
  {
    pages = {}; // the cited page can't be fetched (e.g. a login-walled social page)
    searchResult = { available: true, text: 'Try bobsplumbing@gmail.com', citations: ['https://instagram.com/bobs'] };
    const r = await findEmailByBusiness(biz);
    check('still returned, as an estimate — never claimed to be confirmed', r.email === 'bobsplumbing@gmail.com' && r.dataSource === 'estimate' && r.source === 'https://instagram.com/bobs');
  }
  {
    pages = { 'https://facebook.com/bobs': '<html>nothing useful here</html>' };
    searchResult = { available: true, text: 'bobsplumbing@gmail.com', citations: ['https://facebook.com/bobs'] };
    const r = await findEmailByBusiness(biz);
    check('a cited page that does NOT contain the address does not verify it', r.dataSource === 'estimate');
  }

  console.log('\n──── no cited source means no provenance, so no address ────');
  {
    searchResult = { available: true, text: 'Their email is bobsplumbing@gmail.com', citations: [] };
    const r = await findEmailByBusiness(biz);
    check('an address with no cited page is rejected outright', r.email === null && r.dataSource === 'not_found');
  }

  console.log('\n──── nothing found, and junk, are never returned as a contact ────');
  {
    searchResult = { available: true, text: 'I could not find a published email address for this business.', citations: ['https://x.example'] };
    check('"could not find one" is not_found', (await findEmailByBusiness(biz)).dataSource === 'not_found');

    searchResult = { available: true, text: 'noreply@facebookmail.com, help@facebook.com, no-reply@acme.com', citations: ['https://x.example'] };
    const r = await findEmailByBusiness(biz);
    check('a platform\'s own address and no-reply senders are filtered out', r.email === null);

    searchResult = { available: true, text: 'image@2x.png and notanemail', citations: ['https://x.example'] };
    check('file names and non-addresses are not mistaken for emails', (await findEmailByBusiness(biz)).email === null);
  }

  console.log('\n──── no search available, or nothing to search for ────');
  {
    searchResult = { available: false, reason: 'PERPLEXITY_API_KEY not configured' };
    const r = await findEmailByBusiness(biz);
    check('an unconfigured search is reported as unavailable, not as "found nothing"', r.dataSource === 'unavailable' && r.email === null);

    searchCalls = [];
    const blank = await findEmailByBusiness({ businessName: '  ' });
    check('a blank business name searches nothing at all', blank.dataSource === 'not_found' && searchCalls.length === 0);
  }

  console.log('\n──── the first address that verifies wins over earlier ones that do not ────');
  {
    pages = { 'https://yelp.example/p': 'reach us at real@bobs.example' };
    searchResult = { available: true, text: 'Possibly old@bobs.example, but the page shows real@bobs.example', citations: ['https://yelp.example/p'] };
    const r = await findEmailByBusiness(biz);
    check('the confirmed address is chosen, not merely the first mentioned', r.email === 'real@bobs.example' && r.dataSource === 'search_verified');
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
