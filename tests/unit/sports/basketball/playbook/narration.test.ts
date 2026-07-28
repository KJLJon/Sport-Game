/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.3 — Narration + animated court-diagram renderer for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1, §2.2, 10-ui-ux.md §8.4
 * @invariant INV-8 (determinism)
 *
 * Narration and the basketball diagram. The claim worth pinning hardest: every outcome the
 * resolution model can produce has a line, so a new branch in the model cannot ship silent.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import { diagramAt, finalFrame } from '../../../../../src/modes/playbook/diagram.ts';
import type { CallPair, PlaybookState } from '../../../../../src/modes/playbook/types.ts';
import {
  basketballPlaybook,
  basketballSquads,
  createBasketballPlaybook,
} from '../../../../../src/sports/basketball/playbook/index.ts';
import { buildDiagram } from '../../../../../src/sports/basketball/playbook/diagram.ts';
import {
  NARRATED_OUTCOMES,
  narrateTurn,
  pickLine,
  shortName,
} from '../../../../../src/sports/basketball/playbook/narration.ts';
import {
  describeOutcome,
  resolvePossession,
  type BasketballPlaybookState,
} from '../../../../../src/sports/basketball/playbook/resolution.ts';
import { OFFENSIVE_PROFILES } from '../../../../../src/sports/basketball/playbook/calls.ts';
import { evenRosters } from '../../../../../tools/playbook-rosters.ts';

type State = PlaybookState<BasketballPlaybookState>;

function stateFor(seed = 'narr'): State {
  const [home, away] = evenRosters(seed);
  const match = createBasketballPlaybook({ seed, squads: basketballSquads(home, away) });
  match.state.possession = 0;
  return match.state;
}

function pair(offence: string, defence: string): CallPair {
  return { offence: { side: 0, call: offence }, defence: { side: 1, call: defence } };
}

