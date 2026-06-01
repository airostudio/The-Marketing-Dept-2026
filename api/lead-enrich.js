/**
 * Lead Enrichment API — Vercel serverless function
 *
 * POST { email?, name?, firstName?, lastName?, company?, domain? }
 *
 * Returns enriched profile data:
 *   emailVerification: { status, score, type, disposable, webmail }
 *   person: { linkedin, twitter, title, seniority, isDecisionMaker }
 *   company: { size, industry, employeeCount, location, linkedin, techStack[] }
 *
 * Sources: Hunter.io (verification + finder), Perplexity Sonar (person/company intel)
 */

'use strict';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map();

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

// ── Hunter.io email verifier ─────────────────────────────────────────────────

async function verifyEmail(email, apiKey) {
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    const d = json.data || {};
    return {
      status:      d.status  || 'unknown',    // valid | invalid | risky | unknown
      score:       d.score   ?? null,          // 0-100
      type:        d.type    || null,          // personal | generic
      disposable:  d.disposable  || false,
      webmail:     d.webmail     || false,
      mxFound:     d.mx_found    || false,
      smtpServerAccepts: d.smtp_server_accepts_all || false,
    };
  } catch {
    return { status: 'unknown', score: null, type: null, disposable: false, webmail: false };
  }
}

// ── Hunter.io email finder ───────────────────────────────────────────────────

async function findEmail(firstName, lastName, domain, apiKey) {
  if (!firstName || !lastName || !domain) return null;
  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    const d = json.data || {};
    if (!d.email) return null;
    return { email: d.email, score: d.score, sources: d.sources?.length || 0 };
  } catch {
    return null;
  }
}

// ── Perplexity person + company enrichment ───────────────────────────────────

const LINKEDIN_PERSON_RE  = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/;
const LINKEDIN_COMPANY_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-_%]+/;
const TWITTER_RE          = /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/(?!share|intent)[a-zA-Z0-9_]+/;
const EMP_COUNT_RE        = /(\d[\d,]*)\s*(?:\+\s*)?(?:employee|staff|people|team member)/i;
const FUNDING_RE          = /(?:Series\s+[A-Z]|Seed|Pre-seed|IPO|bootstrapped|publicly traded)/i;
const SENIORITY_RE        = /\b(?:C-Suite|C-level|CxO|CEO|CTO|CMO|CFO|VP|Vice President|Director|Head of|Manager|Senior|Lead|Founder|Co-Founder)\b/i;

