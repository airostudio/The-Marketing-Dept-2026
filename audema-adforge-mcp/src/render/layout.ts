import { randomUUID } from 'node:crypto';
import { PLATFORM_SIZES } from '../types.js';
import type { AdConcept, BrandProfile, LayoutSpec, PlatformSizeKey, TextBlockSchema } from '../types.js';
import type { z } from 'zod';

type TextBlock = z.infer<typeof TextBlockSchema>;

/**
 * Computes a concrete, pixel-precise layout for a concept at a given
 * platform size. This is genuinely deterministic — safe zones, font sizes,
 * and stacking order are derived from the platform's real dimensions and
 * the amount of copy in the concept, not guessed.
 */
export function generateLayoutSpec(
  concept: AdConcept,
  platformSize: PlatformSizeKey,
  brand: BrandProfile | undefined
): LayoutSpec {
  const { width, height } = PLATFORM_SIZES[platformSize];

  // Safe zone: keep text off the extreme edges, and give Stories/Reels extra
  // top/bottom margin so captions and UI chrome (native app overlays) never
  // clip the creative.
  const isVertical = platformSize === 'story' || platformSize === 'portrait';
  const marginX = Math.round(width * 0.08);
  const marginTop = Math.round(height * (platformSize === 'story' ? 0.14 : 0.08));
  const marginBottom = Math.round(height * (platformSize === 'story' ? 0.16 : 0.1));

  const safeZone = { top: marginTop, right: marginX, bottom: marginBottom, left: marginX };
  const contentWidth = width - marginX * 2;

  // Font sizing scales off width so the same concept looks proportionate
  // across formats — landscape gets smaller relative text since it's wider
  // and typically has more supporting copy (link ad placements).
  const baseScale = width / 1080;
  const headlineSize = Math.round((platformSize === 'landscape' ? 56 : 72) * baseScale);
  const subheadlineSize = Math.round(32 * baseScale);
  const ctaSize = Math.round(30 * baseScale);
  const smallSize = Math.round(24 * baseScale);

  const colours = brand?.colours;
  const textColor = colours?.text || '#FFFFFF';
  const ctaColor = colours?.accent || colours?.primary || '#FFFFFF';

  const textBlocks: TextBlock[] = [];

  // Stack: headline near top-third, subheadline below, CTA anchored near
  // bottom safe zone (thumb-reachable on mobile, and standard ad-button
  // position). Proof/urgency lines sit as a small strip just above the CTA.
  let cursorY = isVertical ? Math.round(height * 0.34) : Math.round(height * 0.28);

  textBlocks.push({
    role: 'headline',
    x: marginX,
    y: cursorY,
    width: contentWidth,
    fontSize: headlineSize,
    fontWeight: 800,
    lineHeight: headlineSize * 1.15,
    align: 'left',
    color: textColor,
  });
  cursorY += Math.round(headlineSize * 1.15 * 2 + 24 * baseScale);

  textBlocks.push({
    role: 'subheadline',
    x: marginX,
    y: cursorY,
    width: contentWidth,
    fontSize: subheadlineSize,
    fontWeight: 500,
    lineHeight: subheadlineSize * 1.3,
    align: 'left',
    color: textColor,
  });
  cursorY += Math.round(subheadlineSize * 1.3 * 2 + 16 * baseScale);

  if (concept.proofPoint) {
    textBlocks.push({
      role: 'proofPoint',
      x: marginX,
      y: cursorY,
      width: contentWidth,
      fontSize: smallSize,
      fontWeight: 600,
      lineHeight: smallSize * 1.3,
      align: 'left',
      color: textColor,
    });
    cursorY += Math.round(smallSize * 1.3 + 12 * baseScale);
  }

  if (concept.urgencyLine) {
    textBlocks.push({
      role: 'urgencyLine',
      x: marginX,
      y: cursorY,
      width: contentWidth,
      fontSize: smallSize,
      fontWeight: 700,
      lineHeight: smallSize * 1.3,
      align: 'left',
      color: ctaColor,
    });
    cursorY += Math.round(smallSize * 1.3 + 16 * baseScale);
  }

  // CTA anchored at the bottom safe zone, not wherever the copy above happens
  // to end, so it never collides with preceding text on copy-heavy concepts.
  const ctaY = height - safeZone.bottom - ctaSize;
  textBlocks.push({
    role: 'cta',
    x: marginX,
    y: Math.max(ctaY, cursorY + 20 * baseScale),
    width: contentWidth,
    fontSize: ctaSize,
    fontWeight: 700,
    lineHeight: ctaSize * 1.2,
    align: 'left',
    color: ctaColor,
  });

  const notes: string[] = [];
  if (isVertical) notes.push('Vertical format: keep the primary subject/face in the top 60% — platform UI (profile, caption, share icons) typically overlays the bottom 20%.');
  if (platformSize === 'landscape') notes.push('Landscape link-ad format: this size is frequently cropped to a smaller thumbnail in feed — keep headline legible at 300px wide.');
  notes.push(`Background style should reflect the concept's visual direction: "${concept.visualDirection}".`);
  if (brand?.logoPath) notes.push('Logo will be placed in the top-left safe zone at a fixed max size — do not let headline text overlap it.');

  const logoPlacement = brand?.logoPath
    ? { x: marginX, y: Math.round(marginTop * 0.3), maxWidth: Math.round(width * 0.18), maxHeight: Math.round(height * 0.06) }
    : undefined;

  return {
    id: randomUUID(),
    conceptId: concept.id!,
    platformSize,
    width,
    height,
    safeZone,
    backgroundStyle: 'gradient',
    textBlocks,
    logoPlacement,
    notes,
    createdAt: new Date().toISOString(),
  };
}
