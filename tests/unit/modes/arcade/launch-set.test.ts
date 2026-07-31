/**
 * T-6.27 — the whole of `09` §3.2's launch set, both sports at once, and the claims that can only be
 * made about the catalogue rather than about one game.
 *
 * The per-game behaviour lives in each sport's own `arcade/games.test.ts`. What is here is what
 * neither of those files can see: that the two sets together are the spec's table, that no unlock is
 * claimed twice or left unclaimed, and that `calibrate()` means the same thing across all ten games.
 *
 * **Why this file exists at all.** T-6.27 was written as "set registration, unlock wiring, and
 * `calibrate()` tests", and the first two turned out to need no code — each game was registered in
 * the commit that built it, and the hub reads unlocks generically through `unlockStates()`. What was
 * genuinely missing was anything asserting the *catalogue* is coherent. A soccer game pointed at a
 * basketball achievement, or two games sharing one unlock, would have passed every test in the
 * project and shipped a hub where tiles unlocked in pairs.
 */
import { describe, expect, it } from 'vitest';
import { BASKETBALL_ARCADE } from '../../../../src/sports/basketball/arcade/index.ts';
import { SOCCER_ARCADE } from '../../../../src/sports/soccer/arcade/index.ts';
import {
  ARCADE_UNLOCKS,
  ARCADE_UNLOCKS_BY_ID,
  requirementFor,
} from '../../../../src/achievements/ids.ts';
import { duplicateIds } from '../../../../src/modes/arcade/registry.ts';
import { ACHIEVEMENTS_LANDED, unlockStates } from '../../../../src/modes/arcade/unlocks.ts';
import { arcadeRating } from '../../../../src/modes/arcade/calibration.ts';
import { deriveRatings } from '../../../../src/athletes/derivation.ts';
import { DIFFICULTIES } from '../../../../src/modes/difficulty.ts';
import {
  BASKETBALL_PHYSICAL,
  BASKETBALL_WEIGHTS,
} from '../../../../src/sports/basketball/weights.ts';
import { SOCCER_PHYSICAL, SOCCER_WEIGHTS } from '../../../../src/sports/soccer/weights.ts';
import { newSportSkill } from '../../../../src/athletes/types.ts';
import { athlete, attributes } from '../../../helpers/athletes.ts';

const LAUNCH_SET = [...BASKETBALL_ARCADE, ...SOCCER_ARCADE];

const TABLES = {
  basketball: { weights: BASKETBALL_WEIGHTS, physicalModifiers: BASKETBALL_PHYSICAL },
  soccer: { weights: SOCCER_WEIGHTS, physicalModifiers: SOCCER_PHYSICAL },
} as const;

function player(rating: number): ReturnType<typeof athlete> {
  return athlete({
    primarySport: 'soccer',
    attributes: attributes(rating),
    sportSkills: { soccer: newSportSkill(70), basketball: newSportSkill(50) },
  });
}

