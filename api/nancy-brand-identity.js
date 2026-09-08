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

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;


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

module.exports = withFailureReporting('api/nancy-brand-identity', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'nancy-brand-identity', max: 8, windowMs: 60 * 1000, auth })) return;

  const { origin, screenshotDataUri, colourCandidates = {}, fontHints = [] } = req.body || {};
  if (!origin) return res.status(400).json({ error: 'origin (from nancy-screenshot) is required' });

  const candidates = colourCandidates.allCandidates || [];
  const parsedShot = parseDataUri(screenshotDataUri);

  // With no screenshot AND no colour found anywhere in the site's CSS, there
  // is nothing to read a brand off. The tool schema requires primary_colour,
  // so asking anyway does not produce "I don't know" — it produces a
  // confident hex invented from the domain name, which Nancy then reports as
  // the customer's brand colour and renders a week of creative in. Refusing
  // to guess and asking the customer is the only honest answer here.
  if (!parsedShot && candidates.length === 0) {
    return res.json({
      success: true,
      brand: {
        colours_measured: false,
        measurement_reason:
          'No screenshot service is configured and this site declares no colours in any stylesheet we could read, ' +
          'so there was nothing to read your brand colours from. Set them below and Nancy will use those.',
        primary_colour: null,
        secondary_colours: [],
        accent_colours: [],
        background_colours: [],
        text_colours: [],
        brand_personality: [],
        visual_style: '',
        design_notes: '',
        fonts_detected: fontHints,
      },
    });
  }

  const system = `You are a brand designer identifying a website's INTENTIONAL visual identity — the colours/style the designer chose to represent the brand, not just whatever pixels are most common. Prefer colours used on buttons, headings, and CTAs over incidental background greys. If a screenshot is provided, use it as the primary evidence of what the site actually looks like; use the colour candidates list as a hint, not gospel — override it if the screenshot shows something different.`;

  const colourHint = `Colour candidates extracted from this site's CSS (ranked by how intentionally-branded they look): ${candidates.join(', ') || 'none found'}.\nFont hints found in CSS: ${fontHints.join(', ') || 'none found'}.`;

  // Say plainly what evidence exists. Every colour returned has to come from
  // one of these two sources; "it seemed like a plausible colour for this
  // kind of business" is not evidence, and the customer will be shown this
  // as a reading of their site.
  const evidence = parsedShot
    ? 'You have a screenshot of the live site. Read the colours off it.'
    : 'You have NO screenshot — only the CSS candidates above. Choose the primary colour from that list; do not name a hex that is not in it.';

  const content = [{ type: 'text', text: `Website: ${origin}\n\n${colourHint}\n\n${evidence}\n\nIdentify the brand's visual identity.` }];
  if (parsedShot) {
    content.unshift({ type: 'image', source: { type: 'base64', media_type: parsedShot.mimeType, data: parsedShot.base64 } });
  }

  try {
    const result = await callClaudeForJSON({ system, user: content, tool: BRAND_TOOL, maxTokens: 1500, timeoutMs: 45000 });
    if (!result.success) return res.status(502).json({ success: false, error: result.error });

    return res.json({
      success: true,
      brand: {
        ...result.data,
        fonts_detected: fontHints,
        colours_measured: true,
        // Which evidence this reading actually rests on, so the UI can say so
        // rather than claiming a screenshot it never took.
        measured_from: parsedShot ? 'screenshot' : 'stylesheet',
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Brand identity extraction failed unexpectedly.' });
  }
});
