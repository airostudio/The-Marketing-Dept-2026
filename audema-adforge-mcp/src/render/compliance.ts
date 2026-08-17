/**
 * Structural brand-compliance checks (Smartly.io/Celtra-style DCO guardrails)
 * — deterministic, template/rules-based validation, not visual ML. Runs
 * against the already-computed LayoutSpec, so it sees exactly what will be
 * rendered: real pixel positions, real colours, real text.
 */

import type { AdConcept, BrandProfile, LayoutSpec } from '../types.js';

export interface ComplianceIssue {
  type: 'logo_overlap' | 'low_contrast' | 'forbidden_phrase';
  severity: 'warning' | 'error';
  message: string;
}

interface Rect { x: number; y: number; width: number; height: number }

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Text blocks don't carry an explicit height, so approximate it from font metrics — conservative (slightly generous) on purpose, since a false "overlap" warning is far cheaper than a missed one. */
function textBlockRect(block: LayoutSpec['textBlocks'][number]): Rect {
  const approxHeight = block.lineHeight * 1.2;
  return { x: block.x, y: block.y - block.fontSize, width: block.width, height: approxHeight };
}

export function checkLogoOverlap(layout: LayoutSpec): ComplianceIssue[] {
  if (!layout.logoPlacement) return [];
  const logoRect: Rect = { x: layout.logoPlacement.x, y: layout.logoPlacement.y, width: layout.logoPlacement.maxWidth, height: layout.logoPlacement.maxHeight };

  const issues: ComplianceIssue[] = [];
  for (const block of layout.textBlocks) {
    if (rectsOverlap(textBlockRect(block), logoRect)) {
      issues.push({
        type: 'logo_overlap',
        severity: 'error',
        message: `The "${block.role}" text block overlaps the logo's reserved safe zone — the logo will be obscured or the text will be.`,
      });
    }
  }
  return issues;
}

// ── WCAG contrast ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two hex colours. Returns null if either colour is unparseable (never guesses). */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return null;

  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA: large text (≥24px, or ≥18.66px bold) needs 3:1; everything else needs 4.5:1. */
function isLargeText(fontSize: number, fontWeight: number): boolean {
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}

export function checkTextContrast(layout: LayoutSpec, brand: BrandProfile | undefined): ComplianceIssue[] {
  const colours = brand?.colours;
  // Check against every plausible background the render could actually use —
  // a solid background if set, otherwise BOTH gradient endpoints (the text
  // sits over a diagonal gradient, so either end must be legible).
  const backgrounds = colours?.background
    ? [colours.background]
    : [colours?.primary || '#7C3AED', colours?.secondary || colours?.primary || '#EC4899'];

  const issues: ComplianceIssue[] = [];
  for (const block of layout.textBlocks) {
    const large = isLargeText(block.fontSize, block.fontWeight);
    const threshold = large ? 3 : 4.5;

    for (const bg of backgrounds) {
      const ratio = contrastRatio(block.color, bg);
      if (ratio === null) continue; // unparseable colour — not this check's job to validate hex format
      if (ratio < threshold) {
        issues.push({
          type: 'low_contrast',
          severity: 'warning',
          message: `The "${block.role}" text (${block.color} on ${bg}) has a contrast ratio of ${ratio.toFixed(2)}:1 — below the WCAG AA minimum of ${threshold}:1 for ${large ? 'large' : 'normal'} text. May be hard to read, especially on mobile.`,
        });
      }
    }
  }
  return issues;
}

export function checkForbiddenPhrases(concept: AdConcept, brand: BrandProfile | undefined): ComplianceIssue[] {
  const forbidden = brand?.forbiddenPhrases ?? [];
  if (!forbidden.length) return [];

  const text = [concept.headline, concept.subheadline, concept.cta, concept.proofPoint, concept.urgencyLine].filter(Boolean).join(' ').toLowerCase();
  const issues: ComplianceIssue[] = [];
  for (const phrase of forbidden) {
    if (phrase && text.includes(phrase.toLowerCase())) {
      issues.push({ type: 'forbidden_phrase', severity: 'error', message: `Copy contains the brand-forbidden phrase "${phrase}".` });
    }
  }
  return issues;
}

export function checkBrandCompliance(concept: AdConcept, layout: LayoutSpec, brand: BrandProfile | undefined): ComplianceIssue[] {
  return [
    ...checkLogoOverlap(layout),
    ...checkTextContrast(layout, brand),
    ...checkForbiddenPhrases(concept, brand),
  ];
}
