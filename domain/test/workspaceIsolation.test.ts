import { describe, it, expect } from 'vitest';
import {
  WorkspaceScopedStore,
  assertWorkspaceScope,
  filterByWorkspace,
  CrossWorkspaceAccessError,
  CompetitorSchema,
  type Competitor,
  type WorkspaceId,
} from '../src/index';

// Two distinct workspaces, as if belonging to two different agency clients
// under the same Organisation — the exact scenario "one agency managing
// multiple profiles" (docs/audema-mcp/DECISIONS.md #1) needs to keep
// strictly separate from each other.
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111' as WorkspaceId;
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222' as WorkspaceId;

function makeCompetitor(workspaceId: WorkspaceId, name: string): Competitor {
  const parsed = CompetitorSchema.parse({
    id: crypto.randomUUID(),
    workspaceId,
    name,
    profile: { keyMessages: [] },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    recentMoves: [],
    gaps: [],
  });
  return parsed;
}

describe('workspace isolation', () => {
  it('a workspace cannot read another workspace\'s record by ID', () => {
    const store = new WorkspaceScopedStore<Competitor>();
    const competitorInA = store.insert(makeCompetitor(WORKSPACE_A, 'Acme Rival'));
    store.insert(makeCompetitor(WORKSPACE_B, 'Other Client Rival'));

    // Workspace A can read its own record.
    expect(store.getByIdForWorkspace(competitorInA.id, WORKSPACE_A)?.name).toBe('Acme Rival');

    // Workspace B asking for Workspace A's record ID gets refused, not a
    // silent null and not the wrong record.
    expect(() => store.getByIdForWorkspace(competitorInA.id, WORKSPACE_B)).toThrow(
      CrossWorkspaceAccessError
    );
  });

  it('listing for one workspace never includes another workspace\'s records', () => {
    const store = new WorkspaceScopedStore<Competitor>();
    store.insert(makeCompetitor(WORKSPACE_A, 'A-Rival-1'));
    store.insert(makeCompetitor(WORKSPACE_A, 'A-Rival-2'));
    store.insert(makeCompetitor(WORKSPACE_B, 'B-Rival-1'));

    const workspaceAList = store.listForWorkspace(WORKSPACE_A);
    const workspaceBList = store.listForWorkspace(WORKSPACE_B);

    expect(workspaceAList).toHaveLength(2);
    expect(workspaceAList.every((c) => c.workspaceId === WORKSPACE_A)).toBe(true);
    expect(workspaceBList).toHaveLength(1);
    expect(workspaceBList.every((c) => c.workspaceId === WORKSPACE_B)).toBe(true);

    // Cross-check: nothing from A leaks into B's list by name.
    expect(workspaceBList.some((c) => c.name.startsWith('A-'))).toBe(false);
  });

  it('assertWorkspaceScope throws for a foreign-workspace record and returns the record otherwise', () => {
    const record = makeCompetitor(WORKSPACE_A, 'Acme Rival');
    expect(assertWorkspaceScope(record, WORKSPACE_A)).toBe(record);
    expect(() => assertWorkspaceScope(record, WORKSPACE_B)).toThrow(CrossWorkspaceAccessError);
  });

  it('filterByWorkspace silently drops foreign-workspace records for listing operations', () => {
    const records = [makeCompetitor(WORKSPACE_A, 'A1'), makeCompetitor(WORKSPACE_B, 'B1')];
    expect(filterByWorkspace(records, WORKSPACE_A).map((r) => r.name)).toEqual(['A1']);
  });

  it('reading a genuinely missing ID within the correct workspace returns undefined, not an error', () => {
    const store = new WorkspaceScopedStore<Competitor>();
    store.insert(makeCompetitor(WORKSPACE_A, 'A1'));
    expect(store.getByIdForWorkspace(crypto.randomUUID(), WORKSPACE_A)).toBeUndefined();
  });
});
