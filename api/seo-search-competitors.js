/**
 * api/seo-search-competitors.js — SEO Pipeline Stage 2a: Competitor Content Research (search half)
 *
 * POST { profile: {...from seo-analyze-site...} }
 * Returns: { success, available, reason?, text?, citations? }
 *
 * Does exactly ONE slow external call — Perplexity Sonar live web search for
 * real competitors and what content/topics they actually publish on — split
 * from the structuring step (seo-structure-competitors.js) for the same
 * reason as Nancy's identical split: no Vercel function should ever chain
 * two slow external calls sharing one 60s ceiling.
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

  const { profile } = req.body || {};
  if (!profile || !profile.industry) {
    return res.status(400).json({ error: 'profile (from seo-analyze-site) is required' });
  }

  const query = `I run a business in the "${profile.industry}" space. Business summary: ${profile.business_summary || profile.primary_offer}. Target customer: ${profile.target_customer || 'not specified'}.

Find 5-8 REAL businesses/websites that compete for search traffic in this space — direct competitors or content-focused sites ranking for similar topics. For each one report: business/site name, website URL, what topics/keywords they appear to publish content about (blog categories, resource hubs, guide topics), their apparent content strategy, and any notable content gaps — topics a real customer would search for that they DON'T seem to cover well. Only include businesses/sites you can find real, current evidence for — cite your sources. Do not invent any business, URL, or topic.`;

  try {
    const search = await searchProvider(query, {
      systemPrompt: 'You are an SEO content strategist. Search the live web and report only real, verifiable businesses/sites and their real published content topics, with real source URLs. Never invent a company, URL, or topic.',
      maxTokens: 2000,
    });

    if (!search.available) {
      return res.json({ success: true, available: false, reason: search.reason, text: null, citations: [] });
    }

    return res.json({ success: true, available: true, text: search.text, citations: search.citations });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Competitor content research failed unexpectedly.' });
  }
};
