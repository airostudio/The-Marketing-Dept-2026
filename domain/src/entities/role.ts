/**
 * Role — the formal RBAC layer this program asks for, built on top of the
 * two role vocabularies that already exist live (AccountRole = profiles.role,
 * WorkspaceRole = intelligence_profile_members.role). ROLE_PERMISSIONS is
 * the single source of truth for "what can this role do" — see
 * docs/audema-mcp/PERMISSIONS.md for the human-readable version of this
 * same table, which must be kept in sync with it.
 */
import { z } from 'zod';
import { AccountRoleSchema, WorkspaceRoleSchema, type Permission } from '../enums';

export const RoleSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('account'), role: AccountRoleSchema }),
  z.object({ scope: z.literal('workspace'), role: WorkspaceRoleSchema }),
]);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Workspace-scoped roles grant a fixed permission set, each a strict
 * superset of the one below it (owner ⊇ editor ⊇ viewer) — encoded as
 * additive layers rather than duplicated lists, so adding a permission to
 * 'viewer' can never accidentally leave 'editor'/'owner' behind.
 */
const VIEWER_PERMISSIONS: readonly Permission[] = [
  'businessbrain:read',
  'competitors:read',
  'market:read',
  'strategy:read',
  'creative:read',
  'analytics:read',
  'campaigns:read',
  'crm:read',
  'assets:read',
];

const EDITOR_ONLY_PERMISSIONS: readonly Permission[] = [
  'strategy:write',
  'creative:generate',
  'content:generate',
  'campaigns:draft',
  'outreach:draft',
];

const OWNER_ONLY_PERMISSIONS: readonly Permission[] = [
  'businessbrain:write',
  'competitors:write',
  'market:write',
  'campaigns:publish',
  'crm:write',
  'outreach:send',
  'assets:write',
];

export const WORKSPACE_ROLE_PERMISSIONS: Readonly<Record<z.infer<typeof WorkspaceRoleSchema>, readonly Permission[]>> = {
  viewer: VIEWER_PERMISSIONS,
  editor: [...VIEWER_PERMISSIONS, ...EDITOR_ONLY_PERMISSIONS],
  owner: [...VIEWER_PERMISSIONS, ...EDITOR_ONLY_PERMISSIONS, ...OWNER_ONLY_PERMISSIONS],
};

/**
 * Account-wide roles are orthogonal to workspace roles: 'admin'/'super_admin'
 * grant platform administration (see api/admin-users.js), not automatic
 * access to every workspace's content — an admin still needs a
 * WorkspaceMembership (or the super_admin escape hatch, if one is ever
 * introduced) to read a specific workspace's BusinessBrain. This table is
 * intentionally NOT used to bypass workspace scoping; see
 * workspaceIsolation.ts.
 */
export const ACCOUNT_ROLE_PLATFORM_PERMISSIONS: Readonly<Record<z.infer<typeof AccountRoleSchema>, readonly string[]>> = {
  user: [],
  admin: ['platform:manage_users'],
  super_admin: ['platform:manage_users', 'platform:manage_admins'],
};

export function permissionsForWorkspaceRole(role: z.infer<typeof WorkspaceRoleSchema>): readonly Permission[] {
  return WORKSPACE_ROLE_PERMISSIONS[role];
}

export function hasPermission(role: z.infer<typeof WorkspaceRoleSchema>, permission: Permission): boolean {
  return WORKSPACE_ROLE_PERMISSIONS[role].includes(permission);
}
