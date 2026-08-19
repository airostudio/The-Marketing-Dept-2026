/**
 * api/nancy-render-week.js — Nancy Agent 7 + Rendering Engine
 *
 * POST {
 *   post: {...one post concept from nancy-content-plan...},
 *   brand: { primary_colour, secondary_colours, accent_colours, background_colours,
 *            text_colours, heading_style, body_style, fonts_detected },
 *   businessName: string,
 *   userPhotos?: [{ dataUri: string }],   // uploaded photos, matched by index
 * }
 * Returns: { success, asset: { day, format: 'ai'|'svg', dataUri, hostedUrl?, mimeType, width, height, svg? } }
 *
 * One post per call — image generation is a real external call (see
 * IMAGE_GEN_API_KEY below) and this function shares Vercel's 60s ceiling,
 * so it never chains more than one slow call per invocation. The client
 * calls this once per day, same pattern as nancy-content-plan.js.
 *
 * Primary path: a generated, on-brand, trending Instagram graphic from
 * api/_lib/nancy-providers.js#imageGenProvider — the prompt bakes in the
 * brand's exact colours plus the headline/copy/CTA text so the model
 * produces a real finished advertising-quality image, not a template.
 *
 * Honest fallback: when IMAGE_GEN_API_KEY isn't configured, or the
 * generation call fails/times out, this falls back to the deterministic,
 * zero-dependency SVG rendering engine below (same approach as
 * api/render-social-image.js) — seven genuinely distinct compositions, one
 * per content objective, so even the fallback never reads as a generic
 * template recoloured seven times.
 */

'use strict';

const { uploadToR2, isR2Configured } = require('./_lib/r2.js');
const { imageGenProvider } = require('./_lib/nancy-providers.js');

const CANVAS = { width: 1080, height: 1350 };
const MARGIN = 72;
const CONTENT_W = CANVAS.width - MARGIN * 2;

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

function textBlock(x, y, width, lines, { fontSize, fontFamily, fontWeight = 600, fill, lineHeight, anchor = 'start', letterSpacing }) {
  const lh = lineHeight || fontSize * 1.25;
  const ls = letterSpacing ? ` letter-spacing="${letterSpacing}"` : '';
  const tspans = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${escapeXml(line)}</tspan>`).join('');
  return `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" text-anchor="${anchor}"${ls}>${tspans}</text>`;
}

// Deterministic pseudo-variation per day (not Math.random — outputs must be
// reproducible/downloadable, not different every render) so templates that
// share a shape still feel individually placed, not stamped.
function seedFor(day) { return ((day * 2654435761) % 2 ** 32) / 2 ** 32; }

function gradientBg(colours, angle = 135) {
  const bg = colours.background?.[0];
  if (bg) return { defs: '', rect: `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${bg}"/>` };
  const primary = colours.primary || '#111827';
  const secondary = colours.secondary?.[0] || primary;
  const rad = (angle * Math.PI) / 180;
  const x2 = 50 + 50 * Math.cos(rad), y2 = 50 + 50 * Math.sin(rad);
  return {
    defs: `<linearGradient id="bg" x1="${50 - (x2 - 50)}%" y1="${50 - (y2 - 50)}%" x2="${x2}%" y2="${y2}%"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient>`,
    rect: `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="url(#bg)"/>`,
  };
}

