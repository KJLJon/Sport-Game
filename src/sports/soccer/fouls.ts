/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.4 — Fouls, advantage, cards, free kicks, penalties
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-4.3 — Defend and keep goal
 * @design  06-game-design.md §3.2 (fouls with advantage, yellow/red cards, free kicks, penalties)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-9 (one event stream)
 *
 * Purpose: Laws 12 and 13. What a foul costs, what it is punished with, and the referee's one
 * genuinely interesting decision — whether to whistle it at all.
 *
 * **The three questions are separate, and kept separate.** Where the restart is taken is geometry
 * (inside the offender's own box it is a penalty, otherwise a direct free kick from the spot of the
 * offence). What card is shown is discipline. Whether play stops at all is advantage. Tangling them
 * is how a rules module ends up with one function nobody can change: here they are
 * `restartForFoul`, `cardFor`, and the advantage window, and `commitFoul` is the only thing that
 * knows all three.
 *
 * **Advantage is a promise with a deadline.** The referee lets play run; if the attack comes to
 * nothing within a few seconds, the foul is called after all, *from where it happened*. That last
 * clause is why `AdvantageState` carries a fully-built `Restart` rather than the coordinates to
 * rebuild one from — by the time the advantage is pulled back everybody has moved, and a free kick
 * awarded from wherever the ball ended up is a different free kick.
 *
 * **A caution is applied immediately, not at the next stoppage.** The Laws say the card is shown at
 * the next stoppage in play when advantage is played. Modelling that faithfully would mean an
 * athlete could be on two yellows and still on the pitch for several seconds of live play, which
 * reads as a bug to anyone watching and changes nothing about the outcome. Applied at the foul.
 *
 * **What the severity scale is.** `careless` · `reckless` · `excessive` are the Laws' own three
 * degrees, which is convenient because it means the tackle model (T-6.8) has somewhere honest to
 * put its output: it computes how badly the tackle went and this decides what that costs. Nothing
 * here rolls dice — the caller has already done that with a seeded RNG (INV-2).
 */
import { EventKind, event, type SportEvent } from '../../engine/match/events.ts';
import type { EntityId } from '../../engine/world.ts';
import { isInDefendedPenaltyArea, penaltySpot, type Side as PitchSide } from './pitch.ts';
import {
  RestartKind,
  SoccerEvent,
  accrueAddedTime,
  awardRestart,
  isSentOff,
  opponent,
  yellowCards,
  type Restart,
  type RulesState,
} from './rules.ts';

/** Simulation rate. Matches the engine loop's fixed step. */
const TICK_RATE = 60;

/**
 * How long the referee lets an advantage run before deciding it came to nothing.
 *
 * Real seconds, not game seconds: this is a window on *play*, not on the clock, and at 11.25×
 * compression four game seconds would be a third of a real second — over before a player could
 * see it happen.
 */
export const ADVANTAGE_REAL_SECONDS = 3;
const ADVANTAGE_STEPS = ADVANTAGE_REAL_SECONDS * TICK_RATE;

/** The offences the tackle and challenge models can produce. */
export type FoulKind = 'trip' | 'push' | 'holding' | 'handball' | 'slideTackle' | 'dangerousPlay';

/** The Laws' own three degrees. T-6.8's tackle model produces one of these. */
export type FoulSeverity = 'careless' | 'reckless' | 'excessive';

export type CardColour = 'yellow' | 'red';

/** Everything the referee saw. Plain data, so a replay reproduces the decision exactly. */
export interface FoulContext {
  readonly offender: EntityId;
  readonly offenderSide: PitchSide;
  readonly victim: EntityId;
  /** Where the offence happened — where the free kick is taken from. */
  readonly x: number;
  readonly y: number;
  readonly kind: FoulKind;
  readonly severity: FoulSeverity;
  /** The offence denied an obvious goal-scoring opportunity. */
  readonly dogso?: boolean;
  /** The fouled side kept the ball and is still going forward. */
  readonly advantage?: boolean;
}

export interface FoulOutcome {
  /** The restart awarded, or `null` while an advantage is being played. */
  readonly restart: Restart | null;
  readonly card: CardColour | null;
  readonly sentOff: boolean;
  readonly events: readonly SportEvent[];
}

/**
 * Where and what the restart is. A foul by the defending side inside its own penalty area is a
 * penalty; everything else is a direct free kick from the spot.
 *
 * Note the asymmetry that catches people out: it is the *offender's own* box that matters, not
 * whichever box the ball happens to be in. A defender fouling in the opposition's box concedes a
 * free kick like anywhere else.
 */
export function restartForFoul(context: FoulContext): Restart {
  const attacking = opponent(context.offenderSide);

  if (isInDefendedPenaltyArea(context.x, context.y, context.offenderSide)) {
    const spot = penaltySpot(context.offenderSide);
    return {
      kind: RestartKind.PENALTY,
      side: attacking,
      x: spot.x,
      y: spot.y,
      reason: context.kind,
    };
  }

  return {
    kind: RestartKind.FREE_KICK,
    side: attacking,
    x: context.x,
    y: context.y,
    reason: context.kind,
  };
}

