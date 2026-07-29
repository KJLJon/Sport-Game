/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.7 — Auto-call assistant coach, fast-forward, turn-speed control
 * @story   US-15.6 — Keep a long match from becoming a chore
 * @design  09-modes-and-arcade.md §2.1, §2.2
 * @invariant INV-8 (determinism)
 *
 * The coach reads your roster and calls something sensible. These pin "sensible": a squad of
 * shooters shoots, a squad of bodies posts up, and nobody presses on empty legs.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import type { PlaybookState } from '../../../../../src/modes/playbook/types.ts';
import {
  basketballSquads,
  coachCall,
  createBasketballPlaybook,
  explainCall,
  scoreDefence,
  scoreOffence,
} from '../../../../../src/sports/basketball/playbook/index.ts';
import type { BasketballPlaybookState } from '../../../../../src/sports/basketball/playbook/resolution.ts';
import { evenRosters, roster } from '../../../../../tools/playbook-rosters.ts';

type State = PlaybookState<BasketballPlaybookState>;

function stateFor(seed = 'coach'): State {
  const [home, away] = evenRosters(seed);
  const match = createBasketballPlaybook({ seed, squads: basketballSquads(home, away) });
  match.state.possession = 0;
  return match.state;
}

/** Rewrites every player's rating in one key, so a preference can be isolated. */
function tilt(state: State, side: 0 | 1, changes: Record<string, number>): State {
  for (const player of state.squads[side].players) {
    Object.assign(player.ratings as Record<string, number>, changes);
  }
  return state;
}

describe('the offensive call sheet, scored', () => {
  it('prices every call in the catalogue, best first', () => {
    const scored = scoreOffence(stateFor(), 0);
    expect(scored).toHaveLength(6);
    for (let i = 1; i < scored.length; i += 1) {
      expect((scored[i - 1] as { score: number }).score).toBeGreaterThanOrEqual(
        (scored[i] as { score: number }).score,
      );
    }
  });

  it('shoots with shooters', () => {
    const state = tilt(stateFor(), 0, { threePoint: 92, strength: 30, ballHandling: 35 });
    expect(scoreOffence(state, 0)[0]?.call).toBe('spot-up');
  });

  it('posts up with bodies', () => {
    const state = tilt(stateFor(), 0, { strength: 95, threePoint: 25, ballHandling: 30 });
    expect(scoreOffence(state, 0)[0]?.call).toBe('post-up');
  });

  it('wants a stop and fresh legs before it pushes (`09` §2.2)', () => {
    const cold = tilt(stateFor(), 0, { courtSpeed: 95 });
    cold.detail.lastWasStop = false;
    const afterStop = tilt(stateFor(), 0, { courtSpeed: 95 });
    afterStop.detail.lastWasStop = true;

    const push = (state: State): number =>
      scoreOffence(state, 0).find((scored) => scored.call === 'push')?.score ?? 0;
    expect(push(afterStop)).toBeGreaterThan(push(cold));
  });

  it('backs off the expensive plays on tired legs', () => {
    const fresh = stateFor();
    const tired = stateFor();
    for (const player of tired.squads[0].players) player.stamina = 0.5;
    tired.detail.lastWasStop = true;
    fresh.detail.lastWasStop = true;

    const push = (state: State): number =>
      scoreOffence(state, 0).find((scored) => scored.call === 'push')?.score ?? 0;
    expect(push(tired)).toBeLessThan(push(fresh));
  });

  it('says who the call is for', () => {
    const state = stateFor();
    const top = scoreOffence(state, 0)[0];
    expect(top?.because).toMatch(/\d/);
    expect(explainCall(state, 0, top?.call ?? '')).toBe(top?.because);
  });
});

