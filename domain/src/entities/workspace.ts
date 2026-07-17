/**
 * Workspace — one business's complete marketing/intelligence context. Maps
 * directly onto the live `intelligence_profiles` table (see
 * supabase-intelligence-profiles.sql) per docs/audema-mcp/DECISIONS.md #1.
 * Every other domain entity in this package (other than Organisation, User,
 * Workspace itself) is scoped to exactly one Workspace via WorkspaceScoped.
 */
import { z } from 'zod';
import { WorkspaceIdSchema, OrganisationIdSchema } from '../ids';
import { TimestampedSchema } from '../base';

export const WorkspaceSchema = TimestampedSchema.extend({
  id: WorkspaceIdSchema,
  organisationId: OrganisationIdSchema,
  name: z.string().min(1).max(200),
  businessName: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
