/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @story   US-5.1 — Create an athlete profile
 * @design  10-ui-ux.md §8.3 (create-an-athlete flow — "presets: a handful of archetypes to tap"),
 *          05-data-model.md §2.1 (creation budget, per-attribute range)
 *
 * Purpose: a handful of tappable archetypes for the profile editor's attribute step — the fastest
 * of the three paths `10` §8.3 offers (presets, sliders, roll). Every entry here is hand-built
 * against `05` §2.1's rules rather than rolled, so a preset always looks like the archetype its
 * name promises: a sprinter is legibly fast-and-light, a big is legibly strong-and-tall-shaped,
 * and so on, which a random draw pinned to the same budget could not guarantee.
 *
 * Each preset is data, and each is required to already be legal under `judgeCreation` — on budget
 * and inside the per-attribute range — so tapping one and pressing Save never lands the editor in
 * the sandbox conversation the sliders and the roll button can. `presets.test.ts` asserts this for
 * every entry rather than trusting the numbers below.
 */
import type { Attributes } from './types.ts';

export interface AttributePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly attributes: Attributes;
}

/**
 * Six archetypes spanning the eleven attributes' obvious shapes. Every spread was hand-tuned to
 * land on or under the 580-point creation budget with no attribute outside 20–95 — see
 * `presets.test.ts`, which checks both via the same `judgeCreation` the editor's Save button uses.
 *
 * @spec-ref 05-data-model.md §2.1 — budget 580, per-attribute range 20–95.
 */
export const ATTRIBUTE_PRESETS: readonly AttributePreset[] = [
  {
    id: 'sprinter',
    label: 'Sprinter',
    description: 'Built to outrun everyone on the field. Explosive, light on their feet.',
    attributes: {
      speed: 88,
      acceleration: 85,
      agility: 70,
      strength: 30,
      vertical: 45,
      stamina: 60,
      coordination: 35,
      accuracy: 30,
      awareness: 35,
      composure: 35,
      discipline: 32,
    },
  },
  {
    id: 'sharpshooter',
    label: 'Sharpshooter',
    description: 'Ice in their veins and a release you cannot leave open.',
    attributes: {
      speed: 40,
      acceleration: 38,
      agility: 45,
      strength: 30,
      vertical: 35,
      stamina: 45,
      coordination: 70,
      accuracy: 92,
      awareness: 55,
      composure: 75,
      discipline: 55,
    },
  },
  {
    id: 'big',
    label: 'The Big',
    description: 'Wins every contest of strength and owns the paint.',
    attributes: {
      speed: 30,
      acceleration: 28,
      agility: 32,
      strength: 88,
      vertical: 75,
      stamina: 55,
      coordination: 40,
      accuracy: 35,
      awareness: 45,
      composure: 50,
      discipline: 45,
    },
  },
  {
    id: 'playmaker',
    label: 'Playmaker',
    description: 'Sees the play before it happens and puts the ball exactly there.',
    attributes: {
      speed: 50,
      acceleration: 48,
      agility: 55,
      strength: 32,
      vertical: 32,
      stamina: 50,
      coordination: 70,
      accuracy: 50,
      awareness: 88,
      composure: 60,
      discipline: 45,
    },
  },
  {
    id: 'lockdown-defender',
    label: 'Lockdown defender',
    description: 'Reads the ball-handler, never fouls, never lets go.',
    attributes: {
      speed: 58,
      acceleration: 52,
      agility: 55,
      strength: 52,
      vertical: 42,
      stamina: 52,
      coordination: 33,
      accuracy: 26,
      awareness: 75,
      composure: 45,
      discipline: 78,
    },
  },
  {
    id: 'all-rounder',
    label: 'All-rounder',
    description: 'No holes in the game. Steady everywhere, a star nowhere in particular yet.',
    attributes: {
      speed: 53,
      acceleration: 53,
      agility: 53,
      strength: 53,
      vertical: 53,
      stamina: 52,
      coordination: 52,
      accuracy: 52,
      awareness: 52,
      composure: 52,
      discipline: 52,
    },
  },
];

export function presetById(id: string): AttributePreset | undefined {
  return ATTRIBUTE_PRESETS.find((preset) => preset.id === id);
}
