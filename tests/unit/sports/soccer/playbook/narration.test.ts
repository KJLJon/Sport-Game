/**
 * T-6.21 — soccer's turn narration.
 *
 * Three properties, and they are the ones a wall of strings can quietly lose: every outcome the
 * resolution model can produce has a line written for it, the same turn always reads the same way,
 * and no line ever ships a `{placeholder}` to the screen. The rest — whether the lines are any good
 * — is the feel note in `PROGRESS.md`, not something a test can hold.
 */
import { describe, expect, it } from 'vitest';
import { simulatePlaybookMatch } from '../../../../../src/modes/playbook/match.ts';
import { pickLine, shortName } from '../../../../../src/modes/playbook/narration.ts';
import { SOCCER_RULES } from '../../../../../src/sports/soccer/rules.ts';
import { soccerPlaybook } from '../../../../../src/sports/soccer/playbook/index.ts';
import {
  narrateExpectation,
  narrateTurn,
  templatesFor,
} from '../../../../../src/sports/soccer/playbook/narration.ts';
import { SOCCER_PHASES } from '../../../../../src/sports/soccer/playbook/phases.ts';
import {
  TURN_OUTCOMES,
  type SoccerPlaybookState,
} from '../../../../../src/sports/soccer/playbook/resolution.ts';
import { soccerSquads } from '../../../../../src/sports/soccer/playbook/squad.ts';
import { NARRATION_TONES } from '../../../../../src/modes/playbook/types.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';

function eleven(prefix: string): ReturnType<typeof athlete>[] {
  return Array.from({ length: 11 }, (_, index) =>
    athlete({
      id: `${prefix}-${index}`,
      displayName: `${prefix.toUpperCase()} Player${index}`,
      primarySport: 'soccer',
      heightCm: 180,
      weightKg: 76,
      attributes: attributes(55),
      sportSkills: { soccer: newSportSkill(70) },
    }),
  );
}

function simulate(seed: string): ReturnType<typeof simulatePlaybookMatch<SoccerPlaybookState>> {
  return simulatePlaybookMatch<SoccerPlaybookState>({
    seed,
    adapter: soccerPlaybook,
    sport: 'soccer',
    rules: SOCCER_RULES,
    squads: soccerSquads(eleven('home'), eleven('away')),
    playerSide: -1,
  });
}

describe('soccer narration', () => {
  it('has at least one line for every outcome the model can produce', () => {
    for (const outcome of TURN_OUTCOMES) {
      for (const phase of SOCCER_PHASES) {
        expect(templatesFor(outcome, phase).length, `${outcome} in ${phase}`).toBeGreaterThan(0);
      }
    }
  });

  it('has real variety: more than one way to say the common outcomes', () => {
    for (const outcome of ['goal', 'saved', 'lost', 'chance'] as const) {
      expect(templatesFor(outcome, 'chance').length, outcome).toBeGreaterThan(2);
    }
  });

  it('never leaves a placeholder in a line, over a whole simulated match', () => {
    const match = simulate('narration-placeholders');
    expect(match.turns.length).toBeGreaterThan(10);

    for (const turn of match.turns) {
      const line = narrateTurn(match.state, turn);
      expect(line.text, `turn ${turn.turn}`).not.toMatch(/[{}]/);
      expect(line.text.length).toBeGreaterThan(4);
      expect(NARRATION_TONES).toContain(line.tone);
    }
  });

  it('names the athlete the turn was about', () => {
    const match = simulate('narration-names');
    const withActor = match.turns.filter((turn) => turn.actor !== undefined);
    expect(withActor.length).toBeGreaterThan(5);

    // Every squad name here is `HOME Player3` / `AWAY Player7`, so the family name is the token the
    // line must carry — a line naming nobody would fail this without the test knowing the roster.
    const named = withActor.filter((turn) =>
      narrateTurn(match.state, turn).text.includes('Player'),
    );
    expect(named.length).toBe(withActor.length);
  });

  it('says the same thing twice for the same turn, and the same thing on a replay', () => {
    const first = simulate('narration-stable');
    const second = simulate('narration-stable');

    const lines = (match: typeof first): string[] =>
      match.turns.map((turn) => narrateTurn(match.state, turn).text);

    expect(lines(first)).toEqual(lines(first));
    expect(lines(second)).toEqual(lines(first));
  });

  it('does not say the same sentence every time', () => {
    const match = simulate('narration-variety');
    const said = new Set(match.turns.map((turn) => narrateTurn(match.state, turn).text));
    // Twenty-odd turns of one repeated line was the T-6.14 state this task exists to fix.
    expect(said.size).toBeGreaterThan(8);
  });

  it('reports xG only for turns that actually had a shot', () => {
    const match = simulate('narration-xg');
    for (const turn of match.turns) {
      const detail = narrateExpectation(turn);
      const shots = turn.events.filter((entry) => entry.kind === 'shot');
      if (shots.length === 0) {
        expect(detail).toBeNull();
      } else {
        expect(detail).toContain('xG');
        expect(detail).toContain(shots.length === 1 ? '1 attempt' : `${shots.length} attempts`);
      }
    }
  });
});

describe('the shared narration helpers', () => {
  it('picks the same line for the same turn and key, and spreads across the options', () => {
    const options = ['a', 'b', 'c', 'd'];
    expect(pickLine(options, 7, 'goal')).toBe(pickLine(options, 7, 'goal'));

    const seen = new Set(
      Array.from({ length: 40 }, (_, turn) => pickLine(options, turn, 'goal/chance')),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns an empty string rather than throwing when a sport has no lines', () => {
    expect(pickLine([], 3, 'nothing')).toBe('');
  });

  it('uses the family name where there is one, and the fallback where there is nobody', () => {
    const player = {
      id: 1,
      athlete: { displayName: 'Ada Maria Lovelace' },
      ratings: {},
      role: 'st',
      stamina: 1,
    } as never;
    expect(shortName(player)).toBe('Lovelace');
    expect(shortName(undefined, 'the move')).toBe('the move');
  });
});
