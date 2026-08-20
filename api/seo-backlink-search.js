/**
 * api/seo-backlink-search.js — SEO Pipeline Stage 5b: Backlink Prospect Search (search half)
 *
 * POST { domain, profile }
 * Returns: { success, available, reason?, text?, citations? }
 *
 * Does exactly ONE slow external call — Perplexity live search for real,
 * named, currently-active sites relevant to this niche — used when
 * seo-backlink-prospects.js's real DataForSEO path finds nothing (not
 * configured, or no competitor referring-domain data). Split from the
 * structuring step (seo-backlink-structure.js) for the same reason as
 * every other search/structure split in this pipeline: no Vercel function
 * should ever chain two slow external calls sharing the 60s ceiling.
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

  const { domain, profile } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const query = `I run a business: ${profile?.business_summary || domain}. Industry: ${profile?.industry || 'not specified'}.

Find 8-12 REAL websites/blogs/publications that write about topics relevant to this industry and would plausibly link to a genuinely useful resource from a business like this — resource pages, "best tools" roundups, industry blogs that accept guest contributions, relevant directories. For each, report the real domain, the specific page if you found one, and why it's a real, verifiable, currently-active site (not defunct). Cite your sources. Never invent a domain.`;

  const search = await searchProvider(query, {
    systemPrompt: 'You are a link-building researcher. Search the live web and report only real, currently-active, verifiable websites with real source URLs. Never invent a domain.',
    maxTokens: 1800,
  });

  if (!search.available) {
    return res.json({ success: true, available: false, reason: search.reason, text: null, citations: [] });
  }

  return res.json({ success: true, available: true, text: search.text, citations: search.citations });
};
