/**
 * api/seo-keyword-volumes.js — SEO Pipeline Stage 3b: Real Volume Upgrade
 *
 * POST { keywords: string[] }
 * Returns: { success, volumes: { [keywordLowercase]: { search_volume, difficulty } } }
 *
 * Does exactly ONE external call — DataForSEO's real Google Ads search-
 * volume data — split out of seo-keyword-research.js so no single Vercel
 * function ever chains two slow external calls sharing the 60s ceiling
 * (that chaining is what caused the timeout this split fixes). Returns an
 * empty object when DATAFORSEO_LOGIN/PASSWORD aren't configured, or when a
 * specific keyword has no data — callers must keep those topics labeled as
 * estimates, never silently upgrade a keyword this endpoint didn't confirm.
 */

'use strict';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) { b = { windowStart: now, count: 0 }; rateBuckets.set(ip, b); }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { keywords = [] } = req.body || {};
  if (!Array.isArray(keywords) || !keywords.length) return res.status(400).json({ error: 'keywords array is required' });

  const login = process.env.DATAFORSEO_LOGIN;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) {
    return res.json({ success: true, volumes: {}, configured: false });
  }

  try {
    const auth = Buffer.from(`${login}:${pass}`).toString('base64');
    const dfsRes = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ keywords: keywords.slice(0, 20), location_code: 2840, language_code: 'en' }]),
      signal: AbortSignal.timeout(45000),
    });
    if (!dfsRes.ok) return res.json({ success: true, volumes: {}, configured: true, error: `DataForSEO error ${dfsRes.status}` });

    const data = await dfsRes.json();
    const items = data.tasks?.[0]?.result || [];
    const volumes = {};
    for (const item of items) {
      if (item.keyword && typeof item.search_volume === 'number') {
        volumes[item.keyword.toLowerCase()] = {
          search_volume: item.search_volume,
          difficulty: typeof item.competition_index === 'number' ? Math.round(item.competition_index) : null,
        };
      }
    }
    return res.json({ success: true, volumes, configured: true });
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.warn('[seo-keyword-volumes] DataForSEO lookup failed, callers should stay with estimates:', err.message);
    return res.json({ success: true, volumes: {}, configured: true, error: isTimeout ? 'DataForSEO request timed out' : err.message });
  }
};
