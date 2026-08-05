/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @story   US-7.3 — Get help without being carried
 * @design  05-data-model.md §5.3 (the earning table), 06-game-design.md §4 (post-match: coin
 *          itemisation), §7 (difficulty), 09-modes-and-arcade.md §7 (balance across modes)
 * @invariant INV-1 (difficulty never touches an attribute or a rating — it scales the *payout*),
 *            INV-6 (no mode-specific branching: one payout function for Live and Playbook),
 *            INV-2 (nothing here draws; a payout is a pure function of the record)
 *
 * Purpose: what a finished match pays, line by line.
 *
 * **The input is a `MatchRecord`, and that is the whole design.** Both modes already build one from
 * the same event stream (T-8.5), so the payout is a pure function of what was played and nothing
 * else — no mode, no simulation, no clock. INV-6 is not upheld here by discipline; there is nowhere
 * for a mode to be branched on, because a mode is not an argument.
 *
 * **Multipliers scale performance, not the daily bonus.** `05` §5.3 lists the difficulty multiplier
 * and the no-assist bonus alongside the flat awards, and the reading taken here is that both scale
 * what you *did* — completion, the win, the milestones — while the first-win-of-the-day bonus is a
 * flat 250 whatever level it happened at. Scaling it too would make the first Legend win of the day
 * worth 500 on its own, which turns a "come back tomorrow" nudge into the biggest number on the
 * screen.
 *
 * **The lines always sum to the total.** Each multiplier line carries the coins it added, computed
 * against the running total rather than derived independently, so no rounding can leave the
 * itemisation disagreeing with the number underneath it. A test asserts it for every level.
 *
 * ## Performance milestones are relative, and that is deliberate
 *
 * `05` §5.3 asks for "performance milestones, 25–150 each, capped". The obvious ones — 20 points,
 * a double-double — are basketball's, and a soccer match would never pay one. Rather than branch on
 * the sport (which would be a rule about basketball living in the economy), every milestone here is
 * a *relative* fact: a share of the team's scoring, a margin as a fraction of the score, a count
 * against the opponent's. Those read the same in a 98–91 basketball game and a 2–0 soccer one, and
 * a third sport gets them for free.
 */
import { assistsOff, NO_ASSIST_BONUS, type AssistSettings } from '../modes/assists.ts';
import { difficultyProfile } from '../modes/difficulty.ts';
import { resultOf, type MatchRecord, type StatLine } from '../stats/types.ts';
import { EMPTY_PAYOUT, type CoinAward, type Payout } from './types.ts';

/** `05` §5.3, read straight across. */
export const MATCH_COMPLETED_COINS = 100;
export const WIN_COINS = 150;
export const FIRST_WIN_OF_DAY_COINS = 250;

/**
 * The most a single match can pay in milestones, whatever it contained.
 *
 * @spec-ref 05-data-model.md §5.3 — "performance milestones (per match, capped)". The individual
 * awards are the 25–150 band the table names; this is the ceiling on their sum, set so that a
 * perfect match pays about what the win itself does rather than dwarfing it.
 */
export const MILESTONE_CAP = 200;

/** One team's side of a match, summed from the box score the record kept. */
export interface TeamTotals {
  readonly points: number;
  readonly rebounds: number;
  readonly assists: number;
  readonly steals: number;
  readonly blocks: number;
  readonly turnovers: number;
  readonly fieldGoalsMade: number;
  readonly fieldGoalsAttempted: number;
  /** The best single scoring line on the team. `0` when nobody scored. */
  readonly topScore: number;
}

const NO_TOTALS: TeamTotals = {
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  topScore: 0,
};

export function teamTotals(lines: readonly StatLine[], side: 0 | 1): TeamTotals {
  let totals = NO_TOTALS;
  for (const line of lines) {
    if (line.side !== side) continue;
    totals = {
      points: totals.points + line.points,
      rebounds: totals.rebounds + line.rebounds,
      assists: totals.assists + line.assists,
      steals: totals.steals + line.steals,
      blocks: totals.blocks + line.blocks,
      turnovers: totals.turnovers + line.turnovers,
      fieldGoalsMade: totals.fieldGoalsMade + line.fieldGoalsMade,
      fieldGoalsAttempted: totals.fieldGoalsAttempted + line.fieldGoalsAttempted,
      topScore: Math.max(totals.topScore, line.points),
    };
  }
  return totals;
}

/**
 * What a milestone is asked about: your side, theirs, and how it finished.
 *
 * **The scoreline comes from the record, not from the box score.** A match's `score` is what the
 * scoreboard said; the lines are what the event stream attributed, and the two can differ — an
 * anonymous fixture records no lines at all, and an own goal belongs to nobody's line. Anything
 * about *the result* therefore reads `myScore`/`theirScore`, and the totals are for the things only
 * a box score knows: who scored most of it, how the ball was looked after.
 */
export interface MilestoneContext {
  readonly mine: TeamTotals;
  readonly theirs: TeamTotals;
  readonly myScore: number;
  readonly theirScore: number;
  readonly won: boolean;
  readonly lost: boolean;
  readonly margin: number;
}

export interface MilestoneDef {
  readonly id: string;
  readonly label: string;
  readonly coins: number;
  readonly when: (context: MilestoneContext) => boolean;
}

/**
 * The milestone table. Ordered by what a player would be proudest of, because that is the order the
 * post-match screen prints them in and the cap trims from the bottom.
 *
 * @spec-ref 05-data-model.md §5.3 — each award sits inside the table's 25–150 band.
 */
