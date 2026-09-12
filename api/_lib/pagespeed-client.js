/**
 * api/_lib/pagespeed-client.js — the actual Google PageSpeed Insights fetch,
 * factored out of api/pagespeed.js so a second caller (the website-audit
 * engine, api/_lib/website-audit.js) does not have to duplicate the
 * URL-building/query-param logic.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * This module owns exactly one thing: building the PageSpeed request and
 * making it. It does NOT authenticate the caller, rate limit, or validate
 * the incoming URL shape — api/pagespeed.js still does all of that itself,
 * unchanged, before ever calling in here. The route's external contract
 * (status codes, response body) is preserved byte-for-byte: on any network
 * failure or a body that isn't JSON, fetchPageSpeed throws — exactly what
 * the route's own fetch+`.json()` call used to do — so the route's existing
 * try/catch -> 502 path needs no change. On an ordinary HTTP response
 * (2xx or not) it resolves with {status, data}, and the route forwards
 * those exactly as it always did.
 */

'use strict';

const PAGESPEED_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Call PageSpeed Insights for one URL/strategy pair.
 *
 * @param {string} url        already-validated absolute http(s) URL
 * @param {string} [strategy] 'mobile' | 'desktop'
 * @param {string} [apiKey]   GOOGLE_PAGESPEED_API_KEY; omitted means an
 *                            unauthenticated (heavily rate-limited) request
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{status: number, data: object}>}
 * @throws {Error} on a network failure, timeout, or a non-JSON body — the
 *   same cases the inline fetch()+`.json()` used to throw on.
 */
async function fetchPageSpeed(url, strategy = 'mobile', apiKey, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90_000;

  const apiUrl = new URL(PAGESPEED_BASE);
  apiUrl.searchParams.set('url', url);
  apiUrl.searchParams.set('strategy', strategy);
  ['performance', 'accessibility', 'seo', 'best-practices'].forEach(c =>
    apiUrl.searchParams.append('category', c)
  );
  if (apiKey) apiUrl.searchParams.set('key', apiKey);

  const upstream = await fetch(apiUrl.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await upstream.json();
  return { status: upstream.status, data };
}

module.exports = { fetchPageSpeed, PAGESPEED_BASE };
