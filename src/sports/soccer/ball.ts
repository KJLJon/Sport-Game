/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.5 — Passing suite: short, through-ball, lofted, cross
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2 (ball model), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-5 (no sport logic in the engine)
 *
 * Purpose: soccer's numbers for the engine's ball.
 *
 * `06` §3.2 asks for one ball model that lofted passes, crosses, headers, and curled shots all fall
 * out of, rather than four special cases — and that model is `engine/physics/ball.ts`, written in
 * Phase 1 with soccer's name already in its comments. This file is the eight constants that turn it
 * into a football. There is no soccer physics here and there should never be any: a sport that
 * needed its own integrator would mean the engine's was basketball's in disguise.
 *
 * Two of these carry most of the character. `magnus` is more than double basketball's, because a
 * ball that does not bend is a ball with no crosses and no free kicks in it. And `rollingFriction`
 * is well under basketball's, because a ground pass across a pitch has to still be moving when it
 * arrives — which is also the property `passing.ts` leans on to weight a pass (see there).
 */
import type { BallPhysics } from '../../engine/physics/ball.ts';

/** @spec-ref 06-game-design.md §3.2 — position plus height with gravity, bounce, and spin */
export const SOCCER_BALL_PHYSICS: BallPhysics = {
  gravity: 9.81,
  /** A size 5 ball returns a little over half the height it is dropped from. */
  restitution: 0.6,
  /** Grass grabs a bouncing ball harder than a hardwood floor does. */
  friction: 0.62,
  /** Per-second rolling decay. Low: a ball rolls a long way on grass. */
  rollingFriction: 0.35,
  drag: 0.04,
  /** Twice basketball's. Crosses bend, free kicks bend, and that is most of the sport's texture. */
  magnus: 0.05,
  spinDecay: 0.5,
  /** Size 5, inflated. */
  radius: 0.11,
};

/**
 * How fast a rolling ball loses speed *per metre travelled*, rather than per second.
 *
 * The engine decays a rolling ball's speed at `rollingFriction` per second, which means
 * `dv/dt = -k·v`; dividing through by `dx/dt = v` gives `dv/dx = -k`. So speed falls **linearly
 * with distance**, at exactly `k` metres per second per metre. That is a small, useful fact: it
 * makes "how hard do I have to hit this to arrive at that speed" a sum rather than a solve, which
 * is the whole of weighting a ground pass.
 */
export const ROLL_DECAY_PER_METRE = SOCCER_BALL_PHYSICS.rollingFriction;
