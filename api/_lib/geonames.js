/**
 * api/_lib/geonames.js — the place hierarchy Blade drills down through:
 * country → state/region → county/district → cities and towns, for any
 * country, from GeoNames (geonames.org, free account).
 *
 * Google Places can find businesses in a town but cannot list the towns in a
 * county, so this is where the list of places to search comes from.
 *
 * GeoNames levels: ADM1 = state / province / region, ADM2 = county /
 * district. Towns are populated places (feature class P), kept only when
 * they are real settlements — sections of a city (PPLX), historical (PPLH),
 * abandoned (PPLQ) and destroyed (PPLW) places are left out.
 *
 * Env: GEONAMES_USERNAME (required), GEONAMES_BASE_URL (optional; defaults to
 * https://secure.geonames.org).
 */

'use strict';

const DEFAULT_BASE = 'https://secure.geonames.org';
const SKIP_FCODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH', 'STLMT']);
const PAGE = 1000;           // GeoNames' maximum rows per call
const MAX_START_ROW = 4000;  // free accounts can page to row 5,000

function base() { return (process.env.GEONAMES_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''); }
function username() { return process.env.GEONAMES_USERNAME || ''; }
const NOT_CONFIGURED = 'GEONAMES_USERNAME is not set. Create a free account at geonames.org, enable "free web services" on its account page, and add the username in Vercel.';

async function call(path, params) {
  const user = username();
  if (!user) { const e = new Error(NOT_CONFIGURED); e.status = 503; throw e; }
  const qs = new URLSearchParams({ ...params, username: user, style: 'FULL' });
  const r = await fetch(`${base()}/${path}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({}));
  // GeoNames reports most errors with HTTP 200 and a status object.
  if (!r.ok || data.status) {
    const msg = (data.status && data.status.message) || `GeoNames error (HTTP ${r.status})`;
    const e = new Error(/limit|credits/i.test(msg) ? `GeoNames: ${msg} Try again later.` : `GeoNames: ${msg}`);
    e.status = r.ok ? 502 : r.status;
    throw e;
  }
  return data;
}

/** One place, in the shape the rest of Blade uses. */
function shape(g, level) {
  return {
    geonameId: Number(g.geonameId),
    name: String(g.name || g.toponymName || '').trim(),
    level,
    fcode: g.fcode || '',
    countryCode: g.countryCode || '',
    countryName: g.countryName || '',
    adminCode1: g.adminCode1 || '',
    adminName1: g.adminName1 || '',
    adminCode2: g.adminCode2 || '',
    adminName2: g.adminName2 || '',
    population: Number(g.population) || 0,
    lat: g.lat != null ? Number(g.lat) : null,
    lng: g.lng != null ? Number(g.lng) : null,
  };
}

/** Every country GeoNames knows, by name. */
async function countries() {
  const d = await call('countryInfoJSON', {});
  return (d.geonames || []).map(c => ({ geonameId: Number(c.geonameId), name: c.countryName, countryCode: c.countryCode, level: 'country', population: Number(c.population) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The next level down: a country's states/regions (ADM1), or a state's
 * counties/districts (ADM2).
 */
async function children(geonameId, childLevel) {
  const d = await call('childrenJSON', { geonameId: String(geonameId), maxRows: String(PAGE) });
  const want = childLevel === 'county' ? /^ADM2/ : /^ADM1/;
  return (d.geonames || []).filter(g => want.test(g.fcode || '')).map(g => shape(g, childLevel))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Cities and towns inside a state (adminCode1) or a county (adminCode2),
 * largest first.
 * @returns {Promise<{towns: Array, truncated: boolean, total: number}>}
 */
async function towns({ countryCode, adminCode1, adminCode2, minPopulation = 0 }) {
  if (!countryCode || !adminCode1) throw new Error('A country and a state/region are needed to list towns.');
  const out = []; let total = 0; let truncated = false;
  for (let start = 0; start <= MAX_START_ROW; start += PAGE) {
    const params = { country: countryCode, adminCode1, featureClass: 'P', maxRows: String(PAGE), startRow: String(start), orderby: 'population' };
    if (adminCode2) params.adminCode2 = adminCode2;
    const d = await call('searchJSON', params);
    total = Number(d.totalResultsCount) || 0;
    const page = d.geonames || [];
    for (const g of page) {
      if (SKIP_FCODES.has(g.fcode)) continue;
      const t = shape(g, 'town');
      if (t.population < minPopulation) continue;
      out.push(t);
    }
    // Ordered by population, so once places fall under the floor the rest will too.
    if (page.length < PAGE || (minPopulation > 0 && page.length && (Number(page[page.length - 1].population) || 0) < minPopulation)) break;
    if (start + PAGE > MAX_START_ROW) { truncated = total > start + PAGE; break; }
  }
  // The same town can appear twice under different feature codes.
  const seen = new Set();
  const unique = out.filter(t => { const k = `${t.name.toLowerCase()}|${t.adminCode2}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { towns: unique, truncated, total };
}

module.exports = { countries, children, towns, shape, NOT_CONFIGURED, SKIP_FCODES };
