/**
 * Agency-layer isolation, on top of workspaceIsolation.ts. Two distinct
 * guarantees this program requires:
 *   1. Agency isolation — one agency's client businesses are never visible
 *      to another agency (same shape as workspace isolation, one level up).
 *   2. Per-member client access — within an agency, most roles can only
 *      touch the client businesses they've been explicitly granted access
 *      to via ClientMemberAccess; Owner/Administrator bypass this by
 *      design (AGENCY_WIDE_CLIENT_ACCESS_ROLES).
 */
import type { AgencyId, WorkspaceId, AgencyMemberId } from './ids';
import type { AgencyMember } from './entities/agencyMember';
import { AGENCY_WIDE_CLIENT_ACCESS_ROLES } from './entities/agencyMember';
import type { ClientMemberAccess } from './entities/clientMemberAccess';
import type { Workspace } from './entities/workspace';

export class CrossAgencyAccessError extends Error {
  constructor(recordAgencyId: AgencyId, callerAgencyId: AgencyId) {
    super(
      `Refusing cross-agency access: record belongs to agency ${recordAgencyId}, ` +
        `caller is authorized for agency ${callerAgencyId}.`
    );
    this.name = 'CrossAgencyAccessError';
  }
}

export class ClientAccessDeniedError extends Error {
  constructor(agencyMemberId: AgencyMemberId, clientBusinessId: WorkspaceId) {
    super(
      `Agency member ${agencyMemberId} has not been granted access to client business ${clientBusinessId}.`
    );
    this.name = 'ClientAccessDeniedError';
  }
}

/** Throws CrossAgencyAccessError if `clientBusiness.agencyId` doesn't match
 *  the caller's authorized agency. Mirrors assertWorkspaceScope exactly,
 *  one tenancy layer up. */
export function assertAgencyScope(clientBusiness: Workspace, callerAgencyId: AgencyId): Workspace {
  if (clientBusiness.agencyId !== callerAgencyId) {
    throw new CrossAgencyAccessError(clientBusiness.agencyId as AgencyId, callerAgencyId);
  }
  return clientBusiness;
}

/** Filters a list of client businesses down to only those belonging to
 *  `callerAgencyId` — the read-path equivalent for listing operations. */
export function filterByAgency(clientBusinesses: readonly Workspace[], callerAgencyId: AgencyId): Workspace[] {
  return clientBusinesses.filter((cb) => cb.agencyId === callerAgencyId);
}

/**
 * Whether `member` can act on `clientBusinessId` — true if their role
 * bypasses per-client grants entirely (Owner/Administrator), otherwise
 * only if a matching ClientMemberAccess row exists. This is the one
 * function every real client-context-resolution service (Phase 3) must
 * call before trusting ANY client selection — never infer access from a
 * client ID the frontend supplies on its own (master prompt §5: "The
 * active client must never be inferred only from a URL or frontend state").
 */
export function canAgencyMemberAccessClient(
  member: Pick<AgencyMember, 'id' | 'role' | 'agencyId'>,
  clientBusinessId: WorkspaceId,
  grants: readonly ClientMemberAccess[]
): boolean {
  if (AGENCY_WIDE_CLIENT_ACCESS_ROLES.has(member.role)) return true;
  return grants.some(
    (g) => g.agencyMemberId === member.id && g.clientBusinessId === clientBusinessId
  );
}

/** Throws ClientAccessDeniedError if canAgencyMemberAccessClient() would
 *  return false — the assert-style counterpart for server-side actions
 *  that must fail loudly rather than silently filtering. */
export function assertAgencyMemberCanAccessClient(
  member: Pick<AgencyMember, 'id' | 'role' | 'agencyId'>,
  clientBusinessId: WorkspaceId,
  grants: readonly ClientMemberAccess[]
): void {
  if (!canAgencyMemberAccessClient(member, clientBusinessId, grants)) {
    throw new ClientAccessDeniedError(member.id, clientBusinessId);
  }
}

/** Returns only the client businesses (already agency-filtered) that
 *  `member` is actually permitted to see — combines both isolation layers
 *  in the one call a client-switcher/directory UI should use. */
export function listAccessibleClientBusinesses(
  member: Pick<AgencyMember, 'id' | 'role' | 'agencyId'>,
  allClientBusinessesInAgency: readonly Workspace[],
  grants: readonly ClientMemberAccess[]
): Workspace[] {
  return filterByAgency(allClientBusinessesInAgency, member.agencyId).filter((cb) =>
    canAgencyMemberAccessClient(member, cb.id, grants)
  );
}
