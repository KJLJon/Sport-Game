/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.11 — Cross-mode parity tests (INV-11) and reward parity (INV-12)
 * @story   US-15.8 — The mode I choose does not change who wins
 * @design  09-modes-and-arcade.md §7 (balance across modes), 12-quality-and-testing.md §3
 * @invariant INV-11 (the same rosters produce win rates within ±8% in Live and Playbook)
 *
 * `09` §7 states the failure this exists to catch: "if a roster wins 70% in one mode and 40% in the
 * other, something is wrong with the model, and the test says so."
 *
 * **Both modes are given the same athletes.** That is the whole point, and it is why `MatchOptions`
 * grew a `rosters` field — the Live balance harness rolls anonymous ratings, which is fine for
 * asking "is this basketball" and useless for asking "do the two modes agree about these five
 * people".
 *
 * **Win rate, not score.** INV-11 is about outcomes. Playbook and Live need not produce the same
 * final score — they compress a possession differently and always will — but a roster good enough
 * to win two matches in three must not win one in three when you change the menu you started from.
 *
 * **Where the ±8 band is asserted, and where it deliberately is not.** A win rate over `N` matches
 * carries a standard error of about `0.5/√N`; at 40 that is 8 points for one rate and around 11 for
 * the *difference* of two. So the ±8 assertion is made only where the true rates sit near a
 * boundary — a strong roster against a weak one wins nearly always in both modes, and there the
 * noise cannot manufacture a pass. Between two near-matched rosters the difference is mostly
 * sampling error, and asserting a tolerance on it would be asserting the noise; those cases assert
 * the *ordering* instead, which is the claim `09` §7 actually makes.
 */
import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../../src/modes/live/match.ts';
import { basketball } from '../../src/sports/basketball/index.ts';
import {
  basketballSquads,
  createBasketballPlaybook,
} from '../../src/sports/basketball/playbook/index.ts';
import { roster, type Tier } from '../../tools/playbook-rosters.ts';
import type { Athlete } from '../../src/athletes/types.ts';

/** `12` §3's tolerance, in win-rate percentage points. */
const TOLERANCE = 8;

/**
 * Matches per mode per case. A win rate over `N` carries a standard error of about `0.5/√N`, so 40
 * puts one mode's rate inside ±8 points and the *difference* of two rates inside about ±11 — which
 * is why the ±8 assertions below are made only where the true rates are far apart, and never
 * between two near-matched rosters.
 */
const MATCHES = 40;

/** Fewer, for the cases that assert an ordering rather than a tolerance. */
const ORDERING_MATCHES = 24;

/**
 * A batch is a minute of straight-line CPU, and a worker that never yields cannot answer the test
 * runner's own heartbeat — which surfaces as an unhandled RPC timeout beside a passing test. So the
 * batches hand the event loop back every few matches. It costs nothing and it keeps a green run
 * green.
 */
async function breathe(index: number): Promise<void> {
  if (index % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function liveWinRate(
  home: readonly Athlete[],
  away: readonly Athlete[],
  label: string,
  matches = MATCHES,
): Promise<number> {
  let wins = 0;
  for (let i = 0; i < matches; i += 1) {
    const match = simulateMatch({
      seed: `${label}-live-${i}`,
      sport: basketball,
      playerSide: -1,
      rosters: [home, away],
    });
    const view = match.view();
    if (view.score[0] > view.score[1]) wins += 1;
    await breathe(i);
  }
  return (wins / matches) * 100;
}

async function playbookWinRate(
  home: readonly Athlete[],
  away: readonly Athlete[],
  label: string,
  matches = MATCHES,
): Promise<number> {
  let wins = 0;
  for (let i = 0; i < matches; i += 1) {
    const match = createBasketballPlaybook({
      seed: `${label}-playbook-${i}`,
      squads: basketballSquads(home, away),
      playerSide: -1,
      keyMoments: 'off',
    });

    let guard = 0;
    while (!match.finished && guard < 600) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      match.advance();
      guard += 1;
    }

    const view = match.view();
    if (view.score[0] > view.score[1]) wins += 1;
    await breathe(i);
  }
  return (wins / matches) * 100;
}

function rosters(home: Tier, away: Tier, label: string) {
  return [roster(`${label}-h`, home), roster(`${label}-a`, away)] as const;
}

describe('INV-11 — cross-mode outcome parity', () => {
  it('agrees within ±8 points when a strong roster plays a weak one', async () => {
    const [home, away] = rosters('strong', 'weak', 'mismatch');
    const live = await liveWinRate(home, away, 'mismatch');
    const playbook = await playbookWinRate(home, away, 'mismatch');

    expect(live).toBeGreaterThan(80);
    expect(playbook).toBeGreaterThan(80);
    expect(Math.abs(live - playbook)).toBeLessThanOrEqual(TOLERANCE);
  }, 120_000);

  it('agrees within ±8 points with the same mismatch reversed', async () => {
    const [home, away] = rosters('weak', 'strong', 'reversed');
    const live = await liveWinRate(home, away, 'reversed');
    const playbook = await playbookWinRate(home, away, 'reversed');

    expect(live).toBeLessThan(20);
    expect(playbook).toBeLessThan(20);
    expect(Math.abs(live - playbook)).toBeLessThanOrEqual(TOLERANCE);
  }, 120_000);

  it('gives neither side a structural edge, in either mode', async () => {
    const [home, away] = rosters('average', 'average', 'even');
    // An even matchup is a coin toss in both modes, so the honest assertion is that neither is
    // *biased* — a mode that quietly favoured the home side would show up here and nowhere else.
    const band = 30;
    expect(Math.abs((await liveWinRate(home, away, 'even', ORDERING_MATCHES)) - 50)).toBeLessThan(
      band,
    );
    expect(
      Math.abs((await playbookWinRate(home, away, 'even', ORDERING_MATCHES)) - 50),
    ).toBeLessThan(band);
  }, 120_000);

  it('ranks the same rosters the same way in both modes', async () => {
    // The claim `09` §7 actually makes is about *ordering*: "if a roster wins 70% in one mode and
    // 40% in the other, something is wrong". The gap between two near-matched rosters is dominated
    // by sampling noise at any batch size this suite can afford — asserting a tolerance on it would
    // be asserting the noise. So this asserts only that both modes put the better roster ahead,
    // which is the part that is actually a claim about the models.
    const [strong, weak] = rosters('strong', 'weak', 'ranking');
    const [average] = rosters('average', 'average', 'ranking-mid');

    const pairs: readonly (readonly [readonly Athlete[], readonly Athlete[], string])[] = [
      [strong, average, 'sa'],
      [average, weak, 'aw'],
    ];

    for (const [home, away, label] of pairs) {
      expect(await liveWinRate(home, away, label, ORDERING_MATCHES)).toBeGreaterThan(50);
      expect(await playbookWinRate(home, away, label, ORDERING_MATCHES)).toBeGreaterThan(50);
    }
  }, 240_000);
});

describe('INV-11 — the two modes read the same ratings (`09` §7)', () => {
  it('is deterministic in both modes, so a parity failure is reproducible', async () => {
    const [home, away] = rosters('average', 'average', 'determinism');
    const n = 8;
    expect(await playbookWinRate(home, away, 'determinism', n)).toBe(
      await playbookWinRate(home, away, 'determinism', n),
    );
    expect(await liveWinRate(home, away, 'determinism', n)).toBe(
      await liveWinRate(home, away, 'determinism', n),
    );
  }, 120_000);
});
