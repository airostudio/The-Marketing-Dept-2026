/**
 * api/ai-visibility-questions.js — AI Visibility Finder, Stage 1: question generation
 *
 * POST { businessSummary, productsServices, targetCustomer, industry, competitors? }
 * Returns: { success, questions: [{ question, category, why }] }
 *
 * The whole point of this tool is not making the user guess what to type in
 * — a real AI-visibility check depends entirely on asking the questions a
 * real buyer would actually put to ChatGPT/Perplexity/an AI Overview, not
 * "[brand name]" or generic industry terms nobody searches with an AI for.
 * This proposes a realistic, categorized battery grounded in the real
 * business profile given. Does exactly ONE slow external call (Claude) —
 * the actual citation checks happen client-side afterward, one Perplexity
 * search per question, so this endpoint never chains two slow calls.
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

const QUESTIONS_TOOL = {
  name: 'submit_ai_visibility_questions',
  description: 'Submit realistic questions a real buyer would actually ask an AI assistant (ChatGPT, Perplexity, Gemini) when researching this category — grounded in the real business profile given.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 8,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The exact question a real buyer would type/ask — natural language, how a person actually phrases it to an AI assistant, never a keyword fragment' },
            category: {
              type: 'string',
              enum: ['category', 'comparison', 'problem', 'brand'],
              description: '"category" = broad top-of-funnel research ("best X for Y"); "comparison" = X vs Y / alternatives-to; "problem" = a pain point this business solves, asked without naming any brand; "brand" = a question that names this business directly',
            },
            why: { type: 'string', description: 'One short sentence: why this specific question matters for this business — which real product/service or ICP pain point it maps to' },
          },
          required: ['question', 'category', 'why'],
        },
      },
    },
    required: ['questions'],
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

  const { businessSummary, productsServices, targetCustomer, industry, competitors = [] } = req.body || {};
  if (!businessSummary || !String(businessSummary).trim()) {
    return res.status(400).json({ error: 'businessSummary is required' });
  }

  const system = `You are an AI-visibility (GEO/AEO) strategist. Your job is proposing the realistic questions a real buyer would ask an AI assistant while researching this exact category — never generic filler, never a question unrelated to what this business actually offers. Mix genuine top-of-funnel research questions with sharper comparison/problem questions real prospects ask right before choosing a vendor. Write every question the way a person actually talks to ChatGPT/Perplexity — full sentences, natural phrasing — never a bare keyword.`;

  const user = `BUSINESS: ${businessSummary}
PRODUCTS/SERVICES: ${Array.isArray(productsServices) ? productsServices.join(', ') : (productsServices || 'not specified')}
TARGET CUSTOMER: ${targetCustomer || 'not specified'}
INDUSTRY: ${industry || 'not specified'}
KNOWN COMPETITORS: ${competitors.length ? competitors.join(', ') : 'none given'}

Propose 8-12 realistic AI-assistant questions covering a mix of:
- category questions (broad research, no brand named)
- comparison questions (this business vs a named competitor, or "alternatives to X")
- problem questions (a real pain point this business solves, brand-agnostic)
- brand questions (directly naming this business)

Ground every single one in the real business details above.`;

  const result = await callClaudeForJSON({ system, user, tool: QUESTIONS_TOOL, maxTokens: 2200, timeoutMs: 40000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({ success: true, questions: result.data.questions || [] });
};
