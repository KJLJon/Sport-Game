/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @story   US-15.2 — Call plays and see them resolve
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1 (one line of narration, not a wall of text),
 *          10-ui-ux.md §8.4 (turn screen), §11 (never colour alone)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the one line the turn screen shows for a soccer phase turn.
 *
 * **T-6.14 settled the shape; T-6.21 filled it in.** What T-6.14 left was one line per outcome, so
 * a match of twenty-two turns said the same eight sentences over and over. The variants here are
 * picked by the shared seeded hash (`modes/playbook/narration.ts`), so a replay of a match says the
 * same things in the same order and narration draws nothing from the match's own generator.
 *
 * **The lines know what the turn knows.** A phase turn is not just an outcome — the events carry
 * how the ball was moved (a cross is not a through ball), how far the shot was, what it was worth,
 * and whether the actor was being followed by a defender all turn. `turn-facts.ts` reads that back,
 * and the templates below use it: "picks out a cross" only appears when the model actually played
 * one, and a thirty-yard strike is never described as a tap-in. That is what separates variety from
 * a bigger list of synonyms.
 *
 * **Tone is not colour** (`10` §11). `NarrationTone` drives emphasis, and every line says in words
 * what happened: "scores", "wide", "the keeper holds it". Nothing here needs the reader to see
 * green.
 */
