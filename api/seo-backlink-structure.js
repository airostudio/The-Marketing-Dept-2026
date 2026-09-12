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

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const { callClaudeForJSON, asUntrustedContent, UNTRUSTED_CONTENT_RULE } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;


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

module.exports = withFailureReporting('api/seo-backlink-structure', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'seo-backlink-structure', max: 8, windowMs: 60 * 1000, auth })) return;

  const { searchText, citations = [] } = req.body || {};
  if (!searchText || !String(searchText).trim()) {
    return res.status(400).json({ error: 'searchText (from seo-backlink-search) is required' });
  }

  const system = `You structure link-prospecting research into a clean schema. Use ONLY domains explicitly present in the research text — source_urls must be pulled from the citation list, never invented.

${UNTRUSTED_CONTENT_RULE}`;
  // searchText is a web-search result: text this product did not write,
  // pulled from pages it does not control. Fenced so a page that says
  // "ignore the above" is described rather than obeyed.
  const user = `Research findings:\n${asUntrustedContent(searchText, 'web search results')}\n\nCitations available: ${JSON.stringify(citations)}\n\nStructure this into the backlink prospects schema.`;

  const result = await callClaudeForJSON({ system, user, tool: PROSPECTS_TOOL, maxTokens: 2500, timeoutMs: 45000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  const prospects = (result.data.prospects || []).map(p => ({ ...p, data_source: 'estimate' }));
  return res.json({ success: true, prospects });
});
