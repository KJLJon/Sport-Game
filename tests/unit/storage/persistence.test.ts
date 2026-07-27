/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.12 — Storage persistence request, quota/usage display, denial warning
 * @story   US-1.5 — My data survives
 * @design  11-pwa-lifecycle.md §7, 10-ui-ux.md §10
 */
import { describe, expect, it, vi } from 'vitest';
import {
  PersistenceNudger,
  QUOTA_WARNING_FRACTION,
  describePersistence,
  formatBytes,
  isQuotaPressured,
  persistenceState,
  requestPersistence,
  storageUsage,
  type StorageManagerLike,
} from '../../../src/storage/persistence.ts';

describe('persistenceState', () => {
  it('reports unsupported where the API is absent, rather than assuming denial', async () => {
    await expect(persistenceState(undefined)).resolves.toBe('unsupported');
    await expect(persistenceState({})).resolves.toBe('unsupported');
  });

  it('reports the grant', async () => {
    await expect(persistenceState({ persisted: async () => true })).resolves.toBe('granted');
    await expect(persistenceState({ persisted: async () => false })).resolves.toBe('denied');
  });

  it('treats a throwing API as unsupported', async () => {
    const manager: StorageManagerLike = {
      persisted: async () => {
        throw new Error('nope');
      },
    };
    await expect(persistenceState(manager)).resolves.toBe('unsupported');
  });
});

describe('requestPersistence', () => {
  it('does not re-ask when already granted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    await expect(requestPersistence({ persist, persisted: async () => true })).resolves.toBe(
      'granted',
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks when not yet granted and reports the answer', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    await expect(requestPersistence({ persist, persisted: async () => false })).resolves.toBe(
      'granted',
    );
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal as denied, not as an error', async () => {
    await expect(
      requestPersistence({ persist: async () => false, persisted: async () => false }),
    ).resolves.toBe('denied');
  });
});

describe('PersistenceNudger', () => {
  it('asks once per milestone, not once per call', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    const nudger = new PersistenceNudger({ persist, persisted: async () => false });

    await nudger.reach('first-write');
    await nudger.reach('first-write');
    expect(persist).toHaveBeenCalledTimes(1);

    // A later milestone is a fresh chance — browsers weigh engagement (`11` §7).
    await nudger.reach('first-athlete');
    expect(persist).toHaveBeenCalledTimes(2);
  });
});

describe('storageUsage', () => {
  it('reports usage, quota, and the fraction', async () => {
    const usage = await storageUsage({ estimate: async () => ({ usage: 500, quota: 1000 }) });
    expect(usage).toEqual({ usageBytes: 500, quotaBytes: 1000, fraction: 0.5 });
  });

  it('reports a null fraction when the browser gives no quota', async () => {
    const usage = await storageUsage({ estimate: async () => ({ usage: 500 }) });
    expect(usage?.fraction).toBeNull();
  });

  it('returns null where the API is absent or throws', async () => {
    await expect(storageUsage({})).resolves.toBeNull();
    await expect(
      storageUsage({
        estimate: async () => {
          throw new Error('nope');
        },
      }),
    ).resolves.toBeNull();
  });
});

describe('isQuotaPressured', () => {
  it('warns at and above 80% (`11` §7)', () => {
    expect(isQuotaPressured({ usageBytes: 80, quotaBytes: 100, fraction: 0.8 })).toBe(true);
    expect(isQuotaPressured({ usageBytes: 79, quotaBytes: 100, fraction: 0.79 })).toBe(false);
    expect(QUOTA_WARNING_FRACTION).toBe(0.8);
  });

  it('does not warn when the fraction is unknown', () => {
    expect(isQuotaPressured({ usageBytes: 500, quotaBytes: 0, fraction: null })).toBe(false);
    expect(isQuotaPressured(null)).toBe(false);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5 MB'],
    [2.5 * 1024 * 1024 * 1024, '2.5 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('does not render nonsense for a bad input', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('describePersistence', () => {
  it('nudges toward a backup whenever the data is not protected (`11` §7)', () => {
    expect(describePersistence('denied')).toMatch(/backup/i);
    expect(describePersistence('unsupported')).toMatch(/backup/i);
    expect(describePersistence('granted')).not.toMatch(/backup/i);
  });
});
