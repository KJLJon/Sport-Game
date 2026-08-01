/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.8 — Assist system: aim, pass, auto-switch, timing forgiveness
 * @story   US-7.3 — Get help without being carried
 * @design  06-game-design.md §2 (assists), §7 (difficulty)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NO_ASSISTS,
  NO_ASSIST_BONUS,
  assistMultiplier,
  assistsOff,
  defaultAssists,
  normaliseAssists,
} from '../../../src/modes/assists.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '../../../src/modes/difficulty.ts';
import {
  assistsAreCustom,
  forgetPlay,
  loadAssists,
  rememberDifficulty,
  resetAssists,
  saveAssists,
} from '../../../src/modes/last-played.ts';

describe('the defaults a level starts you on', () => {
  it('follows `06` §7 — full help on Rookie, none on Legend', () => {
    expect(defaultAssists('rookie')).toEqual({
      aim: 1,
      pass: 1,
      autoSwitch: true,
      timing: DIFFICULTY_PROFILES.rookie.timingWindow,
    });
    expect(assistsOff(defaultAssists('legend'))).toBe(true);
  });

  it('gives less help as the level rises', () => {
    const ladder = DIFFICULTIES.map((id) => defaultAssists(id));
    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index]!.aim).toBeLessThan(ladder[index - 1]!.aim);
      expect(ladder[index]!.timing).toBeLessThanOrEqual(ladder[index - 1]!.timing);
    }
  });
});

describe('the no-assist bonus', () => {
  it('pays only when every dial is off', () => {
    expect(assistMultiplier(NO_ASSISTS)).toBe(1 + NO_ASSIST_BONUS);
    expect(assistMultiplier({ ...NO_ASSISTS, aim: 0.3 })).toBe(1);
    expect(assistMultiplier({ ...NO_ASSISTS, autoSwitch: true })).toBe(1);
    expect(assistMultiplier({ ...NO_ASSISTS, timing: 1.35 })).toBe(1);
  });

  it('counts a tighter-than-normal window as no assist — it is not help', () => {
    expect(assistsOff({ ...NO_ASSISTS, timing: 0.8 })).toBe(true);
  });

  it('is small enough to be a nudge rather than a tax on people who need help', () => {
    expect(NO_ASSIST_BONUS).toBeGreaterThan(0);
    expect(NO_ASSIST_BONUS).toBeLessThanOrEqual(0.25);
  });
});

describe('normaliseAssists', () => {
  it('falls back whole when nothing is stored', () => {
    expect(normaliseAssists(null, NO_ASSISTS)).toEqual(NO_ASSISTS);
    expect(normaliseAssists(undefined, NO_ASSISTS)).toEqual(NO_ASSISTS);
  });

  it('fills in fields a newer build added', () => {
    const fallback = defaultAssists('pro');
    expect(normaliseAssists({ aim: 0 }, fallback)).toEqual({ ...fallback, aim: 0 });
  });

  it('repairs values out of range rather than trusting storage', () => {
    const repaired = normaliseAssists(
      { aim: 9, pass: -3, timing: 40, autoSwitch: true },
      NO_ASSISTS,
    );
    expect(repaired).toEqual({ aim: 1, pass: 0, timing: 2, autoSwitch: true });
  });

  it('never closes the release window to nothing', () => {
    expect(normaliseAssists({ timing: 0 }, NO_ASSISTS).timing).toBe(0.5);
  });
});

describe('what is remembered', () => {
  beforeEach(() => {
    forgetPlay();
  });

  it('follows the level until the player has an opinion', () => {
    rememberDifficulty('rookie');
    expect(loadAssists()).toEqual(defaultAssists('rookie'));
    expect(assistsAreCustom()).toBe(false);
  });

  it('keeps the player’s choice at every level once they have one (US-7.3)', () => {
    rememberDifficulty('rookie');
    saveAssists(NO_ASSISTS);
    expect(loadAssists()).toEqual(NO_ASSISTS);

    // The whole point of "independent of difficulty": moving the level does not move the dials.
    rememberDifficulty('legend');
    expect(loadAssists()).toEqual(NO_ASSISTS);
    expect(assistsAreCustom()).toBe(true);
  });

  it('lets the player hand the dials back to the level', () => {
    rememberDifficulty('allStar');
    saveAssists({ ...NO_ASSISTS, aim: 1 });
    resetAssists();
    expect(loadAssists()).toEqual(defaultAssists('allStar'));
    expect(assistsAreCustom()).toBe(false);
  });
});
