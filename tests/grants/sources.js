/**
 * Grant source adapter checks.
 *
 * ── Why these are fixture tests, not live ones ──────────────────────────
 * Every government host (api.grants.gov, api.tech.ec.europa.eu, www.gov.uk,
 * business.gov.au) was blocked by egress policy in the environment these
 * adapters were written in, so their live response shapes are UNVERIFIED.
 * These tests therefore prove two things that are still worth proving:
 *
 *   1. Given a response in each publisher's documented shape, the adapter
 *      normalises it correctly — right ids, dates, urls, relevance terms.
 *   2. Given a response that is NOT that shape, the adapter fails loudly
 *      with a sample of what arrived, rather than returning zero results.
 *
 * (2) is the one that matters most. A silently-empty feed looks identical to
 * "no new grants this week" and could go unnoticed for months.
 *
 *   node tests/grants/sources.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '../..');
const { SOURCES, runSource, matchedTerms, isoDate } =
  require(path.join(REPO, 'api/_lib/grant-sources.js'));

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

/* Swap global fetch for a scripted responder. */
function withFetch(responder, fn) {
  const real = global.fetch;
  global.fetch = responder;
  return fn().finally(() => { global.fetch = real; });
}
const jsonRes = (obj, ok = true, status = 200) => ({
  ok, status, text: async () => JSON.stringify(obj),
});
const textRes = (body, ok = true, status = 200) => ({ ok, status, text: async () => body });

const src = k => SOURCES.find(s => s.key === k);