/** Every outcome id the model can produce, enumerated from `describeOutcome` itself. */
const ALL_OUTCOMES = [
  ...new Set(
    [true, false].flatMap((made) =>
      [true, false].flatMap((andOne) =>
        [true, false].flatMap((trip) =>
          [true, false].flatMap((broken) =>
            ([2, 3] as const).flatMap((value) =>
              [0, 2].map((points) =>
                describeOutcome({ made, value, andOne, trip, broken, points }),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
  'stolen',
  'turnover',
];

describe('narration', () => {
  it('has a line for every outcome the model can produce', () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(NARRATED_OUTCOMES).toContain(outcome);
    }
  });

  it('names the athlete rather than an id', () => {
    const state = stateFor();
    const resolution = resolvePossession({
      state,
      calls: pair('spot-up', 'man'),
      rng: createRng('name'),
    });
    const line = narrateTurn(state, resolution);
    const actor = state.squads[0].players.find((player) => player.id === resolution.actor);
    expect(actor).toBeDefined();
    expect(line.text).toContain(shortName(actor));
    expect(line.text).not.toMatch(/\{[ad]\}/);
  });

  it('takes the family name where there is one', () => {
    const state = stateFor();
    const player = state.squads[0].players[0];
    expect(player).toBeDefined();
    const parts = player?.athlete.displayName.split(' ') ?? [];
    expect(shortName(player)).toBe(parts.at(-1));
  });

  it('has something to say about an athlete it cannot find', () => {
    expect(shortName(undefined)).toBe('the ball-handler');
  });

  it('says the same thing on a replay of the same turn (INV-8)', () => {
    const state = stateFor();
    const resolution = resolvePossession({
      state,
      calls: pair('motion', 'man'),
      rng: createRng('replay'),
    });
    const first = narrateTurn(state, resolution);
    for (let i = 0; i < 5; i += 1) expect(narrateTurn(state, resolution)).toEqual(first);
  });

  it('does not say the same thing every turn', () => {
    const said = new Set<string>();
    for (let turn = 0; turn < 12; turn += 1) {
      said.add(pickLine(['a', 'b', 'c'], turn, 'made-two'));
    }
    expect(said.size).toBeGreaterThan(1);
  });

  it('always returns something, even for an empty template list', () => {
    expect(pickLine([], 3, 'nonsense')).toMatch(/\S/);
  });

  it('carries a tone that matches what happened, and never relies on it alone', () => {
    const state = stateFor();
    for (const [outcome, tone] of [
      ['made-three', 'big'],
      ['missed-two', 'bad'],
      ['stolen', 'bad'],
    ] as const) {
      const line = narrateTurn(state, {
        turn: 0,
        calls: pair('motion', 'man'),
        attacking: 0,
        outcome,
        points: 0,
        seconds: 12,
        retainsPossession: false,
        events: [],
        expectation: { successChance: 0.4, expectedPoints: 0.8, because: 'x' },
      });
      expect(line.tone).toBe(tone);
      expect(line.text.length).toBeGreaterThan(4);
      expect(line.text.length).toBeLessThan(70);
    }
  });

  it('falls back rather than saying nothing for an outcome it has never heard of', () => {
    const state = stateFor();
    const line = narrateTurn(state, {
      turn: 1,
      calls: pair('motion', 'man'),
      attacking: 0,
      outcome: 'ejected-by-the-referee',
      points: 0,
      seconds: 12,
      retainsPossession: false,
      events: [],
      expectation: { successChance: 0, expectedPoints: 0, because: 'x' },
    });
    expect(line.tone).toBe('neutral');
    expect(line.text).toMatch(/\S/);
  });
});

describe('the basketball diagram', () => {
  it('draws a marker for everyone on the floor, with the shooter leading', () => {
    const state = stateFor();
    const resolution = resolvePossession({
      state,
      calls: pair('isolation', 'man'),
      rng: createRng('dia'),
    });
    const diagram = buildDiagram(state, resolution);

    expect(diagram.markers).toHaveLength(5);
    expect(diagram.markers[0]?.id).toBe(resolution.actor);
    expect(diagram.markers[0]?.primary).toBe(true);
    expect(diagram.markers.filter((marker) => marker.primary === true)).toHaveLength(1);
  });

  it('keeps every marker on the court', () => {
    const state = stateFor();
    for (const profile of OFFENSIVE_PROFILES) {
      const resolution = resolvePossession({
        state,
        calls: pair(profile.id, 'man'),
        rng: createRng(`bounds-${profile.id}`),
      });
      for (const marker of buildDiagram(state, resolution).markers) {
        for (const point of [marker.from, marker.to]) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(1);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives each of the six calls its own recognisable shape (`09` §2.2)', () => {
    const state = stateFor();
    const shapes = new Set(
      OFFENSIVE_PROFILES.map((profile) => {
        const resolution = resolvePossession({
          state,
          calls: pair(profile.id, 'man'),
          rng: createRng('shape'),
        });
        return JSON.stringify(buildDiagram(state, resolution).markers.map((m) => m.to));
      }),
    );
    expect(shapes.size).toBe(OFFENSIVE_PROFILES.length);
  });

  it('ends a made shot at the rim, and says it went in', () => {
    const state = stateFor();
    let checked = false;
    for (let i = 0; i < 60 && !checked; i += 1) {
      const resolution = resolvePossession({
        state,
        calls: pair('post-up', 'man'),
        rng: createRng(`made-${i}`),
      });
      if (resolution.points === 0) continue;
      checked = true;
      const diagram = buildDiagram(state, resolution);
      const shot = diagram.shapes.find((shape) => shape.kind === 'shot');
      expect(shot?.made).toBe(true);
      expect(shot?.to).toEqual(diagram.basket);
    }
    expect(checked).toBe(true);
  });

  it('draws no shot for a turnover, and finishes quicker', () => {
    const state = stateFor();
    let checked = false;
    for (let i = 0; i < 200 && !checked; i += 1) {
      const resolution = resolvePossession({
        state,
        calls: pair('push', 'press'),
        rng: createRng(`lost-${i}`),
      });
      if (resolution.outcome !== 'stolen' && resolution.outcome !== 'turnover') continue;
      checked = true;
      const diagram = buildDiagram(state, resolution);
      expect(diagram.shapes.some((shape) => shape.kind === 'shot')).toBe(false);
      expect(diagram.seconds).toBeLessThan(5);
    }
    expect(checked).toBe(true);
  });

  it('runs for the four-to-eight seconds `09` §2.1 asks for', () => {
    const state = stateFor();
    for (const profile of OFFENSIVE_PROFILES) {
      const resolution = resolvePossession({
        state,
        calls: pair(profile.id, 'man'),
        rng: createRng('secs'),
      });
      const diagram = buildDiagram(state, resolution);
      expect(diagram.seconds).toBeGreaterThanOrEqual(4);
      expect(diagram.seconds).toBeLessThanOrEqual(8);
    }
  });

  it('is animatable end to end without leaving anything half-drawn', () => {
    const state = stateFor();
    const resolution = resolvePossession({
      state,
      calls: pair('pick-roll', 'man'),
      rng: createRng('anim'),
    });
    const diagram = buildDiagram(state, resolution);
    expect(diagramAt(diagram, 0).shapes).toEqual([]);
    expect(finalFrame(diagram).shapes.every((shape) => shape.progress === 1)).toBe(true);
  });

  it('reaches the turn screen through the adapter, not around it', () => {
    const [home, away] = evenRosters('adapter');
    const match = createBasketballPlaybook({
      seed: 'adapter',
      squads: basketballSquads(home, away),
    });
    for (const side of [0, 1] as const) {
      const call = match.autoCall(side);
      if (call !== null) match.submit(call);
    }
    match.resolve();
    const turn = match.advance();

    expect(basketballPlaybook.diagram).toBeDefined();
    expect(match.diagram(turn)?.markers).toHaveLength(5);
    expect(match.narrate(turn).text).toMatch(/\S/);
  });
});
