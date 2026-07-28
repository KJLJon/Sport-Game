/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @design  05-data-model.md §2.1 (creation budget, per-attribute range), 10-ui-ux.md §8.3
 *
 * Purpose: every preset the editor offers must already be a legal, non-sandbox creation — that is
 * the whole point of a preset over the sliders, so it is asserted the same way the editor's Save
 * button would decide it, rather than eyeballing the numbers.
 */
import { describe, expect, it } from 'vitest';
import { judgeCreation } from '../../../src/athletes/attributes.ts';
import { ATTRIBUTE_PRESETS, presetById } from '../../../src/athletes/presets.ts';
import { ATTRIBUTE_IDS, attributeTotal } from '../../../src/athletes/types.ts';

describe('ATTRIBUTE_PRESETS', () => {
  it('offers a handful of archetypes, per `10` §8.3', () => {
    expect(ATTRIBUTE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it('has unique, non-empty ids and labels', () => {
    const ids = ATTRIBUTE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of ATTRIBUTE_PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('defines every one of the eleven attributes for every preset', () => {
    for (const preset of ATTRIBUTE_PRESETS) {
      for (const id of ATTRIBUTE_IDS) {
        expect(preset.attributes[id]).toBeTypeOf('number');
      }
      expect(Object.keys(preset.attributes)).toHaveLength(ATTRIBUTE_IDS.length);
    }
  });

  it('is on budget and inside the per-attribute range for every preset (`05` §2.1)', () => {
    for (const preset of ATTRIBUTE_PRESETS) {
      const verdict = judgeCreation(preset.attributes, false);
      expect(verdict.allowed, `${preset.id} should be allowed without sandbox`).toBe(true);
      expect(verdict.sandbox, `${preset.id} should not require sandbox`).toBe(false);
      expect(verdict.budget.outOfRange, `${preset.id} has an out-of-range attribute`).toEqual([]);
      expect(attributeTotal(preset.attributes), `${preset.id} total`).toBeLessThanOrEqual(
        verdict.budget.budget,
      );
    }
  });

  it('spreads its points rather than being eleven identical numbers', () => {
    for (const preset of ATTRIBUTE_PRESETS) {
      const values = ATTRIBUTE_IDS.map((id) => preset.attributes[id]);
      expect(new Set(values).size).toBeGreaterThan(1);
    }
  });
});

describe('presetById', () => {
  it('finds a preset by id', () => {
    const first = ATTRIBUTE_PRESETS[0];
    expect(first).toBeDefined();
    expect(presetById(first!.id)).toBe(first);
  });

  it('returns undefined for an unknown id', () => {
    expect(presetById('does-not-exist')).toBeUndefined();
  });
});
