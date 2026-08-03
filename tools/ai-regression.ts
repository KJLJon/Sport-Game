/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.10 — AI regression harness: headless batches per difficulty per mode, asserted win-rate bands
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7 (the four levels, target win-rate bands), 12-quality-and-testing.md §5
 *
 * Purpose: plays every level against a fixed reference opponent, in both modes and both sports, and
 * reports whether the four levels still form a ladder. Fails the run if they do not.
 *
 * ## What a headless batch can and cannot assert
 *
 * `06` §7's bands are written about a *human*: "a new player should win ~80%+ on Rookie; an
 * experienced player should sit near 50% on All-Star and below 40% on Legend." No batch can measure
 * that, because there is no human in it — and pretending otherwise by nominating some CPU as
 * "a new player" would produce a number that looks like the spec's and means something else.
 *
 * What a batch *can* assert, and what this tool does assert, is the property those human bands
 * depend on: **that the four levels are genuinely different opponents, ordered, and spaced.** If
 * Legend does not beat Pro more often than All-Star does, no amount of playtesting will make the
 * human bands come out right, and a regression that flattens the ladder is exactly the kind that
 * lands silently. The human half is `12` §7's device matrix and T-7.11's feel work.
 *
 * **Pro is the reference**, for the same reason it is the anchor everywhere else in the sim: the
 * CPU was tuned at Pro by T-2.13 and T-6.18, so Pro is the level whose behaviour the balance bands
 * were measured against.
 *
 * **The measurement is paired.** Each match is played twice on the *same seed* with the *same
 * squads*, once with the level under test on side 0 and once on side 1, and the two are pooled. The
 * two runs then differ in exactly one thing — which side got which level — so home advantage and
 * the seed's own luck cancel rather than being averaged over. It also gives the tool a free
 * self-check: at the reference level both runs are literally the same match, so Pro must come back
 * at exactly 50% and a margin of exactly zero. Anything else is a bug in the harness.
 *
 * **Margin is the headline, not win rate.** A basketball match is 80 points a side and a soccer
 * match is two goals; whether one of them was won is a coin flip with a thumb on it, and a batch
 * small enough to run before a gate cannot see the thumb. The average points margin uses the whole
 * scoreline instead of one bit of it, and moves out of the noise an order of magnitude sooner.
 *
 * **Both sides field the same eleven — or the same five.** This is the difference between a harness
 * that measures difficulty and one that measures luck, and the first version of this tool got it
 * wrong: left to itself a match rolls anonymous ratings from its seed, *independently per side*, and
 * a random roster edge is worth more than a difficulty step. Two seed sets of the same size then
 * reported the same pairing at 36.7% and 81.3%. Mirroring the roster removes the whole of that
 * variance, because the only thing left that differs between the two sides is the level.
 *
 * Seeds are `ai-<sport>-<mode>-<level>-<n>`, so a failing band can be replayed exactly.
 */
import { EMPTY_FRAME } from '../src/engine/input/types.ts';
import { LiveMatch } from '../src/modes/live/match.ts';
import { simulatePlaybookMatch } from '../src/modes/playbook/match.ts';
import { DIFFICULTIES, type Difficulty } from '../src/modes/difficulty.ts';
import { basketball } from '../src/sports/basketball/index.ts';
import { soccer } from '../src/sports/soccer/index.ts';
import { BASKETBALL_RULES } from '../src/sports/basketball/rules.ts';
import { SOCCER_RULES } from '../src/sports/soccer/rules.ts';
import { basketballPlaybook } from '../src/sports/basketball/playbook/index.ts';
import { soccerPlaybook } from '../src/sports/soccer/playbook/index.ts';
import { basketballSquads } from '../src/sports/basketball/playbook/squad.ts';
import { soccerSquads } from '../src/sports/soccer/playbook/squad.ts';
import type { SportModule } from '../src/sports/types.ts';
import type { BasketballPlaybookState } from '../src/sports/basketball/playbook/resolution.ts';
import type { SoccerPlaybookState } from '../src/sports/soccer/playbook/resolution.ts';
import { five, eleven } from './regression-rosters.ts';

