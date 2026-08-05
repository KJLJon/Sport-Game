/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-10.1 — Jump straight into a game
 * @design  10-ui-ux.md §2 (two taps to play), §8.1 (first launch), §8.2 (Quick Play)
 *
 * Purpose: that the game can be *started*, by tapping, in the built app.
 *
 * **Why this suite exists.** Through Phases 2–6 every mode was verified by its own deep link, and
 * every one of them passed, while the Play tab still landed on a Phase-0 placeholder — so the
 * shipped build had four working modes and no way to reach any of them. A deep-link test cannot
 * see that, because it starts past the part that was broken. These tests start at the home screen
 * and only use the controls a thumb can find, which is the one property nothing else asserted.
 */
import { expect, test, type Page } from '@playwright/test';
import { BASE, resetOrigin } from './helpers.ts';

test.beforeEach(async ({ context, page }) => {
  await resetOrigin(context, page);
  await page.setViewportSize({ width: 390, height: 844 });
});

/**
 * Back to the Play hub between assertions.
 *
 * Deliberately the URL rather than a tap: the home button becomes Quick Play once something has
 * been played (`10` §8.2), and a Live match hides the tab bar (`chrome: 'bare'`), so neither
 * control is available from everywhere these tests need to return from. The tap-path itself is
 * asserted by the first test, which is the one that is about it.
 */
async function openHub(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}#/play`);
  await expect(page.locator('.play-screen')).toBeVisible();
}

test('two taps from a cold launch reach a live match', async ({ page }) => {
  await page.goto(BASE);

  // Tap one: the home screen's single primary action.
  await page.locator('.home__play').click();
  // Tap two: a mode.
  await page.setViewportSize({ width: 900, height: 460 });
  await page.locator('a.play-mode--ready[href="#/play/live/basketball"]').click();

  await expect(page.locator('canvas.live__canvas')).toBeVisible();
});

