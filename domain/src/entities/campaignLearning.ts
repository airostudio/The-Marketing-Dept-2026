/**
 * CampaignLearning — Marketing Memory's core record (Prompt 9). Does not
 * exist anywhere in the audited repo today — this is genuinely new. Its
 * entire purpose is to stop Audema recommending a previously-rejected or
 * failed idea again without new evidence, so `supersededBy`/`relatedExperimentId`
 * are first-class fields, not an afterthought — a consumer (Marketing
 * Memory's findRepeatedFailure) must be able to answer "has this exact
 * idea already failed" without re-deriving it from free text.
 */
import { z } from 'zod';
import { CampaignLearningIdSchema, CampaignIdSchema, ExperimentIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema } from '../base';

export const LearningOutcomeSchema = z.enum(['success', 'failure', 'inconclusive']);
export type LearningOutcome = z.infer<typeof LearningOutcomeSchema>;

export const CampaignLearningSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: CampaignLearningIdSchema,
  campaignId: CampaignIdSchema.optional(),
  relatedExperimentId: ExperimentIdSchema.optional(),
  /** A short, matchable statement of the idea itself (e.g. "urgency-based
   *  CTA copy for this audience") — deliberately separate from `narrative`
   *  so repeated-idea detection can match on this field without NLP over
   *  free text. */
  ideaSummary: z.string().min(1),
  outcome: LearningOutcomeSchema,
  /** The full "why" — explicitly NOT a claim of causation unless the
   *  learning came from a controlled Experiment; correlational
   *  observations must say so. */
  narrative: z.string().min(1),
  isCausal: z.boolean(),
  /** If a later learning revises or overturns this one, point forward
   *  rather than deleting — a superseded learning is still evidence that
   *  the idea was tried and reconsidered. */
  supersededByLearningId: CampaignLearningIdSchema.optional(),
});
export type CampaignLearning = z.infer<typeof CampaignLearningSchema>;
