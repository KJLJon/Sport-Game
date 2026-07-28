/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.12 — Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best
 * @story   US-6.2 — Set a lineup
 * @story   US-6.3 — See fatigue and availability
 * @design  05-data-model.md §3.4 (overall and position fit), 10-ui-ux.md §11
 * @invariant INV-5 (no sport-specific branching — positions come from the sport module)
 *
 * Purpose: the arithmetic behind the lineup editor — what an athlete is worth in a slot, which
 * slots are a poor fit, and what "auto-fill best" actually means.
 *
 * **Auto-fill is an assignment problem, and the naive answer has a bias.** Walking the positions in
 * order and giving each its best remaining athlete makes the *first* position's needs outrank every
 * other, which is the same shape of bug as tie-breaking in entity-id order: nothing looks wrong,
 * and the result is systematically skewed. So candidates are ranked globally by what they are worth
 * in a slot, and the best pairing is taken first regardless of which position it belongs to. Ties
 * break on athlete id, so the same roster always produces the same lineup.
 *
 * It is greedy rather than optimal. For five slots the difference is small and the behaviour is
 * explainable — "your best player went to their best position" is what a player expects, and an
 * optimal solver that moved someone off their best spot to raise a team total by one point would
 * read as a bug.
 */
import { deriveRatings, sportOverall, type SportRatingTables } from '../athletes/derivation.ts';
import { availability } from '../athletes/condition.ts';
import { DERIVATION } from '../athletes/tuning.ts';
import type { Athlete } from '../athletes/types.ts';
import type { SportId } from '../sports/types.ts';
import { squadIsValid, type Squad } from './types.ts';

/** A position an athlete can be slotted into, from the sport's own `RoleTable`. */
export interface LineupSlot {
  readonly id: string;
  readonly name: string;
  /** Fractions of the field, for the formation diagram. */
  readonly x: number;
  readonly y: number;
}

export interface SlotAssessment {
  readonly slot: LineupSlot;
  readonly athlete: Athlete | null;
  /** The athlete's overall judged by *this* slot's weights, not their best. */
  readonly rating: number;
  /** `overall(here) / overall(their best position)` — `05` §3.4. */
  readonly fit: number;
  /** Under the threshold. Warns in the editor, never blocks (`05` §3.4). */
  readonly warn: boolean;
  /** Set when the athlete cannot play at all — injured or suspended (US-6.3). */
  readonly unavailable: string | null;
}

/** What this athlete is worth in this specific slot, and how well it suits them. */
export function assess(
  athlete: Athlete,
  sport: SportId,
  slotId: string,
  tables: SportRatingTables,
): { rating: number; fit: number; warn: boolean } {
  const positionWeights = tables.positionWeights?.[slotId];
  const best = sportOverall(athlete, sport, tables);

  if (positionWeights === undefined) {
    // A sport with no weights for this slot has no opinion: everyone fits equally.
    return { rating: best.overall, fit: 1, warn: false };
  }

  const ratings = deriveRatings(athlete, sport, tables);
  let sum = 0;
  for (const [rating, weight] of Object.entries(positionWeights))
    sum += weight * (ratings[rating] ?? 0);

  const here = Math.round(sum);
  const fit = best.overall <= 0 ? 1 : here / best.overall;
  return { rating: here, fit, warn: fit < DERIVATION.positionFitWarning };
}

/** Every slot in the formation, with whoever is in it and how well they fit (US-6.2). */
export function assessSquad(options: {
  readonly squad: Squad;
  readonly slots: readonly LineupSlot[];
  readonly roster: ReadonlyMap<string, Athlete>;
  readonly sport: SportId;
  readonly tables: SportRatingTables;
  readonly now: number;
}): SlotAssessment[] {
  return options.slots.map((slot) => {
    const athleteId = options.squad.starters[slot.id];
    const athlete = athleteId === undefined ? undefined : options.roster.get(athleteId);

    if (athlete === undefined) {
      return { slot, athlete: null, rating: 0, fit: 0, warn: false, unavailable: null };
    }

    const { rating, fit, warn } = assess(athlete, options.sport, slot.id, options.tables);
    const state = availability(athlete, options.now);

    return {
      slot,
      athlete,
      rating,
      fit,
      warn,
      unavailable: state.available ? null : state.label,
    };
  });
}

/** Team strength: the mean of the filled slots' ratings. Empty slots count as zero, not as absent. */
export function lineupStrength(assessments: readonly SlotAssessment[]): number {
  if (assessments.length === 0) return 0;
  const total = assessments.reduce((sum, entry) => sum + entry.rating, 0);
  return Math.round(total / assessments.length);
}