/** The level every other level is measured against. */
export const REFERENCE: Difficulty = 'pro';

/**
 * Matches per pairing, per mode. Doubled by the pairing's swap, so `12` is 24 matches a level.
 *
 * **Playbook gets six times the sample, because it costs a hundredth as much.** A Playbook match is
 * milliseconds and a Live one is seconds, and at 24 matches a level Playbook's win rates carry a
 * ±10-point standard error — enough that two consecutive runs of this tool reported findings against
 * Rookie that both vanished at 160. A regression harness whose default sample cannot distinguish a
 * regression from a coin flip is worse than no harness, because somebody will tune against it.
 * `AI_MATCHES` overrides both.
 */
const MATCHES: Readonly<Record<ModeId, number>> = {
  live: Number(process.env.AI_MATCHES ?? 12),
  playbook: Number(process.env.AI_MATCHES ?? 80),
};

export type ModeId = 'live' | 'playbook';

/** Every mode, unless `AI_MODE` names one. */
const MODES: readonly ModeId[] =
  process.env.AI_MODE === 'live'
    ? ['live']
    : process.env.AI_MODE === 'playbook'
      ? ['playbook']
      : ['live', 'playbook'];
export type SportId = 'basketball' | 'soccer';

export interface LadderRow {
  readonly sport: SportId;
  readonly mode: ModeId;
  readonly level: Difficulty;
  /** Matches played, both legs of every pair pooled. */
  readonly matches: number;
  /** Share of matches this level won against the reference, `0–1`. Draws count as a half. */
  readonly winRate: number;
  /**
   * Mean scoreline margin for this level against the reference, in points or goals. The number the
   * bands are actually judged on: it uses the whole scoreline rather than one bit of it.
   */
  readonly margin: number;
}

export interface LadderFinding {
  readonly label: string;
  readonly detail: string;
}

export interface AiRegressionReport {
  readonly matches: Readonly<Record<ModeId, number>>;
  readonly rows: readonly LadderRow[];
  readonly failures: readonly LadderFinding[];
}

/**
 * The spacing every sport-and-mode ladder has to show.
 *
 * Deliberately loose, and asymmetric about Pro. A batch of two dozen matches has a standard error
 * around 10 points, so a band tight enough to catch a small tuning drift would fail on noise
 * several times a week — and the regression this is protecting against is a level that has stopped
 * being a level, not one that moved three points.
 *
 * @spec-ref 06-game-design.md §7 — Rookie is comfortably winnable; Legend beats you more often than not
 */
export const LADDER_BANDS: Readonly<Record<Difficulty, { min: number; max: number }>> = {
  // Rookie has to lose to Pro clearly, or "comfortably winnable by a newcomer" cannot follow.
  rookie: { min: 0, max: 0.44 },
  // Pro against itself. Anything outside this is a symmetry bug, not a difficulty finding.
  pro: { min: 0.38, max: 0.62 },
  allStar: { min: 0.46, max: 0.82 },
  legend: { min: 0.5, max: 0.95 },
};

/** How much of a gap the ends of the ladder have to show, in win-rate points. */
export const LADDER_SPREAD = 0.08;

/**
 * How far Pro's own margin may sit from zero. It should be *exactly* zero: at the reference level
 * both legs of a pair are the same match with the sides named the other way round, so the two
 * margins are equal and opposite. Anything else means the pairing is not pairing.
 */
export const PAIRING_TOLERANCE = 1e-9;

interface Pairing {
  readonly level: Difficulty;
  /** Which side the level under test plays for this leg. */
  readonly side: 0 | 1;
  /** The same for both legs of a pair — that is what makes it a pair. */
  readonly seed: string;
}

function pairings(sport: SportId, mode: ModeId, level: Difficulty, matches: number): Pairing[] {
  const list: Pairing[] = [];
  for (let i = 0; i < matches; i += 1) {
    const seed = `ai-${sport}-${mode}-${level}-${i}`;
    for (const side of [0, 1] as const) list.push({ level, side, seed });
  }
  return list;
}