function dotTexture(id, colour, opacity = 0.12) {
  return {
    defs: `<pattern id="${id}" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="3" fill="${colour}" opacity="${opacity}"/></pattern>`,
    rectFor: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`,
  };
}

function dayPill(day, objective, colours, fonts, { dark = false } = {}) {
  const accent = colours.accent?.[0] || colours.primary;
  const label = `DAY ${day} — ${(objective || '').toUpperCase()}`;
  const w = Math.min(880, 60 + label.length * 13);
  const fill = dark ? '#111827' : accent;
  return `<rect x="${MARGIN}" y="64" width="${w}" height="52" rx="26" fill="${fill}" opacity="0.94"/>
    <text x="${MARGIN + w / 2}" y="98" font-family="${fonts.body}" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${escapeXml(label)}</text>`;
}

function ctaButton(x, y, cta, colours, fonts, { fill, textFill = '#ffffff', size = 'md' } = {}) {
  if (!cta) return '';
  const label = cta.toUpperCase();
  const fontSize = size === 'lg' ? 32 : 26;
  const padY = size === 'lg' ? 30 : 20;
  const h = fontSize + padY * 2 - 10;
  const w = Math.min(CONTENT_W, 70 + label.length * (fontSize * 0.62));
  const bg = fill || colours.accent?.[0] || colours.primary;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.35}" font-family="${fonts.body}" font-size="${fontSize}" font-weight="800" fill="${textFill}" text-anchor="middle" letter-spacing="0.5">${escapeXml(label)}</text>`;
}

function quoteGlyph(x, y, size, colour, opacity = 0.16) {
  // A simple, unmistakable open-quote mark — two rounded comma shapes.
  return `<g transform="translate(${x},${y})" opacity="${opacity}">
    <path d="M0,0 C0,${size * 0.6} -${size * 0.15},${size} -${size * 0.5},${size * 1.15} L-${size * 0.62},${size * 0.95} C-${size * 0.32},${size * 0.8} -${size * 0.2},${size * 0.5} -${size * 0.22},${size * 0.05} Z" fill="${colour}"/>
    <path d="M${size * 0.55},0 C${size * 0.55},${size * 0.6} ${size * 0.4},${size} ${size * 0.05},${size * 1.15} L-${size * 0.07},${size * 0.95} C${size * 0.23},${size * 0.8} ${size * 0.35},${size * 0.5} ${size * 0.33},${size * 0.05} Z" fill="${colour}"/>
  </g>`;
}

function checkGlyph(cx, cy, r, colour) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}"/>
    <path d="M${cx - r * 0.5},${cy} L${cx - r * 0.12},${cy + r * 0.4} L${cx + r * 0.5},${cy - r * 0.38}" fill="none" stroke="#ffffff" stroke-width="${Math.max(3, r * 0.22)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 1 — Authority: editorial pull-quote
