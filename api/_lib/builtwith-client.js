/**
 * api/_lib/builtwith-client.js — shared plumbing for the four BuiltWith proxy
 * endpoints (api/builtwith-domain.js, -lists.js, -trends.js,
 * -relationships.js).
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ██  UNVERIFIED AGAINST LIVE DOCUMENTATION — READ BEFORE PRODUCTION USE  ██
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This session's outbound network access to api.builtwith.com was BLOCKED by
 * the environment's egress proxy (EGRESS_BLOCKED on every direct fetch of
 * https://api.builtwith.com/domain-api, /lists-api, /trends-api and
 * /relationships-api). The endpoint URLs, parameter names, and auth scheme
 * below are reconstructed from public web search results (third-party blog
 * posts, the official builtwith/listapidemo GitHub repo, ProgrammableWeb's
 * mirror of the Trends API doc page, and BuiltWith's own dataset-fields KB
 * article) — NOT from a direct read of BuiltWith's current documentation,
 * and NOT from a real call against a real key.
 *
 * What is corroborated by more than one independent source and reasonably
 * trustworthy:
 *   - Auth is always `KEY=<your api key>` as a query parameter, on every one
 *     of these four products.
 *   - Domain API:        https://api.builtwith.com/v20/api.json?KEY=..&LOOKUP=<domain>
 *   - Trends API:         https://api.builtwith.com/trends/v6/api.json?KEY=..&TECH=<technology>
 *                          (an explicit worked example for this one was found:
 *                          .../trends/v6/api.json?KEY=00000000-0000-0000-0000-000000000000&TECH=Magento)
 *   - Relationships API:  https://api.builtwith.com/rv4/api.json?KEY=..&LOOKUP=<domain>
 *                          (also found as an explicit worked example)
 *   - Lists API technology param is `TECH`, spaces become dashes, and it
 *     supports `OFFSET`/pagination plus a `SINCE` time filter. It is
 *     SYNCHRONOUS (no submit-then-poll flow was found anywhere) — but the
 *     exact version segment of its URL (searches surfaced "lists1", i.e.
 *     something like https://api.builtwith.com/lists1/api.json?KEY=..&TECH=..)
 *     could NOT be pinned down with confidence, and BuiltWith's Lists/Trends
 *     APIs have both been through multiple numbered versions historically.
 *
 * What is NOT verified and MUST be checked against a real response before
 * this is trusted in production:
 *   - The exact nesting of the Domain API's JSON response (this code assumes
 *     something like Results[0].Result.Paths[].Technologies[{Name,Tag,
 *     FirstDetected,LastDetected,Categories}], which matches the general
 *     shape described in secondary sources but not a first-party example).
 *   - The exact field names in a Lists API response (this code assumes
 *     something like { Results: [{ Domain, ... }], NextOffset, Meta }, and
 *     that included per-domain metadata under `includeMetaData` — such as
 *     names/titles/social links/emails/phone/traffic rank — arrives inline
 *     on each result rather than in a separate structure).
 *   - The exact field names in a Trends API response (assumed to be a
 *     time series, e.g. { Results: [{ Date/Month, Count/Total, ... }] }).
 *   - The exact field names in a Relationships API response (assumed to be
 *     { Relationships: [{ Domain, Type, FirstIndexed, LastIndexed, ... }] }
 *     given the product description "what sites are linked together, by
 *     what and for how long").
 *   - Optional parameter names on each endpoint beyond the ones named above
 *     (e.g. Domain API's documented-elsewhere `hideAll`,
 *     `hideDescriptionAndLinks`, `onlyLiveTechnologies`, `noMetaData`,
 *     `noAttributeData` are assumed real but untested here).
 *   - Whether any of these four now live at a different version segment
 *     than the one guessed above (BuiltWith has moved Domain/Lists/Trends/
 *     Relationships across version numbers before).
 *
 * Every normalizer below therefore also returns the FULL raw upstream body
 * under `raw`, unmodified, specifically so an incomplete or wrong guess at
 * field names here never hides something the real API actually returned.
 * Before relying on this in production: fire one real request per endpoint
 * with a real BUILTWITH_API_KEY, log the raw JSON, and fix the field paths
 * in api/builtwith-*.js's normalize*() functions to match.
 * ══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const ENDPOINTS = {
  domain: (key, domain) =>
    `https://api.builtwith.com/v20/api.json?KEY=${encodeURIComponent(key)}&LOOKUP=${encodeURIComponent(domain)}`,
  lists: (key, tech, params) => {
    const qs = new URLSearchParams({ KEY: key, TECH: tech, ...params });
    return `https://api.builtwith.com/lists1/api.json?${qs.toString()}`;
  },
  trends: (key, tech) =>
    `https://api.builtwith.com/trends/v6/api.json?KEY=${encodeURIComponent(key)}&TECH=${encodeURIComponent(tech)}`,
  relationships: (key, domain) =>
    `https://api.builtwith.com/rv4/api.json?KEY=${encodeURIComponent(key)}&LOOKUP=${encodeURIComponent(domain)}`,
};

/**
 * Call one BuiltWith endpoint and return an honest result — never a
 * fabricated success. On any failure (missing key, network error, non-2xx,
 * unparseable body) returns { ok: false, status, reason }; the caller must
 * surface that to the client as a real error, not paper over it with an
 * empty-but-200 response.
 */
async function callBuiltWith(product, ...args) {
  const apiKey = process.env.BUILTWITH_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, reason: 'BUILTWITH_API_KEY is not configured.' };
  }

  const build = ENDPOINTS[product];
  if (!build) return { ok: false, status: 0, reason: `Unknown BuiltWith product "${product}".` };

  const url = build(apiKey, ...args);

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { ok: false, status: 0, reason: `Could not reach BuiltWith: ${(err && err.message) || err}` };
  }

  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* fall through with raw text */ }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      reason: `BuiltWith ${product} API returned ${res.status}: ${text.slice(0, 300)}`,
      raw: data !== null ? data : text.slice(0, 2000),
    };
  }

  if (data === null) {
    return {
      ok: false,
      status: res.status,
      reason: 'BuiltWith returned a 2xx response that was not valid JSON.',
      raw: text.slice(0, 2000),
    };
  }

  return { ok: true, status: res.status, data };
}

module.exports = { callBuiltWith };
