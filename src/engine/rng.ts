/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.1 — Seeded PRNG + the lint rule banning the platform generator in engine/, sports/
 * @story   US-2.5 — Run at a steady frame rate, US-2.7 — Watch a replay of what just happened
 * @design  04-architecture.md §6 (determinism), 07-decisions.md D-11
 * @invariant INV-2 (the sim never calls the platform's unseeded generator), INV-8 (same
 *             seed + inputs → same state hash)
 *
 * Purpose: the single source of randomness for the simulation. Everything the sim decides that
 * is not a pure function of state comes through here, which is what makes a match reconstructible
 * from `(seed, setup, inputs)` — replays, headless balance batches, resume-after-kill, and
 * lockstep P2P all depend on that and nothing else.
 *
 * Algorithm: sfc32 (Chris Doty-Humphrey's "Small Fast Counting" generator, 128-bit state), seeded
 * through splitmix32. Chosen because every operation is a 32-bit integer op — `|0`, `>>>`, `+`,
 * `^`, rotate — so two engines that agree on int32 semantics produce byte-identical streams. A
 * float-based generator would not survive that promise, and INV-8 is the whole point.
 * Not cryptographic; nothing here guards a secret.
 */

/** A serialisable snapshot of a generator's position in its stream. */
export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  /** The unconsumed second sample from the last `gaussian()` pair, if any. */
  readonly spare: number | null;
}

/**
 * The interface threaded through the sim. Sport modules, AI, and physics receive this — never a
 * concrete class and never a global — so a test can hand them a generator whose position it
 * controls exactly.
 */
export interface Rng {
  /** The seed this generator (or its root ancestor) was created from. */
  readonly seed: string;

  /** The next raw 32-bit value, `0 … 2³²−1`. The primitive everything else is built on. */
  nextU32(): number;
  /** A float in `[0, 1)`, with 32 bits of resolution. */
  next(): number;
  /** An integer in `[min, max)`. Empty and inverted ranges return `min`. */
  int(min: number, max: number): number;
  /** A float in `[min, max)`. */
  float(min: number, max: number): number;
  /** `true` with probability `p` (default 0.5). `p ≤ 0` is never, `p ≥ 1` is always. */
  bool(p?: number): boolean;
  /** A uniformly chosen element. `undefined` only for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Fisher–Yates, in place, returning the same array. */
  shuffle<T>(items: T[]): T[];
  /** Normally distributed, Box–Muller. The unused half of each pair is kept in state. */
  gaussian(mean?: number, stdDev?: number): number;

  /**
   * A new generator on an independent stream, derived from this one's seed and `label` — not
   * from its current position. Two subsystems that fork the same label from the same seed get
   * the same stream regardless of how much either has consumed, so adding a call in one place
   * cannot shift another's results. That property is what makes determinism survive refactors.
   */
  fork(label: string): Rng;

  /** The current position, for replay checkpoints and desync checks. */
  snapshot(): RngState;
  /** Restores a position taken by `snapshot()`. */
  restore(state: RngState): void;
  /** An independent generator at this one's exact current position. */
  clone(): Rng;
}

/**
 * FNV-1a, 32-bit. Turns a seed string into a starting integer.
 *
 * @spec-ref 04-architecture.md §6 — the seed is user-visible (match codes, daily challenges),
 * so it is a string; the generator needs an int32.
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, in int32-safe pieces — Math.imul keeps the multiply exact.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** splitmix32 — spreads one seed integer into the four well-mixed words sfc32 needs. */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

const TWO_POW_32 = 4294967296;

class Sfc32 implements Rng {
  readonly seed: string;

  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: string) {
    this.seed = seed;
    const next = splitmix32(hashString(seed));
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();

    // sfc32 needs a short warm-up before its output is well distributed; skipping it makes the
    // first few values correlate with the seed, which shows up as biased opening tip-offs.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (this.a + this.b + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.nextU32() / TWO_POW_32;
  }

  int(min: number, max: number): number {
    const lo = Math.ceil(min);
    const span = Math.floor(max) - lo;
    if (span <= 0) return lo;
    return lo + Math.floor(this.next() * span);
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(p = 0.5): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(0, items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const a = items[i] as T;
      const b = items[j] as T;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  gaussian(mean = 0, stdDev = 1): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return mean + value * stdDev;
    }

    // Polar Box–Muller: rejection-sampled, so it uses a variable number of draws — which is fine
    // for determinism (the count is a function of the stream) and avoids trig entirely.
    let x: number;
    let y: number;
    let sumSquares: number;
    do {
      x = this.float(-1, 1);
      y = this.float(-1, 1);
      sumSquares = x * x + y * y;
    } while (sumSquares >= 1 || sumSquares === 0);

    const scale = Math.sqrt((-2 * Math.log(sumSquares)) / sumSquares);
    this.spare = y * scale;
    return mean + x * scale * stdDev;
  }

  fork(label: string): Rng {
    return new Sfc32(`${this.seed}/${label}`);
  }

  snapshot(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d, spare: this.spare };
  }

  restore(state: RngState): void {
    this.a = state.a | 0;
    this.b = state.b | 0;
    this.c = state.c | 0;
    this.d = state.d | 0;
    this.spare = state.spare;
  }

  clone(): Rng {
    const copy = new Sfc32(this.seed);
    copy.restore(this.snapshot());
    return copy;
  }
}

/** Creates a generator. The same seed always produces the same stream, on any engine. */
export function createRng(seed: string): Rng {
  return new Sfc32(seed);
}

/**
 * Creates a generator positioned at a saved state. Used when resuming a match from a checkpoint,
 * where the seed alone would rewind the stream to the tip-off.
 */
export function restoreRng(seed: string, state: RngState): Rng {
  const rng = new Sfc32(seed);
  rng.restore(state);
  return rng;
}

/**
 * A seed string for a new match. This is the one place a *non*-deterministic value legitimately
 * enters the system — choosing which deterministic universe to play in. It lives outside
 * `engine/`'s hot path by intent, and takes its entropy from `crypto.getRandomValues` rather than
 * the unseeded generator INV-2 bans — so the invariant holds even here.
 */
export function randomSeed(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${(bytes[0] as number).toString(36)}${(bytes[1] as number).toString(36)}`;
}