// ─────────────────────────────────────────────────────────────────────────
function renderAuthority(post, colours, fonts, businessName) {
  const { width, height } = CANVAS;
  const textColour = colours.text?.[0] || '#ffffff';
  const accent = colours.accent?.[0] || colours.primary;
  const bg = gradientBg(colours, 145);

  const headingLines = wrapText(post.slide_headline, 68, CONTENT_W, 6);
  const blockH = headingLines.length * 80;
  const startY = Math.round((height - blockH) / 2) + 20;

  const heading = textBlock(MARGIN, startY, CONTENT_W, headingLines, { fontSize: 68, fontFamily: fonts.heading, fontWeight: 700, fill: textColour, lineHeight: 80 });

  const ruleY = startY + blockH + 36;
  const attribution = businessName ? `${businessName}` : '';

  return `<defs>${bg.defs}</defs>
    ${bg.rect}
    ${quoteGlyph(MARGIN - 8, 150, 130, accent, 0.5)}
    ${dayPill(post.day, post.objective, colours, fonts)}
    ${heading}
    <rect x="${MARGIN}" y="${ruleY}" width="90" height="6" rx="3" fill="${accent}"/>
    ${attribution ? textBlock(MARGIN, ruleY + 52, CONTENT_W, [attribution.toUpperCase()], { fontSize: 22, fontFamily: fonts.body, fontWeight: 700, fill: textColour, letterSpacing: 2 }) : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 2 — Education: framework/step card
// ─────────────────────────────────────────────────────────────────────────
function renderFramework(post, colours, fonts) {
  const { width, height } = CANVAS;
  const accent = colours.accent?.[0] || colours.primary;
  const base = colours.background?.[0] || '#ffffff';
  const darkText = colours.primary || '#111827';
  const bannerH = 340;

  const headingLines = wrapText(post.slide_headline, 58, CONTENT_W, 4);
  const copyLines = post.slide_copy ? wrapText(post.slide_copy, 32, CONTENT_W - 40, 5) : [];

  const cardY = bannerH + 60;
  const maxCardH = height - cardY - 90;
  const copyBlockH = Math.max(copyLines.length, 1) * 42;
  const ctaY = cardY + 66 + copyBlockH + 30;
  // Card sized to its actual content (numbered badge + copy + CTA, with
  // generous padding) instead of stretched to fill the rest of the canvas —
  // a one-line supporting point shouldn't leave a half-empty card below it.
  const cardH = Math.min(maxCardH, Math.max(280, (post.cta ? ctaY + 74 : ctaY + 20) - cardY));

  return `<rect width="${width}" height="${height}" fill="${base}"/>
    <rect width="${width}" height="${bannerH}" fill="${accent}"/>
    ${dayPill(post.day, post.objective, { ...colours, accent: ['#111827'] }, fonts)}
    ${textBlock(MARGIN, 200, CONTENT_W, ['THE FRAMEWORK'], { fontSize: 22, fontFamily: fonts.body, fontWeight: 800, fill: '#ffffff', letterSpacing: 3 })}
    ${textBlock(MARGIN, 260, CONTENT_W, headingLines, { fontSize: 58, fontFamily: fonts.heading, fontWeight: 800, fill: '#ffffff', lineHeight: 66 })}
    <rect x="${MARGIN}" y="${cardY}" width="${CONTENT_W}" height="${cardH}" rx="24" fill="${darkText}" opacity="0.04"/>
    <rect x="${MARGIN}" y="${cardY}" width="${CONTENT_W}" height="${cardH}" rx="24" fill="none" stroke="${darkText}" stroke-opacity="0.14" stroke-width="2"/>
    <circle cx="${MARGIN + 56}" cy="${cardY + 56}" r="30" fill="${accent}"/>
    <text x="${MARGIN + 56}" y="${cardY + 65}" font-family="${fonts.heading}" font-size="26" font-weight="800" fill="#ffffff" text-anchor="middle">01</text>
    ${textBlock(MARGIN + 108, cardY + 66, CONTENT_W - 148, copyLines, { fontSize: 32, fontFamily: fonts.body, fontWeight: 500, fill: darkText, lineHeight: 42 })}
    ${post.cta ? ctaButton(MARGIN + 108, ctaY, post.cta, { accent: [accent] }, fonts) : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 3 — Founder/Personal: photo + speech-bubble caption
// ─────────────────────────────────────────────────────────────────────────
function renderFounder(post, colours, fonts, photoDataUri) {
  const { width, height } = CANVAS;
  const accent = colours.accent?.[0] || colours.primary;
  const base = colours.background?.[0] || colours.primary || '#111827';
  const textColour = colours.text?.[0] || '#ffffff';

  if (!photoDataUri) {
    // Honest fallback: no user photo was actually provided/permitted —
    // render as a warm, text-led "from the founder" card rather than
    // silently reusing the generic authority layout.
    const headingLines = wrapText(post.slide_headline, 60, CONTENT_W, 5);
    const copyLines = post.slide_copy ? wrapText(post.slide_copy, 30, CONTENT_W, 4) : [];
    const bg = gradientBg(colours, 200);
    return `<defs>${bg.defs}</defs>
      ${bg.rect}
      ${dayPill(post.day, post.objective, colours, fonts)}
      ${textBlock(MARGIN, 420, CONTENT_W, headingLines, { fontSize: 60, fontFamily: fonts.heading, fontWeight: 700, fill: textColour, lineHeight: 70 })}
      ${copyLines.length ? textBlock(MARGIN, 420 + headingLines.length * 70 + 40, CONTENT_W, copyLines, { fontSize: 30, fontFamily: fonts.body, fontWeight: 500, fill: textColour, lineHeight: 40 }) : ''}
      ${post.cta ? ctaButton(MARGIN, height - 150, post.cta, colours, fonts) : ''}`;
  }

  const photoH = Math.round(height * 0.58);
  const frameM = 28;
  const bubbleY = photoH - 46;
  const headingLines = wrapText(post.slide_headline, 42, CONTENT_W - 72, 4);
  const copyLines = post.slide_copy ? wrapText(post.slide_copy, 26, CONTENT_W - 72, 3) : [];

  // Bubble sized to its actual text (headline, optionally a copy line)
  // instead of stretched to fill the rest of the canvas below the photo.
  const headingBlockH = headingLines.length * 50;
  const copyBlockH = copyLines.length ? copyLines.length * 34 + 20 : 0;
  const bubbleH = Math.min(height - bubbleY - 70, 62 + headingBlockH + copyBlockH + 40);
  const copyY = bubbleY + 62 + headingBlockH + 20;

  return `<defs>
      <clipPath id="photoClip"><rect x="${frameM}" y="${frameM}" width="${width - frameM * 2}" height="${photoH - frameM}" rx="18"/></clipPath>
    </defs>
    <rect width="${width}" height="${height}" fill="${base}"/>
    <rect x="${frameM - 6}" y="${frameM - 6}" width="${width - (frameM - 6) * 2}" height="${photoH - frameM + 12}" rx="22" fill="none" stroke="${accent}" stroke-width="6" opacity="0.9"/>
    <g clip-path="url(#photoClip)"><image href="${photoDataUri}" x="${frameM}" y="${frameM}" width="${width - frameM * 2}" height="${photoH - frameM}" preserveAspectRatio="xMidYMid slice"/></g>
    ${dayPill(post.day, post.objective, colours, fonts)}
    <path d="M ${MARGIN + 40} ${bubbleY} L ${MARGIN + 10} ${bubbleY - 30} L ${MARGIN + 80} ${bubbleY} Z" fill="${accent}"/>
    <rect x="${MARGIN}" y="${bubbleY}" width="${CONTENT_W}" height="${bubbleH}" rx="22" fill="${accent}"/>
    ${textBlock(MARGIN + 36, bubbleY + 62, CONTENT_W - 72, headingLines, { fontSize: 42, fontFamily: fonts.heading, fontWeight: 700, fill: '#ffffff', lineHeight: 50 })}
    ${copyLines.length ? textBlock(MARGIN + 36, copyY, CONTENT_W - 72, copyLines, { fontSize: 26, fontFamily: fonts.body, fontWeight: 500, fill: '#ffffff', lineHeight: 34 }) : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 4 — Problem Awareness: bold mistake-alert callout
// ─────────────────────────────────────────────────────────────────────────
function renderMistakeAlert(post, colours, fonts) {
  const { width, height } = CANVAS;
  const dark = '#111827';
  const accent = colours.accent?.[0] || colours.primary || '#EC4899';
  const textColour = '#ffffff';
  const stripeW = 20;

  const headingLines = wrapText(post.slide_headline, 66, CONTENT_W - 30, 5);
  const copyLines = post.slide_copy ? wrapText(post.slide_copy, 30, CONTENT_W - 30, 4) : [];

  let y = 420;
  const heading = textBlock(MARGIN + 30, y, CONTENT_W - 30, headingLines, { fontSize: 66, fontFamily: fonts.heading, fontWeight: 800, fill: textColour, lineHeight: 76 });
  y += headingLines.length * 76 + 44;
  const copy = copyLines.length ? textBlock(MARGIN + 30, y, CONTENT_W - 30, copyLines, { fontSize: 30, fontFamily: fonts.body, fontWeight: 500, fill: textColour, lineHeight: 40 }) : '';

  return `<rect width="${width}" height="${height}" fill="${dark}"/>
    <rect x="0" y="0" width="${stripeW}" height="${height}" fill="${accent}"/>
    <rect x="${MARGIN + 30}" y="200" width="240" height="52" rx="26" fill="${accent}" opacity="0.16"/>
    <text x="${MARGIN + 30 + 120}" y="234" font-family="${fonts.body}" font-size="22" font-weight="800" fill="${accent}" text-anchor="middle" letter-spacing="1.5">COMMON MISTAKE</text>
    ${dayPill(post.day, post.objective, colours, fonts)}
    ${heading}
    ${copy}
    ${post.cta ? ctaButton(MARGIN + 30, height - 160, post.cta, colours, fonts) : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 5 — Infographic: real numbered process, not a text poster
// ─────────────────────────────────────────────────────────────────────────
function renderInfographic(post, colours, fonts) {
  const { width, height } = CANVAS;
  const textColour = colours.text?.[0] || '#ffffff';
  const accent = colours.accent?.[0] || colours.primary;

  let rows = String(post.slide_copy || '')
    .split(/\n+|•|- (?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
  if (rows.length < 2 && post.research_basis) {
    rows = post.research_basis.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
  }
  rows = rows.slice(0, 5);

  const bg = gradientBg(colours, 160);
  const headingLines = wrapText(post.slide_headline, 58, CONTENT_W, 3);

  let y = 340;
  const heading = textBlock(MARGIN, y, CONTENT_W, headingLines, { fontSize: 58, fontFamily: fonts.heading, fontWeight: 800, fill: textColour, lineHeight: 66 });
  y += headingLines.length * 66 + 56;

  const lineX = MARGIN + 40;
  const rowStartY = y - 8;

  const rowBlocks = rows.map((row, i) => {
    const cy = y;
    const lines = wrapText(row, 32, CONTENT_W - 120, 3);
    const block = `<circle cx="${lineX}" cy="${cy - 12}" r="34" fill="${accent}"/>
      <text x="${lineX}" y="${cy - 1}" font-family="${fonts.heading}" font-size="30" font-weight="800" fill="#ffffff" text-anchor="middle">${i + 1}</text>
      ${textBlock(lineX + 56, cy, CONTENT_W - 120, lines, { fontSize: 32, fontFamily: fonts.body, fontWeight: 600, fill: textColour, lineHeight: 40 })}`;
    y += Math.max(84, lines.length * 40 + 44);
    return block;
  }).join('\n');
  const rowEndY = y - 44;

  const connector = rows.length > 1 ? `<line x1="${lineX}" y1="${rowStartY + 22}" x2="${lineX}" y2="${rowEndY - 22}" stroke="${accent}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round" opacity="0.6"/>` : '';

  const eyebrow = `<rect x="${MARGIN}" y="196" width="260" height="46" rx="23" fill="${accent}" opacity="0.9"/>
    <text x="${MARGIN + 130}" y="226" font-family="${fonts.body}" font-size="18" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">RESEARCH INSIGHT</text>`;

  // Sits just under the last row, not pinned to the canvas bottom — a short
  // finding list (2-3 rows) shouldn't leave a slab of empty background
  // between the content and the CTA.
  const footerY = Math.min(y + 24, height - 64);
  const footer = post.cta ? textBlock(MARGIN, footerY, CONTENT_W, [post.cta], { fontSize: 24, fontFamily: fonts.body, fontWeight: 600, fill: textColour }) : '';

  return `<defs>${bg.defs}</defs>
    ${bg.rect}
    ${dayPill(post.day, post.objective, colours, fonts)}
    ${eyebrow}
    ${heading}
    ${connector}
    ${rowBlocks}
    ${footer}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 6 — Differentiation: "our approach" card with a check mark
// ─────────────────────────────────────────────────────────────────────────
function renderApproach(post, colours, fonts) {
  const { width, height } = CANVAS;
  const accent = colours.accent?.[0] || colours.primary;
  const base = colours.background?.[0] || colours.primary || '#111827';
  const textColour = colours.text?.[0] || '#ffffff';

  const headingLines = wrapText(post.slide_headline, 60, CONTENT_W - 60, 5);
  const copyLines = post.slide_copy ? wrapText(post.slide_copy, 30, CONTENT_W - 60, 4) : [];
  const cardY = 340;
  const maxCardH = height - cardY - 100;

  // Badge row (check + "OUR APPROACH") sits clearly above the heading, not
  // behind it — this used to overlap because the heading started only 56px
  // below the badge's own vertical centre.
  let y = cardY + 150;
  const heading = textBlock(MARGIN + 40, y, CONTENT_W - 80, headingLines, { fontSize: 60, fontFamily: fonts.heading, fontWeight: 700, fill: textColour, lineHeight: 68 });
  y += headingLines.length * 68 + 44;
  const copy = copyLines.length ? textBlock(MARGIN + 40, y, CONTENT_W - 80, copyLines, { fontSize: 28, fontFamily: fonts.body, fontWeight: 500, fill: textColour, lineHeight: 38 }) : '';
  if (copyLines.length) y += copyLines.length * 38;

  // Card sized to its actual content (with generous bottom padding), not
  // stretched to fill whatever space is left on the canvas — a short
  // headline + one copy line shouldn't leave a half-empty card.
  const cardH = Math.min(maxCardH, Math.max(320, y - cardY + 90));

  return `<rect width="${width}" height="${height}" fill="${base}"/>
    <rect x="${MARGIN}" y="${cardY}" width="${CONTENT_W}" height="${cardH}" rx="26" fill="#ffffff" opacity="0.06"/>
    <rect x="${MARGIN}" y="${cardY}" width="${CONTENT_W}" height="${cardH}" rx="26" fill="none" stroke="${accent}" stroke-width="2" opacity="0.5"/>
    ${dayPill(post.day, post.objective, colours, fonts)}
    ${checkGlyph(MARGIN + 40 + 34, cardY + 56, 34, accent)}
    <text x="${MARGIN + 40 + 90}" y="${cardY + 66}" font-family="${fonts.body}" font-size="22" font-weight="800" fill="${accent}" letter-spacing="1.5">OUR APPROACH</text>
    ${heading}
    ${copy}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template 7 — Conversion: large offer CTA
// ─────────────────────────────────────────────────────────────────────────
function renderConversion(post, colours, fonts) {
  const { width, height } = CANVAS;
  const accent = colours.accent?.[0] || colours.primary;
  const bg = gradientBg(colours, 200);
  const textColour = colours.text?.[0] || '#ffffff';

  const headingLines = wrapText(post.slide_headline, 72, CONTENT_W, 5);
  const copyLines = post.slide_copy ? wrapText(post.slide_copy, 30, CONTENT_W, 3) : [];

  // anchor:'middle' text-anchors each line around the given x — that x must
  // be the canvas centre (width/2), not the left margin, or every line
  // centres itself around a point 72px in from the edge and runs off-canvas.
  let y = 480;
  const eyebrowY = y - 120;
  const heading = textBlock(width / 2, y, CONTENT_W, headingLines, { fontSize: 72, fontFamily: fonts.heading, fontWeight: 800, fill: textColour, lineHeight: 80, anchor: 'middle' });
  y += headingLines.length * 80 + 36;
  const copy = copyLines.length ? textBlock(width / 2, y, CONTENT_W, copyLines, { fontSize: 30, fontFamily: fonts.body, fontWeight: 500, fill: textColour, lineHeight: 40, anchor: 'middle' }) : '';

  const btnY = height - 220;
  const label = (post.cta || 'LEARN MORE').toUpperCase();
  const btnW = Math.min(CONTENT_W, 90 + label.length * 22);
  const btnX = (width - btnW) / 2;
  const btnH = 96;

  return `<defs>${bg.defs}</defs>
    ${bg.rect}
    ${dayPill(post.day, post.objective, colours, fonts)}
    <text x="${width / 2}" y="${eyebrowY}" font-family="${fonts.body}" font-size="24" font-weight="800" fill="${accent}" text-anchor="middle" letter-spacing="3">${escapeXml((post.content_pillar || 'LIMITED SPOTS').toUpperCase())}</text>
    ${heading}
    ${copy}
    <rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH}" rx="${btnH / 2}" fill="${accent}"/>
    <text x="${width / 2}" y="${btnY + btnH / 2 + 12}" font-family="${fonts.body}" font-size="34" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="1">${escapeXml(label)}</text>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template selection
// ─────────────────────────────────────────────────────────────────────────
function pickTemplate(post) {
  const obj = (post.objective || '').toLowerCase();
  if (/infographic/.test(post.format || '') || obj.includes('infographic')) return 'infographic';
  if (obj.includes('authority')) return 'authority';
  if (obj.includes('education')) return 'framework';
  if (obj.includes('founder') || obj.includes('personal')) return 'founder';
  if (obj.includes('problem')) return 'mistake';
  if (obj.includes('differentiat')) return 'approach';
  if (obj.includes('conversion')) return 'conversion';
  return 'authority'; // sanest-looking default for anything unrecognized
}

function buildSvg(post, brand, photoDataUri, businessName) {
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

  const template = pickTemplate(post);
  let inner;
  switch (template) {
    case 'infographic': inner = renderInfographic(post, colours, fonts); break;
    case 'authority':   inner = renderAuthority(post, colours, fonts, businessName); break;
    case 'framework':    inner = renderFramework(post, colours, fonts); break;
    case 'founder':      inner = renderFounder(post, colours, fonts, post.uses_user_photo ? photoDataUri : null); break;
    case 'mistake':      inner = renderMistakeAlert(post, colours, fonts); break;
    case 'approach':     inner = renderApproach(post, colours, fonts); break;
    case 'conversion':   inner = renderConversion(post, colours, fonts); break;
    default:              inner = renderAuthority(post, colours, fonts, businessName);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" xmlns="http://www.w3.org/2000/svg">\n${inner}\n</svg>`;
}

async function uploadHostedAsset(buffer, mimeType, ext, day) {
  if (!isR2Configured()) return null;
  try {
    return await uploadToR2(`nancy-posts/${Date.now()}-day${day}-${Math.random().toString(36).slice(2, 8)}.${ext}`, buffer, mimeType);
  } catch (err) {
    console.warn('[nancy-render-week] R2 upload failed:', err.message);
    return null;
  }
}

function buildImagePrompt(post, colours, businessName, businessProfile = {}) {
  const palette = [colours.primary, ...(colours.secondary || []), ...(colours.accent || [])]
    .filter(Boolean).slice(0, 4).join(', ');

  // What this business actually is/does/sells — this is what makes the
  // background scene "correct" rather than a generic abstract backdrop.
  const category = businessProfile.business_category || businessProfile.industry || '';
  const offer = businessProfile.primary_offer || (businessProfile.products_services || []).slice(0, 3).join(', ');
  const summary = businessProfile.website_summary || '';
  const businessContext = [category && `Industry/category: ${category}.`, offer && `What they actually sell: ${offer}.`, summary]
    .filter(Boolean).join(' ');

  const parts = [
    `Design a premium, thumb-stopping Instagram feed post (portrait, roughly 4:5) for the business "${businessName || 'this brand'}".`,
    businessContext && `Business context — the background scene MUST be visually relevant to this, not a generic abstract backdrop: ${businessContext}`,
    // This is the core fix for "flat/empty background" feedback: demand a
    // real, specific, photographic or richly-illustrated scene tied to the
    // creative direction and business context, with the brand palette
    // applied as color grading/lighting/accents over that scene — not a
    // solid or gently-gradiented color field with text floating on it.
    `Background: a real, compelling, specific scene — think editorial photography or high-end illustration of an actual moment, object, environment, or result connected to this business (e.g. the product in use, the environment customers experience, a relevant real-world detail) — filling the full frame with depth, texture and visual interest. This is NOT a flat color, plain gradient, empty studio backdrop, or abstract shapes-only background.`,
    post.visual_direction && `Specific creative direction for this scene: ${post.visual_direction}`,
    `Style: current trending 2026 social-media advertising design — bold confident large-scale typography layered over the scene, cinematic lighting/depth, generous breathing room around the text for legibility, high-end premium-brand feel. Not a generic template, not clipart, not stock-photo cheese.`,
    `Apply this brand's colour palette as the dominant grading/lighting/accent treatment across the scene and in every UI element (buttons, badges, overlays): ${palette || colours.primary}. Neutral white/black/grey is fine for contrast and legibility — introduce no other colours outside this palette.`,
    `Content objective: ${post.objective || 'brand awareness'}.`,
    `Render this headline exactly, as the dominant large text element, spelled correctly: "${post.slide_headline || ''}"`,
  ].filter(Boolean);
  if (post.slide_copy) parts.push(`Render this supporting text smaller and legible, spelled correctly: "${post.slide_copy}"`);
  if (post.cta) parts.push(`Render this call-to-action as a bold styled button or label, spelled correctly: "${post.cta}"`);
  parts.push('No watermarks, no placeholder Lorem Ipsum text, no misspelled words, no illegible text — every word of text specified above must be rendered clearly and accurately.');
  return parts.join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { post, brand = {}, businessName = '', businessProfile = {}, userPhotos = [] } = req.body || {};
  if (!post || typeof post !== 'object') return res.status(400).json({ error: 'post is required' });

  const colours = {
    primary: brand?.primary_colour || '#111827',
    secondary: brand?.secondary_colours?.length ? brand.secondary_colours : [brand?.primary_colour || '#111827'],
    accent: brand?.accent_colours?.length ? brand.accent_colours : ['#EC4899'],
    background: brand?.background_colours || [],
    text: brand?.text_colours?.length ? brand.text_colours : ['#ffffff'],
  };

  // Primary path: a real generated image baking in the brand palette and
  // the post's exact copy. Never blocks on it forever — imageGenProvider
  // times out on its own and always resolves { available, ... }, so a slow
  // or failed generation still leaves room to fall back below rather than
  // failing the whole request.
  const gen = await imageGenProvider(buildImagePrompt(post, colours, businessName, businessProfile), { width: CANVAS.width, height: CANVAS.height });
  if (gen.available) {
    const hostedUrl = await uploadHostedAsset(gen.buffer, gen.mimeType, 'png', post.day);
    const dataUri = `data:${gen.mimeType};base64,${gen.buffer.toString('base64')}`;
    return res.json({
      success: true,
      asset: { day: post.day, format: 'ai', dataUri, hostedUrl, mimeType: gen.mimeType, width: CANVAS.width, height: CANVAS.height },
    });
  }

  // Fallback: deterministic SVG templates — still on-brand, still
  // objective-specific, costs nothing, never fails.
  const photoDataUri = post.uses_user_photo && userPhotos.length ? userPhotos[(post.day - 1) % userPhotos.length]?.dataUri : null;
  const svg = buildSvg(post, brand, photoDataUri, businessName);
  const svgBuffer = Buffer.from(svg, 'utf8');
  const dataUri = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
  const hostedUrl = await uploadHostedAsset(svgBuffer, 'image/svg+xml', 'svg', post.day);

  return res.json({
    success: true,
    asset: { day: post.day, format: 'svg', svg, dataUri, hostedUrl, mimeType: 'image/svg+xml', width: CANVAS.width, height: CANVAS.height, fallbackReason: gen.reason },
  });
};