/** A win for the level under test is 1, a draw is a half, a loss is 0. */
function outcome(score: readonly [number, number], side: 0 | 1): number {
  const own = score[side];
  const theirs = score[side === 0 ? 1 : 0];
  return own > theirs ? 1 : own === theirs ? 0.5 : 0;
}

/** The level under test's scoreline margin. */
function margin(score: readonly [number, number], side: 0 | 1): number {
  return score[side] - score[side === 0 ? 1 : 0];
}

function levelsFor(pairing: Pairing): readonly [Difficulty, Difficulty] {
  return pairing.side === 0 ? [pairing.level, REFERENCE] : [REFERENCE, pairing.level];
}

function liveRow(
  module: SportModule,
  sport: SportId,
  level: Difficulty,
  matches: number,
): LadderRow {
  const list = pairings(sport, 'live', level, matches);
  let points = 0;
  let margins = 0;

  for (const pairing of list) {
    const squad = sport === 'basketball' ? five(pairing.seed) : eleven(pairing.seed);
    const match = new LiveMatch({
      seed: pairing.seed,
      sport: module,
      playerSide: -1,
      rosters: [squad, squad],
      difficulties: levelsFor(pairing),
    });
    match.setInput(EMPTY_FRAME);

    let guard = 0;
    while (!match.finished && guard++ < 400_000) match.step();

    const view = match.view();
    const score = [view.score[0], view.score[1]] as const;
    points += outcome(score, pairing.side);
    margins += margin(score, pairing.side);
  }

  return {
    sport,
    mode: 'live',
    level,
    matches: list.length,
    winRate: points / list.length,
    margin: margins / list.length,
  };
}

function playbookRow(sport: SportId, level: Difficulty, matches: number): LadderRow {
  const list = pairings(sport, 'playbook', level, matches);
  let points = 0;
  let margins = 0;

  for (const pairing of list) {
    // Each sport's adapter is generic over its own detail type, so the two branches cannot be
    // collapsed into one call without erasing the very thing that keeps them apart (INV-5).
    const score =
      sport === 'basketball'
        ? simulatePlaybookMatch<BasketballPlaybookState>({
            seed: pairing.seed,
            adapter: basketballPlaybook,
            sport,
            rules: BASKETBALL_RULES,
            squads: basketballSquads(five(`${pairing.seed}-home`), five(`${pairing.seed}-away`)),
            playerSide: -1,
            difficulties: levelsFor(pairing),
          }).state.score
        : simulatePlaybookMatch<SoccerPlaybookState>({
            seed: pairing.seed,
            adapter: soccerPlaybook,
            sport,
            rules: SOCCER_RULES,
            squads: soccerSquads(eleven(`${pairing.seed}-home`), eleven(`${pairing.seed}-away`)),
            playerSide: -1,
            difficulties: levelsFor(pairing),
          }).state.score;

    points += outcome([score[0], score[1]], pairing.side);
    margins += margin([score[0], score[1]], pairing.side);
  }

  return {
    sport,
    mode: 'playbook',
    level,
    matches: list.length,
    winRate: points / list.length,
    margin: margins / list.length,
  };
}

/** Every level, in every mode, against the reference. */
export function runAiRegression(
  matches: Readonly<Record<ModeId, number>> = MATCHES,
  /**
   * Which modes to run. Playbook is seconds and Live is minutes, so a session chasing a Playbook
   * number should not be paying for the Live half of the batch forty times over — `AI_MODE=playbook`
   * is how you take a sample big enough to tell a real finding from a 30-match coincidence.
   */
  modes: readonly ModeId[] = MODES,
): AiRegressionReport {
  const rows: LadderRow[] = [];

  for (const level of DIFFICULTIES) {
    if (modes.includes('live')) {
      rows.push(liveRow(basketball, 'basketball', level, matches.live));
      rows.push(liveRow(soccer, 'soccer', level, matches.live));
    }
    if (modes.includes('playbook')) {
      rows.push(playbookRow('basketball', level, matches.playbook));
      rows.push(playbookRow('soccer', level, matches.playbook));
    }
  }

  return { matches, rows, failures: judge(rows) };
}

