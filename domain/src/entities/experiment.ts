/**
 * Experiment — CRO/campaign experiments (Prompt 9). Real, working A/B
 * testing infrastructure already exists (supabase-ab-testing.sql, and
 * api/mcp.js's Convert.com-style experiment tooling) but scoped narrowly to
 * A/B test tracking, not this general hypothesis/guardrail/decision shape.
 * This does not replace that table — it's the shared contract new
 * experiment-authoring code should target; how it reconciles with the
 * existing visitors/conversions tables is a migration decision, not made
 * here.
 */
import { z } from 'zod';
import { ExperimentIdSchema, AudienceIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema } from '../base';

export const ExperimentResultSchema = z.object({
  primaryMetricValue: z.number(),
  /** Statistical confidence in the result, 0–1 — never asserted without a
   *  computed value; Marketing Memory (Prompt 9) must not treat an
   *  unresolved experiment as evidence either way. */
  confidence: z.number().min(0).max(1).optional(),
  guardrailMetricValues: z.record(z.number()).default({}),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const ExperimentDecisionSchema = z.enum(['ship', 'kill', 'iterate', 'inconclusive']);
export type ExperimentDecision = z.infer<typeof ExperimentDecisionSchema>;

export const ExperimentSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: ExperimentIdSchema,
  hypothesis: z.string().min(1),
  control: z.string().min(1),
  variation: z.string().min(1),
  primaryMetric: z.string().min(1),
  guardrailMetrics: z.array(z.string()).default([]),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }).optional(),
  audienceId: AudienceIdSchema.optional(),
  result: ExperimentResultSchema.optional(),
  decision: ExperimentDecisionSchema.optional(),
  /** The takeaway to feed into Marketing Memory once this experiment
   *  concludes — required before `decision` can be anything other than
   *  'inconclusive', enforced at the service layer (Prompt 9), not here. */
  learning: z.string().optional(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;
