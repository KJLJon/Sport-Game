/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.1 — Follow camera: lookahead, deadzone, speed-scaled framing
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @task    T-12.6 — Per-sport camera profiles through the seam
 * @story   US-2.3 — See what is happening on a small screen
 * @design  04-architecture.md §6
 * @invariant INV-5 (nothing here knows which sport it is framing)
 *
 * Purpose: the framing *policy* — which phase a situation reads as, how wide to frame it, and where
 * to point. All pure, so the awkward cases are numbers rather than screenshots.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_PROFILE,
  PhaseTracker,
  cameraProfile,
  focusPoint,
  phaseFor,
  scaleForSpan,
  spanFor,
  type FramingSignal,
} from '@/engine/render/framing.ts';

const PITCH_WIDTH = 105;

function signal(overrides: Partial<FramingSignal> = {}): FramingSignal {
  return {
    ball: { x: 52.5, y: 34, vx: 0, vy: 0 },
    controlled: { x: 52.5, y: 34, vx: 0, vy: 0 },
    pressure: Number.POSITIVE_INFINITY,
    possession: 0,
    stoppage: null,
    ...overrides,
  };
}

describe('phase classification', () => {
  it('reads a still, uncontested ball as open play', () => {
    expect(phaseFor(signal(), DEFAULT_CAMERA_PROFILE)).toBe('openPlay');
  });

  it('reads a close opponent as a duel', () => {
    expect(phaseFor(signal({ pressure: 2 }), DEFAULT_CAMERA_PROFILE)).toBe('duel');
  });

  it('reads a fast ball as a counter', () => {
    const fast = signal({ ball: { x: 40, y: 34, vx: 16, vy: 0 } });
    expect(phaseFor(fast, DEFAULT_CAMERA_PROFILE)).toBe('counter');
  });

  it('reads a stoppage as a set piece, however fast the ball is moving', () => {
    // A ball being placed is not a counter-attack, and this is why the stoppage check comes first.
    const placed = signal({ ball: { x: 40, y: 34, vx: 20, vy: 0 }, stoppage: 'Throw-in' });
    expect(phaseFor(placed, DEFAULT_CAMERA_PROFILE)).toBe('setPiece');
  });

  it('prefers the duel when a fast ball is also contested', () => {
    // Sprinting away from a defender on your shoulder is a duel that happens to be quick; zooming
    // out then loses the only detail that matters.
    const both = signal({ ball: { x: 40, y: 34, vx: 16, vy: 0 }, pressure: 2 });
    expect(phaseFor(both, DEFAULT_CAMERA_PROFILE)).toBe('duel');
  });

  it('does not call a loose ball a duel', () => {
    const loose = signal({ possession: -1, pressure: Number.POSITIVE_INFINITY });
    expect(phaseFor(loose, DEFAULT_CAMERA_PROFILE)).toBe('openPlay');
  });
});

describe('phase hysteresis', () => {
  const dt = 1 / 60;

  it('holds the old phase until the new one has survived the dwell', () => {
    const tracker = new PhaseTracker(DEFAULT_CAMERA_PROFILE);
    const duel = signal({ pressure: 2 });

    tracker.update(dt, duel);
    expect(tracker.phase).toBe('openPlay');

    for (let i = 0; i < 60; i++) tracker.update(dt, duel);
    expect(tracker.phase).toBe('duel');
  });

  it('does not change phase when the reading flickers across the threshold', () => {
    const tracker = new PhaseTracker(DEFAULT_CAMERA_PROFILE);
    const inside = signal({ pressure: 4 });
    const outside = signal({ pressure: 6 });

    // Two players running together cross the duel radius several times a second. The camera must
    // not re-frame on each crossing — that hunting is the reason this class exists.
    for (let i = 0; i < 120; i++) tracker.update(dt, i % 2 === 0 ? inside : outside);
    expect(tracker.phase).toBe('openPlay');
  });

  it('enters and leaves a set piece immediately in both directions', () => {
    const tracker = new PhaseTracker(DEFAULT_CAMERA_PROFILE);

    tracker.update(dt, signal({ stoppage: 'Free kick' }));
    expect(tracker.phase).toBe('setPiece');

    tracker.update(dt, signal());
    expect(tracker.phase).toBe('openPlay');
  });

  it('forgets its history on a reset', () => {
    const tracker = new PhaseTracker(DEFAULT_CAMERA_PROFILE);
    for (let i = 0; i < 120; i++) tracker.update(dt, signal({ pressure: 2 }));
    expect(tracker.phase).toBe('duel');

    tracker.reset();
    expect(tracker.phase).toBe('openPlay');
  });
});

