import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { conceptStore, briefStore, campaignStore } from '../storage/index.js';
import type { AdConcept } from '../types.js';
import { calculateSampleSize, checkSignificance } from '../campaigns/statistics.js';

/**
 * Looks up a real historical conversion rate for the brand behind a concept
 * (via its brief), from previously saved campaign results, so sample-size
 * guidance can be computed from actual data instead of a generic rule of
 * thumb. Returns null when there isn't enough history to trust a baseline.
 */
function findHistoricalBaselineRate(concept: AdConcept): number | null {
  const brief = concept.briefId ? briefStore.get(concept.briefId) : undefined;
  if (!brief?.brandProfileId) return null;

  const results = campaignStore.find((r) => r.brandProfileId === brief.brandProfileId);
  const withConversions = results.filter((r) => r.clicks > 0 && ((r.leads ?? 0) > 0 || (r.purchases ?? 0) > 0));
  if (!withConversions.length) return null;

  const totalClicks = withConversions.reduce((sum, r) => sum + r.clicks, 0);
  const totalConversions = withConversions.reduce((sum, r) => sum + (r.leads ?? r.purchases ?? 0), 0);
  if (totalClicks === 0) return null;

  const rate = totalConversions / totalClicks;
  return rate > 0 && rate < 1 ? rate : null;
}

function buildSampleGuidance(a: AdConcept, b: AdConcept): string {
  const baseline = findHistoricalBaselineRate(a) ?? findHistoricalBaselineRate(b);
  if (baseline === null) {
    return 'Minimum sample before calling a winner: run until each variant has at least ~100 conversions (or 1,000+ clicks if optimising for CTR first) — no historical performance data yet for this brand to compute a precise number, so this is a general rule of thumb, not a calculation. Save campaign results first, or call calculate_test_sample_size directly with your own baseline conversion rate.';
  }
  const sample = calculateSampleSize({ baselineConversionRate: baseline, minimumDetectableEffect: 0.2 });
  return `Minimum sample before calling a winner: **~${sample.perVariantSampleSize.toLocaleString()} visitors per variant** (${sample.totalSampleSize.toLocaleString()} total), calculated from this brand's historical ${(baseline * 100).toFixed(1)}% conversion rate, assuming you want to reliably detect a 20% relative lift at 80% power / 95% confidence. Once you have real click/conversion counts for both variants, call check_test_significance to see if you can call a winner yet.`;
}

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
        lines.push(buildSampleGuidance(a, b));
        lines.push('');
      });

      if (leftovers.length % 2 === 1) {
        lines.push(`Note: "${leftovers[leftovers.length - 1].conceptName}" was left unpaired (odd number of concepts) — hold it back for the next round or pair it manually against a specific winner.`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'calculate_test_sample_size',
    'Compute the real per-variant and total sample size needed for an A/B test, given a baseline conversion rate and the minimum relative lift you want to reliably detect. Standard two-proportion power calculation (not a rule of thumb) — use this before launching a test to know how long to run it for.',
    {
      baselineConversionRate: z.number().gt(0).lt(1).describe('Current/control conversion rate, e.g. 0.03 for 3%'),
      minimumDetectableEffect: z.number().gt(0).describe('Smallest RELATIVE lift worth detecting, e.g. 0.2 for "a 20% relative improvement"'),
      power: z.number().gt(0).lt(1).default(0.8).describe('Statistical power — probability of detecting a real effect if one exists. 0.8 (80%) is standard.'),
      significanceLevel: z.number().gt(0).lt(1).default(0.05).describe('Two-sided significance level. 0.05 (95% confidence) is standard.'),
    },
    async (args) => {
      try {
        const result = calculateSampleSize(args);
        return {
          content: [{
            type: 'text',
            text: `**Sample size needed: ${result.perVariantSampleSize.toLocaleString()} per variant (${result.totalSampleSize.toLocaleString()} total)**\n\n` +
              `Baseline conversion rate: ${(result.baselineConversionRate * 100).toFixed(2)}%\n` +
              `Target conversion rate to detect: ${(result.targetConversionRate * 100).toFixed(2)}% (a ${(result.minimumDetectableEffect * 100).toFixed(0)}% relative lift)\n` +
              `Power: ${(result.power * 100).toFixed(0)}% | Significance level: ${(result.significanceLevel * 100).toFixed(0)}%\n\n` +
              `Below this sample size, even a test that looks "significant" is at meaningfully higher risk of being noise — don't call a winner before you get here.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    }
  );

  server.tool(
    'check_test_significance',
    'Run a real two-proportion significance test (z-test) on two variants\' actual conversion counts, to tell you whether you can trust calling a winner yet. Reports the p-value and lift honestly, and flags when the sample is too thin to trust even if the math says "significant".',
    {
      variantAConversions: z.number().int().min(0),
      variantAVisitors: z.number().int().min(1),
      variantBConversions: z.number().int().min(0),
      variantBVisitors: z.number().int().min(1),
      significanceLevel: z.number().gt(0).lt(1).default(0.05),
    },
    async (args) => {
      try {
        const result = checkSignificance(
          { conversions: args.variantAConversions, visitors: args.variantAVisitors },
          { conversions: args.variantBConversions, visitors: args.variantBVisitors },
          args.significanceLevel
        );
        const lines = [
          `Variant A: ${(result.variantAConversionRate * 100).toFixed(2)}% (${args.variantAConversions}/${args.variantAVisitors})`,
          `Variant B: ${(result.variantBConversionRate * 100).toFixed(2)}% (${args.variantBConversions}/${args.variantBVisitors})`,
          `Relative lift (B vs A): ${(result.relativeLift * 100).toFixed(1)}%`,
          `z-score: ${result.zScore.toFixed(3)} | p-value: ${result.pValue.toFixed(4)}`,
          result.isSignificant
            ? `**Statistically significant at ${(result.confidenceLevel * 100).toFixed(0)}% confidence — Variant ${result.winner} wins.**`
            : `**Not statistically significant yet at ${(result.confidenceLevel * 100).toFixed(0)}% confidence — keep running the test.**`,
        ];
        if (result.warning) lines.push(`⚠️ ${result.warning}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    }
  );
}
