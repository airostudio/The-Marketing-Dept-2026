/**
 * Lead signals — Vercel serverless function.
 *
 * POST { company: "Acme SaaS", domain?: "acmesaas.com", context?: "extra context" }
 *
 * Uses Perplexity Sonar to detect real buying intent signals for a company:
 * hiring, funding, leadership changes, growth, competitive, and tech adoption.
 *
 * All API keys stay server-side.
 */

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
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

  const { company, domain, context } = body;
  if (!company) return res.status(400).json({ error: 'company is required' });

  // ── Build prompts ─────────────────────────────────────────────────────────
  const systemPrompt =
    'You are a B2B sales intelligence analyst. Find verifiable buying intent signals for companies. Only report signals with evidence. Output valid JSON only.';

  const domainLine = domain ? ` (domain: ${domain})` : '';
  const contextLine = context ? `\n\nAdditional context: ${context}` : '';

  const userPrompt = `Search for buying intent signals for the company: ${company}${domainLine}.${contextLine}

Search across LinkedIn Jobs, job boards, Crunchbase, press releases, news articles, G2/Capterra reviews, and technology intelligence sources (BuiltWith, Datanyze, etc.).

Look for these six signal types:

1. Hiring signals — are they actively hiring SDRs, sales reps, RevOps, or marketing roles on LinkedIn Jobs or other job boards?
2. Funding signals — any recent funding rounds, venture investment announcements, or capital raises?
3. Leadership changes — new CXO, VP, or Director-level hires or departures in the last 6 months?
4. Growth signals — expansion announcements, new markets entered, product launches, or significant press coverage?
5. Competitive signals — any reviews, mentions, or discussions of switching from or to competitor products?
6. Tech adoption — recent technology installs, stack changes, or new tool adoption?

Return ONLY a JSON array of up to 8 signals. Each signal must follow this exact shape:

[
  {
    "type": "hiring|funding|leadership|growth|competitor|tech|news",
    "title": "short title (max 8 words)",
    "detail": "1-2 sentence description with specifics",
    "confidence": 0.8,
    "detected_at": "${new Date().toISOString().slice(0, 10)}"
  }
]

Rules:
- Maximum 8 signals total.
- Only include signals with confidence >= 0.5.
- Do not invent signals that cannot be verified from public sources.
- Leave the array empty [] if nothing concrete is found.
- Output ONLY the JSON array. No markdown fences, no explanation, no prose.`;

  // ── Perplexity Sonar call ─────────────────────────────────────────────────
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
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 2000,
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

    // Strip markdown fences if Perplexity wraps the output anyway
    const cleaned = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    let signals;
    try {
      signals = JSON.parse(cleaned);
      if (!Array.isArray(signals)) {
        throw new Error('Parsed value is not an array');
      }
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ signals: [], error: 'Could not parse signal data', company, domain: domain || null, scannedAt: new Date().toISOString() });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      signals,
      company,
      domain: domain || null,
      scannedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[lead-signals] error:', err.message);
    return res.status(500).json({ error: 'Signal detection failed', detail: err.message });
  }
};
