/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.3 — Entity model: struct-of-arrays state, spatial hash for neighbour queries
 * @story   US-2.5 — Run at a steady frame rate
 * @design  04-architecture.md §6 (entities), 01-plan.md R2 (22 entities on a phone)
 * @invariant INV-8 (determinism — neighbour results are ordered, never hash-ordered)
 *
 * Purpose: where every moving thing in a match lives. Struct-of-arrays typed arrays rather than
 * an array of objects, because the hot loops touch one field across all entities at a time —
 * integrating velocity reads two arrays end to end instead of chasing 22 object pointers — and
 * because typed arrays give the GC nothing to collect mid-match (`01` R2).
 *
 * The spatial hash is a uniform grid rebuilt once per step with a counting sort. Rebuilding is
 * O(n + cells) and allocation-free; the alternative — incremental updates as entities move — is
 * more code and more state to get wrong at 22 entities.
 *
 * Everything here is sport-agnostic. `kind`, `team`, and `tag` are opaque integers the sport
 * module gives meaning to; nothing in this file knows what a basketball is.
 */

/** An index into the entity arrays. Stable while the entity is alive; reused after `despawn`. */
export type EntityId = number;

/** Not an entity. Returned where an id is expected but none applies. */
export const NO_ENTITY: EntityId = -1;

export interface WorldOptions {
  /** Maximum simultaneous entities. 22 athletes + ball + spares; fixed for the match's life. */
  readonly capacity?: number;
  /** Playing area width in world units (metres). */
  readonly width: number;
  /** Playing area height in world units (metres). */
  readonly height: number;
  /**
   * Grid cell size in world units. Should be a little larger than the largest query radius:
   * too small and a query walks many cells, too large and each cell holds everyone.
   */
  readonly cellSize?: number;
}

export interface SpawnInit {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly vz?: number;
  /** Facing, in radians. */
  readonly facing?: number;
  /** Collision radius in world units. */
  readonly radius?: number;
  readonly mass?: number;
  /** Sport-defined: which side. `-1` for neutral things like the ball. */
  readonly team?: number;
  /** Sport-defined: athlete, ball, marker… */
  readonly kind?: number;
  /** Sport-defined free integer — a role, a squad slot, an index into the sport's own table. */
  readonly tag?: number;
}

/** Bit flags on an entity. Sports may use the high bits; the low four are the engine's. */
export const Flags = {
  NONE: 0,
  /** Excluded from collision resolution but still queryable. */
  INTANGIBLE: 1 << 0,
  /** Not integrated by movement — a pinned or held entity. */
  FROZEN: 1 << 1,
  /** Currently controlled by the local player. */
  PLAYER_CONTROLLED: 1 << 2,
  /** Off the field of play: substituted, in a stoppage, or otherwise parked. */
  BENCHED: 1 << 3,
} as const;

export class World {
  readonly capacity: number;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;

  // ── Kinematics, one array per field ────────────────────────────────────────
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Height above the surface. Athletes mostly sit at 0; the ball does not. */
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly facing: Float32Array;
  readonly radius: Float32Array;
  readonly mass: Float32Array;

  // ── Identity, all sport-defined ────────────────────────────────────────────
  readonly team: Int16Array;
  readonly kind: Int16Array;
  readonly tag: Int32Array;
  readonly flags: Int32Array;

  private readonly alive: Uint8Array;
  private aliveCount = 0;

  // ── Spatial hash: counting-sort buckets, rebuilt by `reindex()` ────────────
  private readonly cellOf: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cellCursor: Int32Array;
  private readonly byCell: Int32Array;
  private indexed = false;

