import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, closeSync, openSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../../src/storage/jsonStore.js';

interface Widget {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  name: string;
}

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'adforge-jsonstore-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('JsonStore', () => {
  it('starts empty', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    expect(store.list()).toEqual([]);
  });

  it('upsert without an id creates a record with id/createdAt/updatedAt', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    const created = store.upsert({ name: 'Alpha' });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
    expect(created.name).toBe('Alpha');
    expect(store.list()).toHaveLength(1);
  });

  it('upsert with an existing id updates in place, preserving createdAt', async () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    const created = store.upsert({ name: 'Alpha' });

    // Ensure a measurable clock tick between createdAt and updatedAt.
    await new Promise((r) => setTimeout(r, 5));

    const updated = store.upsert({ id: created.id, name: 'Alpha v2' });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.name).toBe('Alpha v2');
    expect(store.list()).toHaveLength(1);
  });

  it('get() retrieves by id, returns undefined for unknown id', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    const created = store.upsert({ name: 'Alpha' });
    expect(store.get(created.id!)?.name).toBe('Alpha');
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('find() filters by predicate', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    store.upsert({ name: 'Alpha' });
    store.upsert({ name: 'Beta' });
    store.upsert({ name: 'Alpha' });
    expect(store.find((r) => r.name === 'Alpha')).toHaveLength(2);
  });

  it('delete() removes a record and reports whether it existed', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    const created = store.upsert({ name: 'Alpha' });
    expect(store.delete(created.id!)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.delete(created.id!)).toBe(false);
  });

  it('persists across separate JsonStore instances pointed at the same directory', () => {
    const first = new JsonStore<Widget>(dataDir, 'widgets.json');
    first.upsert({ name: 'Alpha' });

    const second = new JsonStore<Widget>(dataDir, 'widgets.json');
    expect(second.list()).toHaveLength(1);
    expect(second.list()[0].name).toBe('Alpha');
  });

  it('leaves no stray temp files or lockfiles behind after writes (atomic write + lock cleanup)', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    store.upsert({ name: 'Alpha' });
    store.upsert({ name: 'Beta' });
    store.delete(store.list()[0].id!);

    const files = readdirSync(dataDir);
    expect(files).toEqual(['widgets.json']);
  });

  it('breaks a stale lock (old mtime) instead of waiting out the full timeout', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    const lockPath = path.join(dataDir, 'widgets.json.lock');

    // Simulate a lockfile left behind by a process that crashed 10s ago.
    closeSync(openSync(lockPath, 'w'));
    const staleTime = new Date(Date.now() - 10_000);
    utimesSync(lockPath, staleTime, staleTime);

    const start = Date.now();
    const created = store.upsert({ name: 'Alpha' });
    const elapsedMs = Date.now() - start;

    expect(created.name).toBe('Alpha');
    expect(elapsedMs).toBeLessThan(1000); // well under LOCK_TIMEOUT_MS — proves it broke the stale lock rather than waiting it out
  });

  it('throws a clear, bounded-time error if a fresh lock is never released by another process', () => {
    const store = new JsonStore<Widget>(dataDir, 'widgets.json');
    const lockPath = path.join(dataDir, 'widgets.json.lock');

    // A fresh (non-stale) lockfile simulates another process genuinely mid-write.
    closeSync(openSync(lockPath, 'w'));

    expect(() => store.upsert({ name: 'Alpha' })).toThrow(/Timed out waiting for lock/);
  });
});
