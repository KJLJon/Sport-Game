/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.11 — `SportModule` interface + a trivial test sport proving the seam
 * @story   US-14.4 — Add a sport without touching the engine
 * @design  04-architecture.md §5 (the sport module seam), 09-modes-and-arcade.md §5
 * @invariant INV-5 (no sport-specific branching in engine core), INV-9 (one event stream)
 *
 * Purpose: the single extension point of the whole game. Adding a sport means adding one of these
 * and nothing else — no change in `engine/`, `storage/`, `economy/`, or `achievements/`.
 *
 * The interface is deliberately narrow and entirely *pull*-shaped: the engine calls the sport, and
 * the sport never calls the engine. A sport that could reach into the loop, the renderer, or the
 * event bus directly would slowly acquire engine-shaped responsibilities, and the seam would rot
 * into a suggestion.
 *
 * `09` §5 adds two more members for Playbook and Arcade. They are declared optional here so Phase 1
 * can prove the seam works before those modes exist, and become required when Phase 4 and Phase 5
 * land — a sport with no Playbook adapter is a Phase-1 test fixture, not a shippable sport.
 */
import type { Rng } from '../engine/rng.ts';
import type { InputFrame } from '../engine/input/types.ts';
import type { SportEvent } from '../engine/match/events.ts';
import type { MatchRules } from '../engine/match/state-machine.ts';
import type { Canvas2D, ViewTransform } from '../engine/render/renderer.ts';
import type { SportAudio } from '../modes/live/audio.ts';
import type { EntityId, World } from '../engine/world.ts';
import type { Athlete } from '../athletes/types.ts';
import type { ArcadeGameDef } from '../modes/arcade/types.ts';
import type { PlaybookAdapter } from '../modes/playbook/types.ts';

export type SportId = string;

export interface SportMeta {
  readonly displayName: string;
  /** Athletes per side on the field at once. */
  readonly squadSize: number;
  /** What a period is called in this sport — "Quarter", "Half", "Period". */
  readonly periodName: string;
}

