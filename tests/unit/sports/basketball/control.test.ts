/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.9 — Control switching: auto on turnover, manual cycle, controlled-athlete indicator
 * @story   US-2.2 — Switch which athlete I am controlling
 * @design  06-game-design.md §2 (auto-switch is an assist, tunable on its own)
 *
 * Purpose: that the player's thumb stays attached to somebody. The hysteresis test is the one that
 * matters — without a margin, two athletes a hand's breadth apart trade control every few frames
 * and the player is nobody.
 */
import { describe, expect, it } from 'vitest';
import { NO_ENTITY } from '@/engine/world.ts';
import {
  CONTROL,
  cycleControlled,
  pickControlled,
  shouldAutoSwitch,
  type Candidate,
} from '@/sports/basketball/control.ts';

function at(athlete: number, toBall: number, carrier = false, toOwnBasket = 10): Candidate {
  return { athlete, toBall, toOwnBasket, carrier };
}

describe('who the player is', () => {
  it('is whoever has the ball', () => {
    const field = [at(1, 8), at(2, 0.2, true), at(3, 3)];
    expect(pickControlled(field, 1, true)).toBe(2);
  });

  it('follows the ball off it, nearest first', () => {
    const field = [at(1, 8), at(2, 1), at(3, 3)];
    expect(pickControlled(field, NO_ENTITY, true)).toBe(2);
  });

  it('does not trade control between two athletes standing together', () => {
    const held = at(1, 3);
    const barely = at(2, 3 - CONTROL.switchMargin / 2);
    expect(pickControlled([held, barely], 1, true)).toBe(1);

    const clearly = at(2, 3 - CONTROL.switchMargin - 0.1);
    expect(pickControlled([held, clearly], 1, true)).toBe(2);
  });

  it('breaks a dead tie the same way every time', () => {
    const field = [at(5, 2, false, 4), at(3, 2, false, 9)];
    expect(pickControlled(field, NO_ENTITY, true)).toBe(5);
    expect(pickControlled(field, NO_ENTITY, true)).toBe(5);
  });

  it('leaves the choice alone with auto-switch off', () => {
    const field = [at(1, 9), at(2, 0.5)];
    expect(pickControlled(field, 1, false)).toBe(1);
    expect(pickControlled(field, 1, true)).toBe(2);
  });

  it('keeps the player off the ball with auto-switch off — that is what off means', () => {
    const field = [at(1, 9), at(2, 0.2, true)];
    expect(pickControlled(field, 1, false)).toBe(1);
    expect(pickControlled(field, 1, true)).toBe(2);
  });

  it('finds somebody when the held athlete has left the floor', () => {
    const field = [at(4, 3), at(5, 6)];
    expect(pickControlled(field, 99, false)).toBe(4);
    expect(pickControlled([], 1, true)).toBe(NO_ENTITY);
  });
});

describe('cycling by hand', () => {
  it('walks the roster and wraps', () => {
    const order = [10, 11, 12];
    expect(cycleControlled(order, 10)).toBe(11);
    expect(cycleControlled(order, 12)).toBe(10);
  });

  it('starts somewhere when nobody is held', () => {
    expect(cycleControlled([10, 11], NO_ENTITY)).toBe(10);
    expect(cycleControlled([], 10)).toBe(NO_ENTITY);
  });
});

describe('possession changes', () => {
  it('forces a switch when the ball changes hands, and only then', () => {
    expect(shouldAutoSwitch(0, 1, true)).toBe(true);
    expect(shouldAutoSwitch(0, 0, true)).toBe(false);
    expect(shouldAutoSwitch(0, 1, false)).toBe(false);
  });
});
