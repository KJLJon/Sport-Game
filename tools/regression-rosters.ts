/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.10 — AI regression harness: headless batches per difficulty per mode, asserted win-rate bands
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7
 *
 * Purpose: the two squads the ladder batches are played with, and the one property that matters
 * about them — **both sides get the same one**. A difficulty batch is asking what the *level* is
 * worth, so any difference in the rosters is noise added to the only number being measured.
 *
 * Basketball's five come from `playbook-rosters.ts`, which already builds basketball bodies.
 * Soccer's eleven are built here rather than borrowed from it: that roster is 205 cm tall by
 * design, and soccer reads height into heading, goalkeeping, dribbling, and pace, so a ladder run
 * on it would be measuring a team of centre-backs against another team of centre-backs.
 */
import { createRng, type Rng } from '../src/engine/rng.ts';
import { STARTING_FAMILIARITY, newSportSkill, type Athlete } from '../src/athletes/types.ts';
import { drawAttributes, roster } from './playbook-rosters.ts';

/** Five ordinary basketball professionals. */
export function five(seed: string): readonly Athlete[] {
  return roster(seed, 'average', 5);
}

/** Eleven ordinary soccer professionals: one tall keeper, two tall centre-backs, nine outfielders. */
export function eleven(seed: string): Athlete[] {
  const rng: Rng = createRng(seed).fork('soccer-eleven');
  return Array.from({ length: 11 }, (_, index) => ({
    id: `${seed}-${index}`,
    schemaVersion: 1,
    displayName: `${seed} ${index + 1}`,
    heightCm: index === 0 || index === 3 || index === 4 ? 188 + rng.int(0, 6) : 175 + rng.int(0, 9),
    weightKg: 70 + rng.int(0, 12),
    handedness: 'right' as const,
    age: 22 + rng.int(0, 10),
    primarySport: 'soccer',
    attributes: drawAttributes(rng, 60),
    sportSkills: { soccer: newSportSkill(STARTING_FAMILIARITY.primary) },
    rarity: 'common' as const,
    traits: [],
    condition: { stamina: 100 },
    source: 'created' as const,
    sandbox: false,
    custodyId: `${seed}-custody-${index}`,
    createdAt: 0,
    editable: true,
  }));
}
