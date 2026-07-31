/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.22 — Soccer Playbook: key moments → arcade, and the Playbook CPU's call selection
 * @story   US-15.4 — Play the big moments myself
 * @design  09-modes-and-arcade.md §2.4 (key moments → arcade), §3.2 (the launch set)
 * @invariant INV-9 (one event stream), INV-10 (the athlete decides the window), INV-8
 *
 * Purpose: `09` §2.4's soccer row, detected from a resolved phase and mapped onto the five games
 * T-6.15 and T-6.23–T-6.26 built. Basketball's `key-moments.ts` is the same shape, and the overlap
 * is deliberate — a moment is a moment.
 *
 * **Four of the five are here, and the fifth genuinely has no trigger.** `09` §2.4 lists penalty,
 * direct free kick, one-on-one, header from a cross, and goal-line save. Soccer's Playbook model
 * resolves a phase into `advance · chance · corner · goal · saved · off-target · blocked · lost`,
 * and **it has no fouls**, so it can never award a penalty. Rather than invent a foul model inside a
 * key-moment detector — which would put a rules change in the wrong file and make Playbook and Live
 * disagree about how often penalties happen — the Penalty Shootout stays unwired here. Its real home
 * is the shootout that should decide a match still level after extra time, which `index.ts`'s
 * `isFinished` already names as missing and which needs match-level support rather than a moment.
 * Logged in `PROGRESS.md`; not faked here.
 *
 * **What each of the four reads, and why that is the honest mapping:**
 *
 * - **Free Kick** — a shot from the `setPiece` phase played *without* width. A set piece is soccer's
 *   dead ball, and a side that has not asked for crosses is having a go at goal.
 * - **Header** — a shot with the attacking side's width intent set to `wide`. Playing for crosses
 *   and then getting a shot off *is* the header from a cross, and it reads a call the player made
 *   rather than a hidden roll, which is the better of the two.
 * - **One-on-One** — a `chance`-phase shot the sim's own model rates as a clear sight of goal. The
 *   threshold is on the shot's expected value, so what counts as "clear through" is the shooting
 *   model's opinion and not a second opinion maintained here.
 * - **Last Line** — the one moment that belongs to the *defending* side, exactly as basketball's
 *   steal does: they have got a shot away against you and the keeper is what is left.
 *
 * **Leverage is what the frequency setting reads**, same as basketball: each moment has a base,
 * lifted by how late and how close the match is. Soccer's "close" is one goal, not six points, which
 * is the only thing about the calculation that is sport-specific.
 */
