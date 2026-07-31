/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-10.1 — Jump straight into a game
 * @design  09-modes-and-arcade.md §1 ("the mode selector … is remembered per sport"),
 *          10-ui-ux.md §8.2 (Quick Play)
 * @invariant INV-3 (every stored key is namespaced — `prefs` is the only door)
 *
 * Purpose: what Quick Play starts. The last sport, and the last mode *per sport*, because `09` §1
 * says the selector is remembered per sport and those are two different memories: a player whose
 * soccer is Live and whose basketball is Arcade should get both back.
 *
 * Every read is total. A remembered combination that a later build removed — a sport that is gone,
 * a mode a sport no longer offers — resolves to the nearest playable thing rather than to an error,
 * because the alternative is a home screen whose main button is broken by old data.
 */
import { prefs } from '../storage/prefs.ts';
import { DEFAULT_SPORT, isPlayable } from '../sports/playable.ts';
import type { SportId } from '../sports/types.ts';
import { isModeAvailable, modesForSport, playMode, type PlayMode } from './catalogue.ts';

const SPORT_KEY = 'play.lastSport';
const MODE_KEY_PREFIX = 'play.lastMode.';

export interface PlayChoice {
  readonly sport: SportId;
  readonly mode: PlayMode;
}

/** The remembered sport, or the default when nothing playable is stored. */
export function lastSport(): SportId {
  const stored = prefs.get<string | null>(SPORT_KEY, null);
  return isPlayable(stored ?? undefined) ? (stored as SportId) : DEFAULT_SPORT;
}

/**
 * The remembered mode for a sport, or that sport's first available one. `undefined` only when the
 * sport has no reachable mode at all — which is a real state for a sport mid-implementation.
 */
export function lastMode(sport: SportId): PlayMode | undefined {
  const available = modesForSport(sport);
  const stored = playMode(prefs.get<string | null>(MODE_KEY_PREFIX + sport, null) ?? undefined);
  if (stored !== undefined && isModeAvailable(stored, sport)) return stored;
  return available[0];
}

/**
 * What the big button on the home screen should start, or `null` when nothing has been played yet
 * and there is therefore nothing to *re*-start. The caller shows the picker instead — one tap to a
 * choice beats one tap into a match the player has never seen (`10` §8.1).
 */
export function quickPlay(): PlayChoice | null {
  // Deliberately conflates "absent" with "unreadable": if the stored sport cannot be parsed we do
  // not know what was played, and resuming an invented match is worse than offering the picker.
  // `lastSport()` still has to answer with *something* — this is the one caller that may say no.
  if (prefs.get<string | null>(SPORT_KEY, null) === null) return null;
  const sport = lastSport();
  const mode = lastMode(sport);
  return mode === undefined ? null : { sport, mode };
}

/** Records a start. Called when a match is actually launched, never when a card is merely focused. */
export function rememberPlay(sport: SportId, mode: PlayMode): void {
  prefs.set(SPORT_KEY, sport);
  prefs.set(MODE_KEY_PREFIX + sport, mode.id);
}

/** Forgets everything this module stores. For the data screen's reset, and for tests. */
export function forgetPlay(): void {
  prefs.remove(SPORT_KEY);
  for (const key of prefs.keys()) {
    if (key.startsWith(MODE_KEY_PREFIX)) prefs.remove(key);
  }
}
