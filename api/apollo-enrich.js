/**
 * api/apollo-enrich.js
 * Vercel serverless function — proxies to Apollo.io's REST API (a separate
 * thing from the Apollo MCP connector some Claude sessions have access to;
 * this is the plain API-key-based REST API so Chase's deployed app can use
 * it without a user's Claude session in the loop).
 *
 * Third leg of Chase's real-data enrichment chain, alongside Google Places
 * (api/places.js — verifies the business itself: address/phone/website)
 * and Perplexity (api/perplexity.js — live web search for public profiles).
 * Apollo's job is company/contact data: real firmographic details and real
 * people who work there, never invented names.
 *
 * Body: {
 *   mode: 'organization' | 'people_search',
 *   domain: string,               // required for both modes, e.g. "acme.com"
 *   titles?: string[],            // people_search only — defaults to owner/founder-type titles
 * }
 *
 * mode='organization' → GET /v1/organizations/enrich?domain=...
 *   Returns real firmographic data if Apollo has the company: employee
 *   count, industry, LinkedIn URL, phone. Returns { found: false } if
 *   Apollo has no record — never backfilled with a guess.
 *
 * mode='people_search' → POST /v1/mixed_people/search
 *   Returns real people Apollo has on file at that domain matching the
 *   given titles (defaults to owner/founder/decision-maker titles — this
 *   is the "who do I actually contact" question). Apollo's search endpoint
 *   does not include email addresses (a separate, credit-costing enrich
 *   call would be needed for that) — this endpoint does not fabricate one
 *   either; `email` is simply omitted from results here.
 *
 * Required env var: APOLLO_API_KEY (Settings → Integrations → API Keys in Apollo)
 */

'use strict';

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;
const rateBuckets = new Map();

const DEFAULT_TITLES = ['Owner', 'Founder', 'Co-Founder', 'President', 'CEO', 'Managing Director', 'General Manager'];

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

function cleanDomain(raw) {
  return (raw || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .toLowerCase()
    .trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'APOLLO_API_KEY not configured. Add it in Vercel env vars (Apollo → Settings → Integrations → API Keys).',
    });
  }

  const { mode, titles } = req.body || {};
  const domain = cleanDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  if (mode !== 'organization' && mode !== 'people_search') {
    return res.status(400).json({ error: "mode must be 'organization' or 'people_search'" });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Api-Key': apiKey,
  };

  try {
    if (mode === 'organization') {
      const upstream = await fetch(`${APOLLO_API_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: data.error || data.message || `Apollo API error (${upstream.status})` });
      }
      const org = data.organization || null;
      if (!org) return res.json({ found: false });

      return res.json({
        found: true,
        name: org.name || null,
        websiteUrl: org.website_url || null,
        linkedinUrl: org.linkedin_url || null,
        phone: org.phone || org.primary_phone?.number || null,
        industry: org.industry || null,
        employeeCount: org.estimated_num_employees ?? null,
        foundedYear: org.founded_year ?? null,
        shortDescription: org.short_description || null,
        raw: org, // full Apollo payload passed through — field-name guesses above shouldn't lose data if Apollo's schema shifts
      });
    }

    // mode === 'people_search'
    const personTitles = (Array.isArray(titles) && titles.length) ? titles : DEFAULT_TITLES;
    const upstream = await fetch(`${APOLLO_API_BASE}/mixed_people/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        q_organization_domains: domain,
        person_titles: personTitles,
        per_page: 5,
        page: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error || data.message || `Apollo API error (${upstream.status})` });
    }

    const people = data.people || data.contacts || [];
    return res.json({
      found: people.length > 0,
      people: people.map(p => ({
        name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        title: p.title || null,
        linkedinUrl: p.linkedin_url || null,
        // Apollo's search results never include email — a separate,
        // credit-costing enrichment call is required for that. Never
        // filled in with a guess.
      })),
      note: people.length ? 'Apollo search results do not include email addresses — verified emails require a separate Apollo enrichment credit spend, or use Hunter.io (already wired into this pipeline) against the same domain.' : undefined,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
