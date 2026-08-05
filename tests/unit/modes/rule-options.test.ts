/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.2 — Match setup screens for Live and Playbook: rules toggles
 * @story   US-10.2 — Set up an exhibition
 * @design  09-modes-and-arcade.md §1, 06-game-design.md §3
 * @invariant INV-5 (one bag of switches, no sport named), INV-8 (determinism survives a switch)
 *
 * Purpose: that the switches do something. A rules toggle that changes no outcome is the failure
 * `modes/live/screen.ts` argues against — worse than no toggle at all — so what is asserted here is
 * the simulation's behaviour, not the shape of the setting.
 *
 * The matches are full ones because a foul is a rare event: over a few hundred steps a seed can
 * legitimately produce none, and an assertion about "no fouls" would then pass for the wrong reason.
 */
import { describe, expect, it } from 'vitest';
import { LiveMatch } from '@/modes/live/match.ts';
import { EventKind } from '@/engine/match/events.ts';
import { basketball } from '@/sports/basketball/index.ts';
import { soccer } from '@/sports/soccer/index.ts';
import type { SportModule } from '@/sports/types.ts';
import type { RuleOptions } from '@/modes/match-setup.ts';

/** Plays a match and counts what came out of it. */
function play(sport: SportModule, seed: string, ruleOptions?: RuleOptions, steps = 6000) {
  const match = new LiveMatch({
    sport,
    seed,
    playerSide: -1,
    ...(ruleOptions === undefined ? {} : { ruleOptions }),
  });

  const kinds: string[] = [];
  match.bus.on((event) => kinds.push(event.kind));
  for (let i = 0; i < steps && !match.finished; i++) match.step();

  return {
    fouls: kinds.filter((kind) => kind === EventKind.FOUL).length,
    steps: match.view().steps,
    score: match.view().score,
  };
}

const ALL_ON: RuleOptions = { fouls: true, offside: true };
const NO_FOULS: RuleOptions = { fouls: false, offside: true };

describe('the fouls switch', () => {
  it('produces fouls in basketball when it is on', () => {
    // The control for the assertion below: if this were ever zero, "no fouls when off" would be
    // passing for the wrong reason.
    expect(play(basketball, 'fouls-on').fouls).toBeGreaterThan(0);
  });

  it('produces none in basketball when it is off', () => {
    expect(play(basketball, 'fouls-on', NO_FOULS).fouls).toBe(0);
  });

  it('produces fouls in soccer when it is on, and none when it is off', () => {
    expect(play(soccer, 'soccer-fouls').fouls).toBeGreaterThan(0);
    expect(play(soccer, 'soccer-fouls', NO_FOULS).fouls).toBe(0);
  });

  it('leaves a match still playable and still scoring with fouls off', () => {
    // Turning a rule off makes a looser game, not a broken one.
    const loose = play(basketball, 'fouls-on', NO_FOULS);
    expect(loose.steps).toBeGreaterThan(0);
    expect(loose.score[0] + loose.score[1]).toBeGreaterThan(0);
  });
});

describe('defaults and determinism', () => {
  it('treats an absent bag as every rule on', () => {
    // A headless rules test, the balance harness, and a player who changed nothing all want this.
    const absent = play(basketball, 'default-check');
    const explicit = play(basketball, 'default-check', ALL_ON);
    expect(absent).toEqual(explicit);
  });

  it('stays deterministic with a switch off (INV-8)', () => {
    expect(play(soccer, 'determinism', NO_FOULS)).toEqual(play(soccer, 'determinism', NO_FOULS));
  });

  it('does not disturb the seed stream when a rule is merely available', () => {
    // The switches are read at decision points rather than drawn from the RNG, so a match with
    // every rule on is bit-for-bit the match that was played before they existed.
    expect(play(soccer, 'stream', ALL_ON)).toEqual(play(soccer, 'stream'));
  });
});
