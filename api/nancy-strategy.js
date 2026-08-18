/**
 * api/nancy-strategy.js — Nancy Agent 4: Strategist
 *
 * POST { businessProfile, brand, competitors }
 * Returns: {
 *   success, strategy: {
 *     what_everyone_says, what_customers_care_about, where_opportunity_is,
 *     content_opportunities: [{territory, rationale}]
 *   }
 * }
 *
 * Pure synthesis over data already gathered by prior agents — takes no
 * external calls itself, just combines brand + market research into the
 * "Why We Created This" strategic read the results page shows the user.
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

const STRATEGY_TOOL = {
  name: 'submit_strategy',
  description: 'Submit the strategic market read used to justify this week\'s content plan.',
  input_schema: {
    type: 'object',
    properties: {
      what_everyone_says: { type: 'array', items: { type: 'string' }, description: 'Repeated messages/claims/themes common across the researched businesses' },
      what_customers_care_about: { type: 'array', items: { type: 'string' }, description: 'Problems, fears, questions, objections, aspirations that appear important' },
      where_opportunity_is: { type: 'string', description: '2-4 sentences: what this specific brand could say that would make it more distinctive' },
      content_opportunities: {
        type: 'array',
        minItems: 5,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            territory: { type: 'string', description: 'e.g. Education, Myth busting, Founder POV, Behind the scenes, Comparison, FAQ, Data/infographic' },
            rationale: { type: 'string', description: 'Why this territory fits, grounded in the research above' },
          },
          required: ['territory', 'rationale'],
        },
      },
    },
    required: ['what_everyone_says', 'what_customers_care_about', 'where_opportunity_is', 'content_opportunities'],
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

  const { businessProfile, brand, competitors = [] } = req.body || {};
  if (!businessProfile) return res.status(400).json({ error: 'businessProfile is required' });

  const system = `You are a marketing strategist. Synthesize the business profile, brand identity, and competitor research into a sharp, specific strategic read. Ground every claim in the data provided — do not generate generic social-media advice untethered from this specific business and market. If competitor data is thin or unavailable, base the strategy on the business profile alone and say so implicitly by keeping what_everyone_says short rather than padding it.`;

  const user = `BUSINESS PROFILE:\n${JSON.stringify(businessProfile, null, 2)}\n\nBRAND IDENTITY:\n${JSON.stringify(brand || {}, null, 2)}\n\nCOMPETITOR RESEARCH (${competitors.length} businesses found):\n${JSON.stringify(competitors, null, 2)}\n\nProduce the strategic analysis and 5-10 content opportunities.`;

  const result = await callClaudeForJSON({ system, user, tool: STRATEGY_TOOL, maxTokens: 2500 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({ success: true, strategy: result.data });
};
