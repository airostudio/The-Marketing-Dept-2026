/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FETCH PAGE — Vercel Serverless Function
 * Server-side page fetch for the SEO Audit crawler (web/js/seo-audit.js).
 *
 * The crawler previously fetched pages directly from the browser, which fails
 * for almost every cross-origin site (no CORS headers) and fell back to
 * unreliable third-party CORS proxies (api.allorigins.win / corsproxy.io) —
 * and, when even those failed, to a hardcoded fake HTML stub that silently
 * produced a plausible-looking but entirely synthetic "audit". This endpoint
 * removes the need for both: a server-to-server fetch has no CORS
 * restriction, so it works for any public site directly.
 *
 * POST { url: string }
 * Returns:
 *   { success: true,  html, status, finalUrl }
 *   { success: false, error: string }               (4xx/5xx)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { safeFetchText } = require('./_lib/safe-fetch.js');

const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB — enough for real pages, bounded against abuse

// Rate limit: max 60 fetches per IP per minute (per serverless instance) —
// a single audit crawls up to ~25-100 pages, so this needs headroom above
// the simple single-URL checks elsewhere in the app.
const RL_WINDOW = 60_000;
const RL_MAX = 60;



function parseTarget(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const target = new URL(withProto);
  if (!target.hostname.includes('.')) throw new Error('Invalid hostname');

  // Shape check only. This endpoint accepts an arbitrary caller-supplied URL
  // and fetches it server-side, so the address check has to resolve the
  // hostname and re-check every redirect hop — that is
  // api/_lib/safe-fetch.js, called below. The blocklist that used to live
  // here could not do either, and three other copies of it around the
  // codebase had already drifted out of agreement with this one.
  return target;
}

module.exports = withFailureReporting('api/fetch-page', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'fetch-page', max: 60, windowMs: 60_000, auth })) return;

  const raw = (req.body?.url || '').trim();
  if (!raw) return res.status(400).json({ success: false, error: 'url is required' });

  let target;
  try {
    target = parseTarget(raw);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  try {
    const response = await safeFetchText(target.toString(), {
      method: 'GET',
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
      headers: {
        'User-Agent': 'Audema-SEOAudit/1.0 (+https://audema.com/seo-bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({ success: false, error: `Site responded with HTTP ${response.status}`, status: response.status });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('xml')) {
      return res.status(502).json({ success: false, error: `Unsupported content type: ${contentType || 'unknown'}` });
    }

    const html = response.text;

    if (!html || html.trim().length < 20) {
      return res.status(502).json({ success: false, error: 'Site returned an empty page' });
    }

    return res.status(200).json({
      success: true,
      html,
      status: response.status,
      finalUrl: response.url || target.toString(),
    });

  } catch (err) {
    // A refused target is the caller asking for something they may not have,
    // not this server failing to reach a site — 400, and say which address
    // was refused rather than reporting it as unreachable.
    if (err.message && err.message.startsWith('Refused to fetch')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    // AbortSignal.timeout() rejects with a TimeoutError; an aborted controller
    // gives AbortError. Both mean the same thing to the caller.
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    const isDns = err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND');
    const error = isTimeout
      ? 'Request timed out — site may be down or blocking automated requests'
      : isDns
        ? 'Domain not found — check the URL is correct'
        : `Could not reach site: ${err.message}`;
    return res.status(502).json({ success: false, error });
  }
});
