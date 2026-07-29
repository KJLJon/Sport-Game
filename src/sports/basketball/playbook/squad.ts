/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §7 (ratings are the constant), 05-data-model.md §3 (derivation)
 * @invariant INV-11 (Live and Playbook agree for the same rosters)
 *
 * Purpose: turns a roster into the squad Playbook resolves against.
 *
 * **The ratings are Live's ratings, by the same route.** `deriveRatings()` with `BASKETBALL_TABLES`,
 * then the same `fatigueMultiplier` coupling `roster.ts` applies — because `09` §7 says tuning an
 * athlete's basketball ability must tune all three modes, and the only way to be sure of that is for
 * all three to walk the same path from attributes to numbers. The one addition is the body
 * attributes the derivation does not gate on familiarity (`05` §3.1): strength and awareness are
 * facts about a person, not about how well they know basketball.
 */
import type { EntityId } from '../../../engine/world.ts';
import type { Side } from '../../../engine/match/events.ts';
import type { Athlete } from '../../../athletes/types.ts';
import { deriveRatings, type DerivedRatings } from '../../../athletes/derivation.ts';
import { fatigueMultiplier } from '../../../athletes/condition.ts';
import { bestPosition } from '../../../athletes/derivation.ts';
import { BASKETBALL_POSITION_WEIGHTS } from '../weights.ts';
import { BASKETBALL_SPORT_ID, BASKETBALL_TABLES } from '../roster.ts';
import type { PlaybookAthlete, PlaybookSquad } from '../../../modes/playbook/types.ts';

/** Attributes the sport reads directly, ungated by familiarity (`05` §3.1). */
const BODY_ATTRIBUTES = [
  'composure',
  'agility',
  'strength',
  'vertical',
  'discipline',
  'awareness',
  'stamina',
] as const;

/** Every number a Playbook turn can read off one athlete. */
export function playbookRatings(athlete: Athlete): DerivedRatings {
  const derived = deriveRatings(athlete, BASKETBALL_SPORT_ID, BASKETBALL_TABLES);
  const fatigue = fatigueMultiplier(athlete.condition.stamina);

  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(derived)) {
    out[name] = Math.max(1, Math.round(value * fatigue));
  }
  for (const name of BODY_ATTRIBUTES) {
    out[name] = athlete.attributes[name];
  }
  return out;
}

/**
 * Builds one side's floor. Entity ids follow Live's convention — side 0 takes `0…n-1`, side 1 takes
 * `100…100+n-1` — so a box score built from a Playbook match reads the same way as one built from
 * a Live match, and the parity harness can compare them without a translation table.
 */
export function basketballSquad(athletes: readonly Athlete[], side: Side): PlaybookSquad {
  const base = side === 1 ? 100 : 0;
  const players: PlaybookAthlete[] = athletes.map((athlete, index) => {
    const ratings = playbookRatings(athlete);
    return {
      id: (base + index) as EntityId,
      athlete,
      ratings,
      role: bestPosition(ratings, BASKETBALL_POSITION_WEIGHTS)?.position ?? 'PG',
      // Playbook's stamina is the *match's* stamina, starting from the athlete's condition. The
      // stored `condition.stamina` is 0–100; the turn model works in 0–1.
      stamina: Math.max(0.45, Math.min(1, athlete.condition.stamina / 100)),
    };
  });

  return { side, players };
}

export function basketballSquads(
  home: readonly Athlete[],
  away: readonly Athlete[],
): readonly [PlaybookSquad, PlaybookSquad] {
  return [basketballSquad(home, 0), basketballSquad(away, 1)];
}
