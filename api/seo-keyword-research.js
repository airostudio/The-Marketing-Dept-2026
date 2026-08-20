/**
 * api/seo-keyword-research.js — SEO Pipeline Stage 3a: Topic Proposal
 *
 * POST { profile, competitors, cross_competitor_gaps }
 * Returns: { success, topics: [{ topic, target_keyword, est_search_volume,
 *   est_difficulty, data_source: 'estimate', rationale, content_pillar }] }
 *
 * Does exactly ONE slow external call — Claude proposing topic candidates
 * grounded in the real business profile + real competitor content gaps.
 * The real-data upgrade pass (DataForSEO search volume) used to run in this
 * same function right after this call — chaining Claude's (up to 45s) call
 * with DataForSEO's (up to 15s) in one function shares Vercel's 60s ceiling
 * and can time out, exactly the class of bug already fixed repeatedly in
 * Nancy's pipeline. Split into its own function (seo-keyword-volumes.js)
 * for the same reason as every other two-slow-call split in this app.
 */

'use strict';

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

const TOPICS_TOOL = {
  name: 'submit_seo_topics',
  description: 'Submit candidate SEO content topics grounded in the real business profile and real competitor content gaps provided.',
  input_schema: {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        minItems: 8,
        // Was 20 — with a rationale sentence per topic that's genuinely a
        // lot of output tokens, and generation time scales with it. Vercel
        // kills this function at 60s regardless of the internal timeout
        // below, so the real fix for a timeout is less output, not just a
        // bigger number here. 12 topics is still a solid batch and finishes
        // comfortably inside the ceiling.
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The article topic, human-readable' },
            target_keyword: { type: 'string', description: 'The primary search phrase this topic targets' },
            est_search_volume: { type: 'string', description: 'Rough monthly-search-volume bucket: "low (under 100)", "medium (100-1000)", "high (1000+)" — a directional estimate, not a real number' },
            est_difficulty: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Estimated how hard this would be to rank for, given typical competition for this kind of term' },
            rationale: { type: 'string', description: 'Why this topic, in one short sentence (~15 words) — grounded in a specific product/service, a real competitor content gap, or a real ICP pain point' },
            content_pillar: { type: 'string', description: 'Short category label to group related topics, e.g. "Getting Started", "Comparisons", "Use Cases"' },
          },
          required: ['topic', 'target_keyword', 'est_search_volume', 'est_difficulty', 'rationale', 'content_pillar'],
        },
      },
    },
    required: ['topics'],
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

  const { profile, competitors = [], cross_competitor_gaps = [] } = req.body || {};
  if (!profile || !profile.business_summary) return res.status(400).json({ error: 'profile (from seo-analyze-site) is required' });

  const system = `You are an SEO content strategist proposing article topics. Ground every topic in the REAL business profile, products/services, and competitor content gaps provided — never propose a topic unrelated to what this business actually offers. Avoid duplicating any topic already in existing_topics. Search volume and difficulty are directional buckets, not real numbers — you have no live keyword database.`;

  const user = `BUSINESS PROFILE:\n${JSON.stringify(profile, null, 2)}\n\nCOMPETITOR CONTENT (${competitors.length} competitors researched):\n${JSON.stringify(competitors, null, 2)}\n\nCROSS-COMPETITOR CONTENT GAPS:\n${JSON.stringify(cross_competitor_gaps, null, 2)}\n\nPropose 8-12 SEO article topics that would genuinely help this specific business, prioritizing real content gaps and real product/service coverage over generic industry topics.`;

  // timeoutMs pushed close to Vercel's own 60s maxDuration for this
  // function (vercel.json) — this is the platform's hard ceiling, not a
  // number this file controls, so timeoutMs can't usefully exceed it by
  // much; the maxItems cut above is what actually keeps real-world
  // generation time well under it rather than just barely inside it.
  const result = await callClaudeForJSON({ system, user, tool: TOPICS_TOOL, maxTokens: 3000, timeoutMs: 55000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  const topics = (result.data.topics || []).map(t => ({
    topic: t.topic, target_keyword: t.target_keyword,
    search_volume: null, difficulty: null,
    est_search_volume: t.est_search_volume, est_difficulty: t.est_difficulty,
    data_source: 'estimate', rationale: t.rationale, content_pillar: t.content_pillar,
  }));

  return res.json({ success: true, topics });
};
