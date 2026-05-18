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

const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

// Rate limit: max 10 checks per IP per minute (per serverless instance)
const RL_WINDOW = 60_000;
const RL_MAX = 10;
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

export default async function handler(req, res) {
  // CORS headers so the browser client can call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIp(req);
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  // Parse and validate the target URL
  const raw = (req.query.url || '').trim();
  if (!raw) return res.status(400).json({ error: 'Missing url parameter' });

  let target;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    target = new URL(withProto);
    if (!target.hostname.includes('.')) throw new Error('Invalid hostname');
    // Block private IP ranges and localhost to prevent SSRF
    const h = target.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
      h === '::1'
    ) {
      return res.status(400).json({ error: 'Private/internal addresses not allowed' });
    }
  } catch {
    return res.status(400).json({ reachable: false, status: 0, error: 'Invalid URL format' });
  }

  // Perform a HEAD request (falls back to GET if HEAD is refused)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  async function probe(method) {
    return fetch(target.toString(), {
      method,
      redirect: 'follow',
      signal: controller.signal,
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
      // HEAD failed (e.g. network error) — try GET before giving up
      response = await probe('GET');
    }

    clearTimeout(timer);

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
    clearTimeout(timer);

    const isTimeout = err.name === 'AbortError';
    const isDns = err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND');

    const error = isTimeout
      ? 'Request timed out — site may be down or blocking bots'
      : isDns
        ? 'Domain not found — check the URL is correct'
        : `Could not reach site: ${err.message}`;

    return res.status(200).json({ reachable: false, status: 0, error });
  }
}
