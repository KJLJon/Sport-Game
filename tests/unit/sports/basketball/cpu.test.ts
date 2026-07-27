/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.8 — Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions
 * @story   US-7.1 — Play against a CPU that plays the sport properly
 * @design  06-game-design.md §3.1 (schemes), §7 (difficulty)
 * @invariant INV-8 (determinism)
 *
 * Purpose: that the CPU's judgement is expected points and not a pile of thresholds. The test that
 * matters most is the corner three — a 36% three beating a 48% long two is the thing no
 * distance-and-openness rule ever gets right, and the reason the decision is framed this way.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { CENTRE_Y, COURT, attackedBasket, shotDistance } from '@/sports/basketball/court.ts';
import {
  CPU,
  Decision,
  decide,
  expectedPoints,
  offensiveSpot,
  screenSpot,
  shotBar,
  shouldCut,
  shouldHelp,
  shouldShoot,
  spotFor,
  zoneSpot,
  type Look,
} from '@/sports/basketball/cpu.ts';

const OPEN: Look = { expected: 1.2, contest: 0.1 };
const COVERED: Look = { expected: 0.4, contest: 0.9 };

describe('the shot bar', () => {
  it('starts at the possession value and falls to nothing', () => {
    expect(shotBar(24)).toBe(CPU.possessionValue);
    expect(shotBar(CPU.urgencyFrom)).toBe(CPU.possessionValue);
    expect(shotBar(0)).toBe(0);
    expect(shotBar(CPU.urgencyTo)).toBe(0);
  });

  it('falls monotonically in between', () => {
    let previous = Infinity;
    for (let s = CPU.urgencyFrom; s >= 0; s -= 0.5) {
      expect(shotBar(s)).toBeLessThanOrEqual(previous);
      previous = shotBar(s);
    }
  });

  it('sits below league-average efficiency, because declining a shot costs something', () => {
    expect(CPU.possessionValue).toBeLessThan(1.05);
    expect(CPU.possessionValue).toBeGreaterThan(0.6);
  });
});

describe('choosing a shot', () => {
  it('prefers a 36% three to a 40% two, despite the worse make rate', () => {
    expect(expectedPoints(0.36, 3)).toBeGreaterThan(expectedPoints(0.4, 2));
    expect(shouldShoot(0.36, 3, 20)).toBe(true);
    expect(shouldShoot(0.4, 2, 20)).toBe(false);
  });

  it('takes anything at all once the clock is gone', () => {
    expect(shouldShoot(0.05, 2, 1)).toBe(true);
    expect(shouldShoot(0.05, 2, 20)).toBe(false);
  });
});

describe('the possession decision', () => {
  it('shoots a look that clears the bar', () => {
    expect(decide(OPEN, null, 1, 20)).toBe(Decision.SHOOT);
  });

  it('moves the ball only for a clearly better look', () => {
    const own: Look = { expected: 0.6, contest: 0.3 };
    const marginal = { look: { expected: 0.65, contest: 0.2 }, open: true };
    const clear = { look: { expected: 0.95, contest: 0.2 }, open: true };

    expect(decide(own, marginal, 1, 20)).not.toBe(Decision.PASS);
    expect(decide(own, clear, 1, 20)).toBe(Decision.PASS);
  });

  it('will not pass to a covered teammate however good their spot is', () => {
    const own: Look = { expected: 0.5, contest: 0.3 };
    const covered = { look: { expected: 1.0, contest: 0.9 }, open: false };
    expect(decide(own, covered, 1, 20)).not.toBe(Decision.PASS);
  });

  it('drives an open lane rather than holding', () => {
    const own: Look = { expected: 0.4, contest: 0.5 };
    expect(decide(own, null, 0.1, 20)).toBe(Decision.DRIVE);
    expect(decide(own, null, 0.9, 20)).toBe(Decision.HOLD);
  });

  it('takes a merely-open teammate once the clock is short', () => {
    const own: Look = { expected: 0.08, contest: 0.9 };
    const open = { look: { expected: 0.12, contest: 0.2 }, open: true };
    expect(decide(own, open, 0.9, 20)).toBe(Decision.HOLD);
    expect(decide(own, open, 0.9, CPU.desperationFrom - 1)).toBe(Decision.PASS);
  });

  it('never shoots a hopeless look while there is time', () => {
    expect(decide(COVERED, null, 0.9, 22)).not.toBe(Decision.SHOOT);
  });
});

