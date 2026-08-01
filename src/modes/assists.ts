/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.8 — Assist system: aim, pass, auto-switch, timing forgiveness
 * @story   US-7.3 — Get help without being carried
 * @design  06-game-design.md §2 (assists), §7 (difficulty), 09-modes-and-arcade.md §7
 * @invariant INV-1 (difficulty never modifies an attribute or a derived rating)
 *
 * Purpose: how much help the player gets, as four independent dials. `06` §2 lists them —
 * aim assist, pass assist, auto-switch, shot-timing forgiveness — and says they are "tunable
 * independently of difficulty". That word is the whole design:
 *
 * - Difficulty supplies the **default**. A Rookie starts with full help, Legend with none.
 * - Once the player has an opinion, their setting **wins at every level**. Turning aim assist off
 *   on Rookie is allowed; turning it on for Legend is allowed too, and costs the bonus.
 * - Playing with everything off pays a **coin bonus** (US-7.3), which is the whole reason the two
 *   are separable: help you did not need should be worth giving up.
 *
 * Nothing here touches a rating. An assist changes what the *input* means — which teammate a pass
 * finds, how forgiving the release window is — never who the athlete is (INV-1).
 *
 * **This module is pure on purpose.** It is imported by the sports layer, so it may not reach
 * storage: `modes/last-played.ts` owns loading and saving, and anything `sports/` imports has to be
 * safe to load in a headless `tsx` run with no `import.meta.env`.
 */
import { difficultyProfile, type Difficulty } from './difficulty.ts';

export interface AssistSettings {
  /**
   * Aim assist, `0–1`: how strongly a shot or pass direction snaps towards what the player
   * plainly meant. `0` sends it exactly where it was pointed.
   */
  readonly aim: number;
  /**
   * Pass assist, `0–1`: how wide the cone is that target selection picks a teammate from. `0` is a
   * narrow cone — the pass goes to whoever is actually in front of the stick.
   */
  readonly pass: number;
  /** Auto-switch to the athlete nearest the ball when possession changes. */
  readonly autoSwitch: boolean;
  /**
   * Shot-timing forgiveness as a multiplier on the release window: `1` is the athlete's own window
   * with no help, above 1 is more generous. `06` §7's "your shot-timing window" row is the default
   * this takes at each level.
   */
  readonly timing: number;
}

/** Everything off — the no-assist run, and what the bonus is paid for. */
export const NO_ASSISTS: AssistSettings = { aim: 0, pass: 0, autoSwitch: false, timing: 1 };

/**
 * What a level starts you on, from `06` §7's assist and timing-window rows. Legend's row is "off by
 * default" — *by default*, which is why this is a starting point rather than a rule.
 */
export function defaultAssists(difficulty: Difficulty | string): AssistSettings {
  const profile = difficultyProfile(difficulty);
  return {
    aim: profile.assist,
    pass: profile.assist,
    // Off at Legend with the rest; a player who wants it back can have it back.
    autoSwitch: profile.assist > 0,
    timing: profile.timingWindow,
  };
}

/** True when nothing is helping — the state the bonus is paid for. */
export function assistsOff(assists: AssistSettings): boolean {
  return assists.aim === 0 && assists.pass === 0 && !assists.autoSwitch && assists.timing <= 1;
}

/**
 * The bonus for turning the help off, as a fraction of the payout (US-7.3 — "a small reward
 * bonus"). Deliberately small: it should be worth doing for the challenge, not worth suffering for
 * the coins, and a large one would make assists a tax on players who need them.
 */
export const NO_ASSIST_BONUS = 0.15;

/**
 * The multiplier a payout applies for playing unaided. Phase 8 owns the wallet (T-8.9) — this is
 * the number it will multiply by, alongside the level's own `rewardMultiplier`.
 */
export function assistMultiplier(assists: AssistSettings): number {
  return assistsOff(assists) ? 1 + NO_ASSIST_BONUS : 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Repairs anything out of range or missing — settings come out of storage written by old builds. */
export function normaliseAssists(
  value: Partial<AssistSettings> | null | undefined,
  fallback: AssistSettings,
): AssistSettings {
  if (value === null || value === undefined) return fallback;
  const timing = Number.isFinite(value.timing) ? (value.timing as number) : fallback.timing;
  return {
    aim: clamp01(value.aim ?? fallback.aim),
    pass: clamp01(value.pass ?? fallback.pass),
    autoSwitch: value.autoSwitch ?? fallback.autoSwitch,
    // A window can be widened a long way but never closed to nothing, whatever storage says.
    timing: timing < 0.5 ? 0.5 : timing > 2 ? 2 : timing,
  };
}
