/**
 * MarketSignal — formalizes the MarketPulse class shape (web/js/
 * intelligence-engine.js), not fully audited this pass (see
 * docs/audema-mcp/CURRENT_ARCHITECTURE.md §16 — marked UNCERTAIN). Modeled
 * conservatively: a signal is evidence-carrying, never presented as
 * "proof" of anything by itself (Prompt 5's evidence rules apply here
 * identically to Competitor).
 */
import { z } from 'zod';
import { MarketSignalIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, EvidencedSchema } from '../base';

export const MarketSignalSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(EvidencedSchema)
  .extend({
    id: MarketSignalIdSchema,
    theme: z.string().min(1),
    type: z.enum(['emerging_theme', 'seasonal_opportunity', 'industry_change', 'other']),
    description: z.string().min(1),
    detectedAt: z.string().datetime({ offset: true }),
    /** Distinct from `retrievedAt` (Evidenced) — a signal can be detected
     *  from source material that was retrieved earlier than the moment
     *  Audema's analysis flagged it as significant. */
    relevantIndustries: z.array(z.string()).default([]),
  });
export type MarketSignal = z.infer<typeof MarketSignalSchema>;
