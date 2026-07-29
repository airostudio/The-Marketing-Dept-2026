/**
 * Workspace — one business's complete marketing/intelligence context. Maps
 * directly onto the live `intelligence_profiles` table (see
 * supabase-intelligence-profiles.sql) per docs/audema-mcp/DECISIONS.md #1.
 * Every other domain entity in this package (other than Organisation, User,
 * Workspace itself) is scoped to exactly one Workspace via WorkspaceScoped.
 *
 * Also referred to as "ClientBusiness" in docs/audema-agency/ (Agency
 * Edition) — same entity, same table, not a duplicate. Gained agencyId/
 * accountManagerUserId/status there (docs/audema-agency/DECISIONS.md #1,
 * #5) as a purely additive extension: every field below this point is
 * optional, and every existing row has agencyId = NULL, so an existing
 * single-business account behaves identically to before.
 *
 * Exactly one of organisationId / agencyId is expected to be set in
 * practice — organisationId for a standalone (non-agency) account,
 * agencyId for a client business owned by an Agency — enforced at the
 * service layer that creates these rows, not by the schema itself (kept as
 * two independent optional fields rather than a discriminated union here,
 * since a workspace predating Agency Edition has neither field required to
 * change).
 */
import { z } from 'zod';
import { WorkspaceIdSchema, OrganisationIdSchema, AgencyIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema } from '../base';
import { ClientBusinessStatusSchema } from '../enums';

export const WorkspaceSchema = TimestampedSchema.extend({
  id: WorkspaceIdSchema,
  organisationId: OrganisationIdSchema.optional(),
  agencyId: AgencyIdSchema.optional(),
  accountManagerUserId: UserIdSchema.optional(),
  status: ClientBusinessStatusSchema.default('active'),
  archivedAt: z.string().datetime({ offset: true }).optional(),
  name: z.string().min(1).max(200),
  businessName: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
