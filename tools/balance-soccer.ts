/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.18 — Balance pass #2: goals, possession, conversion across Live and Playbook
 * @story   US-4.1 — Play a match that feels like the sport
 * @design  06-game-design.md §3.2 (soccer), 12-quality-and-testing.md §5 (balance verification)
 *
 * Purpose: plays soccer matches with nobody watching and reports whether the numbers that come out
 * look like soccer. Fails the run if they do not. `tools/balance.ts` is the same tool for
 * basketball, and this is the row `PROGRESS.md` has been logging as missing since T-6.14.
 *
 * **Both modes, in one report, because that is the question `03`'s row actually asks.** "Goals,
 * possession, conversion across Live *and* Playbook" is not two measurements — it is one, and the
 * interesting number is whether they agree. INV-11 asserts the two modes rank rosters the same way;
 * this says whether they produce the same *kind of match*, which is a different and weaker claim
 * that is nonetheless the one a player notices first.
 *
 * **Everything is read off the event stream, not off a box score.** `modes/live/box-score.ts` is
 * basketball-shaped — field goals, rebounds, free throws — and teaching it soccer is Phase 9's HUD
 * work, not this tool's. The `SportEvent` stream is the one thing both modes emit identically
 * (INV-9), so counting goals and shots off it works for Live and Playbook with the same code and
 * cannot drift from what the rest of the game sees.
 *
 * Seeds are `soccer-balance-0`, `-1`, … rather than drawn, so a failing band can be investigated by
 * replaying the exact match that produced it.
 */
import { EventKind, type SportEvent } from '../src/engine/match/events.ts';
import { EMPTY_FRAME } from '../src/engine/input/types.ts';
import { LiveMatch } from '../src/modes/live/match.ts';
import { simulatePlaybookMatch } from '../src/modes/playbook/match.ts';
import { soccer } from '../src/sports/soccer/index.ts';
import { SOCCER_RULES } from '../src/sports/soccer/rules.ts';
import { soccerPlaybook } from '../src/sports/soccer/playbook/index.ts';
import { soccerSquads } from '../src/sports/soccer/playbook/squad.ts';
import type { SoccerPlaybookState } from '../src/sports/soccer/playbook/resolution.ts';
import { createRng, type Rng } from '../src/engine/rng.ts';
import { STARTING_FAMILIARITY, newSportSkill, type Athlete } from '../src/athletes/types.ts';
import { drawAttributes } from './playbook-rosters.ts';

/** Matches per mode. Live is the expensive one, so this is well below basketball's five hundred. */
const MATCHES = Number(process.env.BALANCE_MATCHES ?? 40);

export interface BalanceBand {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
}

export interface SoccerBalanceReport {
  readonly matches: number;
  readonly live: ModeSample;
  readonly playbook: ModeSample;
  readonly bands: readonly BalanceBand[];
  readonly failures: readonly BalanceBand[];
}

/** What one mode's batch came out at, per match unless stated. */
export interface ModeSample {
  readonly goals: number;
  readonly shots: number;
  readonly onTarget: number;
  readonly saves: number;
  readonly fouls: number;
  /** Goals per shot, `0–1`. */
  readonly conversion: number;
  /** Share of shots that were on target, `0–1`. */
  readonly accuracy: number;
  /** Share of matches the home side won. */
  readonly homeWinShare: number;
  readonly drawShare: number;
}

function count(events: readonly SportEvent[], kind: string): number {
  return events.filter((entry) => entry.kind === kind).length;
}

/**
 * An eleven of ordinary professionals, so a batch measures the model rather than a roster.
 *
 * Written here rather than reusing `playbook-rosters.ts`'s `roster()`, which builds *basketball*
 * bodies — eight of its eleven would be 205 cm, and soccer's physical modifiers read height into
 * heading, goalkeeping, dribbling, and pace. A balance run on that squad would be measuring a team
 * of centre-backs.
 */
function eleven(seed: string): Athlete[] {
  const rng: Rng = createRng(seed).fork('soccer-eleven');
  return Array.from({ length: 11 }, (_, index) => ({
    id: `${seed}-${index}`,
    schemaVersion: 1,
    displayName: `${seed} ${index + 1}`,
    // A keeper and a couple of centre-backs are tall; the rest are ordinary outfield heights.
    heightCm: index === 0 || index === 3 || index === 4 ? 188 + rng.int(0, 6) : 175 + rng.int(0, 9),
    weightKg: 70 + rng.int(0, 12),
    handedness: 'right' as const,
    age: 22 + rng.int(0, 10),
    primarySport: 'soccer',
    attributes: drawAttributes(rng, 60),
    sportSkills: { soccer: newSportSkill(STARTING_FAMILIARITY.primary) },
    rarity: 'common' as const,
    traits: [],
    condition: { stamina: 100 },
    source: 'created' as const,
    sandbox: false,
    custodyId: `${seed}-custody-${index}`,
    createdAt: 0,
    editable: true,
  }));
}

