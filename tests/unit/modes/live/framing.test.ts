/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.1 — Follow camera
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @story   US-2.3 — See what is happening on a small screen
 * @design  04-architecture.md §6
 * @invariant INV-5 (nothing here names a sport), INV-8 (render never feeds the sim)
 *
 * Purpose: the bridge between a running match and the camera's sport-agnostic signal. Small, and
 * worth its own tests because everything downstream of it is only as honest as the numbers it
 * reports — a `pressure` that counted the wrong side would make the camera frame duels that are not
 * happening, and nothing would fail.
 */
import { describe, expect, it } from 'vitest';
import { World } from '@/engine/world.ts';
import { framingSignal, nearestOpponentDistance } from '@/modes/live/framing.ts';
import { createBoxScore } from '@/modes/live/box-score.ts';
import type { MatchView } from '@/modes/live/match.ts';

function view(overrides: Partial<MatchView['status']> = {}, playerSide: 0 | 1 = 0): MatchView {
  return {
    phase: 'live',
    period: 1,
    periodName: 'Half',
    finished: false,
    score: [0, 0],
    playerSide,
    steps: 0,
    box: createBoxScore(),
    status: {
      actionClock: null,
      teamFouls: null,
      bonus: null,
      possession: 0,
      controlled: -1,
      stoppage: null,
      meter: null,
      periodClock: 600,
      ...overrides,
    },
  };
}

function pitch() {
  return new World({ width: 105, height: 68, cellSize: 8, capacity: 32 });
}

describe('the framing signal', () => {
  it('reports the ball s position and velocity', () => {
    const w = pitch();
    const ball = w.spawn({ x: 40, y: 30, kind: 1, team: -1 });
    w.vx[ball] = 7;
    w.vy[ball] = -2;

    const signal = framingSignal(w, view(), ball);

    expect(signal.ball.x).toBe(40);
    expect(signal.ball.vx).toBe(7);
    expect(signal.ball.vy).toBe(-2);
  });

  it('reports the controlled athlete, or null when nobody is being controlled', () => {
    const w = pitch();
    const ball = w.spawn({ x: 40, y: 30, kind: 1, team: -1 });
    const athlete = w.spawn({ x: 20, y: 50, team: 0 });

    expect(framingSignal(w, view(), ball).controlled).toBeNull();
    expect(framingSignal(w, view({ controlled: athlete }), ball).controlled?.x).toBe(20);
  });

  it('does not mistake the ball for an athlete if it is somehow the controlled id', () => {
    // Defensive: `controlled` is a `-1`-or-entity field and a sport that got this wrong would
    // otherwise make the focus blend average the ball with itself.
    const w = pitch();
    const ball = w.spawn({ x: 40, y: 30, kind: 1, team: -1 });

    expect(framingSignal(w, view({ controlled: ball }), ball).controlled).toBeNull();
  });

  it('passes the stoppage and possession through untouched', () => {
    const w = pitch();
    const ball = w.spawn({ x: 40, y: 30, kind: 1, team: -1 });

    const signal = framingSignal(w, view({ stoppage: 'Throw-in', possession: 1 }), ball);
    expect(signal.stoppage).toBe('Throw-in');
    expect(signal.possession).toBe(1);
  });
});

describe('pressure', () => {
  it('measures the nearest opponent of whoever holds the ball, not the nearest anybody', () => {
    const w = pitch();
    const ball = w.spawn({ x: 50, y: 34, kind: 1, team: -1 });
    w.spawn({ x: 51, y: 34, team: 0 }); // a team-mate, right beside it
    w.spawn({ x: 58, y: 34, team: 1 }); // the nearest opponent, further away

    // Side 0 has the ball, so a team-mate standing on it is not pressure.
    expect(framingSignal(w, view({ possession: 0 }), ball).pressure).toBeCloseTo(8, 6);
  });

  it('is infinite for a loose ball, because a fifty-fifty is not a duel', () => {
    const w = pitch();
    const ball = w.spawn({ x: 50, y: 34, kind: 1, team: -1 });
    w.spawn({ x: 51, y: 34, team: 1 });

    expect(framingSignal(w, view({ possession: -1 }), ball).pressure).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('swaps which side counts as the opposition when possession does', () => {
    const w = pitch();
    const ball = w.spawn({ x: 50, y: 34, kind: 1, team: -1 });
    w.spawn({ x: 53, y: 34, team: 0 });
    w.spawn({ x: 60, y: 34, team: 1 });

    expect(framingSignal(w, view({ possession: 0 }), ball).pressure).toBeCloseTo(10, 6);
    expect(framingSignal(w, view({ possession: 1 }), ball).pressure).toBeCloseTo(3, 6);
  });

  it('ignores the ball itself when looking for the nearest opponent', () => {
    const w = pitch();
    w.spawn({ x: 50, y: 34, kind: 1, team: 1 });
    w.spawn({ x: 70, y: 34, team: 1 });

    // A ball tagged with a side — some sports do — must not count as its own marker.
    expect(nearestOpponentDistance(w, 50, 34, 0)).toBeCloseTo(20, 6);
  });

  it('is infinite when the opposition has nobody on the field', () => {
    const w = pitch();
    w.spawn({ x: 20, y: 20, team: 0 });

    expect(nearestOpponentDistance(w, 50, 34, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});
