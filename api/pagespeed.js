/**
 * Google PageSpeed Insights proxy — Vercel serverless function.
 * Credentials never leave the server; key is read from GOOGLE_PAGESPEED_API_KEY env var.
 */

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { fetchPageSpeed } = require('./_lib/pagespeed-client.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;



module.exports = withFailureReporting('api/pagespeed', async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Google's PageSpeed quota is attached to this deployment's key and is
  // shared by every customer on it. An open proxy lets a stranger exhaust it
  // and take the site audits down for everyone paying for them.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'pagespeed', max: 10, windowMs: 60 * 1000, auth })) return;

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

  // Add server-side API key if configured
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;

  try {
    const { status, data } = await fetchPageSpeed(parsedUrl.href, strategy, apiKey);

    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(status).json(data);
  } catch (err) {
    console.error('[pagespeed] upstream error:', err.message);
    return res.status(502).json({ error: 'PageSpeed API request failed', detail: err.message });
  }
});
