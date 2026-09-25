/**
 * api/_lib/grant-sources.js — where Audema looks for non-dilutive funding.
 *
 * Four regions, one normalised record shape. Where a government publishes a
 * real API we use it; where it doesn't, we scrape the listing page with the
 * same fetch-and-regex approach api/cron-competitor-watch.js already uses (no
 * npm dependencies anywhere in api/*.js, so no DOM parser is available).
 *
 * ── An honest note about verification ────────────────────────────────────
 * These adapters were written against each publisher's documented/observed
 * contract, but NONE of them could be called from the environment this code
 * was written in — outbound access to every government host was blocked by
 * egress policy. So the parsers here are deliberately defensive and loud:
 * each one distinguishes "the source returned nothing" from "the source
 * returned something we did not recognise", and the second case reports a
 * sample of what actually arrived instead of quietly yielding zero results.
 * A source whose shape has drifted should show up as a visible error on the
 * next run, not as a silently empty feed. Use the cron's dryRun mode to see
 * exactly what each source returns before trusting any of them.
 */

'use strict';

const FETCH_TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (compatible; AudemaFundingBot/1.0; +https://audema.ai/bot)';

/* ── Relevance ───────────────────────────────────────────────────────────
   Government funding portals list thousands of programs, the overwhelming
   majority of which have nothing to do with Audema. Inserting all of them
   would turn the funding pipeline into noise and defeat the point of having
   a scored pipeline at all. Every discovery must match at least one term
   before it is written, and the terms it matched are stored with it so a
   human can see why the machine thought it was relevant.
   ──────────────────────────────────────────────────────────────────────── */
const RELEVANCE_TERMS = [
  'artificial intelligence', ' ai ', 'machine learning', 'automation',
  'digital adoption', 'digital transformation', 'digitalisation', 'digitization',
  'small business', 'sme', 'smes', 'scale-up', 'scaleup', 'startup', 'start-up',
  'marketing', 'productivity', 'innovation', 'commercialisation', 'commercialization',
  'export', 'research and development', 'r&d', 'software', 'saas', 'technology adoption',
];

function matchedTerms(text) {
  const hay = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  return RELEVANCE_TERMS.filter(t => hay.includes(t)).map(t => t.trim());
}

/* ── Shared helpers ──────────────────────────────────────────────────────── */

async function httpJson(url, options) {
  const res = await fetch(url, Object.assign({
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }, options || {}));
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.sample = text.slice(0, 300);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Response was not JSON');
    err.sample = text.slice(0, 300);
    throw err;
  }
}

