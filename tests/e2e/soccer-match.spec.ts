/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-14.4 — Add a sport without touching the engine
 * @design  04-architecture.md §5 (the sport module seam), 12-quality-and-testing.md §1
 *
 * Purpose: that the soccer *screen* exists in the built app, in a real browser, at the deep link a
 * player would actually use. The unit and integration suites prove the simulation; only this proves
 * the screen — which is the only thing that matters when the app is being tested from a phone
 * against a deployed build.
 *
 * Mirrors `live-match.spec.ts`'s shape deliberately: if soccer needed a different kind of assertion
 * to be called playable, it would not be playable in the same sense basketball is.
 */
import { expect, test, type Page } from '@playwright/test';
import { BASE, resetOrigin } from './helpers.ts';

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
  await page.setViewportSize({ width: 900, height: 460 });
});

/** Loads a Live match for `sport` and returns the canvas once it is up. */
async function liveMatch(page: Page, path: string) {
  await page.goto(`${BASE}#${path}`);
  const canvas = page.locator('canvas.live__canvas');
  await expect(canvas).toBeVisible();
  return canvas;
}

test('the soccer deep link mounts a match that paints and keeps running', async ({ page }) => {
  const canvas = await liveMatch(page, '/play/live/soccer');

  // The loop is advancing: two samples a moment apart differ. Same check basketball's spec makes.
  const first = await canvas.screenshot();
  await page.waitForTimeout(500);
  const second = await canvas.screenshot();
  expect(Buffer.compare(first, second)).not.toBe(0);
});

test('soccer shows no shot clock, unlike basketball', async ({ page }) => {
  await liveMatch(page, '/play/live/soccer');

  // `SportHudSpec.showShotClock` is false for soccer — the first sport to exercise that. Asserted
  // through the HUD's own text rather than a test id, so it survives a markup change.
  const hud = page.locator('.live');
  await expect(hud).not.toContainText(/shot clock/i);
});

test('basketball is unaffected by the sport becoming a route parameter', async ({ page }) => {
  const canvas = await liveMatch(page, '/play/live/basketball');
  const first = await canvas.screenshot();
  await page.waitForTimeout(400);
  expect(Buffer.compare(first, await canvas.screenshot())).not.toBe(0);
});

test('the bare /play/live link still works and defaults to a playable sport', async ({ page }) => {
  await liveMatch(page, '/play/live');
});

test('an unknown sport falls back to a real match rather than dead-ending', async ({ page }) => {
  await liveMatch(page, '/play/live/quidditch');
});

test('quitting a soccer match returns to Play with the loop stopped', async ({ page }) => {
  await liveMatch(page, '/play/live/soccer');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /quit/i }).click();

  await expect(page).toHaveURL(/#\/play$/);
  await expect(page.locator('canvas.live__canvas')).toHaveCount(0);
});
