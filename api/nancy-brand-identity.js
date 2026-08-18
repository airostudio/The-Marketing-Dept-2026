/**
 * api/nancy-brand-identity.js — Nancy Step 4: Brand Identity Extraction
 *
 * POST {
 *   origin: string,
 *   screenshotDataUri?: string,   // from nancy-screenshot.js — data:<mime>;base64,<...>
 *   colourCandidates: { allCandidates: string[] },
 *   fontHints: string[],
 * }
 * Returns: { success, brand: {...brand identity schema...} }
 *
 * Does exactly ONE slow external call — a Claude vision read of the
 * screenshot (when available) plus the colour/font candidates from
 * nancy-screenshot.js. Split out so the screenshot capture and this Claude
 * call never share one Vercel function's 60s ceiling.
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

const BRAND_TOOL = {
  name: 'submit_brand_identity',
  description: 'Submit the site\'s intentional visual brand identity.',
  input_schema: {
    type: 'object',
    properties: {
      primary_colour: { type: 'string', description: 'Hex code, the single dominant intentional brand colour' },
      secondary_colours: { type: 'array', items: { type: 'string' } },
      accent_colours: { type: 'array', items: { type: 'string' } },
      background_colours: { type: 'array', items: { type: 'string' } },
      text_colours: { type: 'array', items: { type: 'string' } },
      heading_style: { type: 'string' },
      body_style: { type: 'string' },
      visual_style: { type: 'string', description: 'e.g. "minimal editorial", "bold and playful", "corporate premium"' },
      brand_personality: { type: 'array', items: { type: 'string' }, description: '3-5 adjectives' },
      image_style: { type: 'string' },
      design_notes: { type: 'string' },
    },
    required: ['primary_colour', 'secondary_colours', 'accent_colours', 'visual_style', 'brand_personality'],
  },
};

function parseDataUri(dataUri) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri || '');
  return match ? { mimeType: match[1], base64: match[2] } : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { origin, screenshotDataUri, colourCandidates = {}, fontHints = [] } = req.body || {};
  if (!origin) return res.status(400).json({ error: 'origin (from nancy-screenshot) is required' });

  const system = `You are a brand designer identifying a website's INTENTIONAL visual identity — the colours/style the designer chose to represent the brand, not just whatever pixels are most common. Prefer colours used on buttons, headings, and CTAs over incidental background greys. If a screenshot is provided, use it as the primary evidence of what the site actually looks like; use the colour candidates list as a hint, not gospel — override it if the screenshot shows something different.`;

  const colourHint = `Colour candidates extracted from this site's CSS (ranked by how intentionally-branded they look): ${(colourCandidates.allCandidates || []).join(', ') || 'none found'}.\nFont hints found in CSS: ${fontHints.join(', ') || 'none found'}.`;

  const content = [{ type: 'text', text: `Website: ${origin}\n\n${colourHint}\n\nIdentify the brand's visual identity.` }];
  const parsed = parseDataUri(screenshotDataUri);
  if (parsed) {
    content.unshift({ type: 'image', source: { type: 'base64', media_type: parsed.mimeType, data: parsed.base64 } });
  }

  try {
    const result = await callClaudeForJSON({ system, user: content, tool: BRAND_TOOL, maxTokens: 1500, timeoutMs: 45000 });
    if (!result.success) return res.status(502).json({ success: false, error: result.error });

    return res.json({ success: true, brand: { ...result.data, fonts_detected: fontHints } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Brand identity extraction failed unexpectedly.' });
  }
};
