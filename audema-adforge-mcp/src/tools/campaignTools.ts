import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { campaignStore, conceptStore, brandStore } from '../storage/index.js';
import type { CampaignResult } from '../types.js';

function computeDerived(input: Omit<CampaignResult, 'id' | 'createdAt'>): CampaignResult {
  const ctr = input.ctr ?? (input.impressions > 0 ? (input.clicks / input.impressions) * 100 : 0);
  const cpc = input.cpc ?? (input.clicks > 0 ? input.spend / input.clicks : 0);
  const cpa =
    input.cpa ??
    (input.leads && input.leads > 0
      ? input.spend / input.leads
      : input.purchases && input.purchases > 0
        ? input.spend / input.purchases
        : undefined);
  const roas = input.roas ?? (input.revenue && input.spend > 0 ? input.revenue / input.spend : undefined);

  return {
    ...input,
    ctr: round(ctr),
    cpc: round(cpc),
    cpa: cpa !== undefined ? round(cpa) : undefined,
    roas: roas !== undefined ? round(roas) : undefined,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function summarizeResult(r: CampaignResult): string {
  return [
    `**${r.platform}** ${r.dateRange} (id: ${r.id})`,
    `Spend $${r.spend} | Impressions ${r.impressions} | Clicks ${r.clicks} | CTR ${r.ctr}% | CPC $${r.cpc}`,
    r.leads !== undefined ? `Leads ${r.leads}${r.cpa !== undefined ? ` | CPA $${r.cpa}` : ''}` : undefined,
    r.purchases !== undefined ? `Purchases ${r.purchases}` : undefined,
    r.roas !== undefined ? `ROAS ${r.roas}x` : undefined,
    r.winningCreativeNotes ? `Winning creative: ${r.winningCreativeNotes}` : undefined,
    r.losingCreativeNotes ? `Losing creative: ${r.losingCreativeNotes}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

export function registerCampaignTools(server: McpServer) {
  server.tool(
    'save_campaign_result',
    'Record real campaign performance data (spend, impressions, clicks, leads/purchases, ROAS, and notes on what won/lost creatively) for a brand. CTR, CPC, CPA, and ROAS are computed automatically from spend/impressions/clicks/leads/purchases/revenue if not supplied directly. Feeds get_campaign_insights.',
    {
      brandProfileId: z.string(),
      briefId: z.string().optional(),
      conceptId: z.string().optional().describe('Link this result to a specific concept if you tracked performance at that level'),
      platform: z.string(),
      dateRange: z.string(),
      spend: z.number().min(0),
      impressions: z.number().min(0),
      clicks: z.number().min(0),
      ctr: z.number().min(0).optional(),
      cpc: z.number().min(0).optional(),
      leads: z.number().min(0).optional(),
      cpa: z.number().min(0).optional(),
      purchases: z.number().min(0).optional(),
      roas: z.number().min(0).optional(),
      revenue: z.number().min(0).optional(),
      winningCreativeNotes: z.string().optional(),
      losingCreativeNotes: z.string().optional(),
    },
    async (args) => {
      if (!brandStore.get(args.brandProfileId)) {
        return { content: [{ type: 'text', text: `No brand profile found with id ${args.brandProfileId}.` }], isError: true };
      }
      const computed = computeDerived(args);
      const saved = campaignStore.upsert(computed);
      return { content: [{ type: 'text', text: `Campaign result saved.\n\n${summarizeResult(saved)}` }] };
    }
  );

  server.tool(
    'list_campaign_results',
    'List all saved campaign results for a brand profile.',
    { brandProfileId: z.string() },
    async ({ brandProfileId }) => {
      const results = campaignStore.find((r) => r.brandProfileId === brandProfileId);
      if (!results.length) return { content: [{ type: 'text', text: 'No campaign results saved yet for this brand.' }] };
      return { content: [{ type: 'text', text: results.map(summarizeResult).join('\n\n') }] };
    }
  );

  server.tool(
    'get_campaign_insights',
    'Analyse all saved campaign results for a brand and recommend which ad angles to lean into or avoid. Aggregates real performance data (CTR, ROAS, CPA) by angle type where results are linked to concepts, and surfaces winning/losing creative notes verbatim — this is a data summary, not a guess.',
    { brandProfileId: z.string() },
    async ({ brandProfileId }) => {
      const results = campaignStore.find((r) => r.brandProfileId === brandProfileId);
      if (!results.length) {
        return { content: [{ type: 'text', text: 'No campaign results recorded yet for this brand — nothing to analyse. Save results with save_campaign_result as campaigns run.' }] };
      }

      const totalSpend = results.reduce((s, r) => s + r.spend, 0);
      const totalClicks = results.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = results.reduce((s, r) => s + r.impressions, 0);
      const avgCtr = totalImpressions > 0 ? round((totalClicks / totalImpressions) * 100) : 0;
      const roasResults = results.filter((r) => r.roas !== undefined);
      const avgRoas = roasResults.length ? round(roasResults.reduce((s, r) => s + (r.roas ?? 0), 0) / roasResults.length) : undefined;

      // Aggregate by angle type where a result is linked to a concept
      const byAngle = new Map<string, { spend: number; clicks: number; impressions: number; roasSum: number; roasCount: number }>();
      for (const r of results) {
        if (!r.conceptId) continue;
        const concept = conceptStore.get(r.conceptId);
        if (!concept) continue;
        const bucket = byAngle.get(concept.angleType) ?? { spend: 0, clicks: 0, impressions: 0, roasSum: 0, roasCount: 0 };
        bucket.spend += r.spend;
        bucket.clicks += r.clicks;
        bucket.impressions += r.impressions;
        if (r.roas !== undefined) { bucket.roasSum += r.roas; bucket.roasCount += 1; }
        byAngle.set(concept.angleType, bucket);
      }

      const lines: string[] = [];
      lines.push(`**Campaign Insights — ${results.length} result(s) analysed**`);
      lines.push(`Total spend: $${round(totalSpend)} | Avg CTR: ${avgCtr}%${avgRoas !== undefined ? ` | Avg ROAS: ${avgRoas}x` : ''}`);
      lines.push('');

      if (byAngle.size > 0) {
        lines.push('**Performance by ad angle (from linked concepts):**');
        const ranked = [...byAngle.entries()]
          .map(([angle, b]) => ({
            angle,
            ctr: b.impressions > 0 ? round((b.clicks / b.impressions) * 100) : 0,
            roas: b.roasCount > 0 ? round(b.roasSum / b.roasCount) : undefined,
            spend: round(b.spend),
          }))
          .sort((a, b) => (b.roas ?? b.ctr) - (a.roas ?? a.ctr));

        ranked.forEach((r, i) => {
          lines.push(`  ${i + 1}. **${r.angle}** — CTR ${r.ctr}%${r.roas !== undefined ? `, ROAS ${r.roas}x` : ''}, spend $${r.spend}`);
        });

        if (ranked.length > 1) {
          lines.push('');
          lines.push(`**Recommendation:** lean into "${ranked[0].angle}" angles for the next campaign — they're outperforming on ${ranked[0].roas !== undefined ? 'ROAS' : 'CTR'}. Consider retiring or heavily revising "${ranked[ranked.length - 1].angle}" angles unless the sample size is still small.`);
        }
      } else {
        lines.push('No results are linked to specific concepts (conceptId), so angle-level comparison isn\'t possible yet — only aggregate stats above. Link future save_campaign_result calls to a conceptId to unlock angle-level recommendations.');
      }

      const winningNotes = results.map((r) => r.winningCreativeNotes).filter(Boolean);
      const losingNotes = results.map((r) => r.losingCreativeNotes).filter(Boolean);
      if (winningNotes.length) {
        lines.push('');
        lines.push('**What has worked (from campaign notes):**');
        winningNotes.forEach((n) => lines.push(`  - ${n}`));
      }
      if (losingNotes.length) {
        lines.push('');
        lines.push('**What has underperformed (from campaign notes):**');
        losingNotes.forEach((n) => lines.push(`  - ${n}`));
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
