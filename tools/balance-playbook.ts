/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §7 (balance across modes), 12-quality-and-testing.md §5
 * @invariant INV-11 (cross-mode outcome parity)
 *
 * Purpose: `pnpm balance:playbook` — the Playbook twin of `pnpm balance`. Plays a batch of
 * CPU-vs-CPU Playbook matches and reports whether the numbers coming out of the resolution model
 * look like basketball, in the same bands the Live harness uses.
 *
 * **Why the same bands.** `09` §7 asks that the two modes agree; a Playbook run judged against its
 * own, looser bands would let the two drift apart while both reported green. The bands are Live's,
 * so a Playbook number outside them is outside basketball, and a Playbook number *inside* them that
 * sits at the far end from Live's is the early warning INV-11's test turns into a failure.
 *
 * **Why a tool and not a test.** Same reason as `tools/balance.ts`: a batch of matches is seconds
 * of CPU, and a suite that takes minutes is a suite people stop running. This is a gate you run
 * deliberately — at a phase gate, or after touching a number in `RESOLUTION` or `calls.ts`.
 */
import {
  applyEvent,
  createBoxScore,
  teamLine,
  type TeamLine,
} from '../src/modes/live/box-score.ts';
import {
  basketballSquads,
  createBasketballPlaybook,
} from '../src/sports/basketball/playbook/index.ts';
import { evenRosters } from './playbook-rosters.ts';

const MATCHES = Number(process.env.BALANCE_MATCHES ?? 120);

export interface PlaybookBand {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
}

export interface PlaybookBalanceReport {
  readonly matches: number;
  readonly bands: readonly PlaybookBand[];
  readonly failures: readonly PlaybookBand[];
}

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
  };
}

/** One CPU-vs-CPU match, folded into a box score off the event stream — exactly as Live does it. */
export function playOne(seed: string): { home: Sample; away: Sample; turns: number } {
  const [home, away] = evenRosters(seed);
  const match = createBasketballPlaybook({
    seed,
    squads: basketballSquads(home, away),
    playerSide: -1,
    keyMoments: 'off',
  });

  let guard = 0;
  while (!match.finished && guard < 600) {
    for (const side of [0, 1] as const) {
      const call = match.autoCall(side);
      if (call !== null) match.submit(call);
    }
    match.resolve();
    match.advance();
    guard += 1;
  }

  const box = createBoxScore();
  for (const entry of match.events) applyEvent(box, entry);

  return {
    home: sample(teamLine(box, 0)),
    away: sample(teamLine(box, 1)),
    turns: match.turns.length,
  };
}

export function runPlaybookBalance(matches: number = MATCHES): PlaybookBalanceReport {
  const samples: Sample[] = [];
  let turns = 0;
  let wins = 0;
  let ties = 0;

  for (let i = 0; i < matches; i += 1) {
    const result = playOne(`playbook-balance-${i}`);
    samples.push(result.home, result.away);
    turns += result.turns;
    if (result.home.points > result.away.points) wins += 1;
    else if (result.home.points === result.away.points) ties += 1;
  }

  const mean = (pick: (s: Sample) => number): number =>
    samples.reduce((sum, s) => sum + pick(s), 0) / samples.length;
  const rate = (made: (s: Sample) => number, attempted: (s: Sample) => number): number => {
    const total = samples.reduce((sum, s) => sum + attempted(s), 0);
    return total === 0 ? 0 : samples.reduce((sum, s) => sum + made(s), 0) / total;
  };
  const share = (part: (s: Sample) => number, whole: (s: Sample) => number): number => {
    const total = samples.reduce((sum, s) => sum + whole(s), 0);
    return total === 0 ? 0 : samples.reduce((sum, s) => sum + part(s), 0) / total;
  };

  const bands: PlaybookBand[] = [
    // Both sides get a turn per possession, so a match is about twice the possessions per team.
    band('Possessions per team', turns / matches / 2, 80, 130),
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
    band(
      'Three-point share of attempts',
      share(
        (s) => s.threeA,
        (s) => s.fga,
      ) * 100,
      8,
      55,
      '%',
    ),
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
    band(
      'Offensive rebound share',
      share(
        (s) => s.offensiveRebounds,
        (s) => s.rebounds,
      ) * 100,
      15,
      45,
      '%',
    ),
    band(
      'Assists per team',
      mean((s) => s.assists),
      10,
      35,
    ),
    band(
      'Turnovers per team',
      mean((s) => s.turnovers),
      6,
      30,
    ),
    // Nobody has a structural edge: the opening possession is a coin toss and nothing else differs.
    band('Home win rate', (wins / matches) * 100, 35, 65, '%'),
    band('Ties', (ties / matches) * 100, 0, 2, '%'),
  ];

  return { matches, bands, failures: bands.filter((b) => b.value < b.min || b.value > b.max) };
}

function effectiveFieldGoal(samples: readonly Sample[]): number {
  const attempts = samples.reduce((sum, s) => sum + s.fga, 0);
  if (attempts === 0) return 0;
  const made = samples.reduce((sum, s) => sum + s.fgm, 0);
  const threes = samples.reduce((sum, s) => sum + s.threeM, 0);
  return (made + 0.5 * threes) / attempts;
}

function band(label: string, value: number, min: number, max: number, unit = ''): PlaybookBand {
  return { label, value, min, max, unit };
}

export function formatReport(report: PlaybookBalanceReport): string {
  const lines = [`playbook balance: ${report.matches} matches, ${report.matches * 2} team-games`];
  for (const b of report.bands) {
    const ok = b.value >= b.min && b.value <= b.max ? ' ' : '!';
    lines.push(
      `${ok} ${b.label.padEnd(30)} ${b.value.toFixed(1).padStart(6)}${b.unit}` +
        `   (${b.min}–${b.max}${b.unit})`,
    );
  }
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('balance-playbook.ts') === true) {
  const report = runPlaybookBalance();
  process.stdout.write(`${formatReport(report)}\n`);
  if (report.failures.length > 0) {
    process.stdout.write(`\n${report.failures.length} band(s) outside plausible basketball.\n`);
    process.exitCode = 1;
  }
}
