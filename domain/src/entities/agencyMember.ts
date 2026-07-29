/**
 * AgencyMember — a seat. One row per person who counts against the
 * agency's purchased seat count (client_viewer rows are the documented
 * exception — see docs/audema-agency/DECISIONS.md #7; seat-counting logic
 * itself is a later phase, this only defines the shape and the
 * role -> permission table).
 */
import { z } from 'zod';
import { AgencyMemberIdSchema, AgencyIdSchema, UserIdSchema } from '../ids';
import { TimestampedSchema } from '../base';
import { AgencyRoleSchema, AgencyMemberStatusSchema, type Permission, type AgencyRole } from '../enums';

export const AgencyMemberSchema = TimestampedSchema.extend({
  id: AgencyMemberIdSchema,
  agencyId: AgencyIdSchema,
  userId: UserIdSchema,
  role: AgencyRoleSchema,
  status: AgencyMemberStatusSchema,
  joinedAt: z.string().datetime({ offset: true }),
});
export type AgencyMember = z.infer<typeof AgencyMemberSchema>;

/**
 * Permission table for each AgencyRole, built directly from the role
 * descriptions in the Agency Edition master prompt §3. Each role is NOT
 * modeled as a strict superset of the one "below" it the way WorkspaceRole
 * is (role.ts) — the master prompt's roles have real, deliberate carve-outs
 * (e.g. Account Manager can approve content but Marketing Specialist
 * cannot; Administrator manages clients but not billing) rather than a
 * clean seniority ladder, so each role's list is explicit rather than
 * additive. See docs/audema-agency/PERMISSIONS.md for the human-readable
 * table this must stay in sync with.
 *
 * Two things this table deliberately does NOT encode:
 *  - "Access all clients" vs "access assigned clients only" — that's
 *    ClientMemberAccess's job (clientMemberAccess.ts), not a permission.
 *    Owner/Administrator bypass ClientMemberAccess entirely (agency-wide
 *    access); every other role requires an explicit grant per client.
 *  - The Client Portal's own approve/comment/download actions (master
 *    prompt §11) — 'client_viewer' here only covers what that person can
 *    see through the *internal* app surface (nothing, in practice — they
 *    use the separate client portal), not the portal's own capabilities,
 *    which are a narrower, purpose-built surface added in a later phase.
 */
export const AGENCY_ROLE_PERMISSIONS: Readonly<Record<AgencyRole, readonly Permission[]>> = {
  owner: [
    'agency:manage', 'billing:manage', 'members:manage',
    'clients:create', 'clients:manage', 'clients:archive',
    'campaigns:create', 'campaigns:edit', 'campaigns:draft', 'campaigns:approve', 'campaigns:publish', 'campaigns:read',
    'analytics:read', 'reports:export', 'integrations:manage',
    'businessbrain:read', 'businessbrain:write',
    'competitors:read', 'competitors:write',
    'market:read', 'market:write',
    'strategy:read', 'strategy:write',
    'creative:read', 'creative:generate', 'content:generate',
    'crm:read', 'crm:write',
    'outreach:draft', 'outreach:send',
    'assets:read', 'assets:write',
  ],
  admin: [
    'members:manage',
    'clients:create', 'clients:manage',
    'campaigns:create', 'campaigns:edit', 'campaigns:draft', 'campaigns:approve', 'campaigns:publish', 'campaigns:read',
    'analytics:read', 'reports:export', 'integrations:manage',
    'businessbrain:read', 'businessbrain:write',
    'competitors:read', 'competitors:write',
    'market:read', 'market:write',
    'strategy:read', 'strategy:write',
    'creative:read', 'creative:generate', 'content:generate',
    'crm:read', 'crm:write',
    'outreach:draft', 'outreach:send',
    'assets:read', 'assets:write',
    // Deliberately absent: agency:manage, billing:manage, clients:archive —
    // "cannot transfer ownership or cancel the agency account unless
    // specifically authorised" (master prompt §3).
  ],
  account_manager: [
    'campaigns:create', 'campaigns:edit', 'campaigns:draft', 'campaigns:approve', 'campaigns:publish', 'campaigns:read',
    'analytics:read',
    'businessbrain:read', 'competitors:read', 'market:read', 'strategy:read',
    'creative:read', 'creative:generate', 'content:generate',
    'crm:read',
    'outreach:draft',
    'assets:read', 'assets:write',
    // Deliberately absent: billing:manage, clients:create/manage/archive,
    // members:manage, reports:export, integrations:manage — "cannot access
    // agency billing" and scope is per-assigned-client, not agency-wide.
  ],
  marketing_specialist: [
    'campaigns:create', 'campaigns:edit', 'campaigns:draft', 'campaigns:read',
    'businessbrain:read', 'competitors:read', 'market:read', 'strategy:read',
    'creative:read', 'creative:generate', 'content:generate',
    'crm:read',
    'assets:read', 'assets:write',
    // Deliberately absent: campaigns:approve/publish (approval sits with
    // Account Manager+), agency-level settings, billing.
  ],
  analyst: [
    'campaigns:read',
    'analytics:read', 'reports:export',
    'businessbrain:read', 'competitors:read', 'market:read', 'strategy:read',
    'assets:read',
    // Deliberately absent: campaigns:create/edit/draft/approve/publish
    // ("cannot launch campaigns"), billing.
  ],
  client_viewer: [
    // See the class doc comment above — real client-facing capability
    // lives in the separate Client Portal surface (master prompt §11),
    // not the internal Permission set. Kept minimal and read-only here.
    'campaigns:read',
    'analytics:read',
    'assets:read',
  ],
};

export function permissionsForAgencyRole(role: AgencyRole): readonly Permission[] {
  return AGENCY_ROLE_PERMISSIONS[role];
}

export function hasAgencyPermission(role: AgencyRole, permission: Permission): boolean {
  return AGENCY_ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles that bypass ClientMemberAccess entirely and can act on every
 *  client business under their agency without an explicit per-client
 *  grant — "Can: Access all clients" (Owner) / "Access all or assigned
 *  clients" (Administrator, agency-wide by default unless the agency
 *  chooses to restrict them via ClientMemberAccess anyway). */
export const AGENCY_WIDE_CLIENT_ACCESS_ROLES: ReadonlySet<AgencyRole> = new Set(['owner', 'admin']);