/** What is wrong with a ladder, if anything. */
export function judge(rows: readonly LadderRow[]): LadderFinding[] {
  const failures: LadderFinding[] = [];

  for (const row of rows) {
    const band = LADDER_BANDS[row.level];
    if (row.winRate < band.min || row.winRate > band.max) {
      failures.push({
        label: `${row.sport} · ${row.mode} · ${row.level}`,
        detail: `${percent(row.winRate)} against ${REFERENCE}, band ${percent(band.min)}–${percent(band.max)}`,
      });
    }
  }

  // The ladder claim itself: the top of it has to beat the bottom of it by a visible margin, in
  // every sport and every mode. This is the assertion that a flattened difficulty model fails.
  const groups = new Map<string, LadderRow[]>();
  for (const row of rows) {
    const key = `${row.sport} · ${row.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const [key, group] of groups) {
    // The harness checking itself: at the reference level the two legs of every pair are the same
    // match, so the margins cancel exactly. A non-zero number here is a finding about the tool.
    const reference = group.find((row) => row.level === REFERENCE);
    if (reference !== undefined && Math.abs(reference.margin) > PAIRING_TOLERANCE) {
      failures.push({
        label: `${key} · pairing`,
        detail:
          `${REFERENCE} against itself came back at ${reference.margin.toFixed(3)} rather than 0; ` +
          `the two legs of a pair are not the same match`,
      });
    }

    const rookie = group.find((row) => row.level === 'rookie');
    const legend = group.find((row) => row.level === 'legend');
    if (rookie === undefined || legend === undefined) continue;

    // Direction, on the margin: the low-variance measure, and the one that catches an inverted
    // ladder in a batch small enough to run before a gate.
    if (legend.margin <= rookie.margin) {
      failures.push({
        label: `${key} · ladder`,
        detail:
          `legend's margin ${legend.margin.toFixed(2)} is not above rookie's ` +
          `${rookie.margin.toFixed(2)}; the ladder runs the wrong way`,
      });
    }

    const spread = legend.winRate - rookie.winRate;
    if (spread < LADDER_SPREAD) {
      failures.push({
        label: `${key} · spread`,
        detail:
          `legend ${percent(legend.winRate)} is only ${percent(spread)} above rookie ` +
          `${percent(rookie.winRate)}; the four levels are not four opponents`,
      });
    }
  }

  return failures;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatReport(report: AiRegressionReport): string {
  const lines = [
    `AI ladder, against ${REFERENCE}: ${report.matches.live * 2} matches a level in Live, ` +
      `${report.matches.playbook * 2} in Playbook`,
    '',
  ];

  let heading = '';
  for (const row of report.rows.slice().sort(sortRows)) {
    const key = `${row.sport} · ${row.mode}`;
    if (key !== heading) {
      heading = key;
      lines.push(`  ${key}`);
    }
    const band = LADDER_BANDS[row.level];
    const ok = row.winRate >= band.min && row.winRate <= band.max ? ' ' : '!';
    const signed = `${row.margin >= 0 ? '+' : ''}${row.margin.toFixed(2)}`;
    lines.push(
      `${ok}   ${row.level.padEnd(9)} ${percent(row.winRate).padStart(6)}` +
        `   (${percent(band.min)}–${percent(band.max)})   margin ${signed.padStart(6)}`,
    );
  }

  return lines.join('\n');
}

function sortRows(a: LadderRow, b: LadderRow): number {
  return (
    a.sport.localeCompare(b.sport) ||
    a.mode.localeCompare(b.mode) ||
    DIFFICULTIES.indexOf(a.level) - DIFFICULTIES.indexOf(b.level)
  );
}

const isEntry = process.argv[1]?.endsWith('ai-regression.ts') === true;
if (isEntry) {
  const report = runAiRegression();
  process.stdout.write(`${formatReport(report)}\n`);
  if (report.failures.length > 0) {
    process.stdout.write('\n');
    for (const failure of report.failures) {
      process.stdout.write(`! ${failure.label}: ${failure.detail}\n`);
    }
    process.stdout.write(`\n${report.failures.length} ladder finding(s).\n`);
    process.exitCode = 1;
  }
}
