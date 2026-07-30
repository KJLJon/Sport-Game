/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.3 (soccer: phase turns), §2.1 (shape of a match)
 * @invariant INV-5 (no sport branching outside the sport module), INV-8 (determinism)
 *
 * Purpose: what a soccer Playbook *turn* is. A basketball turn is a possession, which the sport
 * already hands you as a discrete unit. Soccer has no such unit — possession is long and continuous
 * — so `09` §2.3 makes a turn a **phase of play**, and this file is that model: the phases, what
 * follows what, how long each one is worth, and where on the pitch it happens.
 *
 * **One phase enum, two points of view.** `09` §2.3 lists "build-up, progression, final third,
 * chance, set piece, and the defensive equivalents". The defensive equivalents are not separate
 * phases: a phase is a fact about *where the ball is and what is being attempted*, and both sides
 * are in it at once — one pressing, one playing out. `PlaybookState.possession` already says which
 * side is which, so a second enum would be the same five states written twice and one more thing to
 * keep in step. `phaseName(phase, attacking)` supplies the wording each side reads.
 *
 * **The turn budget, derived rather than picked.** `09` §2.3 wants "a typical match of 18–24 turns"
 * and regulation is 2 × 45:00 = 5400 game seconds, so a turn must average 225–300 game seconds. The
 * average falls out of the transition graph rather than being declared, so it has to be computed:
 *
 * With the ladder below and `PHASE_ODDS`' baseline figures, the visit frequencies solve to
 * `f = b` exactly (a possession either walks up the ladder or is lost into the opponent's final
 * third, and the two flows balance), `p = b·α/β`, `c = γ·b`, and `s = (δ + corner·(1−goal)·γ)·b`.
 * At α = 0.62, β = 0.50, γ = 0.62, δ = 0.16 that is
 *
 * ```
 *   b : p : f : c : s   =   1 : 1.24 : 1 : 0.62 : 0.244      (total 4.104)
 *   mean turn = (340 + 1.24·300 + 220 + 0.62·90 + 0.244·100) / 4.104 ≈ 247 game seconds
 *   turns per match = 5400 / 247 ≈ 22
 * ```
 *
 * — the middle of the band `09` asks for. `PHASE_TURN_SECONDS` was solved backwards from that
 * number, which is why the figures are not round. Change an odds figure and the turn count moves;
 * `phases.test.ts` fails when it leaves 18–24, so the arithmetic above cannot rot unnoticed.
 *
 * **What this file is not.** It decides *what may follow what*, not *what does*. The probabilities
 * live in `resolution.ts` and become Live's own passing and shooting models in T-6.20. Keeping the
 * graph here means that swap changes which branch is taken and never which branches exist.
 */
import { PITCH, thirdFor, type Side as PitchSide, type Third } from '../pitch.ts';

/**
 * The five phases of `09` §2.3, in ladder order. A possession climbs; losing it drops the ball to
 * the other side somewhere on the same ladder.
 */
export const SOCCER_PHASES = [
  'buildUp',
  'progression',
  'finalThird',
  'chance',
  'setPiece',
] as const;
export type SoccerPhase = (typeof SOCCER_PHASES)[number];

/** The phase every kick-off, goal kick, and second half starts from. */
export const OPENING_PHASE: SoccerPhase = 'buildUp';

/**
 * Game seconds a turn in each phase is worth.
 *
 * A build-up phase is most of a settled spell; a chance is the twenty seconds either side of a shot
 * plus the walk back. The spread is what makes a match of end-to-end chances *shorter in turns* than
 * a match of patient possession, which is the right way round.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — "a typical match is 18–24 turns"
 */
export const PHASE_TURN_SECONDS: Readonly<Record<SoccerPhase, number>> = {
  buildUp: 340,
  progression: 300,
  finalThird: 220,
  chance: 90,
  setPiece: 100,
};

/** Which third of the pitch the phase happens in, from the attacking side's point of view. */
export const PHASE_THIRD: Readonly<Record<SoccerPhase, Third>> = {
  buildUp: 'defensive',
  progression: 'middle',
  finalThird: 'attacking',
  chance: 'attacking',
  setPiece: 'attacking',
};

/**
 * A representative ball position for the phase, for the side attacking towards its opponent's goal.
 * T-6.20 resolves shots from here and T-6.21 draws the diagram from it, so it is one number rather
 * than one per consumer.
 *
 * Expressed as a fraction of pitch length from the attacking side's own goal line, then mapped
 * through the pitch's own geometry — `thirdFor(phaseBallX(p, side), side) === PHASE_THIRD[p]` for
 * every phase and both sides, which the tests check rather than trust.
 */
