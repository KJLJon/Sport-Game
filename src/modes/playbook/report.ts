/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.6 — Expectation comparison ("the sim would have made it") + post-match reporting
 * @story   US-15.5 — See how my decisions and my hands actually did
 * @design  09-modes-and-arcade.md §2.4 (the sim also computes what would have happened),
 *          §2.5 (shared systems), 10-ui-ux.md §8.4
 * @invariant INV-9 (the report reads turns and events, never a mode flag)
 *
 * Purpose: the post-match report. Three questions, answered from the turns a match actually played:
 * did your calls work, did your hands beat the sim, and where did the match turn.
 *
 * **The counterfactual is recorded, not reconstructed.** `KeyMomentOutcome.simWouldHave` was written
 * at the only moment it was knowable — after the sim drew and before the player touched it (T-5.1).
 * This file only counts. A report that re-derived "what would have happened" from the final box
 * score would be guessing, and `09` §2.4 asks for honesty, not plausibility.
 *
 * **Expected points come from the model, not from the outcome.** Every `TurnResolution` carries the
 * `TurnExpectation` its own resolution computed before drawing, so "you were unlucky" is a claim
 * with a number behind it rather than a consolation.
 *
 * **Nothing here knows a sport.** Calls are ids and outcomes are strings; the report groups and
 * counts them. Soccer's phases will produce the same shape with different words.
 */
import type { Side } from '../../engine/match/events.ts';
import type { PlaybookState, TurnResolution } from './types.ts';

/** How one call did, over the match. */
export interface CallLine {
  readonly call: string;
  readonly turns: number;
  readonly points: number;
  /** Points per possession — the only fair way to compare a fast call with a slow one. */
  readonly perTurn: number;
  /** What the model expected before drawing, per possession. */
  readonly expectedPerTurn: number;
}

/** `09` §2.4's comparison, counted. */
export interface KeyMomentLine {
  readonly played: number;
  readonly made: number;
  /** How many the sim would have made, from what it drew before the player played it. */
  readonly simWouldHaveMade: number;
  /** Points the player's hands added, or took away. Negative is the funny case. */
  readonly pointSwing: number;
  /** Mean `quality` across the moments played, `0–1`. */
  readonly quality: number;
}

export interface SideReport {
  readonly side: Side;
  readonly points: number;
  readonly turns: number;
  /** What the resolution model expected this side to score, before any dice. */
  readonly expectedPoints: number;
  readonly calls: readonly CallLine[];
  readonly keyMoments: KeyMomentLine;
}

export interface PlaybookReport {
  readonly turns: number;
  readonly sides: readonly [SideReport, SideReport];
  readonly winner: Side;
  /** The turn with the largest single swing against expectation — where the match turned. */
  readonly swingTurn: TurnResolution | null;
}

function emptyKeyMoments(): KeyMomentLine {
  return { played: 0, made: 0, simWouldHaveMade: 0, pointSwing: 0, quality: 0 };
}

function reportSide(turns: readonly TurnResolution[], side: Side): SideReport {
  const mine = turns.filter((turn) => turn.attacking === side);
  const byCall = new Map<string, { turns: number; points: number; expected: number }>();
  let points = 0;
  let expected = 0;

  for (const turn of mine) {
    points += turn.points;
    expected += turn.expectation.expectedPoints;
    const call = turn.calls.offence.call;
    const line = byCall.get(call) ?? { turns: 0, points: 0, expected: 0 };
    line.turns += 1;
    line.points += turn.points;
    line.expected += turn.expectation.expectedPoints;
    byCall.set(call, line);
  }

  const calls: CallLine[] = [...byCall.entries()]
    .map(([call, line]) => ({
      call,
      turns: line.turns,
      points: line.points,
      perTurn: line.points / line.turns,
      expectedPerTurn: line.expected / line.turns,
    }))
    .sort((a, b) => b.perTurn - a.perTurn || a.call.localeCompare(b.call));

  return {
    side,
    points,
    turns: mine.length,
    expectedPoints: expected,
    calls,
    keyMoments: keyMomentsFor(turns, side),
  };
}