import { EventKind, event, type SportEvent } from '../../../engine/match/events.ts';
import type {
  ArcadeInvocation,
  KeyMomentOutcome,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { SoccerEvent } from '../rules.ts';
import { intentsOf, type SoccerPlaybookState } from './resolution.ts';

type State = PlaybookState<SoccerPlaybookState>;

/** `09` §2.4's soccer row, against `09` §3.2's soccer set. */
export const MOMENT_GAMES = {
  freeKick: 'soccer.free-kick',
  header: 'soccer.header',
  oneOnOne: 'soccer.one-on-one',
  goalLineSave: 'soccer.last-line',
} as const;
export type SoccerMoment = keyof typeof MOMENT_GAMES;

/**
 * Base leverage per moment, before the match situation lifts it.
 *
 * A one-on-one is the biggest of the four because it is the clearest chance soccer produces; a
 * header from a cross is the most common and so the smallest. On "Clutch only" that ordering is the
 * whole of what the setting means.
 */
const BASE: Readonly<Record<SoccerMoment, number>> = {
  oneOnOne: 0.55,
  goalLineSave: 0.45,
  freeKick: 0.38,
  header: 0.3,
};

/** Game seconds left inside which a phase counts as late — the last ten minutes of the half. */
const LATE_SECONDS = 600;

/** Goals inside which a match counts as close. One, because in soccer one is the margin. */
const CLOSE_MARGIN = 1;

/** Expected goals at or above which the sim itself calls a chance a clear sight of goal. */
const CLEAR_CHANCE = 0.18;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How much this moment matters, `0–1`. Late and close lifts every moment towards its ceiling; early
 * in a comfortable lead nothing gets there.
 *
 * Deliberately the same shape as basketball's, with soccer's own idea of late and close. Two sports
 * disagreeing about the *arithmetic* of leverage would make the frequency setting mean two things.
 */
export function leverageFor(state: State, base: number): number {
  const finalPeriod = state.period >= 2;
  const late = finalPeriod ? clamp01((LATE_SECONDS - state.clock) / LATE_SECONDS) : 0;
  const margin = Math.abs(state.score[0] - state.score[1]);
  const close = clamp01((CLOSE_MARGIN - margin + 1) / (CLOSE_MARGIN + 1));
  return clamp01(base + (1 - base) * late * close);
}

/** The turn's shot, if it took one. The first attempt is the one a moment replaces. */
function shotEvent(resolution: TurnResolution): SportEvent | undefined {
  return resolution.events.find((entry) => entry.kind === EventKind.SHOT);
}

/** Whether this turn's shot was on target, which is what makes it the keeper's problem. */
function onTarget(resolution: TurnResolution): boolean {
  return resolution.outcome === 'goal' || resolution.outcome === 'saved';
}

/** What the attacking side asked for on the width dimension this turn. */
function widthOf(state: State, resolution: TurnResolution): string {
  return intentsOf(state, resolution.attacking, resolution.calls.offence).width;
}

/**
 * The moment worth playing, or `null`.
 *
 * Order matters and it is the reverse of how tempting each is to write first. Width is checked
 * before the phase, because a cross swung into the box from a corner is a header rather than a free
 * kick, and the player asked for the cross.
 */
export function detectKeyMoment(state: State, resolution: TurnResolution): ArcadeInvocation | null {
  // Nobody at the controls — a headless batch, or the sim playing itself.
  if (state.playerSide !== 0 && state.playerSide !== 1) return null;

  const shot = shotEvent(resolution);
  if (shot === undefined) return null;
  const attacking = state.playerSide === resolution.attacking;

  if (!attacking) {
    // The defending side's moment, and the only one they get (`09` §2.4 — "goal-line save").
    if (!onTarget(resolution)) return null;
    return invoke(state, 'goalLineSave', keeperTarget(resolution), 'On your line — keep it out.');
  }

  const phase = String((shot.detail ?? {})['phase'] ?? '');

  if (widthOf(state, resolution) === 'wide') {
    return invoke(state, 'header', resolution.actor, 'It is in from the flank — attack it.');
  }
  if (phase === 'setPiece') {
    return invoke(state, 'freeKick', resolution.actor, 'Dead ball. Round the wall.');
  }
  if (phase === 'chance' && Number((shot.detail ?? {})['chance'] ?? 0) >= CLEAR_CHANCE) {
    return invoke(state, 'oneOnOne', resolution.actor, 'Clear through. Just the keeper.');
  }
  return null;
}

/**
 * Who plays a goal-line save.
 *
 * The shot's `target` is the defender the shooting model resolved against, which for soccer's
 * Playbook is the keeper. Falling back to the resolution's own target keeps this total rather than
 * returning `null` for a turn that clearly had a defender in it.
 */
function keeperTarget(resolution: TurnResolution): number | undefined {
  return shotEvent(resolution)?.target ?? resolution.target;
}

function invoke(
  state: State,
  moment: SoccerMoment,
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
 * The player's result, folded back in.
 *
 * **Rebuilt rather than patched**, for the reason basketball's does it: a goal and a save are
 * different events, not one event with a flag, and the box score reads the stream (INV-9). The
 * possession event is kept because who had the ball is not something the mini-game changed.
 */
export function applyKeyMomentOutcome(
  state: State,
  resolution: TurnResolution,
  outcome: KeyMomentOutcome,
): TurnResolution {
  void state;
  const attacking = resolution.attacking === 1 ? 1 : 0;
  const defending = attacking === 1 ? 0 : 1;
  const defence = outcome.invocation.game === MOMENT_GAMES.goalLineSave;

  // `made` is always "the player did their job". Attacking that means a goal; in goal it means the
  // opposite, and getting this backwards would silently invert the defending half of the mode.
  const scored = defence ? !outcome.made : outcome.made;

  const shot = shotEvent(resolution);
  // The shot is always credited to whoever took it. Attacking, that is the athlete the moment was
  // offered to; defending, the moment was the *keeper's* and the shooter is still the opponent.
  const shooter = defence ? shot?.actor : (outcome.invocation.actor ?? shot?.actor);
  const keeper = shot?.target;

  const events: SportEvent[] = [
    ...resolution.events.filter((entry) => entry.kind === EventKind.POSSESSION),
    event(EventKind.SHOT, 0, attacking, {
      ...(shooter === undefined ? {} : { actor: shooter }),
      ...(keeper === undefined ? {} : { target: keeper }),
      value: 1,
      detail: {
        ...(shot?.detail ?? {}),
        made: scored,
        onTarget: true,
        keyMoment: true,
      },
    }),
  ];

  // A shot kept out is a save, credited to the side that made it — the same event Live emits and the
  // same one soccer's XP table pays `goalkeeping` for.
  if (!scored) {
    events.push(
      event(EventKind.SAVE, 0, defending, {
        ...(keeper === undefined ? {} : { actor: keeper }),
        ...(shooter === undefined ? {} : { target: shooter }),
      }),
    );
  }

  // A dead ball that came to nothing is still a stoppage, so the phase graph gets its restart back.
  if (!scored && String((shot?.detail ?? {})['phase'] ?? '') === 'setPiece') {
    events.push(
      event(EventKind.SPORT, 0, attacking, {
        sportKind: SoccerEvent.RESTART,
        ...(keeper === undefined ? {} : { actor: keeper }),
        detail: { kind: 'goalKick', phase: 'setPiece' },
      }),
    );
  }

  return {
    ...resolution,
    outcome: scored ? 'goal' : 'saved',
    points: scored ? 1 : 0,
    scores: scored ? [{ points: 1, ...(shooter === undefined ? {} : { actor: shooter }) }] : [],
    // Neither a goal nor a save leaves the ball with the side that shot it.
    retainsPossession: false,
    events,
    fromKeyMoment: outcome,
  };
}
