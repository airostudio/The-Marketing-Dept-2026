/**
 * AuditLog — agency + client-scoped action log (master prompt §17).
 * Distinct from the existing admin_activity_log table (database/
 * admin-setup.sql), which logs platform-admin actions (user promote/
 * demote) and has no agency/client scoping concept at all. This is the
 * agency-tenancy equivalent, for agency member actions within their
 * agency/client-business scope.
 */
import { z } from 'zod';
import { AuditLogIdSchema, AgencyIdSchema, WorkspaceIdSchema, UserIdSchema } from '../ids';
import { ExtensionSchema } from '../base';

export const AuditLogSchema = z.object({
  id: AuditLogIdSchema,
  agencyId: AgencyIdSchema,
  clientBusinessId: WorkspaceIdSchema.optional(), // absent for agency-level (not client-specific) actions
  actorUserId: UserIdSchema,
  action: z.string().min(1), // e.g. "campaign.launched", "client.archived", "member.invited"
  resourceType: z.string().min(1),
  resourceId: z.string().uuid(),
  metadata: ExtensionSchema.default({}),
  ipAddress: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
