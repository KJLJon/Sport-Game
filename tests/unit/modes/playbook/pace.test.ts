/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.7 — Auto-call assistant coach, fast-forward, turn-speed control
 * @story   US-15.6 — Keep a long match from becoming a chore
 * @design  09-modes-and-arcade.md §2.1, 10-ui-ux.md §6
 *
 * Pacing is arithmetic, so it is tested as arithmetic. The claim worth protecting hardest: going
 * faster changes how long you watch a possession and never what happened in it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACE,
  FAST_FORWARD,
  SPEED_MULTIPLIERS,
  TURN_SPEEDS,
  TurnPlayback,
  coachTakesTurn,
  isTurnSpeed,
  paceFor,
} from '../../../../src/modes/playbook/pace.ts';
import type { TurnDiagram } from '../../../../src/modes/playbook/diagram.ts';

const DIAGRAM: TurnDiagram = {
  seconds: 6,
  basket: { x: 0.9, y: 0.5 },
  caption: 'x',
  markers: [{ id: 1, side: 0, label: '7', from: { x: 0.4, y: 0.5 }, to: { x: 0.7, y: 0.5 } }],
  shapes: [
    {
      kind: 'shot',
      from: { x: 0.7, y: 0.5 },
      to: { x: 0.9, y: 0.5 },
      at: 0.6,
      until: 0.95,
      made: true,
    },
  ],
};

describe('speeds', () => {
  it('offers exactly the four `09` §2.1 implies, and validates them', () => {
    expect([...TURN_SPEEDS]).toEqual(['slow', 'normal', 'fast', 'instant']);
    expect(isTurnSpeed('fast')).toBe(true);
    expect(isTurnSpeed('warp')).toBe(false);
  });

  it('makes normal exactly the diagram’s own duration', () => {
    expect(SPEED_MULTIPLIERS.normal).toBe(1);
    expect(SPEED_MULTIPLIERS.slow).toBeLessThan(1);
    expect(SPEED_MULTIPLIERS.fast).toBeGreaterThan(1);
  });

  it('multiplies the chosen speed while the screen is held', () => {
    expect(paceFor('normal', true, false)).toBe(FAST_FORWARD);
    expect(paceFor('slow', true, false)).toBeCloseTo(SPEED_MULTIPLIERS.slow * FAST_FORWARD, 6);
  });

  it('lets reduced motion outrank every other choice (`10` §6)', () => {
    for (const speed of TURN_SPEEDS) {
      expect(paceFor(speed, false, true)).toBe(Infinity);
      expect(paceFor(speed, true, true)).toBe(Infinity);
    }
  });

  it('starts at normal with the coach off', () => {
    expect(DEFAULT_PACE).toEqual({ speed: 'normal', autoCall: 'off' });
  });
});

describe('the Auto-call toggle', () => {
  it('takes the turn only while it is on', () => {
    expect(coachTakesTurn({ speed: 'normal', autoCall: 'on' }, false)).toBe(true);
    expect(coachTakesTurn({ speed: 'normal', autoCall: 'off' }, false)).toBe(false);
  });

  it('always hands back for a key moment — "for stretches", not "for you"', () => {
    expect(coachTakesTurn({ speed: 'normal', autoCall: 'on' }, true)).toBe(false);
  });
});

describe('playback', () => {
  it('starts at the beginning and ends at the end', () => {
    const playback = new TurnPlayback(DIAGRAM);
    expect(playback.elapsed).toBe(0);
    expect(playback.progress).toBe(0);
    expect(playback.finished).toBe(false);

    playback.advance(6, 'normal');
    expect(playback.finished).toBe(true);
    expect(playback.progress).toBe(1);
  });

  it('takes half the real time at double speed', () => {
    const fast = new TurnPlayback(DIAGRAM);
    fast.advance(3, 'fast');
    expect(fast.finished).toBe(true);

    const normal = new TurnPlayback(DIAGRAM);
    normal.advance(3, 'normal');
    expect(normal.finished).toBe(false);
    expect(normal.elapsed).toBeCloseTo(3, 6);
  });

  it('finishes a six-second turn in a second and a half while held', () => {
    const playback = new TurnPlayback(DIAGRAM);
    playback.advance(1.5, 'normal', true);
    expect(playback.finished).toBe(true);
  });

  it('never runs past the end, however long the frame was', () => {
    const playback = new TurnPlayback(DIAGRAM);
    playback.advance(500, 'fast');
    expect(playback.elapsed).toBe(DIAGRAM.seconds);
  });

  it('ignores a negative delta rather than rewinding', () => {
    const playback = new TurnPlayback(DIAGRAM);
    playback.advance(2, 'normal');
    playback.advance(-5, 'normal');
    expect(playback.elapsed).toBeCloseTo(2, 6);
  });

  it('lands on the final frame in one call under reduced motion', () => {
    const playback = new TurnPlayback(DIAGRAM);
    playback.advance(1 / 60, 'slow', false, true);
    expect(playback.finished).toBe(true);
    expect(playback.frame().shapes.every((shape) => shape.progress === 1)).toBe(true);
  });

  it('skips straight to the end on demand', () => {
    const playback = new TurnPlayback(DIAGRAM);
    playback.skip();
    expect(playback.finished).toBe(true);
  });

  it('shows the same final picture however fast it got there', () => {
    const slow = new TurnPlayback(DIAGRAM);
    const held = new TurnPlayback(DIAGRAM);
    const skipped = new TurnPlayback(DIAGRAM);

    for (let i = 0; i < 600; i += 1) slow.advance(1 / 60, 'slow');
    held.advance(2, 'fast', true);
    skipped.skip();

    expect(held.frame()).toEqual(slow.frame());
    expect(skipped.frame()).toEqual(slow.frame());
  });

  it('treats a zero-length diagram as already done', () => {
    const playback = new TurnPlayback({ ...DIAGRAM, seconds: 0 });
    expect(playback.finished).toBe(true);
    expect(playback.progress).toBe(1);
  });
});
