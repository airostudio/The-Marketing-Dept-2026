/**
 * BrandProfile — visual and voice identity: colours, fonts, tone, and the
 * claims/phrases a brand must never/always use. A real, working version of
 * this shape already exists in audema-adforge-mcp/src/types.ts
 * (BrandProfileSchema) — reused here almost verbatim rather than invented
 * fresh, per "search for existing functionality before concluding it does
 * not exist." BusinessBrain (Prompt 3) is the richer aggregate that
 * references a BrandProfile, not a duplicate of it.
 */
import { z } from 'zod';
import { BrandProfileIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema, VersionedSchema, ApprovableSchema } from '../base';

export const BrandColoursSchema = z.object({
  primary: z.string(),
  secondary: z.string().optional(),
  accent: z.string().optional(),
  background: z.string().optional(),
  text: z.string().optional(),
});
export type BrandColours = z.infer<typeof BrandColoursSchema>;

export const BrandFontsSchema = z.object({
  heading: z.string(),
  body: z.string().optional(),
});
export type BrandFonts = z.infer<typeof BrandFontsSchema>;

export const BrandProfileSchema = TimestampedSchema.merge(WorkspaceScopedSchema)
  .merge(VersionedSchema)
  .merge(ApprovableSchema)
  .extend({
    id: BrandProfileIdSchema,
    businessName: z.string().min(1),
    brandVoice: z.string().min(1),
    colours: BrandColoursSchema,
    fonts: BrandFontsSchema,
    logoUrl: z.string().url().optional(),
    /** Claims requiring evidence before use — Prompt 3's explicit field. */
    claimsRequiringEvidence: z.array(z.string()).default([]),
    /** Approved marketing claims — safe to state without further evidence. */
    approvedClaims: z.array(z.string()).default([]),
    /** Prohibited language — never say. */
    forbiddenPhrases: z.array(z.string()).default([]),
    preferredCta: z.array(z.string()).default([]),
    proofPoints: z.array(z.string()).default([]),
  });
export type BrandProfile = z.infer<typeof BrandProfileSchema>;
