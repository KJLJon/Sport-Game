/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.2 — Derive `base` from the repository name at build
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §2, 12-quality-and-testing.md §3
 * @invariant INV-4 — no literal repository path exists anywhere in src/
 *
 * Purpose: the lint rule catches this while you type; this test catches it in CI even if the rule
 * is disabled, moved, or bypassed with an inline comment.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkSourceFiles } from '../helpers/walk.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * Assembled at runtime so this test file does not itself contain the literal it bans — otherwise
 * a naive grep over the repository would flag the guard along with a real violation.
 */
const FORBIDDEN = ['/', 'Sport', '-', 'Game', '/'].join('');

describe('INV-4 — no literal repository path in src/', () => {
  it('finds source files to check', async () => {
    const files = await walkSourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no hardcoded base path', async () => {
    const files = await walkSourceFiles(SRC);
    const offenders: string[] = [];

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      if (text.includes(FORBIDDEN)) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }

    expect(offenders, `derive the base path from import.meta.env.BASE_URL instead`).toEqual([]);
  });
});