test('every mode the hub offers actually opens', async ({ page }) => {
  await openHub(page);

  const hrefs = await page
    .locator('a.play-mode--ready')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThan(0);

  for (const href of hrefs) {
    await openHub(page);
    await page.locator(`a.play-mode--ready[href="${href}"]`).click();
    // Not-found is the failure this whole suite is about, so it is what is asserted against.
    await expect(page.locator('body')).not.toContainText("That screen doesn't exist");
    expect(page.url()).toContain(href.replace(/^#/, ''));
  }
});

test('switching sport switches what can be started, and says why not', async ({ page }) => {
  await openHub(page);

  await page.locator('label[for="play-sport-soccer"]').click();

  // Soccer reaches all three modes as of T-6.15; the routes have to change with the sport.
  await expect(page.locator('a.play-mode--ready[href="#/play/live/soccer"]')).toBeVisible();
  await expect(
    page.locator('a.play-mode--ready[href="#/play/playbook?sport=soccer"]'),
  ).toBeVisible();
  await expect(page.locator('a.play-mode--ready[href="#/play/arcade?sport=soccer"]')).toBeVisible();

  // The "says why not" half is now conditional, because there is nothing left to say it about. It
  // is kept rather than deleted: the moment a mode *does* go unavailable — Phase 11's hockey is the
  // next one — a silently missing card must still fail this (`10` §10).
  const pending = page.locator('.play-mode__pending');
  for (let index = 0; index < (await pending.count()); index += 1) {
    await expect(pending.nth(index)).not.toBeEmpty();
  }
  expect(await page.locator('a.play-mode--ready').count()).toBe(
    await page.locator('.play-modes > li').count(),
  );
});

test('a Playbook match starts from the setup screen (the hash the router can parse)', async ({
  page,
}) => {
  await openHub(page);
  await page.locator('a.play-mode--ready[href="#/play/playbook?sport=basketball"]').click();

  await page.getByRole('button', { name: 'Start match' }).click();

  // The bug this guards: a pre-assembled `#/…?a=b` handed to `navigate()` came back
  // percent-encoded as one unmatchable segment, and every Playbook match landed on Not Found.
  await expect(page.locator('body')).not.toContainText("That screen doesn't exist");
  expect(page.url()).toContain('#/play/playbook/match?');
  await expect(page.locator('.play-call-sheet')).toBeVisible();
});

/**
 * T-6.21 — soccer's Playbook, reached by tapping.
 *
 * The one property nothing else asserts: the sport picked on the hub survives two screens and a
 * query string, and what comes up is a *soccer* match. Every unit test for these screens passed
 * throughout the period when this route dead-ended, because the screens named basketball in their
 * imports rather than in their behaviour.
 */
test('soccer Playbook is reachable from the hub, and it is a soccer match', async ({ page }) => {
  await openHub(page);
  await page.locator('label[for="play-sport-soccer"]').click();
  await page.locator('a.play-mode--ready[href="#/play/playbook?sport=soccer"]').click();

  await expect(page.locator('.playbook-setup__title')).toHaveText('Soccer Playbook');
  await page.getByRole('button', { name: 'Start match' }).click();

  await expect(page.locator('body')).not.toContainText("That screen doesn't exist");
  expect(page.url()).toContain('sport=soccer');

  // Halves of 45:00, not quarters of 12:00 — the clock is the sport module's.
  await expect(page.locator('.playbook-match__clock')).toContainText('H1');
  await expect(page.locator('.play-call-sheet')).toBeVisible();

  // And a call resolves into a narrated turn on the diagram above it. The *label* is what a thumb
  // hits — the radio itself is visually hidden behind it — and clicking it is what caught the
  // board overflowing onto the sheet and swallowing the tap.
  await page.locator('label.play-call').first().click();
  await expect(page.locator('.playbook-match__narration')).not.toBeEmpty();
});

test('Quick Play remembers the last match and starts it in one tap', async ({ page }) => {
  await openHub(page);
  await page.locator('label[for="play-sport-soccer"]').click();
  await page.setViewportSize({ width: 900, height: 460 });
  await page.locator('a.play-mode--ready[href="#/play/live/soccer"]').click();
  await expect(page.locator('canvas.live__canvas')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);

  const quick = page.locator('.home__play');
  await expect(quick).toHaveText('Quick Play · Live Soccer');

  await page.setViewportSize({ width: 900, height: 460 });
  await quick.click();
  await expect(page).toHaveURL(/#\/play\/live\/soccer$/);
  await expect(page.locator('canvas.live__canvas')).toBeVisible();
});

test('quitting a match lands on the hub, not a placeholder', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 460 });
  await page.goto(`${BASE}#/play/live/basketball`);
  await expect(page.locator('canvas.live__canvas')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit match' }).click();

  await expect(page.locator('.play-screen')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Arrives in');
});

/**
 * T-8.2. The setup screen sits between the hub and a Live match, and the two things worth asserting
 * in a browser are that it is reachable and that it leads somewhere — a screen whose "Kick off"
 * button 404s is worse than no screen.
 */
test('the Live card opens a setup screen, and it kicks off a match', async ({ page }) => {
  await page.goto(`${BASE}#/play`);

  // The card itself plays — `10` §2's two taps. Setup is the second, smaller target beside it.
  await expect(page.locator('a.play-mode--ready').first()).toHaveAttribute(
    'href',
    /#\/play\/live\//,
  );
  await page.locator('a.play-mode__setup').first().click();

  // The choices US-10.2 asks for. The opponent is generated (T-7.9), which until now nothing did.
  await expect(page.locator('.match-setup__title')).toBeVisible();
  await expect(page.locator('.setup-opponent__name')).not.toBeEmpty();
  await expect(page.getByText('How long?')).toBeVisible();

  await page.getByRole('link', { name: 'Kick off' }).click();
  await expect(page.locator('canvas.live__canvas')).toBeVisible();
});

test('re-rolling the opponent changes who you are playing', async ({ page }) => {
  await page.goto(`${BASE}#/play/setup/basketball`);

  const name = page.locator('.setup-opponent__name');
  const before = await name.textContent();
  await page.getByRole('button', { name: 'Another opponent' }).click();

  // Seeded, so it is a different opponent rather than a re-render of the same one (INV-8).
  await expect(name).not.toHaveText(before ?? '');
});

test('a deep link to a match still plays without going through setup', async ({ page }) => {
  // A fresh install with no athletes must still open a match: the rosters are optional and the
  // seeded fallback is what makes a shared link work for somebody who has never played.
  await page.goto(`${BASE}#/play/live/soccer`);
  await expect(page.locator('canvas.live__canvas')).toBeVisible();
});
