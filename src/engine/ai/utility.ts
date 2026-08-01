/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.1 — Utility-scoring decision framework shared across sports and modes
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5 (CPU behaviour), §7 (difficulty)
 * @invariant INV-1 (difficulty never touches attributes or ratings), INV-2 (no Math.random),
 *            INV-8 (determinism), INV-5 (no sport-specific branching in engine core)
 *
 * Purpose: scores a set of candidate actions against weighted considerations and picks one. This is
 * the "score the options" half of `06` §5 — the half that is the same for a basketball guard
 * choosing between a pass and a drive, a soccer centre-back choosing between stepping up and
 * dropping, and a Playbook CPU choosing a call. Sports supply the considerations; nothing here
 * knows what a sport is.
 *
 * Two properties matter more than the maths:
 *
 * 1. **A veto is absolute.** A consideration that scores 0 removes the option, and decision noise
 *    cannot resurrect it. "Pass to a marked man behind me" must not become reachable because the
 *    difficulty is Rookie — bad decisions should be *plausible* ones, not illegal ones.
 * 2. **Difficulty enters here and only here.** It jitters scores and raises the do-nothing
 *    threshold; it never edits a consideration, because a consideration reads ratings (INV-1).
 */
import type { Rng } from '../rng.ts';

/** One weighted reason for or against an option, scored `0–1`. */
export interface Consideration {
  /** For debugging and the dev overlay — why the AI did that. */
  readonly name: string;
  /** Relative importance. `1` is normal; `2` counts double; must be > 0. */
  readonly weight: number;
  /** How well this option satisfies the consideration, `0–1`. Exactly `0` vetoes the option. */
  readonly score: number;
}

/** An option under consideration, with a key stable across ticks so commitment can track it. */
export interface Candidate<T> {
  /** Identity across ticks — `'pass:7'`, `'press'`. Two ticks agreeing means the same intent. */
  readonly key: string;
  readonly option: T;
  readonly considerations: readonly Consideration[];
}

export interface ScoredCandidate<T> extends Candidate<T> {
  /** The weighted utility, `0–1`, before noise. */
  readonly utility: number;
  /** What the AI *thinks* it is worth this tick — utility plus decision noise. */
  readonly perceived: number;
}

export interface ScoreOptions {
  /**
   * Decision noise, `0` (perfect) to `1` (wild). `06` §7's "option-score jitter" row: Rookie is
   * high, Legend minimal. One standard deviation of a gaussian added to the utility.
   */
  readonly noise?: number;
  /** Required when `noise > 0`. Fork it by label (`rng.fork('ai')`), never share a stream. */
  readonly rng?: Rng;
}

export interface SelectOptions extends ScoreOptions {
  /**
   * The utility an option must reach to be worth doing at all. Below it the AI does nothing, which
   * is a real decision: holding the ball and waiting beats forcing a pass that is not on.
   */
  readonly threshold?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The weighted utility of one option, `0–1`.
 *
 * Considerations multiply rather than average, so a single fatal one sinks the option however good
 * the rest are — averaging lets "wide open" outvote "the ball is in the other team's hands".
 *
 * Multiplying alone has a known flaw: every extra consideration drags the product down, so an
 * option that thought about five things always loses to one that thought about two. The standard
 * fix (Mark's infinite-axis utility) is applied — each score is pulled back towards 1 by a factor
 * of how many considerations there are — so options with different numbers of considerations stay
 * comparable.
 *
 * @spec-ref 06-game-design.md §5 (option scoring uses derived ratings)
 */
export function utility(considerations: readonly Consideration[]): number {
  if (considerations.length === 0) return 0;

  // A zero-weight consideration is switched off, not merely unimportant: it must not change the
  // compensation either, or turning one off would move every other option's score.
  const counted = considerations.filter((consideration) => consideration.weight > 0);
  if (counted.length === 0) return 0;

  const compensation = 1 - 1 / counted.length;
  let product = 1;

  for (const consideration of counted) {
    const score = clamp01(consideration.score);
    if (score === 0) return 0; // a veto is absolute

    const weighted = score ** consideration.weight;
    product *= weighted + compensation * (1 - weighted) * weighted;
  }

  return clamp01(product);
}

/**
 * Scores every candidate and sorts them best-first.
 *
 * Noise is drawn for every candidate in input order, whether or not it can win, so adding a losing
 * option to a sport's list cannot change what a later draw returns (INV-8).
 */
export function scoreCandidates<T>(
  candidates: readonly Candidate<T>[],
  options: ScoreOptions = {},
): ScoredCandidate<T>[] {
  const noise = options.noise ?? 0;
  const rng = options.rng;

  const scored = candidates.map((candidate) => {
    const value = utility(candidate.considerations);
    const jitter = noise > 0 && rng !== undefined ? rng.gaussian() * noise : 0;
    // A veto stays vetoed: noise makes the AI misjudge, not hallucinate.
    const perceived = value === 0 ? 0 : clamp01(value + jitter);
    return { ...candidate, utility: value, perceived };
  });

  // Ties fall back to the true utility — which keeps a vetoed option below a merely bad one whose
  // noise clamped it to zero — and then to the sport's own preference order.
  return scored
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        b.candidate.perceived - a.candidate.perceived ||
        b.candidate.utility - a.candidate.utility ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/**
 * The option to execute, or `null` for "nothing is worth doing" — which the caller should treat as
 * a decision rather than a failure.
 */
export function selectOption<T>(
  candidates: readonly Candidate<T>[],
  options: SelectOptions = {},
): ScoredCandidate<T> | null {
  const best = scoreCandidates(candidates, options)[0];
  if (best === undefined || best.utility === 0) return null;
  return best.perceived >= (options.threshold ?? 0) ? best : null;
}

/** Builds a consideration. Weight defaults to 1, which is what most of them want. */
export function consider(name: string, score: number, weight = 1): Consideration {
  return { name, score, weight };
}

/**
 * Maps a raw quantity onto `0–1` for use as a consideration score. `06` §5's scores are almost all
 * "how far along this range is it", and writing that inline three hundred times is how curves end
 * up subtly inconsistent between sports.
 */
export function normalise(value: number, min: number, max: number): number {
  if (max === min) return value >= max ? 1 : 0;
  return clamp01((value - min) / (max - min));
}

/** `normalise()` the other way up — nearer, cheaper, safer all score higher as the number falls. */
export function inverse(value: number, min: number, max: number): number {
  return 1 - normalise(value, min, max);
}
