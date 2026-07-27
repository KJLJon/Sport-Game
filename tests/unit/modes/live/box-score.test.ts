/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @task    T-2.11 — Pause menu, quit, in-match settings, post-match summary with box score
 * @story   US-2.4 — See the state of the match at a glance
 * @invariant INV-9 (one event stream)
 *
 * Purpose: that a box score is a pure fold of the event stream and nothing else. The assist rule is
 * the one with judgement in it, so it gets the most cases — and the team-turnover case matters
 * because a box score whose totals disagree with the events it was built from is one nobody trusts.
 */
import { describe, expect, it } from 'vitest';
import { EventKind, event, type SportEvent } from '@/engine/match/events.ts';
import {
  applyEvent,
  createBoxScore,
  linesFor,
  shootingLine,
  teamLine,
} from '@/modes/live/box-score.ts';

function fold(events: readonly SportEvent[]) {
  const box = createBoxScore();
  for (const e of events) applyEvent(box, e);
  return box;
}

describe('scoring', () => {
  it('counts a three as an attempt, a make, and three points', () => {
    const box = fold([
      event(EventKind.SHOT, 10, 0, { actor: 1, value: 3 }),
      event(EventKind.SCORE, 12, 0, { actor: 1, value: 3 }),
    ]);
    const line = box.lines.get(1);
    expect(line).toMatchObject({
      points: 3,
      fieldGoalsAttempted: 1,
      fieldGoalsMade: 1,
      threesAttempted: 1,
      threesMade: 1,
    });
  });

  it('keeps free throws out of the field-goal columns', () => {
    const box = fold([
      event(EventKind.SHOT, 10, 0, { actor: 1, value: 1, detail: { zone: 'freeThrow' } }),
      event(EventKind.SCORE, 11, 0, { actor: 1, value: 1 }),
    ]);
    expect(box.lines.get(1)).toMatchObject({
      points: 1,
      freeThrowsAttempted: 1,
      freeThrowsMade: 1,
      fieldGoalsAttempted: 0,
      fieldGoalsMade: 0,
    });
  });

  it('counts a miss as an attempt and nothing else', () => {
    const box = fold([event(EventKind.SHOT, 10, 0, { actor: 1, value: 2 })]);
    expect(box.lines.get(1)).toMatchObject({
      fieldGoalsAttempted: 1,
      fieldGoalsMade: 0,
      points: 0,
    });
  });
});

describe('assists', () => {
  it('credits the passer when the basket follows soon after', () => {
    const box = fold([
      event(EventKind.PASS, 100, 0, { actor: 1 }),
      event(EventKind.SCORE, 140, 0, { actor: 2, value: 2 }),
    ]);
    expect(box.lines.get(1)?.assists).toBe(1);
  });

  it('does not credit a pass from too long ago', () => {
    const box = fold([
      event(EventKind.PASS, 100, 0, { actor: 1 }),
      event(EventKind.SCORE, 400, 0, { actor: 2, value: 2 }),
    ]);
    expect(box.lines.get(1)?.assists ?? 0).toBe(0);
  });

  it('does not credit the other team, or a passer scoring off their own pass', () => {
    const crossed = fold([
      event(EventKind.PASS, 100, 1, { actor: 5 }),
      event(EventKind.SCORE, 120, 0, { actor: 2, value: 2 }),
    ]);
    expect(crossed.lines.get(5)?.assists ?? 0).toBe(0);

    const self = fold([
      event(EventKind.PASS, 100, 0, { actor: 2 }),
      event(EventKind.SCORE, 120, 0, { actor: 2, value: 2 }),
    ]);
    expect(self.lines.get(2)?.assists ?? 0).toBe(0);
  });

  it('credits one assist per basket, not one per pass', () => {
    const box = fold([
      event(EventKind.PASS, 100, 0, { actor: 1 }),
      event(EventKind.SCORE, 120, 0, { actor: 2, value: 2 }),
      event(EventKind.SCORE, 140, 0, { actor: 2, value: 2 }),
    ]);
    expect(box.lines.get(1)?.assists).toBe(1);
  });

  it('never credits an assist on a free throw', () => {
    const box = fold([
      event(EventKind.PASS, 100, 0, { actor: 1 }),
      event(EventKind.SCORE, 120, 0, { actor: 2, value: 1 }),
    ]);
    expect(box.lines.get(1)?.assists ?? 0).toBe(0);
  });
});

describe('everything else', () => {
  it('splits rebounds by end', () => {
    const box = fold([
      event(EventKind.REBOUND, 10, 0, { actor: 1, detail: { kind: 'offensive' } }),
      event(EventKind.REBOUND, 20, 0, { actor: 1, detail: { kind: 'defensive' } }),
    ]);
    expect(box.lines.get(1)).toMatchObject({ rebounds: 2, offensiveRebounds: 1 });
  });

  it('gives an unattributable turnover to the team', () => {
    const box = fold([
      event(EventKind.TURNOVER, 10, 0, { detail: { reason: 'shot clock' } }),
      event(EventKind.TURNOVER, 20, 0, { actor: 3, detail: { reason: 'stolen' } }),
    ]);
    expect(box.lines.get(3)?.turnovers).toBe(1);
    expect(box.teamTurnovers[0]).toBe(1);
    // The team total is both, which is what the events actually said happened.
    expect(teamLine(box, 0).turnovers).toBe(2);
  });

  it('counts steals, blocks, and fouls', () => {
    const box = fold([
      event(EventKind.SPORT, 10, 1, { sportKind: 'basketball.steal', actor: 7 }),
      event(EventKind.SPORT, 20, 1, { sportKind: 'basketball.block', actor: 7 }),
      event(EventKind.FOUL, 30, 1, { actor: 7 }),
    ]);
    expect(box.lines.get(7)).toMatchObject({ steals: 1, blocks: 1, fouls: 1 });
  });

  it('ignores events with nobody to attribute them to', () => {
    const box = fold([
      event(EventKind.SHOT, 10, 0, {}),
      event(EventKind.REBOUND, 20, 0, {}),
      event(EventKind.PERIOD_START, 0, -1, { value: 2 }),
    ]);
    expect(box.lines.size).toBe(0);
  });
});

describe('team totals', () => {
  it('are summed from the lines, so the two can never disagree', () => {
    const box = fold([
      event(EventKind.SCORE, 10, 0, { actor: 1, value: 2 }),
      event(EventKind.SCORE, 20, 0, { actor: 2, value: 3 }),
      event(EventKind.SCORE, 30, 1, { actor: 9, value: 2 }),
    ]);

    expect(teamLine(box, 0).points).toBe(5);
    expect(teamLine(box, 1).points).toBe(2);
    expect(linesFor(box, 0).map((l) => l.athlete)).toEqual([1, 2]);
    expect(teamLine(box, 0).players).toHaveLength(2);
  });

  it('formats a shooting line, including the nobody-shot case', () => {
    expect(shootingLine(0, 0)).toBe('0-0');
    expect(shootingLine(5, 10)).toBe('5-10 (50%)');
    expect(shootingLine(1, 3)).toBe('1-3 (33%)');
  });
});
