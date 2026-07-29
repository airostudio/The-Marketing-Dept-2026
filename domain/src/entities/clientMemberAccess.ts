/**
 * ClientMemberAccess — grants one AgencyMember access to one specific
 * ClientBusiness (Workspace) within their agency. See
 * docs/audema-agency/DECISIONS.md #3 for why this is a new table rather
 * than an extension of intelligence_profile_members. Owner/Administrator
 * roles bypass this entirely (AGENCY_WIDE_CLIENT_ACCESS_ROLES in
 * agencyMember.ts); every other role needs an explicit row here per client.
 */
import { z } from 'zod';
import { ClientMemberAccessIdSchema, AgencyIdSchema, WorkspaceIdSchema, AgencyMemberIdSchema } from '../ids';
import { TimestampedSchema } from '../base';
import { ClientAccessLevelSchema } from '../enums';

export const ClientMemberAccessSchema = TimestampedSchema.extend({
  id: ClientMemberAccessIdSchema,
  agencyId: AgencyIdSchema,
  clientBusinessId: WorkspaceIdSchema,
  agencyMemberId: AgencyMemberIdSchema,
  accessLevel: ClientAccessLevelSchema,
});
export type ClientMemberAccess = z.infer<typeof ClientMemberAccessSchema>;
