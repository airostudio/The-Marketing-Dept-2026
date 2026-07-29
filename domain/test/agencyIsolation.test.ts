import { describe, it, expect } from 'vitest';
import {
  assertAgencyScope,
  filterByAgency,
  canAgencyMemberAccessClient,
  assertAgencyMemberCanAccessClient,
  listAccessibleClientBusinesses,
  CrossAgencyAccessError,
  ClientAccessDeniedError,
  WorkspaceSchema,
  type Workspace,
  type AgencyId,
  type AgencyMemberId,
  type WorkspaceId,
} from '../src/index';

const AGENCY_A = '11111111-1111-4111-8111-111111111111' as AgencyId;
const AGENCY_B = '22222222-2222-4222-8222-222222222222' as AgencyId;

function makeClientBusiness(agencyId: AgencyId, name: string): Workspace {
  return WorkspaceSchema.parse({
    id: crypto.randomUUID(),
    agencyId,
    name,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
}

describe('assertAgencyScope / filterByAgency', () => {
  it('allows access when the client business belongs to the caller\'s agency', () => {
    const cb = makeClientBusiness(AGENCY_A, 'Acme Client');
    expect(assertAgencyScope(cb, AGENCY_A)).toBe(cb);
  });

  it('throws CrossAgencyAccessError when the client business belongs to a different agency', () => {
    const cb = makeClientBusiness(AGENCY_A, 'Acme Client');
    expect(() => assertAgencyScope(cb, AGENCY_B)).toThrow(CrossAgencyAccessError);
  });

  it('filters a mixed list down to only the caller\'s agency\'s client businesses', () => {
    const cbA1 = makeClientBusiness(AGENCY_A, 'A Client 1');
    const cbA2 = makeClientBusiness(AGENCY_A, 'A Client 2');
    const cbB1 = makeClientBusiness(AGENCY_B, 'B Client 1');

    const result = filterByAgency([cbA1, cbA2, cbB1], AGENCY_A);
    expect(result).toEqual([cbA1, cbA2]);
  });
});

describe('per-member client access', () => {
  const OWNER_MEMBER_ID = '33333333-3333-4333-8333-333333333333' as AgencyMemberId;
  const RESTRICTED_MEMBER_ID = '44444444-4444-4444-8444-444444444444' as AgencyMemberId;
  const CLIENT_ID = '55555555-5555-4555-8555-555555555555' as WorkspaceId;
  const OTHER_CLIENT_ID = '66666666-6666-4666-8666-666666666666' as WorkspaceId;

  const owner = { id: OWNER_MEMBER_ID, role: 'owner' as const, agencyId: AGENCY_A };
  const marketingSpecialist = { id: RESTRICTED_MEMBER_ID, role: 'marketing_specialist' as const, agencyId: AGENCY_A };

  it('owner/admin roles bypass ClientMemberAccess entirely, even with zero grants', () => {
    expect(canAgencyMemberAccessClient(owner, CLIENT_ID, [])).toBe(true);
    expect(canAgencyMemberAccessClient(owner, OTHER_CLIENT_ID, [])).toBe(true);
  });

  it('non-bypass roles are denied access with no matching grant', () => {
    expect(canAgencyMemberAccessClient(marketingSpecialist, CLIENT_ID, [])).toBe(false);
    expect(() => assertAgencyMemberCanAccessClient(marketingSpecialist, CLIENT_ID, [])).toThrow(
      ClientAccessDeniedError
    );
  });

  it('non-bypass roles are allowed access once an explicit grant exists', () => {
    const grants = [
      {
        id: crypto.randomUUID() as any,
        agencyId: AGENCY_A,
        clientBusinessId: CLIENT_ID,
        agencyMemberId: RESTRICTED_MEMBER_ID,
        accessLevel: 'full' as any,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ];

    expect(canAgencyMemberAccessClient(marketingSpecialist, CLIENT_ID, grants)).toBe(true);
    expect(canAgencyMemberAccessClient(marketingSpecialist, OTHER_CLIENT_ID, grants)).toBe(false);
    expect(() => assertAgencyMemberCanAccessClient(marketingSpecialist, CLIENT_ID, grants)).not.toThrow();
  });

  it('listAccessibleClientBusinesses combines agency isolation and per-client grants', () => {
    const cbA1 = makeClientBusiness(AGENCY_A, 'A Client 1');
    const cbA2 = makeClientBusiness(AGENCY_A, 'A Client 2');
    const cbB1 = makeClientBusiness(AGENCY_B, 'B Client 1');
    const all = [cbA1, cbA2, cbB1];

    // Owner sees every client business in their own agency, none from another agency.
    expect(listAccessibleClientBusinesses(owner, all, [])).toEqual([cbA1, cbA2]);

    // Marketing specialist with a grant only for cbA1 sees just that one —
    // never cbB1, even if (hypothetically) a stray grant referenced it.
    const grants = [
      {
        id: crypto.randomUUID() as any,
        agencyId: AGENCY_A,
        clientBusinessId: cbA1.id,
        agencyMemberId: RESTRICTED_MEMBER_ID,
        accessLevel: 'full' as any,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ];
    expect(listAccessibleClientBusinesses(marketingSpecialist, all, grants)).toEqual([cbA1]);
  });
});
