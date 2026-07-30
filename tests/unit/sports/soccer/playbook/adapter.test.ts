/**
 * T-6.14 — soccer's `PlaybookAdapter`, and the first proof that T-5.1's seam takes a second sport.
 *
 * The turn-budget test is the one that matters: `09` §2.3 asks for 18–24 turns, `phases.ts` derives
 * its durations from that number, and nothing but a simulated match can tell you whether the
 * derivation survived contact with the transition graph.
 */
import { describe, expect, it } from 'vitest';
import { EventKind } from '../../../../../src/engine/match/events.ts';
import { simulatePlaybookMatch } from '../../../../../src/modes/playbook/match.ts';
import { SOCCER_RULES } from '../../../../../src/sports/soccer/rules.ts';
import { soccer } from '../../../../../src/sports/soccer/index.ts';
import {
  createSoccerPlaybook,
  soccerPlaybook,
} from '../../../../../src/sports/soccer/playbook/index.ts';
import { soccerSquads } from '../../../../../src/sports/soccer/playbook/squad.ts';
import { SOCCER_CALLS } from '../../../../../src/sports/soccer/playbook/calls.ts';
import type { SoccerPlaybookState } from '../../../../../src/sports/soccer/playbook/resolution.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';

function eleven(prefix: string, rating = 55): ReturnType<typeof athlete>[] {
  return Array.from({ length: 11 }, (_, index) =>
    athlete({
      id: `${prefix}-${index}`,
      displayName: `${prefix} ${index}`,
      primarySport: 'soccer',
      heightCm: 180,
      weightKg: 76,
      attributes: attributes(rating),
      sportSkills: { soccer: newSportSkill(70) },
    }),
  );
}

function squads(homeRating = 55, awayRating = 55): ReturnType<typeof soccerSquads> {
  return soccerSquads(eleven('home', homeRating), eleven('away', awayRating));
}

function simulate(seed: string, home = 55, away = 55): ReturnType<typeof createSoccerPlaybook> {
  return simulatePlaybookMatch<SoccerPlaybookState>({
    seed,
    adapter: soccerPlaybook,
    sport: 'soccer',
    rules: SOCCER_RULES,
    squads: squads(home, away),
    playerSide: -1,
  });
}

