/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.19 — Soccer Playbook: intent controls — tempo, width, risk, press, focus
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.3 (intents, not play calls)
 * @invariant INV-5 (no sport branching outside the sport module), INV-8 (determinism)
 *
 * Purpose: `09` §2.3's five intents — tempo, width, risk, press line, and focus — as data, and the
 * one function that turns a side's five choices into the numbers `resolution.ts` applies.
 *
 * **Each side holds all five, always.** They are not two catalogues that swap over with possession:
 * a manager sets a shape and it is their shape whether the ball is theirs or not. What changes with
 * possession is which of the five *say* anything. Tempo only speaks while you have the ball and the
 * press line only while you do not; width, risk, and focus speak in both roles and mean different
 * things in each — playing wide stretches a defence, defending wide covers the flanks and opens the
 * middle. One value, two readings, which is why every intent carries an `attack` effect and a
 * `defend` effect rather than living in one catalogue or the other.
 *
 * **How the two sides compose.** Every effect is a shift on the same four odds the phase model
 * draws from, and the applied odds are `base + attackerSum − defenderSum`. Subtracting the defender
 * is what makes a defensive intent *deny* rather than *help*: a high press raises `climb` in its
 * defend column, and raising the number that gets subtracted is what makes the ball harder to move.
 * T-6.14 hand-wrote that polarity for two intents (`tempo.climb − press.denyClimb`); this is the
 * same arithmetic with all five and no special cases.
 *
 * **Focus is the odd one and does not touch the odds at all.** `09` §2.3 makes it "a flank, a
 * channel, or a specific athlete", which is a statement about *who* rather than about how likely.
 * So it steers `primaryFor()`'s selection — who the turn ends up being about — and, when it names an
 * athlete, marks them. A focus that moved probabilities as well would be a second risk dial wearing
 * a different label.
 */
import type { CallId, CallOption, PlaybookCall } from '../../../modes/playbook/types.ts';

/** The five axes `09` §2.3 names, in the order the call sheet shows them. */
export const INTENT_DIMENSIONS = ['tempo', 'width', 'risk', 'press', 'focus'] as const;
export type IntentDimension = (typeof INTENT_DIMENSIONS)[number];

/** A side's full set of intents: one value per dimension. */
export type SoccerIntents = Readonly<Record<IntentDimension, CallId>>;

/**
 * What one intent value is worth, as shifts on the odds the phase model draws from.
 *
 * `climb` moves a build-up or progression turn, `create` moves a final-third turn into a chance,
 * `setPiece` moves it into a corner instead, and `finish` moves a shot. `duration` stretches the
 * turn and is read from the attacking side only — the side without the ball does not decide how long
 * a phase lasts. `effort` is the stamina it costs whoever set it.
 */
export interface IntentEffect {
  readonly climb: number;
  readonly create: number;
  readonly setPiece: number;
  readonly finish: number;
  readonly duration: number;
  readonly effort: number;
}

const NEUTRAL: IntentEffect = {
  climb: 0,
  create: 0,
  setPiece: 0,
  finish: 0,
  duration: 1,
  effort: 0,
};

function effect(overrides: Partial<IntentEffect>): IntentEffect {
  return { ...NEUTRAL, ...overrides };
}

/** One option on one dimension: what it is called, what it does with the ball, and without it. */
export interface IntentOption {
  readonly id: CallId;
  readonly dimension: IntentDimension;
  readonly name: string;
  readonly blurb: string;
  /** Derived ratings this option leans on, for the call sheet's explanation and T-6.22's CPU. */
  readonly keys: readonly string[];
  /** What it is worth to the side that has the ball. */
  readonly attack: IntentEffect;
  /** What it *denies* the side that has the ball. Subtracted, so a positive figure is a denial. */
  readonly defend: IntentEffect;
  /** True when the option names an athlete — only `focus: player` does. */
  readonly targeted?: boolean;
}

/**
 * The catalogue.
 *
 * The figures are shifts on probabilities in the 0.15–0.7 range, so 0.05 is a real decision and 0.10
 * is a big one. Every dimension's middle option is exactly neutral, which is what makes the T-6.14
 * turn-budget derivation still hold: a match of balanced intents is the match that derivation
 * describes, and everything else is a departure from it the player chose.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — the five intents
 */
