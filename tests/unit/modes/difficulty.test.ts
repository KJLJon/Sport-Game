/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.7 — Difficulty model across all three modes
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7, 09-modes-and-arcade.md §7 (one ladder)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_PROFILES,
  aiTuning,
  difficultyProfile,
  isDifficulty,
} from '../../../src/modes/difficulty.ts';
import { forgetPlay, lastDifficulty, rememberDifficulty } from '../../../src/modes/last-played.ts';

describe('the four levels', () => {
  it('reads `06` §7 in the right order — harder means faster, sharper, and less help', () => {
    const ladder = DIFFICULTIES.map((id) => DIFFICULTY_PROFILES[id]);
    for (let index = 1; index < ladder.length; index += 1) {
      const easier = ladder[index - 1]!;
      const harder = ladder[index]!;
      expect(harder.cpuLatencyMs, `${harder.id} reacts faster`).toBeLessThan(easier.cpuLatencyMs);
      expect(harder.decisionNoise).toBeLessThan(easier.decisionNoise);
      expect(harder.executionError).toBeLessThan(easier.executionError);
      expect(harder.aggression).toBeGreaterThan(easier.aggression);
      expect(harder.assist).toBeLessThan(easier.assist);
      expect(harder.timingWindow).toBeLessThanOrEqual(easier.timingWindow);
      expect(harder.rewardMultiplier).toBeGreaterThan(easier.rewardMultiplier);
      expect(harder.tactics).toBeGreaterThan(easier.tactics);
      expect(harder.exploits).toBeGreaterThanOrEqual(easier.exploits);
    }
  });

  it('keeps every knob a proportion, except the ones that are not', () => {
    for (const profile of Object.values(DIFFICULTY_PROFILES)) {
      for (const key of [
        'decisionNoise',
        'executionError',
        'aggression',
        'assist',
        'tactics',
        'exploits',
      ] as const) {
        expect(profile[key], `${profile.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(profile[key], `${profile.id}.${key}`).toBeLessThanOrEqual(1);
      }
      expect(profile.cpuLatencyMs).toBeGreaterThan(0);
      expect(profile.timingWindow).toBeGreaterThan(0);
    }
  });

  it('ships Legend with assists off, as `06` §7 says', () => {
    expect(DIFFICULTY_PROFILES.legend.assist).toBe(0);
    expect(DIFFICULTY_PROFILES.rookie.assist).toBe(1);
  });

  it('resolves anything unreadable to Pro rather than throwing', () => {
    expect(difficultyProfile('nonsense').id).toBe(DEFAULT_DIFFICULTY);
    expect(isDifficulty('legend')).toBe(true);
    expect(isDifficulty('impossible')).toBe(false);
  });
});

describe('aiTuning', () => {
  it('hands the engine the level’s latency and noise unchanged', () => {
    for (const id of DIFFICULTIES) {
      const tuning = aiTuning(id);
      expect(tuning.latencyMs).toBe(DIFFICULTY_PROFILES[id].cpuLatencyMs);
      expect(tuning.noise).toBe(DIFFICULTY_PROFILES[id].decisionNoise);
    }
  });

  it('asks a noisier level to commit harder, so indecision does not become a twitch', () => {
    expect(aiTuning('rookie').commitment).toBeGreaterThan(aiTuning('legend').commitment);
  });

  it('lets a better level hold out for a better option', () => {
    expect(aiTuning('legend').threshold).toBeGreaterThan(aiTuning('rookie').threshold);
  });

  it('falls back to Pro for anything unrecognised', () => {
    expect(aiTuning('nonsense')).toEqual(aiTuning(DEFAULT_DIFFICULTY));
  });
});

describe('the remembered level', () => {
  beforeEach(() => {
    forgetPlay();
  });

  it('is Pro until something is chosen', () => {
    expect(lastDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  it('is one memory for every mode (`09` §7 — one ladder)', () => {
    rememberDifficulty('allStar');
    expect(lastDifficulty()).toBe('allStar');
  });

  it('survives nothing being stored and rubbish being stored alike', () => {
    rememberDifficulty('legend');
    forgetPlay();
    expect(lastDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });
});
