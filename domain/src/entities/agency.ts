/**
 * Agency — the tenancy root for Audema Agency Edition (docs/audema-agency/).
 * Owns billing (via AgencySubscription), members (AgencyMember), and one or
 * more client businesses (Workspace/intelligence_profiles with agencyId
 * set). Introduced by docs/audema-agency/DECISIONS.md #1, revising
 * docs/audema-mcp/DECISIONS.md #1's original "no new organization table"
 * call — seat-based Stripe billing genuinely needs a row to attach a
 * subscription to, which profiles.plan (a text column) cannot provide.
 */
import { z } from 'zod';
import { AgencyIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema } from '../base';
import { AgencyStatusSchema } from '../enums';

export const AgencyBrandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColour: z.string().optional(),
  secondaryColour: z.string().optional(),
  emailFooter: z.string().max(1000).optional(),
  reportHeader: z.string().max(500).optional(),
});
export type AgencyBranding = z.infer<typeof AgencyBrandingSchema>;

export const AgencySchema = TimestampedSchema.extend({
  id: AgencyIdSchema,
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  website: z.string().url().optional(),
  country: z.string().length(2).optional(), // ISO 3166-1 alpha-2
  timezone: z.string().optional(), // IANA timezone, e.g. "Australia/Brisbane"
  currency: z.string().length(3).default('USD'), // ISO 4217
  status: AgencyStatusSchema,
  ownerUserId: UserIdSchema,
  branding: AgencyBrandingSchema.default({}),
});
export type Agency = z.infer<typeof AgencySchema>;