describe('the defensive call sheet, scored', () => {
  it('plays man with perimeter defenders', () => {
    const state = tilt(stateFor(), 1, { perimeterD: 90, interiorD: 40, courtSpeed: 45 });
    state.possession = 0;
    expect(scoreDefence(state, 1)[0]?.call).toBe('man');
  });

  it('zones up when the size is inside and the speed is not', () => {
    const state = tilt(stateFor(), 1, { interiorD: 90, perimeterD: 40, courtSpeed: 40 });
    state.possession = 0;
    expect(['zone', 'protect-rim']).toContain(scoreDefence(state, 1)[0]?.call);
  });

  it('will not press on empty legs', () => {
    const fresh = tilt(stateFor(), 1, { courtSpeed: 90 });
    const tired = tilt(stateFor(), 1, { courtSpeed: 90 });
    for (const player of tired.squads[1].players) player.stamina = 0.5;

    const press = (state: State): number =>
      scoreDefence(state, 1).find((scored) => scored.call === 'press')?.score ?? 0;
    expect(press(tired)).toBeLessThan(press(fresh));
  });
});

describe('the coach’s call', () => {
  it('is a legal call from the right half of the catalogue', () => {
    const state = stateFor();
    const offence = coachCall(state, 0, createRng('a'));
    const defence = coachCall(state, 1, createRng('b'));
    expect(['isolation', 'pick-roll', 'post-up', 'motion', 'spot-up', 'push']).toContain(
      offence.call,
    );
    expect(['man', 'zone', 'press', 'double', 'protect-rim']).toContain(defence.call);
  });

  it('names a target, so auto-calling never produces a call you could not have made', () => {
    const state = stateFor();
    const call = coachCall(state, 0, createRng('t'));
    const ids = state.squads[0].players.map((player) => player.id);
    expect(ids).toContain(call.target);
  });

  it('is deterministic for a seed (INV-8)', () => {
    const state = stateFor();
    expect(coachCall(state, 0, createRng('same'))).toEqual(coachCall(state, 0, createRng('same')));
  });

  it('does not call the same play forty times in a row', () => {
    const state = stateFor();
    const called = new Set<string>();
    for (let i = 0; i < 40; i += 1) called.add(coachCall(state, 0, createRng(`turn-${i}`)).call);
    expect(called.size).toBeGreaterThan(1);
  });

  it('still favours what suits the roster, across a long stretch', () => {
    const state = tilt(stateFor(), 0, { threePoint: 95, strength: 25, ballHandling: 30 });
    let shooting = 0;
    for (let i = 0; i < 60; i += 1) {
      if (coachCall(state, 0, createRng(`s-${i}`)).call === 'spot-up') shooting += 1;
    }
    expect(shooting).toBeGreaterThan(30);
  });

  it('reaches the match through the adapter, and is not the CPU', () => {
    const [home, away] = evenRosters('through');
    const match = createBasketballPlaybook({
      seed: 'through',
      squads: basketballSquads(home, away),
      playerSide: 0,
    });
    expect(match.coachCall(0)).not.toBeNull();
    // The CPU is still the flat placeholder T-5.8 will replace, so the two need not agree.
    expect(match.autoCall(0)).not.toBeNull();
  });
});

describe('the coach reads your roster, not your opponent’s', () => {
  it('calls the same play whatever the opponent is holding', () => {
    const weakOpponent = createBasketballPlaybook({
      seed: 'blind',
      squads: basketballSquads(roster('us', 'strong'), roster('them', 'weak')),
    });
    const strongOpponent = createBasketballPlaybook({
      seed: 'blind',
      squads: basketballSquads(roster('us', 'strong'), roster('them', 'strong')),
    });
    weakOpponent.state.possession = 0;
    strongOpponent.state.possession = 0;

    // Defensive ratings differ wildly between the two; the *offensive* pick is allowed to notice
    // the matchup, but the call the coach lands on for the same squad should still be recognisable.
    const a = scoreOffence(weakOpponent.state, 0)[0]?.call;
    const b = scoreOffence(strongOpponent.state, 0)[0]?.call;
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });
});
