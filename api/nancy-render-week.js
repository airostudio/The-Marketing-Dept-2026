/**
 * api/nancy-render-week.js — Nancy Agent 7 + Rendering Engine
 *
 * POST {
 *   posts: [...7 post concepts from nancy-content-plan...],
 *   brand: { primary_colour, secondary_colours, accent_colours, background_colours,
 *            text_colours, heading_style, body_style, fonts_detected },
 *   businessName: string,
 *   logoUrl?: string,
 *   userPhotos?: [{ dataUri: string }],   // uploaded photos, matched to posts by index
 * }
 * Returns: { success, assets: [{ day, svg, dataUri, hostedUrl? }] }
 *
 * Same deterministic, zero-dependency SVG rendering approach as
 * api/render-social-image.js (see that file's header for why: no Sharp/
 * Puppeteer/Satori dependency, a browser renders SVG natively, and it's a
 * real downloadable/editable vector file, not a placeholder). Extended here
 * for Instagram's 1080x1350 canvas, real photo compositing via embedded
 * data-URI <image>, and a genuinely different infographic layout for the
 * research-based day rather than reusing the text-poster layout.
 */

'use strict';

const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

const CANVAS = { width: 1080, height: 1350 };

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrapText(text, fontSize, maxWidth, maxLines = 8) {
  const avgCharWidth = fontSize * 0.55;
  const maxChars = Math.max(6, Math.floor(maxWidth / avgCharWidth));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) { lines.push(current); current = word; }
    else current = candidate;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function textBlock(x, y, width, lines, { fontSize, fontFamily, fontWeight = 600, fill, lineHeight, anchor = 'start' }) {
  const lh = lineHeight || fontSize * 1.25;
  const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${escapeXml(line)}</tspan>`).join('');
  return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" text-anchor="${anchor}">${tspans}</text>`;
}

// Deterministic pseudo-variation per day (not Math.random — outputs must be
// reproducible/downloadable, not different every render) so the 7 assets
// read as one system without looking identical.
function seedFor(day) { return ((day * 2654435761) % 2 ** 32) / 2 ** 32; }

function decorativeShapes(day, colours) {
  const s = seedFor(day);
  const accent = colours.accent?.[0] || colours.primary;
  const cx = 80 + s * 200, cy = 80 + ((s * 7) % 1) * 160;
  const r = 220 + s * 140;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" opacity="0.10"/>
    <circle cx="${CANVAS.width - 100}" cy="${CANVAS.height - 140}" r="${160 + (1 - s) * 120}" fill="${accent}" opacity="0.08"/>`;
}

function gradientBg(colours) {
  const bg = colours.background?.[0];
  if (bg) return { defs: '', rect: `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${bg}"/>` };
  const primary = colours.primary || '#111827';
  const secondary = colours.secondary?.[0] || primary;
  return {
    defs: `<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient>`,
    rect: `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="url(#bg)"/>`,
  };
}

function dayPill(day, objective, colours, fonts) {
  const accent = colours.accent?.[0] || colours.primary;
  const label = `DAY ${day} — ${(objective || '').toUpperCase()}`;
  const w = Math.min(880, 60 + label.length * 13);
  return `<rect x="72" y="64" width="${w}" height="52" rx="26" fill="${accent}" opacity="0.92"/>
    <text x="${72 + w / 2}" y="98" font-family="${fonts.body}" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${escapeXml(label)}</text>`;
}

/** Standard text-poster layout: headline + copy + CTA, optional photo. */
function renderStandard(post, brand, colours, fonts, photoDataUri) {
  const { width, height } = CANVAS;
  const textColour = colours.text?.[0] || '#ffffff';
  const headingLines = wrapText(post.slide_headline, 76, width - 144, 5);
  const copyLines = post.slide_copy ? wrapText(post.slide_copy, 34, width - 144, 5) : [];

  let defsExtra = '', photoLayer = '', overlay = '';
  const usePhoto = post.uses_user_photo && photoDataUri;
  let textStartY;

  if (usePhoto) {
    const photoH = Math.round(height * 0.58);
    defsExtra = `<clipPath id="photoClip"><rect x="0" y="0" width="${width}" height="${photoH}"/></clipPath>
      <linearGradient id="photoFade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="55%" stop-color="${colours.background?.[0] || colours.primary || '#111827'}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${colours.background?.[0] || colours.primary || '#111827'}" stop-opacity="1"/>
      </linearGradient>`;
    photoLayer = `<g clip-path="url(#photoClip)"><image href="${photoDataUri}" x="0" y="0" width="${width}" height="${photoH}" preserveAspectRatio="xMidYMid slice"/>
      <rect x="0" y="0" width="${width}" height="${photoH}" fill="url(#photoFade)"/></g>`;
    textStartY = photoH + 90;
  } else {
    textStartY = Math.round(height * 0.40);
  }

  const bg = gradientBg(colours);
  const decorative = usePhoto ? '' : decorativeShapes(post.day, colours);

  let y = textStartY;
  const heading = textBlock(72, y, width - 144, headingLines, { fontSize: 76, fontFamily: fonts.heading, fontWeight: 800, fill: textColour, lineHeight: 84 });
  y += headingLines.length * 84 + 36;

  let copy = '';
  if (copyLines.length) {
    copy = textBlock(72, y, width - 144, copyLines, { fontSize: 34, fontFamily: fonts.body, fontWeight: 500, fill: textColour, lineHeight: 44 });
    y += copyLines.length * 44 + 40;
  }

  let ctaTag = '';
  if (post.cta) {
    const ctaY = height - 96;
    const accent = colours.accent?.[0] || colours.primary;
    const label = post.cta.toUpperCase();
    const w = Math.min(width - 144, 60 + label.length * 16);
    ctaTag = `<rect x="72" y="${ctaY - 44}" width="${w}" height="60" rx="30" fill="${accent}"/>
      <text x="${72 + w / 2}" y="${ctaY - 5}" font-family="${fonts.body}" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(label)}</text>`;
  }

  return `<defs>${bg.defs}${defsExtra}</defs>
    ${bg.rect}
    ${decorative}
    ${photoLayer}
    ${usePhoto ? '' : dayPill(post.day, post.objective, colours, fonts)}
    ${heading}
    ${copy}
    ${ctaTag}`;
}