async function httpText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    throw err;
  }
  return res.text();
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function abs(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

/** Thrown when a source answered, but not in a shape we know how to read. */
function shapeError(sourceKey, got) {
  const err = new Error(
    `${sourceKey}: response did not match the expected shape — the source's format has probably changed.`);
  err.unrecognisedShape = true;
  err.sample = typeof got === 'string'
    ? got.slice(0, 300)
    : JSON.stringify(got).slice(0, 300);
  return err;
}

/* ── Sources ─────────────────────────────────────────────────────────────── */

const SOURCES = [
  /* ── UNITED STATES ──────────────────────────────────────────────────────
     Grants.gov publishes a genuinely public, key-free JSON search API. This
     is the most reliable of the four and the one most likely to work
     unchanged. Docs: grants.gov/api/search2                                */
  {
    key: 'us_grants_gov',
    region: 'us',
    name: 'Grants.gov (US federal)',
    mode: 'api',
    homepage: 'https://www.grants.gov/search-grants',
    async fetchAll() {
      const out = [];
      // Two passes: our two strongest themes. Keeps well inside the function
      // budget while covering more than a single generic query would.
      for (const keyword of ['artificial intelligence small business', 'small business technology adoption']) {
        const body = JSON.stringify({
          keyword,
          oppStatuses: 'forecasted|posted',
          rows: 25,
          startRecordNum: 0,
        });
        const json = await httpJson('https://api.grants.gov/v1/api/search2', {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        });

        const hits = json && json.data && json.data.oppHits;
        if (!Array.isArray(hits)) throw shapeError('us_grants_gov', json);

        hits.forEach(h => {
          out.push({
            external_id: String(h.id || h.number || h.oppNumber || ''),
            name: h.title || '(untitled)',
            funder: h.agency || h.agencyName || h.agencyCode || 'US Federal Agency',
            program: h.number || h.oppNumber || null,
            closes_at: isoDate(h.closeDate),
            opens_at: isoDate(h.openDate),
            source_url: h.id
              ? `https://www.grants.gov/search-results-detail/${encodeURIComponent(h.id)}`
              : 'https://www.grants.gov/search-grants',
            blurb: [h.title, h.agency, h.oppStatus].filter(Boolean).join(' · '),
          });
        });
      }
      return out;
    },
  },

  /* ── EUROPEAN UNION ─────────────────────────────────────────────────────
     The Funding & Tenders Portal is driven by the EU's own search API. The
     "SEDIA" key is the public one the portal itself passes; there is no
     registration. This endpoint is less formally documented than
     Grants.gov, so it is the likeliest of the four to need adjusting.     */
  {
    key: 'eu_funding_tenders',
    region: 'eu',
    name: 'EU Funding & Tenders Portal',
    mode: 'api',
    homepage: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-search',
    async fetchAll() {
      const url = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search'
        + '?apiKey=SEDIA&text=' + encodeURIComponent('artificial intelligence SME digital')
        + '&pageSize=40&pageNumber=1';
      const json = await httpJson(url, { method: 'POST' });

      const results = json && (json.results || json.hits);
      if (!Array.isArray(results)) throw shapeError('eu_funding_tenders', json);

      return results.map(r => {
        const md = r.metadata || {};
        const first = v => Array.isArray(v) ? v[0] : v;
        return {
          external_id: String(r.reference || first(md.identifier) || r.url || ''),
          name: stripTags(first(md.title) || r.title || '(untitled)'),
          funder: 'European Commission',
          program: first(md.programmePeriod) || first(md.frameworkProgramme) || null,
          closes_at: isoDate(first(md.deadlineDate)),
          opens_at: isoDate(first(md.startDate)),
          source_url: r.url || 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home',
          blurb: stripTags(first(md.description) || r.summary || ''),
        };
      });
    },
  },

  /* ── UNITED KINGDOM ─────────────────────────────────────────────────────
     GOV.UK exposes a public search API across published content. Used here
     rather than scraping Find a Grant's HTML, because a documented JSON
     endpoint that may return imperfect coverage beats a scraper that breaks
     silently on a markup change.                                          */
  {
    key: 'uk_gov_search',
    region: 'uk',
    name: 'GOV.UK (grants & funding)',
    mode: 'api',
    homepage: 'https://www.find-government-grants.service.gov.uk/grants',
    async fetchAll() {
      const url = 'https://www.gov.uk/api/search.json'
        + '?q=' + encodeURIComponent('business grant funding innovation')
        + '&count=40&fields=title,link,description,public_timestamp,organisations';
      const json = await httpJson(url);

      const results = json && json.results;
      if (!Array.isArray(results)) throw shapeError('uk_gov_search', json);

      return results.map(r => ({
        external_id: String(r.link || r._id || ''),
        name: r.title || '(untitled)',
        funder: (r.organisations && r.organisations[0] && r.organisations[0].title) || 'UK Government',
        program: null,
        closes_at: null,   // GOV.UK search does not expose a closing date
        opens_at: isoDate(r.public_timestamp),
        source_url: r.link ? abs(r.link, 'https://www.gov.uk') : 'https://www.gov.uk',
        blurb: r.description || '',
      }));
    },
  },

  /* ── AUSTRALIA ──────────────────────────────────────────────────────────
     business.gov.au publishes no open API for its grant finder, so this one
     genuinely is a scrape — the same fetch-and-regex approach as
     cron-competitor-watch.js. It is therefore the most fragile source here,
     and the one most likely to need the dryRun check after any site
     redesign.                                                             */
  {
    key: 'au_business_gov',
    region: 'au',
    name: 'business.gov.au grants & programs',
    mode: 'scrape',
    homepage: 'https://business.gov.au/grants-and-programs',
    async fetchAll() {
      const base = 'https://business.gov.au/grants-and-programs';
      const html = await httpText(base);

      // Grant listings are anchors into /grants-and-programs/<slug>. Pull the
      // distinct ones and use the link text as the title.
      const seen = new Set();
      const items = [];
      const re = /<a[^>]+href=["']([^"']*\/grants-and-programs\/[^"'#?]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const href = abs(m[1], base);
        const title = stripTags(m[2]);
        if (!href || !title || title.length < 8) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        items.push({
          external_id: href,
          name: title,
          funder: 'Australian Government (business.gov.au)',
          program: null,
          closes_at: null,
          opens_at: null,
          source_url: href,
          blurb: title,
        });
      }

      // Zero anchors on a page that definitely lists grants means the markup
      // changed — that is a broken scraper, not an empty result set, and it
      // must be reported as such rather than as "no grants today".
      if (!items.length) throw shapeError('au_business_gov', html);
      return items;
    },
  },
];

/** Coerce whatever date format a source uses into YYYY-MM-DD, or null. */
function isoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // Grants.gov uses MMDDYYYY.
  let m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Run one source and normalise its output.
 * Never throws — a failing source reports itself and the sweep carries on,
 * because one broken adapter must not blank out the other three.
 */
async function runSource(source) {
  const started = Date.now();
  try {
    const raw = await source.fetchAll();
    const items = (raw || [])
      .filter(r => r && r.external_id && r.name)
      .map(r => {
        const terms = matchedTerms(`${r.name} ${r.blurb || ''} ${r.program || ''}`);
        return Object.assign({}, r, {
          source_key: source.key,
          region: source.region,
          match_terms: terms,
          relevant: terms.length > 0,
        });
      });

    return {
      key: source.key, name: source.name, region: source.region, mode: source.mode,
      ok: true,
      fetched: items.length,
      relevant: items.filter(i => i.relevant).length,
      items,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      key: source.key, name: source.name, region: source.region, mode: source.mode,
      ok: false,
      error: err.message,
      // What actually came back, so a shape change is diagnosable without
      // having to reproduce the request by hand.
      sample: err.sample || null,
      unrecognisedShape: !!err.unrecognisedShape,
      fetched: 0, relevant: 0, items: [],
      ms: Date.now() - started,
    };
  }
}

module.exports = { SOURCES, runSource, matchedTerms, RELEVANCE_TERMS, isoDate, stripTags };
