/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.13 — Balance pass #1: shooting percentages and pace plausible over 500 headless games
 * @story   US-3.1 — Play a 5v5 basketball match
 * @design  06-game-design.md §3.1 (basketball), 12-quality-and-testing.md §5 (balance verification)
 *
 * Purpose: plays five hundred basketball matches with nobody watching and reports whether the
 * numbers that come out look like basketball. Fails the run if they do not.
 *
 * **Why a tool and not a test.** Five hundred matches is minutes of CPU, and a suite that takes
 * minutes is a suite people stop running. `pnpm balance` is the same shape as `pnpm bench`: a gate
 * you run deliberately, at a phase gate or after touching a tuning constant, not on every save.
 *
 * **Why bands and not exact numbers.** A balance target that pins a number pins the seed too, and
 * the moment anything upstream draws one more random number the whole thing goes red for no reason.
 * The bands below are wide enough to survive a re-tune and narrow enough that a genuine regression —
 * nobody scores, everybody scores, the shot clock stops mattering — cannot slip through.
 */
import { simulateMatch } from '../src/modes/live/match.ts';
import { teamLine, type TeamLine } from '../src/modes/live/box-score.ts';
import { basketball } from '../src/sports/basketball/index.ts';

/** How many matches. `06` §3.1's balance task names five hundred. */
const MATCHES = Number(process.env.BALANCE_MATCHES ?? 500);

export interface BalanceBand {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
}

export interface BalanceReport {
  readonly matches: number;
  readonly bands: readonly BalanceBand[];
  readonly failures: readonly BalanceBand[];
}

/** One side's numbers from one match, already averaged per game. */
interface Sample {
  readonly points: number;
  readonly fga: number;
  readonly fgm: number;
  readonly threeA: number;
  readonly threeM: number;
  readonly fta: number;
  readonly ftm: number;
  readonly rebounds: number;
  readonly offensiveRebounds: number;
  readonly assists: number;
  readonly turnovers: number;
  readonly fouls: number;
  readonly steals: number;
  readonly blocks: number;
}

function sample(line: TeamLine): Sample {
  return {
    points: line.points,
    fga: line.fieldGoalsAttempted,
    fgm: line.fieldGoalsMade,
    threeA: line.threesAttempted,
    threeM: line.threesMade,
    fta: line.freeThrowsAttempted,
    ftm: line.freeThrowsMade,
    rebounds: line.rebounds,
    offensiveRebounds: line.offensiveRebounds,
    assists: line.assists,
    turnovers: line.turnovers,
    fouls: line.fouls,
    steals: line.steals,
    blocks: line.blocks,
  };
}

/**
 * Plays `matches` games and reports the aggregate.
 *
 * Seeds are `balance-0`, `balance-1`, … rather than drawn: the whole run is reproducible, so a
 * failing band can be investigated by replaying the exact match that caused it.
 */
