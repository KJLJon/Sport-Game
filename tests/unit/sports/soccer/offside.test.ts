/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.3 — Offside detection and enforcement
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2
 *
 * Purpose: the one thing Law 11 is actually about — the moment the ball is played, not the moment
 * it arrives. The central test is a striker who is level at the pass and clear when it lands, and
 * who must be onside.
 */
import { describe, expect, it } from 'vitest';
import { EventKind } from '@/engine/match/events.ts';
import { CENTRE_X, CENTRE_Y, PITCH } from '@/sports/soccer/pitch.ts';
import {
  attackDepth,
  captureOffside,
  isInOffsidePosition,
  isOffsideExempt,
  judgeOffside,
  offenceSpot,
  offsideLine,
  offsideOffence,
  type PlayerPosition,
} from '@/sports/soccer/offside.ts';
import { RestartKind, SoccerEvent } from '@/sports/soccer/rules.ts';

function at(id: number, x: number, y = CENTRE_Y): PlayerPosition {
  return { id, x, y };
}

/** A back four plus a keeper, for the side defending the high goal. */
const DEFENCE: readonly PlayerPosition[] = [
  at(20, 104), // keeper
  at(21, 80),
  at(22, 78),
  at(23, 76),
  at(24, 74),
];

describe('attacking depth', () => {
  it('measures towards the goal each side attacks', () => {
    expect(attackDepth(80, 0)).toBe(80);
    expect(attackDepth(80, 1)).toBe(PITCH.length - 80);
    expect(attackDepth(CENTRE_X, 0)).toBe(attackDepth(CENTRE_X, 1));
  });
});

describe('the offside line', () => {
  it('is the second-last defender, keeper included in the count', () => {
    // Keeper at 104 is last; 80 is second-last.
    expect(offsideLine(DEFENCE, 0)).toBe(80);
  });

  it('handles a keeper caught upfield without special-casing them', () => {
    const rushed = [at(20, 60), at(21, 80), at(22, 78), at(23, 76)];
    // Now the keeper is not the last man: 80 is last, 78 is second-last.
    expect(offsideLine(rushed, 0)).toBe(78);
  });

  it('never sits behind the halfway line', () => {
    const highLine = [at(20, 104), at(21, 40), at(22, 38)];
    expect(offsideLine(highLine, 0)).toBe(CENTRE_X);
  });

  it('falls back to the halfway line with fewer than two defenders', () => {
    expect(offsideLine([], 0)).toBe(CENTRE_X);
    expect(offsideLine([at(20, 100)], 0)).toBe(CENTRE_X);
  });

  it('is the mirror of itself at the other end', () => {
    const mirrored = DEFENCE.map((d) => at(d.id, PITCH.length - d.x));
    expect(offsideLine(mirrored, 1)).toBe(offsideLine(DEFENCE, 0));
  });
});

describe('offside position', () => {
  const line = offsideLine(DEFENCE, 0);

  it('needs the player past the defence, past the ball, and in the opposition half', () => {
    expect(isInOffsidePosition(85, 0, line, 60)).toBe(true);
    // Behind the line.
    expect(isInOffsidePosition(75, 0, line, 60)).toBe(false);
    // Past the line but behind the ball.
    expect(isInOffsidePosition(85, 0, line, 90)).toBe(false);
  });

  it('cannot be offside in your own half, whatever the line says', () => {
    expect(isInOffsidePosition(40, 0, 30, 20)).toBe(false);
    expect(isInOffsidePosition(CENTRE_X, 0, 30, 20)).toBe(false);
  });

  it('treats level as onside, with a tolerance rather than a plane', () => {
    expect(isInOffsidePosition(line, 0, line, 60)).toBe(false);
    expect(isInOffsidePosition(line + 0.1, 0, line, 60)).toBe(false);
    expect(isInOffsidePosition(line + 0.5, 0, line, 60)).toBe(true);
  });
});

