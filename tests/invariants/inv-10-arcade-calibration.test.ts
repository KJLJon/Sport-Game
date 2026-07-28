/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.2 — Calibration: ratings + familiarity → window sizes and speeds (INV-10)
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §2.4 (the fairness rule), 12-quality-and-testing.md §3
 * @invariant INV-10 — arcade window size is a function of the athlete's ratings and the difficulty,
 *            never of the player's past scores
 *
 * Purpose: three ways of asserting the same thing, because this is the rule the mode exists to keep
 * (`09` §2.4: "the single most important rule in the mode").
 *
 * 1. **Behaviourally** — the same athlete at the same difficulty calibrates identically no matter
 *    what has been scored before, and a better athlete always gets the wider window.
 * 2. **Structurally** — the calibration module imports nothing that could carry history: no storage,
 *    no personal bests, no session or run state.
 * 3. **Textually** — no `calibrate()` implementation anywhere in `src/` takes a third argument, so a
 *    game cannot smuggle its own history in past the seam's signature.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkSourceFiles } from '../helpers/walk.ts';
import { calibrateForAthlete, calibrateWindow } from '../../src/modes/arcade/calibration.ts';
import { DIFFICULTIES } from '../../src/modes/difficulty.ts';
import { BASKETBALL_PHYSICAL, BASKETBALL_WEIGHTS } from '../../src/sports/basketball/weights.ts';
import { athlete, attributes } from '../helpers/athletes.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const CALIBRATION = fileURLToPath(
  new URL('../../src/modes/arcade/calibration.ts', import.meta.url),
);

const TABLES = { weights: BASKETBALL_WEIGHTS, physicalModifiers: BASKETBALL_PHYSICAL };

describe('INV-10 — the window comes from the athlete', () => {
  it('is a pure function: the same inputs always give the same window', () => {
    const subject = athlete();
    const once = calibrateForAthlete({
      athlete: subject,
      sport: 'basketball',
      tables: TABLES,
      ratings: ['freeThrow'],
      difficulty: 'pro',
    });

    // A thousand runs later — which is all a personal best is — nothing has moved.
    for (let i = 0; i < 5; i++) {
      expect(
        calibrateForAthlete({
          athlete: subject,
          sport: 'basketball',
          tables: TABLES,
          ratings: ['freeThrow'],
          difficulty: 'pro',
        }),
      ).toEqual(once);
    }
  });

  it('a better athlete always gets at least as wide a window, at every difficulty', () => {
    const weak = athlete({ attributes: attributes(30) });
    const strong = athlete({ attributes: attributes(85) });

    for (const difficulty of DIFFICULTIES) {
      const a = calibrateForAthlete({
        athlete: weak,
        sport: 'basketball',
        tables: TABLES,
        ratings: ['freeThrow'],
        difficulty,
      });
      const b = calibrateForAthlete({
        athlete: strong,
        sport: 'basketball',
        tables: TABLES,
        ratings: ['freeThrow'],
        difficulty,
      });
      expect(b.windowSeconds).toBeGreaterThan(a.windowSeconds);
      expect(b.rating).toBeGreaterThan(a.rating);
    }
  });

  it('nothing but the rating and the difficulty is an input', () => {
    // Two calls that differ only in fields a "history" would live in — there are none to vary, and
    // that is the point: the signature admits a rating, a familiarity, and a level.
    expect(calibrateWindow({ rating: 61, familiarity: 40, difficulty: 'pro' })).toEqual(
      calibrateWindow({ rating: 61, familiarity: 40, difficulty: 'pro' }),
    );
  });
});

describe('INV-10 — structurally', () => {
  it('the calibration module imports nothing that could carry player history', () => {
    return readFile(CALIBRATION, 'utf8').then((source) => {
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      for (const specifier of imports) {
        expect(specifier).not.toMatch(/storage|bests|records|session|history|progress/i);
      }
    });
  });

  it('no arcade calibration anywhere takes more than an athlete and a difficulty', async () => {
    const files = await walkSourceFiles(SRC);
    const offenders: string[] = [];

    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const source = await readFile(file, 'utf8');
      // `calibrate(a, b)` — two parameters, no more. A third would be the smuggling route.
      for (const match of source.matchAll(/\bcalibrate\s*[:(]\s*\(([^)]*)\)/g)) {
        const params = (match[1] ?? '').split(',').filter((part) => part.trim() !== '');
        if (params.length > 2) offenders.push(`${file}: calibrate(${match[1] ?? ''})`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
