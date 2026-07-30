/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @story   US-14.4 — Add a sport without touching the engine
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  04-architecture.md §5 (the sport module seam), 09-modes-and-arcade.md §5
 * @invariant INV-5 (no sport-specific branching outside the sport module)
 *
 * Purpose: which sports can actually be *played*, and how to load one by id.
 *
 * **Why this exists.** Before soccer there was one playable sport, so `routes.ts` imported
 * `basketball` directly — a hardcoded sport id in the app layer, which was harmless with one sport
 * and is a second registry the moment there are two. This is the list, and it is the only place a
 * module's import path is written down.
 *
 * The loaders are lazy on purpose. A sport module pulls in its rules, its five skill models, its
 * renderer, and its roster tables; eagerly importing every sport would put all of them in the
 * initial bundle and blow `12`'s budget for a screen most launches never reach.
 *
 * `catalogue.ts` is the neighbouring list and answers a different question: which sports an athlete
 * can be *rated* in. Rateable is a superset of playable — that is the distinction that file exists
 * to draw, and this file is the other half of it.
 */
import type { SportId, SportModule, SportState } from './types.ts';

export interface PlayableSport {
  readonly id: SportId;
  readonly displayName: string;
  /** Loads the module. Lazy, so an unplayed sport costs nothing at launch. */
  readonly load: () => Promise<SportModule<never>>;
}

/**
 * In the order a picker should show them. Adding a sport is adding a row.
 *
 * The `as never` on each loader is load-bearing rather than lazy typing: `SportModule<S>` is
 * invariant in `S` (it both accepts and returns state), so there is no supertype that a heterogenous
 * list of modules inhabits. Every consumer here treats the state as opaque and hands it straight
 * back to the same module, which is exactly the contract `SportState` documents — so the erasure is
 * honest, and it is confined to this one list rather than spreading to call sites.
 */
export const PLAYABLE_SPORTS: readonly PlayableSport[] = [
  {
    id: 'basketball',
    displayName: 'Basketball',
    load: async () =>
      (await import('./basketball/index.ts')).basketball as unknown as SportModule<never>,
  },
  {
    id: 'soccer',
    displayName: 'Soccer',
    load: async () => (await import('./soccer/index.ts')).soccer as unknown as SportModule<never>,
  },
];

export const DEFAULT_SPORT: SportId = 'basketball';

export function playableSport(id: string | undefined): PlayableSport {
  return (
    PLAYABLE_SPORTS.find((sport) => sport.id === id) ??
    (PLAYABLE_SPORTS.find((sport) => sport.id === DEFAULT_SPORT) as PlayableSport)
  );
}

/** Whether a sport id names something playable, for a router that should 404 rather than guess. */
export function isPlayable(id: string | undefined): boolean {
  return PLAYABLE_SPORTS.some((sport) => sport.id === id);
}

/**
 * Loads a sport module by id, falling back to the default rather than throwing.
 *
 * A bad sport in a deep link is a typo, not a crash: the honest response is to give the player a
 * playable match, and the router keeps the URL it was handed.
 */
export async function loadSport(id: string | undefined): Promise<SportModule<SportState>> {
  return (await playableSport(id).load()) as unknown as SportModule<SportState>;
}