export const INTENT_OPTIONS: readonly IntentOption[] = [
  // ── Tempo. Speaks only with the ball; the one dimension that moves the clock. ──
  {
    id: 'patient',
    dimension: 'tempo',
    name: 'Patient',
    blurb: 'Keep it, move them, wait for the gap. Long spells, fewer shots.',
    keys: ['shortPass', 'offBall'],
    attack: effect({ climb: 0.06, create: -0.06, duration: 1.18, effort: 0.018 }),
    defend: NEUTRAL,
  },
  {
    id: 'balanced-tempo',
    dimension: 'tempo',
    name: 'Balanced',
    blurb: 'Play what is in front of you.',
    keys: ['shortPass', 'dribbling'],
    attack: effect({ effort: 0.024 }),
    defend: NEUTRAL,
  },
  {
    id: 'direct',
    dimension: 'tempo',
    name: 'Direct',
    blurb: 'Forward at the first chance. More shots, more giveaways.',
    keys: ['longPass', 'pace'],
    attack: effect({
      climb: -0.06,
      create: 0.08,
      setPiece: 0.01,
      finish: -0.02,
      duration: 0.8,
      effort: 0.03,
    }),
    defend: NEUTRAL,
  },

  // ── Width. Stretching them with the ball; covering the flanks without it. ──
  {
    id: 'narrow',
    dimension: 'width',
    name: 'Narrow',
    blurb: 'Play through the middle. Sharper chances, almost no crosses.',
    keys: ['shortPass', 'offBall'],
    attack: effect({ climb: -0.02, create: 0.04, setPiece: -0.04, effort: 0.02 }),
    defend: effect({ create: 0.05, setPiece: -0.02, finish: 0.02, effort: 0.018 }),
  },
  {
    id: 'balanced-width',
    dimension: 'width',
    name: 'Balanced',
    blurb: 'Use the width you are given.',
    keys: ['shortPass'],
    attack: effect({ effort: 0.02 }),
    defend: effect({ effort: 0.02 }),
  },
  {
    id: 'wide',
    dimension: 'width',
    name: 'Wide',
    blurb: 'Stretch them and get crosses in. More corners, fewer clear openings.',
    keys: ['crossing', 'pace'],
    attack: effect({ climb: 0.03, create: -0.02, setPiece: 0.06, effort: 0.026 }),
    defend: effect({ climb: -0.01, create: -0.04, setPiece: 0.05, effort: 0.024 }),
  },

  // ── Risk. Through balls and overlaps with the ball; diving in without it. ──
  {
    id: 'safe',
    dimension: 'risk',
    name: 'Safe',
    blurb: 'Take the ball you are sure of. Keeps possession, rarely breaks a line.',
    keys: ['shortPass', 'offBall'],
    attack: effect({ climb: 0.05, create: -0.05, finish: -0.02, effort: 0.016 }),
    defend: effect({ climb: -0.02, create: 0.03, finish: 0.02, effort: 0.016 }),
  },
  {
    id: 'balanced-risk',
    dimension: 'risk',
    name: 'Balanced',
    blurb: 'Take the pass when it is on.',
    keys: ['shortPass'],
    attack: effect({ effort: 0.02 }),
    defend: effect({ effort: 0.02 }),
  },
  {
    id: 'ambitious',
    dimension: 'risk',
    name: 'Ambitious',
    blurb: 'Through balls and overlapping runs. Cuts them open, gives it away.',
    keys: ['longPass', 'offBall'],
    attack: effect({ climb: -0.05, create: 0.07, finish: 0.02, effort: 0.028 }),
    defend: effect({ climb: 0.05, create: -0.03, finish: -0.02, effort: 0.03 }),
  },

  // ── Press line. Speaks only without the ball. ──
  {
    id: 'deep',
    dimension: 'press',
    name: 'Deep block',
    blurb: 'Sit in, fill the box, concede the ball and not the space.',
    keys: ['marking', 'heading'],
    attack: NEUTRAL,
    defend: effect({ climb: -0.05, create: 0.07, setPiece: 0.02, finish: 0.04, effort: 0.014 }),
  },
  {
    id: 'mid',
    dimension: 'press',
    name: 'Mid block',
    blurb: 'Hold the halfway line and press what comes into it.',
    keys: ['marking', 'tackling'],
    attack: NEUTRAL,
    defend: effect({ effort: 0.022 }),
  },
  {
    id: 'high',
    dimension: 'press',
    name: 'High press',
    blurb: 'Squeeze them in their own third. Wins it high, leaves space behind.',
    keys: ['tackling', 'pace'],
    attack: NEUTRAL,
    defend: effect({ climb: 0.08, create: -0.06, finish: -0.02, effort: 0.036 }),
  },

  // ── Focus. Steers who the turn is about; deliberately moves no odds of its own. ──
  {
    id: 'focus-left',
    dimension: 'focus',
    name: 'Left',
    blurb: 'Work the left. Your left-sided players see more of the ball.',
    keys: ['crossing', 'dribbling'],
    attack: NEUTRAL,
    defend: NEUTRAL,
  },
  {
    id: 'focus-centre',
    dimension: 'focus',
    name: 'Centre',
    blurb: 'Go through the middle.',
    keys: ['shortPass', 'finishing'],
    attack: NEUTRAL,
    defend: NEUTRAL,
  },
  {
    id: 'focus-right',
    dimension: 'focus',
    name: 'Right',
    blurb: 'Work the right.',
    keys: ['crossing', 'dribbling'],
    attack: NEUTRAL,
    defend: NEUTRAL,
  },
  {
    id: 'focus-player',
    dimension: 'focus',
    name: 'One athlete',
    blurb: 'Play through them with the ball, and mark them out of it.',
    keys: ['offBall', 'marking'],
    attack: NEUTRAL,
    defend: NEUTRAL,
    targeted: true,
  },
];

