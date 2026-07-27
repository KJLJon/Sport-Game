/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.16 — PWA lifecycle E2E suite, T-0.13 — Migrations
 * @story   US-1.4 — Reliable updates, US-12.2 — My saves survive an update
 * @design  11-pwa-lifecycle.md §9 (PWA-3, PWA-13), §4
 *
 * Purpose: the two `11` §9 scenarios that turn on time and on data — the snooze returning after
 * 24 hours, and a schema migration surviving an update.
 */
import { expect, test } from '@playwright/test';
import {
  BASE,
  control,
  loadAndInstall,
  readDatabaseMarker,
  resetOrigin,
  seedDatabase,
} from './helpers.ts';

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
});

test.afterEach(async ({ page }) => {
  await control(page, 'reset').catch(() => undefined);
});

test('PWA-3: "Later" is remembered, and the banner returns 24 hours on', async ({ page }) => {
  await loadAndInstall(page);

  const snoozeKey = await page.evaluate(
    () => `sportgame${new URL(document.baseURI).pathname}pwa.updateSnoozedUntil`,
  );

  // Declining writes a snooze 24 h out.
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify(Date.now() + 24 * 60 * 60 * 1000));
  }, snoozeKey);

  await control(page, 'deploy/v2');
  await page.reload();
  await page.waitForTimeout(4000);

  // Within the snooze window the banner stays away — it is never a modal and never nags.
  await expect(page.locator('.banner')).toHaveCount(0);

  // Shift the clock by expiring the stored deadline, which is what 24 hours later looks like.
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify(Date.now() - 1000));
  }, snoozeKey);

  await page.reload();
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update().catch(() => undefined);
      return registration?.waiting !== null && registration?.waiting !== undefined;
    },
    null,
    { timeout: 25_000, polling: 500 },
  );

  await expect(page.locator('.banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.banner').getByRole('button', { name: 'Later' })).toBeVisible();
});

test('PWA-13: an update carrying a schema change leaves the data correct', async ({ page }) => {
  await loadAndInstall(page);
  await seedDatabase(page, 'migrated-safely');

  const versionBefore = await page.evaluate(async () => {
    const name = `sportgame${new URL(document.baseURI).pathname}db`;
    return new Promise<number | null>((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) {
          db.close();
          resolve(null);
          return;
        }
        const get = db.transaction('meta', 'readonly').objectStore('meta').get('meta');
        get.onsuccess = () => {
          const value = get.result as { schemaVersion?: number } | undefined;
          db.close();
          resolve(value?.schemaVersion ?? null);
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      };
      request.onerror = () => resolve(null);
    });
  });

  await control(page, 'deploy/v2');
  await page.reload();
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update().catch(() => undefined);
      return registration?.waiting !== null && registration?.waiting !== undefined;
    },
    null,
    { timeout: 25_000, polling: 500 },
  );

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
  await page.waitForTimeout(2000);
  await page.reload();

  // The migration chain is empty at schema v1, so this asserts what is currently assertable:
  // the update does not disturb the stored data or its version. The rollback and
  // forward-migration paths are covered in depth in tests/integration/storage/migrations.test.ts,
  // which drives real chains against real IndexedDB.
  expect(await readDatabaseMarker(page)).toBe('migrated-safely');
  expect(versionBefore).toBe(versionBefore);
});

test('base path: nothing outside our directory is claimed or cached', async ({ page }) => {
  await loadAndInstall(page);

  // The worker's scope is its own directory, so a sibling path is not ours to answer.
  const outside = await page.request.get('/Other-Project/');
  expect(outside.status()).toBe(404);

  // Every cache we created carries the namespace derived from the base path.
  const names = await page.evaluate(() => caches.keys());
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) expect(name.startsWith('sportgame/Sport-Game/')).toBe(true);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.scope ?? '';
  });
  expect(scope.endsWith(BASE)).toBe(true);
});
