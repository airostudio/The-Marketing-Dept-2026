import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { conceptStore } from '../storage/index.js';
import type { AdConcept } from '../types.js';

function buildHypothesis(a: AdConcept, b: AdConcept): string {
  if (a.angleType !== b.angleType) {
    return `Testing whether a "${a.angleType}" angle ("${a.headline}") outperforms a "${b.angleType}" angle ("${b.headline}") for this audience — this tells you which emotional/strategic approach resonates more, not just which words work better.`;
  }
  if (a.targetEmotion !== b.targetEmotion) {
    return `Same "${a.angleType}" angle, different target emotion (${a.targetEmotion} vs ${b.targetEmotion}) — isolates whether the emotional register drives more action than the angle itself.`;
  }
  return `Same angle and emotion, different execution (headline/CTA/visual direction) — isolates copy and creative execution as the variable, holding strategy constant.`;
}

function recommendSplit(a: AdConcept, b: AdConcept): string {
  const bothScored = a.scores && b.scores;
  if (!bothScored) return '50/50 — no scoring data yet to weight toward a favourite.';
  const diff = Math.abs((a.scores!.overall ?? 0) - (b.scores!.overall ?? 0));
  if (diff < 1) return '50/50 — concepts scored within 1 point of each other, a fair fight.';
  return '60/40 favouring the higher-scored concept — still give the underdog enough spend to prove itself, since heuristic scores aren\'t a guarantee of real-world performance.';
}

export function registerAbTestTools(server: McpServer) {
  server.tool(
    'generate_ab_test_recommendations',
    'Given two or more saved concepts, produce concrete A/B test pairings: what each test isolates, the primary metric to watch, budget split, and rough sample-size guidance before calling a winner. Pairs concepts that differ meaningfully (different angle or emotion) rather than pairing near-duplicates.',
    {
      conceptIds: z.array(z.string()).min(2).describe('The concepts to consider pairing up for tests'),
    },
    async (args) => {
      const concepts = args.conceptIds.map((id) => conceptStore.get(id)).filter((c): c is AdConcept => !!c);
      const missing = args.conceptIds.filter((id) => !concepts.some((c) => c.id === id));
      if (missing.length) {
        return { content: [{ type: 'text', text: `Concept id(s) not found: ${missing.join(', ')}` }], isError: true };
      }
      if (concepts.length < 2) {
        return { content: [{ type: 'text', text: 'Need at least 2 valid concepts to recommend a test.' }], isError: true };
      }

      const lines: string[] = [`**A/B test recommendations for ${concepts.length} concept(s):**`, ''];

      // Prefer pairing concepts with DIFFERENT angle types first (most informative
      // tests), falling back to sequential pairing if everything shares an angle.
      const used = new Set<string>();
      const pairs: [AdConcept, AdConcept][] = [];

      for (let i = 0; i < concepts.length; i++) {
        if (used.has(concepts[i].id!)) continue;
        for (let j = i + 1; j < concepts.length; j++) {
          if (used.has(concepts[j].id!)) continue;
          if (concepts[i].angleType !== concepts[j].angleType) {
            pairs.push([concepts[i], concepts[j]]);
            used.add(concepts[i].id!);
            used.add(concepts[j].id!);
            break;
          }
        }
      }
      // Anything left over (all same angle, or odd one out) — pair sequentially.
      const leftovers = concepts.filter((c) => !used.has(c.id!));
      for (let i = 0; i < leftovers.length - 1; i += 2) {
        pairs.push([leftovers[i], leftovers[i + 1]]);
      }

      pairs.forEach(([a, b], idx) => {
        lines.push(`### Test ${idx + 1}: "${a.conceptName}" vs "${b.conceptName}"`);
        lines.push(`Hypothesis: ${buildHypothesis(a, b)}`);
        lines.push(`Primary metric: ${a.angleType === 'offer' || b.angleType === 'offer' ? 'Conversion rate (or CPA) — offer-led ads should be judged on completed action, not just clicks' : 'CTR, then conversion rate once you have volume'}`);
        lines.push(`Budget split: ${recommendSplit(a, b)}`);
        lines.push(`Minimum sample before calling a winner: run until each variant has at least ~100 conversions (or 1,000+ clicks if optimising for CTR first) — calling it earlier risks reacting to noise rather than a real difference.`);
        lines.push('');
      });

      if (leftovers.length % 2 === 1) {
        lines.push(`Note: "${leftovers[leftovers.length - 1].conceptName}" was left unpaired (odd number of concepts) — hold it back for the next round or pair it manually against a specific winner.`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
