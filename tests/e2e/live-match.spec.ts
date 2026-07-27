/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @task    T-2.11 — Pause menu, quit, in-match settings, post-match summary with box score
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.4 — See the state of the match at a glance
 * @design  12-quality-and-testing.md §1, 06-game-design.md §4
 *
 * Purpose: that a match actually runs in a real browser — which is the one thing a headless
 * simulation test can never tell you. Gate 2 asks for "playable end to end", and this is the part
 * of that claim a machine can check: the screen mounts, the canvas paints, the loop advances, the
 * pause menu opens, and the box score is real markup rather than pixels.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { BASE, resetOrigin } from './helpers.ts';

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
  await page.setViewportSize({ width: 900, height: 460 });
});

test('a match mounts, paints, and keeps running', async ({ page }) => {
  await page.goto(`${BASE}#/play/live`);

  const canvas = page.locator('canvas.live__canvas');
  await expect(canvas).toBeVisible();

  // The loop is advancing: two samples of the canvas a moment apart differ.
  const first = await canvas.screenshot();
  await page.waitForTimeout(500);
  const second = await canvas.screenshot();
  expect(Buffer.compare(first, second)).not.toBe(0);
});

test('escape opens a pause menu with a box score, and resume closes it', async ({ page }) => {
  await page.goto(`${BASE}#/play/live`);
  await expect(page.locator('canvas.live__canvas')).toBeVisible();

  await page.keyboard.press('Escape');
  const panel = page.locator('.live-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('role', 'dialog');

  // A real table, not a picture of one.
  await expect(panel.locator('table')).toHaveCount(2);
  await expect(panel.locator('th[scope="col"]').first()).toHaveText('Athlete');

  await panel.getByRole('button', { name: 'Resume' }).click();
  await expect(panel).toHaveCount(0);
});

test('the pause menu has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto(`${BASE}#/play/live`);
  await expect(page.locator('canvas.live__canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.live-panel')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
});

test('quitting a match leaves the loop stopped and returns to Play', async ({ page }) => {
  await page.goto(`${BASE}#/play/live`);
  await expect(page.locator('canvas.live__canvas')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('.live-panel').getByRole('button', { name: 'Quit match' }).click();

  await expect(page).toHaveURL(/#\/play$/);
  await expect(page.locator('canvas.live__canvas')).toHaveCount(0);
});
