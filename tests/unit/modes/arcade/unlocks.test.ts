/**
 * T-4.3, T-8.8 — unlock state, now that achievements actually gate the games.
 *
 * The interim rule (`ACHIEVEMENTS_LANDED === false`, every game open because nothing wrote an
 * unlock) ended with T-8.8. These assert the real behaviour: a game opens when its achievement is
 * earned, and a locked tile says what earns it and never a price.
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

    expect(ACHIEVEMENTS_LANDED).toBe(true);
    expect(state.unlocked).toBe(false);
    expect(state.requirement).toBe('Record 5 steals');
    expect(state.requirement).not.toMatch(/buy|coins|store/i);
  });
});

describe('unlockStates', () => {
  it('covers every game in the catalogue', () => {
    const states = unlockStates(BASKETBALL_ARCADE, new Set());
    expect(states.size).toBe(BASKETBALL_ARCADE.length);
    for (const game of BASKETBALL_ARCADE) expect(states.has(game.id)).toBe(true);
  });
});
