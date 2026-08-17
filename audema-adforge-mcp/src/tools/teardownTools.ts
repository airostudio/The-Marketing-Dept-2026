import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildCompetitorTeardown } from '../prompts/teardown.js';

export function registerTeardownTools(server: McpServer) {
  server.tool(
    'analyze_competitor_ad',
    'Analyze a competitor\'s ad (paste in its actual headline/body/CTA — this server has no scraped ad library, so it can\'t pull one for you) using the same scoring engine this server uses on its own concepts: a best-effort angle-type guess, the full 6-dimension score breakdown, and concrete "what to borrow" / "what to avoid" notes. Useful before writing your own concepts for a similar offer.',
    {
      competitorName: z.string().optional(),
      platform: z.string().optional(),
      headline: z.string().min(1),
      body: z.string().optional(),
      cta: z.string().optional(),
      notes: z.string().optional().describe('Any visual/context notes — image style, offer details, anything relevant that isn\'t in the copy itself'),
    },
    async (args) => {
      const teardown = buildCompetitorTeardown(args);

      const lines = [
        `**Teardown: ${args.competitorName ?? 'competitor ad'}${args.platform ? ` (${args.platform})` : ''}**`,
        '',
        `Angle guess: **${teardown.angleTypeGuess}** (keyword heuristic — verify against the real creative, this isn't certain)`,
        '',
        `**Scores (same 6-dimension scale used on your own concepts):**`,
        teardown.scoresExplained,
        '',
      ];

      if (teardown.whatToBorrow.length) {
        lines.push('**What to borrow:**');
        teardown.whatToBorrow.forEach((b) => lines.push(`- ${b}`));
        lines.push('');
      }
      if (teardown.whatToAvoid.length) {
        lines.push('**What to avoid:**');
        teardown.whatToAvoid.forEach((a) => lines.push(`- ${a}`));
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
