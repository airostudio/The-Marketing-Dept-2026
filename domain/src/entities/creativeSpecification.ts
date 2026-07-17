/**
 * CreativeSpecification — the deterministic rendering input. Matches
 * api/render-social-image.js's actual request shape almost exactly (that
 * endpoint already implements a real, working deterministic layout engine:
 * platform-aware canvas sizing, margin/safe-zone math, brand colours/fonts,
 * CTA pill styling) — formalized here as a persisted, versioned spec rather
 * than an ephemeral request body, so a CreativeAsset can point back at the
 * exact specification that produced it (lineage).
 */
import { z } from 'zod';
import { CreativeSpecificationIdSchema, CampaignConceptIdSchema, BrandProfileIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, VersionedSchema } from '../base';
import { PlatformSchema, CreativeFormatSchema } from '../enums';

/** Canvas dimensions per format — matches api/render-social-image.js's
 *  PLATFORM_SIZES and Prompt 7's four required dimensions exactly:
 *  square=1080x1080, portrait=1080x1350, story=1080x1920,
 *  landscape=1200x628. */
export const CANVAS_DIMENSIONS: Readonly<Record<z.infer<typeof CreativeFormatSchema>, { width: number; height: number }>> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 628 },
  story: { width: 1080, height: 1920 },
};

export const SafeZoneSchema = z.object({
  top: z.number().min(0),
  right: z.number().min(0),
  bottom: z.number().min(0),
  left: z.number().min(0),
});
export type SafeZone = z.infer<typeof SafeZoneSchema>;

export const CreativeSpecificationSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(VersionedSchema)
  .extend({
    id: CreativeSpecificationIdSchema,
    campaignConceptId: CampaignConceptIdSchema,
    brandProfileId: BrandProfileIdSchema.optional(),
    platform: PlatformSchema,
    format: CreativeFormatSchema,
    headline: z.string().min(1).max(200),
    subheadline: z.string().max(240).optional(),
    cta: z.string().max(60).optional(),
    proofPoint: z.string().max(160).optional(),
    urgencyLine: z.string().max(100).optional(),
    disclaimer: z.string().max(300).optional(),
    visualDirection: z.string().max(300).optional(),
    /** Product/uploaded image reference — never the source of rendered
     *  text (Prompt 7: "Do not use generated imagery to render critical
     *  text"); text is always drawn programmatically by the renderer. */
    productImageUrl: z.string().url().optional(),
    logoPlacement: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'none']).default('top-left'),
    safeZone: SafeZoneSchema.optional(),
    templateId: z.string().min(1),
  });
export type CreativeSpecification = z.infer<typeof CreativeSpecificationSchema>;
