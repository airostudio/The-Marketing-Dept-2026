/**
 * api/seo-structure-competitors.js — SEO Pipeline Stage 2b: Competitor Content Research (structuring half)
 *
 * POST { searchText: string, citations: array }  (from seo-search-competitors.js)
 * Returns: { success, competitors: [...], citations }
 *
 * Does exactly ONE slow external call — Claude structuring the raw
 * Perplexity findings into a competitor/content-gap schema — never invents
 * a business or topic beyond what's in searchText/citations.
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
  name: 'submit_seo_competitor_research',
  description: 'Submit the structured competitor content research, using only what was actually reported with a source.',
  input_schema: {
    type: 'object',
    properties: {
      competitors: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            url: { type: 'string' },
            content_focus: { type: 'string', description: 'One sentence: what topics/content this competitor focuses on' },
            notable_gaps: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Topics a customer would search for that this competitor does NOT cover well' },
            source_urls: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          },
          required: ['name', 'url', 'content_focus', 'source_urls'],
        },
      },
      cross_competitor_gaps: {
        type: 'array', maxItems: 8, items: { type: 'string' },
        description: 'Topics that appear to be under-covered across MULTIPLE competitors — the highest-opportunity content targets',
      },
    },
    required: ['competitors', 'cross_competitor_gaps'],
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
    return res.status(400).json({ error: 'searchText (from seo-search-competitors) is required' });
  }

  const system = `You structure market/content research findings into a clean schema. Use ONLY businesses, URLs and topics explicitly present in the research text below — every competitor's source_urls must be pulled from the citation list provided, never invented. If fewer than 5 real competitors were found, return only what's real; do not pad the list.`;
  const user = `Research findings:\n${searchText}\n\nCitations available: ${JSON.stringify(citations)}\n\nStructure this into the competitor content research schema.`;

  try {
    const result = await callClaudeForJSON({ system, user, tool: COMPETITORS_TOOL, maxTokens: 3500, timeoutMs: 45000 });
    if (!result.success) return res.status(502).json({ success: false, error: result.error });

    return res.json({
      success: true,
      competitors: result.data.competitors || [],
      cross_competitor_gaps: result.data.cross_competitor_gaps || [],
      citations,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Structuring competitor research failed unexpectedly.' });
  }
};
