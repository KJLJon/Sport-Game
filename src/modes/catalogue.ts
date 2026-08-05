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
 * a *screen* can reach it. That gap was real: soccer had a complete `PlaybookAdapter` for two tasks
 * while the Playbook screen still imported basketball by name, so deriving the picker from the
 * module would have offered a route that dead-ended. T-6.21 closed it for Playbook and T-6.15 opened
 * soccer's arcade with its first game; both rows moved here rather than the rule changing. This list
 * is what the app can honestly start right now, and each gap names the reason in the player's own
 * words rather than a task ID.
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

  /**
   * Where "Set up" goes, for a mode that has choices worth making before kick-off (T-8.2).
   *
   * **Secondary on purpose.** The first instinct was to make this the card's only destination, and
   * it broke the promise the hub exists to keep: `10` §2 is "two taps to play" and T-8.1's gate
   * criterion is *two taps from a cold launch reach a live match*. A mandatory form makes that
   * three. So the card still plays, and configuring is one extra tap for the player who wants it —
   * which is also the order `10` §8.1 describes.
   *
   * Absent means the mode has nothing to configure, or configures itself on the way in: Playbook's
   * `route` has been its own setup screen since T-5.10.
   */
  setupRoute?(sport: SportId): string;
}

export const PLAY_MODE_CATALOGUE: readonly PlayMode[] = [
  {
    id: 'live',
    name: 'Live',
    blurb: 'Play the match yourself, in real time, one athlete at a time.',
    hint: 'Two thumbs, landscape. The hardest of the three to pick up.',
    sports: ['basketball', 'soccer'],
    route: (sport) => `#/play/live/${sport}`,
    // Who is playing, against whom, how long, and which laws are in force (T-8.2, US-10.2).
    setupRoute: (sport) => `#/play/setup/${sport}`,
  },
  {
    id: 'playbook',
    name: 'Playbook',
    blurb: 'Coach it. Call a play each turn and play the moments that matter.',
    hint: 'One thumb, no reflexes needed. The easiest way in.',
    sports: ['basketball', 'soccer'],
    // The sport rides on the query rather than the path: `/play/playbook/match` already owns the
    // segment after `playbook`, and a `:sport` pattern beside it would be two routes competing for
    // one shape. `readSetup()` reads it back at both ends of the flow.
    route: (sport) => `#/play/playbook?sport=${sport}`,
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'One skill at a time: shooting, dribbling, reactions. Twenty seconds a go.',
    hint: 'One thumb, either way up. Anyone can play it immediately.',
    sports: ['basketball', 'soccer'],
    route: (sport) => `#/play/arcade?sport=${sport}`,
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
