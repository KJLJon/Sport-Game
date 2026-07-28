/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @task    T-5.11 — Cross-mode parity tests (INV-11) and reward parity (INV-12)
 * @story   US-15.8 — Outcomes that agree across modes
 * @design  09-modes-and-arcade.md §7 (balance across modes)
 * @invariant INV-2 (seeded PRNG only), INV-11 (cross-mode outcome parity)
 *
 * Purpose: seeded rosters for the headless harnesses. The Live balance run rolls ratings inside the
 * sport module; Playbook resolves against real `Athlete` records, so a comparison of the two modes
 * needs one roster that both can be handed.
 *
 * A placeholder for T-8.11's procedural generator, and deliberately dull: attributes are drawn
 * around a tier mean with a fixed spread, so a batch is reproducible from its seed and a parity
 * failure can be replayed exactly.
 */
import { createRng, type Rng } from '../src/engine/rng.ts';
import {
  ATTRIBUTE_IDS,
  STARTING_FAMILIARITY,
  newSportSkill,
  type Athlete,
  type AttributeId,
  type Attributes,
} from '../src/athletes/types.ts';

/** Roughly the range a starting roster spans. */
export const TIERS = { weak: 42, average: 58, strong: 74 } as const;
export type Tier = keyof typeof TIERS;

function drawAttributes(rng: Rng, mean: number): Attributes {
  const out = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    out[id] = Math.max(1, Math.min(99, Math.round(rng.gaussian(mean, 9))));
  }
  return out;
}

/** One athlete at a tier. `index` only shapes the body, so a squad has guards and bigs in it. */
export function rosterAthlete(rng: Rng, mean: number, index: number, label: string): Athlete {
  const tall = index >= 3;
  return {
    id: `${label}-${index}`,
    schemaVersion: 1,
    displayName: `${label} ${index + 1}`,
    heightCm: tall ? 205 + rng.int(0, 8) : 188 + rng.int(0, 10),
    weightKg: tall ? 105 + rng.int(0, 12) : 88 + rng.int(0, 10),
    handedness: 'right',
    age: 22 + rng.int(0, 10),
    primarySport: 'basketball',
    attributes: drawAttributes(rng, mean),
    sportSkills: { basketball: newSportSkill(STARTING_FAMILIARITY.primary) },
    rarity: 'common',
    traits: [],
    condition: { stamina: 100 },
    source: 'created',
    sandbox: false,
    custodyId: `${label}-custody-${index}`,
    createdAt: 0,
    editable: true,
  };
}

/** A squad of five at a tier, from a labelled fork so two rosters never share a stream. */
export function roster(seed: string, tier: Tier = 'average', size = 5): readonly Athlete[] {
  const rng = createRng(seed).fork(`roster-${tier}`);
  return Array.from({ length: size }, (_, index) =>
    rosterAthlete(rng, TIERS[tier], index, `${tier}-${seed}`),
  );
}

/** Two evenly matched squads — the shape every balance and parity batch wants. */
export function evenRosters(
  seed: string,
  tier: Tier = 'average',
): readonly [readonly Athlete[], readonly Athlete[]] {
  return [roster(`${seed}-home`, tier), roster(`${seed}-away`, tier)];
}
