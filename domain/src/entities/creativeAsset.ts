/**
 * CreativeAsset — the rendered output. Matches social_posts' real,
 * production image_url / image_render_status columns
 * (supabase-social-posts.sql), extended with the full lineage chain Prompt
 * 7 requires (BusinessBrain version, brief, campaign, concept,
 * specification, template, renderer version, image-generation model,
 * approval state) — today's `metadata` JSONB column on social_posts covers
 * only part of this informally; this is the typed replacement for that
 * ad-hoc blob, per "no untyped JSON blobs... unless there is a documented
 * extension field."
 */
import { z } from 'zod';
import { CreativeAssetIdSchema, CreativeSpecificationIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, ApprovableSchema, LineageSchema, ExtensionSchema } from '../base';

export const RenderStatusSchema = z.enum(['none', 'pending', 'rendered', 'failed']);
export type RenderStatus = z.infer<typeof RenderStatusSchema>;

export const CreativeAssetSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(ApprovableSchema)
  .merge(LineageSchema)
  .extend({
    id: CreativeAssetIdSchema,
    creativeSpecificationId: CreativeSpecificationIdSchema,
    renderStatus: RenderStatusSchema,
    /** Hosted URL (e.g. Supabase Storage — see api/render-social-image.js's
     *  optional upload path) preferred over a data: URI once one exists;
     *  required for any platform publish adapter that needs to fetch the
     *  image itself (Instagram/TikTok). */
    assetUrl: z.string().url().optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    renderError: z.string().optional(),
    /** Documented extension point — anything renderer-specific that
     *  doesn't warrant its own typed column yet. Never a substitute for a
     *  real field once something in here is relied on by more than one
     *  caller. */
    extension: ExtensionSchema.optional(),
  });
export type CreativeAsset = z.infer<typeof CreativeAssetSchema>;
