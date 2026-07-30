/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"
 * @task    T-3.9 — Cross-sport compare view with projections for unplayed sports
 * @story   US-5.2 — Play any athlete in any sport
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  05-data-model.md §3 (derivation), 10-ui-ux.md §6 (the athlete card), 04-architecture.md §5
 *
 * Purpose: every sport an athlete can be *rated* in, which is not the same set as every sport that
 * can be *played*.
 *
 * That distinction is the whole reason this file exists. `10` §6's sport switcher and the compare
 * view exist to show a soccer star's numbers reshaping into a basketball card — a feature that
 * needs at least two rating tables and does not need two playable sports.
 *
 * **Both rows are `playable: true` as of T-6.10**, when soccer's `SportModule` landed. That does not
 * make the flag pointless: hockey and American football arrive in Phase 11 the same way soccer did,
 * rateable first and playable later, and `05` §3's compare view has to keep working in between. The
 * flag records which half of that transition a sport is in.
 *
 * `playable.ts` is the neighbouring list and answers the *other* question — how to load a playable
 * sport's module. Rateable is a superset of playable; keeping the two lists apart is what stops a
 * rating table dragging a renderer into the initial bundle.
 *
 * A sport is added here by adding a row. There is no branching on sport id anywhere downstream.
 */
import type { SportRatingTables } from '../athletes/derivation.ts';
import {
  BASKETBALL_PHYSICAL,
  BASKETBALL_POSITION_WEIGHTS,
  BASKETBALL_WEIGHTS,
} from './basketball/weights.ts';
import { SOCCER_PHYSICAL, SOCCER_WEIGHTS } from './soccer/weights.ts';
import type { SportId } from './types.ts';

export interface RateableSport {
  readonly id: SportId;
  readonly displayName: string;
  /** False while the sport has weights but no `SportModule` yet. */
  readonly playable: boolean;
  readonly tables: SportRatingTables;
}

/** In the order the sport switcher shows them: playable first, then merely rateable. */
export const RATEABLE_SPORTS: readonly RateableSport[] = [
  {
    id: 'basketball',
    displayName: 'Basketball',
    playable: true,
    tables: {
      weights: BASKETBALL_WEIGHTS,
      physicalModifiers: BASKETBALL_PHYSICAL,
      positionWeights: BASKETBALL_POSITION_WEIGHTS,
    },
  },
  {
    id: 'soccer',
    displayName: 'Soccer',
    playable: true,
    tables: { weights: SOCCER_WEIGHTS, physicalModifiers: SOCCER_PHYSICAL },
  },
];

export function rateableSport(id: SportId): RateableSport | undefined {
  return RATEABLE_SPORTS.find((sport) => sport.id === id);
}

/**
 * The sports to show for an athlete, their own first. Someone opening a soccer player's card
 * wants to see soccer before they see anything else, whatever order the catalogue is in.
 */
export function sportsForAthlete(primarySport: SportId): readonly RateableSport[] {
  const own = RATEABLE_SPORTS.filter((sport) => sport.id === primarySport);
  return [...own, ...RATEABLE_SPORTS.filter((sport) => sport.id !== primarySport)];
}
