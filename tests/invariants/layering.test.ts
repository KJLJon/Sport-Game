/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.10 — Roster browser: search, sort, filter, bulk select
 * @story   US-5.5 — Edit and delete profiles
 * @design  04-architecture.md §3 (module layout), 12-quality-and-testing.md §3
 *
 * Purpose: the domain layer must not import the UI layer.
 *
 * This is not one of `12` §3's numbered invariants; it is a regression guard for a real inversion
 * that happened. T-3.10's roster sort needed "this athlete's overall in this sport", the only
 * implementation lived in the athlete *card*, and so `src/athletes/` ended up importing
 * `src/ui/components/`. The arithmetic moved to `athletes/derivation.ts` and the card now imports
 * it, which is the direction the dependency should always have run.
 *
 * It is worth a test rather than a code review note because the failure is invisible: everything
 * compiles, every test passes, and the cost only shows up the day something headless — a balance
 * run, a P2P host, a migration — pulls a DOM module into a context that has no DOM.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkSourceFiles } from '../helpers/walk.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Layers that must stay renderable-free: they run in workers, in Node, and in headless batches. */
const DOMAIN_DIRECTORIES = ['athletes', 'engine', 'sports', 'storage', 'economy', 'achievements'];

const IMPORTS_UI = /from\s+['"][^'"]*\/ui\/[^'"]*['"]/;

describe('module layering', () => {
  it('never lets the domain layer import the UI layer', async () => {
    const offenders: string[] = [];

    for (const directory of DOMAIN_DIRECTORIES) {
      for (const file of await walkSourceFiles(`${SRC}/${directory}`)) {
        if (!file.endsWith('.ts')) continue;
        const source = await readFile(file, 'utf8');
        if (IMPORTS_UI.test(source)) offenders.push(file.slice(SRC.length + 1));
      }
    }

    expect(offenders, 'domain modules must not import from src/ui/').toEqual([]);
  });

  it('keeps the rating arithmetic where the domain layer can reach it', async () => {
    // The specific inversion this guards against: if `sportOverall` ever moves back into the card,
    // the roster browser would have to import a DOM module to sort a list again.
    const derivation = await readFile(`${SRC}/athletes/derivation.ts`, 'utf8');
    expect(derivation).toContain('export function sportOverall');
  });
});
