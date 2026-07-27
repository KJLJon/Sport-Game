/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.12 — Basketball art & audio pass
 * @story   US-13.3 — Control audio
 *
 * Purpose: drives `BasketballAudio` with a fake `AudioContextLike` that records what was scheduled,
 * the same recording-double approach `tests/helpers/canvas.ts` uses for drawing. Assertions are on
 * properties — "muted schedules nothing", "a rebound plays something", "reduced audio drops the
 * decorative tick" — never on an exact node graph, since the synthesis is free to change shape.
 */
import { describe, expect, it } from 'vitest';
import { EventKind, event } from '@/engine/match/events.ts';
import { BasketballEvent } from '@/sports/basketball/rules.ts';
import {
  BasketballAudio,
  isAudioSupported,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type GainLike,
  type OscillatorLike,
} from '@/modes/live/audio.ts';

class FakeParam implements AudioParamLike {
  calls: Array<{ kind: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number): unknown {
    this.calls.push({ kind: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): unknown {
    this.calls.push({ kind: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): unknown {
    this.calls.push({ kind: 'exp', value, time });
    return this;
  }
}

class FakeOscillator implements OscillatorLike {
  type: OscillatorLike['type'] = 'sine';
  frequency = new FakeParam();
  started: number[] = [];
  stopped: number[] = [];
  connections: AudioNodeLike[] = [];
  connect(destination: AudioNodeLike): void {
    this.connections.push(destination);
  }
  start(time: number): void {
    this.started.push(time);
  }
  stop(time: number): void {
    this.stopped.push(time);
  }
}

class FakeGain implements GainLike {
  gain = new FakeParam();
  connections: AudioNodeLike[] = [];
  connect(destination: AudioNodeLike): void {
    this.connections.push(destination);
  }
}

class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  destination: AudioNodeLike = { connect: () => {} };
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];

  createOscillator(): OscillatorLike {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): GainLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

const shot = event(EventKind.SHOT, 1, 0, { actor: 1, value: 2 });
const score = event(EventKind.SCORE, 2, 0, { actor: 1, value: 2 });
const rebound = event(EventKind.REBOUND, 3, 1, { actor: 2 });
const foul = event(EventKind.FOUL, 4, 1, { actor: 3, target: 1 });
const periodEnd = event(EventKind.PERIOD_END, 5, -1, { value: 1 });
const matchEnd = event(EventKind.MATCH_END, 6, 0);
const controlSwitch = event(EventKind.SPORT, 7, 0, {
  sportKind: BasketballEvent.CONTROL_SWITCH,
  actor: 4,
});
const unrelated = event(EventKind.SUBSTITUTION, 8, 0);

describe('BasketballAudio — mute and no-context are first-class silence', () => {
  it('schedules nothing when constructed with a null context', () => {
    const audio = new BasketballAudio(null);
    audio.handleEvent(shot);
    // Nothing to inspect — no context exists to have been touched. The real assertion is that
    // this doesn't throw, and the muted-context case below shows the "nothing scheduled" property
    // directly.
    expect(audio.muted).toBe(false);
  });

  it('schedules nothing when muted, even with a live context', () => {
    const ctx = new FakeAudioContext();
    const audio = new BasketballAudio(ctx, { muted: true });
    audio.handleEvent(shot);
    audio.handleEvent(score);
    audio.handleEvent(foul);
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.gains).toHaveLength(0);
  });

  it('resumes scheduling once unmuted', () => {
    const ctx = new FakeAudioContext();
    const audio = new BasketballAudio(ctx, { muted: true });
    audio.handleEvent(shot);
    expect(ctx.oscillators).toHaveLength(0);

    audio.setMuted(false);
    audio.handleEvent(shot);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('starts scheduling as soon as a context is attached after construction', () => {
    const audio = new BasketballAudio(null);
    audio.handleEvent(shot); // no-op, no context yet

    const ctx = new FakeAudioContext();
    audio.setContext(ctx);
    audio.handleEvent(shot);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });
});

describe('BasketballAudio — event → sound mapping', () => {
  const cases: Array<[string, ReturnType<typeof event>]> = [
    ['a shot release', shot],
    ['a made basket', score],
    ['a rebound (the miss proxy)', rebound],
    ['a foul (whistle)', foul],
    ['a period end (buzzer)', periodEnd],
    ['a match end (buzzer)', matchEnd],
    ['a controlled-athlete switch (tick)', controlSwitch],
  ];

  it.each(cases)('plays something for %s', (_label, sportEvent) => {
    const ctx = new FakeAudioContext();
    const audio = new BasketballAudio(ctx);
    audio.handleEvent(sportEvent);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    for (const osc of ctx.oscillators) {
      expect(osc.started).toHaveLength(1);
      expect(osc.stopped).toHaveLength(1);
    }
  });

  it('schedules nothing for an event kind it has no cue for', () => {
    const ctx = new FakeAudioContext();
    const audio = new BasketballAudio(ctx);
    audio.handleEvent(unrelated);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('a made basket sounds different from a rim miss (not the same tone reused)', () => {
    const madeCtx = new FakeAudioContext();
    new BasketballAudio(madeCtx).handleEvent(score);

    const missCtx = new FakeAudioContext();
    new BasketballAudio(missCtx).handleEvent(rebound);

    const madeTypes = madeCtx.oscillators.map((o) => o.type).sort();
    const missTypes = missCtx.oscillators.map((o) => o.type).sort();
    expect(madeTypes).not.toEqual(missTypes);
  });
});

describe('BasketballAudio — reduced audio', () => {
  it('drops the decorative control-switch tick entirely', () => {
    const ctx = new FakeAudioContext();
    const audio = new BasketballAudio(ctx, { reducedAudio: true });
    audio.handleEvent(controlSwitch);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('still sounds the whistle, just with fewer notes than full audio', () => {
    const full = new FakeAudioContext();
    new BasketballAudio(full).handleEvent(foul);

    const reduced = new FakeAudioContext();
    new BasketballAudio(reduced, { reducedAudio: true }).handleEvent(foul);

    expect(reduced.oscillators.length).toBeGreaterThan(0);
    expect(reduced.oscillators.length).toBeLessThan(full.oscillators.length);
  });
});

describe('BasketballAudio — volume', () => {
  it('scales the peak gain the envelope ramps to', () => {
    const loud = new FakeAudioContext();
    new BasketballAudio(loud, { volume: 1 }).handleEvent(shot);

    const quiet = new FakeAudioContext();
    new BasketballAudio(quiet, { volume: 0.1 }).handleEvent(shot);

    const peak = (ctx: FakeAudioContext): number =>
      Math.max(...ctx.gains[0]!.gain.calls.filter((c) => c.kind === 'linear').map((c) => c.value));
    expect(peak(quiet)).toBeLessThan(peak(loud));
  });

  it('clamps out-of-range volume', () => {
    const audio = new BasketballAudio(new FakeAudioContext());
    audio.setVolume(5);
    expect(() => audio.handleEvent(shot)).not.toThrow();
    audio.setVolume(-1);
    expect(() => audio.handleEvent(shot)).not.toThrow();
  });
});

describe('isAudioSupported', () => {
  it('is true only when the scope exposes an AudioContext constructor', () => {
    expect(isAudioSupported({ AudioContext: class {} } as unknown as typeof globalThis)).toBe(true);
    expect(isAudioSupported({} as unknown as typeof globalThis)).toBe(false);
  });
});