const PHASE_X_FRACTION: Readonly<Record<SoccerPhase, number>> = {
  buildUp: 0.18,
  progression: 0.5,
  finalThird: 0.76,
  chance: 0.88,
  setPiece: 0.93,
};

export function phaseBallX(phase: SoccerPhase, side: PitchSide): number {
  const fraction = PHASE_X_FRACTION[phase];
  return side === 0 ? fraction * PITCH.length : PITCH.length - fraction * PITCH.length;
}

/** Where the phase leaves the ball, as a third — the reverse check on `phaseBallX`. */
export function phaseThird(phase: SoccerPhase, side: PitchSide): Third {
  return thirdFor(phaseBallX(phase, side), side);
}

/**
 * What the phase is called, from one side's point of view. `09` §2.3's "defensive equivalents",
 * without a second enum to keep in step.
 */
export function phaseName(phase: SoccerPhase, attacking: boolean): string {
  const names: Record<SoccerPhase, readonly [string, string]> = {
    buildUp: ['Build-up', 'Pressing their build-up'],
    progression: ['Progression', 'Midfield block'],
    finalThird: ['Final third', 'Defending the final third'],
    chance: ['Chance', 'In the goalmouth'],
    setPiece: ['Set piece', 'Defending the set piece'],
  };
  return names[phase][attacking ? 0 : 1];
}

/** Every way a phase turn can end. The graph below maps each to what happens next. */
export const PHASE_OUTCOMES = [
  /** The ball moved up the ladder and the same side still has it. */
  'advance',
  /** A chance was worked. */
  'chance',
  /** A corner, a free kick in a dangerous area, or a penalty. */
  'setPiece',
  /** In the net. */
  'goal',
  /** Blocked, saved, or off target; possession changes. */
  'blocked',
  /** Tackled, intercepted, or given away. */
  'lost',
] as const;
export type PhaseOutcome = (typeof PHASE_OUTCOMES)[number];

/** Where the ball is after a turn: the next phase and whether the same side still has it. */
export interface PhaseTransition {
  readonly phase: SoccerPhase;
  /** True when the attacking side keeps the ball — `TurnResolution.retainsPossession`. */
  readonly retains: boolean;
}

/**
 * Where a possession that is lost in each phase leaves the *opponent*.
 *
 * This is the part of the model that keeps a match from being a queue of identical build-ups. Losing
 * the ball playing out from the back hands the opponent a shooting position; losing it in their box
 * concedes a goal kick and they start again from theirs. It is also where T-6.19's press-line intent
 * gets its teeth — pressing high is a bet on turning the first row into the third.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — the press-line intent
 */
const LOST_TO: Readonly<Record<SoccerPhase, SoccerPhase>> = {
  buildUp: 'finalThird',
  progression: 'progression',
  finalThird: 'buildUp',
  chance: 'buildUp',
  setPiece: 'buildUp',
};

/**
 * The transition graph. Every `(phase, outcome)` pair the resolution can produce has exactly one
 * answer here, which is what makes the model checkable: a resolution that invented an outcome would
 * throw rather than quietly stall the match in one phase.
 */
export function nextPhase(phase: SoccerPhase, outcome: PhaseOutcome): PhaseTransition {
  switch (outcome) {
    case 'advance':
      return { phase: advanceFrom(phase), retains: true };
    case 'chance':
      return { phase: 'chance', retains: true };
    case 'setPiece':
      return { phase: 'setPiece', retains: true };
    case 'goal':
      // A goal restarts at the halfway line with the side that conceded, which is a build-up for
      // them and a loss of possession for the scorer.
      return { phase: OPENING_PHASE, retains: false };
    case 'blocked':
    case 'lost':
      return { phase: LOST_TO[phase], retains: false };
  }
}

/** One rung up the ladder. The top three rungs are reached by their own outcomes, not by climbing. */
function advanceFrom(phase: SoccerPhase): SoccerPhase {
  if (phase === 'buildUp') return 'progression';
  if (phase === 'progression') return 'finalThird';
  // A chance or a set piece that comes to nothing but stays with the attackers resets to the final
  // third: they still have it in a dangerous area, and the next turn is a fresh attempt to work one.
  return 'finalThird';
}

/** Which outcomes are reachable from a phase, for the tests and for T-6.22's CPU. */
export function outcomesFor(phase: SoccerPhase): readonly PhaseOutcome[] {
  switch (phase) {
    case 'buildUp':
    case 'progression':
      return ['advance', 'lost'];
    case 'finalThird':
      return ['chance', 'setPiece', 'lost'];
    case 'chance':
    case 'setPiece':
      return ['goal', 'setPiece', 'blocked'];
  }
}

/** True when the phase is one a shot comes out of — what T-6.22's key moments hang off. */
export function isShootingPhase(phase: SoccerPhase): boolean {
  return phase === 'chance' || phase === 'setPiece';
}