export const MILESTONES: readonly MilestoneDef[] = [
  {
    id: 'shutout',
    label: 'Shutout',
    coins: 100,
    // Not "they scored nothing" alone: a 0–0 draw is not a defensive performance worth 100, and a
    // match you lost cannot have been one.
    when: ({ theirScore, lost, myScore }) => theirScore === 0 && !lost && myScore > 0,
  },
  {
    id: 'dominant',
    label: 'Dominant win',
    coins: 75,
    // A fifth of your own score, and never less than two: 2–0 in soccer and 100–80 in basketball
    // are both comfortable, and both say so without the economy knowing which sport it is looking
    // at.
    when: ({ won, margin, myScore }) => won && margin >= Math.max(2, myScore * 0.2),
  },
  {
    id: 'star',
    label: 'Star performance',
    coins: 50,
    when: ({ mine, myScore }) => myScore >= 2 && mine.topScore >= myScore * 0.4,
  },
  {
    id: 'sharp',
    label: 'Clinical finishing',
    coins: 50,
    // Relative to the attempts actually taken, with a floor so that one lucky shot is not a
    // milestone. Basketball clears the floor most matches; a soccer side that scores on half a
    // dozen chances has earned the same line.
    when: ({ mine }) =>
      mine.fieldGoalsAttempted >= 6 && mine.fieldGoalsMade * 2 >= mine.fieldGoalsAttempted,
  },
  {
    id: 'security',
    label: 'Ball security',
    coins: 25,
    when: ({ mine, theirs }) => theirs.turnovers >= 4 && mine.turnovers * 2 <= theirs.turnovers,
  },
  {
    id: 'lockdown',
    label: 'Lockdown defence',
    coins: 25,
    when: ({ mine, theirs }) =>
      mine.steals + mine.blocks >= theirs.steals + theirs.blocks + 3 &&
      mine.steals + mine.blocks > 0,
  },
];

/** Which milestones a match earned, already trimmed to the cap. */
export function milestonesFor(context: MilestoneContext): readonly MilestoneDef[] {
  const earned: MilestoneDef[] = [];
  let total = 0;
  for (const milestone of MILESTONES) {
    if (!milestone.when(context)) continue;
    if (total + milestone.coins > MILESTONE_CAP) continue;
    earned.push(milestone);
    total += milestone.coins;
  }
  return earned;
}

export interface MatchPayoutOptions {
  /** The finished match, as `stats/record.ts` built it. */
  readonly record: MatchRecord;
  /** What the player was being helped by. Absent means "the level's defaults", i.e. no bonus. */
  readonly assists?: AssistSettings;
  /**
   * True when this is the first win the wallet has seen today (`05` §5.3). The wallet decides it,
   * not this function: it is a fact about the day, not about the match.
   */
  readonly firstWinToday?: boolean;
}

/**
 * What a finished match pays.
 *
 * A match nobody played — the harness, a spectated fixture — pays nothing at all rather than paying
 * the completion award to a wallet that did not play it. `resultOf` already answers that question,
 * and it is the same `null` history uses to show a dash.
 */
export function matchPayout(options: MatchPayoutOptions): Payout {
  const { record } = options;
  const result = resultOf(record);
  if (result === null) return EMPTY_PAYOUT;

  const side = record.playerSide as 0 | 1;
  const mine = teamTotals(record.lines, side);
  const theirs = teamTotals(record.lines, side === 0 ? 1 : 0);
  const won = result === 'win';

  const items: CoinAward[] = [
    { id: 'completed', label: 'Match completed', coins: MATCH_COMPLETED_COINS },
  ];
  if (won) items.push({ id: 'win', label: 'Win', coins: WIN_COINS });

  const myScore = record.score[side];
  const theirScore = record.score[side === 0 ? 1 : 0];

  for (const milestone of milestonesFor({
    mine,
    theirs,
    myScore,
    theirScore,
    won,
    lost: result === 'loss',
    margin: myScore - theirScore,
  })) {
    items.push({ id: `milestone:${milestone.id}`, label: milestone.label, coins: milestone.coins });
  }

  let running = items.reduce((sum, item) => sum + item.coins, 0);

  const profile = difficultyProfile(record.difficulty);
  if (profile.rewardMultiplier !== 1) {
    const scaled = Math.round(running * profile.rewardMultiplier);
    items.push({
      id: 'difficulty',
      label: profile.label,
      coins: scaled - running,
      multiplier: profile.rewardMultiplier,
    });
    running = scaled;
  }

  if (options.assists !== undefined && assistsOff(options.assists)) {
    const scaled = Math.round(running * (1 + NO_ASSIST_BONUS));
    items.push({
      id: 'no-assists',
      label: 'No assists',
      coins: scaled - running,
      multiplier: 1 + NO_ASSIST_BONUS,
    });
    running = scaled;
  }

  // Flat, and last: it is a bonus for coming back today, not for how the match went.
  if (won && options.firstWinToday === true) {
    items.push({ id: 'first-win', label: 'First win today', coins: FIRST_WIN_OF_DAY_COINS });
    running += FIRST_WIN_OF_DAY_COINS;
  }

  return { total: running, items };
}

/** The one line a payout is worth in a ledger: "Basketball · Live · You win". */
export function payoutDetail(record: MatchRecord, sportName: string): string {
  const result = resultOf(record);
  const mode = record.mode === 'live' ? 'Live' : 'Playbook';
  const outcome = result === 'win' ? 'Won' : result === 'loss' ? 'Lost' : 'Drew';
  return `${sportName} · ${mode} · ${outcome} ${record.score[0]}–${record.score[1]}`;
}
