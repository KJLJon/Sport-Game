/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §7 (ratings are the constant), 05-data-model.md §3 (derivation)
 * @invariant INV-11 (Live and Playbook agree for the same rosters), INV-6 (no mode branching)
 *
 * Purpose: turns a roster into the squad soccer's Playbook resolves against.
 *
 * **The same route Live takes.** `soccerRatings()` is the function the Live sim calls, fatigue
 * coupling included, so an athlete who is better at soccer is better at it in all three modes by
 * construction rather than by two tables agreeing. Basketball's `playbook/squad.ts` re-implements
 * the fatigue step because its Live path applies it elsewhere; soccer's does not have to, and this
 * file is shorter for it.
 *
 * **Roles come from the formation, not from `bestPosition()`.** Soccer is eleven fixed jobs and a
 * 4-4-2 has exactly one left back. Handing the eleventh-best athlete the role the formation lists
 * eleventh is both what Live's `createState` does and the only way a Playbook squad and a Live
 * squad line up in the box score.
 */
import type { EntityId } from '../../../engine/world.ts';
import type { Side } from '../../../engine/match/events.ts';
import type { Athlete } from '../../../athletes/types.ts';
import type { DerivedRatings } from '../../../athletes/derivation.ts';
import type { PlaybookAthlete, PlaybookSquad } from '../../../modes/playbook/types.ts';
import { DEFAULT_FORMATION, FORMATIONS, formation } from '../formations.ts';
import { soccerRatings } from '../roster.ts';

/** Playbook reads ratings by name off a flat record; `SoccerRatings` already is one. */
export function soccerPlaybookRatings(athlete: Athlete): DerivedRatings {
  return { ...soccerRatings(athlete) };
}

/**
 * Builds one side's eleven. Entity ids follow Live's convention — side 0 takes `0…n-1`, side 1 takes
 * `100…100+n-1` — so a box score built from a Playbook match reads the same way as one built from a
 * Live match, and index 0 is the goalkeeper in both.
 */
export function soccerSquad(
  athletes: readonly Athlete[],
  side: Side,
  formationId: string = DEFAULT_FORMATION,
): PlaybookSquad {
  const roles = formation(formationId).roles;
  const base = side === 1 ? 100 : 0;

  const players: PlaybookAthlete[] = athletes.slice(0, roles.length).map((athlete, index) => ({
    id: (base + index) as EntityId,
    athlete,
    ratings: soccerPlaybookRatings(athlete),
    role: (roles[index] as { id: string }).id,
    // Playbook's stamina is the match's stamina, starting from the athlete's stored condition. The
    // stored figure is 0–100; the turn model works in 0–1. The floor matches basketball's: `06`
    // §3.2's fatigue slows a player down and never switches them off.
    stamina: Math.max(0.45, Math.min(1, athlete.condition.stamina / 100)),
  }));

  return { side, players };
}

export function soccerSquads(
  home: readonly Athlete[],
  away: readonly Athlete[],
  formationId: string = DEFAULT_FORMATION,
): readonly [PlaybookSquad, PlaybookSquad] {
  return [soccerSquad(home, 0, formationId), soccerSquad(away, 1, formationId)];
}

/** The goalkeeper: the formation's first role, as Live spawns it. */
export function keeperOf(squad: PlaybookSquad): PlaybookAthlete {
  return squad.players[0] as PlaybookAthlete;
}

/** Everybody but the keeper — who a phase turn can actually be about. */
export function outfieldOf(squad: PlaybookSquad): readonly PlaybookAthlete[] {
  return squad.players.slice(1);
}

/**
 * Which side of the pitch a role lives on — what T-6.19's focus intent steers play towards.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — "Focus — a flank, a channel, or a specific athlete"
 */
export type Channel = 'left' | 'centre' | 'right';

/**
 * The channel a formation role belongs to, from the role's own `y` across every formation that
 * names it.
 *
 * Averaging rather than picking one formation is deliberate: `lcb` sits at 0.38 in 4-4-2 and 0.30 in
 * 3-5-2, and a squad's formation is chosen when the squad is built rather than carried on every
 * athlete. The thresholds are wide enough that the averaging cannot flip an answer — the widest
 * central role averages 0.41 and the narrowest wide one 0.16, with the boundary at 0.30. A
 * *left*-sided centre back is a centre back, which is why the boundary is not at the halfway point.
 */
export function channelOf(roleId: string): Channel {
  let total = 0;
  let count = 0;
  for (const shape of FORMATIONS) {
    for (const role of shape.roles) {
      if (role.id !== roleId) continue;
      total += role.y;
      count += 1;
    }
  }
  if (count === 0) return 'centre';

  const y = total / count;
  if (y < 0.3) return 'left';
  return y > 0.7 ? 'right' : 'centre';
}
