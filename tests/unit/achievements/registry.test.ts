/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.4 — Cross-sport achievements exist and are prominent
 * @design  05-data-model.md §6, 09-modes-and-arcade.md §3.2
 *
 * Purpose: the content, checked as content — the count US-8.1 promises, the categories it promises
 * them across, and the ten ids that arcade unlocks are gated on.
 *
 * The arcade case is the one that would break silently. `modes/arcade/registry.ts` locks each game
 * behind an id from `achievements/ids.ts`; if no def ever awards that id, the game is unreachable
 * and nothing anywhere fails. It happened to be right on the first go, which is exactly why it
 * needs a test rather than a careful read.
 */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementById, validateRegistry } from '@/achievements/registry.ts';
import { ARCADE_UNLOCKS } from '@/achievements/ids.ts';
import { ACHIEVEMENT_CATEGORIES } from '@/achievements/types.ts';

describe('the achievement registry', () => {
  it('has at least the sixty US-8.1 asks for', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(60);
  });

  it('is internally consistent', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('covers the categories the stories name', () => {
    const present = new Set(ACHIEVEMENTS.map((def) => def.category));
    for (const category of [
      'onboarding',
      'basketball',
      'soccer',
      'crossSport',
      'difficulty',
      'collection',
      'economy',
      'p2p',
    ] as const) {
      expect(present, `missing category: ${category}`).toContain(category);
    }
    // Every category used is one `05` §6 declared.
    for (const category of present) expect(ACHIEVEMENT_CATEGORIES).toContain(category);
  });

  it('awards every id an arcade game is locked behind (`09` §3.2)', () => {
    for (const unlock of Object.values(ARCADE_UNLOCKS)) {
      const def = achievementById(unlock.id);
      expect(def, `no achievement awards ${unlock.id}`).toBeDefined();
      expect(def?.description.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('makes the cross-sport ones the biggest rewards, because US-8.4 asks for prominent', () => {
    const crossSport = ACHIEVEMENTS.filter((def) => def.category === 'crossSport');
    const perSport = ACHIEVEMENTS.filter(
      (def) => def.category === 'basketball' || def.category === 'soccer',
    );

    const best = (defs: typeof ACHIEVEMENTS) =>
      Math.max(...defs.map((def) => def.reward.coins ?? 0));
    expect(crossSport.length).toBeGreaterThanOrEqual(4);
    expect(best(crossSport)).toBeGreaterThan(best(perSport));
  });

  it('hides some, and never hides an arcade unlock', () => {
    expect(ACHIEVEMENTS.some((def) => def.hidden)).toBe(true);

    const unlockIds = new Set<string>(Object.values(ARCADE_UNLOCKS).map((entry) => entry.id));
    for (const def of ACHIEVEMENTS) {
      // A hidden unlock condition would leave a locked arcade tile telling the player to do
      // something the gallery refuses to describe.
      if (unlockIds.has(def.id)) expect(def.hidden, def.id).toBe(false);
    }
  });

  it('describes a multi-step achievement in terms of its target', () => {
    for (const def of ACHIEVEMENTS) {
      if (def.target <= 1) continue;
      // "Score 20 career goals" with a target of 20: the number in the sentence and the number in
      // the bar have to be the same, or the progress bar contradicts the description.
      expect(def.description, def.id).toMatch(new RegExp(`\\b${def.target}\\b`));
    }
  });

  it('pays every achievement something', () => {
    for (const def of ACHIEVEMENTS) {
      expect((def.reward.coins ?? 0) > 0 || def.reward.pack !== undefined, def.id).toBe(true);
    }
  });
});

describe('the arcade unlock moment (T-8.8)', () => {
  it('names the real game for every unlock id', async () => {
    const [{ BASKETBALL_ARCADE }, { SOCCER_ARCADE }, { unlocksGame }] = await Promise.all([
      import('@/sports/basketball/arcade/index.ts'),
      import('@/sports/soccer/arcade/index.ts'),
      import('@/achievements/ids.ts'),
    ]);
    const games = [...BASKETBALL_ARCADE, ...SOCCER_ARCADE];

    for (const unlock of Object.values(ARCADE_UNLOCKS)) {
      const game = games.find((entry) => entry.unlockAchievement === unlock.id);
      expect(game, unlock.id).toBeDefined();
      // The name shown in "X unlocked — you can practise this any time now" has to be the name on
      // the tile the player then goes looking for.
      expect(unlocksGame(unlock.id), unlock.id).toBe(game?.name);
    }
  });

  it('names no game for an achievement that opens none', async () => {
    const { unlocksGame } = await import('@/achievements/ids.ts');
    expect(unlocksGame('onboarding.first-whistle')).toBeUndefined();
  });
});
