/**
 * Audience — an ICP/buyer segment. Mirrors the shape already live in
 * BusinessBrain's `icp` object (web/js/intelligence-engine.js) — primary
 * buyer role/company size/industry, pain points, reason-chose, biggest
 * fear — formalized as its own addressable entity so Strategic Briefs,
 * Campaigns, and Creative Concepts can reference a specific AudienceId
 * instead of embedding a copy of ICP text each time.
 */
import { z } from 'zod';
import { AudienceIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, VersionedSchema, ApprovableSchema } from '../base';

export const PrimaryBuyerSchema = z.object({
  role: z.string().min(1),
  companySize: z.string().optional(),
  industry: z.string().optional(),
});
export type PrimaryBuyer = z.infer<typeof PrimaryBuyerSchema>;

export const AudienceSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(VersionedSchema)
  .merge(ApprovableSchema)
  .extend({
    id: AudienceIdSchema,
    name: z.string().min(1),
    primaryBuyer: PrimaryBuyerSchema,
    painPoints: z.array(z.string()).default([]),
    purchaseTriggers: z.array(z.string()).default([]),
    objections: z.array(z.string()).default([]),
    switchingFears: z.array(z.string()).default([]),
    /** Why they chose us / desired outcome — matches BusinessBrain's
     *  icp.reasonChose field. */
    reasonChose: z.string().optional(),
    biggestFear: z.string().optional(),
    geographicMarkets: z.array(z.string()).default([]),
  });
export type Audience = z.infer<typeof AudienceSchema>;
