/**
 * T-4.1 — the arcade unlock vocabulary. Small, but load-bearing: a locked tile shows exactly what
 * these strings say, and `09` §3.2 promises every one of them is earned by playing.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCADE_UNLOCKS,
  ARCADE_UNLOCKS_BY_ID,
  requirementFor,
} from '../../../src/achievements/ids.ts';

describe('the arcade unlocks', () => {
  it('are the ten 09 §3.2 names, five per sport', () => {
    const ids = Object.values(ARCADE_UNLOCKS).map((entry) => entry.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.filter((id) => id.startsWith('bball.'))).toHaveLength(5);
    expect(ids.filter((id) => id.startsWith('soccer.'))).toHaveLength(5);
  });

  it('are all earned by playing — nothing here mentions buying', () => {
    for (const entry of Object.values(ARCADE_UNLOCKS)) {
      expect(entry.requirement).not.toMatch(/buy|purchase|pay|coins|store/i);
      expect(entry.requirement.length).toBeGreaterThan(8);
    }
  });

  it('are indexed by id', () => {
    expect(ARCADE_UNLOCKS_BY_ID.size).toBe(10);
    expect(ARCADE_UNLOCKS_BY_ID.get('bball.free-throw-made')?.requirement).toBe(
      'Make a free throw in any mode',
    );
  });
});

describe('requirementFor', () => {
  it('answers with the condition a tile shows', () => {
    expect(requirementFor('bball.five-steals')).toBe('Record 5 steals');
  });

  it('says something honest for an id it does not know', () => {
    expect(requirementFor('nope')).toBe('Keep playing to unlock this');
  });
});
