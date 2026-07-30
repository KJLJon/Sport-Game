/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @task    T-6.11 — 22-entity performance work: LOD, culling, spatial-hash tuning, zero-allocation
 *                   hot path
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2 (soccer), 04-architecture.md §5 (the sport module seam),
 *          05-data-model.md §3.4 (position weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-5 (no sport logic in the engine)
 *
 * Purpose: where eleven people stand, and how that changes with what is happening.
 *
 * **Data, not code.** A formation is a list of roles with a base position and a per-phase drift. No
 * branching on formation name anywhere: adding 4-2-3-1 is adding a row, which is the same
 * discipline `SportRegistry` imposes one level up. The three formations `03` asks for are the
 * initial content, not the supported set.
 *
 * **Shape by phase is the whole feature.** A back four that stands in the same place whether their
 * team is attacking or defending is a screensaver. Each role carries how far it pushes when its
 * team has the ball and how far it drops when it doesn't, plus how much it tucks in — so 4-4-2
 * defends as two banks and attacks as something wider, out of two numbers per role rather than four
 * authored shapes.
 *
 * **Authored once, mirrored.** Every position is a fraction of the pitch for the side attacking
 * towards high x, and `mirrorX` handles the other end (T-6.1). Two authored copies of a shape is
 * two things to keep in step, and they never stay in step.
 *
 * **`aggression` is a formation property, not a difficulty one.** A high line and a sweeper-keeper
 * are tactical choices; scaling them by difficulty would be INV-1's rating-tampering one level
 * removed. The keeper's `aggression` term (T-6.9) is wired from here for exactly that reason.
 */
import { PITCH, isInAttackingHalf, mirrorX, type Side as PitchSide } from './pitch.ts';
import type { RoleTable } from '../types.ts';

/** What the team is doing, which is what shape answers to. */
export type PlayPhase = 'attacking' | 'building' | 'defending';

/**
 * One position in a formation.
 *
 * `x` and `y` are fractions of pitch length and width, authored **from the defending end** for a
 * side attacking towards high x — so `x: 0.05` is a goalkeeper and `x: 0.85` is a striker, matching
 * `RoleTable`'s documented convention.
 */
export interface FormationRole {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Fraction of the pitch this role pushes forward when the team has the ball. */
  readonly push: number;
  /** And drops back when it does not. */
  readonly drop: number;
  /** How far towards the centre it tucks when defending, as a fraction of the half-width. */
  readonly tuck: number;
}

export interface Formation {
  readonly id: string;
  readonly name: string;
  /** `0–1`. Feeds the defensive line height and the keeper's sweeping (T-6.9). */
  readonly aggression: number;
  readonly roles: readonly FormationRole[];
}

const GK: FormationRole = {
  id: 'gk',
  name: 'Goalkeeper',
  x: 0.03,
  y: 0.5,
  push: 0.01,
  drop: 0.01,
  tuck: 0,
};

/**
 * The three formations `03` asks for.
 *
 * @spec-ref 03-phases-and-tasks.md — T-6.10 names 4-4-2, 4-3-3, and 3-5-2
 *
 * The `push`/`drop` figures are what distinguish them beyond the headline numbers: 4-3-3's wide
 * forwards push nearly a fifth of the pitch, which is what makes it a pressing shape, while
 * 3-5-2's wing-backs carry the biggest `push` *and* `drop` in the file — they are the formation's
 * whole idea, doing two jobs and being out of position for one of them at any given moment.
 */
export const FORMATIONS: readonly Formation[] = [
  {
    id: '4-4-2',
    name: '4-4-2',
    aggression: 0.5,
    roles: [
      GK,
      { id: 'lb', name: 'Left back', x: 0.2, y: 0.16, push: 0.12, drop: 0.06, tuck: 0.25 },
      { id: 'lcb', name: 'Centre back', x: 0.16, y: 0.38, push: 0.06, drop: 0.05, tuck: 0.1 },
      { id: 'rcb', name: 'Centre back', x: 0.16, y: 0.62, push: 0.06, drop: 0.05, tuck: 0.1 },
      { id: 'rb', name: 'Right back', x: 0.2, y: 0.84, push: 0.12, drop: 0.06, tuck: 0.25 },
      { id: 'lm', name: 'Left midfield', x: 0.45, y: 0.14, push: 0.14, drop: 0.1, tuck: 0.3 },
      { id: 'lcm', name: 'Centre midfield', x: 0.42, y: 0.4, push: 0.1, drop: 0.1, tuck: 0.1 },
      { id: 'rcm', name: 'Centre midfield', x: 0.42, y: 0.6, push: 0.1, drop: 0.1, tuck: 0.1 },
      { id: 'rm', name: 'Right midfield', x: 0.45, y: 0.86, push: 0.14, drop: 0.1, tuck: 0.3 },
      { id: 'ls', name: 'Striker', x: 0.72, y: 0.4, push: 0.13, drop: 0.16, tuck: 0.1 },
      { id: 'rs', name: 'Striker', x: 0.72, y: 0.6, push: 0.13, drop: 0.16, tuck: 0.1 },
    ],
  },
  {
    id: '4-3-3',
    name: '4-3-3',
    aggression: 0.72,
    roles: [
      GK,
      { id: 'lb', name: 'Left back', x: 0.22, y: 0.15, push: 0.15, drop: 0.07, tuck: 0.22 },
      { id: 'lcb', name: 'Centre back', x: 0.17, y: 0.38, push: 0.07, drop: 0.05, tuck: 0.1 },
      { id: 'rcb', name: 'Centre back', x: 0.17, y: 0.62, push: 0.07, drop: 0.05, tuck: 0.1 },
      { id: 'rb', name: 'Right back', x: 0.22, y: 0.85, push: 0.15, drop: 0.07, tuck: 0.22 },
      { id: 'dm', name: 'Holding midfield', x: 0.36, y: 0.5, push: 0.07, drop: 0.07, tuck: 0.05 },
      { id: 'lcm', name: 'Centre midfield', x: 0.48, y: 0.34, push: 0.12, drop: 0.12, tuck: 0.15 },
      { id: 'rcm', name: 'Centre midfield', x: 0.48, y: 0.66, push: 0.12, drop: 0.12, tuck: 0.15 },
      { id: 'lw', name: 'Left wing', x: 0.74, y: 0.13, push: 0.18, drop: 0.2, tuck: 0.35 },
      { id: 'cf', name: 'Centre forward', x: 0.8, y: 0.5, push: 0.1, drop: 0.18, tuck: 0.05 },
      { id: 'rw', name: 'Right wing', x: 0.74, y: 0.87, push: 0.18, drop: 0.2, tuck: 0.35 },
    ],
  },
  {
    id: '3-5-2',
    name: '3-5-2',
    aggression: 0.6,
    roles: [
      GK,
      { id: 'lcb', name: 'Centre back', x: 0.17, y: 0.3, push: 0.07, drop: 0.05, tuck: 0.15 },
      { id: 'cb', name: 'Centre back', x: 0.14, y: 0.5, push: 0.05, drop: 0.04, tuck: 0.05 },
      { id: 'rcb', name: 'Centre back', x: 0.17, y: 0.7, push: 0.07, drop: 0.05, tuck: 0.15 },
      // The formation's whole idea: two jobs, and out of position for one of them at any moment.
      { id: 'lwb', name: 'Left wing-back', x: 0.44, y: 0.1, push: 0.22, drop: 0.24, tuck: 0.3 },
      { id: 'lcm', name: 'Centre midfield', x: 0.44, y: 0.35, push: 0.11, drop: 0.1, tuck: 0.12 },
      { id: 'cm', name: 'Centre midfield', x: 0.4, y: 0.5, push: 0.09, drop: 0.09, tuck: 0.05 },
      { id: 'rcm', name: 'Centre midfield', x: 0.44, y: 0.65, push: 0.11, drop: 0.1, tuck: 0.12 },
      { id: 'rwb', name: 'Right wing-back', x: 0.44, y: 0.9, push: 0.22, drop: 0.24, tuck: 0.3 },
      { id: 'ls', name: 'Striker', x: 0.74, y: 0.42, push: 0.12, drop: 0.17, tuck: 0.08 },
      { id: 'rs', name: 'Striker', x: 0.74, y: 0.58, push: 0.12, drop: 0.17, tuck: 0.08 },
    ],
  },
];

export const DEFAULT_FORMATION = '4-4-2';

export function formation(id: string): Formation {
  return FORMATIONS.find((f) => f.id === id) ?? (FORMATIONS[0] as Formation);
}

/** Every formation's role ids, for the seam's `RoleTable`. Keyed on the default shape. */
export function soccerRoles(id: string = DEFAULT_FORMATION): RoleTable {
  return {
    roles: formation(id).roles.map((role) => ({
      id: role.id,
      name: role.name,
      x: role.x,
      y: role.y,
    })),
  };
}

/** One athlete's target spot, in metres. */
export interface RoleSpot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Where a role should be right now.
 *
 * Authored for the side attacking towards high x and mirrored for the other, so a shape exists once.
 * `building` is the neutral reading — the base position — and the other two phases move off it.
 */
export function roleSpot(role: FormationRole, phase: PlayPhase, side: PitchSide): RoleSpot {
  const shift = phase === 'attacking' ? role.push : phase === 'defending' ? -role.drop : 0;
  const tuck = phase === 'defending' ? role.tuck : 0;

  const fx = clamp01(role.x + shift);
  // Tucking pulls towards the centre line, whichever side of it the role starts on.
  const fy = role.y + (0.5 - role.y) * tuck;

  const x = fx * PITCH.length;
  const y = fy * PITCH.width;

  return { id: role.id, x: side === 0 ? x : mirrorX(x), y };
}

/**
 * The whole shape, in metres, for one side in one phase. Allocates; see `cachedShape`.
 */
export function shapeFor(
  formationId: string,
  phase: PlayPhase,
  side: PitchSide,
): readonly RoleSpot[] {
  return formation(formationId).roles.map((role) => roleSpot(role, phase, side));
}

const shapeCache = new Map<string, readonly RoleSpot[]>();

/**
 * `shapeFor`, memoised and frozen — the version the simulation calls sixty times a second.
 *
 * A shape is a pure function of `(formation, phase, side)`, and there are eighteen combinations in
 * the whole game: three formations × three phases × two ends. Rebuilding one allocated 11 objects
 * and an array *per side per step*, which is 22 objects sixty times a second doing nothing but
 * feeding the collector — and it showed up as a worst-case sim step 24× the mean while the mean
 * itself sat comfortably inside budget. Jank, not slowness, which is the harder thing to see.
 *
 * Frozen because the cache hands out the same array to every caller: one mutation would corrupt
 * every subsequent step, and that is a bug that would look like a physics problem.
 */
export function cachedShape(
  formationId: string,
  phase: PlayPhase,
  side: PitchSide,
): readonly RoleSpot[] {
  const key = `${formationId}|${phase}|${side}`;
  const hit = shapeCache.get(key);
  if (hit !== undefined) return hit;

  const built = Object.freeze(
    shapeFor(formationId, phase, side).map((spot) => Object.freeze(spot)),
  );
  shapeCache.set(key, built);
  return built;
}

/**
 * How high the defensive line sits, as an x in metres.
 *
 * Read off the deepest outfield role rather than stored separately, so a formation cannot claim a
 * high line while authoring a deep back four — the shape is the single source of truth about itself.
 */
export function defensiveLineX(formationId: string, phase: PlayPhase, side: PitchSide): number {
  const shape = cachedShape(formationId, phase, side).slice(1);
  const depths = shape.map((spot) => (side === 0 ? spot.x : PITCH.length - spot.x));
  return side === 0 ? Math.min(...depths) : PITCH.length - Math.min(...depths);
}

/**
 * Which phase a side is in, from possession and where the ball is.
 *
 * `building` is deliberately the widest band: a team with the ball in its own half is neither
 * attacking nor defending, and treating it as attacking is what makes AI teams suicidally open.
 */
export function phaseFor(side: PitchSide, possession: 0 | 1 | -1, ballX: number): PlayPhase {
  if (possession !== side) return 'defending';
  // Reuses T-6.1's rule rather than restating it, which is what keeps the halfway line meaning the
  // same thing here as it does to offside: level with it is not yet in the opposition half.
  return isInAttackingHalf(ballX, 0, side) ? 'attacking' : 'building';
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