/** What a match starts with, and what an unrecognised value falls back to. */
export const DEFAULT_INTENTS: SoccerIntents = {
  tempo: 'balanced-tempo',
  width: 'balanced-width',
  risk: 'balanced-risk',
  press: 'mid',
  focus: 'focus-centre',
};

const BY_ID = new Map<CallId, IntentOption>(
  INTENT_OPTIONS.map((option) => [option.id, option] as const),
);

export function intentOption(id: CallId): IntentOption | undefined {
  return BY_ID.get(id);
}

/** Every option on one dimension, in catalogue order — one row of the call sheet. */
export function optionsFor(dimension: IntentDimension): readonly IntentOption[] {
  return INTENT_OPTIONS.filter((option) => option.dimension === dimension);
}

/**
 * The dimensions a side is actually asked about this turn.
 *
 * Tempo is meaningless without the ball and the press line is meaningless with it, so neither is
 * offered in the role where it says nothing — a call sheet with a dead row on it teaches the player
 * that some of the rows are decoration.
 */
export function dimensionsFor(role: 'offence' | 'defence'): readonly IntentDimension[] {
  return role === 'offence'
    ? ['tempo', 'width', 'risk', 'focus']
    : ['press', 'width', 'risk', 'focus'];
}

/** The catalogue as the seam's `CallOption`s, for whichever role this side is in. */
export function callOptionsFor(role: 'offence' | 'defence'): readonly CallOption[] {
  const wanted = new Set<IntentDimension>(dimensionsFor(role));
  return INTENT_OPTIONS.filter((option) => wanted.has(option.dimension)).map((option) => ({
    id: option.id,
    name: option.name,
    side: role,
    blurb: option.blurb,
    keys: option.keys,
    dimension: option.dimension,
    persists: true,
    ...(option.targeted === true ? { targeted: true } : {}),
  }));
}

/**
 * The intents a call actually carries, given what this side had set before it.
 *
 * Three sources, narrowest last: what the side already had (intents persist, `09` §2.3), then
 * anything the call names explicitly, then the headline `call` id — so a bare
 * `{ side, call: 'direct' }` from a screen that only changed one chip, or from a test, still says
 * exactly what it means without having to restate the other four.
 */
export function intentsFrom(previous: SoccerIntents, call: PlaybookCall): SoccerIntents {
  const merged: Record<IntentDimension, CallId> = { ...previous };

  for (const [dimension, id] of Object.entries(call.intents ?? {})) {
    const option = BY_ID.get(id);
    if (option !== undefined && option.dimension === dimension) merged[option.dimension] = id;
  }

  const headline = BY_ID.get(call.call);
  if (headline !== undefined) merged[headline.dimension] = headline.id;

  return merged;
}

/** The dimension whose value `PlaybookCall.call` carries, per role. */
export function headlineDimension(role: 'offence' | 'defence'): IntentDimension {
  return role === 'offence' ? 'tempo' : 'press';
}

/** A `PlaybookCall` carrying a full set of intents, with the right headline for the role. */
export function callFrom(
  side: 0 | 1,
  role: 'offence' | 'defence',
  intents: SoccerIntents,
  target?: number,
): PlaybookCall {
  return {
    side,
    call: intents[headlineDimension(role)],
    intents,
    ...(target === undefined ? {} : { target }),
  };
}

/**
 * The composed shift this side's intents apply, in the role they are in.
 *
 * A sum rather than a product: five small independent decisions should add up to a noticeable one
 * and never multiply into a runaway, and `resolution.ts` clamps the result anyway. `duration` is the
 * exception and multiplies, because it scales a length rather than shifting a probability.
 */
export function composeEffect(intents: SoccerIntents, role: 'offence' | 'defence'): IntentEffect {
  let climb = 0;
  let create = 0;
  let setPiece = 0;
  let finish = 0;
  let duration = 1;
  let effort = 0;

  for (const dimension of dimensionsFor(role)) {
    const option = BY_ID.get(intents[dimension]) ?? BY_ID.get(DEFAULT_INTENTS[dimension]);
    if (option === undefined) continue;
    const one = role === 'offence' ? option.attack : option.defend;
    climb += one.climb;
    create += one.create;
    setPiece += one.setPiece;
    finish += one.finish;
    duration *= one.duration;
    effort += one.effort;
  }

  return { climb, create, setPiece, finish, duration, effort };
}
