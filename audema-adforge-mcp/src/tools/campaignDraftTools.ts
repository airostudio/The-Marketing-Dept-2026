import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { campaignDraftStore, brandStore, conceptStore } from '../storage/index.js';
import { AdPlatformSchema } from '../types.js';
import type { CampaignDraft } from '../types.js';
import { checkBudgetGuardrails, checkCopyPolicyRisk } from '../campaigns/guardrails.js';
import { getPlatformAdapter } from '../campaigns/platformAdapters.js';

function summarizeDraft(d: CampaignDraft): string {
  const lines = [
    `**${d.campaignName}** (${d.platform}, id: ${d.id})`,
    `Status: ${d.status}${d.platformCampaignId ? ` — platform campaign id: ${d.platformCampaignId}` : ''}`,
    `Objective: ${d.objective} | Daily budget: $${(d.dailyBudgetCents / 100).toFixed(2)}`,
    `Targeting: ${d.targeting.countries.join(', ')} | ages ${d.targeting.ageMin}-${d.targeting.ageMax}${d.targeting.interests.length ? ` | interests: ${d.targeting.interests.join(', ')}` : ''}`,
  ];
  if (d.platformError) lines.push(`⚠️ Platform error: ${d.platformError}`);
  return lines.join('\n');
}

export function registerCampaignDraftTools(server: McpServer) {
  server.tool(
    'create_campaign_draft',
    'Create a campaign draft from a scored ad concept. ALWAYS creates in a paused/draft state — this tool has no way to publish an active, spending campaign. Validates the daily budget against the server-configured ceiling (ADFORGE_MAX_DAILY_BUDGET_CENTS) and runs a basic ad-copy policy check before doing anything — both must pass or nothing is created or saved. If the target platform has real API credentials configured (see README), attempts to create the campaign there in PAUSED status; otherwise saves the draft locally only, clearly marked as not yet pushed to any platform.',
    {
      brandProfileId: z.string(),
      conceptId: z.string(),
      platform: AdPlatformSchema,
      campaignName: z.string().min(1),
      objective: z.string().describe('Platform-specific objective, e.g. "OUTCOME_TRAFFIC" or "OUTCOME_SALES" for Meta'),
      dailyBudgetCents: z.number().int().min(1),
      targeting: z.object({
        countries: z.array(z.string()).min(1),
        ageMin: z.number().int().min(13).max(65).default(18),
        ageMax: z.number().int().min(13).max(65).default(65),
        interests: z.array(z.string()).default([]),
      }),
    },
    async (args) => {
      const brand = brandStore.get(args.brandProfileId);
      if (!brand) return { content: [{ type: 'text', text: `No brand profile found with id ${args.brandProfileId}.` }], isError: true };

      const concept = conceptStore.get(args.conceptId);
      if (!concept) return { content: [{ type: 'text', text: `No concept found with id ${args.conceptId}.` }], isError: true };

      // ── Guardrails: both must pass before anything is created or saved ──
      const budgetViolations = checkBudgetGuardrails(args.dailyBudgetCents);
      const copyText = [concept.headline, concept.subheadline, concept.cta, concept.proofPoint, concept.urgencyLine].filter(Boolean).join(' ');
      const copyViolations = checkCopyPolicyRisk(copyText);
      const violations = [...budgetViolations, ...copyViolations];

      if (violations.length) {
        return {
          content: [{
            type: 'text',
            text: `Cannot create campaign draft — guardrail check failed:\n${violations.map((v) => `- [${v.field}] ${v.message}`).join('\n')}`,
          }],
          isError: true,
        };
      }

      const adapter = getPlatformAdapter(args.platform);
      let draft: CampaignDraft;

      if (!adapter.isConfigured()) {
        draft = campaignDraftStore.upsert({
          ...args,
          status: 'local_only',
        });
        return {
          content: [{
            type: 'text',
            text: `Draft saved locally (not pushed to ${args.platform} — ${adapter.unavailableReason()}).\n\n${summarizeDraft(draft)}`,
          }],
        };
      }

      // Save the local record first so nothing is lost even if the platform call fails.
      draft = campaignDraftStore.upsert({ ...args, status: 'local_only' });

      try {
        const result = await adapter.createPausedCampaign(draft);
        draft = campaignDraftStore.upsert({ id: draft.id, status: 'platform_paused', platformCampaignId: result.platformCampaignId } as CampaignDraft);
        return {
          content: [{
            type: 'text',
            text: `Campaign created on ${args.platform} in PAUSED status — review it in the platform's ads manager before publishing.\n\n${summarizeDraft(draft)}`,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        draft = campaignDraftStore.upsert({ id: draft.id, status: 'platform_error', platformError: message } as CampaignDraft);
        return {
          content: [{ type: 'text', text: `Draft saved locally, but the ${args.platform} push failed: ${message}\n\n${summarizeDraft(draft)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'list_campaign_drafts',
    'List all campaign drafts for a brand profile, across all platforms and statuses.',
    { brandProfileId: z.string() },
    async ({ brandProfileId }) => {
      const drafts = campaignDraftStore.find((d) => d.brandProfileId === brandProfileId);
      if (!drafts.length) return { content: [{ type: 'text', text: 'No campaign drafts saved yet for this brand.' }] };
      return { content: [{ type: 'text', text: drafts.map(summarizeDraft).join('\n\n') }] };
    }
  );

  server.tool(
    'get_campaign_draft',
    'Get one campaign draft by id.',
    { draftId: z.string() },
    async ({ draftId }) => {
      const draft = campaignDraftStore.get(draftId);
      if (!draft) return { content: [{ type: 'text', text: `No campaign draft found with id ${draftId}.` }], isError: true };
      return { content: [{ type: 'text', text: summarizeDraft(draft) }] };
    }
  );
}
