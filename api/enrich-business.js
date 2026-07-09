/**
 * Business enrichment — Vercel serverless function.
 *
 * POST { url: "https://company.com" }
 *
 * 1. Fetches the homepage HTML to extract meta tags (title, description, og:*, social links)
 * 2. Calls Perplexity Sonar to research the company across their website & socials
 * 3. Returns structured JSON ready to map into the Business Brain schema
 *
 * All API keys stay server-side. Nothing credential-related is returned to the client.
 */

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

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
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

// ── Meta extraction from raw HTML ─────────────────────────────────────────────

function extractMeta(html) {
  const meta = {};

  const grab = (patterns) => {
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  };

  meta.title = grab([/<title[^>]*>([^<]+)<\/title>/i]);
  meta.description = grab([
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ]);
  meta.ogTitle = grab([
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ]);
  meta.ogDescription = grab([
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
  ]);
  meta.siteName = grab([
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
  ]);
  meta.twitterHandle = grab([
    /<meta[^>]+name=["']twitter:site["'][^>]+content=["']([^"'@]+)["']/i,
    /<meta[^>]+content=["']([^"'@]+)["'][^>]+name=["']twitter:site["']/i,
  ]);

  // Social links from anchor tags
  const liMatch = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[A-Za-z0-9_-]+)[^"']*/i);
  if (liMatch) meta.linkedin = liMatch[1];

  const twMatch = html.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+)[^"']*/i);
  if (twMatch) meta.twitterUrl = twMatch[1];

  return meta;
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'PERPLEXITY_API_KEY is not configured.' });
  }

  let body = {};
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); } catch { /* ignore */ }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  }

  const { url } = body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'URL must use http or https' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // ── Step 1: Fetch homepage meta tags ──────────────────────────────────────
  let meta = {};
  try {
    const homeRes = await fetch(parsedUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AudemaBot/1.0; +https://aduma.io)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (homeRes.ok) {
      const html = await homeRes.text();
      meta = extractMeta(html.slice(0, 50_000)); // only need <head>
    }
  } catch (err) {
    console.warn('[enrich-business] homepage fetch failed:', err.message);
  }

  // ── Step 2: Perplexity Sonar research ────────────────────────────────────
  const prompt = `Research the company at ${parsedUrl.href} thoroughly.

Look at their homepage, About page, pricing page, LinkedIn company profile, Twitter/X profile, and any press coverage you can find.

Extract information and return ONLY this JSON object (no markdown, no explanation):

{
  "company": {
    "name": "Official company name",
    "tagline": "Their main tagline or hero headline (1 line)",
    "description": "2-3 sentence description: what they do, who they serve, and the outcome they deliver",
    "industry": "One of: SaaS, E-commerce, Agency, Professional Services, Healthcare, Fintech, EdTech, Real Estate, Manufacturing, Media & Publishing, Other",
    "stage": "One of: Pre-revenue, Seed, Series A, Series B, Growth, Enterprise",
    "teamSize": "One of: 1-5, 6-15, 16-50, 51-200, 201-1000, 1000+",
    "revenueModel": "One of: SaaS subscription, Usage-based, Marketplace fee, Services / retainer, One-time purchase, Freemium, Advertising, Hybrid"
  },
  "icp": {
    "primaryBuyerRole": "Primary buyer job title (e.g. Head of Marketing, VP Sales, Founder, CTO)",
    "primaryBuyerCompanySize": "Company size they target — one of: 1-10, 11-50, 51-200, 201-1000, 1000+, any",
    "primaryBuyerIndustry": "Industry or vertical of their target customers",
    "painPoints": [
      "Most important pain point their product solves",
      "Second pain point",
      "Third pain point or frustration their customers have"
    ]
  },
  "positioning": {
    "uniqueValue": "Core value proposition — complete this: 'We help [X] achieve [Y] without [Z]'",
    "differentiation": [
      "Key differentiator 1",
      "Key differentiator 2",
      "Key differentiator 3"
    ],
    "voiceAndTone": ["Professional", "Direct"]
  },
  "competitors": [
    { "name": "Main competitor 1", "url": "https://..." },
    { "name": "Main competitor 2", "url": "https://..." }
  ],
  "socials": {
    "linkedin": "Full LinkedIn company page URL or empty string",
    "twitter": "Twitter/X handle with @ prefix, or full URL, or empty string"
  }
}

Rules:
- Leave fields as empty string "" if information cannot be determined with confidence.
- For voiceAndTone, only use words from: Professional, Casual, Direct, Warm, Technical, Educational, Bold, Humble, Contrarian, Provocative.
- For competitors, only include well-known, real competitors — maximum 3.
- Output ONLY the JSON object. Nothing else.`;

  try {
    const pRes = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a business intelligence analyst. Research companies thoroughly using their website and public information. Output only valid JSON exactly as instructed.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2048,
        temperature: 0.1,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!pRes.ok) {
      const errText = await pRes.text();
      throw new Error(`Perplexity API error ${pRes.status}: ${errText.slice(0, 300)}`);
    }

    const pData = await pRes.json();
    const rawText = pData.choices?.[0]?.message?.content || '';
    const citations = pData.citations || [];

    // Parse JSON — strip code fences if Perplexity wraps it anyway
    let extracted;
    try {
      const cleaned = rawText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      extracted = JSON.parse(cleaned);
    } catch (parseErr) {
      throw new Error(`Could not parse response as JSON: ${parseErr.message}`);
    }

    // Merge meta-tag fallbacks for anything Perplexity left empty
    if (!extracted.company) extracted.company = {};
    if (!extracted.socials)  extracted.socials  = {};

    if (!extracted.company.name        && meta.siteName)      extracted.company.name        = meta.siteName;
    if (!extracted.company.tagline     && meta.ogTitle)       extracted.company.tagline     = meta.ogTitle;
    if (!extracted.company.description && (meta.ogDescription || meta.description)) {
      extracted.company.description = meta.ogDescription || meta.description;
    }
    if (!extracted.socials.linkedin && meta.linkedin)     extracted.socials.linkedin = meta.linkedin;
    if (!extracted.socials.twitter  && meta.twitterUrl)   extracted.socials.twitter  = meta.twitterUrl;
    if (!extracted.socials.twitter  && meta.twitterHandle) extracted.socials.twitter = '@' + meta.twitterHandle.replace(/^@/, '');

    // Always echo the queried URL back so the client can store it
    extracted.socials.website = parsedUrl.href;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...extracted, citations });

  } catch (err) {
    console.error('[enrich-business] error:', err.message);
    return res.status(500).json({ error: 'Business enrichment failed', detail: err.message });
  }
};
