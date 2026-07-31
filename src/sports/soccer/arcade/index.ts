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
 * **All five of `09` §3.2's soccer games are here.** Each joined this list in the commit that built
 * it rather than waiting for a registration task, which is what let `games.test.ts`'s set-wide
 * contract cover each one from its first minute. **T-6.27** closes the set: the unlock wiring and
 * the cross-set `calibrate()` sweep.
 */
import type { ArcadeGameDef } from '../../../modes/arcade/types.ts';
import { penaltyShootoutGame } from './penalty-shootout.ts';
import { freeKickGame } from './free-kick.ts';
import { oneOnOneGame } from './one-on-one.ts';
import { headerGame } from './header.ts';
import { lastLineGame } from './last-line.ts';

export const SOCCER_ARCADE: readonly ArcadeGameDef[] = [
  penaltyShootoutGame,
  freeKickGame,
  oneOnOneGame,
  headerGame,
  lastLineGame,
];

export { penaltyShootoutGame, freeKickGame, oneOnOneGame, headerGame, lastLineGame };
export { ROUNDS_PER_RUN, pickSide } from './penalty-shootout.ts';
export { FREE_KICK_ROUNDS, FREE_KICK_DISTANCE, windLabel } from './free-kick.ts';
export { ONE_ON_ONE_ROUNDS, APPROACH_SECONDS } from './one-on-one.ts';
export { HEADER_ROUNDS, CROSSES, CONTACT_HEIGHT_M } from './header.ts';
export { LAST_LINE_SECONDS } from './last-line.ts';
export { SOCCER_ARCADE_SPORT, saveEvent, shotEvents, soccerCalibration } from './shared.ts';
