import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { briefStore, brandStore } from '../storage/index.js';
import { buildCustomerAnalysisGuidance } from '../prompts/analysis.js';

export function registerBriefTools(server: McpServer) {
  server.tool(
    'create_ad_brief',
    'Start a new static ad campaign from a business description. Returns a briefId plus guidance on the customer analysis needed before any ad concepts can be generated — call submit_customer_analysis next.',
    {
      businessDescription: z.string().min(1).describe('Describe the business, what it sells, and this specific campaign in as much detail as you have'),
      campaignGoal: z.string().optional(),
      brandProfileId: z.string().optional().describe('Link to a previously saved brand profile, if one exists'),
    },
    async (args) => {
      if (args.brandProfileId && !brandStore.get(args.brandProfileId)) {
        return {
          content: [{ type: 'text', text: `No brand profile found with id ${args.brandProfileId}. Create one with create_brand_profile, or omit brandProfileId to continue without one (not recommended for production-ready ads).` }],
          isError: true,
        };
      }

      const brief = briefStore.upsert({
        businessDescription: args.businessDescription,
        campaignGoal: args.campaignGoal,
        brandProfileId: args.brandProfileId,
      });

      const guidance = buildCustomerAnalysisGuidance(brief);
      return { content: [{ type: 'text', text: `Ad brief created (id: ${brief.id}).\n\n${guidance}` }] };
    }
  );

  server.tool(
    'submit_customer_analysis',
    'Attach the target customer, pain points, offer, objections, and desired action to an ad brief. This unlocks generate_ad_angles — angles cannot be generated from a business description alone.',
    {
      briefId: z.string(),
      targetCustomer: z.string().min(1),
      painPoints: z.array(z.string()).min(1),
      offer: z.string().min(1),
      objections: z.array(z.string()).optional(),
      desiredAction: z.string().min(1),
    },
    async (args) => {
      const brief = briefStore.get(args.briefId);
      if (!brief) return { content: [{ type: 'text', text: `No ad brief found with id ${args.briefId}.` }], isError: true };

      const updated = briefStore.upsert({
        ...brief,
        analysis: {
          targetCustomer: args.targetCustomer,
          painPoints: args.painPoints,
          offer: args.offer,
          objections: args.objections ?? [],
          desiredAction: args.desiredAction,
        },
      });

      return {
        content: [{
          type: 'text',
          text: `Customer analysis saved for brief ${updated.id}.\n\nTarget customer: ${args.targetCustomer}\nPain points: ${args.painPoints.join(', ')}\nOffer: ${args.offer}\nDesired action: ${args.desiredAction}\n\nNext: call generate_ad_angles with this briefId to get the angle-writing framework.`,
        }],
      };
    }
  );

  server.tool(
    'get_ad_brief',
    'Retrieve a single ad brief by id, including its customer analysis if submitted.',
    { briefId: z.string() },
    async ({ briefId }) => {
      const brief = briefStore.get(briefId);
      if (!brief) return { content: [{ type: 'text', text: `No ad brief found with id ${briefId}.` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(brief, null, 2) }] };
    }
  );

  server.tool(
    'list_ad_briefs',
    'List all saved ad briefs (id, business description summary, whether analysis is complete).',
    {},
    async () => {
      const all = briefStore.list();
      if (!all.length) return { content: [{ type: 'text', text: 'No ad briefs yet. Create one with create_ad_brief.' }] };
      const lines = all.map(
        (b) => `- id: ${b.id} — "${b.businessDescription.slice(0, 70)}${b.businessDescription.length > 70 ? '…' : ''}" — analysis: ${b.analysis ? 'complete' : 'PENDING'}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
