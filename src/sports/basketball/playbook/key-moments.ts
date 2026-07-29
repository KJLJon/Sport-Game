/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.5 — Key-moment detection → arcade invocation → result fed back into resolution
 * @story   US-15.4 — Play the big moments myself
 * @design  09-modes-and-arcade.md §2.4 (key moments → arcade), §3.2 (the launch set)
 * @invariant INV-9 (one event stream), INV-10 (the athlete decides the window), INV-8
 *
 * Purpose: `09` §2.4's five basketball moments — wide-open three, clutch free throw, fast-break
 * finish, buzzer-beater, steal opportunity — detected from a resolved possession and mapped onto
 * the five games `09` §3.2 already shipped in Phase 4. One moment, one game, no new mini-games.
 *
 * **Leverage is what the frequency setting reads.** Every moment carries a base — a buzzer-beater
 * is always big, a wide-open three usually is not — lifted by how close and how late the match is.
 * That is what makes "Clutch only" mean something specific rather than "fewer of them": on that
 * setting a three in the first quarter of a blowout never interrupts, and the same three to tie it
 * with twenty seconds left always does.
 *
 * **A moment belongs to the player, not to the sim.** A steal opportunity is offered when the human
 * is *defending*; the other four when they are attacking. A CPU-vs-CPU match proposes nothing,
 * because there is nobody to play it.
 *
 * **Folding back replaces the outcome, the score, and the events together.** A made three and a
 * missed one are different events, not one event with a flag, so `applyKeyMoment` rebuilds the
 * turn's stream rather than patching it (INV-9).
 */
import { EventKind, event, type SportEvent } from '../../../engine/match/events.ts';
import type {
  ArcadeInvocation,
  KeyMomentOutcome,
  PlaybookState,
  TurnResolution,
  TurnScore,
} from '../../../modes/playbook/types.ts';
import type { BasketballPlaybookState } from './resolution.ts';

type State = PlaybookState<BasketballPlaybookState>;

/** `09` §2.4's five, against `09` §3.2's five. */
export const MOMENT_GAMES = {
  wideOpenThree: 'bball.three-point',
  clutchFreeThrow: 'bball.free-throw',
  fastBreak: 'bball.fast-break',
  buzzerBeater: 'bball.buzzer-beater',
  steal: 'bball.pickpocket',
} as const;

/** Base leverage per moment, before the match situation lifts it. */
const BASE = {
  buzzerBeater: 0.82,
  clutchFreeThrow: 0.42,
  wideOpenThree: 0.34,
  fastBreak: 0.3,
  steal: 0.3,
} as const;

/** Game seconds inside which a possession counts as late. */
const LATE_SECONDS = 120;
/** Points inside which a match counts as close. */
const CLOSE_MARGIN = 6;
/** A contest at or under this is "wide open" (`09` §2.4). */
const OPEN_CONTEST = 0.3;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How much this moment matters, `0–1`. Late and close lifts every moment towards its ceiling; early
 * in a blowout nothing gets there.
 */
export function leverageFor(state: State, base: number): number {
  const finalPeriod = state.period >= 4;
  const late = finalPeriod ? clamp01((LATE_SECONDS - state.clock) / LATE_SECONDS) : 0;
  const margin = Math.abs(state.score[0] - state.score[1]);
  const close = clamp01((CLOSE_MARGIN - margin + 3) / (CLOSE_MARGIN + 3));
  return clamp01(base + (1 - base) * late * close);
}

/** The last possession of the match, where a shot is a buzzer-beater by definition. */
function isBuzzer(state: State, seconds: number): boolean {
  return state.period >= 4 && state.clock <= seconds;
}

function shotEvent(resolution: TurnResolution): SportEvent | undefined {
  return resolution.events.find(
    (entry) => entry.kind === EventKind.SHOT && (entry.detail ?? {}).zone !== 'freeThrow',
  );
}

