import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PlatformSizeSchema } from '../types.js';
import type { PlatformSizeKey } from '../types.js';
import { conceptStore, briefStore, brandStore, layoutStore } from '../storage/index.js';
import { generateLayoutSpec } from '../render/layout.js';
import { checkBrandCompliance } from '../render/compliance.js';

export function registerComplianceTools(server: McpServer) {
  server.tool(
    'check_brand_compliance',
    'Structural compliance check for a concept at a given platform size: does any text overlap the logo\'s reserved safe zone, does any text fail WCAG AA contrast against its background, and does the copy contain a brand-forbidden phrase. Deterministic and rules-based — not a substitute for the platform\'s own ad policy review (see create_campaign_draft\'s built-in copy policy check for that), this is about legibility and brand-guideline adherence.',
    {
      conceptId: z.string(),
      platformSize: PlatformSizeSchema.optional().describe('Defaults to the concept\'s own platformSize field'),
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

      const issues = checkBrandCompliance(concept, layout, brand);
      if (!issues.length) {
        return { content: [{ type: 'text', text: `✓ No compliance issues found for "${concept.conceptName}" at ${size}.` }] };
      }

      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const lines = [`**${issues.length} compliance issue(s) found for "${concept.conceptName}" at ${size}:**`, ''];
      if (errors.length) {
        lines.push('**Errors (should fix before export):**');
        errors.forEach((i) => lines.push(`- 🛑 [${i.type}] ${i.message}`));
        lines.push('');
      }
      if (warnings.length) {
        lines.push('**Warnings:**');
        warnings.forEach((i) => lines.push(`- ⚠️ [${i.type}] ${i.message}`));
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