import type {
  NarrationLine,
  NarrationTone,
  PlaybookAthlete,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { fill, pickLine, shortName } from '../../../modes/playbook/narration.ts';
import type { PassKind } from '../passing.ts';
import { phaseName, type SoccerPhase } from './phases.ts';
import type { SoccerPlaybookState } from './resolution.ts';
import { keyShot, turnFacts, type TurnFacts } from './turn-facts.ts';

/** How each outcome reads. `big` is reserved for the ball hitting the net. */
const TONES: Readonly<Record<string, NarrationTone>> = {
  goal: 'big',
  chance: 'good',
  advance: 'neutral',
  corner: 'good',
  saved: 'neutral',
  'off-target': 'neutral',
  blocked: 'neutral',
  lost: 'bad',
};

/**
 * The templates.
 *
 * `{a}` is the athlete the turn was about, `{d}` the defender or keeper who met them, `{p}` the
 * ball that was played, and `{r}` the range a shot was struck from. Keys are `outcome` for most
 * outcomes and `outcome/phase` where the same word means two different things — an advance out of
 * the back is not an advance into the final third, and a set-piece goal is not an open-play one.
 *
 * @spec-ref 09-modes-and-arcade.md §2.1 — "one line of narration, not a wall of text"
 */
const LINES: Readonly<Record<string, readonly string[]>> = {
  'advance/buildUp': [
    '{a} plays out of the back.',
    '{a} finds the pass through the first line.',
    'Patient from the back, and {a} breaks the press.',
    '{a} steps out with it and {p} finds a runner.',
  ],
  'advance/progression': [
    '{a} carries it into the final third.',
    '{a} turns and drives at them.',
    '{p} from {a}, and they are through the middle.',
    '{a} slips past {d} and the shape opens up.',
  ],
  advance: ['{a} moves it forward.', '{a} keeps them moving with {p}.'],

  chance: [
    '{a} works an opening.',
    '{p} from {a} — that is a chance.',
    '{a} beats {d} and the goal is in sight.',
    '{a} picks the moment and the box opens up.',
  ],

  corner: [
    '{a} wins a corner.',
    'Deflected behind off {d} — corner to come.',
    '{a} forces it wide of the post and it is a corner.',
  ],

  goal: [
    '{a} scores!',
    '{a} buries it from {r}!',
    '{a} beats {d} — it is in!',
    'Nothing {d} could do about that. {a} scores!',
  ],
  'goal/setPiece': [
    '{a} scores from the set piece!',
    'Straight off the training ground — {a} finishes it!',
    '{a} rises above {d} and it is in!',
  ],

  saved: [
    '{d} gets down to {a}’s shot.',
    '{a} strikes it from {r} and {d} holds it.',
    'Good save from {d}, and {a} cannot believe it.',
    '{d} palms {a} away.',
  ],

  'off-target': [
    '{a} drags it wide from {r}.',
    '{a} gets the shot away and it is over the bar.',
    'Rushed by {d}, and {a} puts it wide.',
    '{a} leans back on it and it clears the crossbar.',
  ],

  blocked: [
    '{a}’s shot is blocked on its way through.',
    '{d} throws a body in front of {a}.',
    'Bodies in the way, and {a} cannot get it through.',
  ],

  lost: [
    '{d} wins it back off {a}.',
    '{a} is dispossessed by {d}.',
    '{a} takes a touch too many and {d} is in.',
    '{a} gives it away trying {p}.',
  ],
  'lost/buildUp': [
    '{d} presses {a} into a mistake at the back.',
    'Caught playing out — {d} takes it off {a}.',
  ],
};

/** What a pass was, in a phrase a line can be built around. */
const PASS_WORDS: Readonly<Record<PassKind, string>> = {
  short: 'a one-two',
  through: 'a ball in behind',
  lofted: 'a ball over the top',
  cross: 'a cross',
};

/** Bands for `{r}`. Metres, from goal — a shot's own distance, not a guess at it. */
const RANGES: readonly (readonly [number, string])[] = [
  [7, 'point-blank range'],
  [13, 'inside the six'],
  [20, 'the edge of the box'],
  [30, 'distance'],
];

function rangeWord(distance: number): string {
  for (const [limit, word] of RANGES) if (distance <= limit) return word;
  return 'a long way out';
}

function athlete(
  state: PlaybookState<SoccerPlaybookState>,
  id: number | undefined,
): PlaybookAthlete | undefined {
  if (id === undefined) return undefined;
  for (const squad of state.squads) {
    const found = squad.players.find((player: PlaybookAthlete) => player.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The template set for a turn: the phase-specific list where one exists, the outcome's own list
 * otherwise. Falling through to the plain outcome rather than merging the two keeps a specific line
 * from being diluted by a generic one on the turns it was written for.
 */
export function templatesFor(outcome: string, phase: SoccerPhase): readonly string[] {
  return LINES[`${outcome}/${phase}`] ?? LINES[outcome] ?? [];
}

export function narrateTurn(
  state: PlaybookState<SoccerPlaybookState>,
  resolution: TurnResolution,
): NarrationLine {
  const facts = turnFacts(resolution);
  const options = templatesFor(resolution.outcome, facts.phase);
  const tone = TONES[resolution.outcome] ?? 'neutral';

  if (options.length === 0) {
    // A phase name is a poor line and a much better one than an outcome id the player never chose
    // to see. Unreachable while `TURN_OUTCOMES` and `LINES` agree, which a test checks.
    return {
      text: `${phaseName(facts.phase, true)}: ${name(state, resolution.actor)} against ${name(state, resolution.target)}.`,
      tone,
    };
  }

  const template = pickLine(options, resolution.turn, `${resolution.outcome}/${facts.phase}`);
  const shot = keyShot(facts);

  return {
    text: fill(template, {
      a: name(state, resolution.actor),
      d: name(state, resolution.target),
      p: facts.pass === null ? 'the ball' : PASS_WORDS[facts.pass.kind],
      r: shot === null ? 'range' : rangeWord(shot.distance),
    }),
    tone,
  };
}

function name(state: PlaybookState<SoccerPlaybookState>, id: number | undefined): string {
  return shortName(athlete(state, id), 'the move');
}

/**
 * A second line, for the turn screen's detail row: what the turn was worth, when that is a number
 * worth showing. `09` §2.4 asks the sim to be honest about what it expected, and a shot's xG is the
 * one figure a soccer player already reads that way.
 */
export function narrateExpectation(resolution: TurnResolution): string | null {
  const facts = turnFacts(resolution);
  if (facts.shots.length === 0) return null;
  const total = facts.shots.reduce((sum, shot) => sum + shot.chance, 0);
  const attempts = facts.shots.length === 1 ? '1 attempt' : `${facts.shots.length} attempts`;
  return `${attempts}, ${total.toFixed(2)} xG`;
}

/** Every outcome the resolution model produces has a line, and the test asserts exactly that. */
export const NARRATED_OUTCOMES: readonly string[] = Object.keys(LINES).map(
  (key) => key.split('/')[0] as string,
);

export type { TurnFacts };