describe('the moment the ball is played', () => {
  it('is onside if level at the pass, however far clear when it arrives', () => {
    const striker = at(1, 80); // exactly level with the second-last defender
    const snapshot = captureOffside(0, 2, 60, [striker, at(2, 60)], DEFENCE);

    expect(snapshot.flagged).toEqual([]);
    // By the time it arrives the striker is ten metres clear — and still onside.
    expect(judgeOffside(snapshot, 1)).toBe(false);
    expect(offsideOffence(snapshot, 1, 500)).toBeNull();
  });

  it('is offside if beyond the line at the pass, however far back when it arrives', () => {
    const striker = at(1, 90);
    const snapshot = captureOffside(0, 2, 60, [striker, at(2, 60)], DEFENCE);

    expect(snapshot.flagged.map((p) => p.id)).toEqual([1]);
    expect(judgeOffside(snapshot, 1)).toBe(true);
    // The offence is where they stood at the pass, not where they were flagged.
    expect(offenceSpot(snapshot, 1)).toMatchObject({ x: 90 });
  });

  it('never flags the passer', () => {
    // The passer is ahead of the line themselves — running onto their own ball is not offside.
    const snapshot = captureOffside(0, 1, 90, [at(1, 90)], DEFENCE);
    expect(snapshot.flagged).toEqual([]);
    expect(judgeOffside(snapshot, 1)).toBe(false);
  });

  it('does not penalise an onside teammate for someone else standing offside', () => {
    const snapshot = captureOffside(0, 3, 60, [at(1, 90), at(2, 70), at(3, 60)], DEFENCE);
    expect(snapshot.flagged.map((p) => p.id)).toEqual([1]);
    expect(judgeOffside(snapshot, 2)).toBe(false);
    expect(judgeOffside(snapshot, 1)).toBe(true);
  });

  it('works the same for the side attacking the other way', () => {
    const defence = DEFENCE.map((d) => at(d.id, PITCH.length - d.x));
    const snapshot = captureOffside(1, 2, PITCH.length - 60, [at(1, 15), at(2, 45)], defence);
    expect(snapshot.flagged.map((p) => p.id)).toEqual([1]);
  });
});

describe('the exempt restarts', () => {
  it('names throw-ins, goal kicks, and corners', () => {
    expect(isOffsideExempt(RestartKind.THROW_IN)).toBe(true);
    expect(isOffsideExempt(RestartKind.GOAL_KICK)).toBe(true);
    expect(isOffsideExempt(RestartKind.CORNER_KICK)).toBe(true);
    expect(isOffsideExempt(RestartKind.FREE_KICK)).toBe(false);
    expect(isOffsideExempt(RestartKind.KICK_OFF)).toBe(false);
  });

  it('flags nobody at all from an exempt restart', () => {
    const attackers = [at(1, 95), at(2, 60)];
    const snapshot = captureOffside(0, 2, 105, attackers, DEFENCE, RestartKind.THROW_IN);
    expect(snapshot.exempt).toBe(true);
    expect(snapshot.flagged).toEqual([]);
    expect(judgeOffside(snapshot, 1)).toBe(false);
  });

  it('still flags from a free kick, which is not exempt', () => {
    const snapshot = captureOffside(
      0,
      2,
      60,
      [at(1, 95), at(2, 60)],
      DEFENCE,
      RestartKind.FREE_KICK,
    );
    expect(snapshot.exempt).toBe(false);
    expect(judgeOffside(snapshot, 1)).toBe(true);
  });
});

describe('enforcement', () => {
  it('is an indirect free kick to the defence, from where the player stood', () => {
    const snapshot = captureOffside(0, 2, 60, [at(1, 90, 30), at(2, 60)], DEFENCE);
    const offence = offsideOffence(snapshot, 1, 900);

    expect(offence).not.toBeNull();
    expect(offence?.restart).toEqual({
      kind: RestartKind.FREE_KICK,
      side: 1,
      x: 90,
      y: 30,
      reason: 'offside',
    });
  });

  it('emits the offside and the turnover, attributed to the attacking side', () => {
    const snapshot = captureOffside(0, 2, 60, [at(1, 90), at(2, 60)], DEFENCE);
    const events = offsideOffence(snapshot, 1, 900)?.events ?? [];

    expect(events.map((e) => e.sportKind ?? e.kind)).toEqual([
      SoccerEvent.OFFSIDE,
      EventKind.TURNOVER,
    ]);
    expect(events[0]).toMatchObject({ side: 0, actor: 1, target: 2, step: 900 });
  });

  it('is nothing at all when the receiver was onside', () => {
    const snapshot = captureOffside(0, 2, 60, [at(1, 70), at(2, 60)], DEFENCE);
    expect(offsideOffence(snapshot, 1, 900)).toBeNull();
    // And nothing for a receiver who was not on the pitch picture at all.
    expect(offsideOffence(snapshot, 99, 900)).toBeNull();
    expect(offenceSpot(snapshot, 99)).toBeUndefined();
  });
});
