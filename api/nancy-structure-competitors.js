/**
 * api/nancy-structure-competitors.js — Nancy Agent 3: Competitor Researcher (structuring half)
 *
 * POST { searchText: string, citations: array }  (from nancy-search-competitors.js)
 * Returns: { success, category, competitors: [...], citations }
 *
 * Does exactly ONE slow external call — Claude structuring the raw
 * Perplexity findings into the competitor schema — never invents a
 * business or URL beyond what's in searchText/citations. Split from
 * nancy-search-competitors.js so no single Vercel function ever chains two
 * slow calls sharing one 60s ceiling; the client runs these two endpoints
 * back to back instead.
 */

'use strict';

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

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

  const { searchText, citations = [] } = req.body || {};
  if (!searchText || !String(searchText).trim()) {
    return res.status(400).json({ error: 'searchText (from nancy-search-competitors) is required' });
  }

  const system = `You structure market research findings into a clean schema. Use ONLY businesses and facts explicitly present in the research text below — every competitor's source_urls must be pulled from the citation list provided, never invented. If fewer than 5 real businesses were found, return only what's real; do not pad the list.`;
  const user = `Research findings:\n${searchText}\n\nCitations available: ${JSON.stringify(citations)}\n\nStructure this into the competitor research schema.`;

  try {
    const result = await callClaudeForJSON({ system, user, tool: COMPETITORS_TOOL, maxTokens: 2000, timeoutMs: 45000 });
    if (!result.success) return res.status(502).json({ success: false, error: result.error });

    return res.json({
      success: true,
      category: result.data.category,
      competitors: result.data.competitors || [],
      citations,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Structuring competitor research failed unexpectedly.' });
  }
};