async function enrichWithPerplexity(name, company, title, apiKey) {
  const q = `Find professional details for ${name}${company ? ` at ${company}` : ''}${title ? `, ${title}` : ''}.
Include: LinkedIn profile URL, Twitter/X handle, their exact job title and seniority level (e.g. C-Suite, VP, Director, Manager, Individual Contributor).
Also provide for the company ${company || 'their company'}: industry, approximate employee count, company LinkedIn URL, headquarters location, technology stack used (CRM, analytics, marketing tools), funding stage.`;

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: q }],
        max_tokens: 800,
        return_citations: true,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return {};

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const citations = (data.citations || []).map(c =>
      typeof c === 'string' ? c : `${c.url || ''} ${c.title || ''}`
    ).join(' ');
    const full = text + ' ' + citations;

    const linkedinPersonMatch  = full.match(LINKEDIN_PERSON_RE);
    const linkedinCompanyMatch = full.match(LINKEDIN_COMPANY_RE);
    const twitterMatch         = full.match(TWITTER_RE);
    const empMatch             = full.match(EMP_COUNT_RE);
    const fundingMatch         = full.match(FUNDING_RE);
    const seniorityMatch       = full.match(SENIORITY_RE);

    // Extract tech stack mentions
    const techKeywords = [
      'Salesforce', 'HubSpot', 'Marketo', 'Pardot', 'Intercom', 'Zendesk', 'Pipedrive',
      'ActiveCampaign', 'Klaviyo', 'Mailchimp', 'Segment', 'Mixpanel', 'Amplitude',
      'Google Analytics', 'Stripe', 'Shopify', 'WordPress', 'Webflow', 'React', 'Next.js',
      'AWS', 'Azure', 'GCP', 'Slack', 'Notion', 'Jira', 'Figma',
    ];
    const techStack = techKeywords.filter(t => full.toLowerCase().includes(t.toLowerCase()));

    // Employee count parse
    let employeeCount = null;
    if (empMatch) {
      const raw = empMatch[1].replace(/,/g, '');
      employeeCount = parseInt(raw, 10) || null;
    }

    // Determine company size band
    let companySize = null;
    if (employeeCount !== null) {
      if (employeeCount < 10)        companySize = '1-9';
      else if (employeeCount < 50)   companySize = '10-49';
      else if (employeeCount < 200)  companySize = '50-199';
      else if (employeeCount < 1000) companySize = '200-999';
      else                           companySize = '1000+';
    }

    // Seniority / decision-maker flag
    const seniorityLevel = seniorityMatch ? seniorityMatch[0] : null;
    const decisionMakerKeywords = /\b(?:CEO|CTO|CMO|CFO|VP|Vice President|Director|Head of|Founder|Co-Founder|C-Suite|C-level)\b/i;
    const isDecisionMaker = decisionMakerKeywords.test(seniorityLevel || title || '');

    // Extract industry (simple heuristic from text)
    const industryKeywords = [
      'SaaS', 'Software', 'Technology', 'E-commerce', 'Retail', 'Healthcare', 'Finance',
      'Fintech', 'Marketing', 'Advertising', 'Media', 'Education', 'Real Estate',
      'Logistics', 'Manufacturing', 'Consulting', 'Legal', 'HR', 'Recruitment',
    ];
    const industry = industryKeywords.find(kw => full.toLowerCase().includes(kw.toLowerCase())) || null;

    // Extract location
    const locationRe = /(?:headquartered?|based|located)\s+(?:in\s+)?([A-Z][a-zA-Z\s,]+(?:USA|UK|US|Canada|Australia|Germany|France|India)?)/;
    const locationMatch = full.match(locationRe);

    return {
      person: {
        linkedin:       linkedinPersonMatch ? normaliseUrl(linkedinPersonMatch[0]) : null,
        twitter:        twitterMatch        ? normaliseUrl(twitterMatch[0])        : null,
        seniorityLevel: seniorityLevel,
        isDecisionMaker,
      },
      company: {
        linkedin:      linkedinCompanyMatch ? normaliseUrl(linkedinCompanyMatch[0]) : null,
        industry,
        employeeCount,
        companySize,
        fundingStage:  fundingMatch ? fundingMatch[0] : null,
        location:      locationMatch ? locationMatch[1].trim().replace(/\s+/g, ' ') : null,
        techStack:     techStack.slice(0, 8),
      },
    };
  } catch {
    return {};
  }
}

function normaliseUrl(u) {
  return u.startsWith('http') ? u : `https://${u}`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });

  const hunterKey     = process.env.HUNTER_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;

  const { email, name, firstName, lastName, company, domain, title } = req.body || {};

  if (!email && !name) {
    return res.status(400).json({ error: 'email or name required' });
  }

  const result = {
    email:             email || null,
    emailVerification: null,
    foundEmail:        null,
    person:            { linkedin: null, twitter: null, seniorityLevel: null, isDecisionMaker: false },
    company:           { linkedin: null, industry: null, employeeCount: null, companySize: null, fundingStage: null, location: null, techStack: [] },
  };

  // Parse name parts if only full name given
  let fName = firstName;
  let lName = lastName;
  if (name && (!fName || !lName)) {
    const parts = name.trim().split(/\s+/);
    fName = fName || parts[0] || '';
    lName = lName || parts.slice(1).join(' ') || '';
  }

  // Infer domain from email if not supplied
  const effectiveDomain = domain || (email ? email.split('@')[1] : null);

  // Run verification + person search in parallel (both need Hunter key)
  const hunterPromises = [];

  if (hunterKey) {
    if (email) {
      hunterPromises.push(verifyEmail(email, hunterKey).then(v => { result.emailVerification = v; }));
    }
    if (!email && fName && lName && effectiveDomain) {
      hunterPromises.push(findEmail(fName, lName, effectiveDomain, hunterKey).then(found => {
        if (found) {
          result.foundEmail = found.email;
          result.email      = found.email;
          // Also verify the found email
          return verifyEmail(found.email, hunterKey).then(v => { result.emailVerification = v; });
        }
      }));
    }
  }

  // Perplexity enrichment in parallel
  const perplexityPromise = perplexityKey && (name || fName)
    ? enrichWithPerplexity(name || `${fName} ${lName}`.trim(), company, title, perplexityKey)
        .then(enriched => {
          if (enriched.person)  result.person  = { ...result.person,  ...enriched.person  };
          if (enriched.company) result.company = { ...result.company, ...enriched.company };
        })
    : Promise.resolve();

  await Promise.all([...hunterPromises, perplexityPromise]);

  return res.json(result);
};
