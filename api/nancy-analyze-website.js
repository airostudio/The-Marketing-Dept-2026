/**
 * api/nancy-analyze-website.js — Nancy Agent 1: Website Analyst
 *
 * POST { url: string }
 * Returns: { success, profile, pagesFetched: [{url,title}], error? }
 *
 * Crawls a bounded set of real pages (see api/_lib/nancy-crawl.js), then asks
 * Claude to extract the structured business profile in the spec's schema
 * from that ACTUAL page text — never from metadata guesses.
 */

'use strict';

const { crawlSite } = require('./_lib/nancy-crawl.js');
const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

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

const PROFILE_TOOL = {
  name: 'submit_business_profile',
  description: 'Submit the structured business profile extracted from the crawled website content.',
  input_schema: {
    type: 'object',
    properties: {
      business_name: { type: 'string' },
      business_category: { type: 'string' },
      industry: { type: 'string' },
      location: { type: 'string', description: 'City/region if determinable, else empty string' },
      products_services: { type: 'array', items: { type: 'string' } },
      primary_offer: { type: 'string' },
      secondary_offers: { type: 'array', items: { type: 'string' } },
      target_customer: { type: 'string' },
      customer_problems: { type: 'array', items: { type: 'string' } },
      desired_customer_outcomes: { type: 'array', items: { type: 'string' } },
      unique_value_proposition: { type: 'string' },
      proof_points: { type: 'array', items: { type: 'string' }, description: 'Real testimonials, stats, credentials, case studies found on the site — never invented' },
      brand_voice: { type: 'array', items: { type: 'string' }, description: '3-5 adjectives describing how the site actually reads' },
      common_phrases: { type: 'array', items: { type: 'string' }, description: 'Distinctive phrases/language actually used on the site' },
      founder_or_team: { type: 'array', items: { type: 'string' } },
      calls_to_action: { type: 'array', items: { type: 'string' } },
      important_topics: { type: 'array', items: { type: 'string' } },
      website_summary: { type: 'string', description: '2-4 sentence plain-English summary of what this business actually does' },
    },
    required: [
      'business_name', 'business_category', 'industry', 'products_services', 'primary_offer',
      'target_customer', 'customer_problems', 'unique_value_proposition', 'brand_voice',
      'website_summary',
    ],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  let crawl;
  try {
    crawl = await crawlSite(url);
  } catch (err) {
    return res.status(422).json({ success: false, error: err.message });
  }

  const pagesText = crawl.pages
    .map(p => `--- PAGE: ${p.title} (${p.url}) ---\n${p.text}`)
    .join('\n\n');

  const system = `You are a business analyst who extracts structured facts from real website content. Base every field ONLY on what is actually present in the provided page text. If something genuinely cannot be determined, use an empty string or empty array — never invent a plausible-sounding fact. proof_points must be things actually stated on the site (real testimonials, real numbers, real credentials) — if none exist, return an empty array rather than fabricating one.`;

  const user = `Website: ${crawl.origin}\n\nCrawled page content:\n\n${pagesText}\n\nExtract the structured business profile.`;

  // Crawl + Claude extraction share this one function's 60s ceiling
  // (vercel.json) — the crawl is now parallelized (see nancy-crawl.js) so it
  // costs about as much as its single slowest page, leaving this call real
  // room without either step racing the platform limit.
  const result = await callClaudeForJSON({ system, user, tool: PROFILE_TOOL, maxTokens: 3000, timeoutMs: 40000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({
    success: true,
    profile: result.data,
    pagesFetched: crawl.pages.map(p => ({ url: p.url, title: p.title })),
    homepageHtml: crawl.homepageHtml, // unused by the client — nancy-screenshot.js re-crawls independently; kept here for parity/debugging
  });
};
