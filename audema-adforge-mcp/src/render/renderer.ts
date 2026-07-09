import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { AdConcept, BrandProfile, LayoutSpec } from '../types.js';
import { buildAdSvg } from './svgTemplate.js';

export interface RenderResult {
  filePath: string;
  format: 'png' | 'jpg';
  width: number;
  height: number;
}

/**
 * Rasterizes a concept + layout to a PNG or JPG file on disk. If the brand
 * profile has a logoPath, it's composited into the reserved logo-safe area
 * computed by generateLayoutSpec. If backgroundImagePath is provided (e.g.
 * from an AI image provider or a supplied photo), it's used as the base
 * layer instead of the flat/gradient background.
 */
export async function renderAd(
  concept: AdConcept,
  layout: LayoutSpec,
  brand: BrandProfile | undefined,
  outputDir: string,
  format: 'png' | 'jpg',
  backgroundImagePath?: string
): Promise<RenderResult> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const svg = buildAdSvg(concept, layout, brand);
  const svgBuffer = Buffer.from(svg);

  let composite = sharp(svgBuffer);

  if (backgroundImagePath && existsSync(backgroundImagePath)) {
    // Layer the SVG (background + text) over a real photo: resize/cover the
    // photo to the canvas, then composite the SVG on top with its solid
    // background layer made transparent isn't supported cheaply in pure SVG,
    // so in image-background mode we skip the SVG's own background rect and
    // rely on a duplicated text-only SVG instead.
    const bg = await sharp(backgroundImagePath)
      .resize(layout.width, layout.height, { fit: 'cover' })
      .toBuffer();

    const textOnlySvg = svg.replace(/<rect width="\d+" height="\d+"[^/]*\/>/, '').replace(/<defs>[\s\S]*?<\/defs>/, '');
    composite = sharp(bg).composite([{ input: Buffer.from(textOnlySvg) }]);
  }

  const compositeInputs: sharp.OverlayOptions[] = [];

  if (layout.logoPlacement && brand?.logoPath && existsSync(brand.logoPath)) {
    const logoBuffer = await sharp(brand.logoPath)
      .resize(layout.logoPlacement.maxWidth, layout.logoPlacement.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();
    compositeInputs.push({ input: logoBuffer, left: layout.logoPlacement.x, top: layout.logoPlacement.y });
  }

  if (compositeInputs.length) {
    composite = composite.composite(compositeInputs);
  }

  const fileName = `${sanitizeFileName(concept.conceptName)}-${layout.platformSize}.${format}`;
  const filePath = path.join(outputDir, fileName);

  if (format === 'png') {
    await composite.png({ quality: 92 }).toFile(filePath);
  } else {
    await composite.flatten({ background: brand?.colours.background || '#000000' }).jpeg({ quality: 90 }).toFile(filePath);
  }

  return { filePath, format, width: layout.width, height: layout.height };
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ad-concept';
}
