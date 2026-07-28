/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.5 — Free Throw — release timing under mounting pressure
 * @task    T-4.6 — Three-Point Contest — five racks, rhythm and timing, 60 s
 * @task    T-4.7 — Buzzer Beater — contested shot, shrinking window
 * @task    T-4.8 — Fast Break — finish past a recovering defender
 * @task    T-4.9 — Pickpocket — reaction test, jump the lane without fouling
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set)
 *
 * Purpose: basketball's arcade set, in the order the hub shows it — easiest first, so the tile a
 * newcomer taps is the one that needs the least explaining (US-16.1: "a kid who's never played
 * before"). The soccer set arrives in Phase 6 as a second array on a second module, and this file
 * does not change when it does.
 */
import type { ArcadeGameDef } from '../../../modes/arcade/types.ts';
import { buzzerBeaterGame } from './buzzer-beater.ts';
import { fastBreakGame } from './fast-break.ts';
import { freeThrowGame } from './free-throw.ts';
import { pickpocketGame } from './pickpocket.ts';
import { threePointGame } from './three-point.ts';

export const BASKETBALL_ARCADE: readonly ArcadeGameDef[] = [
  freeThrowGame,
  threePointGame,
  fastBreakGame,
  buzzerBeaterGame,
  pickpocketGame,
];

export { buzzerBeaterGame, fastBreakGame, freeThrowGame, pickpocketGame, threePointGame };
