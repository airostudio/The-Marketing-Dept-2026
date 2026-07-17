/**
 * Offer — genuinely new (no dedicated Offer entity exists anywhere in the
 * audited repo; ad/content generation today takes ad-hoc free-text
 * "product"/"offer" strings per request — see api/generate-ads.js). Built
 * from the fields commonOffers/guarantees/preferredCta already establish a
 * need for in audema-adforge-mcp's BrandProfileSchema, formalized as its
 * own addressable entity.
 */
import { z } from 'zod';
import { OfferIdSchema, AudienceIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, VersionedSchema, ApprovableSchema } from '../base';

export const OfferSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(VersionedSchema)
  .merge(ApprovableSchema)
  .extend({
    id: OfferIdSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    /** Real, factual guarantee(s) this business actually offers — must not
     *  be generated without evidence; see BrandProfile.claimsRequiringEvidence
     *  for the enforcement point. */
    guarantees: z.array(z.string()).default([]),
    priceDescription: z.string().optional(),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validUntil: z.string().datetime({ offset: true }).optional(),
    targetAudienceIds: z.array(AudienceIdSchema).default([]),
  });
export type Offer = z.infer<typeof OfferSchema>;
