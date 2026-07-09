/**
 * Outreach draft — Vercel serverless function.
 *
 * POST {
 *   prospect: { name, firstName, title, company, industry, companySize },
 *   seller:   { companyName, offer, niche, outcome },
 *   signals:  [{ type, title, detail, confidence?, detected_at? }]
 * }
 *
 * Uses Claude to generate a personalized cold email + LinkedIn message
 * grounded in verified buying intent signals (Gojiberry blueprint Module D).
 *
 * All API keys stay server-side.
 */

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }

  let body = {};
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body); } catch { /* ignore */ }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  }

  const { prospect, seller, signals } = body;

  if (!prospect || !prospect.company) {
    return res.status(400).json({ error: 'prospect.company is required' });
  }
  if (!prospect.name && !prospect.firstName) {
    return res.status(400).json({ error: 'prospect.name or prospect.firstName is required' });
  }

  // Normalise optional fields with safe fallbacks
  const prospectName      = prospect.name      || prospect.firstName || 'there';
  const prospectFirstName = prospect.firstName  || (prospect.name ? prospect.name.split(' ')[0] : 'there');
  const prospectTitle     = prospect.title      || 'professional';
  const prospectCompany   = prospect.company;
  const prospectIndustry  = prospect.industry   || 'B2B';
  const prospectSize      = prospect.companySize || 'mid-market';

  const sellerCompany = seller?.companyName || 'our agency';
  const sellerOffer   = seller?.offer       || 'We help B2B companies book more qualified meetings with their ideal clients.';
  const sellerNiche   = seller?.niche       || 'B2B companies';
  const sellerOutcome = seller?.outcome     || 'more qualified meetings per month';

  const signalList = Array.isArray(signals) && signals.length > 0 ? signals : [];

  // ── Build prompts ─────────────────────────────────────────────────────────
  const systemPrompt = `You are writing concise B2B outbound messages. Rules:
- Do not invent facts. Only use the verified signals provided.
- Keep email under 90 words (not counting subject line).
- LinkedIn message under 60 words.
- No fake familiarity ("Hope this finds you well").
- No exaggerated claims or superlatives.
- Mention one specific signal as the reason for outreach.
- Include opt-out language in email P.S.
- Write in plain, direct, human language.
- No emojis.
Output ONLY valid JSON.`;

  const signalsSection = signalList.length > 0
    ? `Verified buying intent signals detected for ${prospectCompany}:\n${signalList.map((s, i) => `${i + 1}. [${s.type}] ${s.title} — ${s.detail}`).join('\n')}`
    : `No specific buying intent signals were detected. Base the outreach on the enrichment data: the prospect is a ${prospectTitle} at a ${prospectSize} ${prospectIndustry} company.`;

  const userPrompt = `Write a cold outreach email and LinkedIn message for the following prospect.

SELLER:
- Company: ${sellerCompany}
- Offer: ${sellerOffer}
- Niche served: ${sellerNiche}
- Outcome delivered: ${sellerOutcome}

PROSPECT:
- Name: ${prospectName}
- First name: ${prospectFirstName}
- Title: ${prospectTitle}
- Company: ${prospectCompany}
- Industry: ${prospectIndustry}
- Company size: ${prospectSize}

${signalsSection}

Return ONLY this JSON object — no markdown fences, no extra text:

{
  "email": {
    "subject": "subject line here",
    "body": "full email body here"
  },
  "linkedin": "linkedin message here",
  "primarySignalUsed": "type of the signal that anchored the outreach (e.g. hiring, funding, growth — or 'enrichment' if no signals were available)"
}`;

  // ── Claude API call ───────────────────────────────────────────────────────
  try {
    const cRes = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!cRes.ok) {
      const errText = await cRes.text();
      throw new Error(`Claude API error ${cRes.status}: ${errText.slice(0, 300)}`);
    }

    const cData = await cRes.json();
    const rawText = cData.content?.[0]?.text || '';

    // Strip markdown fences if Claude wraps the output anyway
    const cleaned = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    let draft;
    try {
      draft = JSON.parse(cleaned);
    } catch {
      throw new Error('Could not parse Claude response as JSON');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      email: draft.email || { subject: '', body: '' },
      linkedin: draft.linkedin || '',
      primarySignalUsed: draft.primarySignalUsed || 'unknown',
      prospect: {
        name: prospectName,
        company: prospectCompany,
      },
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[outreach-draft] error:', err.message);
    return res.status(500).json({ error: 'Outreach generation failed', detail: err.message });
  }
};
