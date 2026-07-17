/**
 * PerformanceSnapshot — an ingested point-in-time read from an ad/analytics
 * platform (Prompt 9's ingestPerformanceSnapshot). web/js/api-connector.js
 * already has real, working read-only Meta/LinkedIn/Twitter/TikTok Graph
 * API wrappers this would ingest from. The three-way split below
 * (raw/calculated/estimated) is Prompt 9's explicit requirement: "Metrics
 * should clearly distinguish between raw platform data, calculated
 * metrics, estimated metrics, and inferred explanations" — modeled as
 * separate fields so a consumer can never accidentally treat an estimate
 * as a fact the platform actually reported.
 */
import { z } from 'zod';
import { PerformanceSnapshotIdSchema, CampaignIdSchema, CampaignConceptIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema } from '../base';
import { PlatformSchema } from '../enums';

/** Numbers the platform's API returned verbatim — never recomputed. */
export const RawPlatformMetricsSchema = z.record(z.number());
export type RawPlatformMetrics = z.infer<typeof RawPlatformMetricsSchema>;

/** Numbers Audema derived deterministically from raw metrics (e.g. CTR =
 *  clicks / impressions) — reproducible from the raw data alone. */
export const CalculatedMetricsSchema = z.record(z.number());
export type CalculatedMetrics = z.infer<typeof CalculatedMetricsSchema>;

/** Numbers Audema approximated where the platform doesn't report them
 *  directly (e.g. a modeled conversion count) — must carry a method note
 *  so the estimate's basis is inspectable, never presented as raw fact. */
export const EstimatedMetricSchema = z.object({
  value: z.number(),
  method: z.string().min(1),
});
export const EstimatedMetricsSchema = z.record(EstimatedMetricSchema);
export type EstimatedMetrics = z.infer<typeof EstimatedMetricsSchema>;

export const PerformanceSnapshotSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: PerformanceSnapshotIdSchema,
  campaignId: CampaignIdSchema.optional(),
  campaignConceptId: CampaignConceptIdSchema.optional(),
  platform: PlatformSchema,
  capturedAt: z.string().datetime({ offset: true }),
  raw: RawPlatformMetricsSchema,
  calculated: CalculatedMetricsSchema.default({}),
  estimated: EstimatedMetricsSchema.default({}),
});
export type PerformanceSnapshot = z.infer<typeof PerformanceSnapshotSchema>;