/**
 * The card, before second-yellow bookkeeping.
 *
 * The interesting row is the last one: a foul that denies a clear chance is a red *unless* it was a
 * genuine attempt to play the ball inside the offender's own penalty area, in which case the
 * penalty is punishment enough and it is a caution. That is the "double jeopardy" rule as it has
 * stood since 2016, and it is the single most-argued line in the Laws — handling it deliberately is
 * better than falling into whichever side of it the code happens to land on. A handball or a hold
 * is not an attempt to play the ball, so those stay red.
 */
export function cardFor(context: FoulContext): CardColour | null {
  if (context.severity === 'excessive') return 'red';

  if (context.dogso === true) {
    const inOwnBox = isInDefendedPenaltyArea(context.x, context.y, context.offenderSide);
    // @spec-ref 06-game-design.md §3.2 — cards; the 2016 "double jeopardy" amendment
    const playingTheBall = context.kind !== 'handball' && context.kind !== 'holding';
    return inOwnBox && playingTheBall ? 'yellow' : 'red';
  }

  return context.severity === 'reckless' ? 'yellow' : null;
}

function sportEvent(
  step: number,
  side: PitchSide,
  sportKind: string,
  detail: Record<string, number | string | boolean>,
  actor?: EntityId,
): SportEvent {
  return actor === undefined
    ? { kind: EventKind.SPORT, sportKind, step, side, detail }
    : { kind: EventKind.SPORT, sportKind, step, side, actor, detail };
}

/**
 * Records a foul and decides what it costs: the card, the send-off, and either the restart or an
 * advantage.
 *
 * The one function that knows all three answers, and the only thing here that mutates
 * `RulesState` — offside deliberately does not, but discipline has to live somewhere, and
 * basketball's `recordFoul` set the precedent that it lives with the rule that produces it.
 */
export function commitFoul(state: RulesState, context: FoulContext, step: number): FoulOutcome {
  state.teamFouls[context.offenderSide]++;

  const restart = restartForFoul(context);
  const events: SportEvent[] = [
    event(EventKind.FOUL, step, context.offenderSide, {
      actor: context.offender,
      target: context.victim,
      x: context.x,
      y: context.y,
      detail: {
        kind: context.kind,
        severity: context.severity,
        penalty: restart.kind === RestartKind.PENALTY,
        dogso: context.dogso === true,
      },
    }),
  ];

  const { card, sentOff } = applyCard(state, context, step, events);

  // A penalty is never played on: there is no advantage better than a penalty.
  const playOn = context.advantage === true && restart.kind !== RestartKind.PENALTY;

  if (playOn) {
    state.advantage = { side: opponent(context.offenderSide), restart, steps: ADVANTAGE_STEPS };
    events.push(
      sportEvent(step, opponent(context.offenderSide), SoccerEvent.ADVANTAGE, {
        offence: context.kind,
      }),
    );
    return { restart: null, card, sentOff, events };
  }

  state.advantage = null;
  // A penalty is a genuine break in play; a free kick in midfield is not.
  if (restart.kind === RestartKind.PENALTY) events.push(...accrueAddedTime(state, 'penalty', step));
  events.push(...awardRestart(state, restart, step));
  return { restart, card, sentOff, events };
}

function applyCard(
  state: RulesState,
  context: FoulContext,
  step: number,
  events: SportEvent[],
): { card: CardColour | null; sentOff: boolean } {
  const shown = cardFor(context);
  if (shown === null) return { card: null, sentOff: false };

  let colour: CardColour = shown;
  if (shown === 'yellow') {
    state.yellowCards[context.offender] = yellowCards(state, context.offender) + 1;
    // A second caution is a dismissal. Reported as the red it becomes, not as the yellow it was.
    if (yellowCards(state, context.offender) >= 2) colour = 'red';
  }

  events.push(
    sportEvent(
      step,
      context.offenderSide,
      SoccerEvent.CARD,
      { colour, second: colour === 'red' && shown === 'yellow' },
      context.offender,
    ),
  );

  let sentOff = false;
  if (colour === 'red' && !isSentOff(state, context.offender)) {
    state.sentOff.push(context.offender);
    sentOff = true;
    events.push(sportEvent(step, context.offenderSide, SoccerEvent.SENT_OFF, {}, context.offender));
  }

  events.push(...accrueAddedTime(state, 'card', step));
  return { card: colour, sentOff };
}

/**
 * Advances an advantage by one step.
 *
 * `stillAttacking` is the caller's read of whether the advantage has actually materialised — the
 * fouled side still has the ball and is going forward. Losing it inside the window pulls the foul
 * back; surviving the window confirms it, and the free kick is gone for good.
 *
 * Returns the events, having awarded the restart if the advantage was pulled back.
 */
export function tickAdvantage(
  state: RulesState,
  stillAttacking: boolean,
  step: number,
): SportEvent[] {
  const advantage = state.advantage;
  if (advantage === null) return [];

  if (!stillAttacking) {
    state.advantage = null;
    return [
      sportEvent(step, advantage.side, SoccerEvent.ADVANTAGE_PULLED_BACK, {
        kind: advantage.restart.kind,
      }),
      ...awardRestart(state, advantage.restart, step),
    ];
  }

  advantage.steps--;
  if (advantage.steps > 0) return [];

  state.advantage = null;
  return [
    sportEvent(step, advantage.side, SoccerEvent.ADVANTAGE_PLAYED, {
      kind: advantage.restart.kind,
    }),
  ];
}

/** Whether an advantage is currently running — the check the module's `step()` needs. */
export function isPlayingAdvantage(state: RulesState): boolean {
  return state.advantage !== null;
}
