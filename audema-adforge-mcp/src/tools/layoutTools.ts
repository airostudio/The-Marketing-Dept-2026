import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PLATFORM_SIZES, PlatformSizeSchema } from '../types.js';
import type { PlatformSizeKey } from '../types.js';
import { conceptStore, briefStore, brandStore, layoutStore } from '../storage/index.js';
import { generateLayoutSpec } from '../render/layout.js';

function summarizeLayout(spec: ReturnType<typeof layoutStore.list>[number]): string {
  const lines = [
    `Layout for concept ${spec.conceptId} — ${PLATFORM_SIZES[spec.platformSize as PlatformSizeKey].label}`,
    `Canvas: ${spec.width}×${spec.height}px | Safe zone (px): top ${spec.safeZone.top}, right ${spec.safeZone.right}, bottom ${spec.safeZone.bottom}, left ${spec.safeZone.left}`,
    `Background style: ${spec.backgroundStyle}`,
    'Text blocks:',
    ...spec.textBlocks.map(
      (b) => `  - ${b.role}: x=${b.x} y=${b.y} width=${b.width} fontSize=${b.fontSize} weight=${b.fontWeight} align=${b.align} color=${b.color}`
    ),
  ];
  if (spec.logoPlacement) {
    lines.push(`Logo: x=${spec.logoPlacement.x} y=${spec.logoPlacement.y} maxWidth=${spec.logoPlacement.maxWidth} maxHeight=${spec.logoPlacement.maxHeight}`);
  }
  if (spec.notes.length) {
    lines.push('Notes:');
    spec.notes.forEach((n) => lines.push(`  - ${n}`));
  }
  return lines.join('\n');
}

export function registerLayoutTools(server: McpServer) {
  server.tool(
    'generate_layout',
    `Compute a pixel-precise layout spec for a concept at a given platform size (${Object.keys(PLATFORM_SIZES).join(', ')}). Determines safe zones, text block positions/sizes, and logo placement from the concept's copy length and the brand profile — this is deterministic, not creative guesswork. Required before export_ad_image.`,
    {
      conceptId: z.string(),
      platformSize: PlatformSizeSchema.optional().describe('Defaults to the concept\'s own platformSize field if omitted'),
    },
    async (args) => {
      const concept = conceptStore.get(args.conceptId);
      if (!concept) return { content: [{ type: 'text', text: `No concept found with id ${args.conceptId}.` }], isError: true };

      const brief = briefStore.get(concept.briefId);
      const brand = brief?.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;
      const size = (args.platformSize ?? concept.platformSize) as PlatformSizeKey;

      const spec = generateLayoutSpec(concept, size, brand);
      const saved = layoutStore.upsert(spec);

      return { content: [{ type: 'text', text: summarizeLayout(saved) }] };
    }
  );

  server.tool(
    'list_layouts',
    'List all generated layout specs for a concept.',
    { conceptId: z.string() },
    async ({ conceptId }) => {
      const specs = layoutStore.find((s) => s.conceptId === conceptId);
      if (!specs.length) return { content: [{ type: 'text', text: 'No layouts generated yet for this concept. Call generate_layout first.' }] };
      return { content: [{ type: 'text', text: specs.map(summarizeLayout).join('\n\n') }] };
    }
  );
}
