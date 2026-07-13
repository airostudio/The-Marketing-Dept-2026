/**
 * api/render-social-image.js — Inline creative rendering for Social Studio
 *
 * POST {
 *   headline:        string,   // required
 *   subheadline?:    string,   // ad mode: body/description; organic mode: hook
 *   cta?:            string,
 *   proofPoint?:     string,
 *   urgencyLine?:    string,
 *   platform?:       string,   // maps to a platform-native canvas size
 *   visualDirection?: string,  // free-text creative direction, echoed into notes
 *   brand?: {
 *     colours?: { primary?, secondary?, accent?, background?, text? },
 *     fonts?:   { heading?, body? },
 *   },
 * }
 *
 * Returns: { success, svg, dataUri, width, height, platformSize, notes }
 *
 * Ports the deterministic SVG layout engine built for the standalone Audema
 * AdForge MCP (audema-adforge-mcp/src/render/*) into the live product, minus
 * the Sharp/PNG rasterization step — the project has zero npm dependencies
 * today (every api/*.js file runs on the built-in Node/fetch runtime only),
 * and a browser renders SVG natively, so there's nothing to gain from adding
 * a native-binary image library just to turn this into a PNG. The SVG *is*
 * the rendered creative: it displays directly in an <img> tag or inline,
 * and downloads as a real, editable vector file.
 *
 * No API key required — this is pure deterministic layout/templating.
 */

'use strict';

const PLATFORM_SIZES = {
  square:    { width: 1080, height: 1080 },
  portrait:  { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 628 },
  story:     { width: 1080, height: 1920 },
};

const PLATFORM_TO_SIZE = {
  'LinkedIn':        'square',
  'Facebook':        'square',
  'Meta/Facebook':   'square',
  'Instagram':       'portrait',
  'Twitter/X':       'landscape',
  'TikTok':          'story',
  'Google Display':  'landscape',
  'Google Search':   'square',
  'YouTube':         'landscape',
  'All Platforms':   'square',
};

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, fontSize, maxWidth) {
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.max(6, Math.floor(maxWidth / avgCharWidth));
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.56;
}

/** Deterministic layout: safe zones, font sizes, and stacking order derived
 *  from the platform's real dimensions and how much copy is present. */
function generateLayout(concept, platformSize) {
  const { width, height } = PLATFORM_SIZES[platformSize];
  const isVertical = platformSize === 'story' || platformSize === 'portrait';

  const marginX = Math.round(width * 0.08);
  const marginTop = Math.round(height * (platformSize === 'story' ? 0.14 : 0.08));
  const marginBottom = Math.round(height * (platformSize === 'story' ? 0.16 : 0.1));
  const contentWidth = width - marginX * 2;

  const baseScale = width / 1080;
  const headlineSize = Math.round((platformSize === 'landscape' ? 56 : 72) * baseScale);
  const subheadlineSize = Math.round(32 * baseScale);
  const ctaSize = Math.round(30 * baseScale);
  const smallSize = Math.round(24 * baseScale);

  const textColor = concept.textColor || '#FFFFFF';
  const ctaColor = concept.ctaColor || textColor;

  const blocks = [];
  let cursorY = isVertical ? Math.round(height * 0.34) : Math.round(height * 0.28);

  blocks.push({ role: 'headline', x: marginX, y: cursorY, width: contentWidth, fontSize: headlineSize, fontWeight: 800, lineHeight: headlineSize * 1.15, align: 'left', color: textColor });
  cursorY += Math.round(headlineSize * 1.15 * 2 + 24 * baseScale);

  if (concept.subheadline) {
    blocks.push({ role: 'subheadline', x: marginX, y: cursorY, width: contentWidth, fontSize: subheadlineSize, fontWeight: 500, lineHeight: subheadlineSize * 1.3, align: 'left', color: textColor });
    cursorY += Math.round(subheadlineSize * 1.3 * 2 + 16 * baseScale);
  }

  if (concept.proofPoint) {
    blocks.push({ role: 'proofPoint', x: marginX, y: cursorY, width: contentWidth, fontSize: smallSize, fontWeight: 600, lineHeight: smallSize * 1.3, align: 'left', color: textColor });
    cursorY += Math.round(smallSize * 1.3 + 12 * baseScale);
  }

  if (concept.urgencyLine) {
    blocks.push({ role: 'urgencyLine', x: marginX, y: cursorY, width: contentWidth, fontSize: smallSize, fontWeight: 700, lineHeight: smallSize * 1.3, align: 'left', color: ctaColor });
    cursorY += Math.round(smallSize * 1.3 + 16 * baseScale);
  }

  if (concept.cta) {
    const ctaY = height - marginBottom - ctaSize;
    blocks.push({ role: 'cta', x: marginX, y: Math.max(ctaY, cursorY + 20 * baseScale), width: contentWidth, fontSize: ctaSize, fontWeight: 700, lineHeight: ctaSize * 1.2, align: 'left', color: ctaColor });
  }

  const notes = [];
  if (isVertical) notes.push('Vertical format: keep the primary subject in the top 60% — platform UI typically overlays the bottom 20%.');
  if (platformSize === 'landscape') notes.push('Landscape format: frequently cropped to a small thumbnail in feed — keep headline legible at 300px wide.');
  if (concept.visualDirection) notes.push(`Background style should reflect: "${concept.visualDirection}".`);

  return { width, height, blocks, notes };
}

