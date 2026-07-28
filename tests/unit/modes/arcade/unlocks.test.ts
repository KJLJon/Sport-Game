/**
 * T-4.3 — unlock state, and the interim rule that keeps the hub usable before Phase 8.
 */
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS_LANDED,
  unlockStateFor,
  unlockStates,
} from '../../../../src/modes/arcade/unlocks.ts';
import { ARCADE_UNLOCKS } from '../../../../src/achievements/ids.ts';
import { BASKETBALL_ARCADE } from '../../../../src/sports/basketball/arcade/index.ts';
import { fakeGame } from '../../../helpers/arcade.ts';

describe('unlockStateFor', () => {
  it('unlocks a game whose achievement has been earned', () => {
    const game = { ...fakeGame(), unlockAchievement: ARCADE_UNLOCKS.fiveSteals.id };
    expect(unlockStateFor(game, new Set([ARCADE_UNLOCKS.fiveSteals.id])).unlocked).toBe(true);
  });

  it('names the condition on a locked tile, and never a price (US-16.2)', () => {
    const game = { ...fakeGame(), unlockAchievement: ARCADE_UNLOCKS.fiveSteals.id };
    const state = unlockStateFor(game, new Set());

    if (ACHIEVEMENTS_LANDED) {
      expect(state.unlocked).toBe(false);
      expect(state.requirement).toBe('Record 5 steals');
      expect(state.requirement).not.toMatch(/buy|coins|store/i);
    } else {
      // The documented interim: no achievement is ever written until Phase 8, so locking every game
      // would make Gate 4 unreachable. One greppable constant, not a quietly permissive check.
      expect(state.unlocked).toBe(true);
    }
  });
});

describe('unlockStates', () => {
  it('covers every game in the catalogue', () => {
    const states = unlockStates(BASKETBALL_ARCADE, new Set());
    expect(states.size).toBe(BASKETBALL_ARCADE.length);
    for (const game of BASKETBALL_ARCADE) expect(states.has(game.id)).toBe(true);
  });
});
