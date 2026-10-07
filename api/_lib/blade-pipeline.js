/**
 * api/_lib/blade-pipeline.js — Blade's whole find → audit → shortlist →
 * contact-details pipeline as plain functions, so something other than a
 * person clicking through blade-agent.html can run it for real.
 *
 * Why this exists: Scotty's missions used to "run" an agent by asking Claude
 * to write what that agent would have produced. Nothing real happened — no
 * business was searched, no site was checked. This is the real thing: the
 * same Places search, the same website check, the same email and owner
 * lookups Blade's own page drives, behind two calls:
 *
 *   discoverLeads()  — fast; one Places search, a quick site check for each
 *                      result, shortlist. Fits comfortably in one request.
 *   enrichLead()     — slow per lead (email crawl + owner lookup); callers
 *                      batch it, a few leads per request, to stay inside the
 *                      function-duration ceiling.
 *
 * Kept free of HTTP and auth so a background job can call the same functions
 * later without a rewrite.
 *
 * Honesty rules, same as everywhere else in this app: an email or owner name
 * is only ever one that was actually found. Not found is '' / null, never a
 * plausible guess. A site that merely looks modern is not a lead.
 */

'use strict';

const { searchPlaces } = require('./places-search.js');
const { quickCheckWebsite } = require('./website-quickcheck.js');
const { findContactEmail } = require('./email-lookup.js');
const { findOwnerName } = require('./owner-lookup.js');
const { opportunityRank, personalizedNote } = require('./lead-scoring.js');

const MAX_PAGES = 3;               // 3 × 20 results; each page is a paid Places call
const SITE_CHECK_CONCURRENCY = 8;
const DEFAULT_MAX_CANDIDATES = 40;
const DEFAULT_MAX_LEADS = 25;
const QUALIFYING_MAX_RANK = 2;     // no website, builder-locked, or outdated (see lead-scoring.js)

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

function cleanParam(v, max = 80) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Find and audit local businesses, returning only the genuine opportunities.
 *
 * @param {object} opts
 * @param {string} opts.placesKey  GOOGLE_PLACES_API_KEY
 * @param {string} opts.sector     e.g. "Plumbers"
 * @param {string} opts.city       e.g. "Austin"
 * @param {string} [opts.country]  e.g. "USA"
 * @returns {Promise<{leads: Array, stats: object}>}
 */
async function discoverLeads({ placesKey, sector, city, country = '', maxCandidates = DEFAULT_MAX_CANDIDATES, maxLeads = DEFAULT_MAX_LEADS }) {
  const sectorClean = cleanParam(sector);
  const cityClean = cleanParam(city);
  const countryClean = cleanParam(country);
  if (!sectorClean) throw new Error('A trade or sector (e.g. "plumbers") is required.');
  if (!cityClean) throw new Error('A city or area is required.');

  const textQuery = `${sectorClean} in ${cityClean}${countryClean ? ', ' + countryClean : ''}`;

  const candidates = [];
  const seen = new Set();
  let pageToken = null;
  let pagesFetched = 0;
  while (candidates.length < maxCandidates && pagesFetched < MAX_PAGES) {
    const page = await searchPlaces(placesKey, pageToken ? { pageToken } : { textQuery });
    pagesFetched++;
    for (const place of page.results) {
      if (!place.placeId || seen.has(place.placeId) || !place.name) continue;
      // A business that has permanently closed is never a lead.
      if (place.businessStatus === 'CLOSED_PERMANENTLY') continue;
      seen.add(place.placeId);
      candidates.push(place);
      if (candidates.length >= maxCandidates) break;
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  const audited = await runWithConcurrency(candidates, SITE_CHECK_CONCURRENCY, async (place) => {
    let siteStatus = 'no_website';
    let sitePlatform = null;
    let siteReasons = [];
    if (place.website) {
      const check = await quickCheckWebsite(place.website);
      siteStatus = check.status; // 'outdated' | 'modern' | 'unreachable'
      sitePlatform = check.signals?.platform || null;
      siteReasons = check.reasons || [];
    }
    const rank = opportunityRank({ siteStatus, sitePlatform });
    return {
      placeId: place.placeId,
      name: place.name,
      address: place.address,
      area: cityClean,
      phone: place.phone || '',
      website: place.website || '',
      rating: place.rating,
      reviewCount: place.reviewCount,
      mapsUrl: place.mapsUrl,
      siteStatus, sitePlatform, siteReasons, rank,
      note: personalizedNote({ siteStatus, sitePlatform, siteReasons }),
      email: null, emailSource: null,
      ownerFirstName: '', ownerSource: '',
      enriched: false, enrichError: null,
    };
  });

  const qualifying = audited
    .filter(l => l.rank <= QUALIFYING_MAX_RANK)
    // Best opportunity first; among equals, the one with fewer reviews — a
    // quieter business has more to gain — the same ordering Blade's own
    // "shortlist" control uses.
    .sort((a, b) => (a.rank - b.rank) || ((a.reviewCount ?? 0) - (b.reviewCount ?? 0)));
  const leads = qualifying.slice(0, maxLeads);

  return {
    leads,
    stats: {
      query: textQuery,
      pagesFetched,
      candidatesChecked: candidates.length,
      qualified: qualifying.length,
      shortlisted: leads.length,
      noWebsite: leads.filter(l => l.siteStatus === 'no_website').length,
      builderLocked: leads.filter(l => l.sitePlatform).length,
    },
  };
}

/**
 * Find a real contact email and owner first name for one lead.
 * Never throws: a lookup that errors is recorded in `enrichError` and the
 * field is left blank, which the UI shows differently from "searched, nobody
 * found" so a failure is retryable rather than read as a verdict.
 */
async function enrichLead(lead, { country = '' } = {}) {
  // Defaults first, so a lead that arrives without these fields still comes
  // out with them blank rather than undefined.
  const out = {
    ...lead,
    email: lead.email ?? null, emailSource: lead.emailSource ?? null,
    ownerFirstName: lead.ownerFirstName ?? '', ownerSource: lead.ownerSource ?? '',
    enriched: true, enrichError: null,
  };
  const errors = [];

  // A business with no website has no domain to crawl or search by — an email
  // for it can't be found here, and one is never invented.
  if (lead.website) {
    try {
      const found = await findContactEmail(lead.website);
      out.email = found.email;
      out.emailSource = found.dataSource === 'not_found' ? null : found.dataSource;
    } catch (e) { errors.push(`email: ${e.message}`); }
  }

  if (process.env.APOLLO_API_KEY || process.env.PERPLEXITY_API_KEY) {
    try {
      const owner = await findOwnerName({
        businessName: lead.name, suburb: lead.area, country, website: lead.website || undefined,
      });
      out.ownerFirstName = owner.firstName;
      out.ownerSource = owner.source;
    } catch (e) { errors.push(`owner: ${e.message}`); }
  }

  if (errors.length) out.enrichError = errors.join('; ');
  return out;
}

module.exports = { discoverLeads, enrichLead, runWithConcurrency, cleanParam, DEFAULT_MAX_LEADS, DEFAULT_MAX_CANDIDATES };
