/**
 * StrategicBrief — the strategy layer between research and production
 * (Prompt 6). A `StrategicBrief` class already exists (web/js/
 * intelligence-engine.js) — this formalizes its shape with the full field
 * list Prompt 6 specifies, which was not confirmed to already be present
 * in full (see docs/audema-mcp/CURRENT_ARCHITECTURE.md §17, marked
 * UNCERTAIN).
 */
import { z } from 'zod';
import { StrategicBriefIdSchema, AudienceIdSchema, OfferIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, VersionedSchema, ApprovableSchema } from '../base';
import { PlatformSchema } from '../enums';

export const AwarenessStageSchema = z.enum([
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
]);
export type AwarenessStage = z.infer<typeof AwarenessStageSchema>;

export const MeasurementPlanSchema = z.object({
  primaryMetric: z.string().min(1),
  guardrailMetrics: z.array(z.string()).default([]),
});
export type MeasurementPlan = z.infer<typeof MeasurementPlanSchema>;

export const StrategicBriefSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(VersionedSchema)
  .merge(ApprovableSchema)
  .extend({
    id: StrategicBriefIdSchema,
    objective: z.string().min(1),
    productOrService: z.string().min(1),
    audienceId: AudienceIdSchema,
    awarenessStage: AwarenessStageSchema,
    currentCustomerBelief: z.string().min(1),
    desiredCustomerBelief: z.string().min(1),
    coreProblem: z.string().min(1),
    valueProposition: z.string().min(1),
    reasonToBelieve: z.string().min(1),
    offerId: OfferIdSchema.optional(),
    primaryMessage: z.string().min(1),
    supportingMessages: z.array(z.string()).default([]),
    campaignAngle: z.string().min(1),
    channelRecommendations: z.array(PlatformSchema).default([]),
    creativeRecommendations: z.array(z.string()).default([]),
    evidence: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([]),
    measurementPlan: MeasurementPlanSchema,
    /** The single hypothesis this brief exists to test — required, per
     *  Prompt 6's "every campaign plan should maintain a clear hypothesis"
     *  and the worked example in that prompt. */
    campaignHypothesis: z.string().min(1),
    /** 0–100, produced by scoreStrategicBrief — not part of the brief's
     *  own authored content, kept optional since a freshly-created brief
     *  hasn't been scored yet. */
    score: z.number().min(0).max(100).optional(),
  });
export type StrategicBrief = z.infer<typeof StrategicBriefSchema>;