describe('spacing', () => {
  const SIDES = [0, 1] as const;

  it('puts all five roles in the attacking half, well apart', () => {
    for (const side of SIDES) {
      const spots = [0, 1, 2, 3, 4].map((i) => offensiveSpot(i, side));
      for (const spot of spots) {
        const basket = attackedBasket(side);
        expect(Math.hypot(spot.x - basket.x, spot.y - basket.y)).toBeLessThan(12);
      }

      // No two roles standing on top of each other.
      for (let a = 0; a < spots.length; a++) {
        for (let b = a + 1; b < spots.length; b++) {
          const p = spots[a]!;
          const q = spots[b]!;
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(2.5);
        }
      }
    }
  });

  it('touches both sidelines and the top of the key', () => {
    const spots = [0, 1, 2, 3, 4].map((i) => offensiveSpot(i, 0));
    expect(Math.min(...spots.map((s) => s.y))).toBeLessThan(4);
    expect(Math.max(...spots.map((s) => s.y))).toBeGreaterThan(11);
    // Somebody is behind the arc, or nothing spaces the floor at all.
    expect(Math.max(...spots.map((s) => shotDistance(s.x, s.y, 0)))).toBeGreaterThan(6.75);
  });

  it('mirrors between the two ends', () => {
    for (let i = 0; i < 5; i++) {
      const a = offensiveSpot(i, 0);
      const b = offensiveSpot(i, 1);
      expect(a.x + b.x).toBeCloseTo(COURT.length, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
    expect(spotFor({ x: 0.5, y: 0.5 }, 0)).toEqual(spotFor({ x: 0.5, y: 0.5 }, 1));
  });
});

describe('the zone', () => {
  it('leans towards the ball rather than standing still', () => {
    const left = zoneSpot(0, 0, { x: 8, y: 2 });
    const right = zoneSpot(0, 0, { x: 8, y: 13 });
    expect(right.y).toBeGreaterThan(left.y);
  });

  it('keeps its top defenders outside the arc', () => {
    for (const role of [0, 1]) {
      const spot = zoneSpot(role, 0, { x: 8, y: CENTRE_Y });
      // Measured from the basket this side defends: side 0 defends the low-x basket.
      const basket = attackedBasket(1);
      expect(Math.hypot(spot.x - basket.x, spot.y - basket.y)).toBeGreaterThan(6.75);
    }
  });

  it('sits in its own half', () => {
    for (let i = 0; i < 5; i++) {
      expect(zoneSpot(i, 0, { x: 8, y: CENTRE_Y }).x).toBeLessThan(COURT.length / 2);
      expect(zoneSpot(i, 1, { x: 20, y: CENTRE_Y }).x).toBeGreaterThan(COURT.length / 2);
    }
  });
});

describe('off-ball actions', () => {
  it('screens in front of the handler s defender, on the far side', () => {
    const handler = { x: 14, y: 7.5 };
    const defender = { x: 15.5, y: 7.5 };
    const spot = screenSpot(handler, defender);
    expect(spot.x).toBeGreaterThan(defender.x);
    expect(spot.y).toBeCloseTo(7.5, 6);
  });

  it('cuts only from range, and only when somebody has the ball', () => {
    const rng = createRng('cut');
    expect(shouldCut(2, true, rng)).toBe(false);
    expect(shouldCut(9, false, rng)).toBe(false);

    let cuts = 0;
    for (let i = 0; i < 5000; i++) if (shouldCut(9, true, rng)) cuts++;
    expect(cuts).toBeGreaterThan(0);
    // Rare: a cut every step would be a sprint, not a cut.
    expect(cuts).toBeLessThan(5000 * 0.02);
  });

  it('helps on a drive to the rim, never on its own man', () => {
    expect(shouldHelp(3, 2, false)).toBe(true);
    expect(shouldHelp(3, 2, true)).toBe(false);
    // Too far from the ball, or the ball too far from the rim.
    expect(shouldHelp(9, 2, false)).toBe(false);
    expect(shouldHelp(3, 9, false)).toBe(false);
  });
});
