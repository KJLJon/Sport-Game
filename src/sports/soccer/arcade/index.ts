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
 * **One game so far, and the array says so honestly.** Free Kick, One-on-One, Header, and Last Line
 * are T-6.23–T-6.26, and **T-6.27** is the row that registers all five and checks their
 * `calibrate()`. Until then this list is what soccer can actually be played at, which is the same
 * discipline `modes/catalogue.ts` applies one level up: an absent thing is absent, not stubbed.
 */
import type { ArcadeGameDef } from '../../../modes/arcade/types.ts';
import { penaltyShootoutGame } from './penalty-shootout.ts';

export const SOCCER_ARCADE: readonly ArcadeGameDef[] = [penaltyShootoutGame];

export { penaltyShootoutGame };
export { ROUNDS_PER_RUN, pickSide } from './penalty-shootout.ts';
export { SOCCER_ARCADE_SPORT, saveEvent, shotEvents, soccerCalibration } from './shared.ts';
