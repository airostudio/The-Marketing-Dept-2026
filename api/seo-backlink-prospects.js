/**
 * api/seo-backlink-prospects.js — SEO Pipeline Stage 5a: Real Backlink-Gap Prospecting
 *
 * POST { domain: string, competitors: [{name,url}] }
 * Returns: { success, prospects: [...], dataSource: 'dataforseo'|'none', needsSearch: boolean }
 *
 * Real path only: looks up each competitor's real referring domains via
 * DataForSEO — sites that already link to a competitor are the highest-
 * quality, most plausible prospects, since they've already shown
 * willingness to link to something in this exact niche. All lookups run in
 * parallel (Promise.all), so this stays fast and real regardless of how
 * many competitors are checked.
 *
 * When DataForSEO isn't configured or finds nothing, this returns
 * needsSearch:true rather than falling through to a Perplexity+Claude
 * fallback in the same function — that fallback used to live here and
 * chained THREE slow external calls (DataForSEO -> Perplexity -> Claude)
 * in one function, up to ~105s worst case against Vercel's 60s ceiling.
 * The fallback now lives in its own two functions (seo-backlink-search.js
 * + seo-backlink-structure.js), called separately by the client — same
 * split-per-slow-call discipline as everywhere else in this pipeline.
 */

'use strict';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6;
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

function cleanDomain(raw) {
  return String(raw || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
}

async function fetchReferringDomains(targetDomain) {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;

  try {
    const auth = Buffer.from(`${login}:${pass}`).toString('base64');
    const res = await fetch('https://api.dataforseo.com/v3/backlinks/referring_domains/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ target: targetDomain, limit: 15, order_by: ['rank,desc'] }]),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return items.map(i => ({ domain: i.domain, rank: i.rank || null })).filter(i => i.domain);
  } catch (err) {
    console.warn('[seo-backlink-prospects] DataForSEO referring-domains lookup failed:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { domain, competitors = [] } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const ownDomain = cleanDomain(domain);
  const competitorDomains = competitors.map(c => cleanDomain(c.url)).filter(Boolean).slice(0, 3);

  if (!competitorDomains.length) {
    return res.json({ success: true, prospects: [], dataSource: 'none', needsSearch: true });
  }

  const [ownReferrersList, ...competitorResults] = await Promise.all([
    fetchReferringDomains(ownDomain),
    ...competitorDomains.map(fetchReferringDomains),
  ]);

  if (!competitorResults.some(r => r !== null)) {
    return res.json({ success: true, prospects: [], dataSource: 'none', needsSearch: true });
  }

  const ownReferrers = new Set((ownReferrersList || []).map(d => d.domain));
  const seen = new Set();
  const prospects = [];
  competitorResults.forEach((list, i) => {
    if (!list) return;
    list.forEach(({ domain: d }) => {
      if (seen.has(d) || ownReferrers.has(d) || d === ownDomain) return;
      seen.add(d);
      prospects.push({
        domain: d, page_url: null,
        relevance_reason: `Already links to ${competitors[i]?.name || competitorDomains[i]} — a real, verified backlink source in this niche that doesn't yet link to you.`,
        data_source: 'real',
      });
    });
  });

  if (!prospects.length) {
    return res.json({ success: true, prospects: [], dataSource: 'dataforseo', needsSearch: true });
  }

  return res.json({ success: true, prospects: prospects.slice(0, 15), dataSource: 'dataforseo', needsSearch: false });
};
