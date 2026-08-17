import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdAngleTypeSchema, PlatformSizeSchema } from '../types.js';
import type { AdConcept } from '../types.js';
import { briefStore, brandStore, conceptStore } from '../storage/index.js';
import { generateCombinations, filterForbiddenPhrases } from '../campaigns/dco.js';
import { scoreConcept } from '../prompts/scoring.js';

export function registerDcoTools(server: McpServer) {
  server.tool(
    'generate_creative_combinations',
    'Dynamic Creative Optimization: auto-assemble every combination of the headlines × subheadlines × CTAs × visual directions you provide into separate, scored ad concepts — the same angle/emotion held constant, execution varied systematically, instead of hand-writing each permutation. Automatically drops any combination that contains a brand-forbidden phrase. Capped at 60 combinations regardless of what the inputs would multiply out to.',
    {
      briefId: z.string(),
      conceptNamePrefix: z.string().default('DCO Combo').describe('Prefix for auto-generated concept names, e.g. "DCO Combo 1", "DCO Combo 2"'),
      angleType: AdAngleTypeSchema,
      targetEmotion: z.string(),
      customerPainPoint: z.string(),
      conversionRationale: z.string(),
      platformSize: PlatformSizeSchema.default('square'),
      headlines: z.array(z.string()).min(1),
      subheadlines: z.array(z.string()).default([]).describe('Omit or leave empty to use a blank subheadline for every combination'),
      ctas: z.array(z.string()).min(1),
      visualDirections: z.array(z.string()).min(1),
      maxCombinations: z.number().int().min(1).max(60).default(24),
    },
    async (args) => {
      const brief = briefStore.get(args.briefId);
      if (!brief) return { content: [{ type: 'text', text: `No ad brief found with id ${args.briefId}.` }], isError: true };

      const brand = brief.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;

      let combosResult;
      try {
        combosResult = generateCombinations({
          headlines: args.headlines,
          subheadlines: args.subheadlines,
          ctas: args.ctas,
          visualDirections: args.visualDirections,
          maxCombinations: args.maxCombinations,
        });
      } catch (err) {
        return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
      }

      const filtered = filterForbiddenPhrases(combosResult.combinations, brand?.forbiddenPhrases ?? []);

      const saved: AdConcept[] = filtered.kept.map((combo, i) => {
        const input: AdConcept = {
          briefId: args.briefId,
          conceptName: `${args.conceptNamePrefix} ${i + 1}`,
          angleType: args.angleType,
          targetEmotion: args.targetEmotion,
          customerPainPoint: args.customerPainPoint,
          hook: combo.headline,
          headline: combo.headline,
          subheadline: combo.subheadline,
          cta: combo.cta,
          visualDirection: combo.visualDirection,
          platformSize: args.platformSize,
          conversionRationale: args.conversionRationale,
        };
        const scores = scoreConcept(input, brand);
        return conceptStore.upsert({ ...input, scores });
      });

      saved.sort((a, b) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0));

      const lines: string[] = [];
      lines.push(`Generated ${saved.length} creative combination(s) out of ${combosResult.totalPossible} possible.`);
      if (combosResult.truncated) {
        lines.push(`⚠️ Truncated to the ${args.maxCombinations}-combination cap — ${combosResult.totalPossible - combosResult.combinations.length} combinations were not generated. Narrow your input arrays or raise maxCombinations (max 60) to cover more.`);
      }
      if (filtered.removed.length) {
        lines.push(`⚠️ ${filtered.removed.length} combination(s) dropped for containing a brand-forbidden phrase: ${[...new Set(filtered.removed.map((r) => r.matchedPhrase))].join(', ')}.`);
      }
      lines.push('', '**Top combinations by score:**', '');
      saved.slice(0, 10).forEach((c) => {
        lines.push(`- **${c.conceptName}** (score: ${c.scores?.overall ?? 'n/a'}/10, id: ${c.id}) — "${c.headline}" / "${c.cta}"`);
      });
      if (saved.length > 10) lines.push(`... and ${saved.length - 10} more (use list_ad_concepts to see all).`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
