/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.9 — CPU team generation: coherent opponents and identities scaled to difficulty
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §7, 02 US-7.1 / US-7.2
 * @invariant INV-1 (difficulty never changes an attribute or a derived rating), INV-8
 *
 * Purpose: the one test that matters here is "the same points at every level" — it is the form
 * INV-1 could be broken in by a roster generator, and the reason this module reshapes a squad
 * instead of improving one.
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../../src/modes/difficulty.ts';
import { CPU_STYLES, generateCpuTeam, shapeToward } from '../../../src/teams/cpu-team.ts';
import { ATTRIBUTE_IDS, attributeTotal, type Attributes } from '../../../src/athletes/types.ts';
import { CREST_IDS, TEAM_BOUNDS, TEAM_PALETTES } from '../../../src/teams/types.ts';

const team = (seed: string, difficulty: (typeof DIFFICULTIES)[number] = 'pro', size = 5) =>
  generateCpuTeam({ seed, sportId: 'basketball', size, difficulty });

const flat: Attributes = Object.fromEntries(
  ATTRIBUTE_IDS.map((id) => [id, 50]),
) as unknown as Attributes;

describe('difficulty buys coherence, never points (INV-1)', () => {
  it('fields the same total attributes at every level, seed for seed', () => {
    const totals = DIFFICULTIES.map((difficulty) =>
      team('same-points', difficulty).athletes.reduce(
        (sum, athlete) => sum + attributeTotal(athlete.attributes),
        0,
      ),
    );

    for (const total of totals) expect(total).toBe(totals[0]);
  });

  it('gives every athlete the same points they were rolled with, one by one', () => {
    // Not just the squad total — a generator that took from one athlete and gave to another would
    // pass the sum and still be handing the CPU a star.
    const rookie = team('per-athlete', 'rookie').athletes;
    const legend = team('per-athlete', 'legend').athletes;

    expect(legend).toHaveLength(rookie.length);
    for (const [index, athlete] of legend.entries()) {
      expect(attributeTotal(athlete.attributes)).toBe(
        attributeTotal((rookie[index] as (typeof rookie)[number]).attributes),
      );
    }
  });

  it('does shape them differently, or the level would mean nothing', () => {
    const rookie = team('shape', 'rookie');
    const legend = team('shape', 'legend');

    const wanted = (squad: typeof rookie): number =>
      squad.athletes.reduce(
        (sum, athlete) =>
          sum + squad.style.wants.reduce((inner, id) => inner + athlete.attributes[id], 0),
        0,
      );

    expect(legend.style.id).toBe(rookie.style.id);
    expect(wanted(legend)).toBeGreaterThan(wanted(rookie));
  });

  it('builds a more coherent side at every step up the ladder', () => {
    const wanted = (difficulty: (typeof DIFFICULTIES)[number]): number => {
      const squad = team('ladder', difficulty);
      return squad.athletes.reduce(
        (sum, athlete) =>
          sum + squad.style.wants.reduce((inner, id) => inner + athlete.attributes[id], 0),
        0,
      );
    };

    const steps = DIFFICULTIES.map((difficulty) => wanted(difficulty));
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i] as number).toBeGreaterThan(steps[i - 1] as number);
    }
  });
});

describe('shapeToward', () => {
  it('is exactly the spread it was given when coherence is zero', () => {
    expect(shapeToward(flat, ['speed'], 0)).toBe(flat);
  });

  it('keeps the total to the point', () => {
    for (const pull of [0.1, 0.4, 0.75, 1]) {
      const shaped = shapeToward(flat, ['speed', 'strength'], pull);
      expect(attributeTotal(shaped)).toBe(attributeTotal(flat));
    }
  });

  it('moves points into what the style wants and out of what it does not', () => {
    const shaped = shapeToward(flat, ['speed', 'accuracy'], 1);

    expect(shaped.speed).toBeGreaterThan(flat.speed);
    expect(shaped.accuracy).toBeGreaterThan(flat.accuracy);
    expect(shaped.strength).toBeLessThan(flat.strength);
  });

  it('leaves whole numbers, inside the attribute scale', () => {
    const shaped = shapeToward(flat, ['speed'], 1);

    for (const id of ATTRIBUTE_IDS) {
      expect(Number.isInteger(shaped[id])).toBe(true);
      expect(shaped[id]).toBeGreaterThanOrEqual(1);
      expect(shaped[id]).toBeLessThanOrEqual(99);
    }
  });

  it('does nothing when the style wants everything, or nothing', () => {
    expect(shapeToward(flat, [], 1)).toBe(flat);
    expect(shapeToward(flat, ATTRIBUTE_IDS, 1)).toBe(flat);
  });

  it('never spikes an athlete into a caricature', () => {
    const shaped = shapeToward(flat, ['speed'], 1);

    // One attribute taking every spare point would be a gimmick rather than a style.
    expect(shaped.speed).toBeLessThan(90);
  });
});

describe('identity', () => {
  it('names the team, gives it a kit from the curated set, and a crest', () => {
    const { team: identity } = team('identity');

    expect(identity.name.length).toBeGreaterThan(3);
    expect(identity.name.length).toBeLessThanOrEqual(TEAM_BOUNDS.maxNameLength);
    expect(TEAM_PALETTES.map((palette) => palette.colours)).toContainEqual(identity.colours);
    expect(CREST_IDS).toContain(identity.crestId);
  });

  it('gives it a short name a scoreboard can hold', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const { team: identity } = team(seed);
      expect(identity.shortName.length).toBeGreaterThanOrEqual(2);
      expect(identity.shortName.length).toBeLessThanOrEqual(4);
      expect(identity.shortName).toBe(identity.shortName.toUpperCase());
    }
  });

  it('is not the player’s to edit — a user edit would rebalance a ladder silently', () => {
    expect(team('locked').team.editable).toBe(false);
  });

  it('plays one of the styles, and names it', () => {
    expect(CPU_STYLES.map((style) => style.id)).toContain(team('style').style.id);
  });

  it('gives different seeds different opponents', () => {
    const names = new Set(
      Array.from({ length: 24 }, (_, index) => team(`variety-${index}`).team.name),
    );

    expect(names.size).toBeGreaterThan(8);
  });
});

describe('determinism (INV-8)', () => {
  it('is the same opponent twice from the same seed', () => {
    expect(team('twice')).toEqual(team('twice'));
  });

  it('fields as many as it was asked for', () => {
    expect(team('eleven', 'pro', 11).athletes).toHaveLength(11);
    expect(team('none', 'pro', 0).athletes).toEqual([]);
  });
});

describe('the styles themselves', () => {
  it('no two want the same set, or two opponents would be indistinguishable', () => {
    const fingerprints = CPU_STYLES.map((style) => [...style.wants].sort().join(','));

    expect(new Set(fingerprints).size).toBe(CPU_STYLES.length);
  });

  it('between them they want every attribute — nothing is dead weight', () => {
    const wanted = new Set(CPU_STYLES.flatMap((style) => style.wants));

    for (const id of ATTRIBUTE_IDS) expect(wanted.has(id)).toBe(true);
  });
});
