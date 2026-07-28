/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.1 — Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §5 (adding a sport still means adding one module)
 * @invariant INV-5 (no sport-specific branching outside the sport module)
 *
 * Purpose: the arcade catalogue, assembled from whatever sports are registered. The hub asks this
 * module what games exist; it never imports a sport. Adding basketball's five games in T-4.5–4.9
 * required no change here, and soccer's five in Phase 6 will not either — which is the whole claim
 * `09` §5 makes about the seam.
 */
import type { SportId, SportModule, SportRegistry } from '../../sports/types.ts';
import type { ArcadeGameDef, ArcadeGameId } from './types.ts';

/** Every arcade game a set of sports defines, in sport order and then in the sport's own order. */
export function arcadeCatalogue(modules: readonly SportModule[]): readonly ArcadeGameDef[] {
  const games: ArcadeGameDef[] = [];
  for (const module of modules) {
    for (const game of module.arcade ?? []) games.push(game);
  }
  return games;
}

/** The catalogue for everything in a registry, sorted by sport id so the hub's order is stable. */
export function catalogueFrom(registry: SportRegistry): readonly ArcadeGameDef[] {
  return arcadeCatalogue(registry.ids().map((id) => registry.require(id)));
}

/** One game by id, or `undefined`. The hub route resolves its `:id` parameter through this. */
export function findGame(
  games: readonly ArcadeGameDef[],
  id: ArcadeGameId,
): ArcadeGameDef | undefined {
  return games.find((game) => game.id === id);
}

/** The games belonging to one sport. */
export function gamesForSport(
  games: readonly ArcadeGameDef[],
  sport: SportId,
): readonly ArcadeGameDef[] {
  return games.filter((game) => game.sport === sport);
}

/**
 * Duplicate ids, if any. A duplicate would make personal bests and unlocks collide silently, so the
 * hub asserts on this rather than discovering it as a bug report about a lost high score.
 */
export function duplicateIds(games: readonly ArcadeGameDef[]): readonly ArcadeGameId[] {
  const seen = new Set<ArcadeGameId>();
  const duplicates = new Set<ArcadeGameId>();
  for (const game of games) {
    if (seen.has(game.id)) duplicates.add(game.id);
    seen.add(game.id);
  }
  return [...duplicates].sort();
}