/**
 * The moments this side played. A steal is played by the *defending* side, so a moment is
 * attributed by who took it rather than by who had the ball.
 */
export function keyMomentsFor(turns: readonly TurnResolution[], side: Side): KeyMomentLine {
  const played = turns.filter(
    (turn) => turn.fromKeyMoment !== undefined && momentSide(turn) === side,
  );
  if (played.length === 0) return emptyKeyMoments();

  let made = 0;
  let simMade = 0;
  let swing = 0;
  let quality = 0;

  for (const turn of played) {
    const moment = turn.fromKeyMoment;
    if (moment === undefined) continue;
    quality += moment.quality;
    if (moment.made) made += 1;
    if (moment.simWouldHave) simMade += 1;
    // Exactly what the possession is worth now, against exactly what the sim had drawn for it.
    swing += turn.points - moment.simPoints;
  }

  return {
    played: played.length,
    made,
    simWouldHaveMade: simMade,
    pointSwing: swing,
    quality: quality / played.length,
  };
}

/**
 * Whose moment it was. Everything that scores belongs to the attacking side; a steal belongs to the
 * side that did not have the ball, and the outcome is the only place that shows.
 */
function momentSide(turn: TurnResolution): Side {
  const defending: Side = turn.attacking === 1 ? 0 : 1;
  return turn.outcome === 'stolen' ? defending : turn.attacking;
}

export function buildReport<S>(
  state: PlaybookState<S>,
  turns: readonly TurnResolution[],
): PlaybookReport {
  const home = reportSide(turns, 0);
  const away = reportSide(turns, 1);

  let swingTurn: TurnResolution | null = null;
  let largest = 0;
  for (const turn of turns) {
    const swing = Math.abs(turn.points - turn.expectation.expectedPoints);
    if (swing > largest) {
      largest = swing;
      swingTurn = turn;
    }
  }

  void state;
  return {
    turns: turns.length,
    sides: [home, away],
    winner: home.points > away.points ? 0 : away.points > home.points ? 1 : -1,
    swingTurn,
  };
}

/**
 * `09` §2.4's line, in words. "Both honest and funny" is the brief, and the funny half only works
 * if the honest half is unflinching — so the sentence names the number even when it is unkind.
 */
export function describeKeyMoments(line: KeyMomentLine): string {
  if (line.played === 0) return 'No key moments this match.';

  const yours = `You went ${line.made} for ${line.played} on key moments.`;
  // Only when the tally *and* the points agree. The same tally on different moments — a three made
  // where the sim would have missed, a two missed where it would have scored — is not the same
  // match, and saying it was would be the dishonest half of "honest and funny".
  if (line.made === line.simWouldHaveMade && line.pointSwing === 0) {
    return `${yours} The sim would have gone exactly the same.`;
  }

  const sim = `The sim would have gone ${line.simWouldHaveMade} for ${line.played}.`;
  if (line.pointSwing > 0) return `${yours} ${sim} You are ${line.pointSwing} points up on it.`;
  if (line.pointSwing < 0) {
    return `${yours} ${sim} That cost you ${Math.abs(line.pointSwing)} points.`;
  }
  return `${yours} ${sim} It came out even.`;
}

/** How a side's calls did against what the model expected of them. */
export function describeCalls(report: SideReport): string {
  const best = report.calls[0];
  if (best === undefined) return 'No possessions to report on.';

  const worst = report.calls.at(-1);
  const bestLine = `${best.call} paid best at ${best.perTurn.toFixed(2)} points a possession`;
  if (worst === undefined || worst.call === best.call) return `${bestLine}.`;
  return `${bestLine}; ${worst.call} paid worst at ${worst.perTurn.toFixed(2)}.`;
}

/** Luck, stated as a number rather than as a feeling. */
export function describeLuck(report: SideReport): string {
  const gap = report.points - report.expectedPoints;
  const rounded = Math.round(Math.abs(gap));
  if (rounded < 3) return 'You scored about what the model expected.';
  return gap > 0
    ? `You scored ${rounded} more than the model expected. Some of that was luck.`
    : `You scored ${rounded} fewer than the model expected. Some of that was luck.`;
}