describe('the launch set (09 §3.2)', () => {
  it('is the ten games the table names, five to a sport', () => {
    expect(BASKETBALL_ARCADE).toHaveLength(5);
    expect(SOCCER_ARCADE).toHaveLength(5);
    // As a set, not a sequence: `09` §3.2 lists the games in its own order and each `index.ts`
    // deliberately orders its array easiest-first, because that is the order the hub shows tiles in
    // and the first tile a newcomer taps should be the one that needs the least explaining.
    expect([...LAUNCH_SET.map((game) => game.name)].sort()).toEqual(
      [
        'Free Throw',
        'Three-Point Contest',
        'Buzzer Beater',
        'Fast Break',
        'Pickpocket',
        'Penalty Shootout',
        'Free Kick',
        'One-on-One',
        'Header',
        'Last Line',
      ].sort(),
    );
  });

  it('has no id collisions across the whole catalogue, not just within a sport', () => {
    // Each set already checks itself. This is the check neither of them can make: two sports are
    // free to pick the same short name, and `records.ts` keys bests by game id alone.
    expect(duplicateIds(LAUNCH_SET)).toEqual([]);
  });

  it('declares every game against the sport it belongs to, under one prefix per sport', () => {
    for (const game of BASKETBALL_ARCADE) expect(game.sport, game.id).toBe('basketball');
    for (const game of SOCCER_ARCADE) expect(game.sport, game.id).toBe('soccer');

    // Ids are namespaced so a log line or a challenge code is readable without a lookup. The prefix
    // is *not* the sport id — basketball's games are `bball.` — so the claim is the one that
    // actually holds: one prefix per sport, and no two sports sharing one.
    const prefixes = new Map<string, Set<string>>();
    for (const game of LAUNCH_SET) {
      const prefix = game.id.split('.')[0] ?? '';
      expect(prefix.length, game.id).toBeGreaterThan(0);
      expect(game.id.length, game.id).toBeGreaterThan(prefix.length + 1);
      const seen = prefixes.get(game.sport) ?? new Set<string>();
      seen.add(prefix);
      prefixes.set(game.sport, seen);
    }
    for (const [sport, seen] of prefixes) expect([...seen], sport).toHaveLength(1);
    const all = [...prefixes.values()].flatMap((seen) => [...seen]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('unlocks (US-16.2)', () => {
  it('claims every unlock the vocabulary declares, exactly once', () => {
    // Both directions matter. An unlock claimed twice unlocks two tiles at once, which is a
    // ceremony that lies; an unlock claimed by nobody is a requirement the player can never spend.
    const claimed = LAUNCH_SET.map((game) => game.unlockAchievement);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect([...claimed].sort()).toEqual(
      Object.values(ARCADE_UNLOCKS)
        .map((entry) => entry.id)
        .sort(),
    );
  });

  it('never unlocks a game with another sport’s achievement', () => {
    // The copy-paste this catches would be invisible: the tile would work, it would simply unlock
    // when the player did something in a sport they were not playing.
    for (const game of LAUNCH_SET) {
      const unlock = ARCADE_UNLOCKS_BY_ID.get(game.unlockAchievement);
      expect(unlock, game.id).toBeDefined();
      const prefix = game.sport === 'basketball' ? 'bball.' : 'soccer.';
      expect(game.unlockAchievement.startsWith(prefix), game.id).toBe(true);
    }
  });

  it('has a real requirement to show for every game, not the fallback', () => {
    // What a locked tile would say. Checked against `requirementFor` directly rather than through
    // `unlockStates`, because the latter is currently short-circuited — see the next test.
    for (const game of LAUNCH_SET) {
      const requirement = requirementFor(game.unlockAchievement);
      expect(requirement, game.id).not.toBe('Keep playing to unlock this');
      expect(requirement.length, game.id).toBeGreaterThan(5);
    }
  });

  it('leaves every game available while nothing writes achievements, and says so', () => {
    // `ACHIEVEMENTS_LANDED` is `false` until T-8.6: a hub of ten permanently locked tiles is worse
    // than an honest temporary shortcut. This asserts the shortcut is still in force, so that the
    // commit which flips the flag has to come here and turn this test into its opposite rather than
    // discovering the behaviour change in the hub.
    expect(ACHIEVEMENTS_LANDED).toBe(false);
    const states = unlockStates(LAUNCH_SET, new Set());
    for (const game of LAUNCH_SET) expect(states.get(game.id)?.unlocked, game.id).toBe(true);
  });
});

describe('calibrate() means the same thing in all ten games (INV-10)', () => {
  it('reports the mean of exactly the derived ratings it names', () => {
    // The tie between the arcade and the athlete card (`09` §7 — tuning an athlete's ability tunes
    // all three modes). If a game's reported rating drifted from the ratings it claims to read, the
    // picker would describe a window the mechanic does not have.
    const person = player(72);

    for (const game of LAUNCH_SET) {
      const derived = deriveRatings(person, game.sport, TABLES[game.sport as 'soccer']);
      const expected = arcadeRating(derived, game.ratings);
      expect(game.calibrate(person, 'pro').rating, game.id).toBeCloseTo(expected, 3);
    }
  });

  it('names each of its ratings once, and names ratings its sport defines', () => {
    for (const game of LAUNCH_SET) {
      expect(new Set(game.ratings).size, game.id).toBe(game.ratings.length);
      const defined = Object.keys(TABLES[game.sport as 'soccer'].weights);
      for (const rating of game.ratings) expect(defined, `${game.id}:${rating}`).toContain(rating);
    }
  });

  it('is pure — the same athlete and difficulty give the same window, every time', () => {
    // INV-10 is a claim about the *signature*, but a `calibrate()` that memoised a personal best
    // would still satisfy the signature. This is the behavioural half.
    const person = player(64);
    for (const game of LAUNCH_SET) {
      for (const difficulty of DIFFICULTIES) {
        expect(game.calibrate(person, difficulty), game.id).toEqual(
          game.calibrate(person, difficulty),
        );
      }
    }
  });

  it('lets difficulty move the forgiveness and never the athlete (INV-1)', () => {
    // `06` §7: difficulty never modifies attributes or derived ratings. At the game level that means
    // the reported rating is identical at Rookie and at Legend, however far apart the windows are.
    const person = player(58);
    for (const game of LAUNCH_SET) {
      const rookie = game.calibrate(person, 'rookie');
      const legend = game.calibrate(person, 'legend');
      expect(rookie.rating, game.id).toBe(legend.rating);
      expect(rookie.label, game.id).toBe(legend.label);
      expect(rookie.windowSeconds, game.id).toBeGreaterThan(legend.windowSeconds);
    }
  });

  it('spreads a sport’s set across its vocabulary, so no one rating wins every game', () => {
    // A set whose five games all read `finishing` would be one game with five pictures. Stated as a
    // floor on how much of the sport each set touches, and a ceiling on how far one rating reaches.
    for (const set of [BASKETBALL_ARCADE, SOCCER_ARCADE]) {
      const named = set.flatMap((game) => game.ratings);
      expect(new Set(named).size).toBeGreaterThanOrEqual(5);
      for (const rating of new Set(named)) {
        const games = set.filter((game) => game.ratings.includes(rating));
        expect(games.length, rating).toBeLessThan(set.length);
      }
    }
  });

  it('gives every game a plain-language window label and hint for the picker (US-16.3)', () => {
    const person = player(45);
    for (const game of LAUNCH_SET) {
      const calibration = game.calibrate(person, 'pro');
      expect(calibration.label.length, game.id).toBeGreaterThan(0);
      expect(calibration.hint.length, game.id).toBeGreaterThan(10);
      expect(calibration.floor, game.id).toBeLessThan(calibration.ceiling);
    }
  });
});