describe('focus point', () => {
  it('is the ball when there is no controlled athlete', () => {
    const focus = focusPoint(signal({ controlled: null }), DEFAULT_CAMERA_PROFILE);
    expect(focus.x).toBeCloseTo(52.5, 6);
  });

  it('holds both when the athlete is near the ball', () => {
    const near = signal({ controlled: { x: 48.5, y: 34, vx: 0, vy: 0 } });
    const focus = focusPoint(near, DEFAULT_CAMERA_PROFILE);

    // Between the two, weighted towards the ball but not on it.
    expect(focus.x).toBeGreaterThan(48.5);
    expect(focus.x).toBeLessThan(52.5);
  });

  it('commits to the ball once no single frame could hold both', () => {
    const far = signal({ controlled: { x: 10, y: 34, vx: 0, vy: 0 } });
    const focus = focusPoint(far, DEFAULT_CAMERA_PROFILE);

    // A midpoint here frames the empty grass between them, which is the worst of the three shots.
    expect(focus.x).toBeCloseTo(52.5, 6);
  });

  it('blends velocity the same way it blends position', () => {
    const moving = signal({
      ball: { x: 52.5, y: 34, vx: 10, vy: 0 },
      controlled: { x: 52.5, y: 34, vx: 0, vy: 0 },
    });
    const focus = focusPoint(moving, DEFAULT_CAMERA_PROFILE);
    expect(focus.vx).toBeCloseTo(7, 6);
  });
});

describe('span', () => {
  it('gives each phase its own width, tightest in a duel and widest at a set piece', () => {
    const still = { x: 52.5, y: 34, vx: 0, vy: 0 };
    const duel = spanFor('duel', still, DEFAULT_CAMERA_PROFILE, PITCH_WIDTH);
    const open = spanFor('openPlay', still, DEFAULT_CAMERA_PROFILE, PITCH_WIDTH);
    const counter = spanFor('counter', still, DEFAULT_CAMERA_PROFILE, PITCH_WIDTH);
    const setPiece = spanFor('setPiece', still, DEFAULT_CAMERA_PROFILE, PITCH_WIDTH);

    expect(duel).toBeLessThan(open);
    expect(open).toBeLessThan(counter);
    expect(counter).toBeLessThan(setPiece);
  });

  it('widens with speed, up to a bound', () => {
    const slow = spanFor('openPlay', { x: 0, y: 0, vx: 4, vy: 0 }, DEFAULT_CAMERA_PROFILE, 500);
    const fast = spanFor('openPlay', { x: 0, y: 0, vx: 12, vy: 0 }, DEFAULT_CAMERA_PROFILE, 500);
    const absurd = spanFor('openPlay', { x: 0, y: 0, vx: 90, vy: 0 }, DEFAULT_CAMERA_PROFILE, 500);

    expect(fast).toBeGreaterThan(slow);
    expect(absurd).toBeCloseTo(
      DEFAULT_CAMERA_PROFILE.spans.openPlay + DEFAULT_CAMERA_PROFILE.maxSpeedSpan,
      6,
    );
  });

  it('never asks for more field than there is', () => {
    // A basketball court is narrower than every phase span, so every phase clamps to the court and
    // basketball's framing barely moves. That is what makes one set of numbers safe for both sports.
    const court = 28;
    for (const phase of ['duel', 'openPlay', 'counter', 'setPiece'] as const) {
      expect(spanFor(phase, { x: 0, y: 0, vx: 9, vy: 0 }, DEFAULT_CAMERA_PROFILE, court)).toBe(
        court,
      );
    }
  });

  it('converts a span to a scale', () => {
    expect(scaleForSpan(900, 45)).toBeCloseTo(20, 6);
  });
});

describe('profiles', () => {
  it('returns the defaults when a sport has no opinion', () => {
    expect(cameraProfile()).toBe(DEFAULT_CAMERA_PROFILE);
  });

  it('merges a partial profile, including a partial span table', () => {
    const profile = cameraProfile({ spans: { duel: 18 }, duelRadius: 3 });

    expect(profile.spans.duel).toBe(18);
    expect(profile.spans.openPlay).toBe(DEFAULT_CAMERA_PROFILE.spans.openPlay);
    expect(profile.duelRadius).toBe(3);
    expect(profile.lookahead).toBe(DEFAULT_CAMERA_PROFILE.lookahead);
  });
});
