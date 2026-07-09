import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AD_ANGLE_TYPES, AdAngleTypeSchema } from '../types.js';
import { briefStore, brandStore } from '../storage/index.js';
import { buildAngleGuidance } from '../prompts/angles.js';

export function registerAngleTools(server: McpServer) {
  server.tool(
    'generate_ad_angles',
    `Get the angle-writing framework for a brief that already has a customer analysis. Returns detailed, brief-specific guidance for each requested angle type (${AD_ANGLE_TYPES.join(', ')}) — not the concepts themselves. After reading the guidance, write the actual concepts and submit them with save_ad_concepts.`,
    {
      briefId: z.string(),
      angleTypes: z.array(AdAngleTypeSchema).min(1).default([...AD_ANGLE_TYPES]).describe('Which angle types to generate guidance for. Defaults to all six.'),
    },
    async (args) => {
      const brief = briefStore.get(args.briefId);
      if (!brief) return { content: [{ type: 'text', text: `No ad brief found with id ${args.briefId}.` }], isError: true };

      const brand = brief.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;
      const guidance = buildAngleGuidance(brief, brand, args.angleTypes);

      return { content: [{ type: 'text', text: guidance }] };
    }
  );
}