/** Field geometry in world units (metres), origin at a corner. */
export interface FieldGeometry {
  readonly width: number;
  readonly height: number;
  /** Named regions the sport's own rules and AI reason about. */
  readonly zones?: Readonly<Record<string, Rect>>;
  /** Scoring targets, one per side. */
  readonly goals: readonly Goal[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Goal {
  /** Which side defends it. */
  readonly side: 0 | 1;
  readonly x: number;
  readonly y: number;
  /** Height above the surface, for sports where that matters. */
  readonly z?: number;
  readonly radius: number;
}

/**
 * Attribute → derived rating weights (`05` §3). Rows are per derived rating and sum to 1.0; the
 * engine never reads this, but the athlete layer does, and it lives on the module so that adding
 * a sport adds its ratings too.
 */
export type RatingWeightTable = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * A body adjustment applied *after* the weighted sum (`05` §2.1, §3.1): height and weight are not
 * attributes, so they cannot be weighted alongside them, and a tall athlete's rebounding advantage
 * is a flat bonus rather than a share of a budget.
 */
export interface PhysicalModifierTable {
  /** The size at which every modifier is zero. */
  readonly reference: number;
  /** Derived rating → rating points per unit above `reference`. Negative penalises size. */
  readonly perUnit: Readonly<Record<string, number>>;
}

export interface PhysicalModifiers {
  readonly heightCm?: PhysicalModifierTable;
  readonly weightKg?: PhysicalModifierTable;
}

/**
 * Position → weights over the sport's *derived ratings*, for overall and position fit (`05` §3.4).
 * Rows sum to 1.0, so an overall lands on the same 1–99 scale as the ratings it is built from.
 */
export type PositionWeightTable = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * One "this action trains that sub-skill" rule (`05` §3.3 — "a made three grants three-point XP, a
 * tackle grants tackling XP"). The sport owns the mapping, because only the sport knows that a
 * `shot` with `zone: 'cornerThree'` is a three: the athlete layer must never learn that.
 */
export interface XpRule {
  readonly kind: string;
  /** For `kind: 'sport'`, the sport's own name for the event. */
  readonly sportKind?: string;
  /** Matches only when every listed `detail` field equals this value. */
  readonly when?: Readonly<Record<string, string | number | boolean>>;
  /** The derived rating this trains for the event's actor. Omit to award XP without a sub-skill. */
  readonly rating?: string;
  readonly xp: number;
  /** Awarded to the event's `target` — the defender who contested, the receiver who caught. */
  readonly targetRating?: string;
  readonly targetXp?: number;
}

export type XpAwardTable = readonly XpRule[];

/** Positions and their default field placement, as fractions of the field. */
export interface RoleTable {
  readonly roles: readonly {
    readonly id: string;
    readonly name: string;
    /** Default position as a fraction of field width/height, from the defending end. */
    readonly x: number;
    readonly y: number;
  }[];
}

export interface MatchSetup {
  /** Seed for the whole match. Everything random downstream forks from it. */
  readonly seed: string;
  /** Which side the local player controls, or `-1` for a spectated/simulated match. */
  readonly playerSide: 0 | 1 | -1;
  /** Squad size actually used — may be smaller than `meta.squadSize` for practice modes. */
  readonly squadSize?: number;
  /**
   * The athletes playing, indexed by side then by role (T-3.17). **Optional on purpose**: a match
   * given no roster fills itself from `seed`, which is what lets the balance harness run 500 games
   * with no save file and lets a rules test start a match without building ten athletes first.
   * Real rosters are an input, not a prerequisite.
   *
   * The `import type` below closes a cycle — `athletes/types.ts` imports `SportId` from here — but
   * both directions are type-only and erased at build, and the alternative is pretending a match
   * is played by something other than athletes.
   */
  readonly rosters?: readonly (readonly Athlete[])[];
}

/** Whatever the sport needs to track. The engine treats it as opaque. */
export interface SportState {
  readonly sport: SportId;
  /** The ball's entity, or `-1` for sports without one. */
  readonly ball: EntityId;
}

/** An action the player or AI wants to take. Sports define their own verbs. */
export interface ActionIntent {
  readonly kind: string;
  readonly power?: number;
  readonly targetX?: number;
  readonly targetY?: number;
  readonly target?: EntityId;
}

export interface SportAiAdapter {
  /**
   * Candidate actions for one athlete this tick, appended to `out`. The framework scores and
   * picks; the sport only knows what is *possible*.
   */
  options(state: SportState, world: World, actor: EntityId, out: ActionIntent[]): void;
  /** How good an option is, `0–1`. Difficulty modifies the framework's use of this, never this. */
  score(state: SportState, world: World, actor: EntityId, option: ActionIntent): number;
}

export interface SportRenderer {
  /** Static field content — drawn once into an off-screen layer and blitted (T-1.7). */
  drawField(ctx: Canvas2D, field: FieldGeometry, view: ViewTransform): void;
  /**
   * The athletes, in this sport's own kit.
   *
   * **Added by T-6.16, and it was fixing a live bug rather than tidying.** The Live screen used to
   * import `sports/basketball/art.ts` directly and draw every athlete with it, so a soccer match was
   * played by basketball players chasing an orange ball with seams on it. The screen cannot own this
   * because the *kit* is not generic — soccer puts its goalkeeper in a different one, and only
   * soccer knows which entity that is.
   *
   * Takes the sport's own state for exactly that reason: `controlled` is the athlete the player is,
   * and everything else the sport needs to tell its athletes apart is already in `state`.
   */
  drawAthletes(ctx: Canvas2D, state: SportState, world: World, controlled: EntityId): void;
  /** The ball, with whatever height cue this sport uses. Its own layer, so it draws over bodies. */
  drawBall(ctx: Canvas2D, state: SportState, world: World, ball: EntityId): void;
  /** Per-frame sport-specific overlays: possession arrows, zone highlights. */
  drawOverlay(ctx: Canvas2D, state: SportState, world: World, view: ViewTransform): void;
  /** A cache key for the static layer, so a theme or size change redraws it and nothing else does. */
  fieldKey(field: FieldGeometry, view: ViewTransform): string;
}

/**
 * What a sport tells the presentation layer about itself, beyond the score and the period the match
 * clock already owns.
 *
 * Deliberately generic: "action clock", not "shot clock"; "team fouls", not "personal fouls with
 * bonus". A HUD that read `state.rules.shotClock` would carry basketball's field names into shared
 * UI and break INV-5 the moment a second sport arrived, so this is the sport's side of that
 * contract — and the reason `status()` exists at all rather than the HUD reaching in.
 */
export interface SportStatus {
  /** Seconds on the sport's own action clock — a shot clock, a play clock — or `null` if it has none. */
  readonly actionClock: number | null;
  /** Team-foul counts, or `null` for a sport without them. */
  readonly teamFouls: readonly [number, number] | null;
  /** Whether each side's fouls have reached the penalty threshold. */
  readonly bonus: readonly [boolean, boolean] | null;
  /** Which side has the ball, or `-1`. */
  readonly possession: 0 | 1 | -1;
  /** The athlete the local player is controlling, or `-1`. */
  readonly controlled: EntityId;
  /** Why play is stopped, for the stoppage caption (`06` §4). */
  readonly stoppage: string | null;
  /** A charging action's progress, `0–1`, for a release meter. `null` when nothing is charging. */
  readonly meter: number | null;
  /** Game seconds remaining in the current period, as the sport counts them. */
  readonly periodClock: number;
}

export interface SportHudSpec {
  readonly showShotClock: boolean;
  readonly showPossession: boolean;
  /** Labels for the two context buttons in each state (`06` §2). */
  readonly buttonLabels: Readonly<Record<string, readonly [string, string]>>;
}

/**
 * The seam. Everything the rest of the game needs to play a sport it has never heard of.
 */
export interface SportModule<S extends SportState = SportState> {
  readonly id: SportId;
  readonly meta: SportMeta;
  readonly rules: MatchRules;

  readonly field: FieldGeometry;
  readonly ratingWeights: RatingWeightTable;
  /** Height and weight adjustments (`05` §3.1). Absent when the sport has no opinion about size. */
  readonly physicalModifiers?: PhysicalModifiers;
  /** Keyed by `roles.roles[].id`. Absent when every position wants the same athlete. */
  readonly positionWeights?: PositionWeightTable;
  /** Which events train which sub-skills (`05` §3.3). Absent when the sport awards none. */
  readonly xpAwards?: XpAwardTable;
  readonly roles: RoleTable;

  /** Populates the world and returns the sport's own state. */
  createState(setup: MatchSetup, world: World, rng: Rng): S;

  /**
   * One simulation step. Returns the events it produced rather than emitting them, so the caller
   * controls ordering against the clock's own events — and so a headless balance run can consume
   * them without a bus at all.
   */
  step(
    state: S,
    world: World,
    inputs: ReadonlyMap<EntityId, InputFrame>,
    dt: number,
    rng: Rng,
  ): readonly SportEvent[];

  /** Resolves a discrete action — a shot, a pass, a tackle. */
  resolveAction(
    state: S,
    world: World,
    actor: EntityId,
    action: ActionIntent,
    rng: Rng,
  ): readonly SportEvent[];

  /** Non-null once the sport considers the match over on its own terms. */
  isFinished(state: S): boolean;

  readonly ai: SportAiAdapter;
  readonly render: SportRenderer;
  readonly hud: SportHudSpec;

  /**
   * What this sport's events sound like (T-6.16). Optional: a sport with no mapping is silent, which
   * is a better default than borrowing another sport's — before this existed, `modes/live/screen.ts`
   * constructed a basketball-specific audio layer for every sport, so soccer answered a goal with a
   * rim clank.
   */
  readonly audio?: SportAudio;

  /**
   * The sport's mini-games (`09` §5). Optional for the same reason `playbook` is: a Phase-1 test
   * fixture is not a shippable sport, and a sport whose arcade set has not landed yet still has to
   * be playable in Live.
   */
  readonly arcade?: readonly ArcadeGameDef[];

  /**
   * The sport's turn-based mode (`09` §5). Optional, and for exactly the same stated reason as
   * `arcade`: a sport arrives in Live first, and soccer's Playbook (T-6.14) lands a phase after its
   * Live rules do. A sport without one simply does not appear in the Playbook mode picker.
   */
  readonly playbook?: PlaybookAdapter;

  /**
   * What to show about this sport right now. Optional so a Phase-1 test fixture stays valid; a
   * sport without it gets the generic HUD and nothing breaks.
   */
  status?(state: S): SportStatus;

  /**
   * Called by the mode host when a new period begins, so the sport can reset what it owns. The
   * clock is the engine's; whatever a period start means to the sport is the sport's.
   */
  startPeriod?(state: S, period: number): void;
}

/**
 * Registry of known sports. A map rather than a switch, which is the mechanical form INV-5 takes:
 * there is nowhere in the engine to write `if (sport === 'basketball')`.
 */
export class SportRegistry {
  private readonly modules = new Map<SportId, SportModule>();

  register(module: SportModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Sport "${module.id}" is already registered`);
    }
    this.modules.set(module.id, module);
  }

  get(id: SportId): SportModule | undefined {
    return this.modules.get(id);
  }

  /** Throws rather than returning undefined, for the call sites that cannot proceed without it. */
  require(id: SportId): SportModule {
    const module = this.modules.get(id);
    if (module === undefined) throw new Error(`Unknown sport "${id}"`);
    return module;
  }

  ids(): SportId[] {
    return [...this.modules.keys()].sort();
  }

  get size(): number {
    return this.modules.size;
  }
}
