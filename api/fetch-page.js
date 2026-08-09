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

const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB — enough for real pages, bounded against abuse

// Rate limit: max 60 fetches per IP per minute (per serverless instance) —
// a single audit crawls up to ~25-100 pages, so this needs headroom above
// the simple single-URL checks elsewhere in the app.
const RL_WINDOW = 60_000;
const RL_MAX = 60;
const rateBuckets = new Map();

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + RL_WINDOW };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + RL_WINDOW; }
  bucket.count++;
  rateBuckets.set(ip, bucket);
  return bucket.count > RL_MAX;
}

function parseTarget(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const target = new URL(withProto);
  if (!target.hostname.includes('.')) throw new Error('Invalid hostname');

  // Block private IP ranges and localhost — this endpoint accepts an
  // arbitrary attacker-supplied URL and fetches it server-side, so without
  // this it would be an open SSRF proxy into internal/cloud-metadata addresses.
  const h = target.hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h === '0.0.0.0' ||
    h === '169.254.169.254' || // cloud metadata endpoint
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === '::1'
  ) {
    throw new Error('Private/internal addresses not allowed');
  }
  return target;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const ip = getIp(req);
  if (isRateLimited(ip)) return res.status(429).json({ success: false, error: 'Too many requests' });

  const raw = (req.body?.url || '').trim();
  if (!raw) return res.status(400).json({ success: false, error: 'url is required' });

  let target;
  try {
    target = parseTarget(raw);
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Audema-SEOAudit/1.0 (+https://audema.com/seo-bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(502).json({ success: false, error: `Site responded with HTTP ${response.status}`, status: response.status });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('xml')) {
      return res.status(502).json({ success: false, error: `Unsupported content type: ${contentType || 'unknown'}` });
    }

    const text = await response.text();
    const html = text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;

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
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    const isDns = err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND');
    const error = isTimeout
      ? 'Request timed out — site may be down or blocking automated requests'
      : isDns
        ? 'Domain not found — check the URL is correct'
        : `Could not reach site: ${err.message}`;
    return res.status(502).json({ success: false, error });
  }
};