/**
 * The moment worth playing, or `null`. Order matters: a buzzer-beater outranks the shot it happens
 * to be, because what makes it big is the clock and not the shot.
 */
export function detectKeyMoment(state: State, resolution: TurnResolution): ArcadeInvocation | null {
  // Nobody at the controls — a headless batch, or the sim playing itself.
  if (state.playerSide !== 0 && state.playerSide !== 1) return null;

  const attacking = state.playerSide === resolution.attacking;
  const shot = shotEvent(resolution);
  const zone = String((shot?.detail ?? {}).zone ?? '');
  const contest = Number((shot?.detail ?? {}).contest ?? 1);

  if (attacking) {
    if (shot !== undefined && isBuzzer(state, resolution.seconds)) {
      return invoke(state, 'buzzerBeater', resolution.actor, 'For the win — get it off in time.');
    }
    if (
      resolution.outcome === 'free-throws' ||
      resolution.outcome === 'missed-free-throws' ||
      resolution.outcome === 'and-one'
    ) {
      return invoke(state, 'clutchFreeThrow', resolution.actor, 'On the line. Settle and shoot.');
    }
    if (resolution.outcome === 'broken-press-layup' || resolution.calls.offence.call === 'push') {
      if (shot !== undefined) {
        return invoke(state, 'fastBreak', resolution.actor, 'Out in front — finish it.');
      }
    }
    if (shot !== undefined && (shot.value ?? 2) === 3 && contest <= OPEN_CONTEST) {
      return invoke(state, 'wideOpenThree', resolution.actor, 'Wide open from deep.');
    }
    void zone;
    return null;
  }

  // Defending: the one moment that is the defender's (`09` §2.4 — "steal opportunity").
  if (resolution.outcome === 'stolen' || resolution.calls.defence.call === 'press') {
    return invoke(state, 'steal', resolution.target, 'Jump the passing lane — time it.');
  }
  return null;
}

function invoke(
  state: State,
  moment: keyof typeof MOMENT_GAMES,
  actor: number | undefined,
  prompt: string,
): ArcadeInvocation | null {
  if (actor === undefined) return null;
  return {
    game: MOMENT_GAMES[moment],
    actor,
    leverage: leverageFor(state, BASE[moment]),
    prompt,
  };
}

/**
 * The player's result, folded back in. The moment decides what "made" means: a shot goes in or does
 * not, a free throw is one point, and a steal takes the possession off the other side outright.
 */
export function applyKeyMomentOutcome(
  state: State,
  resolution: TurnResolution,
  outcome: KeyMomentOutcome,
): TurnResolution {
  const attacking = resolution.attacking === 1 ? 1 : 0;
  const defending = attacking === 1 ? 0 : 1;

  if (outcome.invocation.game === MOMENT_GAMES.steal) {
    return stealResult(state, resolution, outcome, attacking, defending);
  }
  if (outcome.invocation.game === MOMENT_GAMES.clutchFreeThrow) {
    return freeThrowResult(resolution, outcome, attacking);
  }
  return shotResult(resolution, outcome, attacking);
}

function shotResult(
  resolution: TurnResolution,
  outcome: KeyMomentOutcome,
  attacking: 0 | 1,
): TurnResolution {
  const shot = shotEvent(resolution);
  const value = (shot?.value ?? 2) === 3 ? 3 : 2;
  const actor = outcome.invocation.actor;
  const made = outcome.made;

  const events: SportEvent[] = [
    ...resolution.events.filter((entry) => entry.kind === EventKind.POSSESSION),
    event(EventKind.SHOT, 0, attacking, {
      actor,
      value,
      detail: { zone: String((shot?.detail ?? {}).zone ?? 'midRange'), made, keyMoment: true },
    }),
  ];

  // A missed key-moment shot is still a live ball. Whoever the sim gave the board to keeps it: the
  // player changed whether it went in, not who was standing under the rim.
  const rebound = resolution.events.find((entry) => entry.kind === EventKind.REBOUND);
  const retains = made ? false : resolution.retainsPossession && rebound !== undefined;
  if (!made && rebound !== undefined) events.push(rebound);

  const scores: TurnScore[] = made ? [{ points: value, actor }] : [];

  return {
    ...resolution,
    outcome: made
      ? value === 3
        ? 'made-three'
        : 'made-two'
      : value === 3
        ? 'missed-three'
        : 'missed-two',
    points: made ? value : 0,
    scores,
    retainsPossession: retains,
    events,
    fromKeyMoment: outcome,
  };
}

