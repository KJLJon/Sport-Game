/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.1 — Utility-scoring decision framework shared across sports and modes
 * @story   US-7.1 — Play against the computer, US-7.2 — Choose a difficulty
 * @design  06-game-design.md §5, §7 (reaction latency)
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng.ts';
import { createDecider, deciderFor, type AiTuning } from '../../../src/engine/ai/decider.ts';
import { consider, type Candidate } from '../../../src/engine/ai/utility.ts';

const ACTOR = 3;

const candidate = (key: string, score: number): Candidate<string> => ({
  key,
  option: key,
  considerations: [consider('worth', score)],
});

describe('createDecider', () => {
  it('acts immediately when it was doing nothing', () => {
    const decider = createDecider<string>({ latencyMs: 300 });
    expect(decider.decide(ACTOR, 0, [candidate('press', 0.8)])?.key).toBe('press');
  });

  it('holds the committed option until the reaction time has passed', () => {
    const decider = createDecider<string>({ latencyMs: 300 });
    decider.decide(ACTOR, 0, [candidate('hold', 0.5)]);

    const better = [candidate('hold', 0.5), candidate('shoot', 0.9)];
    expect(decider.decide(ACTOR, 100, better)?.key).toBe('hold');
    expect(decider.decide(ACTOR, 399, better)?.key).toBe('hold');
    expect(decider.decide(ACTOR, 400, better)?.key).toBe('shoot');
  });

  it('reacts faster at a lower latency — the whole of how difficulty makes the CPU better', () => {
    const options = [candidate('hold', 0.5), candidate('shoot', 0.9)];
    const firstSwitch = (latencyMs: number) => {
      const decider = createDecider<string>({ latencyMs });
      decider.decide(ACTOR, 0, [candidate('hold', 0.5)]);
      for (let ms = 16; ms < 1000; ms += 16) {
        if (decider.decide(ACTOR, ms, options)?.key === 'shoot') return ms;
      }
      return Infinity;
    };
    expect(firstSwitch(90)).toBeLessThan(firstSwitch(280));
    expect(firstSwitch(280)).toBeLessThan(firstSwitch(420));
  });

  it('restarts the reaction clock when the challenger changes', () => {
    const decider = createDecider<string>({ latencyMs: 200 });
    decider.decide(ACTOR, 0, [candidate('hold', 0.5)]);
    decider.decide(ACTOR, 100, [candidate('hold', 0.5), candidate('pass', 0.9)]);
    // A different, better option appears at 150 — the reaction to the pass does not count towards it.
    decider.decide(ACTOR, 150, [candidate('hold', 0.5), candidate('shoot', 0.95)]);
    expect(
      decider.decide(ACTOR, 300, [candidate('hold', 0.5), candidate('shoot', 0.95)])?.key,
    ).toBe('hold');
    expect(
      decider.decide(ACTOR, 350, [candidate('hold', 0.5), candidate('shoot', 0.95)])?.key,
    ).toBe('shoot');
  });

  it('switches immediately when what it was doing is no longer possible', () => {
    const decider = createDecider<string>({ latencyMs: 500 });
    decider.decide(ACTOR, 0, [candidate('drive', 0.8)]);
    // The lane closed: the option is gone from the list entirely.
    expect(decider.decide(ACTOR, 16, [candidate('kick-out', 0.4)])?.key).toBe('kick-out');
  });

  it('switches immediately when what it was doing became illegal', () => {
    const decider = createDecider<string>({ latencyMs: 500 });
    decider.decide(ACTOR, 0, [candidate('drive', 0.8)]);
    const vetoed: Candidate<string> = {
      key: 'drive',
      option: 'drive',
      considerations: [consider('worth', 0.8), consider('haveBall', 0)],
    };
    expect(decider.decide(ACTOR, 16, [vetoed, candidate('press', 0.3)])?.key).toBe('press');
  });

  it('stops doing anything when nothing clears the threshold', () => {
    const decider = createDecider<string>({ threshold: 0.5 });
    decider.decide(ACTOR, 0, [candidate('shoot', 0.8)]);
    expect(decider.decide(ACTOR, 16, [candidate('shoot', 0.2)])).toBeNull();
  });

  it('does not abandon a plan for a marginally better one', () => {
    const decider = createDecider<string>({ latencyMs: 0, commitment: 0.15 });
    decider.decide(ACTOR, 0, [candidate('drive', 0.6)]);
    expect(decider.decide(ACTOR, 16, [candidate('drive', 0.6), candidate('pass', 0.7)])?.key).toBe(
      'drive',
    );
    expect(decider.decide(ACTOR, 32, [candidate('drive', 0.6), candidate('pass', 0.8)])?.key).toBe(
      'pass',
    );
  });

  it('does not dither when two options trade the lead every tick', () => {
    const decider = createDecider<string>({ latencyMs: 250, commitment: 0.05 });
    let switches = 0;
    let last: string | undefined;
    for (let tick = 0; tick < 120; tick += 1) {
      const wobble = tick % 2 === 0 ? 0.02 : -0.02;
      const key = decider.decide(ACTOR, tick * 16, [
        candidate('a', 0.6 + wobble),
        candidate('b', 0.6 - wobble),
      ])?.key;
      if (last !== undefined && key !== last) switches += 1;
      last = key;
    }
    expect(switches).toBe(0);
  });

  it('keeps one memory per actor', () => {
    const decider = createDecider<string>({ latencyMs: 300 });
    decider.decide(1, 0, [candidate('press', 0.7)]);
    decider.decide(2, 0, [candidate('drop', 0.7)]);
    expect(decider.inspect(1)?.committed?.key).toBe('press');
    expect(decider.inspect(2)?.committed?.key).toBe('drop');
    expect(decider.inspect(9)).toBeUndefined();
  });

  it('forgets an actor and resets the lot', () => {
    const decider = createDecider<string>();
    decider.decide(1, 0, [candidate('press', 0.7)]);
    decider.decide(2, 0, [candidate('drop', 0.7)]);
    decider.forget(1);
    expect(decider.inspect(1)).toBeUndefined();
    decider.reset();
    expect(decider.inspect(2)).toBeUndefined();
  });

  it('exposes the challenger it is reacting to', () => {
    const decider = createDecider<string>({ latencyMs: 300 });
    decider.decide(ACTOR, 0, [candidate('hold', 0.5)]);
    decider.decide(ACTOR, 100, [candidate('hold', 0.5), candidate('shoot', 0.9)]);
    expect(decider.inspect(ACTOR)).toMatchObject({ pendingKey: 'shoot', pendingSince: 100 });
  });

  it('is deterministic under noise for a seed', () => {
    const tuning: AiTuning = { latencyMs: 120, noise: 0.3, commitment: 0.05, threshold: 0.2 };
    const run = () => {
      const decider = deciderFor<string>(tuning, createRng('match').fork('ai'));
      const keys: (string | undefined)[] = [];
      for (let tick = 0; tick < 60; tick += 1) {
        keys.push(
          decider.decide(ACTOR, tick * 16, [
            candidate('a', 0.5),
            candidate('b', 0.55),
            candidate('c', 0.45),
          ])?.key,
        );
      }
      return keys;
    };
    expect(run()).toEqual(run());
  });
});
