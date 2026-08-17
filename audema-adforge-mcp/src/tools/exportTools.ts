import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PlatformSizeSchema } from '../types.js';
import type { PlatformSizeKey } from '../types.js';
import { conceptStore, briefStore, brandStore, layoutStore, EXPORT_DIR } from '../storage/index.js';
import { generateLayoutSpec } from '../render/layout.js';
import { renderAd } from '../render/renderer.js';
import { generateBackgroundImage, isImageProviderConfigured, unavailableReason } from '../render/imageProvider.js';
import { checkBrandCompliance } from '../render/compliance.js';
import { uploadToR2, isR2Configured } from '../storage/r2.js';

const MIME_FOR_FORMAT: Record<'png' | 'jpg', string> = { png: 'image/png', jpg: 'image/jpeg' };

/**
 * Optionally pushes an already-exported local file to the SAME shared R2
 * bucket the main Audema web app uses (under an "adforge/" prefix), so
 * exported creative can be handed off to Pat/publish flows that need a
 * real hosted URL, not a local file path. Returns null (never throws) when
 * R2 isn't configured or the upload fails — this is additive, exporting to
 * disk always succeeds regardless.
 */
async function tryUploadExportToR2(filePath: string, format: 'png' | 'jpg'): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const buffer = readFileSync(filePath);
    return await uploadToR2(`adforge/${path.basename(filePath)}`, buffer, MIME_FOR_FORMAT[format]);
  } catch (err) {
    console.error('[export] R2 upload failed (local file still exported successfully):', err instanceof Error ? err.message : err);
    return null;
  }
}

export function registerExportTools(server: McpServer) {
  server.tool(
    'export_ad_image',
    'Render a concept to a production-ready PNG or JPG file on disk at the given platform size. Generates the layout automatically if one hasn\'t been created yet. Returns the file path, a hosted R2 URL if R2 is configured (useful for handing the creative off to a publish flow that needs a real fetchable URL, not a local path), and any brand-compliance warnings (logo overlap, low text contrast, forbidden phrases) — these never block the export, but are worth reading before shipping the file.',
    {
      conceptId: z.string(),
      platformSize: PlatformSizeSchema.optional().describe('Defaults to the concept\'s own platformSize field'),
      format: z.enum(['png', 'jpg']).default('png'),
      backgroundImagePath: z.string().optional().describe('Absolute path to a photo/illustration to use as the background instead of a brand-colour gradient'),
      backgroundPrompt: z.string().optional().describe('Describe a photo/illustration and have it generated via the configured AI image provider (ADFORGE_IMAGE_PROVIDER). Ignored if backgroundImagePath is given. Errors clearly if no provider is configured — never silently falls back to a flat background.'),
      outputDir: z.string().optional().describe('Defaults to ADFORGE_EXPORT_DIR env var / ./exports'),
    },
    async (args) => {
      const concept = conceptStore.get(args.conceptId);
      if (!concept) return { content: [{ type: 'text', text: `No concept found with id ${args.conceptId}.` }], isError: true };

      const brief = briefStore.get(concept.briefId);
      const brand = brief?.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;
      const size = (args.platformSize ?? concept.platformSize) as PlatformSizeKey;

      let layout = layoutStore.find((s) => s.conceptId === concept.id && s.platformSize === size)[0];
      if (!layout) {
        layout = generateLayoutSpec(concept, size, brand);
        layout = layoutStore.upsert(layout);
      }

      let backgroundImagePath = args.backgroundImagePath;
      if (!backgroundImagePath && args.backgroundPrompt) {
        if (!isImageProviderConfigured()) {
          return {
            content: [{ type: 'text', text: `Cannot generate a background image: ${unavailableReason()}` }],
            isError: true,
          };
        }
        try {
          backgroundImagePath = await generateBackgroundImage(args.backgroundPrompt, layout.width, layout.height);
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Background image generation failed: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      }

      try {
        const result = await renderAd(concept, layout, brand, args.outputDir ?? EXPORT_DIR, args.format, backgroundImagePath);
        let text = `Exported "${concept.conceptName}" (${size}, ${args.format.toUpperCase()}) → ${result.filePath} (${result.width}×${result.height}px)`;

        const hostedUrl = await tryUploadExportToR2(result.filePath, args.format);
        text += hostedUrl ? `\nHosted URL (R2): ${hostedUrl}` : (isR2Configured() ? '\nR2 upload failed — see server logs; local file is still valid.' : '');

        const issues = checkBrandCompliance(concept, layout, brand);
        if (issues.length) {
          text += `\n\n⚠️ ${issues.length} compliance issue(s) — export still succeeded, but review before shipping:\n` +
            issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n');
        }

        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Export failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'export_ad_image_all_sizes',
    'Render one concept to all four standard platform sizes (square, portrait, landscape, story) in one call, as PNG.',
    {
      conceptId: z.string(),
      format: z.enum(['png', 'jpg']).default('png'),
      outputDir: z.string().optional(),
    },
    async (args) => {
      const concept = conceptStore.get(args.conceptId);
      if (!concept) return { content: [{ type: 'text', text: `No concept found with id ${args.conceptId}.` }], isError: true };

      const brief = briefStore.get(concept.briefId);
      const brand = brief?.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;
      const sizes: PlatformSizeKey[] = ['square', 'portrait', 'landscape', 'story'];

      const results: string[] = [];
      for (const size of sizes) {
        let layout = layoutStore.find((s) => s.conceptId === concept.id && s.platformSize === size)[0];
        if (!layout) {
          layout = generateLayoutSpec(concept, size, brand);
          layout = layoutStore.upsert(layout);
        }
        try {
          const result = await renderAd(concept, layout, brand, args.outputDir ?? EXPORT_DIR, args.format);
          const hostedUrl = await tryUploadExportToR2(result.filePath, args.format);
          results.push(`✓ ${size}: ${result.filePath}${hostedUrl ? ` (hosted: ${hostedUrl})` : ''}`);
        } catch (err) {
          results.push(`✗ ${size}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { content: [{ type: 'text', text: `Export results for "${concept.conceptName}":\n${results.join('\n')}` }] };
    }
  );
}
