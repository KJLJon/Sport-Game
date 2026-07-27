/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3, 10-ui-ux.md §10 (storage denied)
 * @invariant INV-3
 */
import { describe, expect, it } from 'vitest';
import { Prefs, memoryStore, type KeyValueStore } from '../../../src/storage/prefs.ts';
import { lsKey } from '../../../src/storage/scope.ts';

/** A store that refuses every write, the way Safari private mode does. */
function refusingStore(): KeyValueStore {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException('QuotaExceededError');
    },
    removeItem: () => {},
    key: () => null,
    length: 0,
  };
}

describe('Prefs', () => {
  it('namespaces every key it writes', () => {
    const store = memoryStore();
    new Prefs(store).set('theme', 'dark');
    expect(store.getItem(lsKey('theme'))).toBe('"dark"');
    expect(store.getItem('theme')).toBeNull();
  });

  it('round-trips values of every shape a preference takes', () => {
    const prefs = new Prefs(memoryStore());
    for (const value of ['dark', 42, true, null, { scale: 1.3 }, ['a', 'b']]) {
      prefs.set('v', value);
      expect(prefs.get('v', 'fallback')).toEqual(value);
    }
  });

  it('returns the fallback for a missing key', () => {
    expect(new Prefs(memoryStore()).get('missing', 'dark')).toBe('dark');
  });

  it('returns the fallback for a corrupt value rather than throwing', () => {
    const store = memoryStore();
    store.setItem(lsKey('theme'), '{not json');
    expect(new Prefs(store).get('theme', 'dark')).toBe('dark');
  });

  it('rejects a value that fails validation, so a stale shape cannot break a screen', () => {
    const store = memoryStore();
    const prefs = new Prefs(store);
    prefs.set('scale', 'not-a-number');

    const isNumber = (value: unknown): value is number => typeof value === 'number';
    expect(prefs.get('scale', 1, isNumber)).toBe(1);

    prefs.set('scale', 1.3);
    expect(prefs.get('scale', 1, isNumber)).toBe(1.3);
  });

  it('reports a refused write instead of throwing, so the app still launches', () => {
    const prefs = new Prefs(refusingStore());
    expect(prefs.set('theme', 'dark')).toBe(false);
    expect(prefs.get('theme', 'dark')).toBe('dark');
  });

  it('lists only our keys, stripped of the namespace', () => {
    const store = memoryStore();
    store.setItem('another-app:theme', 'light');
    const prefs = new Prefs(store);
    prefs.set('theme', 'dark');
    prefs.set('lastSport', 'basketball');

    expect(prefs.keys().sort()).toEqual(['lastSport', 'theme']);
  });

  it('clears only our keys and leaves a sibling project intact', () => {
    const store = memoryStore();
    store.setItem('another-app:theme', 'light');
    const prefs = new Prefs(store);
    prefs.set('theme', 'dark');

    prefs.clearOurs();

    expect(prefs.keys()).toEqual([]);
    expect(store.getItem('another-app:theme')).toBe('light');
  });

  it('removes a single key', () => {
    const prefs = new Prefs(memoryStore());
    prefs.set('theme', 'dark');
    prefs.remove('theme');
    expect(prefs.get('theme', 'light')).toBe('light');
  });
});
