/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.1 — `PlaybookAdapter` interface + turn engine: turn loop, state, seeded resolution
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  09-modes-and-arcade.md §2 (Playbook mode), §5 (mode architecture)
 * @invariant INV-5 (no sport-specific branching outside the sport module),
 *            INV-9 (all modes emit the same `SportEvent` stream), INV-8 (determinism)
 *
 * Purpose: the Playbook seam. A sport that wants a turn-based mode supplies one `PlaybookAdapter`:
 * what a turn is, what can be called, how a pair of calls resolves, when the moment is worth handing
 * to the player as an arcade game, and how to say what happened in one line.
 *
 * **The split, and why it is where it is.** The adapter owns everything sport-shaped — the call
 * catalogue, the resolution model, what counts as a key moment. The turn engine (`match.ts`) owns
 * everything *turn*-shaped: the turn counter, the clock, periods and overtime, the score, whose
 * possession it is, the seeded RNG, and emitting the event stream. Basketball and soccer disagree
 * about almost everything below the turn and about nothing above it, which is exactly where the line
 * belongs (`09` §5 consequence 1).
 *
 * **Deliberate deviation from `09` §5's sketch.** The sketch lists five members —  `turnKind`,
 * `calls`, `resolve`, `keyMoment`, `narrate`. Three more are needed to actually run a match:
 * `createState` (the sport's own between-turn state has to come from somewhere), `isFinished`
 * (basketball ends on the clock, soccer on phases), and `applyKeyMoment` (T-5.5 has to fold an
 * arcade result back in, and the sketch's comment "→ SportEvent[]" does not say who does that).
 * `apply` and `autoCall` are optional and exist for T-5.7's assistant coach and T-5.8's CPU. The
 * five from the spec keep their names and signatures.
 *
 * **No `mode` field anywhere.** A Playbook turn emits the same `SportEvent`s a Live possession does,
 * with the same kinds and the same `step` numbering, because the box score, achievements, XP, and
 * the economy all read that one stream and none of them may learn that Playbook exists (INV-9).
 */
import type { EntityId } from '../../engine/world.ts';
import type { Rng } from '../../engine/rng.ts';
import type { Side, SportEvent } from '../../engine/match/events.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { DerivedRatings } from '../../athletes/derivation.ts';
import type { SportId } from '../../sports/types.ts';
import type { ArcadeGameId } from '../arcade/types.ts';
import type { Difficulty } from '../difficulty.ts';
import type { TurnDiagram } from './diagram.ts';

/** `09` §2.2 vs §2.3: basketball turns are possessions, soccer turns are phases of play. */
export const TURN_KINDS = ['possession', 'phase'] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

export type CallId = string;

/** Offence and defence pick from separate catalogues (`09` §2.2's two tables). */
export const CALL_SIDES = ['offence', 'defence'] as const;
export type CallSide = (typeof CALL_SIDES)[number];

/**
 * One thing a side can call this turn. Plain data so the call sheet, the CPU, and the assistant
 * coach all read the same list — three consumers of one catalogue, none of them a second copy.
 */
export interface CallOption {
  readonly id: CallId;
  readonly name: string;
  readonly side: CallSide;
  /** "Best when you have a star mismatch" — the *when*, in the player's words (`09` §2.2). */
  readonly blurb: string;
  /** The derived ratings this call keys off, for the sheet's explanation and for T-5.7's coach. */
  readonly keys: readonly string[];
  /** True when the call wants a named athlete: Isolation, Post Up, Double the Star. */
  readonly targeted?: boolean;
  /** Soccer's intents persist until changed (`09` §2.3); basketball's calls are per-turn. */
  readonly persists?: boolean;
  /**
   * The axis this option sets, for a sport whose turn asks several independent questions at once —
   * `09` §2.3's tempo, width, risk, press line, and focus. Absent for a sport like basketball whose
   * turn is one question, and the field the call sheet groups its rows by when it is present.
   */
  readonly dimension?: string;
}

/** A side's decision for one turn. */
export interface PlaybookCall {
  readonly side: Side;
  readonly call: CallId;
  /** The athlete the call is aimed at, when `CallOption.targeted`. */
  readonly target?: EntityId;
  /**
   * Every dimension this side has set, keyed by `CallOption.dimension`, for a sport whose turn is a
   * set of intents rather than one play (`09` §2.3).
   *
   * **Why a map and not a composite `call` id.** The alternative was encoding the set into the id
   * — `tempo:direct|width:wide|…` — which keeps this interface untouched at the cost of making
   * `PlaybookCall.call` mean something different from the `CallOption.id`s `calls()` returned, and
   * of putting a parser between the CPU and its own decision. An optional map costs one field, is
   * ignored by every sport that does not set it, and leaves `call` meaning exactly what it has
   * always meant: the headline of what this side chose.
   *
   * `call` stays populated when this is set, carrying the dimension that most defines the turn —
   * soccer's tempo when attacking, its press line when defending — so narration, match history, and
   * the CPU's read window all keep working without learning what a dimension is.
   */
  readonly intents?: Readonly<Record<string, CallId>>;
}

/** Both decisions, in the order resolution reads them. */
export interface CallPair {
  readonly offence: PlaybookCall;
  readonly defence: PlaybookCall;
}

/** One athlete as Playbook sees them: ratings, not attributes, and a body that gets tired. */
export interface PlaybookAthlete {
  /** Stable within a match, and what `SportEvent.actor` carries — so the box score lines up. */
  readonly id: EntityId;
  readonly athlete: Athlete;
  /** Derived once at setup (`05` §3): familiarity is already inside these numbers. */
  readonly ratings: DerivedRatings;
  /** The sport's own role id — `'PG'`, `'ST'`. */
  readonly role: string;
  /** `0–1`. Drains with turns played and gates nothing on its own; the sport decides what it costs. */
  stamina: number;
}

export interface PlaybookSquad {
  readonly side: Side;
  /** On the floor. Playbook does not simulate a bench until T-5.10 needs one. */
  readonly players: readonly PlaybookAthlete[];
}

/**
 * What the engine tracks between turns, and hands to the adapter on every call. The sport's own
 * slice hangs off `detail`; nothing here is basketball- or soccer-shaped (INV-5).
 */
export interface PlaybookState<S = unknown> {
  readonly sport: SportId;
  readonly turnKind: TurnKind;
  readonly difficulty: Difficulty;
  /** Which side the human is playing, or `-1` when both are CPU (a balance batch). */
  readonly playerSide: Side;
  /** 0-based, counting every turn of the match including overtime. */
  turn: number;
  /** 1-based. Overtime keeps counting up, as the state machine does. */
  period: number;
  /** Game seconds left in the current period, in the units the HUD shows. */
  clock: number;
  /** Whose turn it is to attack. */
  possession: Side;
  readonly score: [number, number];
  readonly squads: readonly [PlaybookSquad, PlaybookSquad];
  /** Whatever the sport tracks between turns. The engine treats it as opaque. */
  detail: S;
}

/**
 * What the resolution *expected* before the roll — the honest baseline `09` §2.4 asks for, and what
 * T-5.6's "the sim would have made it" is measured against.
 */
export interface TurnExpectation {
  /** Probability the attempt came off, `0–1`, as the model saw it before drawing. */
  readonly successChance: number;
  /** Points the model expected on average from this turn. */
  readonly expectedPoints: number;
  /** One line naming what drove the number: "Wide open — his defender went with the screen". */
  readonly because: string;
}

/**
 * One resolved turn. Everything downstream — narration, the diagram, the box score, the arcade
 * hand-off, the post-match report — reads this and nothing else.
 */
export interface TurnResolution {
  readonly turn: number;
  readonly calls: CallPair;
  /** The side that had the ball. Not necessarily the side that scored. */
  readonly attacking: Side;
  /** The sport's own name for what happened: `'made-three'`, `'turnover'`, `'foul-drawn'`. */
  readonly outcome: string;
  /** Whoever the turn was about, for narration and for the diagram's highlight. */
  readonly actor?: EntityId;
  readonly target?: EntityId;
  /** Points scored by `attacking`, in total. Never negative. */
  readonly points: number;
  /**
   * How those points arrived, in order. A trip to the line is two one-pointers and a made three is
   * one three, because the box score reads `score.value` to tell a free throw from a field goal —
   * one lump sum would book a two-shot trip as a made two.
   *
   * Absent means "one score of `points`", which is what almost every turn is.
   */
  readonly scores?: readonly TurnScore[];
  /** Game seconds the turn consumed. `09` §2.1 — a turn is 4–8 s of *resolution*, not game time. */
  readonly seconds: number;
  /** True when the attacking side keeps the ball: an offensive rebound, a foul on a made shot. */
  readonly retainsPossession: boolean;
  /** The turn's contribution to the one stream every mode emits (INV-9). */
  readonly events: readonly SportEvent[];
  readonly expectation: TurnExpectation;
  /** Set once an arcade key moment has replaced the sim's own outcome (T-5.5). */
  readonly fromKeyMoment?: KeyMomentOutcome;
}

/** One scoring play inside a turn. The engine emits each as its own `score` event. */
export interface TurnScore {
  readonly points: number;
  readonly actor?: EntityId;
}

/** How often the sim hands a moment over (`09` §2.4). */
export const KEY_MOMENT_FREQUENCIES = ['off', 'clutch', 'standard', 'every'] as const;
export type KeyMomentFrequency = (typeof KEY_MOMENT_FREQUENCIES)[number];

/**
 * A moment the sim wants the player to play themselves. The adapter proposes; the engine decides
 * whether the frequency setting and the leverage agree (`09` §2.4).
 */
export interface ArcadeInvocation {
  readonly game: ArcadeGameId;
  /** The athlete whose moment it is — the one the arcade calibrates for (INV-10). */
  readonly actor: EntityId;
  /** How high-stakes, `0–1`. "Clutch only" takes the top of this range and nothing else. */
  readonly leverage: number;
  /** One line of setup: "Wide open from the corner." */
  readonly prompt: string;
}

/** What came back from the mini-game, in the terms resolution can use. */
export interface KeyMomentOutcome {
  readonly invocation: ArcadeInvocation;
  /** Whether the player made it. */
  readonly made: boolean;
  /** Where in the outcome band the input landed, `0–1` — the arcade's own `quality`. */
  readonly quality: number;
  /** What the sim would have done, kept so the post-match report can be honest (`09` §2.4). */
  readonly simWouldHave: boolean;
  /**
   * Points the sim's own draw was worth, recorded at the only moment it is knowable. T-5.6's
   * comparison is `turn.points − simPoints` and nothing else: a report that re-derived the
   * counterfactual from the final box score would be guessing.
   */
  readonly simPoints: number;
}

export interface NarrationLine {
  readonly text: string;
  /** Drives emphasis and the diagram's accent. Never colour alone (INV-11 in `10` §11 terms). */
  readonly tone: NarrationTone;
}

export const NARRATION_TONES = ['neutral', 'good', 'bad', 'big'] as const;
export type NarrationTone = (typeof NARRATION_TONES)[number];

/** Everything the adapter needs to build its own state at kick-off. */
export interface PlaybookSetup {
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly playerSide: Side;
  readonly squads: readonly [PlaybookSquad, PlaybookSquad];
}

/**
 * The seam. A sport supplies one of these and gains a turn-based mode; the engine below never learns
 * what sport it is running.
 */
/**
 * The sport's clock, in the units its HUD shows. Playbook spends the same simulation steps Live
 * does, so `secondsPerStep` is the sport's own compression and nothing else.
 */
export interface PlaybookClock {
  readonly periodSeconds: number;
  /** Overtime is usually shorter. Defaults to `periodSeconds`. */
  readonly overtimeSeconds?: number;
  /** Game seconds one simulation step is worth. */
  readonly secondsPerStep: number;
}

export interface PlaybookAdapter<S = unknown> {
  readonly turnKind: TurnKind;
  readonly clock: PlaybookClock;

  /**
   * Two lists of athletes into the two squads this sport's turns resolve against (T-6.21).
   *
   * **Why it is on the seam.** The turn screen has to build a match before it can render one, and
   * before this it did that by importing `basketballSquads` by name — which is exactly the sport
   * branching INV-5 exists to prevent, and the reason `#/play/playbook` could not reach soccer at
   * all. How many athletes a side needs is already `SportModule.meta.squadSize`; this is only the
   * mapping, which nothing outside the sport can write.
   */
  squads(
    home: readonly Athlete[],
    away: readonly Athlete[],
  ): readonly [PlaybookSquad, PlaybookSquad];

  /** The sport's own between-turn state. Seeded, so two matches with one seed are one match. */
  createState(setup: PlaybookSetup, rng: Rng): S;

  /** What this side may call right now. `09` §5's signature, with the state generic resolved. */
  calls(state: PlaybookState<S>, side: Side): readonly CallOption[];

  /**
   * Resolves a pair of calls into an outcome. The only place the sport draws from `rng`, and it
   * must draw nothing outside it — the engine forks a fresh generator per turn, so a resolution
   * that reached for another source would break replay (INV-8).
   */
  resolve(state: PlaybookState<S>, calls: CallPair, rng: Rng): TurnResolution;

  /**
   * The moment worth playing yourself, or `null`. The engine applies the frequency setting.
   *
   * Takes the state as well, for the same reason `narrate` does: how big a moment is depends on
   * the score, the clock, and which side the human is on — a steal opportunity is offered when the
   * player is *defending*, and a CPU-vs-CPU match has nobody to offer anything to (`09` §2.4).
   */
  keyMoment(state: PlaybookState<S>, resolution: TurnResolution): ArcadeInvocation | null;

  /**
   * The one line the turn screen shows. Takes the state as well as the resolution — `09` §5's
   * sketch writes `narrate(res)`, but a line that cannot name the athlete it is about is a status
   * code, not narration, and the ids on a resolution only mean something against a squad.
   */
  narrate(state: PlaybookState<S>, resolution: TurnResolution): NarrationLine;

  /**
   * The turn as an animated diagram (`09` §2.1). Optional: a sport with no diagram yet still plays,
   * with the narration line alone.
   */
  diagram?(state: PlaybookState<S>, resolution: TurnResolution): TurnDiagram | null;

  /**
   * Folds an arcade result back into the turn (T-5.5). Returns the replacement resolution — the
   * events too, since a made three and a missed one are different events, not one event with a flag.
   */
  applyKeyMoment?(
    state: PlaybookState<S>,
    resolution: TurnResolution,
    outcome: KeyMomentOutcome,
  ): TurnResolution;

  /** Applies a committed turn to the sport's own state. The engine owns everything shared. */
  apply?(state: PlaybookState<S>, resolution: TurnResolution): void;

  /** True once the sport considers the match over on its own terms, beyond the clock. */
  isFinished?(state: PlaybookState<S>): boolean;

  /**
   * The CPU's call (T-5.8). Seeded, like everything else.
   *
   * `turns` is the match's *committed* history — exactly what the player also watched happen. It is
   * passed in rather than left on the state so that "what the opponent is allowed to know" is a
   * parameter with a name: a CPU that could reach for arbitrary match state is a CPU that will
   * eventually reach for the pending resolution.
   */
  autoCall?(
    state: PlaybookState<S>,
    side: Side,
    rng: Rng,
    turns: readonly TurnResolution[],
  ): PlaybookCall;

  /**
   * The assistant coach's call for the *human's* side (T-5.7, `09` §2.1). Separate from `autoCall`
   * on purpose: the coach answers "what suits us" and stops, while the CPU reads the opponent. A
   * toggle the player leaves on must not quietly out-think the opponent they are playing.
   */
  coach?(state: PlaybookState<S>, side: Side, rng: Rng): PlaybookCall;
}
