/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §2.4 (render-side animation state), §3.1 (poses)
 * @invariant INV-8 (rendering never feeds back into the simulation), INV-2 (no unseeded randomness)
 *
 * Purpose: the per-athlete animation state a sprite renderer keeps — which way they face, how far
 * they have run, and which pose they are in — with no sport in it and no route back into the sim.
 *
 * **Why it lives beside the renderer and not in `SportState`.** `13` §1 principle 5: the simulation
 * must not know sprites exist. A run cycle in the world state would be a render concern that a
 * replay has to serialise, that the netcode has to agree on, and that a determinism test would
 * start failing over. Here it is derived state — throw it away, rebuild it from two frames of
 * positions, and nothing about the match changes.
 *
 * **Why the run cycle is driven by distance and not by time.** Legs that cycle on a timer slide
 * across the ground when an athlete slows down; legs that cycle on distance travelled cannot,
 * because the stride length *is* the relationship between the two. It also makes the frame a pure
 * function of the path taken, so the same seed draws the same frame (INV-8).
 *
 * **Why the idle cycle is driven by time.** A standing athlete travels no distance, so there is
 * nothing else to drive a breath. `advance(dt)` is the render clock, called by the screen once a
 * frame; a renderer whose clock is never advanced simply shows frame 0 of every idle, which is what
 * a still-image test and a snapshot both want.
 */
import { facingOf, type Facing } from './atlas.ts';

/** The poses every sport's humanoid shares (`13` §3.1). Sport → pose mapping is T-13.7's job. */
export const POSE = {
  idle: 'idle',
  run: 'run',
  plant: 'plant',
} as const;

export interface AthleteAnim {
  facing: Facing;
  /** Accumulated world units travelled. Run-cycle phase is this over the stride. */
  runDistance: number;
  /** Current pose id — a key into the sport's atlas, `13` §3.1. */
  pose: string;
  /** 0–1 through a one-shot action pose. Advanced by `advance(dt)`; T-13.7 drives it. */
  poseT: number;
  /** Speed in world units per second, smoothed, for the idle/run decision. */
  speed: number;
  /** Last seen position, for the distance accumulator. `null` until the first frame. */
  x: number | null;
  y: number | null;
}

export interface AnimOptions {
  /** World units one full run cycle covers. A stride at 32 px per athlete, roughly two paces. */
  readonly stride?: number;
  /** Frames in the run cycle (`13` §3.1: six). */
  readonly runFrames?: number;
  /** Frames in the idle cycle, and the seconds one of them holds for. */
  readonly idleFrames?: number;
  readonly idleFrameSeconds?: number;
  /** Below this speed, in world units per second, an athlete is standing rather than running. */
  readonly runSpeed?: number;
}

const DEFAULTS = {
  stride: 2.2,
  runFrames: 6,
  idleFrames: 2,
  idleFrameSeconds: 0.6,
  runSpeed: 0.6,
} as const;

/**
 * Animation state for every athlete one renderer has seen.
 *
 * Keyed by entity id, which is stable for a match. Entities that stop being drawn keep a few bytes
 * of state until the renderer is discarded at the end of the match, which is cheaper and simpler
 * than tracking liveness for a map that never exceeds the squad size.
 */
export class AnimStore {
  private readonly anims = new Map<number, AthleteAnim>();
  private readonly options: Required<AnimOptions>;
  /** The render clock, in seconds. Never a `Date` — see the header. */
  private elapsed = 0;

  constructor(options: AnimOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Advances the render clock. Called once a frame by whoever owns the frame's dt. */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    for (const anim of this.anims.values()) {
      if (anim.poseT < 1) anim.poseT = Math.min(1, anim.poseT + dt);
    }
  }

  get time(): number {
    return this.elapsed;
  }

  /** The state for one athlete, created on first sight facing south — the authored default. */
  get(id: number): AthleteAnim {
    let anim = this.anims.get(id);
    if (anim === undefined) {
      anim = { facing: 6, runDistance: 0, pose: POSE.idle, poseT: 1, speed: 0, x: null, y: null };
      this.anims.set(id, anim);
    }
    return anim;
  }

  /**
   * Folds one frame of an athlete's motion into their animation state, and returns it.
   *
   * `vx`/`vy` decide the facing — velocity is what an athlete is *doing*, where the sim's `facing`
   * is where they are aiming — while the distance actually moved drives the run cycle, so an
   * athlete pinned against a wall stops running on the spot.
   */
  update(id: number, x: number, y: number, vx: number, vy: number, dt = 0): AthleteAnim {
    const anim = this.get(id);

    anim.facing = facingOf(vx, vy, anim.facing);

    if (anim.x !== null && anim.y !== null) {
      const moved = Math.hypot(x - anim.x, y - anim.y);
      anim.runDistance += moved;
      if (dt > 0) anim.speed = moved / dt;
    }
    if (dt <= 0) anim.speed = Math.hypot(vx, vy);

    anim.x = x;
    anim.y = y;
    return anim;
  }

  /** Whether this athlete should be drawn running rather than standing. */
  running(anim: AthleteAnim): boolean {
    return anim.speed >= this.options.runSpeed;
  }

  /**
   * The frame index within the athlete's current pose.
   *
   * Running is the run cycle's phase from distance; standing is the idle cycle from the render
   * clock, offset by entity id so a bench of ten athletes does not breathe in lockstep — an offset,
   * not a random, so the same match draws the same frame every time (INV-2, INV-8).
   */
  frame(id: number, anim: AthleteAnim): number {
    if (anim.pose === POSE.run) {
      const perFrame = this.options.stride / this.options.runFrames;
      return Math.floor(anim.runDistance / perFrame) % this.options.runFrames;
    }
    if (anim.pose !== POSE.idle) return 0;

    const { idleFrames, idleFrameSeconds } = this.options;
    const offset = id % idleFrames;
    return (Math.floor(this.elapsed / idleFrameSeconds) + offset) % idleFrames;
  }
}
