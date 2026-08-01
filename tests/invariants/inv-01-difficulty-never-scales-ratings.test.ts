/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.7 — Difficulty model across all three modes
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7, 12-quality-and-testing.md §3 (INV-1)
 *
 * Purpose: INV-1 — difficulty never modifies an athlete's attributes or derived ratings, on either
 * team. `06` §7 states it and `12` §3 requires a test behind it, because stat-cheating difficulty
 * is the single change that would make every win in the game feel unearned.
 *
 * Two checks, deliberately different in kind: a behavioural one that plays the same match at all
 * four levels and asserts every rating is identical, and a structural one that no source file
 * multiplies a rating by a difficulty field. The first would miss a scaling applied at a code path
 * the seed never reached; the second would miss one written in a way the regex does not match.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LiveMatch } from '../../src/modes/live/match.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '../../src/modes/difficulty.ts';
import { basketball } from '../../src/sports/basketball/index.ts';
import { soccer } from '../../src/sports/soccer/index.ts';
import type { SportModule } from '../../src/sports/types.ts';
import { walkSourceFiles } from '../helpers/walk.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Every rating of every athlete on both sides, as a comparable string. */
function ratingsOf(sport: SportModule, difficulty: string): string {
  const match = new LiveMatch({
    sport,
    seed: 'inv-01',
    playerSide: -1,
    difficulty: difficulty as never,
  });
  const state = match.sportState as { ratings: Map<number, Record<string, number>> };
  return [...state.ratings.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, ratings]) => `${id}:${JSON.stringify(ratings)}`)
    .join('|');
}

describe('INV-1 — difficulty never touches an athlete', () => {
  for (const sport of [basketball, soccer] as SportModule[]) {
    it(`derives identical ${sport.id} ratings at every level`, () => {
      // The ratings map holds *both* squads, which is the half of INV-1 that is easy to lose: a
      // Legend CPU must not be better athletes, only better played, and a Rookie CPU must not be
      // worse ones. Comparing the whole map covers both teams in one assertion.
      const baseline = ratingsOf(sport, 'rookie');
      expect(baseline.length).toBeGreaterThan(100);
      for (const difficulty of DIFFICULTIES) {
        expect(ratingsOf(sport, difficulty), `${sport.id} at ${difficulty}`).toBe(baseline);
      }
    });
  }

  it('has no field a rating could be scaled by that is not a decision knob', () => {
    // The profile's shape is the first line of defence: if there is no `ratingMultiplier`, no call
    // site can reach for one. Every field here has to be a decision, an error, or a reward.
    const allowed = new Set([
      'id',
      'label',
      'cpuLatencyMs',
      'decisionNoise',
      'executionError',
      'aggression',
      'assist',
      'timingWindow',
      'rewardMultiplier',
      'tactics',
      'exploits',
    ]);
    for (const profile of Object.values(DIFFICULTY_PROFILES)) {
      for (const field of Object.keys(profile)) {
        expect(allowed, `DifficultyProfile.${field} is new — is it a rating multiplier?`).toContain(
          field,
        );
      }
    }
  });

  it('never multiplies a rating by a difficulty field anywhere in src/', async () => {
    // Deliberately crude, and deliberately not clever: any arithmetic that mentions both a
    // difficulty knob and a ratings lookup on the same line is worth a human reading it.
    const suspicious =
      /(ratings|rating|attributes)\b[^\n;]*[*/][^\n;]*\b(difficulty\.|profile\.(aggression|decisionNoise|executionError|cpuLatencyMs))/;
    const offenders: string[] = [];

    for (const file of await walkSourceFiles(SRC)) {
      if (!file.endsWith('.ts')) continue;
      for (const [index, line] of (await readFile(file, 'utf8')).split('\n').entries()) {
        if (suspicious.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}`);
      }
    }

    expect(offenders, 'difficulty must never scale a rating (INV-1)').toEqual([]);
  });
});
