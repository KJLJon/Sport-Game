/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-10.1 — Jump straight into a game
 * @design  09-modes-and-arcade.md §1 (three ways to play), 10-ui-ux.md §7 (screen map), §8.1
 *          (first launch), §8.2 (Quick Play)
 *
 * Purpose: the three modes, as data — what each one is in one line, how hard it is to pick up, and
 * which sports can actually be played in it *today*.
 *
 * **Why availability lives here and not in the sport module.** `SportModule.arcade` and
 * `.playbook` say whether the sport has supplied the mode's rules; they say nothing about whether
 * a *screen* can reach it. Soccer has a complete `PlaybookAdapter` and no Playbook screen yet
 * (T-6.21), so deriving the picker from the module would offer the player a route that dead-ends.
 * This list is what the app can honestly start right now, and each gap names the reason in the
 * player's own words rather than a task ID.
 *
 * A mode is not a branch. Nothing downstream of a match reads these ids — progression, the economy,
 * achievements, and stats all see one `SportEvent` stream and cannot tell the modes apart (INV-9).
 * This is a menu, and it stops at the menu.
 */
import type { SportId } from '../sports/types.ts';

export const PLAY_MODES = ['live', 'playbook', 'arcade'] as const;
export type PlayModeId = (typeof PLAY_MODES)[number];

export interface PlayMode {
  readonly id: PlayModeId;
  readonly name: string;
  /** One line, per `10` §8.1 step 3. What you do, not what the engine does. */
  readonly blurb: string;
  /** `09` §1's "difficulty to learn" row, said honestly rather than sold. */
  readonly hint: string;
  /** Sports this mode can be started in today. */
  readonly sports: readonly SportId[];
  /** Where it starts. A hash path, ready for `location.hash` or an `href`. */
  route(sport: SportId): string;
  /**
   * Why a sport that is otherwise playable is missing from `sports`. Shown on the card the player
   * cannot tap, so an absence is never silent (`10` §10).
   */
  pending?(sport: SportId): string;
}

export const PLAY_MODE_CATALOGUE: readonly PlayMode[] = [
  {
    id: 'live',
    name: 'Live',
    blurb: 'Play the match yourself, in real time, one athlete at a time.',
    hint: 'Two thumbs, landscape. The hardest of the three to pick up.',
    sports: ['basketball', 'soccer'],
    route: (sport) => `#/play/live/${sport}`,
  },
  {
    id: 'playbook',
    name: 'Playbook',
    blurb: 'Coach it. Call a play each turn and play the moments that matter.',
    hint: 'One thumb, no reflexes needed. The easiest way in.',
    sports: ['basketball'],
    route: () => '#/play/playbook',
    pending: () => 'Soccer coaching is still being built — its match screen lands next.',
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'One skill at a time: shooting, dribbling, reactions. Twenty seconds a go.',
    hint: 'One thumb, either way up. Anyone can play it immediately.',
    sports: ['basketball'],
    route: () => '#/play/arcade',
    pending: () => 'Soccer mini-games are still being built.',
  },
];

export function playMode(id: string | undefined): PlayMode | undefined {
  return PLAY_MODE_CATALOGUE.find((mode) => mode.id === id);
}

/** Whether this sport can be started in this mode right now. */
export function isModeAvailable(mode: PlayMode, sport: SportId): boolean {
  return mode.sports.includes(sport);
}

/** The modes a sport can be played in, in catalogue order. Empty is a real answer. */
export function modesForSport(sport: SportId): readonly PlayMode[] {
  return PLAY_MODE_CATALOGUE.filter((mode) => isModeAvailable(mode, sport));
}
