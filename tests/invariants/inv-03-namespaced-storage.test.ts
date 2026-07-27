/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3, 12-quality-and-testing.md §3
 * @invariant INV-3 — every storage key, database name, and cache name carries the namespace
 *
 * Purpose: two halves of the same guarantee. First, no module outside `src/storage/` reaches a
 * storage API directly — checked as text, so an inline lint disable cannot hide it. Second, the
 * names `src/storage/` actually produces all carry the namespace.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkSourceFiles } from '../helpers/walk.ts';
import { CACHE_KINDS, NS, cacheName, dbName, lsKey } from '../../src/storage/scope.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const STORAGE_DIR = fileURLToPath(new URL('../../src/storage', import.meta.url));

/** The direct-access patterns that must not appear outside `src/storage/`. */
const FORBIDDEN: readonly { pattern: RegExp; api: string }[] = [
  { pattern: /\bindexedDB\s*\.\s*(open|deleteDatabase|databases)\b/, api: 'indexedDB' },
  {
    pattern: /\blocalStorage\s*\.\s*(getItem|setItem|removeItem|clear|key)\b/,
    api: 'localStorage',
  },
  {
    pattern: /\bsessionStorage\s*\.\s*(getItem|setItem|removeItem|clear)\b/,
    api: 'sessionStorage',
  },
  { pattern: /\bcaches\s*\.\s*(open|keys|delete|match|has)\b/, api: 'caches' },
];

describe('INV-3 — namespaced storage', () => {
  it('no module outside src/storage/ touches a storage API directly', async () => {
    const files = (await walkSourceFiles(SRC)).filter((file) => !file.startsWith(STORAGE_DIR));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const { pattern, api } of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file.slice(SRC.length + 1)} → ${api}`);
      }
    }

    expect(offenders, 'go through src/storage/ so the base-path namespace is applied').toEqual([]);
  });

  it('every name the storage module produces carries the namespace', () => {
    const names = [
      dbName(),
      lsKey('theme'),
      lsKey(''),
      ...Object.values(CACHE_KINDS).map(cacheName),
    ];

    for (const name of names) {
      expect(name.startsWith(NS), `${name} is missing the namespace`).toBe(true);
    }
  });

  it('the namespace is derived from the base path, so a repository rename follows it', () => {
    expect(NS).toContain(import.meta.env.BASE_URL);
  });
});
