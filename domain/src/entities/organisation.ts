/**
 * Organisation — the billing/ownership boundary. Per docs/audema-mcp/
 * DECISIONS.md #1 (confirmed by the project owner: one agency manages
 * multiple profiles, not multiple client organizations), this is NOT a new
 * table. It is a typed projection of the owning `profiles` row — the
 * account that holds `plan` and owns one or more workspaces
 * (intelligence_profiles). OrganisationId and the owning User's UserId are
 * the same underlying UUID; they are branded separately because a
 * workspace can have members (Users) who are not its owning Organisation.
 */
import { z } from 'zod';
import { OrganisationIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema } from '../base';

/**
 * Plan values — union of every plan string actually accepted somewhere in
 * the live schema today: database/supabase-schema.sql's profiles_plan_check
 * ('free'|'pro'|'enterprise'), admin-setup.sql's addition ('admin'), and
 * intelligence-profiles.js's PLAN_LIMITS keys ('basic'|'professional'|
 * 'agency'). Not narrowed to one canonical list here — that reconciliation
 * is a real, separate migration decision, not something to silently resolve
 * inside a type definition.
 */
export const PlanSchema = z.enum([
  'free',
  'basic',
  'pro',
  'professional',
  'agency',
  'enterprise',
  'admin',
]);
export type Plan = z.infer<typeof PlanSchema>;

export const OrganisationSchema = TimestampedSchema.extend({
  id: OrganisationIdSchema,
  /** The individual account that owns billing for this organisation —
   *  equal to `id` today (profiles.id), kept distinct in the type so
   *  workspace-membership logic never has to special-case "the owner". */
  ownerUserId: UserIdSchema,
  name: z.string().min(1).max(200),
  plan: PlanSchema,
  /** intelligence_profiles.intel_profile_limit — only meaningful for the
   *  'enterprise' plan today (admin-configured); null otherwise. */
  workspaceLimitOverride: z.number().int().positive().nullable().optional(),
});
export type Organisation = z.infer<typeof OrganisationSchema>;
