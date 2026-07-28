/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.11 — Arcade hot-seat: party rounds, seeded fairness, ranking, elimination formats
 * @story   US-17.3 — Be recognised by name
 * @design  09-modes-and-arcade.md §4 (hot-seat local multiplayer), 08-open-questions.md Q-13
 * @invariant INV-3 (all storage through `src/storage/`)
 *
 * Purpose: the names of the people who play on this device, so a party screen says "Dad" and "Ana"
 * rather than "Player 2".
 *
 * **Names, not save slots.** `08` Q-13 settles this: a local player is a label on a seat, not a
 * profile — there is one save file, one roster, one set of achievements. Keeping them as names
 * avoids the entire question of whose athletes are whose, which is a question nobody sitting on a
 * sofa passing a phone around was asking.
 *
 * **Local only, and deletable.** US-17.3 is explicit that these are never transmitted, so they live
 * in preferences rather than in the database: nothing here goes into a backup, a roster export, or
 * a P2P handshake, and there is nowhere for them to leak from.
 */
import { prefs } from '../storage/prefs.ts';

const KEY = 'party.players';

/** `09` §4 — two to four people, passing one device. */
export const PARTY_LIMITS = { min: 2, max: 4 } as const;

export const MAX_NAME_LENGTH = 16;

export interface LocalPlayer {
  readonly id: string;
  readonly name: string;
}

function isPlayerArray(value: unknown): value is LocalPlayer[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as LocalPlayer).id === 'string' &&
        typeof (entry as LocalPlayer).name === 'string',
    )
  );
}

/**
 * A name is trimmed and length-capped, never rejected: a blank one becomes a numbered seat, because
 * "Player 3" is recoverable and refusing to start the game is not.
 */
export function cleanName(name: string, seat: number): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed === '' ? `Player ${seat}` : trimmed;
}

export function loadPlayers(): readonly LocalPlayer[] {
  return prefs.get<LocalPlayer[]>(KEY, [], isPlayerArray);
}

/** Replaces the stored list. Returns false when storage refused (private mode, or full). */
export function savePlayers(players: readonly LocalPlayer[]): boolean {
  return prefs.set(KEY, players.slice(0, PARTY_LIMITS.max));
}

export function forgetPlayers(): void {
  prefs.remove(KEY);
}

/**
 * A party of `count` seats, reusing remembered names for the seats that have them and numbering the
 * rest. Ids are stable across a session so a mid-party rename does not orphan anyone's scores.
 */
export function seatPlayers(count: number, remembered = loadPlayers()): readonly LocalPlayer[] {
  const seats = Math.min(PARTY_LIMITS.max, Math.max(PARTY_LIMITS.min, Math.round(count)));
  return Array.from({ length: seats }, (_, index) => {
    const existing = remembered[index];
    const id = existing?.id ?? `seat-${index + 1}`;
    return { id, name: cleanName(existing?.name ?? '', index + 1) };
  });
}

/** Renames one seat, leaving the rest alone. */
export function renamePlayer(
  players: readonly LocalPlayer[],
  id: string,
  name: string,
): readonly LocalPlayer[] {
  return players.map((player, index) =>
    player.id === id ? { ...player, name: cleanName(name, index + 1) } : player,
  );
}
