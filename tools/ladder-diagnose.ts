/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.11 — Balance pass #3: tune all four levels against the target win-rate curve
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7
 *
 * Purpose: a scratch instrument for T-7.11 — plays each level against Pro and reports *what the
 * level did*, not only whether it won. The ladder harness says Live runs backwards; this says which
 * of the four channels is doing it.
 *
 * Kept in the repo because the next balance pass will want it too, and reconstructing it is a
 * half-hour of remembering how the event stream names things.
 */
import { EMPTY_FRAME } from '../src/engine/input/types.ts';
import { EventKind, type SportEvent } from '../src/engine/match/events.ts';
import { LiveMatch } from '../src/modes/live/match.ts';
import { DIFFICULTIES, type Difficulty } from '../src/modes/difficulty.ts';
import { basketball } from '../src/sports/basketball/index.ts';
import { soccer } from '../src/sports/soccer/index.ts';
import type { SportModule } from '../src/sports/types.ts';
import { five, eleven } from './regression-rosters.ts';

const MATCHES = Number(process.env.DIAG_MATCHES ?? 8);
const REFERENCE: Difficulty = 'pro';

interface Tally {
  points: number;
  shots: number;
  fouls: number;
  turnovers: number;
  wins: number;
  matches: number;
}

function blank(): Tally {
  return { points: 0, shots: 0, fouls: 0, turnovers: 0, wins: 0, matches: 0 };
}

/** Which side an event belongs to, or `null` when it names nobody. */
function sideOf(event: SportEvent): 0 | 1 | null {
  const side = event.side;
  return side === 0 || side === 1 ? side : null;
}

function run(module: SportModule, label: string): void {
  process.stdout.write(`\n${label} — ${MATCHES * 2} matches per level, against ${REFERENCE}\n`);
  process.stdout.write(
    `  ${'level'.padEnd(9)} ${'win'.padStart(6)} ${'pts'.padStart(7)} ${'shots'.padStart(7)} ` +
      `${'fouls'.padStart(7)} ${'TO'.padStart(7)}\n`,
  );

  for (const level of DIFFICULTIES) {
    const mine = blank();
    const theirs = blank();

    for (let i = 0; i < MATCHES; i += 1) {
      for (const side of [0, 1] as const) {
        // Paired, like `ai-regression.ts`: both legs share a seed and differ only in which side
        // got which level, so what is left in the difference is the level.
        const seed = `diag-${label}-${level}-${i}`;
        // The same squad on both sides, for the reason `ai-regression.ts` explains at length: a
        // random roster edge is worth more than a difficulty step.
        const squad = label === 'basketball' ? five(seed) : eleven(seed);
        const match = new LiveMatch({
          seed,
          sport: module,
          playerSide: -1,
          rosters: [squad, squad],
          difficulties: side === 0 ? [level, REFERENCE] : [REFERENCE, level],
        });
        const events: SportEvent[] = [];
        match.bus.on((event) => events.push(event));
        match.setInput(EMPTY_FRAME);

        let guard = 0;
        while (!match.finished && guard++ < 400_000) match.step();

        const view = match.view();
        const other = side === 0 ? 1 : 0;
        mine.points += view.score[side];
        theirs.points += view.score[other];
        mine.matches += 1;
        theirs.matches += 1;
        if (view.score[side] > view.score[other]) mine.wins += 1;
        else if (view.score[side] === view.score[other]) mine.wins += 0.5;

        for (const event of events) {
          const owner = sideOf(event);
          if (owner === null) continue;
          const tally = owner === side ? mine : theirs;
          if (event.kind === EventKind.SHOT) tally.shots += 1;
          else if (event.kind === EventKind.FOUL) tally.fouls += 1;
          else if (event.kind === EventKind.TURNOVER) tally.turnovers += 1;
        }
      }
    }

    const per = (value: number): string => (value / mine.matches).toFixed(1).padStart(7);
    process.stdout.write(
      `  ${level.padEnd(9)} ${((mine.wins / mine.matches) * 100).toFixed(1).padStart(5)}% ` +
        `${per(mine.points)} ${per(mine.shots)} ${per(mine.fouls)} ${per(mine.turnovers)}\n`,
    );
  }
}

const isEntry = process.argv[1]?.endsWith('ladder-diagnose.ts') === true;
if (isEntry) {
  const only = process.env.DIAG_SPORT;
  if (only !== 'soccer') run(basketball, 'basketball');
  if (only !== 'basketball') run(soccer, 'soccer');
}
