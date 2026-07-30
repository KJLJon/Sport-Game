/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.3 (intents, not play calls)
 * @invariant INV-5 (no sport branching outside the sport module)
 *
 * Purpose: what a side may call on a soccer phase turn, and what calling it is worth.
 *
 * **Intents, not plays.** `09` §2.3 is explicit that soccer does not get basketball's per-turn play
 * call: you set an *intent* and it persists until you change it, so the sport asks for fewer and
 * larger decisions. `CallOption.persists` already exists for exactly this (`modes/playbook/types.ts`
 * put it there in T-5.1), so the seam needs nothing new — the flag is set, and `index.ts` remembers
 * the last intent per side so a turn the player does not touch keeps the one they chose.
 *
 * **Two of the five dimensions, on purpose.** `09` §2.3 names five: tempo, width, risk, press line,
 * and focus. This task owns the phase turn; **T-6.19 owns the intent controls** and adds width,
 * risk, and focus. Tempo and press line are here because the phase model is not testable without
 * them — they are the two that move *how long a turn is* and *where the ball is won*, which is the
 * whole of what a phase turn is. The three T-6.19 adds all move probabilities within a phase and
 * none of them changes the graph.
 *
 * **The open question T-6.19 has to settle.** `PlaybookCall.call` is one `CallId`, so five
 * independent dimensions do not fit as they stand. Either the id becomes composite
 * (`tempo:direct|width:wide|…`) or `PlaybookCall` grows a field. The first keeps the seam untouched
 * and makes the CPU's search space explicit; the second reads better on the screen. Deliberately
 * not decided here — one dimension per side needs neither.
 */
import type { CallOption } from '../../../modes/playbook/types.ts';

/** How the attacking side wants to move the ball. */
export const TEMPO_CALLS = ['patient', 'balanced', 'direct'] as const;
export type TempoCall = (typeof TEMPO_CALLS)[number];

/** Where the defending side wants to win it back. */
export const PRESS_CALLS = ['deep', 'mid', 'high'] as const;
export type PressCall = (typeof PRESS_CALLS)[number];

export const DEFAULT_TEMPO: TempoCall = 'balanced';
export const DEFAULT_PRESS: PressCall = 'mid';

/**
 * What a tempo is worth.
 *
 * `climb` moves the odds of getting out of the back and through midfield; `create` moves the odds of
 * a final-third turn becoming a chance; `duration` stretches or compresses the turn, which is what
 * makes tempo a decision about the *clock* and not only about the odds. Playing direct concedes
 * control of the middle and buys shots and time; playing patient is the trade in reverse.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — "Tempo — patient / balanced / direct"
 */
export interface TempoProfile {
  readonly id: TempoCall;
  readonly climb: number;
  readonly create: number;
  readonly duration: number;
  /** Stamina a turn of this costs the attacking side. */
  readonly effort: number;
}

export const TEMPO_PROFILES: Readonly<Record<TempoCall, TempoProfile>> = {
  patient: { id: 'patient', climb: 0.06, create: -0.06, duration: 1.18, effort: 0.018 },
  balanced: { id: 'balanced', climb: 0, create: 0, duration: 1, effort: 0.024 },
  direct: { id: 'direct', climb: -0.06, create: 0.08, duration: 0.8, effort: 0.03 },
};

/**
 * What a press line is worth.
 *
 * `denyClimb` is subtracted from the attackers' odds of climbing the ladder; `concede` is added to
 * their odds of turning a final-third turn into a chance, because a line pushed up leaves space
 * behind it. A high press is therefore a bet: win it early and the opponent's build-up becomes your
 * final third (`phases.ts`' `LOST_TO`), lose it and they are through.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — "Press line — deep block / mid block / high press"
 */
export interface PressProfile {
  readonly id: PressCall;
  readonly denyClimb: number;
  readonly concede: number;
  readonly effort: number;
}

export const PRESS_PROFILES: Readonly<Record<PressCall, PressProfile>> = {
  deep: { id: 'deep', denyClimb: -0.05, concede: -0.07, effort: 0.014 },
  mid: { id: 'mid', denyClimb: 0, concede: 0, effort: 0.022 },
  high: { id: 'high', denyClimb: 0.08, concede: 0.06, effort: 0.036 },
};

export const SOCCER_CALLS: readonly CallOption[] = [
  {
    id: 'patient',
    name: 'Patient',
    side: 'offence',
    blurb: 'Keep it, move them, wait for the gap. Long spells, fewer shots.',
    keys: ['shortPass', 'offBall'],
    persists: true,
  },
  {
    id: 'balanced',
    name: 'Balanced',
    side: 'offence',
    blurb: 'Play what is in front of you.',
    keys: ['shortPass', 'dribbling'],
    persists: true,
  },
  {
    id: 'direct',
    name: 'Direct',
    side: 'offence',
    blurb: 'Forward at the first chance. More shots, more giveaways.',
    keys: ['longPass', 'pace'],
    persists: true,
  },
  {
    id: 'deep',
    name: 'Deep block',
    side: 'defence',
    blurb: 'Sit in, fill the box, concede the ball and not the space.',
    keys: ['marking', 'heading'],
    persists: true,
  },
  {
    id: 'mid',
    name: 'Mid block',
    side: 'defence',
    blurb: 'Hold the halfway line and press what comes into it.',
    keys: ['marking', 'tackling'],
    persists: true,
  },
  {
    id: 'high',
    name: 'High press',
    side: 'defence',
    blurb: 'Squeeze them in their own third. Wins it high, leaves space behind.',
    keys: ['tackling', 'pace'],
    persists: true,
  },
];

function isTempo(id: string): id is TempoCall {
  return (TEMPO_CALLS as readonly string[]).includes(id);
}

function isPress(id: string): id is PressCall {
  return (PRESS_CALLS as readonly string[]).includes(id);
}

/** The tempo behind a call id, falling back to `balanced` for anything unrecognised. */
export function tempoProfile(id: string): TempoProfile {
  return TEMPO_PROFILES[isTempo(id) ? id : DEFAULT_TEMPO];
}

/** The press line behind a call id, falling back to `mid`. */
export function pressProfile(id: string): PressProfile {
  return PRESS_PROFILES[isPress(id) ? id : DEFAULT_PRESS];
}
