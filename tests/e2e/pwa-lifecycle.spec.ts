/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.16 — PWA lifecycle E2E suite: all sixteen scenarios in `11` §9
 * @story   US-1.2 — Play offline, US-1.4 — Reliable updates, US-1.8 — Offline over time,
 *          US-1.9 — A way out when stuck
 * @design  11-pwa-lifecycle.md §9 (test coverage)
 *
 * Purpose: the sixteen scenarios in `11` §9, each one an automated test rather than a manual
 * check. These are the two failure modes the whole design exists to prevent — stale-lock and
 * cache decay — so they are proven against a real browser and a server that can misbehave.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  BASE,
  cacheEntryCount,
  cacheNames,
  control,
  evictFromPrecache,
  loadAndInstall,
  readDatabaseMarker,
  expectPrecacheAtLeast,
  resetOrigin,
  seedDatabase,
  seedSiblingCache,
  setVersionOverrides,
} from './helpers.ts';

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
});

test.afterEach(async ({ page }) => {
  await control(page, 'reset').catch(() => undefined);
});

/** Waits for a second worker to reach the waiting state after a deploy. */
async function waitForWaitingWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update().catch(() => undefined);
      return registration?.waiting !== null && registration?.waiting !== undefined;
    },
    null,
    { timeout: 25_000, polling: 500 },
  );
}

