/**
 * CampaignConcept — one ad/content concept within a campaign. Mirrors the
 * real, working variant shape api/generate-ads.js already produces (forced
 * Claude tool call: framework, angleName, psychologicalTrigger, headline,
 * body, cta, visualDirection, abHypothesis), extended with Prompt 7's full
 * ad-concept field list so a concept generated today's way can be lifted
 * into this shape without losing information.
 */
import { z } from 'zod';
import { CampaignConceptIdSchema, CampaignIdSchema, AudienceIdSchema, OfferIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, ApprovableSchema, LineageSchema } from '../base';
import { PlatformSchema, CreativeFormatSchema } from '../enums';
import { AwarenessStageSchema } from './strategicBrief';

/**
 * Scoring breakdown — Prompt 7's nine dimensions. Never used to declare a
 * concept "winning" on its own (that requires verified performance data —
 * see PerformanceSnapshot); this is a pre-flight quality signal only.
 */
export const AdConceptScoreSchema = z.object({
  audienceRelevance: z.number().min(0).max(10),
  messageClarity: z.number().min(0).max(10),
  offerStrength: z.number().min(0).max(10),
  distinctiveness: z.number().min(0).max(10),
  brandAlignment: z.number().min(0).max(10),
  evidenceStrength: z.number().min(0).max(10),
  platformSuitability: z.number().min(0).max(10),
  complianceRisk: z.number().min(0).max(10),
  visualFeasibility: z.number().min(0).max(10),
});
export type AdConceptScore = z.infer<typeof AdConceptScoreSchema>;

export const CampaignConceptSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(ApprovableSchema)
  .merge(LineageSchema)
  .extend({
    id: CampaignConceptIdSchema,
    campaignId: CampaignIdSchema,
    audienceId: AudienceIdSchema,
    offerId: OfferIdSchema.optional(),
    awarenessStage: AwarenessStageSchema,
    objective: z.string().min(1),
    hook: z.string().min(1),
    headline: z.string().min(1),
    supportingCopy: z.string().optional(),
    cta: z.string().min(1),
    visualConcept: z.string().min(1),
    layoutPattern: z.string().optional(),
    emotionalDriver: z.string().optional(),
    /** Reference ad/pattern this concept drew from, or the copywriting
     *  framework used (AIDA/PAS/BAB/etc. — matches generate-ads.js's
     *  named frameworks) — evidence for *why* this concept was shaped this
     *  way, not proof it will perform. */
    evidenceOrReferencePattern: z.string().optional(),
    strategicRationale: z.string().min(1),
    testingHypothesis: z.string().min(1),
    platform: PlatformSchema,
    format: CreativeFormatSchema,
    score: AdConceptScoreSchema.optional(),
  });
export type CampaignConcept = z.infer<typeof CampaignConceptSchema>;
