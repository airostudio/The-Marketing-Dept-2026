/**
 * A tiny, dependency-free JSON file store. Each entity type (brand profiles,
 * briefs, concepts, campaign results) gets its own file, holding an array of
 * records keyed by id. Reads/writes are synchronous — this server is a local
 * single-user MCP tool, not a multi-tenant web service, so simplicity beats
 * throughput here.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Identifiable {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class JsonStore<T extends Identifiable> {
  private filePath: string;

  constructor(dataDir: string, fileName: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, fileName);
    if (!existsSync(this.filePath)) writeFileSync(this.filePath, '[]', 'utf-8');
  }

  private readAll(): T[] {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as T[];
    } catch {
      return [];
    }
  }

  private writeAll(records: T[]): void {
    writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
  }

  list(): T[] {
    return this.readAll();
  }

  get(id: string): T | undefined {
    return this.readAll().find((r) => r.id === id);
  }

  /** Insert if no id, update in place if id matches an existing record. */
  upsert(record: T): T {
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
  }

  delete(id: string): boolean {
    const all = this.readAll();
    const next = all.filter((r) => r.id !== id);
    const changed = next.length !== all.length;
    if (changed) this.writeAll(next);
    return changed;
  }

  find(predicate: (record: T) => boolean): T[] {
    return this.readAll().filter(predicate);
  }
}
