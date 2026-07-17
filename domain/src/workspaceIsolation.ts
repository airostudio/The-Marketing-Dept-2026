/**
 * Workspace isolation enforcement. Every domain entity other than
 * Organisation/User/Workspace itself carries a `workspaceId` (see
 * WorkspaceScopedSchema in base.ts) — this module is the shared contract
 * every real repository built on top of these types must satisfy: given a
 * caller's authorized workspace, a record belonging to a different
 * workspace must never be returned or mutable.
 *
 * This is a generic in-memory reference implementation, not a Supabase
 * repository — Prompt 2 is contracts-only. A later phase's real Supabase-
 * backed repositories should satisfy the exact same two guarantees this
 * module's tests prove: no cross-workspace read, no cross-workspace write.
 * Mirrors the "never trust model/client-supplied scope" principle already
 * used in api/admin-users.js (verify the caller's real permission
 * server-side; never trust a client-supplied workspace claim).
 */
import type { WorkspaceId } from './ids';
import type { WorkspaceScoped } from './base';

export class CrossWorkspaceAccessError extends Error {
  constructor(recordWorkspaceId: WorkspaceId, callerWorkspaceId: WorkspaceId) {
    super(
      `Refusing cross-workspace access: record belongs to workspace ${recordWorkspaceId}, ` +
        `caller is authorized for workspace ${callerWorkspaceId}.`
    );
    this.name = 'CrossWorkspaceAccessError';
  }
}

/** Throws CrossWorkspaceAccessError if `record` does not belong to
 *  `callerWorkspaceId`. Every real repository read/write path should call
 *  this (or an equivalent database-level filter, e.g. an RLS policy) before
 *  returning or mutating a record — never rely on the caller simply not
 *  asking for another workspace's data. */
export function assertWorkspaceScope<T extends WorkspaceScoped>(
  record: T,
  callerWorkspaceId: WorkspaceId
): T {
  if (record.workspaceId !== callerWorkspaceId) {
    throw new CrossWorkspaceAccessError(record.workspaceId, callerWorkspaceId);
  }
  return record;
}

/** Filters a collection down to only the records belonging to
 *  `callerWorkspaceId` — the read-path equivalent of assertWorkspaceScope,
 *  for listing operations where silently omitting foreign-workspace
 *  records (rather than throwing) is the correct behaviour. */
export function filterByWorkspace<T extends WorkspaceScoped>(
  records: readonly T[],
  callerWorkspaceId: WorkspaceId
): T[] {
  return records.filter((record) => record.workspaceId === callerWorkspaceId);
}

/**
 * Minimal in-memory reference store proving the enforcement contract works
 * end-to-end (insert → get → list), for use in tests and as a template for
 * a real repository's method signatures. Not intended for production use —
 * a real implementation persists to Supabase and enforces isolation via
 * RLS as the defense-in-depth layer beneath this application-level check.
 */
export class WorkspaceScopedStore<T extends WorkspaceScoped & { id: string }> {
  private readonly recordsById = new Map<string, T>();

  insert(record: T): T {
    this.recordsById.set(record.id, record);
    return record;
  }

  /** Throws if the record exists but belongs to a different workspace —
   *  it does NOT behave like a 404 for a foreign-workspace record,
   *  because "not found" and "not yours" are different failure modes a
   *  caller should not conflate when auditing access attempts. */
  getByIdForWorkspace(id: string, callerWorkspaceId: WorkspaceId): T | undefined {
    const record = this.recordsById.get(id);
    if (!record) return undefined;
    return assertWorkspaceScope(record, callerWorkspaceId);
  }

  listForWorkspace(callerWorkspaceId: WorkspaceId): T[] {
    return filterByWorkspace(Array.from(this.recordsById.values()), callerWorkspaceId);
  }
}