function summarise(
  batches: readonly { events: readonly SportEvent[]; score: readonly [number, number] }[],
): ModeSample {
  const per = (value: number): number => value / batches.length;
  const total = (pick: (b: (typeof batches)[number]) => number): number =>
    batches.reduce((sum, batch) => sum + pick(batch), 0);

  const shots = total((b) => count(b.events, EventKind.SHOT));
  // **Goals come from the score, not from `EventKind.SCORE`.** In Playbook the sport returns
  // `points` on the resolution and the *match engine* emits the score event, so a turn's own event
  // array never contains one — counting events here reported 0.00 goals a match against a scoreline
  // that plainly had some. The score is what both modes agree on.
  const goals = total((b) => b.score[0] + b.score[1]);
  const onTarget = total(
    (b) =>
      b.events.filter(
        (entry) => entry.kind === EventKind.SHOT && entry.detail?.['onTarget'] === true,
      ).length,
  );
  const saves = total((b) => count(b.events, EventKind.SAVE));

  return {
    goals: per(goals),
    shots: per(shots),
    // A save is the observable proxy for "on target" wherever the shot event does not say so
    // itself: Live's shot events carry `openness` rather than an on-target flag.
    onTarget: per(onTarget === 0 ? goals + saves : onTarget),
    saves: per(saves),
    fouls: per(total((b) => count(b.events, EventKind.FOUL))),
    conversion: shots === 0 ? 0 : goals / shots,
    accuracy: shots === 0 ? 0 : (onTarget === 0 ? goals + saves : onTarget) / shots,
    homeWinShare: per(batches.filter((b) => b.score[0] > b.score[1]).length),
    drawShare: per(batches.filter((b) => b.score[0] === b.score[1]).length),
  };
}

function liveBatch(matches: number): ModeSample {
  const batches = [];
  for (let i = 0; i < matches; i += 1) {
    // Constructed rather than `simulateMatch`ed, because the events have to be collected off the bus
    // *before* the match runs and `LiveMatch` keeps no log of its own.
    const match = new LiveMatch({ seed: `soccer-balance-${i}`, sport: soccer, playerSide: -1 });
    const events: SportEvent[] = [];
    match.bus.on((entry) => events.push(entry));
    match.setInput(EMPTY_FRAME);

    let guard = 0;
    while (!match.finished && guard++ < 400_000) match.step();

    const view = match.view();
    batches.push({ events, score: [view.score[0], view.score[1]] as const });
  }
  return summarise(batches);
}

function playbookBatch(matches: number): ModeSample {
  const batches = [];
  for (let i = 0; i < matches; i += 1) {
    const match = simulatePlaybookMatch<SoccerPlaybookState>({
      seed: `soccer-balance-${i}`,
      adapter: soccerPlaybook,
      sport: 'soccer',
      rules: SOCCER_RULES,
      squads: soccerSquads(eleven(`home-${i}`), eleven(`away-${i}`)),
      playerSide: -1,
    });
    const events = match.turns.flatMap((turn) => turn.events);
    batches.push({
      events,
      score: [match.state.score[0], match.state.score[1]] as const,
    });
  }
  return summarise(batches);
}

function band(label: string, value: number, min: number, max: number, unit = ''): BalanceBand {
  return { label, value, min, max, unit };
}

/**
 * The bands.
 *
 * Real soccer runs about 2.7 goals a match on 25 shots, a third of them on target, so roughly an
 * 11% conversion rate. The bands below are wide around that, because a game is not a simulation of
 * a spreadsheet and `06` §3.2 asks for something that *feels* like soccer rather than something that
 * reproduces a season's averages. The two ends are what matter: a 0.5-goal match is boring and a
 * 6-goal match is not soccer.
 *
 * @spec-ref 06-game-design.md §3.2
 */
export function runSoccerBalance(matches: number = MATCHES): SoccerBalanceReport {
  const live = liveBatch(matches);
  const playbook = playbookBatch(matches);

  const bands: BalanceBand[] = [
    band('Live · goals per match', live.goals, 1.2, 5.5),
    band('Live · shots per match', live.shots, 8, 45),
    band('Live · conversion', live.conversion * 100, 4, 30, '%'),
    band('Playbook · goals per match', playbook.goals, 1.2, 5.5),
    band('Playbook · shots per match', playbook.shots, 5, 40),
    band('Playbook · conversion', playbook.conversion * 100, 4, 30, '%'),

    // The cross-mode claim, and the reason both batches run in one tool. Not INV-11 — that is about
    // *who wins* and is asserted in `tests/invariants/` — but a mode that produced twice the goals
    // of the other would make the same roster feel like a different team.
    band('Goals: Live ÷ Playbook', ratio(live.goals, playbook.goals), 0.55, 1.8, '×'),

    // Neither side should have a structural edge: they play the same laws in the same directions.
    band('Live · home win share', live.homeWinShare * 100, 30, 70, '%'),
    band('Playbook · home win share', playbook.homeWinShare * 100, 30, 70, '%'),

    // A soccer model with no draws is not modelling soccer. The engine allows them after
    // `maxOvertimePeriods` (T-6.17), and regulation batches should produce them freely.
    band('Live · draw share', live.drawShare * 100, 5, 55, '%'),
  ];

  return {
    matches,
    live,
    playbook,
    bands,
    failures: bands.filter((entry) => entry.value < entry.min || entry.value > entry.max),
  };
}

function ratio(a: number, b: number): number {
  return b === 0 ? (a === 0 ? 1 : Infinity) : a / b;
}

export function formatReport(report: SoccerBalanceReport): string {
  const lines = [`soccer balance: ${report.matches} matches per mode`];
  for (const entry of report.bands) {
    const ok = entry.value >= entry.min && entry.value <= entry.max ? ' ' : '!';
    lines.push(
      `${ok} ${entry.label.padEnd(30)} ${entry.value.toFixed(2)}${entry.unit ?? ''}` +
        `  (${entry.min}–${entry.max}${entry.unit ?? ''})`,
    );
  }
  return lines.join('\n');
}

const isEntry = process.argv[1]?.endsWith('balance-soccer.ts') === true;
if (isEntry) {
  const report = runSoccerBalance();
  process.stdout.write(`${formatReport(report)}\n`);
  if (report.failures.length > 0) {
    process.stdout.write(`\n${report.failures.length} band(s) outside plausible soccer.\n`);
    process.exitCode = 1;
  }
}
