/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * URL REACHABILITY CHECK — Vercel Serverless Function
 * Server-side HTTP probe so the client can verify a URL is real and reachable
 * before starting a full SEO analysis.
 *
 * GET /api/check-url?url=https://example.com
 *
 * Returns:
 *   { reachable: true,  status: 200, title: "Example Domain" }
 *   { reachable: false, status: 404, error: "Not Found" }
 *   { reachable: false, status: 0,   error: "DNS lookup failed / timeout" }
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { safeFetch } = require('./_lib/safe-fetch.js');

const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

// Rate limit: max 80 checks per IP per minute (per serverless instance)
const RL_WINDOW = 60_000;
// 80/min — high enough to cover both the project-wizard's one-off reachability
// check and the SEO audit's bulk broken-link verification (up to 50 links/run).
const RL_MAX = 80;



module.exports = withFailureReporting('api/check-url', async function handler(req, res) {
  // CORS headers so the browser client can call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'check-url', max: 80, windowMs: 60_000, auth })) return;

  // Parse and validate the target URL
  const raw = (req.query.url || '').trim();
  if (!raw) return res.status(400).json({ error: 'Missing url parameter' });

  let target;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    target = new URL(withProto);
    if (!target.hostname.includes('.')) throw new Error('Invalid hostname');
    // The address check runs at fetch time, in api/_lib/safe-fetch.js. The
    // blocklist that used to be here matched hostname strings only, so it
    // missed the numeric spellings of an address and anything a caller's own
    // DNS pointed inward — and it had drifted from the copy in
    // api/fetch-page.js, silently allowing 0.0.0.0 and the cloud metadata
    // endpoint that the other copy blocked.
  } catch {
    return res.status(400).json({ reachable: false, status: 0, error: 'Invalid URL format' });
  }

  // Perform a HEAD request (falls back to GET if HEAD is refused).
  // safeFetch owns the timeout, so there is no AbortController here.
  async function probe(method) {
    return safeFetch(target.toString(), {
      method,
      timeoutMs: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Audema-URLCheck/1.0 (SEO Audit Bot; +https://audema.com)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    });
  }

  try {
    let response;
    try {
      response = await probe('HEAD');
      // Some servers refuse HEAD — retry with GET if we get 405 or a weird 4xx
      if (response.status === 405 || response.status === 501) {
        response = await probe('GET');
      }
    } catch (headErr) {
      // A refused target will refuse the GET too — don't spend a second
      // lookup on it, and let the outer handler report why it was refused
      // rather than dressing it up as an unreachable site.
      if (headErr.message && headErr.message.startsWith('Refused to fetch')) throw headErr;
      // HEAD failed (e.g. network error) — try GET before giving up
      response = await probe('GET');
    }

    const status = response.status;
    const reachable = status >= 200 && status < 400;

    // Extract page title from GET responses (not available on HEAD)
    let title = null;
    if (reachable && response.headers.get('content-type')?.includes('text/html')) {
      try {
        const text = await response.text();
        const match = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        if (match) title = match[1].trim();
      } catch { /* title is optional */ }
    }

    return res.status(200).json({ reachable, status, title, url: target.toString() });

  } catch (err) {
    if (err.message && err.message.startsWith('Refused to fetch')) {
      return res.status(400).json({ reachable: false, status: 0, error: err.message });
    }

    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    const isDns = err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND');

    const error = isTimeout
      ? 'Request timed out — site may be down or blocking bots'
      : isDns
        ? 'Domain not found — check the URL is correct'
        : `Could not reach site: ${err.message}`;

    return res.status(200).json({ reachable: false, status: 0, error });
  }
});
