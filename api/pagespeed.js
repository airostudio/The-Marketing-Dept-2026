/**
 * Google PageSpeed Insights proxy — Vercel serverless function.
 * Credentials never leave the server; key is read from GOOGLE_PAGESPEED_API_KEY env var.
 */

const PAGESPEED_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
  }

  const { url, strategy = 'mobile' } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'URL must use http or https' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (!['mobile', 'desktop'].includes(strategy)) {
    return res.status(400).json({ error: 'strategy must be mobile or desktop' });
  }

  const apiUrl = new URL(PAGESPEED_BASE);
  apiUrl.searchParams.set('url', parsedUrl.href);
  apiUrl.searchParams.set('strategy', strategy);
  ['performance', 'accessibility', 'seo', 'best-practices'].forEach(c =>
    apiUrl.searchParams.append('category', c)
  );

  // Add server-side API key if configured
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;
  if (apiKey) apiUrl.searchParams.set('key', apiKey);

  try {
    const upstream = await fetch(apiUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(90_000),
    });

    const data = await upstream.json();

    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[pagespeed] upstream error:', err.message);
    return res.status(502).json({ error: 'PageSpeed API request failed', detail: err.message });
  }
}
