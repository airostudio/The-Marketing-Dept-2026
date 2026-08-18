/**
 * api/nancy-research-market.js — Nancy Agents 2+3: Research Planner + Competitor Researcher
 *
 * POST { businessProfile: {...from nancy-analyze-website...} }
 * Returns: {
 *   success, competitors: [{business_name, website, positioning, ..., source_urls}],
 *   citations: [{url,title}],   // raw source list, for the Research Sources UI
 *   available, reason?          // false if PERPLEXITY_API_KEY isn't set — never fabricated
 * }
 *
 * Uses Perplexity Sonar (searchProvider adapter) for live web search WITH
 * citations, then asks Claude to structure the findings into the
 * spec's competitor schema — Claude never invents companies here, it only
 * reorganizes what Perplexity actually found and cited.
 */

'use strict';

const { searchProvider } = require('./_lib/nancy-providers.js');
const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

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

const COMPETITORS_TOOL = {
  name: 'submit_competitor_research',
  description: 'Submit the structured list of real businesses found operating in this market, using only what was actually reported with a source.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'The market/category this business competes in' },
      competitors: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            business_name: { type: 'string' },
            website: { type: 'string' },
            positioning: { type: 'string' },
            target_customer: { type: 'string' },
            main_offer: { type: 'string' },
            content_topics: { type: 'array', items: { type: 'string' } },
            tone: { type: 'string' },
            differentiators: { type: 'array', items: { type: 'string' } },
            notable_patterns: { type: 'array', items: { type: 'string' } },
            source_urls: { type: 'array', items: { type: 'string' }, description: 'Must be real URLs from the research text — never invented' },
          },
          required: ['business_name', 'website', 'positioning', 'source_urls'],
        },
      },
    },
    required: ['category', 'competitors'],
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

  const { businessProfile } = req.body || {};
  if (!businessProfile || !businessProfile.business_category) {
    return res.status(400).json({ error: 'businessProfile (from website analysis) is required' });
  }

  const query = `I run a business in the "${businessProfile.business_category}" / "${businessProfile.industry || ''}" space. Business summary: ${businessProfile.website_summary || businessProfile.primary_offer}. Target customer: ${businessProfile.target_customer || 'not specified'}. Location: ${businessProfile.location || 'not specified, treat as not location-critical'}.

Find 5-10 REAL businesses operating in a similar or closely related market — similar offer, similar target customer, or similar category. They do not need to be direct local competitors unless location is clearly central to this business. For each one report: business name, website URL, how they position themselves, who they target, their main offer, what topics they publish content about, their tone of voice, and anything distinctive about their approach. Only include businesses you can find real, current evidence for — cite your sources. Do not invent any business or URL.`;

  try {
    // This handler chains two sequential network calls (Perplexity search,
    // then Claude structuring) inside one Vercel function invocation, which
    // shares a single 60s function ceiling (vercel.json) — not the sum of
    // each call's own timeout. searchProvider budgets ~25s; this call gets
    // ~25s too, leaving headroom for request/response overhead so the pair
    // reliably finishes under the platform limit instead of racing it.
    const search = await searchProvider(query, {
      systemPrompt: 'You are a market research analyst. Search the live web and report only real, verifiable businesses with real source URLs. Never invent a company, website, or fact.',
      maxTokens: 1500,
    });

    if (!search.available) {
      return res.json({ success: true, available: false, reason: search.reason, competitors: [], citations: [] });
    }

    const system = `You structure market research findings into a clean schema. Use ONLY businesses and facts explicitly present in the research text below — every competitor's source_urls must be pulled from the citation list provided, never invented. If fewer than 5 real businesses were found, return only what's real; do not pad the list.`;
    const user = `Research findings:\n${search.text}\n\nCitations available: ${JSON.stringify(search.citations)}\n\nStructure this into the competitor research schema.`;

    const result = await callClaudeForJSON({ system, user, tool: COMPETITORS_TOOL, maxTokens: 2000, timeoutMs: 25000 });
    if (!result.success) return res.status(502).json({ success: false, error: result.error });

    return res.json({
      success: true,
      available: true,
      category: result.data.category,
      competitors: result.data.competitors || [],
      citations: search.citations,
    });
  } catch (err) {
    // Defense-in-depth: no path above should throw (searchProvider and
    // callClaudeForJSON both return {available/success: false, ...} instead
    // of throwing), but an uncaught exception here would otherwise crash
    // the function with a non-JSON response — exactly the "Request to
    // /api/nancy-research-market failed" generic client-side message this
    // guarantees a real error instead of.
    return res.status(500).json({ success: false, error: err.message || 'Market research failed unexpectedly.' });
  }
};
