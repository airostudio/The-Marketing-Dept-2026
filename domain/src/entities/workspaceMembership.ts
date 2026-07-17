/**
 * WorkspaceMembership — maps directly onto intelligence_profile_members.
 * This is what gives one Organisation's Workspaces multiple Users (e.g. an
 * agency's teammates), distinct from account-wide AccountRole.
 */
import { z } from 'zod';
import { WorkspaceMembershipIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema, WorkspaceScopedSchema } from '../base';
import { WorkspaceRoleSchema } from '../enums';

export const WorkspaceMembershipSchema = TimestampedSchema.merge(WorkspaceScopedSchema).extend({
  id: WorkspaceMembershipIdSchema,
  userId: UserIdSchema,
  role: WorkspaceRoleSchema,
});
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;
