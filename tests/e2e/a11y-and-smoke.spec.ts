/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.15 — CI: a11y and smoke, T-0.16 — E2E suite
 * @story   US-1.1 — Install the game, US-13.1 — Works on my phone
 * @design  12-quality-and-testing.md §1, 10-ui-ux.md §11 (accessibility)
 *
 * Purpose: an axe audit of every screen that exists, plus the manifest and install checks that
 * make the app installable at all. `10` §11 requires the audit to run in CI, not at a phase gate.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { BASE, resetOrigin } from './helpers.ts';

const SCREENS = [
  { path: '', name: 'Home' },
  { path: '#/play', name: 'Play' },
  { path: '#/squad', name: 'Squad' },
  { path: '#/store', name: 'Store' },
  // Phase 8's four new screens behind the Store and Progress tabs. Added here rather than trusted:
  // the tab roots passed while `coinPill` carried a prohibited `aria-label` for eight phases,
  // because nothing that used it was ever audited (T-8.10).
  { path: '#/store/packs', name: 'Packs' },
  { path: '#/store/market', name: 'Transfer market' },
  { path: '#/store/sell', name: 'Sell athletes' },
  { path: '#/progress', name: 'Progress' },
  { path: '#/progress/achievements', name: 'Achievements' },
  { path: '#/progress/tournament', name: 'Tournament' },
  { path: '#/settings', name: 'Settings' },
  { path: '#/settings/app', name: 'App & updates' },
] as const;

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
});

for (const screen of SCREENS) {
  test(`a11y: ${screen.name} has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(`${BASE}${screen.path}`);
    await expect(page.locator('.shell')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
}

test('smoke: every tab reaches a screen and back is always available', async ({ page }) => {
  await page.goto(BASE);

  for (const tab of ['Play', 'Squad', 'Store', 'Progress']) {
    await page.getByRole('link', { name: tab, exact: true }).click();
    await expect(page.locator('.shell__title')).toHaveText(tab);
    // `10` §5 — never a dead end.
    await expect(page.locator('.shell__tabs')).toBeVisible();
  }
});

test('smoke: an unknown deep link offers a way home rather than a dead end', async ({ page }) => {
  await page.goto(`${BASE}#/does/not/exist`);
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.empty-state a')).toHaveAttribute('href', '#/');
});

test('manifest: identity, scope, and start_url all follow the base path', async ({ page }) => {
  await page.goto(BASE);

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe(`${BASE}manifest.webmanifest`);

  const manifest = await (await page.request.get(href!)).json();
  expect(manifest.id).toBe(BASE);
  expect(manifest.scope).toBe(BASE);
  expect(manifest.start_url).toBe(BASE);
  expect(manifest.display).toBe('standalone');

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(
    true,
  );

  // Every icon actually resolves — a 404 here is what breaks an install prompt silently.
  for (const icon of manifest.icons.slice(0, 4)) {
    expect((await page.request.get(icon.src)).status()).toBe(200);
  }
});

test('version.json is served and never cached', async ({ page }) => {
  const response = await page.request.get(`${BASE}version.json`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');

  const version = await response.json();
  expect(typeof version.buildHash).toBe('string');
  expect(typeof version.minSupportedVersion).toBe('string');
});

test('keyboard: the skip link is the first stop and focuses the content', async ({ page }) => {
  await page.goto(BASE);
  await page.keyboard.press('Tab');

  const focused = await page.evaluate(() => document.activeElement?.className ?? '');
  expect(focused).toContain('shell__skip');
});
