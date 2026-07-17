/**
 * Competitor — formalizes the real, working CompetitiveRadar class shape
 * (web/js/intelligence-engine.js) which today is localStorage-only with no
 * evidence discipline. This adds the Evidenced mixin to every observation
 * (Prompt 5: "separate observed facts from Audema's interpretation... record
 * source, date and retrieval time... detect stale data").
 */
import { z } from 'zod';
import { CompetitorIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, EvidencedSchema } from '../base';

export const CompetitorProfileSchema = z.object({
  positioning: z.string().optional(),
  targetAudience: z.string().optional(),
  keyMessages: z.array(z.string()).default([]),
  tone: z.string().optional(),
});
export type CompetitorProfile = z.infer<typeof CompetitorProfileSchema>;

/** A single observed move — an ad seen, a pricing change, a launch —
 *  carries its own evidence, not the competitor row's evidence, because
 *  different moves can be observed at different times with different
 *  confidence. */
export const CompetitorMoveSchema = EvidencedSchema.extend({
  id: z.string().uuid(),
  observedAt: z.string().datetime({ offset: true }),
  type: z.enum(['content', 'pricing', 'product', 'positioning', 'campaign', 'other']),
  description: z.string().min(1),
  /**
   * Long runtime/visibility/frequency of an ad is a signal, never proof of
   * profitability, per Prompt 5's explicit evidence rule. This field can
   * only ever be filled with a real, cited performance data point — never
   * inferred from "it's been running a while."
   */
  verifiedPerformanceNote: z.string().optional(),
});
export type CompetitorMove = z.infer<typeof CompetitorMoveSchema>;

export const CompetitorGapSchema = EvidencedSchema.extend({
  id: z.string().uuid(),
  gap: z.string().min(1),
  opportunity: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low']),
});
export type CompetitorGap = z.infer<typeof CompetitorGapSchema>;

export const CompetitorSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: CompetitorIdSchema,
  name: z.string().min(1),
  url: z.string().url().optional(),
  profile: CompetitorProfileSchema,
  recentMoves: z.array(CompetitorMoveSchema).default([]),
  gaps: z.array(CompetitorGapSchema).default([]),
  /** When this competitor's profile/moves were last refreshed — the basis
   *  for staleness detection (Prompt 5: "avoid presenting an old
   *  observation as current"). Callers should treat any read where
   *  lastObservedAt is older than a workspace-configured threshold as
   *  stale and label it accordingly, not silently present it as current. */
  lastObservedAt: z.string().datetime({ offset: true }).optional(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;