export function runBalance(matches: number = MATCHES): BalanceReport {
  const samples: Sample[] = [];
  let wins = 0;
  let ties = 0;

  for (let i = 0; i < matches; i++) {
    const match = simulateMatch({ seed: `balance-${i}`, sport: basketball });
    const home = teamLine(match.box, 0);
    const away = teamLine(match.box, 1);

    samples.push(sample(home), sample(away));
    if (home.points > away.points) wins++;
    else if (home.points === away.points) ties++;
  }

  const mean = (pick: (s: Sample) => number): number =>
    samples.reduce((sum, s) => sum + pick(s), 0) / samples.length;
  const rate = (made: (s: Sample) => number, attempted: (s: Sample) => number): number => {
    const a = samples.reduce((sum, s) => sum + attempted(s), 0);
    return a === 0 ? 0 : samples.reduce((sum, s) => sum + made(s), 0) / a;
  };

  const bands: BalanceBand[] = [
    band(
      'Points per team',
      mean((s) => s.points),
      55,
      125,
    ),
    band(
      'Field-goal attempts',
      mean((s) => s.fga),
      45,
      110,
    ),
    // Raw FG% is not comparable across offences with different shot mixes — a team taking half its
    // shots from three has a lower one by construction, and chasing the league-average number would
    // mean tuning the CPU into taking worse shots. `eFG%` is the metric that actually compares, so
    // it carries the tighter band and the raw figure carries a loose sanity range.
    band(
      'Field-goal %',
      rate(
        (s) => s.fgm,
        (s) => s.fga,
      ) * 100,
      33,
      55,
      '%',
    ),
    band('Effective FG%', effectiveFieldGoal(samples) * 100, 40, 58, '%'),
    band(
      'Three-point %',
      rate(
        (s) => s.threeM,
        (s) => s.threeA,
      ) * 100,
      25,
      45,
      '%',
    ),
    band('Three-point share of attempts', threeShare(samples) * 100, 8, 55, '%'),
    band(
      'Free-throw %',
      rate(
        (s) => s.ftm,
        (s) => s.fta,
      ) * 100,
      55,
      85,
      '%',
    ),
    band(
      'Rebounds per team',
      mean((s) => s.rebounds),
      20,
      60,
    ),
    band('Offensive rebound share', offensiveShare(samples) * 100, 15, 45, '%'),
    band(
      'Turnovers per team',
      mean((s) => s.turnovers),
      6,
      30,
    ),
    band(
      'Personal fouls per team',
      mean((s) => s.fouls),
      4,
      30,
    ),
    band(
      'Steals per team',
      mean((s) => s.steals),
      2,
      18,
    ),
    band(
      'Blocks per team',
      mean((s) => s.blocks),
      0.5,
      12,
    ),
    // Neither side should have a structural edge: they play the same sport with the same rules.
    band('Home win rate', (wins / Math.max(1, MATCHES_PLAYED(samples))) * 100, 35, 65, '%'),
    // Zero, and it should be: a tie at the end of regulation goes to overtime, so this band is
    // really an assertion that overtime is reachable and terminates.
    band('Ties', (ties / Math.max(1, MATCHES_PLAYED(samples))) * 100, 0, 2, '%'),
  ];

  return { matches, bands, failures: bands.filter((b) => b.value < b.min || b.value > b.max) };
}

function MATCHES_PLAYED(samples: readonly Sample[]): number {
  return samples.length / 2;
}

/** `(FGM + 0.5 × 3PM) / FGA` — a three counted at what it is actually worth. */
function effectiveFieldGoal(samples: readonly Sample[]): number {
  const attempts = samples.reduce((sum, s) => sum + s.fga, 0);
  if (attempts === 0) return 0;
  const made = samples.reduce((sum, s) => sum + s.fgm, 0);
  const threes = samples.reduce((sum, s) => sum + s.threeM, 0);
  return (made + 0.5 * threes) / attempts;
}

function threeShare(samples: readonly Sample[]): number {
  const attempts = samples.reduce((sum, s) => sum + s.fga, 0);
  const threes = samples.reduce((sum, s) => sum + s.threeA, 0);
  return attempts === 0 ? 0 : threes / attempts;
}

function offensiveShare(samples: readonly Sample[]): number {
  const total = samples.reduce((sum, s) => sum + s.rebounds, 0);
  const offensive = samples.reduce((sum, s) => sum + s.offensiveRebounds, 0);
  return total === 0 ? 0 : offensive / total;
}

function band(label: string, value: number, min: number, max: number, unit = ''): BalanceBand {
  return { label, value, min, max, unit };
}

export function formatReport(report: BalanceReport): string {
  const lines = [`balance: ${report.matches} matches, ${report.matches * 2} team-games`];
  for (const b of report.bands) {
    const ok = b.value >= b.min && b.value <= b.max ? ' ' : '!';
    lines.push(
      `${ok} ${b.label.padEnd(30)} ${b.value.toFixed(1).padStart(6)}${b.unit}` +
        `   (${b.min}–${b.max}${b.unit})`,
    );
  }
  return lines.join('\n');
}

const isEntry = process.argv[1]?.endsWith('balance.ts') === true;
if (isEntry) {
  const report = runBalance();
  process.stdout.write(`${formatReport(report)}\n`);
  if (report.failures.length > 0) {
    process.stdout.write(`\n${report.failures.length} band(s) outside plausible basketball.\n`);
    process.exitCode = 1;
  }
}