  constructor(options: WorldOptions) {
    this.capacity = options.capacity ?? 64;
    this.width = options.width;
    this.height = options.height;
    this.cellSize = options.cellSize ?? 4;
    this.cols = Math.max(1, Math.ceil(this.width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(this.height / this.cellSize));

    const n = this.capacity;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.facing = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.mass = new Float32Array(n);
    this.team = new Int16Array(n);
    this.kind = new Int16Array(n);
    this.tag = new Int32Array(n);
    this.flags = new Int32Array(n);
    this.alive = new Uint8Array(n);

    const cells = this.cols * this.rows;
    this.cellOf = new Int32Array(n);
    this.cellStart = new Int32Array(cells + 1);
    this.cellCursor = new Int32Array(cells + 1);
    this.byCell = new Int32Array(n);
  }

  /** How many entities are alive. */
  get count(): number {
    return this.aliveCount;
  }

  isAlive(id: EntityId): boolean {
    return id >= 0 && id < this.capacity && this.alive[id] === 1;
  }

  /**
   * Claims the lowest free slot. Lowest, not most-recently-freed, so a match replayed from the
   * same inputs assigns the same ids in the same order (INV-8).
   *
   * @throws if the world is full — a full world is a setup bug, not a runtime condition.
   */
  spawn(init: SpawnInit): EntityId {
    let id = NO_ENTITY;
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) {
        id = i;
        break;
      }
    }
    if (id === NO_ENTITY) {
      throw new Error(`World is full (capacity ${this.capacity})`);
    }

    this.alive[id] = 1;
    this.aliveCount++;

    this.x[id] = init.x;
    this.y[id] = init.y;
    this.z[id] = init.z ?? 0;
    this.vx[id] = init.vx ?? 0;
    this.vy[id] = init.vy ?? 0;
    this.vz[id] = init.vz ?? 0;
    this.facing[id] = init.facing ?? 0;
    this.radius[id] = init.radius ?? 0.4;
    this.mass[id] = init.mass ?? 80;
    this.team[id] = init.team ?? -1;
    this.kind[id] = init.kind ?? 0;
    this.tag[id] = init.tag ?? 0;
    this.flags[id] = Flags.NONE;