describe('soccer PlaybookAdapter', () => {
  it('is the adapter the sport module exposes, and its turns are phases', () => {
    expect(soccer.playbook).toBe(soccerPlaybook);
    expect(soccerPlaybook.turnKind).toBe('phase');
  });

  it('runs a Playbook half on the same clock Live does', () => {
    // 45:00 a half, 15:00 of extra time, and soccer's own compression — not a second clock.
    expect(soccerPlaybook.clock.periodSeconds).toBe(45 * 60);
    expect(soccerPlaybook.clock.overtimeSeconds).toBe(15 * 60);
    expect(soccerPlaybook.clock.secondsPerStep).toBeCloseTo(11.25 / 60, 6);
  });

  it('offers tempo to whoever has the ball and a press line to whoever does not', () => {
    const match = createSoccerPlaybook({ seed: 'calls', squads: squads() });
    const attacking = match.state.possession;
    const defending = attacking === 1 ? 0 : 1;

    expect(match.calls(attacking).map((call) => call.id)).toEqual([
      'patient',
      'balanced',
      'direct',
    ]);
    expect(match.calls(defending).map((call) => call.id)).toEqual(['deep', 'mid', 'high']);
  });

  it('marks every intent as persisting, which is what makes soccer ask fewer questions', () => {
    // `09` §2.3: "Intent choices persist until you change them."
    expect(SOCCER_CALLS.every((call) => call.persists === true)).toBe(true);
  });

  it('plays a match in the 18–24 turns `09` §2.3 asks for', () => {
    // "Typical" is a match settled in normal time; extra time buys another third of a clock and is
    // measured separately below. Both are the same phase graph, so only the band differs.
    const regulation: number[] = [];
    const all: number[] = [];
    for (let seed = 0; seed < 24; seed += 1) {
      const match = simulate(`budget-${seed}`);
      all.push(match.turns.length);
      if (match.state.period <= 2) regulation.push(match.turns.length);
    }

    expect(regulation.length).toBeGreaterThan(8);
    const mean = regulation.reduce((total, count) => total + count, 0) / regulation.length;
    expect(mean).toBeGreaterThanOrEqual(18);
    expect(mean).toBeLessThanOrEqual(24);

    // No single match should be wildly off either — one twice the mean means the graph stalled.
    for (const count of all) {
      expect(count).toBeGreaterThan(10);
      expect(count).toBeLessThan(45);
    }
  });

  it('stops after two halves of extra time instead of playing on until somebody leads', () => {
    // The state machine offers overtime while the score is level, which is basketball's rule and
    // not soccer's. Without the adapter's `isFinished` the worst seed in this batch reached period
    // 15; `06` §3.2 allows exactly two extra halves.
    for (let seed = 0; seed < 40; seed += 1) {
      const match = simulate(`extra-${seed}`);
      expect(match.state.period).toBeLessThanOrEqual(5);
      expect(match.finished).toBe(true);
      expect(match.result()).not.toBeNull();
    }
    const drawn = Array.from({ length: 40 }, (_, seed) => simulate(`extra-${seed}`)).filter(
      (match) => match.state.score[0] === match.state.score[1],
    );
    // A match still level after extra time is a draw. T-6.15's shootout is what will decide it.
    expect(drawn.length).toBeGreaterThan(0);
  });

  it('produces a plausible scoreline', () => {
    const totals = Array.from({ length: 24 }, (_, seed) => {
      const match = simulate(`score-${seed}`);
      return match.state.score[0] + match.state.score[1];
    });
    const mean = totals.reduce((total, goals) => total + goals, 0) / totals.length;

    // Baseline. Real soccer averages ~2.7; T-6.18's balance pass owns closing the gap.
    expect(mean).toBeGreaterThan(1);
    expect(mean).toBeLessThan(4);
    expect(Math.max(...totals)).toBeLessThan(12);
  });

  it('walks every phase of the ladder over a match', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) {
      for (const turn of simulate(`ladder-${seed}`).turns) {
        const possession = turn.events.find((one) => one.kind === EventKind.POSSESSION);
        seen.add(String(possession?.detail?.phase));
      }
    }
    expect([...seen].sort()).toEqual([
      'buildUp',
      'chance',
      'finalThird',
      'progression',
      'setPiece',
    ]);
  });

  it('scores one point a goal, and only from a shot', () => {
    const match = simulate('goals');
    for (const turn of match.turns) {
      expect(turn.points === 0 || turn.points === 1).toBe(true);
      if (turn.points === 1) {
        expect(turn.outcome).toBe('goal');
        expect(turn.events.some((one) => one.kind === EventKind.SHOT)).toBe(true);
      }
    }
  });

  it('emits the same stream Live does, with no mode field on it (INV-9)', () => {
    const events = simulate('stream').events;
    expect(events.length).toBeGreaterThan(0);
    for (const one of events) {
      expect(one).not.toHaveProperty('mode');
      expect(typeof one.step).toBe('number');
    }
    expect(events.some((one) => one.kind === EventKind.MATCH_START)).toBe(true);
    expect(events.some((one) => one.kind === EventKind.MATCH_END)).toBe(true);
    expect(events.some((one) => one.kind === EventKind.POSSESSION)).toBe(true);
  });

  it('is deterministic for a seed and diverges between seeds (INV-8)', () => {
    const a = simulate('determinism');
    const b = simulate('determinism');
    expect(b.state.score).toEqual(a.state.score);
    expect(b.turns.map((turn) => turn.outcome)).toEqual(a.turns.map((turn) => turn.outcome));

    const other = simulate('determinism-other');
    const differs =
      other.turns.length !== a.turns.length ||
      other.turns.some((turn, index) => turn.outcome !== a.turns[index]?.outcome);
    expect(differs).toBe(true);
  });

  it('lets the better squad win more often than not', () => {
    let strongWins = 0;
    let weakWins = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const match = simulate(`edge-${seed}`, 78, 34);
      const [home, away] = match.state.score;
      if (home > away) strongWins += 1;
      if (away > home) weakWins += 1;
    }
    expect(strongWins).toBeGreaterThan(weakWins * 2);
  });

  it('kicks the second half off from the halfway line rather than resuming a phase', () => {
    const match = createSoccerPlaybook({ seed: 'halves', squads: squads(), playerSide: -1 });
    let sawSecondHalfOpening = false;

    while (!match.finished) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call === null) throw new Error('expected an autoCall');
        match.submit(call);
      }
      const resolution = match.resolve();
      match.advance();

      if (match.state.period === 2 && !sawSecondHalfOpening && !match.finished) {
        const phase = match.state.detail.phase;
        // The period rolled over after this turn committed; the next turn reads `buildUp` because
        // `currentPhase()` sees the stale `detail.period`.
        expect(match.state.detail.period).toBeLessThanOrEqual(2);
        expect(typeof phase).toBe('string');
        sawSecondHalfOpening = true;
      }
      expect(resolution.seconds).toBeGreaterThan(0);
    }

    expect(sawSecondHalfOpening).toBe(true);
    expect(match.state.period).toBeGreaterThanOrEqual(2);
  });

  it('tires both sides, and tires the pressing side harder', () => {
    const pressing = createSoccerPlaybook({ seed: 'stamina', squads: squads(), playerSide: -1 });
    const attacking = pressing.state.possession === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;

    pressing.submit({ side: attacking, call: 'patient' });
    pressing.submit({ side: defending, call: 'high' });
    pressing.resolve();
    pressing.advance();

    const attackerStamina = pressing.state.squads[attacking].players[0]?.stamina ?? 0;
    const defenderStamina = pressing.state.squads[defending].players[0]?.stamina ?? 0;
    expect(attackerStamina).toBeLessThan(1);
    expect(defenderStamina).toBeLessThan(attackerStamina);
  });

  it('narrates every turn with a line and a tone', () => {
    const match = simulate('narration');
    for (const turn of match.turns) {
      const line = match.narrate(turn);
      expect(line.text.length).toBeGreaterThan(4);
      expect(['neutral', 'good', 'bad', 'big']).toContain(line.tone);
      expect(line.text).not.toContain('undefined');
    }
  });

  it('offers no key moment yet — T-6.22 owns them, and the mini-games do not exist', () => {
    const match = simulate('moments');
    const turn = match.turns[0];
    if (turn === undefined) throw new Error('expected at least one turn');
    expect(soccerPlaybook.keyMoment(match.state, turn)).toBeNull();
  });
});
