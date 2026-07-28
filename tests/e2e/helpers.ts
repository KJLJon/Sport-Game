/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.16 — PWA lifecycle E2E suite: all sixteen scenarios in `11` §9
 * @story   US-1.2, US-1.4, US-1.8, US-1.9
 * @design  11-pwa-lifecycle.md §9
 *
 * Purpose: shared helpers for the lifecycle suite — driving the control server, waiting for a
 * worker to settle, and inspecting caches and IndexedDB from the page.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const BASE = process.env['E2E_BASE'] ?? '/Sport-Game/';

export type Control = 'deploy/v1' | 'deploy/v2' | 'offline/on' | 'offline/off' | 'reset';

export async function control(page: Page, command: string): Promise<void> {
  const response = await page.request.get(`/__control/${command}`);
  if (!response.ok()) throw new Error(`control ${command} failed: ${response.status()}`);
}

/** Base64 for the version overrides endpoint, which takes its argument in the path. */
export async function setVersionOverrides(
  page: Page,
  overrides: Record<string, unknown>,
): Promise<void> {
  await control(page, `version/${Buffer.from(JSON.stringify(overrides)).toString('base64')}`);
}

/** Loads the app and waits until a worker is controlling the page. */
export async function loadAndInstall(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
  // The install step precaches; wait until it has actually landed.
  await page.waitForFunction(
    async () => {
      const names = await caches.keys();
      const precache = names.find((name) => name.includes('precache'));
      if (precache === undefined) return false;
      return (await (await caches.open(precache)).keys()).length > 0;
    },
    null,
    { timeout: 20_000 },
  );
}

export async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

export async function cacheEntryCount(page: Page, kind: string): Promise<number> {
  return page.evaluate(async (needle) => {
    const name = (await caches.keys()).find((candidate) => candidate.includes(needle));
    if (name === undefined) return -1;
    return (await (await caches.open(name)).keys()).length;
  }, kind);
}

/**
 * Deletes entries from the precache, simulating the browser evicting them (`11` §5.2). `from`
 * chooses which end: `'end'` takes the icons, leaving the app bootable, which is what a test
 * needs when it has to launch offline afterwards.
 */
export async function evictFromPrecache(
  page: Page,
  count: number,
  from: 'start' | 'end' = 'start',
): Promise<string[]> {
  return page.evaluate(
    async ({ howMany, end }) => {
      const name = (await caches.keys()).find((candidate) => candidate.includes('precache'));
      if (name === undefined) return [];
      const cache = await caches.open(name);
      const keys = await cache.keys();
      const targets = end ? keys.slice(-howMany) : keys.slice(0, howMany);
      const removed: string[] = [];
      for (const request of targets) {
        await cache.delete(request);
        removed.push(request.url);
      }
      return removed;
    },
    { howMany: count, end: from === 'end' },
  );
}

/**
 * Asserts the precache reaches `target` entries, retrying the assertion itself. `waitForFunction`
 * is the wrong tool here: it can pass against the document being navigated away from, and a
 * separate assertion afterwards then reads the new one.
 */
export async function expectPrecacheAtLeast(
  page: Page,
  target: number,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(() => cacheEntryCount(page, 'precache'), { timeout, intervals: [250, 500, 1000] })
    .toBeGreaterThanOrEqual(target);
}

/**
 * Writes a marker record so a test can prove IndexedDB survived (INV-13).
 *
 * Opened with no explicit version, deliberately. Naming one meant this helper had to be edited in
 * step with `DB_VERSION`, and when T-3.1 bumped it to 2 the helper's hardcoded `1` started throwing
 * `VersionError` against a database the app had already upgraded — five E2E specs, none of which
 * had anything to do with the change. Version-less open takes whatever exists, and creates the
 * stores at version 1 only when there is nothing there at all.
 */
export async function seedDatabase(page: Page, marker: string): Promise<void> {
  await page.evaluate(async (value) => {
    const name = `sportgame${new URL(document.baseURI).pathname}db`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of ['athletes', 'economy', 'meta']) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, store === 'athletes' ? { keyPath: 'id' } : {});
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('athletes', 'readwrite');
        tx.objectStore('athletes').put({ id: 'marker', name: value });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, marker);
}

export async function readDatabaseMarker(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const name = `sportgame${new URL(document.baseURI).pathname}db`;
    return new Promise<string | null>((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('athletes')) {
          db.close();
          resolve(null);
          return;
        }
        const get = db.transaction('athletes', 'readonly').objectStore('athletes').get('marker');
        get.onsuccess = () => {
          const value = get.result as { name?: string } | undefined;
          db.close();
          resolve(value?.name ?? null);
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      };
      request.onerror = () => resolve(null);
    });
  });
}

/** Plants a sibling project's cache, to prove cleanup never touches it (PWA-15). */
export async function seedSiblingCache(page: Page, name: string): Promise<void> {
  await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    await cache.put('/sibling-asset.js', new Response('sibling'));
  }, name);
}

/**
 * Resets the server between tests. Storage is not cleared here: Playwright gives each test a
 * fresh browser context, so caches, IndexedDB, and registrations all start empty. Navigating and
 * unregistering here instead raced the app's own registration and left the page uncontrolled.
 */
export async function resetOrigin(_context: BrowserContext, page: Page): Promise<void> {
  await control(page, 'reset');
}
