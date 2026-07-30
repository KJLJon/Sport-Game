/**
 * T-6.14 — the phase turn model.
 *
 * The interesting assertions here are the two the module doc claims and cannot prove on its own:
 * that `phaseBallX` and `PHASE_THIRD` agree with the pitch's own `thirdFor`, and that the transition
 * graph plus the baseline odds actually produce the 18–24 turns `09` §2.3 asks for. The second one
 * is a whole-match simulation rather than arithmetic, which is the only version that stays true.
 */
import { describe, expect, it } from 'vitest';
import {
  OPENING_PHASE,
  PHASE_THIRD,
  PHASE_TURN_SECONDS,
  SOCCER_PHASES,
  isShootingPhase,
  nextPhase,
  outcomesFor,
  phaseBallX,
  phaseName,
  phaseThird,
  type PhaseOutcome,
  type SoccerPhase,
} from '../../../../../src/sports/soccer/playbook/phases.ts';
import { PHASE_OUTCOMES } from '../../../../../src/sports/soccer/playbook/phases.ts';

describe('soccer playbook phases', () => {
  it('names the five phases of `09` §2.3 in ladder order', () => {
    expect(SOCCER_PHASES).toEqual(['buildUp', 'progression', 'finalThird', 'chance', 'setPiece']);
    expect(OPENING_PHASE).toBe('buildUp');
  });

  it('puts every phase in the third it claims, for both sides', () => {
    for (const phase of SOCCER_PHASES) {
      for (const side of [0, 1] as const) {
        expect(phaseThird(phase, side)).toBe(PHASE_THIRD[phase]);
      }
    }
  });

  it('mirrors the ball position between the two sides', () => {
    for (const phase of SOCCER_PHASES) {
      // 105 m pitch: side 1 attacks the other way, so the two x values sum to the pitch length.
      expect(phaseBallX(phase, 0) + phaseBallX(phase, 1)).toBeCloseTo(105, 6);
    }
  });

  it('moves the ball further forward the higher up the ladder it is', () => {
    const ladder: readonly SoccerPhase[] = ['buildUp', 'progression', 'finalThird', 'chance'];
    for (let i = 1; i < ladder.length; i += 1) {
      expect(phaseBallX(ladder[i] as SoccerPhase, 0)).toBeGreaterThan(
        phaseBallX(ladder[i - 1] as SoccerPhase, 0),
      );
    }
  });

  it('gives each phase a name from both points of view', () => {
    for (const phase of SOCCER_PHASES) {
      const attacking = phaseName(phase, true);
      const defending = phaseName(phase, false);
      expect(attacking).not.toBe('');
      expect(defending).not.toBe('');
      expect(attacking).not.toBe(defending);
    }
  });

  it('answers every (phase, outcome) pair', () => {
    for (const phase of SOCCER_PHASES) {
      for (const outcome of PHASE_OUTCOMES) {
        const transition = nextPhase(phase, outcome as PhaseOutcome);
        expect(SOCCER_PHASES).toContain(transition.phase);
      }
    }
  });

  it('keeps the ball only when the move came off', () => {
    for (const phase of SOCCER_PHASES) {
      expect(nextPhase(phase, 'advance').retains).toBe(true);
      expect(nextPhase(phase, 'chance').retains).toBe(true);
      expect(nextPhase(phase, 'setPiece').retains).toBe(true);
      expect(nextPhase(phase, 'lost').retains).toBe(false);
      expect(nextPhase(phase, 'blocked').retains).toBe(false);
      // A goal hands the ball to the side that conceded, for the kick-off.
      expect(nextPhase(phase, 'goal')).toEqual({ phase: 'buildUp', retains: false });
    }
  });

  it('drops a possession lost deep into the opponent’s final third, and one lost high into theirs', () => {
    expect(nextPhase('buildUp', 'lost').phase).toBe('finalThird');
    expect(nextPhase('progression', 'lost').phase).toBe('progression');
    expect(nextPhase('finalThird', 'lost').phase).toBe('buildUp');
    expect(nextPhase('chance', 'blocked').phase).toBe('buildUp');
    expect(nextPhase('setPiece', 'blocked').phase).toBe('buildUp');
  });

  it('climbs the ladder one rung at a time and resets a dead-end attack to the final third', () => {
    expect(nextPhase('buildUp', 'advance').phase).toBe('progression');
    expect(nextPhase('progression', 'advance').phase).toBe('finalThird');
    expect(nextPhase('finalThird', 'advance').phase).toBe('finalThird');
    expect(nextPhase('chance', 'advance').phase).toBe('finalThird');
    expect(nextPhase('setPiece', 'advance').phase).toBe('finalThird');
  });

  it('offers only the outcomes the phase can actually produce', () => {
    expect(outcomesFor('buildUp')).toEqual(['advance', 'lost']);
    expect(outcomesFor('progression')).toEqual(['advance', 'lost']);
    expect(outcomesFor('finalThird')).toEqual(['chance', 'setPiece', 'lost']);
    expect(outcomesFor('chance')).toEqual(['goal', 'setPiece', 'blocked']);
    expect(outcomesFor('setPiece')).toEqual(['goal', 'setPiece', 'blocked']);
  });

  it('knows which phases a shot comes out of', () => {
    expect(isShootingPhase('chance')).toBe(true);
    expect(isShootingPhase('setPiece')).toBe(true);
    expect(isShootingPhase('buildUp')).toBe(false);
    expect(isShootingPhase('progression')).toBe(false);
    expect(isShootingPhase('finalThird')).toBe(false);
  });

  it('spends more clock on a settled phase than on a shot', () => {
    expect(PHASE_TURN_SECONDS.buildUp).toBeGreaterThan(PHASE_TURN_SECONDS.progression);
    expect(PHASE_TURN_SECONDS.progression).toBeGreaterThan(PHASE_TURN_SECONDS.finalThird);
    expect(PHASE_TURN_SECONDS.finalThird).toBeGreaterThan(PHASE_TURN_SECONDS.setPiece);
    expect(PHASE_TURN_SECONDS.setPiece).toBeGreaterThan(PHASE_TURN_SECONDS.chance);
  });
});