function freeThrowResult(
  resolution: TurnResolution,
  outcome: KeyMomentOutcome,
  attacking: 0 | 1,
): TurnResolution {
  const actor = outcome.invocation.actor;
  const drawn = freeThrowAttempts(resolution);
  const attempts = Math.max(1, drawn.length);
  // The player shoots the first; the rest keep the results the sim drew *for those attempts*, so a
  // two-shot trip is still a two-shot trip rather than one attempt counted twice.
  const simMade = drawn.slice(1).filter((made) => made).length;
  const made = (outcome.made ? 1 : 0) + simMade;

  const events: SportEvent[] = [
    ...resolution.events.filter(
      (entry) => entry.kind !== EventKind.SHOT || (entry.detail ?? {}).zone !== 'freeThrow',
    ),
  ];
  for (let i = 0; i < attempts; i += 1) {
    events.push(
      event(EventKind.SHOT, 0, attacking, {
        actor,
        value: 1,
        detail: { zone: 'freeThrow', made: i < made, keyMoment: i === 0 },
      }),
    );
  }

  const fieldGoal =
    resolution.outcome === 'and-one' ? resolution.points - countFreeThrowsMade(resolution) : 0;
  const scores: TurnScore[] = [];
  if (fieldGoal > 0) scores.push({ points: fieldGoal, actor: resolution.actor ?? actor });
  for (let i = 0; i < made; i += 1) scores.push({ points: 1, actor });

  const points = fieldGoal + made;
  return {
    ...resolution,
    outcome:
      resolution.outcome === 'and-one'
        ? 'and-one'
        : made > 0
          ? 'free-throws'
          : 'missed-free-throws',
    points,
    scores,
    events,
    fromKeyMoment: outcome,
  };
}

function stealResult(
  state: State,
  resolution: TurnResolution,
  outcome: KeyMomentOutcome,
  attacking: 0 | 1,
  defending: 0 | 1,
): TurnResolution {
  void state;
  if (!outcome.made) {
    // Missed the lane. Whatever the sim did stands, minus any steal it had credited.
    return {
      ...resolution,
      events: resolution.events.filter((entry) => entry.sportKind !== 'basketball.steal'),
      fromKeyMoment: outcome,
    };
  }

  const thief = outcome.invocation.actor;
  return {
    ...resolution,
    outcome: 'stolen',
    points: 0,
    scores: [],
    retainsPossession: false,
    seconds: Math.max(4, Math.round(resolution.seconds * 0.6)),
    events: [
      ...resolution.events.filter((entry) => entry.kind === EventKind.POSSESSION),
      event(EventKind.TURNOVER, 0, attacking, { actor: resolution.actor ?? 0, target: thief }),
      event(EventKind.SPORT, 0, defending, { sportKind: 'basketball.steal', actor: thief }),
    ],
    fromKeyMoment: outcome,
  };
}

/** The trip the sim drew, in order: one `true` per attempt it made. */
function freeThrowAttempts(resolution: TurnResolution): readonly boolean[] {
  return resolution.events
    .filter((entry) => entry.kind === EventKind.SHOT && (entry.detail ?? {}).zone === 'freeThrow')
    .map((entry) => (entry.detail ?? {}).made === true);
}

function countFreeThrowsMade(resolution: TurnResolution): number {
  return freeThrowAttempts(resolution).filter((made) => made).length;
}
