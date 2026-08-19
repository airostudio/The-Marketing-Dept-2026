/**
 * api/seo-analyze-site.js — SEO Pipeline Stage 1: Business & Site Analysis
 *
 * POST { url: string }
 * Returns: { success, profile: { business_summary, products_services,
 *   target_customer, existing_topics, primary_offer }, pagesFetched }
 *
 * Crawls the business's own site (same bounded, SSRF-safe crawler Nancy
 * uses — api/_lib/nancy-crawl.js is generic, not Nancy-specific) and asks
 * Claude to extract what the business actually sells and what topics it has
 * already published on, so the content plan generated later doesn't
 * duplicate existing coverage or invent products that don't exist.
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
  name: 'submit_seo_site_profile',
  description: 'Submit the structured SEO-relevant profile extracted from the crawled website content.',
  input_schema: {
    type: 'object',
    properties: {
      business_summary: { type: 'string', description: '2-3 sentence plain-English summary of what this business does' },
      products_services: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Real products/services actually found on the site' },
      primary_offer: { type: 'string' },
      target_customer: { type: 'string' },
      industry: { type: 'string' },
      existing_topics: { type: 'array', items: { type: 'string' }, maxItems: 15, description: 'Topics/subjects the site already has content on (from blog posts, resource pages, FAQs actually found) — so a new content plan avoids duplicating these' },
      tone_notes: { type: 'string', description: 'Brief note on how the site currently writes (formal/casual/technical) so new articles match' },
    },
    required: ['business_summary', 'products_services', 'target_customer', 'industry', 'existing_topics'],
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

  const system = `You are an SEO strategist extracting structured facts from real website content. Base every field ONLY on what is actually present in the provided page text — never invent a product, service, or topic that isn't genuinely there. existing_topics must be real subjects the site actually has content on (blog post titles, FAQ questions, resource pages) — if the site has no blog/resources, return an empty array rather than guessing.`;

  const user = `Website: ${crawl.origin}\n\nCrawled page content:\n\n${pagesText}\n\nExtract the SEO-relevant business profile.`;

  const result = await callClaudeForJSON({ system, user, tool: PROFILE_TOOL, maxTokens: 3000, timeoutMs: 40000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({
    success: true,
    profile: result.data,
    pagesFetched: crawl.pages.map(p => ({ url: p.url, title: p.title })),
  });
};
