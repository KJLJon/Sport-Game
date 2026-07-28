/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.4 — Practice / scored / daily modes; seeded daily challenge
 * @story   US-16.4 — Take a daily challenge
 * @design  09-modes-and-arcade.md §3.3 (daily challenge), §6 (async challenge codes)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: today's challenge, derived from the date and nothing else — "a seeded daily run,
 * identical for everyone that day, with a fixed athlete and modifiers" (US-16.4).
 *
 * **The athlete is generated, not chosen from your roster.** "Identical for everyone" and "played
 * with your own squad" cannot both be true, and the spec picks the first. So the daily rolls its own
 * athlete from the day's seed: everybody plays the same person, and the challenge measures the run
 * rather than the collection. It is also the one arcade context where a great athlete is not
 * something you can bring — which is exactly what makes it a challenge.
 *
 * **The day boundary is UTC.** A local boundary would mean two players in different zones disagree
 * about which challenge is "today's", and a challenge code shared across a timezone would resolve
 * to a different run at each end. UTC is the honest trade: the challenge rolls over at midnight UTC
 * for everyone, and the screen says so rather than implying it follows your clock.
 */
import { createRng } from '../../engine/rng.ts';
import { rollAthlete } from '../../athletes/create.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { Difficulty } from '../difficulty.ts';
import { ARCADE_MODIFIERS, resolveModifiers, type ArcadeModifier } from './modes.ts';
import type { ArcadeConfig, ArcadeGameDef, ArcadeGameId, ArcadeModifierId } from './types.ts';

/** The daily always runs at one level, so two players' scores are comparable (`09` §7). */
export const DAILY_DIFFICULTY: Difficulty = 'pro';

/** How many twists a day gets. Two is enough to change the feel and few enough to read. */
const MODIFIERS_PER_DAY = 2;

/** `YYYY-MM-DD` in UTC — the identity of a day, and the only input the challenge has. */
export function dateKey(now: number | Date = Date.now()): string {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Milliseconds until the next UTC midnight — the "new challenge in 6h 12m" line. */
export function millisUntilNextDay(now: number = Date.now()): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return next - now;
}

/** The seed for a day's run of one game. Everything below forks from it. */
export function dailySeed(day: string, game: ArcadeGameId): string {
  return `daily:${day}:${game}`;
}

export interface DailyChallenge {
  readonly day: string;
  readonly game: ArcadeGameDef;
  readonly seed: string;
  readonly athlete: Athlete;
  readonly difficulty: Difficulty;
  readonly modifiers: readonly ArcadeModifier[];
}

/**
 * Which game today is. A rotation out of the day's own generator rather than `day % games.length`,
 * so adding a sixth game does not reshuffle the whole calendar into a different order.
 */
export function dailyGame(day: string, games: readonly ArcadeGameDef[]): ArcadeGameDef | undefined {
  if (games.length === 0) return undefined;
  // Sorted so the choice depends on *which* games exist, not on the order a registry walked them.
  const ordered = [...games].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createRng(`daily-game:${day}`).pick(ordered);
}

/** Today's twists. */
export function dailyModifiers(day: string): readonly ArcadeModifier[] {
  const rng = createRng(`daily-mods:${day}`);
  const pool = rng.shuffle([...ARCADE_MODIFIERS]);
  return pool.slice(0, MODIFIERS_PER_DAY);
}

/**
 * The athlete everyone plays today. Rolled `rare` so the day's window is interesting rather than
 * punishing, and given the game's own sport as their primary so the challenge is about the run
 * rather than about a familiarity penalty nobody chose.
 */
export function dailyAthlete(day: string, game: ArcadeGameDef): Athlete {
  const rng = createRng(`daily-athlete:${day}:${game.id}`);
  return rollAthlete(rng, {
    displayName: `Challenger ${day.slice(5)}`,
    primarySport: game.sport,
    rarity: 'rare',
    source: 'pack',
    createdAt: 0,
  });
}

/** Today's challenge, from the day and the catalogue. Pure: same inputs, same challenge, forever. */
export function dailyChallenge(
  day: string,
  games: readonly ArcadeGameDef[],
): DailyChallenge | null {
  const game = dailyGame(day, games);
  if (game === undefined) return null;

  return {
    day,
    game,
    seed: dailySeed(day, game.id),
    athlete: dailyAthlete(day, game),
    difficulty: DAILY_DIFFICULTY,
    modifiers: dailyModifiers(day),
  };
}

