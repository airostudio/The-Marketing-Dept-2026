import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdAngleTypeSchema, PlatformSizeSchema } from '../types.js';
import { conceptStore, briefStore, brandStore } from '../storage/index.js';
import { scoreConcept, explainScores } from '../prompts/scoring.js';

const ConceptInputSchema = z.object({
  id: z.string().optional().describe('Pass the existing concept id to update it; omit to create a new one'),
  briefId: z.string(),
  conceptName: z.string(),
  angleType: AdAngleTypeSchema,
  targetEmotion: z.string(),
  customerPainPoint: z.string(),
  hook: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  cta: z.string(),
  proofPoint: z.string().optional(),
  urgencyLine: z.string().optional(),
  visualDirection: z.string(),
  layoutNotes: z.string().optional(),
  platformSize: PlatformSizeSchema.default('square'),
  conversionRationale: z.string(),
  abTestSuggestion: z.string().optional(),
});

function summarizeConcept(c: ReturnType<typeof conceptStore.list>[number]): string {
  const lines = [
    `### ${c.conceptName}  (${c.angleType}, ${c.platformSize})  — id: ${c.id}`,
    `Emotion: ${c.targetEmotion} | Pain point: ${c.customerPainPoint}`,
    `Hook: ${c.hook}`,
    `Headline: ${c.headline}`,
    `Subheadline: ${c.subheadline}`,
    `CTA: ${c.cta}`,
  ];
  if (c.proofPoint) lines.push(`Proof: ${c.proofPoint}`);
  if (c.urgencyLine) lines.push(`Urgency: ${c.urgencyLine}`);
  lines.push(`Visual direction: ${c.visualDirection}`);
  if (c.layoutNotes) lines.push(`Layout notes: ${c.layoutNotes}`);
  lines.push(`Why it converts: ${c.conversionRationale}`);
  if (c.abTestSuggestion) lines.push(`A/B suggestion: ${c.abTestSuggestion}`);
  if (c.scores) lines.push(`Scores:\n${explainScores(c.scores)}`);
  return lines.join('\n');
}

export function registerConceptTools(server: McpServer) {
  server.tool(
    'save_ad_concepts',
    'Submit one or more fully-written ad concepts for a brief. Each concept is validated, automatically scored (clarity, conversion intent, emotional pull, visual simplicity, platform fit, CTA strength), and persisted. Pass an existing concept id to revise it in place (e.g. after generate_ad_copy guidance).',
    {
      concepts: z.array(ConceptInputSchema).min(1),
    },
    async (args) => {
      const brand = (() => {
        const firstBrief = briefStore.get(args.concepts[0]?.briefId);
        return firstBrief?.brandProfileId ? brandStore.get(firstBrief.brandProfileId) : undefined;
      })();

      const saved = args.concepts.map((input) => {
        const brief = briefStore.get(input.briefId);
        if (!brief) throw new Error(`No ad brief found with id ${input.briefId}`);

        const conceptBrand = brief.brandProfileId ? brandStore.get(brief.brandProfileId) : brand;
        const scores = scoreConcept(input, conceptBrand);
        return conceptStore.upsert({ ...input, scores });
      });

      const text = `Saved ${saved.length} concept(s).\n\n${saved.map(summarizeConcept).join('\n\n')}`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'score_ad_concepts',
    'Re-score one or more existing concepts (or all concepts for a brief) and return a breakdown against the six criteria: clarity, conversion intent, emotional pull, visual simplicity, platform fit, CTA strength. Use this after editing a concept, or to rank concepts before picking a winner to export.',
    {
      briefId: z.string().optional().describe('Score all concepts for this brief'),
      conceptIds: z.array(z.string()).optional().describe('Score specific concepts by id'),
    },
    async (args) => {
      let targets = args.conceptIds?.map((id) => conceptStore.get(id)).filter(Boolean) as ReturnType<typeof conceptStore.list> | undefined;
      if (!targets && args.briefId) targets = conceptStore.find((c) => c.briefId === args.briefId);
      if (!targets || !targets.length) {
        return { content: [{ type: 'text', text: 'No matching concepts found. Provide briefId or conceptIds.' }], isError: true };
      }

      const rescored = targets.map((c) => {
        const brief = briefStore.get(c.briefId);
        const brand = brief?.brandProfileId ? brandStore.get(brief.brandProfileId) : undefined;
        const scores = scoreConcept(c, brand);
        return conceptStore.upsert({ ...c, scores });
      });

      const ranked = [...rescored].sort((a, b) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0));
      const lines = ranked.map(
        (c, i) => `${i + 1}. **${c.conceptName}** (${c.angleType}) — overall ${c.scores?.overall}/10\n${explainScores(c.scores!)}`
      );
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'get_ad_concept',
    'Retrieve one ad concept by id, with its full copy, visual direction, and scores.',
    { conceptId: z.string() },
    async ({ conceptId }) => {
      const c = conceptStore.get(conceptId);
      if (!c) return { content: [{ type: 'text', text: `No concept found with id ${conceptId}.` }], isError: true };
      return { content: [{ type: 'text', text: summarizeConcept(c) }] };
    }
  );

  server.tool(
    'list_ad_concepts',
    'List all ad concepts for a brief, with their angle type, headline, and overall score.',
    { briefId: z.string() },
    async ({ briefId }) => {
      const concepts = conceptStore.find((c) => c.briefId === briefId);
      if (!concepts.length) return { content: [{ type: 'text', text: 'No concepts saved for this brief yet.' }] };
      const lines = concepts
        .sort((a, b) => (b.scores?.overall ?? 0) - (a.scores?.overall ?? 0))
        .map((c) => `- **${c.conceptName}** (${c.angleType}, ${c.platformSize}) — "${c.headline}" — overall ${c.scores?.overall ?? 'not scored'}/10 — id: ${c.id}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
