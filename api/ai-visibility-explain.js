/**
 * api/ai-visibility-explain.js — AI Visibility Finder, Stage 3: synthesis
 *
 * POST { businessName, domain, results: [{ question, category, cited, domains }] }
 * Returns: { success, summary, recommendations: [string] }
 *
 * The citation checks themselves (one Perplexity search per question) run
 * entirely client-side before this is ever called — this endpoint never
 * touches Perplexity itself, it only reasons over the REAL results already
 * collected, so it can't invent a citation that didn't actually happen.
 * One Claude call, grounded strictly in the data given.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;


const EXPLAIN_TOOL = {
  name: 'submit_ai_visibility_analysis',
  description: 'Submit an analysis of why this business does or does not appear in AI-assistant answers, grounded strictly in the real citation results given — never invent a source not present in the data.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2-4 sentences: the honest headline finding — how visible this business actually is right now and the clearest pattern in who is winning citations instead' },
      recommendations: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: { type: 'string' },
        description: 'Specific, actionable next steps grounded in the real domains/patterns that showed up in the results — e.g. "X keeps appearing for comparison questions because they have a dedicated vs-page; publish an equivalent" — never generic advice like "improve your SEO"',
      },
    },
    required: ['summary', 'recommendations'],
  },
};

module.exports = async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'ai-visibility-explain', max: 8, windowMs: 60 * 1000, auth })) return;

  const { businessName, domain, results } = req.body || {};
  if (!Array.isArray(results) || !results.length) {
    return res.status(400).json({ error: 'results (from the client-side citation checks) is required' });
  }

  const citedCount = results.filter(r => r.cited).length;
  const domainCounts = {};
  results.forEach(r => (r.domains || []).forEach(d => { domainCounts[d] = (domainCounts[d] || 0) + 1; }));
  const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const system = `You are an AI-visibility (GEO/AEO) strategist reviewing REAL, already-collected citation-check results — every domain and cited/not-cited fact here actually happened in a live Perplexity search, none of it is estimated. Never invent a domain, a citation, or a result not present in the data given. Be specific and honest, including if visibility is genuinely poor.`;

  const user = `BUSINESS: ${businessName || 'this business'}${domain ? ` (${domain})` : ''}
Cited in ${citedCount} of ${results.length} questions checked.

PER-QUESTION RESULTS:
${results.map(r => `- [${r.category}] "${r.question}" — ${r.cited ? 'CITED' : 'not cited'}. Domains that were cited: ${(r.domains || []).join(', ') || 'none'}`).join('\n')}

DOMAINS THAT KEEP APPEARING ACROSS QUESTIONS (most-cited first):
${topDomains.length ? topDomains.map(([d, c]) => `- ${d} (${c}x)`).join('\n') : '(none repeated more than once)'}

Analyze this real data — what's the honest visibility picture, and what should this business actually do about it?`;

  const result = await callClaudeForJSON({ system, user, tool: EXPLAIN_TOOL, maxTokens: 1500, timeoutMs: 35000 });
  if (!result.success) return res.status(502).json({ success: false, error: result.error });

  return res.json({
    success: true,
    summary: result.data.summary,
    recommendations: result.data.recommendations || [],
    topDomains: topDomains.map(([domain, count]) => ({ domain, count })),
  });
};
