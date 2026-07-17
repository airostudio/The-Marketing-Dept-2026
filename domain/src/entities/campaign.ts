/**
 * Campaign — the container Campaign Architect (Prompt 6) builds a plan
 * around. Maps loosely onto the live `marketing_campaigns` table (database/
 * supabase-schema.sql) which is a flat row today with none of this
 * richness — the channel plan / content matrix / timeline / deliverables
 * structure below is net-new (see docs/audema-mcp/IMPLEMENTATION_STATUS.md,
 * Prompt 6 row).
 *
 * Prompt 6's rule: "A production service must not create campaign assets
 * without a strategic brief ID unless the request is explicitly classified
 * as an unstructured draft." Modeled as a discriminated union so that rule
 * is enforced by the type system, not a runtime `if` a caller could forget:
 * a 'structured' campaign is required to carry a strategicBriefId; a
 * 'unstructured_draft' campaign is explicitly not required to.
 */
import { z } from 'zod';
import { CampaignIdSchema, StrategicBriefIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, VersionedSchema, ApprovableSchema } from '../base';
import { PlatformSchema } from '../enums';

export const ChannelPlanEntrySchema = z.object({
  platform: PlatformSchema,
  objective: z.string().min(1),
  budgetNote: z.string().optional(),
});
export type ChannelPlanEntry = z.infer<typeof ChannelPlanEntrySchema>;

export const ContentMatrixEntrySchema = z.object({
  platform: PlatformSchema,
  contentType: z.string().min(1),
  cadence: z.string().optional(),
});
export type ContentMatrixEntry = z.infer<typeof ContentMatrixEntrySchema>;

export const CampaignTimelineEntrySchema = z.object({
  label: z.string().min(1),
  date: z.string().datetime({ offset: true }),
});
export type CampaignTimelineEntry = z.infer<typeof CampaignTimelineEntrySchema>;

const CampaignBaseSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(VersionedSchema)
  .merge(ApprovableSchema)
  .extend({
    id: CampaignIdSchema,
    name: z.string().min(1),
    channelPlan: z.array(ChannelPlanEntrySchema).default([]),
    contentMatrix: z.array(ContentMatrixEntrySchema).default([]),
    offerSequence: z.array(z.string().uuid()).default([]),
    timeline: z.array(CampaignTimelineEntrySchema).default([]),
  });

export const CampaignSchema = z.discriminatedUnion('kind', [
  CampaignBaseSchema.extend({ kind: z.literal('structured'), strategicBriefId: StrategicBriefIdSchema }),
  CampaignBaseSchema.extend({ kind: z.literal('unstructured_draft'), strategicBriefId: StrategicBriefIdSchema.optional() }),
]);
export type Campaign = z.infer<typeof CampaignSchema>;
