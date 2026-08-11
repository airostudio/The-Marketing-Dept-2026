/**
 * api/generate-ad-image.js
 * Vercel serverless function — generates a real, finished ad creative image
 * (PNG/JPEG/WEBP — never SVG) via OpenAI's image generation API.
 *
 * This is the AI-generated companion to render-social-image.js's free SVG
 * template: where that one draws colored boxes and typography, this one
 * asks a real image model for a finished, on-brand, scroll-stopping ad
 * visual with the headline/CTA baked in as real on-image typography.
 *
 * API key stored exclusively server-side (OPENAI_API_KEY — the same key
 * already used by api/openai.js). Never exposed client-side.
 *
 * Body: {
 *   headline: string,        // required
 *   subheadline?: string,
 *   cta?: string,
 *   proofPoint?: string,
 *   urgencyLine?: string,
 *   platform?: string,       // maps to a platform-native aspect ratio
 *   visualDirection?: string,// free-text art direction from the ad copy
 *   product?: string,        // what's being advertised
 *   audience?: string,       // who the ad targets — sharpens the visual hook
 *   brand?: { colours?: {primary,secondary,accent,background,text}, style?: string },
 *   format?: 'png'|'jpeg'|'webp',  // default 'png'
 * }
 *
 * Returns: { success, dataUri, hostedUrl, mimeType, platformSize, notes }
 */

'use strict';

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

const PLATFORM_TO_SIZE = {
  'LinkedIn':        'square',
  'Facebook':        'square',
  'Meta/Facebook':   'square',
  'Instagram':       'portrait',
  'Twitter/X':       'landscape',
  'X':               'landscape',
  'TikTok':          'story',
  'Google Display':  'landscape',
  'Google Search':   'square',
  'YouTube':         'landscape',
  'All Platforms':   'square',
};

// gpt-image-1 only accepts these three request sizes.
const SIZE_FOR_PLATFORM = {
  square:    '1024x1024',
  portrait:  '1024x1536',
  landscape: '1536x1024',
  story:     '1024x1536',
};

const FORMATS = new Set(['png', 'jpeg', 'webp']);
const MIME_FOR_FORMAT = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function buildPrompt({ headline, subheadline, cta, proofPoint, urgencyLine, platform, visualDirection, product, audience, brand }) {
  const colours = brand?.colours || {};
  const colourLine = [colours.primary, colours.secondary, colours.accent].filter(Boolean).length
    ? `Brand colors to use in the design and typography: ${[colours.primary && `primary ${colours.primary}`, colours.secondary && `secondary ${colours.secondary}`, colours.accent && `accent ${colours.accent}`].filter(Boolean).join(', ')}.`
    : '';

  const lines = [
    `Create a single, finished, publish-ready social media advertisement image for ${platform || 'social media'}.`,
    product ? `What's being advertised: ${product}.` : '',
    audience ? `Target audience (shape the visual hook and mood for them specifically): ${audience}.` : '',
    visualDirection ? `Art direction: ${visualDirection}.` : '',
    colourLine,
    `The image must have the following real, legible, correctly-spelled on-image typography baked in — not left as placeholder text:`,
    `- Headline (largest, most prominent text): "${headline}"`,
    subheadline ? `- Supporting line: "${subheadline}"` : '',
    proofPoint ? `- Small proof point / credibility line: "${proofPoint}"` : '',
    urgencyLine ? `- Urgency line: "${urgencyLine}"` : '',
    cta ? `- A high-contrast call-to-action button reading exactly: "${cta}"` : '',
    ``,
    `Apply proven direct-response advertising and conversion principles:`,
    `- One single, unmistakable focal point that stops the scroll in under a second`,
    `- A clear benefit-driven visual metaphor for the product/offer, not a generic stock-photo look`,
    `- High contrast between the CTA button and its background so it's the most clickable element on the canvas`,
    `- Clean, uncluttered composition with strong visual hierarchy — headline first, then supporting proof, then CTA`,
    `- Professional, premium, modern advertising design quality — the kind a top-tier paid social ad agency would ship`,
    `- No spelling mistakes, no garbled or duplicated text, no watermarks, no placeholder lorem-ipsum text`,
  ];

  return lines.filter(Boolean).join('\n');
}

// ── Optional hosted upload (Supabase Storage) — same bucket render-social-image.js
// uses, so approved AI creatives and quick-template creatives live side by side.
// Instagram/TikTok publishing requires a real fetchable URL, not a data: URI.
const STORAGE_BUCKET = 'social-creatives';
let _bucketEnsured = false;

async function ensureBucket(supabaseUrl, serviceKey) {
  if (_bucketEnsured) return;
  try {
    await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: STORAGE_BUCKET, name: STORAGE_BUCKET, public: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* bucket likely already exists — upload below will surface any real problem */ }
  _bucketEnsured = true;
}

async function uploadHostedCreative(buffer, mimeType, format, platformSize) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    await ensureBucket(supabaseUrl, serviceKey);
    const fileName = `ai-${platformSize}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`;
    const upRes = await fetch(`${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`, {
      method: 'POST',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': mimeType },
      body: buffer,
      signal: AbortSignal.timeout(20000),
    });
    if (!upRes.ok) return null;
    return `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`;
  } catch (err) {
    console.warn('[generate-ad-image] hosted upload failed:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in environment variables. Add it in Vercel → Settings → Environment Variables to enable real AI ad image generation.' });
  }

  const {
    headline, subheadline = '', cta = '', proofPoint = '', urgencyLine = '',
    platform = 'LinkedIn', visualDirection = '', product = '', audience = '',
    brand = {}, format = 'png',
  } = req.body || {};

  if (!headline || !String(headline).trim()) {
    return res.status(400).json({ error: 'headline is required' });
  }
  if (!FORMATS.has(format)) {
    return res.status(400).json({ error: `format must be one of: ${[...FORMATS].join(', ')}` });
  }

  const platformSize = PLATFORM_TO_SIZE[platform] || 'square';
  const size = SIZE_FOR_PLATFORM[platformSize];
  const prompt = buildPrompt({ headline, subheadline, cta, proofPoint, urgencyLine, platform, visualDirection, product, audience, brand });
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

  try {
    const upstream = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality: 'high',
        output_format: format,
        n: 1,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error?.message || `Image generation failed (${upstream.status})` });
    }

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(502).json({ error: 'Image API returned no image data.' });
    }

    const mimeType = MIME_FOR_FORMAT[format];
    const buffer = Buffer.from(b64, 'base64');
    const dataUri = `data:${mimeType};base64,${b64}`;
    const hostedUrl = await uploadHostedCreative(buffer, mimeType, format, platformSize);

    return res.json({
      success: true,
      dataUri,
      hostedUrl,
      mimeType,
      platformSize,
      notes: hostedUrl
        ? [`Real AI-generated ${format.toUpperCase()} creative — hosted and ready for Instagram/TikTok publishing.`]
        : [`Real AI-generated ${format.toUpperCase()} creative. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured (or upload failed) — hostedUrl is unavailable, so Instagram/TikTok publishing will reject this image until that's set up. It still displays and downloads fine everywhere else.`],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