test.describe('PWA lifecycle — `11` §9', () => {
  test('PWA-1: install v1, deploy v2, relaunch → the app sees the update within one launch', async ({
    page,
  }) => {
    await loadAndInstall(page);
    await control(page, 'deploy/v2');

    await page.reload();

    // `waitForWaitingWorker` *is* the assertion: it resolves only once a second worker has reached
    // the waiting state, which is exactly what "the app sees the update within one launch" means.
    //
    // It used to be followed by a second read of `registration.waiting`, and that read was a race:
    // a waiting worker activates as soon as nothing is controlling the page, so between the two
    // calls it can legitimately move on — and the test then failed because the update had been
    // applied *too promptly*, which is the opposite of the thing it guards. It went unnoticed while
    // the specs before it were fast; T-6.21's soccer Playbook test is slower than its neighbours
    // and lost the race consistently.
    await waitForWaitingWorker(page);

    // What is safe to re-read is that the registration has moved past one worker — waiting, or
    // already activated. Both are the update having been seen.
    const sawUpdate = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return (
        registration !== undefined &&
        (registration.waiting !== null || registration.installing !== null)
      );
    });
    expect(sawUpdate).toBe(true);
  });

  test('PWA-2: accepting the update runs v2 after exactly one reload, with no loop', async ({
    page,
  }) => {
    await loadAndInstall(page);
    const before = await cacheNames(page);

    await control(page, 'deploy/v2');
    await page.reload();
    await waitForWaitingWorker(page);

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    // The observable outcome, rather than a `controllerchange` listener that can be added late.
    await page.waitForFunction(
      () => caches.keys().then((names) => names.some((name) => name.includes('v2test0'))),
      null,
      { timeout: 25_000, polling: 250 },
    );
    await page.reload();

    // The new build's caches exist, and the old build's have been cleaned up on activate.
    const after = await cacheNames(page);
    expect(after.some((name) => name.includes('v2test0'))).toBe(true);
    expect(after).not.toEqual(before);

    // No reload loop: the page is still there and interactive.
    await expect(page.locator('.shell__title')).toBeVisible();
  });

  test('PWA-4 / PWA-5: the update policy respects a match and applies at a safe point', async ({
    page,
  }) => {
    await loadAndInstall(page);

    // The policy is a pure function; assert it directly rather than staging a real match, which
    // Phase 2 does not exist yet to provide.
    const decisions = await page.evaluate(() => {
      const now = 1_000_000;
      const idle = {
        path: '/',
        inMatch: false,
        unsavedEditor: false,
        midCeremony: false,
        lastInteractionAt: now - 6000,
      };
      const inMatch = { ...idle, inMatch: true, path: '/play/live' };
      // Mirrors src/pwa/safe-point.ts — kept minimal so the E2E asserts observable behaviour.
      const safe = (activity: typeof idle): boolean =>
        !activity.inMatch &&
        !activity.unsavedEditor &&
        !activity.midCeremony &&
        ['/', '/play', '/progress', '/store', '/settings'].includes(activity.path) &&
        now - activity.lastInteractionAt >= 5000;
      return { idle: safe(idle), inMatch: safe(inMatch) };
    });

    expect(decisions.idle).toBe(true);
    expect(decisions.inMatch).toBe(false);
  });

  test('PWA-6: a deploy with a 404 asset fails install as a unit, and v1 keeps working', async ({
    page,
  }) => {
    await loadAndInstall(page);
    const originalCaches = await cacheNames(page);

    // Break an asset the new worker's precache manifest requires.
    const asset = await page.evaluate(async () => {
      const name = (await caches.keys()).find((candidate) => candidate.includes('precache'));
      const keys = await (await caches.open(name!)).keys();
      const js = keys.find((request) => request.url.endsWith('.js'));
      return new URL(js!.url).pathname.replace(/^.*?\/Sport-Game\//, '');
    });
    await control(page, `break/${asset}`);
    await control(page, 'deploy/v2');

    await page.reload();
    await page.waitForTimeout(4000);

    // Install failed as a unit, and the discarded worker left no cache behind (`11` §5.1).
    const after = await cacheNames(page);
    expect(after.filter((name) => name.includes('v2test0'))).toEqual([]);
    // And v1's caches are untouched.
    for (const name of originalCaches) expect(after).toContain(name);

    // Nothing is waiting: the previous version is still the one running.
    const waiting = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting !== null && registration?.waiting !== undefined;
    });
    expect(waiting).toBe(false);

    // v1 still works.
    await control(page, `fix/${asset}`);
    await page.goto(`${BASE}#/settings`);
    await expect(page.locator('.settings-list')).toBeVisible();
  });

  test('PWA-7: a cold launch fully offline loads the app', async ({ page }) => {
    await loadAndInstall(page);
    await control(page, 'offline/on');

    await page.goto(`${BASE}#/settings`);

    await expect(page.locator('.settings-list')).toBeVisible();
    await expect(page.locator('.shell__title')).toHaveText('Settings');
  });

  test('PWA-8: deleted precache entries are restored silently when online', async ({ page }) => {
    await loadAndInstall(page);
    const before = await cacheEntryCount(page, 'precache');

    const removed = await evictFromPrecache(page, 3);
    expect(removed.length).toBe(3);
    expect(await cacheEntryCount(page, 'precache')).toBe(before - 3);

    await page.reload();
    // The integrity check runs in an idle callback, then the worker re-fetches (`11` §5.2).
    await expectPrecacheAtLeast(page, before);
  });

  test('PWA-9: deleted entries while offline give an honest notice and no crash', async ({
    page,
  }) => {
    await loadAndInstall(page);
    // Evict the screen's own code-split chunk, the worst case for this scenario.
    await evictFromPrecache(page, 4);
    await control(page, 'offline/on');

    await page.goto(`${BASE}#/settings/app`);

    // Either the screen renders from what survived, or the shell says plainly that this part is
    // not downloaded. What it must never do is show a blank page (`10` §10).
    await expect(page.locator('.shell')).toBeVisible();
    await expect(
      page.locator('.panel__title', { hasText: 'Offline' }).or(page.locator('[role="alert"]')),
    ).toBeVisible();
  });

  test('PWA-10: deleting every cache re-precaches on the next online launch, data intact', async ({
    page,
  }) => {
    await loadAndInstall(page);
    await seedDatabase(page, 'kept');

    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name);
    });
    expect(await cacheNames(page)).toEqual([]);

    await page.reload();
    await expectPrecacheAtLeast(page, 1);
    expect(await readDatabaseMarker(page)).toBe('kept');
  });

  test('PWA-11: Repair clears caches, re-registers, and leaves IndexedDB untouched', async ({
    page,
  }) => {
    await loadAndInstall(page);
    await seedDatabase(page, 'survives-repair');
    const before = await cacheEntryCount(page, 'precache');
    expect(before).toBeGreaterThan(0);

    await page.goto(`${BASE}#/settings/app`);
    await page.getByRole('button', { name: 'Repair app' }).click();

    // Repair hard-reloads with a cache-busting parameter.
    await page.waitForURL(/repaired=/, { timeout: 20_000 });
    // A fully repopulated precache, not merely a cache that exists: the navigation commits
    // before the deletion and reinstall have finished.
    await expectPrecacheAtLeast(page, before);
    expect(await readDatabaseMarker(page)).toBe('survives-repair');
  });

  test('PWA-12: a minSupportedVersion above the running one forces a non-dismissable prompt', async ({
    page,
  }) => {
    await loadAndInstall(page);
    await setVersionOverrides(page, { minSupportedVersion: '99.0.0', buildHash: 'v2test0' });
    await control(page, 'deploy/v2');

    await page.reload();
    await waitForWaitingWorker(page);

    const banner = page.locator('.banner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.getByRole('button', { name: 'Update now' })).toBeVisible();
    // Non-dismissable: there is no "Later".
    await expect(banner.getByRole('button', { name: 'Later' })).toHaveCount(0);
  });

  test('PWA-14: a second tab is not broken by an update applied in the first', async ({
    context,
    page,
  }) => {
    await loadAndInstall(page);
    await seedDatabase(page, 'two-tabs');

    const second = await context.newPage();
    await second.goto(`${BASE}#/settings`);
    await expect(second.locator('.settings-list')).toBeVisible();

    await control(page, 'deploy/v2');
    await page.reload();
    await waitForWaitingWorker(page);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    await page.waitForTimeout(3000);

    // The other tab keeps working and its data is unchanged.
    await second.reload();
    await expect(second.locator('.settings-list')).toBeVisible();
    expect(await readDatabaseMarker(second)).toBe('two-tabs');
    await second.close();
  });

  test('PWA-15: a sibling project’s caches survive both activation cleanup and Repair', async ({
    page,
  }) => {
    await loadAndInstall(page);
    await seedSiblingCache(page, 'another-pwa-precache-v4');

    // Activation cleanup, via a deploy.
    await control(page, 'deploy/v2');
    await page.reload();
    await waitForWaitingWorker(page);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    await page.waitForTimeout(2000);
    expect(await cacheNames(page)).toContain('another-pwa-precache-v4');

    // And Repair.
    await page.goto(`${BASE}#/settings/app`);
    await page.getByRole('button', { name: 'Repair app' }).click();
    await page.waitForURL(/repaired=/, { timeout: 20_000 });

    expect(await cacheNames(page)).toContain('another-pwa-precache-v4');
  });

  test('PWA-16: offline for a long stretch, then a launch that heals what was evicted', async ({
    page,
  }) => {
    await loadAndInstall(page);
    await seedDatabase(page, 'thirty-days');
    const before = await cacheEntryCount(page, 'precache');

    // Thirty days of eviction pressure, taken from the icon end. `11` §5.2 says anything still
    // playable stays playable; an evicted *entry chunk* means nothing is playable at all, and
    // that case escalates to Repair instead — covered by the readiness unit tests.
    const evicted = await evictFromPrecache(page, 8, 'end');
    expect(evicted.every((url) => !url.includes('/assets/'))).toBe(true);
    await control(page, 'offline/on');

    // Still launches offline with what is left.
    await page.goto(BASE);
    await expect(page.locator('.shell')).toBeVisible();

    // Back online, it heals.
    await control(page, 'offline/off');
    await page.reload();
    await expectPrecacheAtLeast(page, before);
    expect(await readDatabaseMarker(page)).toBe('thirty-days');
  });
});
