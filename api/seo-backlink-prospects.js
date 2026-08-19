/**
 * api/seo-backlink-prospects.js — SEO Pipeline Stage 5a: Backlink Prospecting
 *
 * POST { domain: string, competitors: [{name,url}], profile }
 * Returns: { success, prospects: [{ domain, page_url, relevance_reason,
 *   data_source: 'real'|'estimate' }], dataSource: 'dataforseo'|'perplexity' }
 *
 * Real path (DATAFORSEO_LOGIN/PASSWORD configured): looks up each
 * competitor's real referring domains — sites that already link to a
 * competitor are the highest-quality, most plausible prospects, since
 * they've already shown willingness to link to something in this exact
 * niche. This is a genuine backlink-gap analysis, not a guess.
 *
 * Fallback path (no DataForSEO): Perplexity live search for real sites that
 * publish/link to resources in this niche — honestly labeled data_source:
 * 'estimate' (found via search, not verified as an existing real backlink
 * opportunity the way the DataForSEO path is).
 *
 * Either way: this endpoint only ever finds and reports real, named
 * domains — it never fabricates a prospect. Outreach drafting and sending
 * are separate steps (see seo-outreach-draft.js) that always require a
 * human to review before anything sends.
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

function cleanDomain(raw) {
  return String(raw || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
}

async function fetchReferringDomains(targetDomain) {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null; // caller falls back to Perplexity

  try {
    const auth = Buffer.from(`${login}:${pass}`).toString('base64');
    const res = await fetch('https://api.dataforseo.com/v3/backlinks/referring_domains/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ target: targetDomain, limit: 15, order_by: ['rank,desc'] }]),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    return items.map(i => ({ domain: i.domain, rank: i.rank || null })).filter(i => i.domain);
  } catch (err) {
    console.warn('[seo-backlink-prospects] DataForSEO referring-domains lookup failed:', err.message);
    return null;
  }
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

  const { domain, competitors = [], profile } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const ownDomain = cleanDomain(domain);

  // Real path: competitors' referring domains, minus anyone already linking to us
  const competitorDomains = competitors.map(c => cleanDomain(c.url)).filter(Boolean).slice(0, 3);
  if (competitorDomains.length) {
    const ownReferrers = new Set((await fetchReferringDomains(ownDomain) || []).map(d => d.domain));
    const allResults = await Promise.all(competitorDomains.map(fetchReferringDomains));
    if (allResults.some(r => r !== null)) {
      const seen = new Set();
      const prospects = [];
      allResults.forEach((list, i) => {
        if (!list) return;
        list.forEach(({ domain: d, rank }) => {
          if (seen.has(d) || ownReferrers.has(d) || d === ownDomain) return;
          seen.add(d);
          prospects.push({
            domain: d, page_url: null,
            relevance_reason: `Already links to ${competitors[i]?.name || competitorDomains[i]} — a real, verified backlink source in this niche that doesn't yet link to you.`,
            data_source: 'real',
          });
        });
      });
      if (prospects.length) {
        return res.json({ success: true, prospects: prospects.slice(0, 15), dataSource: 'dataforseo' });
      }
    }
  }

  // Fallback: live search for real, named sites in this niche
  const query = `I run a business: ${profile?.business_summary || domain}. Industry: ${profile?.industry || 'not specified'}.

Find 8-12 REAL websites/blogs/publications that write about topics relevant to this industry and would plausibly link to a genuinely useful resource from a business like this — resource pages, "best tools" roundups, industry blogs that accept guest contributions, relevant directories. For each, report the real domain, the specific page if you found one, and why it's a real, verifiable, currently-active site (not defunct). Cite your sources. Never invent a domain.`;

  const search = await searchProvider(query, {
    systemPrompt: 'You are a link-building researcher. Search the live web and report only real, currently-active, verifiable websites with real source URLs. Never invent a domain.',
    maxTokens: 1800,
  });

  if (!search.available) {
    return res.json({ success: true, prospects: [], dataSource: 'none', reason: search.reason });
  }

  const structureResult = await callClaudeForJSON({
    system: 'You structure link-prospecting research into a clean schema. Use ONLY domains explicitly present in the research text — source_urls must be pulled from the citation list, never invented.',
    user: `Research findings:\n${search.text}\n\nCitations available: ${JSON.stringify(search.citations)}\n\nStructure this into the backlink prospects schema.`,
    tool: PROSPECTS_TOOL,
    maxTokens: 2500,
    timeoutMs: 40000,
  });
  if (!structureResult.success) return res.status(502).json({ success: false, error: structureResult.error });

  const prospects = (structureResult.data.prospects || []).map(p => ({ ...p, data_source: 'estimate' }));
  return res.json({ success: true, prospects, dataSource: 'perplexity' });
};
