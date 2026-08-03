/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.3 — Team coordination: formation shape, phase of play, pressing triggers, help defence, transition
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5
 */
import { describe, expect, it } from 'vitest';
import {
  assignMarks,
  goalSideSpot,
  type Markable,
  type Marker,
} from '../../../src/engine/ai/marking.ts';

const marker = (id: number, x: number, y = 0, urgency = 0.5): Marker => ({ id, x, y, urgency });
const attacker = (id: number, x: number, y = 0, danger = 0): Markable => ({ id, x, y, danger });

describe('assignMarks', () => {
  it('gives each marker one attacker and each attacker one marker', () => {
    const marks = assignMarks(
      [marker(1, 0), marker(2, 10), marker(3, 20)],
      [attacker(10, 1), attacker(11, 11), attacker(12, 21)],
    );

    expect([...marks]).toEqual([
      [1, 10],
      [2, 11],
      [3, 12],
    ]);
  });

  it('picks the carrier up first, whoever that leaves free', () => {
    // 2 is closest to both, and the carrier is the one it must take.
    const marks = assignMarks(
      [marker(1, 0), marker(2, 9)],
      [attacker(10, 8), attacker(11, 10, 0, 1)],
    );

    expect(marks.get(2)).toBe(11);
    expect(marks.get(1)).toBe(10);
  });

  it('leaves attackers unmarked when there are more of them than of us', () => {
    const marks = assignMarks([marker(1, 0)], [attacker(10, 1), attacker(11, 2)]);

    expect(marks.size).toBe(1);
    expect(marks.get(1)).toBe(10);
  });

  it('keeps a mark until a challenger beats the incumbent by the hysteresis', () => {
    const previous = new Map([
      [1, 10],
      [2, 11],
    ]);
    const attackers = [attacker(10, 10), attacker(11, 20)];

    // 2 is a metre closer to 10 than the incumbent 1, which is not enough to trade marks.
    const held = assignMarks([marker(1, 0), marker(2, 1)], attackers, {
      previous,
      hysteresis: 3,
    });
    expect(held.get(1)).toBe(10);

    // Four metres closer is, and the swap leaves 1 with the attacker 2 abandoned.
    const swapped = assignMarks([marker(1, 0), marker(2, 6)], attackers, {
      previous,
      hysteresis: 3,
    });
    expect(swapped.get(2)).toBe(10);
    expect(swapped.get(1)).toBe(11);
  });

  it('will not chase a man beyond the range', () => {
    expect(assignMarks([marker(1, 0)], [attacker(10, 30)], { range: 20 }).size).toBe(0);
    expect(assignMarks([marker(1, 0)], [attacker(10, 30)], { range: 40 }).get(1)).toBe(10);
  });

  it('prefers the keener marker over the marginally closer one', () => {
    const marks = assignMarks([marker(1, 4, 0, 1), marker(2, 3, 0, 0.1)], [attacker(10, 0)]);

    expect(marks.get(1)).toBe(10);
  });

  it('does not depend on the order the sport happened to list anybody in', () => {
    const markers = [marker(1, 0), marker(2, 10), marker(3, 20)];
    const attackers = [attacker(10, 1), attacker(11, 11), attacker(12, 21)];

    const forwards = assignMarks(markers, attackers);
    const backwards = assignMarks([...markers].reverse(), [...attackers].reverse());

    expect([...backwards].sort()).toEqual([...forwards].sort());
  });

  it('breaks an exact tie by id rather than by list position', () => {
    const marks = assignMarks([marker(7, 5), marker(3, -5)], [attacker(10, 0)]);

    expect(marks.get(3)).toBe(10);
  });

  it('is empty when either side of the match is', () => {
    expect(assignMarks([], [attacker(10, 0)]).size).toBe(0);
    expect(assignMarks([marker(1, 0)], []).size).toBe(0);
  });
});

describe('goalSideSpot', () => {
  it('stands between the mark and the goal, a stand-off in front', () => {
    const spot = goalSideSpot({ x: 20, y: 25 }, { x: 0, y: 25 }, 2);

    expect(spot).toEqual({ x: 18, y: 25 });
  });

  it('never overshoots the goal it is protecting', () => {
    const spot = goalSideSpot({ x: 1, y: 25 }, { x: 0, y: 25 }, 5);

    expect(spot.x).toBe(0);
  });

  it('stands on a mark that is already on the goal', () => {
    const spot = goalSideSpot({ x: 0, y: 25 }, { x: 0, y: 25 }, 2);

    expect(spot).toEqual({ x: 0, y: 25 });
  });

  it('writes into the buffer it is given', () => {
    const out = { x: 0, y: 0 };

    expect(goalSideSpot({ x: 10, y: 0 }, { x: 0, y: 0 }, 4, out)).toBe(out);
    expect(out.x).toBe(6);
  });
});
