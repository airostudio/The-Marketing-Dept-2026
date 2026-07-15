import type { AdConcept, BrandProfile, LayoutSpec } from '../types.js';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wraps a line of text onto multiple <tspan> lines so long headlines don't
 * run off the canvas. Wrapping is approximate (character-width heuristic)
 * since we don't have real font metrics without loading the font file —
 * good enough for ad-copy-length text at these font sizes.
 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.max(6, Math.floor(maxWidth / avgCharWidth));
  const words = text.split(/\s+/);
  const lines: string[] = [];
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

function textFor(role: string, concept: AdConcept): string | undefined {
  switch (role) {
    case 'headline': return concept.headline;
    case 'subheadline': return concept.subheadline;
    case 'cta': return concept.cta;
    case 'proofPoint': return concept.proofPoint;
    case 'urgencyLine': return concept.urgencyLine;
    default: return undefined;
  }
}

function backgroundSvg(layout: LayoutSpec, brand: BrandProfile | undefined): string {
  const primary = brand?.colours.primary || '#7C3AED';
  const secondary = brand?.colours.secondary || brand?.colours.primary || '#EC4899';
  const bg = brand?.colours.background;

  if (bg) {
    return `<rect width="${layout.width}" height="${layout.height}" fill="${bg}" />`;
  }

  return `
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${primary}" />
        <stop offset="100%" stop-color="${secondary}" />
      </linearGradient>
    </defs>
    <rect width="${layout.width}" height="${layout.height}" fill="url(#bgGrad)" />
  `;
}

/**
 * Builds a complete SVG document for one concept + layout combination.
 * This SVG is rasterized to PNG/JPG by the renderer using Sharp.
 */
export function buildAdSvg(concept: AdConcept, layout: LayoutSpec, brand: BrandProfile | undefined): string {
  const headingFont = brand?.fonts.heading || 'Arial, Helvetica, sans-serif';
  const bodyFont = brand?.fonts.body || headingFont;

  const textElements = layout.textBlocks
    .map((block) => {
      const raw = textFor(block.role, concept);
      if (!raw) return '';

      const font = block.role === 'headline' ? headingFont : bodyFont;
      const lines = wrapText(raw, block.fontSize, block.width);
      const tspans = lines
        .map((line, i) => `<tspan x="${block.x}" dy="${i === 0 ? 0 : block.lineHeight}">${escapeXml(line)}</tspan>`)
        .join('');

      const decoration = block.role === 'cta'
        ? `<rect x="${block.x - 20}" y="${block.y - block.fontSize * 0.9}" width="${Math.min(block.width, estimateTextWidth(lines[0] || '', block.fontSize) + 40)}" height="${block.fontSize * 1.8}" rx="8" fill="${block.color}" opacity="0.15" />`
        : '';

      return `
        ${decoration}
        <text x="${block.x}" y="${block.y}" font-family="${font}" font-size="${block.fontSize}" font-weight="${block.fontWeight}" fill="${block.color}" text-anchor="${block.align === 'center' ? 'middle' : block.align === 'right' ? 'end' : 'start'}">${tspans}</text>
      `;
    })
    .join('\n');

  const safeZoneGuides = ''; // intentionally omitted from production render; see notes in LayoutSpec

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">
  ${backgroundSvg(layout, brand)}
  ${safeZoneGuides}
  ${textElements}
</svg>`;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}
