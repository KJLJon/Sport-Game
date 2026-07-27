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
import type { EntityId, World } from '../engine/world.ts';

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
  /** Per-frame sport-specific overlays: possession arrows, zone highlights. */
  drawOverlay(ctx: Canvas2D, state: SportState, world: World, view: ViewTransform): void;
  /** A cache key for the static layer, so a theme or size change redraws it and nothing else does. */
  fieldKey(field: FieldGeometry, view: ViewTransform): string;
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
