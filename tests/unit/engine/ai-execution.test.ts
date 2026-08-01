/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.7 — Difficulty model across all three modes
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng.ts';
import {
  aimError,
  contestChance,
  powerError,
  reacted,
  reactionChance,
} from '../../../src/engine/ai/execution.ts';
import { DIFFICULTY_PROFILES } from '../../../src/modes/difficulty.ts';

const STEP_MS = 1000 / 60;

describe('reactionChance', () => {
  it('waits about the level’s reaction time on average', () => {
    for (const profile of Object.values(DIFFICULTY_PROFILES)) {
      const rng = createRng(`react-${profile.id}`).fork('ai');
      let total = 0;
      const trials = 400;
      for (let trial = 0; trial < trials; trial += 1) {
        let steps = 1;
        while (!reacted(rng, profile.cpuLatencyMs, STEP_MS) && steps < 600) steps += 1;
        total += steps * STEP_MS;
      }
      const mean = total / trials;
      // Within 15% of the spec's number — the model is memoryless, so the mean is the parameter.
      expect(Math.abs(mean - profile.cpuLatencyMs) / profile.cpuLatencyMs).toBeLessThan(0.15);
    }
  });

  it('orders the four levels the way `06` §7 does', () => {
    const chance = (ms: number) => reactionChance(ms, STEP_MS);
    expect(chance(DIFFICULTY_PROFILES.legend.cpuLatencyMs)).toBeGreaterThan(
      chance(DIFFICULTY_PROFILES.allStar.cpuLatencyMs),
    );
    expect(chance(DIFFICULTY_PROFILES.allStar.cpuLatencyMs)).toBeGreaterThan(
      chance(DIFFICULTY_PROFILES.pro.cpuLatencyMs),
    );
    expect(chance(DIFFICULTY_PROFILES.pro.cpuLatencyMs)).toBeGreaterThan(
      chance(DIFFICULTY_PROFILES.rookie.cpuLatencyMs),
    );
  });

  it('reacts instantly at zero latency and never with no time passing', () => {
    expect(reactionChance(0, STEP_MS)).toBe(1);
    expect(reactionChance(280, 0)).toBe(0);
  });
});

describe('aimError', () => {
  it('is exactly zero when the level makes no mistakes', () => {
    const rng = createRng('aim').fork('ai');
    expect(aimError(rng, 0, 0.2)).toBe(0);
    expect(aimError(rng, 0.3, 0)).toBe(0);
  });

  it('grows with the level’s error and stays inside three sigma', () => {
    const spread = (error: number) => {
      const rng = createRng('aim').fork('ai');
      let worst = 0;
      let sum = 0;
      for (let draw = 0; draw < 2000; draw += 1) {
        const value = Math.abs(aimError(rng, error, 0.2));
        worst = Math.max(worst, value);
        sum += value;
      }
      return { mean: sum / 2000, worst };
    };
    const rookie = spread(DIFFICULTY_PROFILES.rookie.executionError);
    const legend = spread(DIFFICULTY_PROFILES.legend.executionError);
    expect(legend.mean).toBeLessThan(rookie.mean);
    expect(rookie.worst).toBeLessThanOrEqual(3 * 0.2 * DIFFICULTY_PROFILES.rookie.executionError);
  });

  it('is centred — a level makes the CPU wrong, not biased', () => {
    const rng = createRng('aim').fork('ai');
    let sum = 0;
    for (let draw = 0; draw < 4000; draw += 1) sum += aimError(rng, 0.3, 0.2);
    expect(Math.abs(sum / 4000)).toBeLessThan(0.01);
  });

  it('turns into a multiplier around 1 for magnitudes', () => {
    const rng = createRng('power').fork('ai');
    expect(powerError(rng, 0, 0.3)).toBe(1);
    const value = powerError(rng, 0.3, 0.2);
    expect(value).toBeGreaterThan(0.5);
    expect(value).toBeLessThan(1.5);
  });
});

describe('contestChance', () => {
  it('makes a relentless defender try more often than a passive one', () => {
    const passive = contestChance(0.01, DIFFICULTY_PROFILES.rookie.aggression);
    const relentless = contestChance(0.01, DIFFICULTY_PROFILES.legend.aggression);
    expect(relentless).toBeGreaterThan(passive);
    expect(relentless / passive).toBeLessThan(3);
  });

  it('leaves Pro close to the tuned baseline, so the balance pass still holds', () => {
    const pro = contestChance(0.006, DIFFICULTY_PROFILES.pro.aggression);
    expect(Math.abs(pro - 0.006) / 0.006).toBeLessThan(0.15);
  });

  it('stays a probability', () => {
    expect(contestChance(0.9, 1)).toBeLessThanOrEqual(1);
    expect(contestChance(-1, 1)).toBe(0);
  });
});
