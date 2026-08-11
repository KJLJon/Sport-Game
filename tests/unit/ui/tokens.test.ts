/**
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §3.1 (palette — "all colours are design tokens; nothing is hardcoded in
 *          components"), §3.2 (type and space scales)
 *
 * Purpose: the design tokens are only a design *system* if every stylesheet spends the same
 * vocabulary. Read as text, because CSS custom properties have no compile step and a name that
 * resolves to nothing fails silently — it falls back to a literal and the page still renders.
 *
 * This is what T-9.1 found: a second, undefined vocabulary (`--color-border`, `--type-sm`,
 * `--space-2`, `--radius-md`, `--shadow-lg`) had grown alongside the real one, each use carrying a
 * hardcoded fallback that was doing all the work. One of them — `var(--space-4, 16px)` — named a
 * token that *does* exist and means 4 px, so four sides of the Live overlay's padding had been
 * silently rendering at a quarter of the intended inset since Phase 2.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkSourceFiles } from '../../helpers/walk.ts';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

const USE = /var\(\s*(--[a-z0-9-]+)\s*(?:,([^)]*))?\)/g;
const DECLARE = /^\s*(--[a-z0-9-]+)\s*:/gm;
const SET_PROPERTY = /setProperty\(\s*'(--[a-z0-9-]+)'/g;

interface Use {
  readonly file: string;
  readonly name: string;
  readonly fallback: string | undefined;
}

async function cssFiles(): Promise<string[]> {
  return (await walkSourceFiles(SRC)).filter((file) => file.endsWith('.css'));
}

async function collect(): Promise<{ declared: Set<string>; uses: Use[] }> {
  const declared = new Set<string>();
  const uses: Use[] = [];

  for (const file of await walkSourceFiles(SRC)) {
    const text = await readFile(file, 'utf8');
    const relative = file.slice(SRC.length + 1);

    if (file.endsWith('.css')) {
      for (const match of text.matchAll(DECLARE)) declared.add(match[1]!);
      for (const match of text.matchAll(USE)) {
        uses.push({ file: relative, name: match[1]!, fallback: match[2]?.trim() });
      }
    } else if (file.endsWith('.ts')) {
      // A component may publish a property from script — `--fill` on a meter, `--x`/`--y` on a
      // marker. Those are declarations too, just ones a stylesheet never sees.
      for (const match of text.matchAll(SET_PROPERTY)) declared.add(match[1]!);
    }
  }

  return { declared, uses };
}

describe('the token vocabulary (`10` §3.1)', () => {
  it('resolves: every property a stylesheet reads is one something declares', async () => {
    const { declared, uses } = await collect();

    const dangling = uses
      .filter((use) => !declared.has(use.name))
      .map((use) => `${use.file}: var(${use.name})`);

    expect(dangling).toEqual([]);
  });

  it('has no second vocabulary for the scales `10` §3.2 already names', async () => {
    const { uses } = await collect();

    // The names the Phase-2 stylesheets used. Each is a synonym for a real token, and a synonym is
    // how two parts of one app end up with different spacing.
    // `--space-4` is deliberately absent: it is a real token that happens to share the old
    // vocabulary's shape, and it was the one the old fallbacks got wrong.
    const banned = /^--(color-|type-|space-[1235]$|radius-(sm|md|lg)$|shadow-)/;
    const offenders = uses
      .filter((use) => banned.test(use.name))
      .map((use) => `${use.file}: var(${use.name})`);

    expect(offenders).toEqual([]);
  });

  it('keeps a fallback only where the property is published at runtime', async () => {
    const { uses } = await collect();
    const tokens = new Set(
      [...(await readFile(`${SRC}/ui/tokens.css`, 'utf8')).matchAll(DECLARE)].map(
        (match) => match[1]!,
      ),
    );

    // A literal in a fallback is a hardcoded value, which `10` §3.1 forbids — and a defined token
    // can never fall back anyway, so the literal is unreachable as well as wrong. Properties set by
    // the shell or by a component's script are the exception: they legitimately have no value until
    // the code runs, and the fallback is what the first paint uses.
    const hardcoded = uses
      .filter((use) => use.fallback !== undefined && tokens.has(use.name))
      .map((use) => `${use.file}: var(${use.name}, ${use.fallback})`);

    expect(hardcoded).toEqual([]);
  });

  it('defines every token `10` §3.1 and §3.2 name', async () => {
    const tokens = new Set(
      [...(await readFile(`${SRC}/ui/tokens.css`, 'utf8')).matchAll(DECLARE)].map(
        (match) => match[1]!,
      ),
    );

    const required = [
      // §3.1's palette, in full.
      '--surface-0',
      '--surface-1',
      '--surface-2',
      '--text-hi',
      '--text-lo',
      '--accent',
      '--accent-alt',
      '--danger',
      '--info',
      // §3.2's type scale — 12/14/16/20/24/32/44.
      '--text-12',
      '--text-14',
      '--text-16',
      '--text-20',
      '--text-24',
      '--text-32',
      '--text-44',
      // §3.2's spacing — 4/8/12/16/24/32/48 — and radii — 8/12/20/full.
      '--space-4',
      '--space-8',
      '--space-12',
      '--space-16',
      '--space-24',
      '--space-32',
      '--space-48',
      '--radius-8',
      '--radius-12',
      '--radius-20',
      '--radius-full',
      // §3.3's motion.
      '--dur-micro',
      '--dur-screen',
      '--dur-reveal',
    ];

    expect(required.filter((token) => !tokens.has(token))).toEqual([]);
  });

  it('leaves no stylesheet outside the system', async () => {
    // Every stylesheet in `src/` should be spending tokens. One that spends none is either trivial
    // or has quietly gone its own way; this catches the second case as it appears.
    const bare: string[] = [];
    for (const file of await cssFiles()) {
      const text = await readFile(file, 'utf8');
      if (!text.includes('var(--')) bare.push(file.slice(SRC.length + 1));
    }

    expect(bare).toEqual([]);
  });
});