/** The config that plays a challenge. */
export function dailyConfig(challenge: DailyChallenge): ArcadeConfig {
  return {
    mode: 'daily',
    seed: challenge.seed,
    athlete: challenge.athlete,
    difficulty: challenge.difficulty,
    modifiers: challenge.modifiers.map((modifier) => modifier.id),
  };
}

// ── Challenge codes ─────────────────────────────────────────────────────────

/**
 * A shareable run (US-16.4 — "sharable as a challenge code so a friend can attempt the identical
 * run"). Everything needed to reconstruct the scenario, and nothing about who played it: a code is
 * an invitation, not a score claim.
 *
 * Phase 10's T-10.1 builds the asynchronous *challenge* on top of this — a code plus a score to
 * beat. The encoding is versioned so that one can extend the payload without invalidating codes
 * already in someone's messages.
 */
export interface ChallengeScenario {
  readonly game: ArcadeGameId;
  readonly seed: string;
  readonly modifiers: readonly ArcadeModifierId[];
}

const CODE_PREFIX = 'SG1';
const FIELD_SEPARATOR = '~';
/** Crockford base32 without `I`, `L`, `O`, and `U` — the four a person mistypes or misreads. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of text) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A short checksum, so a mistyped code fails immediately rather than starting the wrong run. */
function checksum(payload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ALPHABET[(hash >>> 5) & 31]! + ALPHABET[hash & 31]!;
}

/** Groups into fours, which is how people read a code aloud. */
function group(text: string): string {
  return (text.match(/.{1,4}/g) ?? []).join('-');
}

export function encodeChallenge(scenario: ChallengeScenario): string {
  const payload = [scenario.game, scenario.seed, scenario.modifiers.join(',')].join(
    FIELD_SEPARATOR,
  );
  const body = toBase32(new TextEncoder().encode(payload));
  return `${CODE_PREFIX}-${group(body)}-${checksum(payload)}`;
}

/**
 * Reads a code back. Returns `null` for anything that is not a valid code — a typo, a code from a
 * future format, a pasted sentence — because the caller's next move is the same for all of them:
 * say "that code doesn't look right" rather than start an unpredictable run.
 */
export function decodeChallenge(code: string): ChallengeScenario | null {
  const normalised = code.trim().toUpperCase().replace(/-/g, '');
  if (!normalised.startsWith(CODE_PREFIX)) return null;

  const rest = normalised.slice(CODE_PREFIX.length);
  if (rest.length < 3) return null;

  const body = rest.slice(0, -2);
  const check = rest.slice(-2);
  const bytes = fromBase32(body);
  if (bytes === null) return null;

  let payload: string;
  try {
    payload = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, '');
  } catch {
    return null;
  }

  if (checksum(payload) !== check) return null;

  const [game, seed, modifiers] = payload.split(FIELD_SEPARATOR);
  if (game === undefined || game === '' || seed === undefined || seed === '') return null;

  return {
    game,
    seed,
    modifiers: (modifiers ?? '').split(',').filter((id) => id !== ''),
  };
}

/** The code for a challenge. */
export function challengeCode(challenge: DailyChallenge): string {
  return encodeChallenge({
    game: challenge.game.id,
    seed: challenge.seed,
    modifiers: challenge.modifiers.map((modifier) => modifier.id),
  });
}

/**
 * The config that plays a decoded code, against the catalogue this build has. Returns `null` when
 * the code names a game this build does not know — a friend on a newer version, most likely — which
 * is worth saying plainly rather than silently substituting a different game.
 */
export function scenarioConfig(
  scenario: ChallengeScenario,
  games: readonly ArcadeGameDef[],
  athlete: Athlete,
): ArcadeConfig | null {
  const game = games.find((candidate) => candidate.id === scenario.game);
  if (game === undefined) return null;

  return {
    mode: 'daily',
    seed: scenario.seed,
    athlete,
    difficulty: DAILY_DIFFICULTY,
    modifiers: resolveModifiers(scenario.modifiers).map((modifier) => modifier.id),
  };
}
