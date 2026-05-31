/**
 * Webese Content Generation Endpoint
 *
 * Webese calls this to generate brand-consistent copy for any page section.
 * Brand voice/tone/ICP are extracted from the validated access token so
 * every response is pre-tuned to the user's brand without an extra DB call.
 *
 * POST /api/webese-generate
 *   Authorization: Bearer <access_token>
 *   Body: {
 *     page_type:  "homepage" | "landing" | "about" | "pricing" | "blog" | "contact"
 *     section:    "hero" | "features" | "cta" | "about" | "testimonial" | "footer" | "nav" | "seo"
 *     keywords:   string[]          (optional)
 *     context:    string            (optional extra context from Webese user)
 *     tone_override: string         (optional, overrides brand tone)
 *   }
 *
 * Returns:
 *   { headline, subheadline, body, cta_text, meta_description, keywords_used }
 *
 * Env vars required:
 *   OAUTH_JWT_SECRET   — shared signing secret
 *   ANTHROPIC_API_KEY  — existing Anthropic key
 */

const crypto = require('crypto');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = 'claude-sonnet-4-6';
const MAX_TOKENS        = 1024;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX       = 30;
const rateBuckets          = new Map();

const VALID_PAGE_TYPES = new Set(['homepage', 'landing', 'about', 'pricing', 'blog', 'contact', 'features', 'case-study']);
const VALID_SECTIONS   = new Set(['hero', 'features', 'cta', 'about', 'testimonial', 'footer', 'nav', 'seo', 'headline', 'value-prop']);

// ── JWT verify ────────────────────────────────────────────────────────────────

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${header}.${body}`).digest('base64url');

  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('invalid signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('token expired');
  }
  return payload;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

function checkRateLimit(key) {
  const now    = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { start: now, count: 1 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

// ── CORS ──────────────────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.WEBESE_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Build brand-aware system prompt ───────────────────────────────────────────

function buildSystemPrompt(brand, pageType, section) {
  const co  = brand?.company     || {};
  const pos = brand?.positioning || {};
  const icp = brand?.icp         || {};

  const voice = (pos.voiceAndTone || []).join(', ')   || 'professional, clear, helpful';
  const never = pos.thingsWeNeverSay                   || '';
  const value = pos.uniqueValue                        || '';
  const diff  = (pos.differentiation || []).join('; ') || '';
  const pain  = (icp.painPoints      || []).join(', ') || '';
  const role  = icp.primaryBuyer?.role                 || 'decision-maker';
  const size  = icp.primaryBuyer?.companySize          || '';
  const fear  = icp.biggestFear                        || '';

  return `You are a world-class conversion copywriter specialising in ${pageType} pages.

BRAND CONTEXT:
- Company: ${co.name || 'the company'} (${co.industry || 'SaaS'}, ${co.stage || 'growth'} stage)
- Unique value: ${value}
- Differentiators: ${diff}
- Voice & tone: ${voice}
${never ? `- NEVER say or imply: ${never}` : ''}

TARGET BUYER:
- Role: ${role}${size ? `, ${size} company` : ''}
- Pain points: ${pain}
${fear ? `- Biggest fear: ${fear}` : ''}

TASK: Write the "${section}" section of a ${pageType} page.

OUTPUT FORMAT (JSON only, no markdown wrapper):
{
  "headline": "...",
  "subheadline": "...",
  "body": "...",
  "cta_text": "...",
  "meta_description": "..."
}

Rules:
- headline: max 10 words, outcome-focused
- subheadline: max 20 words, expands on headline
- body: 2-4 sentences, benefit-led, addresses buyer pain
- cta_text: max 5 words, action verb + outcome
- meta_description: 140-160 characters, includes primary keyword
- Output ONLY the JSON object, nothing else`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const secret      = process.env.OAUTH_JWT_SECRET;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!secret || !anthropicKey) {
    return res.status(500).json({ error: 'server not configured' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });

  let claims;
  try {
    claims = verifyJWT(token, secret);
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', detail: err.message });
  }

  if (!claims.scope?.includes('generate:write')) {
    return res.status(403).json({ error: 'insufficient_scope' });
  }

  // ── Rate limit per user ───────────────────────────────────────────────────
  if (!checkRateLimit(claims.sub)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limit_exceeded' });
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const {
    page_type     = 'homepage',
    section       = 'hero',
    keywords      = [],
    context       = '',
    tone_override = '',
  } = req.body || {};

  if (!VALID_PAGE_TYPES.has(page_type)) {
    return res.status(400).json({ error: `invalid page_type. Allowed: ${[...VALID_PAGE_TYPES].join(', ')}` });
  }
  if (!VALID_SECTIONS.has(section)) {
    return res.status(400).json({ error: `invalid section. Allowed: ${[...VALID_SECTIONS].join(', ')}` });
  }

  const brand = claims.brand || {};
  if (tone_override) {
    brand.positioning = brand.positioning || {};
    brand.positioning.voiceAndTone = [tone_override];
  }

  const systemPrompt = buildSystemPrompt(brand, page_type, section);

  const userMessage = [
    keywords.length > 0 ? `Target keywords: ${keywords.slice(0, 10).join(', ')}.` : '',
    context ? `Additional context: ${context.slice(0, 500)}` : '',
    'Generate the copy now.',
  ].filter(Boolean).join('\n');

  // ── Call Claude ───────────────────────────────────────────────────────────
  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: 'upstream error', detail: err.message });
  }

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text().catch(() => '');
    return res.status(502).json({ error: 'claude error', status: anthropicRes.status, detail: errBody.slice(0, 200) });
  }

  const data = await anthropicRes.json();
  const raw  = data.content?.[0]?.text || '{}';

  let copy;
  try {
    copy = JSON.parse(raw);
  } catch {
    // Attempt to extract JSON block if Claude added surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    try { copy = match ? JSON.parse(match[0]) : {}; } catch { copy = {}; }
  }

  return res.status(200).json({
    ...copy,
    keywords_used: keywords,
    page_type,
    section,
    generated_for: claims.email,
  });
};
