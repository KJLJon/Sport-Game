/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.15 — Soccer arcade: Penalty Shootout
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set)
 *
 * Purpose: soccer's arcade set, in the order the hub shows it — easiest first, so the tile a
 * newcomer taps is the one that needs the least explaining (US-16.1: "a kid who's never played
 * before").
 *
 * **The array is what has actually been built, and nothing else.** Last Line is T-6.26, and
 * **T-6.27** is the row that closes the set — unlock wiring and a
 * `calibrate()` sweep across all five. A game joins this list in the commit that builds it, which is
 * what makes `games.test.ts`'s set-wide contract cover it from the first minute; until then it is
 * absent rather than stubbed, the same discipline `modes/catalogue.ts` applies one level up.
 */
import type { ArcadeGameDef } from '../../../modes/arcade/types.ts';
import { penaltyShootoutGame } from './penalty-shootout.ts';
import { freeKickGame } from './free-kick.ts';
import { oneOnOneGame } from './one-on-one.ts';
import { headerGame } from './header.ts';

export const SOCCER_ARCADE: readonly ArcadeGameDef[] = [
  penaltyShootoutGame,
  freeKickGame,
  oneOnOneGame,
  headerGame,
];

export { penaltyShootoutGame, freeKickGame, oneOnOneGame, headerGame };
export { ROUNDS_PER_RUN, pickSide } from './penalty-shootout.ts';
export { FREE_KICK_ROUNDS, FREE_KICK_DISTANCE, windLabel } from './free-kick.ts';
export { ONE_ON_ONE_ROUNDS, APPROACH_SECONDS } from './one-on-one.ts';
export { HEADER_ROUNDS, CROSSES, CONTACT_HEIGHT_M } from './header.ts';
export { SOCCER_ARCADE_SPORT, saveEvent, shotEvents, soccerCalibration } from './shared.ts';