/** Infographic layout: numbered rows, distinct from the text-poster format. */
function renderInfographic(post, brand, colours, fonts) {
  const { width, height } = CANVAS;
  const textColour = colours.text?.[0] || '#ffffff';
  const accent = colours.accent?.[0] || colours.primary;

  // slide_copy is expected as newline/bullet-separated findings; fall back
  // to splitting research_basis into sentences if slide_copy is a single blob.
  let rows = String(post.slide_copy || '')
    .split(/\n+|•|- (?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
  if (rows.length < 2 && post.research_basis) {
    rows = post.research_basis.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  }
  rows = rows.slice(0, 5);

  const bg = gradientBg(colours);
  const headingLines = wrapText(post.slide_headline, 62, width - 144, 3);

  let y = 260;
  const heading = textBlock(72, y, width - 144, headingLines, { fontSize: 62, fontFamily: fonts.heading, fontWeight: 800, fill: textColour, lineHeight: 70 });
  y += headingLines.length * 70 + 64;

  const rowBlocks = rows.map((row, i) => {
    const cy = y;
    const lines = wrapText(row, 32, width - 260, 3);
    const block = `<circle cx="112" cy="${cy - 12}" r="34" fill="${accent}"/>
      <text x="112" y="${cy - 1}" font-family="${fonts.heading}" font-size="30" font-weight="800" fill="#ffffff" text-anchor="middle">${i + 1}</text>
      ${textBlock(168, cy, width - 260, lines, { fontSize: 32, fontFamily: fonts.body, fontWeight: 600, fill: textColour, lineHeight: 40 })}`;
    y += Math.max(76, lines.length * 40 + 40);
    return block;
  }).join('\n');

  const footer = `<text x="72" y="${height - 64}" font-family="${fonts.body}" font-size="24" font-weight="600" fill="${textColour}" opacity="0.7">${escapeXml(post.cta || '')}</text>`;

  return `<defs>${bg.defs}</defs>
    ${bg.rect}
    ${decorativeShapes(post.day, colours)}
    ${dayPill(post.day, post.objective, colours, fonts)}
    ${heading}
    ${rowBlocks}
    ${footer}`;
}

function buildSvg(post, brand, photoDataUri) {
  const colours = {
    primary: brand?.primary_colour || '#111827',
    secondary: brand?.secondary_colours?.length ? brand.secondary_colours : [brand?.primary_colour || '#111827'],
    accent: brand?.accent_colours?.length ? brand.accent_colours : ['#EC4899'],
    background: brand?.background_colours || [],
    text: brand?.text_colours?.length ? brand.text_colours : ['#ffffff'],
  };
  const fonts = {
    heading: (brand?.fonts_detected?.[0]) ? `'${brand.fonts_detected[0]}', Georgia, serif` : `Georgia, 'Times New Roman', serif`,
    body: 'Arial, Helvetica, sans-serif',
  };

  const isInfographic = /infographic/i.test(post.format || '') || post.objective === 'Infographic';
  const inner = isInfographic ? renderInfographic(post, brand, colours, fonts) : renderStandard(post, brand, colours, fonts, photoDataUri);

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>`;
}

async function uploadHostedAsset(svg, day) {
  if (!isR2Configured()) return null;
  try {
    return await uploadToR2(`nancy-posts/${Date.now()}-day${day}-${Math.random().toString(36).slice(2, 8)}.svg`, Buffer.from(svg, 'utf8'), 'image/svg+xml');
  } catch (err) {
    console.warn('[nancy-render-week] R2 upload failed:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { posts, brand = {}, userPhotos = [] } = req.body || {};
  if (!Array.isArray(posts) || !posts.length) return res.status(400).json({ error: 'posts array is required' });
  if (posts.length > 7) return res.status(400).json({ error: 'A content week is at most 7 posts' });

  const assets = [];
  for (const post of posts) {
    const photoDataUri = post.uses_user_photo && userPhotos.length ? userPhotos[(post.day - 1) % userPhotos.length]?.dataUri : null;
    const svg = buildSvg(post, brand, photoDataUri);
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    const hostedUrl = await uploadHostedAsset(svg, post.day);
    assets.push({ day: post.day, svg, dataUri, hostedUrl, width: CANVAS.width, height: CANVAS.height });
  }

  return res.json({ success: true, assets });
};
