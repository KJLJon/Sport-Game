/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.1 — Utility-scoring decision framework shared across sports and modes
 * @story   US-7.1 — Play against the computer, US-7.2 — Choose a difficulty
 * @design  06-game-design.md §5 (CPU behaviour), §7 (difficulty — reaction latency)
 * @invariant INV-1 (difficulty never touches attributes or ratings), INV-8 (determinism)
 *
 * Purpose: turns a per-tick score into behaviour a human can read. Scoring every tick and acting on
 * the winner produces an athlete that twitches between two nearly-equal options sixty times a
 * second and reacts to a loose ball before the ball has finished bouncing. Two dials fix both:
 *
 * - **Reaction latency.** A new best option is *noticed* immediately and *acted on* only after the
 *   level's reaction time has passed (`06` §7: Rookie 420 ms, Legend 90 ms). This is the whole of
 *   how difficulty makes the CPU slower — no attribute is touched (INV-1).
 * - **Commitment.** A challenger has to beat what the athlete is already doing by a margin. Without
 *   it, latency alone still dithers whenever two options trade the lead.
 *
 * Time is passed in, never read from a clock, so a headless batch and a played match decide
 * identically (INV-8).
 */
import type { Rng } from '../rng.ts';
import {
  scoreCandidates,
  type Candidate,
  type ScoredCandidate,
  type SelectOptions,
} from './utility.ts';

export interface DeciderOptions extends SelectOptions {
  /** Reaction time in milliseconds before a newly-preferred option is acted on (`06` §7). */
  readonly latencyMs?: number;
  /**
   * How much better, in utility, a challenger must be than the committed option before the athlete
   * will even start reacting to it. `0` reacts to any improvement.
   */
  readonly commitment?: number;
}

/** What an actor is doing and what it is starting to think about instead. */
export interface DecisionState<T> {
  /** The option being executed, or `null` while nothing clears the threshold. */
  readonly committed: ScoredCandidate<T> | null;
  /** The challenger being reacted to, if any. */
  readonly pendingKey: string | null;
  /** Sim time the challenger first took the lead — the reaction clock's start. */
  readonly pendingSince: number;
}

export interface Decider<T> {
  /**
   * The option this actor should execute now, given what is available this tick. Call it every
   * tick with the current sim time in milliseconds; it returns the *committed* option, which is
   * usually last tick's.
   */
  decide(
    actor: number,
    nowMs: number,
    candidates: readonly Candidate<T>[],
  ): ScoredCandidate<T> | null;
  /** What the actor is doing and thinking — for tests and the dev overlay. */
  inspect(actor: number): DecisionState<T> | undefined;
  /** Drops an actor's memory: substitutions, restarts, a new period. */
  forget(actor: number): void;
  /** Drops everything. A new match on the same decider must not inherit a stale commitment. */
  reset(): void;
}

interface Mutable<T> {
  committed: ScoredCandidate<T> | null;
  pendingKey: string | null;
  pendingSince: number;
}

/**
 * Creates a decider. One per team is the intended shape — the actor id keys the memory, and a
 * team's difficulty is the same for all of its athletes.
 */
export function createDecider<T>(options: DeciderOptions = {}): Decider<T> {
  const latencyMs = Math.max(0, options.latencyMs ?? 0);
  const commitment = Math.max(0, options.commitment ?? 0);
  const threshold = options.threshold ?? 0;
  const scoreOptions: SelectOptions = {
    ...(options.noise === undefined ? {} : { noise: options.noise }),
    ...(options.rng === undefined ? {} : { rng: options.rng }),
  };

  const memory = new Map<number, Mutable<T>>();

  function stateFor(actor: number): Mutable<T> {
    const existing = memory.get(actor);
    if (existing !== undefined) return existing;
    const created: Mutable<T> = { committed: null, pendingKey: null, pendingSince: 0 };
    memory.set(actor, created);
    return created;
  }

  return {
    decide(actor, nowMs, candidates) {
      const state = stateFor(actor);
      const scored = scoreCandidates(candidates, scoreOptions);
      const best = scored.find(
        (candidate) => candidate.utility > 0 && candidate.perceived >= threshold,
      );

      // The committed option is re-scored from this tick's world, not remembered: an athlete
      // driving into help has to notice the drive stopped being a good idea.
      const held =
        state.committed === null
          ? undefined
          : scored.find((candidate) => candidate.key === state.committed?.key);
      const stillValid = held !== undefined && held.utility > 0 && held.perceived >= threshold;

      if (!stillValid) {
        // What we were doing is gone or no longer worth doing. Switching away from an option that
        // has evaporated is not a reaction — there is nothing left to react to — so it is immediate.
        state.committed = best ?? null;
        state.pendingKey = null;
        state.pendingSince = nowMs;
        return state.committed;
      }

      state.committed = held;
      if (best === undefined || best.key === held.key) {
        state.pendingKey = null;
        return held;
      }

      if (best.perceived - held.perceived < commitment) {
        // Not enough of an improvement to be worth abandoning what we are doing.
        state.pendingKey = null;
        return held;
      }

      if (state.pendingKey !== best.key) {
        state.pendingKey = best.key;
        state.pendingSince = nowMs;
      }

      if (nowMs - state.pendingSince >= latencyMs) {
        state.committed = best;
        state.pendingKey = null;
        return best;
      }

      return held;
    },

    inspect(actor) {
      const state = memory.get(actor);
      if (state === undefined) return undefined;
      return {
        committed: state.committed,
        pendingKey: state.pendingKey,
        pendingSince: state.pendingSince,
      };
    },

    forget(actor) {
      memory.delete(actor);
    },

    reset() {
      memory.clear();
    },
  };
}

/**
 * The tuning a difficulty level hands the framework. T-7.7 builds these from `06` §7's table; the
 * engine takes plain numbers so it never imports a mode (`04` §5).
 */
export interface AiTuning {
  readonly latencyMs: number;
  readonly noise: number;
  readonly commitment: number;
  readonly threshold: number;
}

/** Convenience for the common case: one decider per side from a level's tuning and a forked rng. */
export function deciderFor<T>(tuning: AiTuning, rng: Rng): Decider<T> {
  return createDecider<T>({ ...tuning, rng });
}