function backgroundSvg(width, height, colours) {
  const bg = colours.background;
  if (bg) return `<rect width="${width}" height="${height}" fill="${bg}" />`;

  const primary = colours.primary || '#7C3AED';
  const secondary = colours.secondary || primary;
  return `
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${primary}" />
        <stop offset="100%" stop-color="${secondary}" />
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
  `;
}

// ── Optional hosted upload (Supabase Storage) ───────────────────────────────
// Instagram and TikTok's publish APIs require a real, publicly fetchable
// image URL — they cannot accept a data: URI. When SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are configured, best-effort upload the rendered
// SVG to a public bucket and return that URL alongside the data URI (which
// keeps working for the inline card preview regardless — this is purely
// additive, never a requirement for Phase F's zero-dependency guarantee).
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

async function uploadHostedCreative(svg, platformSize) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    await ensureBucket(supabaseUrl, serviceKey);
    const fileName = `${platformSize}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.svg`;
    const upRes = await fetch(`${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`, {
      method: 'POST',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'image/svg+xml' },
      body: svg,
      signal: AbortSignal.timeout(15000),
    });
    if (!upRes.ok) return null;
    return `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`;
  } catch (err) {
    console.warn('[render-social-image] hosted upload failed:', err.message);
    return null;
  }
}

function textFor(role, concept) {
  switch (role) {
    case 'headline': return concept.headline;
    case 'subheadline': return concept.subheadline;
    case 'cta': return concept.cta;
    case 'proofPoint': return concept.proofPoint;
    case 'urgencyLine': return concept.urgencyLine;
    default: return undefined;
  }
}

function buildSvg(concept, layout, fonts) {
  const headingFont = fonts.heading || 'Arial, Helvetica, sans-serif';
  const bodyFont = fonts.body || headingFont;

  const textElements = layout.blocks.map((block) => {
    const raw = textFor(block.role, concept);
    if (!raw) return '';

    const font = block.role === 'headline' ? headingFont : bodyFont;
    const lines = wrapText(raw, block.fontSize, block.width);
    const tspans = lines.map((line, i) => `<tspan x="${block.x}" dy="${i === 0 ? 0 : block.lineHeight}">${escapeXml(line)}</tspan>`).join('');

    const decoration = block.role === 'cta'
      ? `<rect x="${block.x - 20}" y="${block.y - block.fontSize * 0.9}" width="${Math.min(block.width, estimateTextWidth(lines[0] || '', block.fontSize) + 40)}" height="${block.fontSize * 1.8}" rx="8" fill="${block.color}" opacity="0.15" />`
      : '';

    const anchor = block.align === 'center' ? 'middle' : block.align === 'right' ? 'end' : 'start';
    return `${decoration}\n<text x="${block.x}" y="${block.y}" font-family="${font}" font-size="${block.fontSize}" font-weight="${block.fontWeight}" fill="${block.color}" text-anchor="${anchor}">${tspans}</text>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">\n  ${backgroundSvg(layout.width, layout.height, concept.colours)}\n  ${textElements}\n</svg>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    headline, subheadline = '', cta = '', proofPoint = '', urgencyLine = '',
    platform = 'LinkedIn', visualDirection = '', brand = {},
  } = req.body || {};

  if (!headline || !String(headline).trim()) {
    return res.status(400).json({ error: 'headline is required' });
  }

  const platformSize = PLATFORM_TO_SIZE[platform] || 'square';
  const colours = {
    primary: brand.colours?.primary || '#7C3AED',
    secondary: brand.colours?.secondary || brand.colours?.primary || '#EC4899',
    background: brand.colours?.background,
  };
  const fonts = { heading: brand.fonts?.heading, body: brand.fonts?.body };

  const concept = {
    headline: String(headline).trim().slice(0, 200),
    subheadline: String(subheadline).trim().slice(0, 240),
    cta: String(cta).trim().slice(0, 60),
    proofPoint: String(proofPoint).trim().slice(0, 160),
    urgencyLine: String(urgencyLine).trim().slice(0, 100),
    visualDirection: String(visualDirection).trim().slice(0, 300),
    textColor: brand.colours?.text,
    ctaColor: brand.colours?.accent,
    colours,
  };

  const layout = generateLayout(concept, platformSize);
  const svg = buildSvg(concept, layout, fonts);
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const hostedUrl = await uploadHostedCreative(svg, platformSize);

  return res.json({
    success: true,
    svg,
    dataUri,
    hostedUrl,
    width: layout.width,
    height: layout.height,
    platformSize,
    notes: hostedUrl ? layout.notes : [...layout.notes, 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured (or upload failed) — hostedUrl is unavailable, so Instagram/TikTok publishing will reject this image. The data URI still renders fine everywhere else.'],
  });
};
