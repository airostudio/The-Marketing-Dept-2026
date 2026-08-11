import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { campaignStore, brandStore } from '../storage/index.js';
import { evaluateRules, suggestDefaultRules } from '../campaigns/optimizationRules.js';
import type { OptimizationRule } from '../campaigns/optimizationRules.js';

const RuleSchema = z.object({
  metric: z.enum(['cpa', 'roas', 'ctr', 'cpc']),
  comparator: z.enum(['above', 'below']),
  threshold: z.number(),
  minSpend: z.number().min(0).optional().describe('Ignore results below this spend — avoids flagging on a tiny, noisy sample'),
  label: z.string().optional(),
});

export function registerOptimizationTools(server: McpServer) {
  server.tool(
    'suggest_pause_candidates',
    'Flag saved campaign results that breach performance rules (e.g. "CPA above $X", "ROAS below Y") — a Revealbot-style rules engine, but recommendation-only: it never pauses anything itself, since this server has no live write access to spend. Pass your own rules, or omit them to auto-derive sensible defaults from this brand\'s own historical average performance (needs at least 3 saved results).',
    {
      brandProfileId: z.string(),
      rules: z.array(RuleSchema).optional().describe('Omit to auto-derive default rules from this brand\'s historical averages'),
    },
    async (args) => {
      const brand = brandStore.get(args.brandProfileId);
      if (!brand) return { content: [{ type: 'text', text: `No brand profile found with id ${args.brandProfileId}.` }], isError: true };

      const results = campaignStore.find((r) => r.brandProfileId === args.brandProfileId);
      if (!results.length) {
        return { content: [{ type: 'text', text: 'No campaign results saved yet for this brand — nothing to evaluate.' }] };
      }

      let rules: OptimizationRule[];
      let derivationNote: string | undefined;

      if (args.rules && args.rules.length) {
        rules = args.rules;
      } else {
        const defaults = suggestDefaultRules(results);
        rules = defaults.rules;
        derivationNote = defaults.note;
        if (!rules.length) {
          return { content: [{ type: 'text', text: derivationNote! }] };
        }
      }

      const flagged = evaluateRules(results, rules);
      const lines: string[] = [];
      if (derivationNote) lines.push(derivationNote, '');

      lines.push(`**Rules evaluated:**`);
      rules.forEach((r) => lines.push(`- ${r.label ?? `${r.metric} ${r.comparator} ${r.threshold}`}${r.minSpend ? ` (min spend $${r.minSpend})` : ''}`));
      lines.push('');

      if (!flagged.length) {
        lines.push(`No results breach these rules — nothing flagged for review out of ${results.length} saved result(s).`);
      } else {
        lines.push(`**${flagged.length} of ${results.length} result(s) flagged for review:**`, '');
        flagged.forEach(({ result, triggeredRules }) => {
          lines.push(`**${result.platform}** ${result.dateRange} (id: ${result.id}) — spend $${result.spend}`);
          triggeredRules.forEach((rule) => {
            const value = result[rule.metric];
            lines.push(`  ⚠️ ${rule.label ?? `${rule.metric} ${rule.comparator} ${rule.threshold}`} — actual: ${value}`);
          });
        });
        lines.push('', 'Review these in your ad platform and pause manually if you agree — this tool only recommends, it never pauses spend itself.');
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