    this.indexed = false;
    return id;
  }

  /** Frees a slot. Despawning a dead entity is a no-op, so cleanup can be careless. */
  despawn(id: EntityId): void {
    if (!this.isAlive(id)) return;
    this.alive[id] = 0;
    this.aliveCount--;
    this.indexed = false;
  }

  /** Frees every slot, keeping the allocated arrays. Used between periods and on restart. */
  clear(): void {
    this.alive.fill(0);
    this.aliveCount = 0;
    this.indexed = false;
  }

  /** Calls `visit` for every live entity, in ascending id order. */
  forEach(visit: (id: EntityId) => void): void {
    for (let id = 0; id < this.capacity; id++) {
      if (this.alive[id] === 1) visit(id);
    }
  }

  hasFlag(id: EntityId, flag: number): boolean {
    return ((this.flags[id] as number) & flag) !== 0;
  }

  setFlag(id: EntityId, flag: number, on = true): void {
    if (on) this.flags[id] = (this.flags[id] as number) | flag;
    else this.flags[id] = (this.flags[id] as number) & ~flag;
  }

  /** The grid cell a point falls in, clamped so out-of-bounds entities still index. */
  cellIndex(x: number, y: number): number {
    const col = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const row = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return row * this.cols + col;
  }

  /**
   * Rebuilds the spatial hash from current positions. Call once per step, after movement and
   * before any neighbour query. Counting sort: two passes over the entities, one over the cells,
   * and no allocation.
   */
  reindex(): void {
    const cells = this.cols * this.rows;

    this.cellStart.fill(0, 0, cells + 1);

    // Pass 1 — count per cell, offset by one so pass 3 can prefix-sum in place.
    for (let id = 0; id < this.capacity; id++) {
      if (this.alive[id] !== 1) continue;
      const cell = this.cellIndex(this.x[id] as number, this.y[id] as number);
      this.cellOf[id] = cell;
      this.cellStart[cell + 1] = (this.cellStart[cell + 1] as number) + 1;
    }

    // Pass 2 — prefix sum, turning counts into start offsets.
    for (let cell = 1; cell <= cells; cell++) {
      this.cellStart[cell] =
        (this.cellStart[cell] as number) + (this.cellStart[cell - 1] as number);
    }
    this.cellCursor.set(this.cellStart);

    // Pass 3 — place. Ascending id order means each cell's contents are id-ordered, which is
    // what makes query results deterministic without a sort.
    for (let id = 0; id < this.capacity; id++) {
      if (this.alive[id] !== 1) continue;
      const cell = this.cellOf[id] as number;
      const at = this.cellCursor[cell] as number;
      this.byCell[at] = id;
      this.cellCursor[cell] = at + 1;
    }

    this.indexed = true;
  }

  /**
   * Writes the ids within `radius` of `(x, y)` into `out`, returning how many were written. The
   * caller owns `out`, so a query in the hot path allocates nothing.
   *
   * Results are in ascending cell order and ascending id within a cell — a stable, deterministic
   * order that never depends on iteration order of a map (INV-8). Excludes `exclude`, which is
   * almost always the querying entity itself.
   *
   * Distances are compared in 2D. Height is deliberately ignored: marking, passing lanes, and
   * collision are all ground-plane questions, and a ball 3 m up is still "near" the athlete
   * about to catch it.
   */
  queryRadius(
    x: number,
    y: number,
    radius: number,
    out: Int32Array,
    exclude: EntityId = NO_ENTITY,
  ): number {
    if (!this.indexed) this.reindex();

    const minCol = clamp(Math.floor((x - radius) / this.cellSize), 0, this.cols - 1);
    const maxCol = clamp(Math.floor((x + radius) / this.cellSize), 0, this.cols - 1);
    const minRow = clamp(Math.floor((y - radius) / this.cellSize), 0, this.rows - 1);
    const maxRow = clamp(Math.floor((y + radius) / this.cellSize), 0, this.rows - 1);

    const rSquared = radius * radius;
    let written = 0;

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = row * this.cols + col;
        const end = this.cellStart[cell + 1] as number;

        for (let slot = this.cellStart[cell] as number; slot < end; slot++) {
          const id = this.byCell[slot] as number;
          if (id === exclude) continue;

          const dx = (this.x[id] as number) - x;
          const dy = (this.y[id] as number) - y;
          if (dx * dx + dy * dy > rSquared) continue;

          if (written >= out.length) return written;
          out[written++] = id;
        }
      }
    }

    return written;
  }

  /** `queryRadius` around an entity, excluding it. */
  queryNeighbours(id: EntityId, radius: number, out: Int32Array): number {
    return this.queryRadius(this.x[id] as number, this.y[id] as number, radius, out, id);
  }

  /** Squared 2D distance. Squared because the hot paths compare, and comparing needs no sqrt. */
  distanceSquared(a: EntityId, b: EntityId): number {
    const dx = (this.x[a] as number) - (this.x[b] as number);
    const dy = (this.y[a] as number) - (this.y[b] as number);
    return dx * dx + dy * dy;
  }

  distance(a: EntityId, b: EntityId): number {
    return Math.sqrt(this.distanceSquared(a, b));
  }

  /** The nearest live entity to `(x, y)` within `radius`, or `NO_ENTITY`. Ties go to the lower id. */
  nearest(
    x: number,
    y: number,
    radius: number,
    scratch: Int32Array,
    exclude: EntityId = NO_ENTITY,
  ): EntityId {
    const found = this.queryRadius(x, y, radius, scratch, exclude);
    let best = NO_ENTITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < found; i++) {
      const id = scratch[i] as number;
      const dx = (this.x[id] as number) - x;
      const dy = (this.y[id] as number) - y;
      const d = dx * dx + dy * dy;
      if (d < bestDistance) {
        bestDistance = d;
        best = id;
      }
    }

    return best;
  }

  /** Keeps a point inside the playing area, by `margin`. Sports decide what leaving means. */
  clampToBounds(id: EntityId, margin = 0): void {
    this.x[id] = clamp(this.x[id] as number, margin, this.width - margin);
    this.y[id] = clamp(this.y[id] as number, margin, this.height - margin);
    this.indexed = false;
  }

  /** True when `(x, y)` is inside the playing area. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x <= this.width && y >= 0 && y <= this.height;
  }

  /**
   * Marks the index stale. Anything that writes positions directly — and the hot loops do,
   * straight into the arrays — must say so, or a query will use last step's grid.
   */
  invalidateIndex(): void {
    this.indexed = false;
  }

  /** Whether the spatial hash matches current positions. */
  get isIndexed(): boolean {
    return this.indexed;
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
