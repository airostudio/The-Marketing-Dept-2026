/**
 * A tiny, dependency-free JSON file store. Each entity type (brand profiles,
 * briefs, concepts, campaign results) gets its own file, holding an array of
 * records keyed by id. This server is a local single-user MCP tool, not a
 * multi-tenant web service, so simplicity beats throughput here — but it can
 * still end up with more than one process touching the same data directory
 * (e.g. two Claude Desktop windows each spawning their own server instance),
 * so writes are made safe against that:
 *
 *   - Atomic writes: each write goes to a temp file in the same directory,
 *     then an OS-level rename over the real file. A reader never sees a
 *     half-written file, and a crash mid-write can't corrupt existing data —
 *     worst case, the temp file is left orphaned and the prior write stands.
 *   - Cross-process advisory locking: upsert()/delete() hold an exclusive
 *     lockfile for their whole read-modify-write span, so two processes
 *     racing to update the same store can't silently drop one write.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';

export interface Identifiable {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

const LOCK_STALE_MS = 5000; // a lockfile older than this is assumed abandoned by a crashed process
const LOCK_POLL_MS = 20;
const LOCK_TIMEOUT_MS = 3000; // don't hang forever if another process is stuck holding the lock

/** Synchronous sleep — Node has no blocking setTimeout, but this keeps the store's API synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class JsonStore<T extends Identifiable> {
  private filePath: string;
  private lockPath: string;

  constructor(dataDir: string, fileName: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, fileName);
    this.lockPath = `${this.filePath}.lock`;
    if (!existsSync(this.filePath)) this.writeAll([]);
  }

  private readAll(): T[] {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as T[];
    } catch {
      return [];
    }
  }

  /** Atomic: write to a temp file, then rename over the target — never leaves a torn/partial file readable. */
  private writeAll(records: T[]): void {
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${randomUUID()}`;
    writeFileSync(tmpPath, JSON.stringify(records, null, 2), 'utf-8');
    renameSync(tmpPath, this.filePath);
  }

  private acquireLock(): void {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        const fd = openSync(this.lockPath, 'wx'); // exclusive create — throws EEXIST if already locked
        closeSync(fd);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

        // A lock older than LOCK_STALE_MS almost certainly belongs to a
        // process that crashed while holding it, not one still working —
        // break it rather than deadlock forever.
        try {
          const age = Date.now() - statSync(this.lockPath).mtimeMs;
          if (age > LOCK_STALE_MS) {
            unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          continue; // lock disappeared between the failed open and the stat — just retry
        }

        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for lock on ${path.basename(this.filePath)} — another process may be stuck holding it. If this persists, delete ${this.lockPath} manually.`);
        }
        sleepSync(LOCK_POLL_MS);
      }
    }
  }

  private releaseLock(): void {
    try { unlinkSync(this.lockPath); } catch { /* already gone — fine */ }
  }

  /** Runs fn with the cross-process lock held; always releases, even if fn throws. */
  private withLock<R>(fn: () => R): R {
    this.acquireLock();
    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }

  list(): T[] {
    return this.readAll();
  }

  get(id: string): T | undefined {
    return this.readAll().find((r) => r.id === id);
  }

  /** Insert if no id, update in place if id matches an existing record. */
  upsert(record: T): T {
    return this.withLock(() => {
      const all = this.readAll();
      const now = new Date().toISOString();

      if (record.id) {
        const idx = all.findIndex((r) => r.id === record.id);
        if (idx >= 0) {
          const updated = { ...all[idx], ...record, updatedAt: now } as T;
          all[idx] = updated;
          this.writeAll(all);
          return updated;
        }
      }

      const created: T = { ...record, id: record.id ?? randomUUID(), createdAt: now, updatedAt: now };
      all.push(created);
      this.writeAll(all);
      return created;
    });
  }

  delete(id: string): boolean {
    return this.withLock(() => {
      const all = this.readAll();
      const next = all.filter((r) => r.id !== id);
      const changed = next.length !== all.length;
      if (changed) this.writeAll(next);
      return changed;
    });
  }

  find(predicate: (record: T) => boolean): T[] {
    return this.readAll().filter(predicate);
  }
}
