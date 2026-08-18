/**
 * api/nancy-search-competitors.js — Nancy Agent 2: Research Planner (search half)
 *
 * POST { businessProfile: {...from nancy-analyze-website...} }
 * Returns: { success, available, reason?, text?, citations? }
 *
 * Does exactly ONE slow external call — Perplexity Sonar live web search —
 * and nothing else. Split out from what used to be nancy-research-market.js
 * specifically so no Vercel function ever chains two slow calls back to
 * back: this function's only job is search, api/nancy-structure-competitors.js's
 * only job is structuring what this one found. Each gets a generous,
 * comfortably-under-60s timeout of its own instead of splitting one budget
 * two ways and hoping the sum stays under the platform ceiling.
 */

'use strict';

const { searchProvider } = require('./_lib/nancy-providers.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
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

  const { businessProfile } = req.body || {};
  if (!businessProfile || !businessProfile.business_category) {
    return res.status(400).json({ error: 'businessProfile (from website analysis) is required' });
  }

  const query = `I run a business in the "${businessProfile.business_category}" / "${businessProfile.industry || ''}" space. Business summary: ${businessProfile.website_summary || businessProfile.primary_offer}. Target customer: ${businessProfile.target_customer || 'not specified'}. Location: ${businessProfile.location || 'not specified, treat as not location-critical'}.

Find 5-10 REAL businesses operating in a similar or closely related market — similar offer, similar target customer, or similar category. They do not need to be direct local competitors unless location is clearly central to this business. For each one report: business name, website URL, how they position themselves, who they target, their main offer, what topics they publish content about, their tone of voice, and anything distinctive about their approach. Only include businesses you can find real, current evidence for — cite your sources. Do not invent any business or URL.`;

  try {
    const search = await searchProvider(query, {
      systemPrompt: 'You are a market research analyst. Search the live web and report only real, verifiable businesses with real source URLs. Never invent a company, website, or fact.',
      maxTokens: 1800,
    });

    if (!search.available) {
      return res.json({ success: true, available: false, reason: search.reason, text: null, citations: [] });
    }

    return res.json({ success: true, available: true, text: search.text, citations: search.citations });
  } catch (err) {
    // Defense-in-depth — searchProvider itself never throws (see its own
    // try/catch), but a crash here should still come back as JSON, not a
    // platform-level error page.
    return res.status(500).json({ success: false, error: err.message || 'Competitor search failed unexpectedly.' });
  }
};