export interface AutoFillOptions {
  readonly slots: readonly LineupSlot[];
  readonly candidates: readonly Athlete[];
  readonly sport: SportId;
  readonly tables: SportRatingTables;
  readonly now: number;
  /** Skip injured and suspended athletes. On by default — a blocked athlete is not a lineup. */
  readonly skipUnavailable?: boolean;
  /** Bench size to fill after the starters. */
  readonly benchSize?: number;
}

/**
 * The strongest legal lineup (US-6.2 — "auto-fill best").
 *
 * Every (athlete, slot) pairing is scored, then taken best-first, so no position gets first pick
 * merely by being first in the table. Deterministic: equal scores break on athlete id, so the same
 * roster and the same moment always produce the same lineup.
 */
export function autoFill(options: AutoFillOptions): {
  starters: Record<string, string>;
  bench: string[];
} {
  const eligible =
    (options.skipUnavailable ?? true)
      ? options.candidates.filter((athlete) => availability(athlete, options.now).available)
      : [...options.candidates];

  const pairings: { athleteId: string; slotId: string; rating: number }[] = [];
  for (const athlete of eligible) {
    for (const slot of options.slots) {
      pairings.push({
        athleteId: athlete.id,
        slotId: slot.id,
        rating: assess(athlete, options.sport, slot.id, options.tables).rating,
      });
    }
  }

  // Best pairing first, ties broken deterministically rather than by insertion order.
  pairings.sort(
    (a, b) =>
      b.rating - a.rating ||
      a.athleteId.localeCompare(b.athleteId) ||
      a.slotId.localeCompare(b.slotId),
  );

  const starters: Record<string, string> = {};
  const taken = new Set<string>();
  const filled = new Set<string>();

  for (const pairing of pairings) {
    if (filled.size === options.slots.length) break;
    if (filled.has(pairing.slotId) || taken.has(pairing.athleteId)) continue;
    starters[pairing.slotId] = pairing.athleteId;
    filled.add(pairing.slotId);
    taken.add(pairing.athleteId);
  }

  // The bench is the best of the rest by their own best position, so a strong specialist outranks
  // a mediocre generalist — which is what a substitute is for.
  const bench = eligible
    .filter((athlete) => !taken.has(athlete.id))
    .map((athlete) => ({
      id: athlete.id,
      rating: sportOverall(athlete, options.sport, options.tables).overall,
    }))
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
    .slice(0, options.benchSize ?? 5)
    .map((entry) => entry.id);

  return { starters, bench };
}

/** Swaps two slots, or moves an athlete into an empty one. The editor's only mutation. */
export function place(squad: Squad, slotId: string, athleteId: string | null, now: number): Squad {
  const starters = { ...squad.starters };

  // If this athlete is already in another slot, moving them must vacate it rather than clone them.
  if (athleteId !== null) {
    for (const [id, occupant] of Object.entries(starters)) {
      if (occupant === athleteId && id !== slotId) {
        const displaced = starters[slotId];
        if (displaced === undefined || displaced === '') delete starters[id];
        else starters[id] = displaced;
      }
    }
  }

  if (athleteId === null) delete starters[slotId];
  else starters[slotId] = athleteId;

  return {
    ...squad,
    starters,
    bench: squad.bench.filter((id) => id !== athleteId),
    updatedAt: now,
  };
}

/** Whether this squad can start a match, and what to say if not (`10` §10). */
export function lineupStatus(
  assessments: readonly SlotAssessment[],
  squad: Squad,
  squadSize: number,
): { ready: boolean; message: string } {
  const empty = assessments.filter((entry) => entry.athlete === null).length;
  if (empty > 0) {
    return {
      ready: false,
      message: empty === 1 ? 'One slot still empty' : `${empty} slots still empty`,
    };
  }

  const blocked = assessments.filter((entry) => entry.unavailable !== null);
  if (blocked.length > 0) {
    const names = blocked.map((entry) => entry.athlete?.displayName ?? '').join(', ');
    return { ready: false, message: `Cannot play: ${names}` };
  }

  if (!squadIsValid(squad, squadSize)) {
    return { ready: false, message: 'Somebody is named twice in this lineup' };
  }

  const warned = assessments.filter((entry) => entry.warn).length;
  if (warned > 0) {
    return {
      ready: true,
      message:
        warned === 1
          ? 'Ready — one athlete is out of position'
          : `Ready — ${warned} athletes are out of position`,
    };
  }

  return { ready: true, message: 'Ready to play' };
}
