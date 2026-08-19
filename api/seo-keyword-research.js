/**
 * api/seo-keyword-research.js — SEO Pipeline Stage 3: Topic & Keyword Research
 *
 * POST { profile, competitors, cross_competitor_gaps }
 * Returns: { success, topics: [{ topic, target_keyword, search_volume,
 *   difficulty, data_source: 'real'|'estimate', rationale, content_pillar }] }
 *
 * Two-stage, honest-by-construction:
 *  1. Claude proposes topic/keyword candidates grounded in the real business
 *     profile + real competitor content gaps (never invents products/topics
 *     unrelated to what was actually found).
 *  2. If DATAFORSEO_LOGIN/PASSWORD are configured, each candidate keyword is
 *     looked up against DataForSEO's real Google Ads search-volume data and
 *     upgraded to data_source:'real' with real numbers. Any keyword that
 *     can't be verified (API not configured, or this specific term has no
 *     data) STAYS labeled 'estimate' — never silently presented as real.
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
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The article topic, human-readable' },
            target_keyword: { type: 'string', description: 'The primary search phrase this topic targets' },
            est_search_volume: { type: 'string', description: 'Rough monthly-search-volume bucket: "low (under 100)", "medium (100-1000)", "high (1000+)" — a directional estimate, not a real number' },
            est_difficulty: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Estimated how hard this would be to rank for, given typical competition for this kind of term' },
            rationale: { type: 'string', description: 'Why this topic — grounded in a specific product/service, a real competitor content gap, or a real ICP pain point' },
            content_pillar: { type: 'string', description: 'Short category label to group related topics, e.g. "Getting Started", "Comparisons", "Use Cases"' },
          },
          required: ['topic', 'target_keyword', 'est_search_volume', 'est_difficulty', 'rationale', 'content_pillar'],
        },
      },
    },
    required: ['topics'],
  },
};

async function lookupRealVolumes(keywords) {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass || !keywords.length) return {};

  try {
    const auth = Buffer.from(`${login}:${pass}`).toString('base64');
    const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ keywords: keywords.slice(0, 20), location_code: 2840, language_code: 'en' }]),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const items = data.tasks?.[0]?.result || [];
    const byKeyword = {};
    for (const item of items) {
      if (item.keyword && typeof item.search_volume === 'number') {
        byKeyword[item.keyword.toLowerCase()] = {
          search_volume: item.search_volume,
          difficulty: typeof item.competition_index === 'number' ? Math.round(item.competition_index) : null,
        };
      }
    }
    return byKeyword;
  } catch (err) {
    console.warn('[seo-keyword-research] DataForSEO lookup failed, staying with estimates:', err.message);
    return {};
  }
}

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

  const user = `BUSINESS PROFILE:\n${JSON.stringify(profile, null, 2)}\n\nCOMPETITOR CONTENT (${competitors.length} competitors researched):\n${JSON.stringify(competitors, null, 2)}\n\nCROSS-COMPETITOR CONTENT GAPS:\n${JSON.stringify(cross_competitor_gaps, null, 2)}\n\nPropose 8-20 SEO article topics that would genuinely help this specific business, prioritizing real content gaps and real product/service coverage over generic industry topics.`;

  const result = await callClaudeForJSON({ system, user, tool: TOPICS_TOOL, maxTokens: 4000, timeoutMs: 45000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  const candidateTopics = result.data.topics || [];
  const realVolumes = await lookupRealVolumes(candidateTopics.map(t => t.target_keyword));

  const topics = candidateTopics.map(t => {
    const real = realVolumes[(t.target_keyword || '').toLowerCase()];
    if (real) {
      return {
        topic: t.topic, target_keyword: t.target_keyword,
        search_volume: real.search_volume, difficulty: real.difficulty,
        data_source: 'real', rationale: t.rationale, content_pillar: t.content_pillar,
      };
    }
    return {
      topic: t.topic, target_keyword: t.target_keyword,
      search_volume: null, difficulty: null,
      est_search_volume: t.est_search_volume, est_difficulty: t.est_difficulty,
      data_source: 'estimate', rationale: t.rationale, content_pillar: t.content_pillar,
    };
  });

  return res.json({
    success: true,
    topics,
    realDataAvailable: Object.keys(realVolumes).length > 0,
  });
};
