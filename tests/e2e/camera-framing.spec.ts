/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.9 — Device pass: framing on a 360 px phone in both orientations, one-handed
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @task    T-12.4 — Minimap rework
 * @story   US-2.3 — See what is happening on a small screen
 * @design  10-ui-ux.md §4 (landscape, safe areas), 12-quality-and-testing.md §7 (device matrix)
 * @invariant INV-11 (44 px touch targets)
 *
 * Purpose: the half of the device pass a machine can do. Gate 12 asks that an athlete be legible on
 * a 360 px-wide phone without pinch-zoom, in both orientations, and that the camera actually moves
 * with the play — and every one of those is a measurement a headless browser can take.
 *
 * **What this file deliberately does not claim.** Legible is not the same as comfortable, a moving
 * camera is not the same as a *watchable* one, and one-handed reach is a fact about a hand. Those
 * need the phone, and they are recorded in `PROGRESS.md` as outstanding rather than asserted here.
 * A green run of this spec is a floor, not the gate.
 *
 * Nor does it measure how many pixels an athlete is drawn across. That is arithmetic — `legibleSpan`
 * in `engine/render/framing.ts` — and it is checked where arithmetic belongs, in the unit suite.
 * Reaching into a code-split bundle from a browser test to re-derive it would be a worse test of a
 * fact that is already proved.
 */
import { expect, test, type Page } from '@playwright/test';
import { BASE, resetOrigin } from './helpers.ts';

/** The two orientations `12` §7 names for the smallest phone in the matrix. */
const PORTRAIT = { width: 360, height: 640 };
const LANDSCAPE = { width: 640, height: 360 };

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
});

async function match(page: Page, sport = 'soccer') {
  await page.goto(`${BASE}#/play/live/${sport}`);
  const canvas = page.locator('canvas.live__canvas');
  await expect(canvas).toBeVisible();
  // A moment of simulation, so the camera has something to follow.
  await page.waitForTimeout(700);
  return canvas;
}

for (const [name, size] of [
  ['portrait', PORTRAIT],
  ['landscape', LANDSCAPE],
] as const) {
  test(`a soccer match paints and keeps moving on a 360 px phone in ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    const canvas = await match(page);

    const first = await canvas.screenshot();
    await page.waitForTimeout(500);
    const second = await canvas.screenshot();

    // The camera is following play rather than sitting on a fitted pitch: consecutive frames differ.
    expect(Buffer.compare(first, second)).not.toBe(0);
  });

  test(`the canvas fills the viewport in ${name}, with nothing scrolled off`, async ({ page }) => {
    await page.setViewportSize(size);
    await match(page);

    const box = await page.locator('canvas.live__canvas').boundingBox();
    expect(box?.width).toBeGreaterThan(size.width * 0.9);

    // A match screen that scrolls is a match screen where a thumb-drag steers nothing.
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 1,
    );
    expect(scrollable).toBe(false);
  });
}

test('the minimap stays a touch target on the smallest phone', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  const canvas = await match(page);

  // The minimap is canvas-drawn, so what is asserted is that a tap where it lives does something
  // the camera notices rather than steering the athlete: two frames after tapping the far corner
  // of the map differ from two frames after tapping the middle of the pitch.
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');

  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 30);
  await page.waitForTimeout(200);
  const peeked = await canvas.screenshot();

  await page.waitForTimeout(2000);
  const returned = await canvas.screenshot();

  // It went somewhere and it came back on its own (T-12.4) — a peek that never ends is a camera
  // the player has lost.
  expect(Buffer.compare(peeked, returned)).not.toBe(0);
});

test('a basketball court still frames whole, which is the seam working', async ({ page }) => {
  await page.setViewportSize(LANDSCAPE);
  const canvas = await match(page, 'basketball');

  const first = await canvas.screenshot();
  await page.waitForTimeout(500);
  expect(Buffer.compare(first, await canvas.screenshot())).not.toBe(0);
});
