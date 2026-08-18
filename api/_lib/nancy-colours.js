/**
 * api/_lib/nancy-colours.js — extracts candidate brand colours from raw
 * HTML/CSS, prioritising colours that look intentionally used as brand
 * colours (CSS custom properties, buttons, headings, links) over incidental
 * ones. Hand-rolled regex extraction — no CSS parser dependency, consistent
 * with this codebase's zero-npm-dependency api/ convention.
 */

'use strict';

const HEX_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+)?\s*\)/gi;

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
}

function normalizeHex(hex) {
  let h = hex.toLowerCase();
  if (h.length === 4) h = '#' + [...h.slice(1)].map(c => c + c).join('');
  return h;
}

// Near-white/near-black/greys are almost never the *intentional* brand
// colour — they're backgrounds/text defaults. Down-weight rather than
// exclude entirely, since a genuinely black/white brand does exist.
function isNeutral(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation < 0.12; // low-saturation = greyscale-ish
}

/**
 * Weighted extraction: CSS custom properties (--primary/--accent/etc.) and
 * colours inside button/CTA/heading/link selector blocks score highest;
 * colours found anywhere else in the stylesheet score lowest.
 */
function extractColours(html) {
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const inlineStyles = [...html.matchAll(/style=["']([^"']+)["']/gi)].map(m => m[1]).join('\n');
  const allCss = styleBlocks + '\n' + inlineStyles;

  const scores = new Map(); // hex -> score

  const bump = (hex, weight) => {
    const h = normalizeHex(hex);
    scores.set(h, (scores.get(h) || 0) + (isNeutral(h) ? weight * 0.15 : weight));
  };

  const collectFrom = (text, weight) => {
    for (const m of text.matchAll(HEX_RE)) bump(m[0], weight);
    for (const m of text.matchAll(RGB_RE)) bump(rgbToHex(m[1], m[2], m[3]), weight);
  };

  // 1. CSS custom properties naming intent explicitly — highest signal.
  const varRe = /--(?:primary|secondary|accent|brand|theme|button|cta|highlight)[a-z0-9_-]*\s*:\s*([^;]+);/gi;
  for (const m of allCss.matchAll(varRe)) collectFrom(m[1], 10);

  // 2. Rules scoped to button/CTA/heading/link selectors.
  const scopedRe = /(?:\.btn|\.button|\.cta|button|a\s*\{|h1|h2|\.hero)[^{}]*\{([^}]+)\}/gi;
  for (const m of allCss.matchAll(scopedRe)) collectFrom(m[1], 5);

  // 3. Everything else in the stylesheet.
  collectFrom(allCss, 1);

  // 4. Body-text hex/rgb literals not inside <style>/inline (rare but happens
  //    with some site builders that inline colour via data attributes).
  const bodyOnly = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  collectFrom(bodyOnly, 0.5);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);

  return {
    primary: ranked[0] || null,
    secondary: ranked.slice(1, 3),
    accent: ranked.slice(3, 5),
    allCandidates: ranked.slice(0, 12),
  };
}

/** Detects font-family declarations, for a Google Fonts fallback suggestion. */
function extractFontHints(html) {
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const linkFonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi)].map(m => decodeURIComponent(m[1]).split(':')[0].replace(/\+/g, ' '));
  const familyRules = [...styleBlocks.matchAll(/font-family\s*:\s*([^;]+);/gi)].map(m => m[1].replace(/["']/g, '').split(',')[0].trim());
  const seen = new Set();
  const all = [...linkFonts, ...familyRules].filter(f => {
    const key = f.toLowerCase();
    if (!f || seen.has(key) || /system-ui|sans-serif|serif|monospace|inherit/i.test(f)) return false;
    seen.add(key);
    return true;
  });
  return all.slice(0, 6);
}

module.exports = { extractColours, extractFontHints };
