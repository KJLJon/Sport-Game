/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.13 — Soccer derivation weights, sub-skills, familiarity tuning
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3 (XP and sub-skills), 06-game-design.md §3.2
 *
 * Purpose: which soccer events train which soccer sub-skills — basketball's `xp.ts` row for the
 * second sport.
 *
 * The table lives here for the same reason the weights do: only soccer knows that a `shot` with
 * `zone: 'sixYard'` is a tap-in and that `soccer.card` is a discipline event. The athlete layer must
 * never learn either. Adding a sport adds a table.
 *
 * **Attempts pay, makes pay properly.** Carried over from basketball deliberately: an athlete who
 * only earns XP for goals learns fastest by never attempting a hard one, which is the opposite of
 * what the game should encourage.
 *
 * **Defending had to be paid differently from basketball, and that is the interesting part.** A
 * basketball steal is a discrete event you either got or didn't. Soccer's defending is mostly *not*
 * events — it is standing in the right place for ninety minutes — and an XP table can only pay for
 * things that emit. So a won tackle pays `tackling` well, and `marking` is paid from the events that
 * imply good positioning happened: an interception, and the opponent's shot being forced wide. That
 * is an honest approximation rather than a good one, and it is flagged as the place to look if
 * defenders in this game turn out to learn too slowly.
 */
import { EventKind } from '../../engine/match/events.ts';
import type { XpAwardTable } from '../types.ts';
import { SoccerEvent } from './rules.ts';

/**
 * Every rating named here exists in `SOCCER_WEIGHTS`; a test asserts it, because a typo would
 * quietly train a sub-skill that derivation never reads.
 *
 * @spec-ref 05-data-model.md §3.3
 */
export const SOCCER_XP_AWARDS: XpAwardTable = [
  // Shots, by where they were struck from. `shotZone` names these (T-6.1).
  { kind: EventKind.SHOT, when: { zone: 'sixYard' }, rating: 'finishing', xp: 4 },
  { kind: EventKind.SHOT, when: { zone: 'penaltyArea' }, rating: 'finishing', xp: 5 },
  { kind: EventKind.SHOT, when: { zone: 'edgeOfBox' }, rating: 'shotPower', xp: 6 },
  { kind: EventKind.SHOT, when: { zone: 'longRange' }, rating: 'shotPower', xp: 6 },
  { kind: EventKind.SHOT, when: { zone: 'wide' }, rating: 'finishing', xp: 4 },
  // A hopeful punt from forty metres is not a skill, but it still cost the effort.
  { kind: EventKind.SHOT, when: { zone: 'speculative' }, xp: 1 },

  // A goal. `score` carries the value but not the zone, so it pays a flat bonus on top of the
  // attempt rather than trying to re-derive where it came from — same shape as basketball's.
  { kind: EventKind.SCORE, rating: 'finishing', xp: 9 },

  // Passing, by the kind of pass. A cross trains crossing, which is why it is its own pass type.
  { kind: EventKind.PASS, when: { kind: 'short' }, rating: 'shortPass', xp: 2 },
  { kind: EventKind.PASS, when: { kind: 'through' }, rating: 'shortPass', xp: 4 },
  { kind: EventKind.PASS, when: { kind: 'lofted' }, rating: 'longPass', xp: 4 },
  { kind: EventKind.PASS, when: { kind: 'cross' }, rating: 'crossing', xp: 5 },

  // Defending. See the header: a won tackle is an event, and good marking mostly is not.
  { kind: EventKind.TURNOVER, rating: 'marking', xp: 3, targetRating: 'dribbling', targetXp: 1 },
  {
    kind: EventKind.SPORT,
    sportKind: SoccerEvent.OFFSIDE,
    // The defence held a line well enough to catch someone. Paid to the *caught* side's runner too,
    // at a lower rate: getting the timing wrong is how anyone learns to time a run.
    rating: 'offBall',
    xp: 2,
  },

  // Goalkeeping. A save is the one keeper action that reliably emits.
  { kind: EventKind.SAVE, rating: 'goalkeeping', xp: 7 },

  // Discipline. A card trains nothing — you do not get better at soccer by being booked — but the
  // event is here so the stream is fully accounted for and a future rule can hang off it.
  { kind: EventKind.SPORT, sportKind: SoccerEvent.CARD, xp: 0 },
];
