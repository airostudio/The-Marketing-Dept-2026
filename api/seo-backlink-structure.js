/**
 * api/seo-backlink-structure.js — SEO Pipeline Stage 5c: Backlink Prospect Search (structuring half)
 *
 * POST { searchText: string, citations: array }  (from seo-backlink-search.js)
 * Returns: { success, prospects: [{ domain, page_url, relevance_reason, data_source: 'estimate' }] }
 *
 * Does exactly ONE slow external call — Claude structuring the raw
 * Perplexity findings — never invents a domain beyond what's in
 * searchText/citations.
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

const PROSPECTS_TOOL = {
  name: 'submit_backlink_prospects',
  description: 'Submit real, named sites found via live search that could plausibly link to this business.',
  input_schema: {
    type: 'object',
    properties: {
      prospects: {
        type: 'array', maxItems: 12,
        items: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            page_url: { type: 'string', description: 'The specific real page found, if any' },
            relevance_reason: { type: 'string', description: 'Why this site is a real, plausible link target — what they publish, why this business fits' },
            source_urls: { type: 'array', items: { type: 'string' }, maxItems: 2 },
          },
          required: ['domain', 'relevance_reason', 'source_urls'],
        },
      },
    },
    required: ['prospects'],
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
    return res.status(400).json({ error: 'searchText (from seo-backlink-search) is required' });
  }

  const system = `You structure link-prospecting research into a clean schema. Use ONLY domains explicitly present in the research text — source_urls must be pulled from the citation list, never invented.`;
  const user = `Research findings:\n${searchText}\n\nCitations available: ${JSON.stringify(citations)}\n\nStructure this into the backlink prospects schema.`;

  const result = await callClaudeForJSON({ system, user, tool: PROSPECTS_TOOL, maxTokens: 2500, timeoutMs: 45000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  const prospects = (result.data.prospects || []).map(p => ({ ...p, data_source: 'estimate' }));
  return res.json({ success: true, prospects });
};
