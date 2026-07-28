/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.5 — Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3 (XP and sub-skills)
 *
 * Purpose: which basketball events train which basketball sub-skills. `05` §3.3 gives the shape —
 * "a made three grants three-point XP, a tackle grants tackling XP" — and this is basketball's row
 * of it.
 *
 * The table lives here rather than in the athlete layer for the same reason the weights do: only
 * basketball knows that a `shot` with `zone: 'cornerThree'` is a three-pointer, and the athlete
 * layer must never learn it. Adding a sport adds a table.
 *
 * **Attempts are worth less than makes, but they are not worth nothing.** Practice is how anyone
 * learns to shoot, and an athlete who only ever gets XP for makes learns fastest by never taking a
 * hard shot — the opposite of what the game wants to encourage. So a shot pays a little and a
 * basket pays properly.
 */
import { EventKind } from '../../engine/match/events.ts';
import type { XpAwardTable } from '../types.ts';
import { BasketballEvent } from './rules.ts';

/**
 * Every rating named here exists in `BASKETBALL_WEIGHTS`; a test asserts it, because a typo would
 * quietly train a sub-skill that derivation never reads.
 *
 * @spec-ref 05-data-model.md §3.3
 */
export const BASKETBALL_XP_AWARDS: XpAwardTable = [
  // Shot attempts, by zone. `courtSpeed` and `interiorD` are trained elsewhere.
  { kind: EventKind.SHOT, when: { zone: 'restricted' }, rating: 'finishing', xp: 4 },
  { kind: EventKind.SHOT, when: { zone: 'paint' }, rating: 'finishing', xp: 4 },
  { kind: EventKind.SHOT, when: { zone: 'midRange' }, rating: 'midRange', xp: 5 },
  { kind: EventKind.SHOT, when: { zone: 'cornerThree' }, rating: 'threePoint', xp: 6 },
  { kind: EventKind.SHOT, when: { zone: 'wingThree' }, rating: 'threePoint', xp: 6 },
  { kind: EventKind.SHOT, when: { zone: 'topThree' }, rating: 'threePoint', xp: 6 },
  { kind: EventKind.SHOT, when: { zone: 'freeThrow' }, rating: 'freeThrow', xp: 5 },
  // A heave is not a skill and does not train one; it still pays the minutes it took.
  { kind: EventKind.SHOT, when: { zone: 'heave' }, xp: 1 },

  // Makes. `score` carries the points in `value` but not the zone, so the make pays a flat bonus
  // on top of the attempt rather than trying to re-derive where it came from.
  { kind: EventKind.SCORE, rating: 'finishing', xp: 8 },

  { kind: EventKind.PASS, rating: 'passing', xp: 3, targetRating: 'ballHandling', targetXp: 1 },
  { kind: EventKind.REBOUND, rating: 'rebounding', xp: 6 },
  // A foul is a discipline lesson — the one award an athlete earns by getting it wrong.
  { kind: EventKind.FOUL, rating: 'perimeterD', xp: 2 },
  { kind: EventKind.SAVE, rating: 'interiorD', xp: 6, targetRating: 'finishing', targetXp: 1 },

  { kind: EventKind.SPORT, sportKind: BasketballEvent.STEAL, rating: 'perimeterD', xp: 7 },
  { kind: EventKind.SPORT, sportKind: BasketballEvent.BLOCK, rating: 'interiorD', xp: 7 },
  { kind: EventKind.SPORT, sportKind: BasketballEvent.INTERCEPTION, rating: 'perimeterD', xp: 6 },
  { kind: EventKind.SPORT, sportKind: BasketballEvent.PASS_DEFLECTED, rating: 'perimeterD', xp: 3 },
  { kind: EventKind.SPORT, sportKind: BasketballEvent.BLOW_BY, rating: 'ballHandling', xp: 5 },
  { kind: EventKind.SPORT, sportKind: BasketballEvent.CONTACT, rating: 'interiorD', xp: 2 },
];
