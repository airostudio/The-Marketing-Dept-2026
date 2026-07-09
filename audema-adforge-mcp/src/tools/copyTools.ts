import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { conceptStore, briefStore, brandStore } from '../storage/index.js';
import { buildCopyGuidance } from '../prompts/copywriting.js';

export function registerCopyTools(server: McpServer) {
  server.tool(
    'generate_ad_copy',
    'Get copywriting guidance to refine the headline, subheadline, CTA, proof point, and urgency line of ONE existing concept — useful after scoring flags a weak field, or to produce a copy variant for A/B testing. Returns guidance only; submit the revised copy with save_ad_concepts using the same concept id.',
    { conceptId: z.string() },
    async ({ conceptId }) => {
      const concept = conceptStore.get(conceptId);
      if (!concept) return { content: [{ type: 'text', text: `No concept found with id ${conceptId}.` }], isError: true };

      const brief = briefStore.get(concept.briefId);
      const brand = brief?.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;

      return { content: [{ type: 'text', text: buildCopyGuidance(concept, brand) }] };
    }
  );
}
