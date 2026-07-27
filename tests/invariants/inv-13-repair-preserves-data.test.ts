/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.10 — Repair flow — caches and SW only, IndexedDB untouched
 * @story   US-1.9 — A way out when the app gets stuck
 * @design  11-pwa-lifecycle.md §6, 12-quality-and-testing.md §3
 * @invariant INV-13 — Repair deletes only namespaced caches and never touches IndexedDB
 *
 * Purpose: the promise printed on the Repair button is the only reason anyone would press it, so
 * it is asserted three ways — behaviourally against real IndexedDB, structurally against the
 * module's imports, and textually against the copy the UI must show.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { REPAIR_PROMISE, repair } from '../../src/pwa/repair.ts';
import { Database, deleteDatabase } from '../../src/storage/idb.ts';
import { NS, cacheName } from '../../src/storage/scope.ts';

const SIBLING_CACHE = 'another-pwa-precache-v4';

/** Installs a Cache Storage double on `globalThis` and returns its backing map. */
function installFakeCaches(names: readonly string[]): Map<string, Set<string>> {
  const store = new Map(names.map((name) => [name, new Set<string>()]));
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      open: async (name: string) => {
        if (!store.has(name)) store.set(name, new Set());
        return { keys: async () => [] } as unknown as Cache;
      },
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
    },
  });
  return store;
}

describe('INV-13 — Repair preserves the player’s data', () => {
  it('leaves IndexedDB completely intact', async () => {
    await deleteDatabase();
    const db = await Database.open();
    await db.put('athletes', { id: 'a1', name: 'Ada', primarySport: 'basketball' });
    await db.put('economy', { coins: 1250 }, 'economy');
    db.close();

    const store = installFakeCaches([cacheName('precache'), `${NS}shell@older`, SIBLING_CACHE]);
    const container = { getRegistrations: async () => [] } as unknown as ServiceWorkerContainer;

    await repair({ container, reload: vi.fn(), baseUrl: '/test-scope/' });

    const reopened = await Database.open();
    expect(await reopened.get('athletes', 'a1')).toMatchObject({ name: 'Ada' });
    expect(await reopened.get<{ coins: number }>('economy', 'economy')).toMatchObject({
      coins: 1250,
    });
    expect(await reopened.count('athletes')).toBe(1);
    reopened.close();

    // And it did delete our caches — otherwise the test above would pass trivially.
    expect(store.has(cacheName('precache'))).toBe(false);
    expect(store.has(`${NS}shell@older`)).toBe(false);
    await deleteDatabase();
  });

  it('never deletes a sibling project’s caches (PWA-15)', async () => {
    const store = installFakeCaches([cacheName('precache'), SIBLING_CACHE, 'workbox-precache-v2']);
    const container = { getRegistrations: async () => [] } as unknown as ServiceWorkerContainer;

    await repair({ container, reload: vi.fn(), baseUrl: '/test-scope/' });

    expect(store.has(SIBLING_CACHE)).toBe(true);
    expect(store.has('workbox-precache-v2')).toBe(true);
  });

  it('unregisters only workers in our scope', async () => {
    installFakeCaches([]);
    const ours = {
      scope: 'https://x.test/test-scope/',
      unregister: vi.fn().mockResolvedValue(true),
    };
    const theirs = { scope: 'https://x.test/other/', unregister: vi.fn().mockResolvedValue(true) };
    const container = {
      getRegistrations: async () => [ours, theirs],
    } as unknown as ServiceWorkerContainer;

    const report = await repair({ container, reload: vi.fn(), baseUrl: '/test-scope/' });

    expect(ours.unregister).toHaveBeenCalled();
    expect(theirs.unregister).not.toHaveBeenCalled();
    expect(report.workersUnregistered).toBe(1);
  });

  it('reloads with a cache-busting parameter, so no intermediary can answer from cache', async () => {
    installFakeCaches([]);
    const reload = vi.fn();
    const container = { getRegistrations: async () => [] } as unknown as ServiceWorkerContainer;

    await repair({ container, reload, baseUrl: '/test-scope/' });

    expect(reload).toHaveBeenCalledWith(expect.stringMatching(/^\/test-scope\/\?repaired=/));
  });

  it('imports no IndexedDB code at all — the guarantee is structural, not just behavioural', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../src/pwa/repair.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/indexedDB/);
    expect(source).not.toMatch(/from '.*\/idb\.ts'/);
    expect(source).not.toMatch(/deleteDatabase/);
  });

  it('states the promise the UI must show verbatim', () => {
    expect(REPAIR_PROMISE).toMatch(/never touched by Repair/);
    expect(REPAIR_PROMISE).toMatch(/roster/);
  });
});
