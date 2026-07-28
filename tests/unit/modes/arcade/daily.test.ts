/**
 * T-4.4 — the daily challenge is the same run for everyone that day, and a challenge code
 * reconstructs it exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  DAILY_DIFFICULTY,
  challengeCode,
  dailyAthlete,
  dailyChallenge,
  dailyConfig,
  dailyGame,
  dailyModifiers,
  dailySeed,
  dateKey,
  decodeChallenge,
  encodeChallenge,
  millisUntilNextDay,
  scenarioConfig,
} from '../../../../src/modes/arcade/daily.ts';
import { athlete } from '../../../helpers/athletes.ts';
import { fakeGame } from '../../../helpers/arcade.ts';

const GAMES = [
  fakeGame({ id: 'bball.free-throw' }),
  fakeGame({ id: 'bball.three-point' }),
  fakeGame({ id: 'bball.buzzer-beater' }),
];

describe('the day boundary', () => {
  it('is UTC, so two players in different zones agree about today', () => {
    expect(dateKey(Date.UTC(2026, 6, 28, 23, 59, 59))).toBe('2026-07-28');
    expect(dateKey(Date.UTC(2026, 6, 29, 0, 0, 0))).toBe('2026-07-29');
    expect(dateKey(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01');
  });

  it('counts down to the next boundary', () => {
    const noon = Date.UTC(2026, 6, 28, 12, 0, 0);
    expect(millisUntilNextDay(noon)).toBe(12 * 60 * 60 * 1000);
  });
});

describe('the challenge is a pure function of the day', () => {
  it('gives the same game, seed, athlete, and modifiers every time it is asked', () => {
    const first = dailyChallenge('2026-07-28', GAMES);
    const second = dailyChallenge('2026-07-28', GAMES);

    expect(first?.game.id).toBe(second?.game.id);
    expect(first?.seed).toBe(second?.seed);
    expect(first?.athlete).toEqual(second?.athlete);
    expect(first?.modifiers).toEqual(second?.modifiers);
    expect(first?.difficulty).toBe(DAILY_DIFFICULTY);
  });

  it('is a different challenge on a different day', () => {
    const week = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'].map((day) =>
      dailyChallenge(day, GAMES),
    );
    const seeds = new Set(week.map((challenge) => challenge?.seed));
    expect(seeds.size).toBe(week.length);

    const athletes = new Set(week.map((challenge) => challenge?.athlete.displayName));
    expect(athletes.size).toBeGreaterThan(1);
  });

  it('has nothing to offer when no games exist', () => {
    expect(dailyChallenge('2026-07-28', [])).toBeNull();
    expect(dailyGame('2026-07-28', [])).toBeUndefined();
  });

  it('picks the game from the set of games, not from the order a registry walked them', () => {
    const forwards = dailyGame('2026-07-28', GAMES);
    const backwards = dailyGame('2026-07-28', [...GAMES].reverse());
    expect(forwards?.id).toBe(backwards?.id);
  });

  it('applies two readable modifiers, never the same one twice', () => {
    const modifiers = dailyModifiers('2026-07-28');
    expect(modifiers).toHaveLength(2);
    expect(new Set(modifiers.map((modifier) => modifier.id)).size).toBe(2);
  });

  it('rolls its own athlete rather than borrowing one from the roster', () => {
    const game = GAMES[0]!;
    const subject = dailyAthlete('2026-07-28', game);
    expect(subject.primarySport).toBe(game.sport);
    expect(subject.source).toBe('pack');
    // Identical on every device: the id comes from the seed, not from `crypto.randomUUID`.
    expect(dailyAthlete('2026-07-28', game).id).toBe(subject.id);
  });

  it('builds a config that plays it in daily mode', () => {
    const challenge = dailyChallenge('2026-07-28', GAMES)!;
    const config = dailyConfig(challenge);
    expect(config.mode).toBe('daily');
    expect(config.seed).toBe(dailySeed('2026-07-28', challenge.game.id));
    expect(config.modifiers).toEqual(challenge.modifiers.map((modifier) => modifier.id));
  });
});

describe('challenge codes (US-16.4)', () => {
  const scenario = {
    game: 'bball.free-throw',
    seed: 'daily:2026-07-28:bball.free-throw',
    modifiers: ['hurry', 'jitters'],
  };

  it('round-trips a scenario exactly', () => {
    expect(decodeChallenge(encodeChallenge(scenario))).toEqual(scenario);
  });

  it('round-trips a scenario with no modifiers', () => {
    const plain = { ...scenario, modifiers: [] };
    expect(decodeChallenge(encodeChallenge(plain))).toEqual(plain);
  });

  it('is typeable: grouped, upper case, and free of the characters people misread', () => {
    const code = encodeChallenge(scenario);
    expect(code).toMatch(/^SG1(-[0-9A-HJKMNP-TV-Z]{1,4})+$/);
    expect(code).not.toMatch(/[ILOU]/);
  });

  it('accepts a code however it was pasted', () => {
    const code = encodeChallenge(scenario);
    expect(decodeChallenge(`  ${code.toLowerCase()}  `)).toEqual(scenario);
    expect(decodeChallenge(code.replace(/-/g, ''))).toEqual(scenario);
  });

  it('rejects a mistyped code rather than starting the wrong run', () => {
    const code = encodeChallenge(scenario);
    const broken = `${code.slice(0, -1)}${code.endsWith('Z') ? 'Y' : 'Z'}`;
    expect(decodeChallenge(broken)).toBeNull();
  });

  it('rejects anything that is not a code at all', () => {
    expect(decodeChallenge('')).toBeNull();
    expect(decodeChallenge('have you seen this game')).toBeNull();
    expect(decodeChallenge('SG1')).toBeNull();
    expect(decodeChallenge('SG1-!!!!-AB')).toBeNull();
    expect(decodeChallenge('SG2-ABCD-EF')).toBeNull();
  });

  it('encodes today’s challenge', () => {
    const challenge = dailyChallenge('2026-07-28', GAMES)!;
    const decoded = decodeChallenge(challengeCode(challenge));
    expect(decoded?.game).toBe(challenge.game.id);
    expect(decoded?.seed).toBe(challenge.seed);
  });
});

describe('playing a decoded code', () => {
  it('builds a config against this build’s catalogue', () => {
    const scenario = { game: 'bball.free-throw', seed: 'shared', modifiers: ['hurry'] };
    const config = scenarioConfig(scenario, GAMES, athlete());
    expect(config).toMatchObject({ mode: 'daily', seed: 'shared', modifiers: ['hurry'] });
  });

  it('drops a modifier this build does not know rather than failing the run', () => {
    const scenario = { game: 'bball.free-throw', seed: 'shared', modifiers: ['hurry', 'gravity'] };
    expect(scenarioConfig(scenario, GAMES, athlete())?.modifiers).toEqual(['hurry']);
  });

  it('refuses a game this build does not have, rather than substituting one', () => {
    const scenario = { game: 'hockey.shootout', seed: 'shared', modifiers: [] };
    expect(scenarioConfig(scenario, GAMES, athlete())).toBeNull();
  });
});
