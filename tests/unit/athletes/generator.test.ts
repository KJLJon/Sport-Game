/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.11 — Procedural athlete generator: rarity-coherent attribute spreads, fictional names
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §2, §4
 * @invariant INV-1 (rarity sets the size of a spread; an archetype only its shape), INV-8 (seeded)
 *
 * Purpose: that a generated athlete is a person rather than a blob, and that making them one never
 * makes them *better*.
 *
 * The INV-1 case is the load-bearing one. It would be very easy — and completely invisible from the
 * outside — for archetype shaping to leak a few points into an athlete's total, at which point
 * rarity would no longer be the only thing that decides how good somebody is.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import {
  ARCHETYPES,
  ARCHETYPE_COHERENCE,
  generateAthlete,
  generateSquad,
  rollRarity,
} from '@/athletes/generator.ts';
import { NAME_COMBINATIONS, rollName, uniqueName } from '@/athletes/names.ts';
import { attributeTotal } from '@/athletes/types.ts';
import { rollAthlete } from '@/athletes/create.ts';
import { RARITIES, type Rarity } from '@/athletes/types.ts';

const SPORTS = ['basketball', 'soccer'];

/**
 * `createdAt` is pinned in every case that compares two athletes.
 *
 * It is the one field on a generated athlete that is not a function of the seed — a pack athlete was
 * created when the pack was opened — so leaving it to `Date.now()` makes an equality assertion pass
 * or fail on whether the two calls landed in the same millisecond.
 */
const CREATED_AT = 1_700_000_000_000;

function generate(seed: string, rarity: Rarity = 'rare') {
  return generateAthlete(createRng(seed), { rarity, sports: SPORTS, createdAt: CREATED_AT });
}

describe('INV-1 — shape, never size', () => {
  it('leaves the attribute total exactly where the rarity roll put it', () => {
    // The whole invariant in one assertion: an archetype moves points, it never mints them.
    for (const rarity of RARITIES) {
      for (let seed = 0; seed < 25; seed++) {
        const rng = createRng(`total-${rarity}-${seed}`);
        const generated = generateAthlete(rng, { rarity, sports: SPORTS });

        const unshaped = rollAthlete(createRng(`total-${rarity}-${seed}`).fork('roll'), {
          displayName: generated.athlete.displayName,
          primarySport: generated.athlete.primarySport,
          rarity,
          source: 'pack',
        });

        expect(attributeTotal(generated.athlete.attributes)).toBe(
          attributeTotal(unshaped.attributes),
        );
      }
    }
  });

  it('pulls harder at higher rarities, which is shape and not points', () => {
    // What a legendary buys is a sharper athlete, not a secretly larger budget.
    for (let index = 1; index < RARITIES.length; index++) {
      const lower = RARITIES[index - 1] as Rarity;
      const higher = RARITIES[index] as Rarity;
      expect(ARCHETYPE_COHERENCE[higher]).toBeGreaterThan(ARCHETYPE_COHERENCE[lower]);
    }
    expect(ARCHETYPE_COHERENCE.legendary).toBeLessThan(1);
  });
});

describe('an athlete with a shape', () => {
  it('is better at what its archetype wants than at what it does not', () => {
    // Averaged over seeds: one athlete can roll badly at the thing they are supposed to be good at,
    // and asserting per-athlete would be asserting the noise.
    for (const archetype of ARCHETYPES) {
      let wanted = 0;
      let other = 0;

      for (let seed = 0; seed < 40; seed++) {
        const { athlete } = generateAthlete(createRng(`shape-${archetype.id}-${seed}`), {
          rarity: 'legendary',
          sports: SPORTS,
          archetype,
        });
        const wants = new Set(archetype.wants);
        for (const [id, value] of Object.entries(athlete.attributes)) {
          if (wants.has(id as never)) wanted += value;
          else other += value;
        }
      }

      expect(wanted / (archetype.wants.length * 40)).toBeGreaterThan(other / (9 * 40));
    }
  });

  it('gives an archetype a body that agrees with it', () => {
    const anchor = ARCHETYPES.find((a) => a.id === 'anchor')!;
    const sprinter = ARCHETYPES.find((a) => a.id === 'sprinter')!;

    let anchorHeight = 0;
    let sprinterHeight = 0;
    for (let seed = 0; seed < 30; seed++) {
      anchorHeight += generateAthlete(createRng(`body-${seed}`), {
        rarity: 'rare',
        sports: SPORTS,
        archetype: anchor,
      }).athlete.heightCm;
      sprinterHeight += generateAthlete(createRng(`body-${seed}`), {
        rarity: 'rare',
        sports: SPORTS,
        archetype: sprinter,
      }).athlete.heightCm;
    }

    expect(anchorHeight).toBeGreaterThan(sprinterHeight);
  });

  it('produces more than one kind of athlete across seeds', () => {
    // The failure this replaced: every rolled athlete drawn from one gaussian, so a pack of ten was
    // ten slightly different blobs, none of them anybody.
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(generate(`variety-${seed}`).archetype.id);
    expect(seen.size).toBeGreaterThan(4);
  });

  it('rolls a primary sport from the ones this build has', () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(SPORTS).toContain(generate(`sport-${seed}`).athlete.primarySport);
    }
  });

  it('refuses to roll when there is no sport to roll from', () => {
    expect(() => generateAthlete(createRng('x'), { rarity: 'rare', sports: [] })).toThrow();
  });
});

describe('determinism (INV-8)', () => {
  it('produces the same athlete from the same seed', () => {
    expect(generate('same').athlete).toEqual(generate('same').athlete);
  });

  it('produces different athletes from different seeds', () => {
    expect(generate('a').athlete.attributes).not.toEqual(generate('b').athlete.attributes);
  });
});

describe('squads', () => {
  it('has no two athletes with the same name', () => {
    const squad = generateSquad('squad-seed', { rarity: 'rare', sports: SPORTS, size: 11 });
    const names = squad.map((entry) => entry.athlete.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is deterministic as a whole', () => {
    const options = { rarity: 'epic' as const, sports: SPORTS, size: 5, createdAt: CREATED_AT };
    const a = generateSquad('squad', options);
    const b = generateSquad('squad', options);
    expect(a.map((x) => x.athlete)).toEqual(b.map((x) => x.athlete));
  });
});

describe('names', () => {
  it('draws a two-part fictional name', () => {
    expect(rollName(createRng('name'))).toMatch(/^\S+ \S+$/);
  });

  it('has a pool large enough that the numbered fallback is not an ordinary outcome', () => {
    expect(NAME_COMBINATIONS).toBeGreaterThan(5000);
  });

  it('never repeats a name it has already handed out', () => {
    const used = new Set<string>();
    const rng = createRng('unique');
    for (let index = 0; index < 200; index++) uniqueName(rng, used);
    expect(used.size).toBe(200);
  });
});

describe('rarity odds', () => {
  it('respects the weights it is given', () => {
    const rng = createRng('odds');
    const counts = new Map<Rarity, number>();
    for (let index = 0; index < 2000; index++) {
      const rarity = rollRarity(rng, { common: 90, legendary: 10 });
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }

    expect(counts.get('common')! / 2000).toBeGreaterThan(0.85);
    expect(counts.get('legendary')! / 2000).toBeGreaterThan(0.05);
    expect(counts.get('rare')).toBeUndefined();
  });

  it('falls back to common rather than throwing on odds that add to nothing', () => {
    // A malformed pack definition should hand out a bad pull, not break the store.
    expect(rollRarity(createRng('zero'), {})).toBe('common');
    expect(rollRarity(createRng('negative'), { rare: -5 })).toBe('common');
  });
});
