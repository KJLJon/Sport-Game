/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.3 — Narration + animated court-diagram renderer for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1 (a one-line narration, not a wall of text),
 *          10-ui-ux.md §8.4 (turn screen)
 * @invariant INV-2 (seeded PRNG only)
 *
 * Purpose: one line per turn. `09` §2.1 is explicit that the diagram carries what happened and the
 * text carries only *how it felt*, so every line here is short enough to read without stopping and
 * names the athlete it is about.
 *
 * **Variety is seeded, not random.** A line is chosen by a hash of the turn number and the outcome,
 * so a replay of a match says the same things in the same order — a narration that re-rolled would
 * make two viewings of one replay disagree about what was said, which is a small thing that reads
 * as a bug (INV-2, INV-8).
 *
 * **Tone is not colour.** `NarrationTone` drives emphasis and the diagram's accent, and every line
 * says in words what it is: "buries it", "no good". Nothing here relies on the reader seeing green
 * (`10` §11).
 */
import type {
  NarrationLine,
  NarrationTone,
  PlaybookAthlete,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import type { BasketballPlaybookState } from './resolution.ts';

/** Templates per outcome. `{a}` is the athlete the turn was about, `{d}` the defender. */
const LINES: Readonly<Record<string, readonly string[]>> = {
  'made-three': ['{a} buries it from deep.', '{a} lets it fly — got it.', 'Three for {a}.'],
  'made-two': ['{a} scores.', '{a} finishes it.', '{a} gets it to drop.'],
  'and-one': ['{a} scores through the contact.', 'And one — {d} could not get out of the way.'],
  'broken-press-layup': [
    'The press breaks and {a} walks it in.',
    '{a} beats the press for the easy two.',
  ],
  'missed-three': ['{a} misses from three.', "{a}'s three is long.", 'No good from {a}.'],
  'missed-two': [
    '{a} misses.',
    "{d} contests and {a}'s shot is off.",
    '{a} cannot get it to fall.',
  ],
  'free-throws': ['{a} goes to the line and scores.', '{d} fouls; {a} makes them count.'],
  'missed-free-throws': ['{a} goes to the line and comes away empty.'],
  stolen: ['{d} picks it off {a}.', '{d} reads it and takes it away.'],
  turnover: ['The set breaks down and it is lost.', 'Nobody was where they should have been.'],
};

const FALLBACK = ['{a} works the possession.'];

const TONES: Readonly<Record<string, NarrationTone>> = {
  'made-three': 'big',
  'made-two': 'good',
  'and-one': 'big',
  'broken-press-layup': 'good',
  'missed-three': 'bad',
  'missed-two': 'bad',
  'free-throws': 'good',
  'missed-free-throws': 'bad',
  stolen: 'bad',
  turnover: 'bad',
};

/** Family name where there is one, so a line reads like commentary rather than like a database. */
export function shortName(athlete: PlaybookAthlete | undefined): string {
  if (athlete === undefined) return 'the ball-handler';
  const parts = athlete.athlete.displayName.trim().split(/\s+/);
  return parts.length > 1 ? (parts.at(-1) as string) : (parts[0] ?? 'the ball-handler');
}

/**
 * Stable pick: the same turn always reads the same way. A hash rather than a draw, so narration
 * consumes nothing from the match's own generator and cannot shift a resolution by existing.
 */
export function pickLine(options: readonly string[], turn: number, outcome: string): string {
  if (options.length === 0) return FALLBACK[0] as string;
  let hash = turn * 2654435761;
  for (let i = 0; i < outcome.length; i += 1) hash = (hash ^ outcome.charCodeAt(i)) * 16777619;
  return options[Math.abs(hash) % options.length] as string;
}

function find(
  state: PlaybookState<BasketballPlaybookState>,
  id: number | undefined,
): PlaybookAthlete | undefined {
  if (id === undefined) return undefined;
  for (const squad of state.squads) {
    const found = squad.players.find((player) => player.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function narrateTurn(
  state: PlaybookState<BasketballPlaybookState>,
  resolution: TurnResolution,
): NarrationLine {
  const template = pickLine(
    LINES[resolution.outcome] ?? FALLBACK,
    resolution.turn,
    resolution.outcome,
  );

  const text = template
    .replace('{a}', shortName(find(state, resolution.actor)))
    .replace('{d}', shortName(find(state, resolution.target)));

  return { text, tone: TONES[resolution.outcome] ?? 'neutral' };
}

/** Every outcome the resolution model produces has a line, and the test asserts exactly that. */
export const NARRATED_OUTCOMES = Object.keys(LINES);
