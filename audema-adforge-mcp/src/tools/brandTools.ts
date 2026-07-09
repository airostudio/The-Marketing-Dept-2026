import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrandColoursSchema, BrandFontsSchema } from '../types.js';
import { brandStore } from '../storage/index.js';

function summarizeBrand(b: ReturnType<typeof brandStore.list>[number]): string {
  return [
    `**${b.businessName}** (${b.id})`,
    `Industry: ${b.industry}`,
    `Audience: ${b.targetAudience}`,
    `Voice: ${b.brandVoice}`,
    `Colours: primary ${b.colours.primary}${b.colours.secondary ? `, secondary ${b.colours.secondary}` : ''}${b.colours.accent ? `, accent ${b.colours.accent}` : ''}`,
    `Fonts: heading ${b.fonts.heading}${b.fonts.body ? `, body ${b.fonts.body}` : ''}`,
    b.proofPoints.length ? `Proof points: ${b.proofPoints.join(' | ')}` : undefined,
    b.guarantees.length ? `Guarantees: ${b.guarantees.join(' | ')}` : undefined,
    b.commonOffers.length ? `Common offers: ${b.commonOffers.join(' | ')}` : undefined,
    b.preferredCTA.length ? `Preferred CTAs: ${b.preferredCTA.join(' | ')}` : undefined,
    b.forbiddenPhrases.length ? `Forbidden phrases: ${b.forbiddenPhrases.join(' | ')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

export function registerBrandTools(server: McpServer) {
  server.tool(
    'create_brand_profile',
    'Save a reusable brand profile (business name, industry, audience, voice, colours, fonts, logo, proof points, guarantees, offers, forbidden phrases). Every downstream tool — ad angles, copy, layout, export — pulls from this so concepts stay on-brand and never generic. Call this once per client and reuse the returned id.',
    {
      businessName: z.string().min(1),
      industry: z.string().min(1),
      targetAudience: z.string().min(1),
      brandVoice: z.string().min(1),
      colours: BrandColoursSchema,
      fonts: BrandFontsSchema,
      logoPath: z.string().optional(),
      forbiddenPhrases: z.array(z.string()).optional(),
      preferredCTA: z.array(z.string()).optional(),
      proofPoints: z.array(z.string()).optional(),
      guarantees: z.array(z.string()).optional(),
      commonOffers: z.array(z.string()).optional(),
    },
    async (args) => {
      const saved = brandStore.upsert({
        businessName: args.businessName,
        industry: args.industry,
        targetAudience: args.targetAudience,
        brandVoice: args.brandVoice,
        colours: args.colours,
        fonts: args.fonts,
        logoPath: args.logoPath,
        forbiddenPhrases: args.forbiddenPhrases ?? [],
        preferredCTA: args.preferredCTA ?? [],
        proofPoints: args.proofPoints ?? [],
        guarantees: args.guarantees ?? [],
        commonOffers: args.commonOffers ?? [],
      });
      return {
        content: [{ type: 'text', text: `Brand profile saved.\n\n${summarizeBrand(saved)}` }],
      };
    }
  );

  server.tool(
    'update_brand_profile',
    'Update an existing brand profile by id. Only the fields you pass are changed; everything else is kept.',
    {
      id: z.string(),
      businessName: z.string().optional(),
      industry: z.string().optional(),
      targetAudience: z.string().optional(),
      brandVoice: z.string().optional(),
      colours: BrandColoursSchema.partial().optional(),
      fonts: BrandFontsSchema.partial().optional(),
      logoPath: z.string().optional(),
      forbiddenPhrases: z.array(z.string()).optional(),
      preferredCTA: z.array(z.string()).optional(),
      proofPoints: z.array(z.string()).optional(),
      guarantees: z.array(z.string()).optional(),
      commonOffers: z.array(z.string()).optional(),
    },
    async (args) => {
      const existing = brandStore.get(args.id);
      if (!existing) {
        return { content: [{ type: 'text', text: `No brand profile found with id ${args.id}.` }], isError: true };
      }
      const merged = {
        ...existing,
        businessName: args.businessName ?? existing.businessName,
        industry: args.industry ?? existing.industry,
        targetAudience: args.targetAudience ?? existing.targetAudience,
        brandVoice: args.brandVoice ?? existing.brandVoice,
        logoPath: args.logoPath ?? existing.logoPath,
        forbiddenPhrases: args.forbiddenPhrases ?? existing.forbiddenPhrases,
        preferredCTA: args.preferredCTA ?? existing.preferredCTA,
        proofPoints: args.proofPoints ?? existing.proofPoints,
        guarantees: args.guarantees ?? existing.guarantees,
        commonOffers: args.commonOffers ?? existing.commonOffers,
        colours: { ...existing.colours, ...(args.colours ?? {}) },
        fonts: { ...existing.fonts, ...(args.fonts ?? {}) },
      };
      const saved = brandStore.upsert(merged);
      return { content: [{ type: 'text', text: `Brand profile updated.\n\n${summarizeBrand(saved)}` }] };
    }
  );

  server.tool(
    'get_brand_profile',
    'Retrieve a single brand profile by id.',
    { id: z.string() },
    async ({ id }) => {
      const b = brandStore.get(id);
      if (!b) return { content: [{ type: 'text', text: `No brand profile found with id ${id}.` }], isError: true };
      return { content: [{ type: 'text', text: summarizeBrand(b) }] };
    }
  );

  server.tool(
    'list_brand_profiles',
    'List all saved brand profiles (id, business name, industry).',
    {},
    async () => {
      const all = brandStore.list();
      if (!all.length) return { content: [{ type: 'text', text: 'No brand profiles saved yet. Create one with create_brand_profile.' }] };
      const lines = all.map((b) => `- ${b.businessName} (${b.industry}) — id: ${b.id}`);
      return { content: [{ type: 'text', text: `**${all.length} brand profile(s):**\n${lines.join('\n')}` }] };
    }
  );
}
