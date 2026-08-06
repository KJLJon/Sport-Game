/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set, 8 — economy
 * @task    T-4.13 — Arcade balance: daily reward caps, anti-farm verification (INV-12)
 * @task    T-8.16 — Economy balance pass: pack EV vs sell value vs earn rate
 * @story   US-16.6 — Not be able to farm it
 * @design  09-modes-and-arcade.md §3.3 (coin rewards), §7 (balance across modes)
 * @invariant INV-12 (reward rate per minute is within ±25% across modes)
 *
 * Purpose: what a scored arcade run pays in coins, and the two rules that stop it becoming the
 * efficient way to earn — a sharp per-game decay, and a hard daily ceiling.
 *
 * **Why both, and not just one.** A decay alone still pays forever if you rotate between five games;
 * a cap alone makes the first twenty runs of one game identically worth playing, which is exactly
 * the grind `09` §3.3 rules out. Together the shape is: your first run of each game today is worth
 * playing, your fourth is worth almost nothing, and the day has a ceiling regardless.
 *
 * **The first three-star of the day is the headline** (`09` §3.3), because it rewards *playing well
 * once* rather than playing often — the only reward shape that a skill game can pay without
 * becoming a job.
 *
 * **Where the coins actually go is Phase 8.** There is no wallet yet (`src/economy/` is empty until
 * T-8.9), so this computes the award and records it against the day; crediting it is one call away
 * and belongs with the economy that owns the balance.
 */
import { emptyDay, type ArcadeDay } from './records.ts';
import type { ArcadeGameId, ArcadeResult, StarCount } from './types.ts';

/**
 * Coins for a first run of a game today, by stars earned.
 *
 * **Retuned at T-8.16, when there was finally a match rate to compare against.** T-4.13 set these
 * with `src/economy/` empty and nothing to calibrate them by; a won 12-minute match turned out to
 * pay 250, and the old values let a skilled player collect the entire daily ceiling in under three
 * minutes. The ceiling is what stops arcade being a farm, so it now sits *below one match's
 * payout* — and these values are sized so that reaching it takes the first run of three or four
 * different games, which is `09` §3.3's shape rather than one lucky free-throw run.
 */
export const COINS_BY_STARS: readonly [number, number, number, number] = [0, 8, 16, 30];

/** The one-off for the first three-star run of each game each day (`09` §3.3). */
export const FIRST_THREE_STAR_BONUS = 30;

/**
 * How sharply a repeat run of the *same game* decays, per run already played today. Sharp on
 * purpose: the fourth run of a game is worth about a sixth of the first.
 */
export const REPEAT_DECAY = 0.55;

/**
 * Everything arcade can pay in one day, across every game.
 *
 * **Below the payout of a single won match** (250 at Pro, `05` §5.3), which is the property that
 * makes "no mode is the efficient farm" (`09` §7) true at every session length worth measuring: sit
 * down for one match and you beat a whole day of arcade. Under twelve minutes there is no match to
 * finish and arcade is the only thing that pays, which is what arcade is *for* — the crossover, not
 * the per-minute rate, is the honest form of the invariant, and
 * `tests/invariants/economy-balance.test.ts` asserts it.
 */
export const DAILY_COIN_CAP = 200;

export interface RewardBreakdown {
  /** Coins actually awarded, after the decay and the cap. */
  readonly coins: number;
  /** What it would have paid with neither rule applied — what the screen explains against. */
  readonly base: number;
  /** True when this run was the first three-star of the day for its game. */
  readonly firstThreeStar: boolean;
  /** True when the daily ceiling is what limited the payout. */
  readonly capped: boolean;
  /** How many runs of this game had already been played today. */
  readonly repeats: number;
  /** The day record after the award. */
  readonly day: ArcadeDay;
}

function runsToday(day: ArcadeDay, game: ArcadeGameId): number {
  return day.runs[game] ?? 0;
}

/** Coins before the daily cap: the star value, decayed by repeats, plus the once-a-day headline. */
export function baseCoins(stars: StarCount, repeats: number, firstThreeStar: boolean): number {
  const decayed = COINS_BY_STARS[stars] * REPEAT_DECAY ** repeats;
  return Math.round(decayed) + (firstThreeStar ? FIRST_THREE_STAR_BONUS : 0);
}

/**
 * What a finished run pays, and the day it leaves behind. Practice pays nothing and is not even
 * counted as a run — `09` §3.3's "unlimited and unrewarded" would not be unlimited if it filled up
 * the day's ceiling.
 */
export function awardRun(result: ArcadeResult, day: ArcadeDay): RewardBreakdown {
  if (!result.rewarded) {
    return { coins: 0, base: 0, firstThreeStar: false, capped: false, repeats: 0, day };
  }

  const repeats = runsToday(day, result.game);
  const firstThreeStar = result.stars === 3 && !day.paidGames.includes(result.game);
  const base = baseCoins(result.stars, repeats, firstThreeStar);

  const remaining = Math.max(0, DAILY_COIN_CAP - day.coins);
  const coins = Math.min(base, remaining);

  return {
    coins,
    base,
    firstThreeStar,
    capped: coins < base,
    repeats,
    day: {
      ...day,
      coins: day.coins + coins,
      runs: { ...day.runs, [result.game]: repeats + 1 },
      paidGames: firstThreeStar ? [...day.paidGames, result.game] : day.paidGames,
      dailyScore:
        result.mode === 'daily' ? Math.max(day.dailyScore ?? 0, result.score) : day.dailyScore,
    },
  };
}

/** The sentence the run-over screen shows about coins. */
export function rewardSummary(reward: RewardBreakdown): string {
  if (reward.coins === 0) {
    return reward.capped
      ? "That's today's arcade coins spent — play a match, or come back tomorrow."
      : 'No coins for this one.';
  }

  const parts = [`+${reward.coins} coins`];
  if (reward.firstThreeStar) parts.push('first three-star of the day');
  else if (reward.repeats > 0) parts.push(`run ${reward.repeats + 1} today`);
  if (reward.capped) parts.push('daily cap reached');
  return parts.join(' · ');
}

/**
 * The most coins a day of nothing but arcade can produce. Used by the anti-farm test and worth
 * being able to state out loud: it is `DAILY_COIN_CAP`, whatever anyone does.
 */
export function maxDailyCoins(): number {
  return DAILY_COIN_CAP;
}

/** A fresh day, for a caller that has not read one yet. */
export { emptyDay };