(async () => {
  console.log('──── coverage ────');
  check('four regions covered: AU, UK, EU, US',
    ['au', 'uk', 'eu', 'us'].every(r => SOURCES.some(s => s.region === r)));
  check('each source declares whether it is an API or a scrape',
    SOURCES.every(s => s.mode === 'api' || s.mode === 'scrape'));

  console.log('\n──── date normalisation ────');
  check('Grants.gov MMDDYYYY → ISO', isoDate('11302026') === '2026-11-30');
  check('ISO passes through', isoDate('2026-03-01T00:00:00Z') === '2026-03-01');
  check('junk becomes null, not Invalid Date', isoDate('not a date') === null && isoDate('') === null);

  console.log('\n──── relevance filter ────');
  check('an AI/SME program matches',
    matchedTerms('Artificial Intelligence adoption for small business').length > 0);
  check('an unrelated program does not',
    matchedTerms('Regional koala habitat corridor restoration').length === 0);

  /* ── US: Grants.gov ──────────────────────────────────────────────────── */
  console.log('\n──── US · Grants.gov ────');
  const usPayload = {
    errorcode: 0,
    data: {
      hitCount: 1,
      oppHits: [{
        id: '350123', number: 'NSF-26-500', title: 'Artificial Intelligence for Small Business',
        agency: 'National Science Foundation', openDate: '01152026', closeDate: '04302026',
        oppStatus: 'posted',
      }],
    },
  };
  let r = await withFetch(async () => jsonRes(usPayload), () => runSource(src('us_grants_gov')));
  console.log('  normalised:', JSON.stringify(r.items[0] && {
    id: r.items[0].external_id, closes: r.items[0].closes_at, url: r.items[0].source_url }));
  check('parses the documented shape', r.ok && r.fetched === 2); // two keyword passes
  check('keeps the publisher id for dedupe', r.items[0].external_id === '350123');
  check('converts the MMDDYYYY close date', r.items[0].closes_at === '2026-04-30');
  check('builds a real detail URL', /search-results-detail\/350123/.test(r.items[0].source_url));
  check('flags it relevant on its own terms', r.items[0].relevant === true);

  r = await withFetch(async () => jsonRes({ errorcode: 0, data: {} }),
    () => runSource(src('us_grants_gov')));
  check('a drifted shape fails loudly, not silently empty',
    !r.ok && r.unrecognisedShape === true && r.fetched === 0);
  check('and reports what actually arrived', typeof r.sample === 'string' && r.sample.length > 0);

  r = await withFetch(async () => jsonRes({ error: 'nope' }, false, 500),
    () => runSource(src('us_grants_gov')));
  check('an HTTP error is reported, not swallowed', !r.ok && /HTTP 500/.test(r.error));

  /* ── EU ──────────────────────────────────────────────────────────────── */
  console.log('\n──── EU · Funding & Tenders Portal ────');
  const euPayload = {
    totalResults: 1,
    results: [{
      reference: 'HORIZON-CL4-2026-DIGITAL-01',
      url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/x',
      metadata: {
        title: ['AI adoption by European SMEs'],
        deadlineDate: ['2026-09-17T17:00:00+02:00'],
        description: ['Support for small business digital transformation.'],
        frameworkProgramme: ['Horizon Europe'],
      },
    }],
  };
  r = await withFetch(async () => jsonRes(euPayload), () => runSource(src('eu_funding_tenders')));
  check('parses the portal shape', r.ok && r.fetched === 1);
  check('unwraps single-element metadata arrays', r.items[0].name === 'AI adoption by European SMEs');
  check('normalises the deadline', r.items[0].closes_at === '2026-09-17');
  check('carries the topic reference', r.items[0].external_id === 'HORIZON-CL4-2026-DIGITAL-01');

  r = await withFetch(async () => jsonRes({ unexpected: true }), () => runSource(src('eu_funding_tenders')));
  check('a drifted shape fails loudly', !r.ok && r.unrecognisedShape === true);

  /* ── UK ──────────────────────────────────────────────────────────────── */
  console.log('\n──── UK · GOV.UK search ────');
  const ukPayload = {
    results: [{
      title: 'Innovation grant for small business technology adoption',
      link: '/guidance/innovation-grant',
      description: 'Funding for SMEs adopting new software.',
      public_timestamp: '2026-02-01T09:00:00Z',
      organisations: [{ title: 'Department for Business and Trade' }],
    }],
  };
  r = await withFetch(async () => jsonRes(ukPayload), () => runSource(src('uk_gov_search')));
  check('parses the search shape', r.ok && r.fetched === 1);
  check('makes the relative link absolute',
    r.items[0].source_url === 'https://www.gov.uk/guidance/innovation-grant');
  check('attributes the department', /Business and Trade/.test(r.items[0].funder));
  check('leaves close date null rather than inventing one', r.items[0].closes_at === null);

  r = await withFetch(async () => jsonRes({ results: 'not an array' }), () => runSource(src('uk_gov_search')));
  check('a drifted shape fails loudly', !r.ok && r.unrecognisedShape === true);

  /* ── AU (the scrape) ─────────────────────────────────────────────────── */
  console.log('\n──── AU · business.gov.au (scrape) ────');
  const auHtml = `<html><body>
    <a href="/grants-and-programs/rd-tax-incentive">Research and Development Tax Incentive</a>
    <a href="/grants-and-programs/emdg">Export Market Development Grants</a>
    <a href="/grants-and-programs/rd-tax-incentive">Research and Development Tax Incentive</a>
    <a href="/about">About</a>
  </body></html>`;
  r = await withFetch(async () => textRes(auHtml), () => runSource(src('au_business_gov')));
  check('extracts grant links from the listing', r.ok && r.fetched === 2);
  check('deduplicates repeated links', new Set(r.items.map(i => i.external_id)).size === 2);
  check('ignores non-grant navigation links',
    !r.items.some(i => /\/about$/.test(i.external_id)));
  check('resolves links to absolute URLs',
    r.items.every(i => i.external_id.startsWith('https://business.gov.au/')));

  // The important one for a scraper: a redesign must not read as "no grants".
  r = await withFetch(async () => textRes('<html><body><p>Site redesigned</p></body></html>'),
    () => runSource(src('au_business_gov')));
  check('a markup change reports a BROKEN SCRAPER, not an empty week',
    !r.ok && r.unrecognisedShape === true);

  /* ── One bad source must not take down the sweep ─────────────────────── */
  console.log('\n──── isolation ────');
  const mixed = await Promise.all([
    withFetch(async () => { throw new Error('network down'); }, () => runSource(src('us_grants_gov'))),
    withFetch(async () => jsonRes(euPayload), () => runSource(src('eu_funding_tenders'))),
  ]);
  check('a failing source reports itself without throwing', mixed[0].ok === false);
  check('and the other source still returns results', mixed[1].ok === true && mixed[1].fetched === 1);

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
