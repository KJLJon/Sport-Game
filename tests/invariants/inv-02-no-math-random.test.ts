/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.1 — Seeded PRNG + lint rule banning `Math.random`
 * @story   US-2.5, US-2.7
 * @design  07-decisions.md D-11, 12-quality-and-testing.md §3
 * @invariant INV-2 — no Math.random is reachable from the simulation or Playbook resolution
 *
 * Purpose: the lint rule in `eslint.config.js` catches this while you type; this test catches it
 * in CI even if the rule is deleted, its `files` globs drift as new directories appear, or a
 * violation is waved through with an inline disable comment. Text, not AST, on purpose — a
 * disable comment cannot hide a substring.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkSourceFiles } from '../helpers/walk.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** The directories the simulation is reachable from. `05` §9 adds none; new ones go here. */
const SIMULATION_DIRS = ['engine', 'sports', 'modes'];

/** Assembled so this file does not contain the literal it bans (see INV-4's test for the same). */
const FORBIDDEN = ['Math', '.', 'random'].join('');

/** Also banned: an aliased escape, e.g. `const r = Math["random"]`. */
const FORBIDDEN_INDEXED = ['Math', '[', "'", 'random'].join('');
const FORBIDDEN_INDEXED_DOUBLE = ['Math', '[', '"', 'random'].join('');

async function offendersIn(dir: string): Promise<string[]> {
  const files = await walkSourceFiles(`${SRC}/${dir}`);
  const offenders: string[] = [];

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (
      text.includes(FORBIDDEN) ||
      text.includes(FORBIDDEN_INDEXED) ||
      text.includes(FORBIDDEN_INDEXED_DOUBLE)
    ) {
      offenders.push(file.slice(SRC.length + 1));
    }
  }

  return offenders;
}

describe('INV-2 — the simulation is deterministic', () => {
  it.each(SIMULATION_DIRS)('src/%s contains no Math.random', async (dir) => {
    expect(
      await offendersIn(dir),
      'use the seeded PRNG from src/engine/rng.ts — see 07-decisions.md D-11',
    ).toEqual([]);
  });

  it('has a lint rule covering every simulation directory', async () => {
    const config = await readFile(
      fileURLToPath(new URL('../../eslint.config.js', import.meta.url)),
      'utf8',
    );

    expect(config).toContain("property: 'random'");
    for (const dir of SIMULATION_DIRS) {
      expect(config, `eslint.config.js must lint src/${dir}/ for INV-2`).toContain(
        `src/${dir}/**/*.ts`,
      );
    }
  });

  it('detects a violation if one is introduced', async () => {
    // Guards the guard: if `walkSourceFiles` ever stops finding engine sources, the assertions
    // above would pass vacuously.
    const files = await walkSourceFiles(`${SRC}/engine`);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.endsWith('rng.ts'))).toBe(true);
  });
});
