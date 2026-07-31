/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-10.1 — Jump straight into a game
 * @design  09-modes-and-arcade.md §1 (remembered per sport), 10-ui-ux.md §8.2 (Quick Play)
 *
 * Purpose: Quick Play's memory, and specifically its behaviour against data it did not write —
 * a sport that no longer exists, a mode a sport no longer offers, a value that is not JSON. Each
 * of those must resolve to something playable, because the alternative is a home screen whose
 * primary button is broken by a previous build's preferences.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLAY_MODE_CATALOGUE,
  isModeAvailable,
  modesForSport,
  playMode,
} from '../../../src/modes/catalogue.ts';
import {
  forgetPlay,
  lastMode,
  lastSport,
  quickPlay,
  rememberPlay,
} from '../../../src/modes/last-played.ts';
import { prefs } from '../../../src/storage/prefs.ts';

const live = playMode('live')!;
const arcade = playMode('arcade')!;

beforeEach(() => {
  forgetPlay();
});

describe('the mode catalogue', () => {
  it('offers every playable sport at least one mode', () => {
    for (const sport of ['basketball', 'soccer'] as const) {
      expect(modesForSport(sport).length).toBeGreaterThan(0);
    }
  });

  it('gives every mode a route, a blurb, and an honest difficulty hint (`10` §8.1)', () => {
    for (const mode of PLAY_MODE_CATALOGUE) {
      expect(mode.blurb.length).toBeGreaterThan(0);
      expect(mode.hint.length).toBeGreaterThan(0);
      for (const sport of mode.sports) {
        expect(mode.route(sport)).toMatch(/^#\/play\//);
      }
    }
  });

  it('explains every gap, so an unavailable mode is never silent (`10` §10)', () => {
    for (const mode of PLAY_MODE_CATALOGUE) {
      for (const sport of ['basketball', 'soccer'] as const) {
        if (isModeAvailable(mode, sport)) continue;
        expect(mode.pending?.(sport) ?? '').not.toBe('');
      }
    }
  });
});

describe('what Quick Play remembers', () => {
  it('has nothing to resume before anything has been played', () => {
    expect(quickPlay()).toBeNull();
  });

  it('resumes the last sport and mode', () => {
    rememberPlay('soccer', live);

    expect(quickPlay()).toEqual({ sport: 'soccer', mode: live });
  });

  it('remembers a mode per sport, not one mode globally (`09` §1)', () => {
    rememberPlay('basketball', arcade);
    rememberPlay('soccer', live);

    expect(lastSport()).toBe('soccer');
    expect(lastMode('basketball')).toBe(arcade);
    expect(lastMode('soccer')).toBe(live);
  });

  it('falls back to the default sport when the stored one is no longer playable', () => {
    prefs.set('play.lastSport', 'underwater-hockey');

    expect(lastSport()).toBe('basketball');
  });

  it('falls back to an available mode when the stored one is not offered for that sport', () => {
    // **Asserted against a synthetic pairing, on purpose.** This test was written with soccer +
    // Playbook, then re-pointed at soccer + arcade when T-6.21 made the first one real, and T-6.15
    // made the second one real too — both inside one session. There is no longer *any* real
    // unavailable pairing to illustrate it with, and there will not be one again until Phase 11's
    // hockey. The behaviour still matters, so the example is now a mode id no catalogue row has,
    // which exercises the same branch and cannot go stale when a sport gets finished.
    prefs.set('play.lastMode.soccer', 'shuffleboard');

    expect(lastMode('soccer')).toBe(live);

    // And the availability check itself, stated directly rather than through a pairing that keeps
    // becoming true: a mode that does not list the sport is not handed back.
    expect(isModeAvailable({ ...arcade, sports: ['basketball'] }, 'soccer')).toBe(false);
    expect(isModeAvailable(arcade, 'soccer')).toBe(true);
  });

  it('survives a value that is not JSON at all', () => {
    globalThis.localStorage.setItem(`sportgame${import.meta.env.BASE_URL}play.lastSport`, '{oops');

    // The picker still needs a sport selected, so `lastSport` answers; Quick Play does not pretend
    // to know what was played and hands the player back to the picker instead.
    expect(lastSport()).toBe('basketball');
    expect(quickPlay()).toBeNull();
  });

  it('forgets both halves of the memory', () => {
    rememberPlay('soccer', live);
    forgetPlay();

    expect(quickPlay()).toBeNull();
    expect(prefs.keys().filter((key) => key.startsWith('play.'))).toEqual([]);
  });
});
