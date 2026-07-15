import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PlatformSizeSchema } from '../types.js';
import type { PlatformSizeKey } from '../types.js';
import { conceptStore, briefStore, brandStore, layoutStore, EXPORT_DIR } from '../storage/index.js';
import { generateLayoutSpec } from '../render/layout.js';
import { renderAd } from '../render/renderer.js';

export function registerExportTools(server: McpServer) {
  server.tool(
    'export_ad_image',
    'Render a concept to a production-ready PNG or JPG file on disk at the given platform size. Generates the layout automatically if one hasn\'t been created yet. Returns the file path.',
    {
      conceptId: z.string(),
      platformSize: PlatformSizeSchema.optional().describe('Defaults to the concept\'s own platformSize field'),
      format: z.enum(['png', 'jpg']).default('png'),
      backgroundImagePath: z.string().optional().describe('Absolute path to a photo/illustration to use as the background instead of a brand-colour gradient'),
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

      try {
        const result = await renderAd(concept, layout, brand, args.outputDir ?? EXPORT_DIR, args.format, args.backgroundImagePath);
        return {
          content: [{
            type: 'text',
            text: `Exported "${concept.conceptName}" (${size}, ${args.format.toUpperCase()}) → ${result.filePath} (${result.width}×${result.height}px)`,
          }],
        };
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
          results.push(`✓ ${size}: ${result.filePath}`);
        } catch (err) {
          results.push(`✗ ${size}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { content: [{ type: 'text', text: `Export results for "${concept.conceptName}":\n${results.join('\n')}` }] };
    }
  );
}
