/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.10 — Bundle budget: keep every asset inside `12`'s size limits, offline, no CDN
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  13-visual-overhaul.md §4 (T-13.10), 12-quality-and-testing.md §6, 07-decisions.md D-24
 *
 * Purpose: the budget checker, against a dist directory written for the occasion. The assertion
 * that matters is the second one — art may be any size up to D-24's ceiling, but it may never be
 * reachable from the entry chunk without a dynamic import, because that is a first paint waiting
 * on a megabyte of pixel data.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUDGETS,
  checkBudgets,
  initialGraph,
  isArtChunk,
  isInitialChunk,
  staticImportsOf,
} from '../../../tools/budget.ts';

const dirs: string[] = [];

async function dist(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'budget-'));
  dirs.push(root);
  await mkdir(join(root, 'assets'), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(root, name), contents);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('chunk classification', () => {
  it('knows the entry chunk and the art chunk apart from everything else', () => {
    expect(isInitialChunk('assets/index-abc123.js')).toBe(true);
    expect(isInitialChunk('assets/art-abc123.js')).toBe(false);
    expect(isArtChunk('assets/art-abc123.js')).toBe(true);
    // The one that used to fool a substring match.
    expect(isArtChunk('assets/party-abc123.js')).toBe(false);
  });
});

describe('staticImportsOf', () => {
  it('finds the imports a browser must fetch before running a line', () => {
    expect(staticImportsOf('import{a}from"./chunk-a.js";import"./side.js";')).toEqual([
      './chunk-a.js',
      './side.js',
    ]);
  });

  it('does not count a dynamic import, which is the whole point of one', () => {
    expect(staticImportsOf('const load=()=>import("./art-abc.js");')).toEqual([]);
  });

  it('ignores bare specifiers, which never name an emitted chunk', () => {
    expect(staticImportsOf('import"some-package";')).toEqual([]);
  });

  it('counts a re-export, which is an import wearing a different hat', () => {
    expect(staticImportsOf('export*from"./chunk-a.js";')).toEqual(['./chunk-a.js']);
  });
});

describe('initialGraph', () => {
  it('walks static imports transitively from the entry', async () => {
    const root = await dist({
      'assets/index-a.js': 'import"./mid-b.js";',
      'assets/mid-b.js': 'import"./leaf-c.js";',
      'assets/leaf-c.js': '',
      'assets/orphan-d.js': '',
    });

    const graph = await initialGraph(root, [
      'assets/index-a.js',
      'assets/mid-b.js',
      'assets/leaf-c.js',
      'assets/orphan-d.js',
    ]);

    expect([...graph].sort()).toEqual(['assets/index-a.js', 'assets/leaf-c.js', 'assets/mid-b.js']);
  });

  it('terminates on a cycle rather than walking it forever', async () => {
    const root = await dist({
      'assets/index-a.js': 'import"./mid-b.js";',
      'assets/mid-b.js': 'import"./index-a.js";',
    });
    const graph = await initialGraph(root, ['assets/index-a.js', 'assets/mid-b.js']);
    expect(graph.size).toBe(2);
  });
});

describe('checkBudgets — the art line (T-13.10)', () => {
  it('passes when art is only ever reached by a dynamic import', async () => {
    const root = await dist({
      'assets/index-a.js': 'import"./screen-b.js";',
      'assets/screen-b.js': 'const load=()=>import("./art-c.js");',
      'assets/art-c.js': 'export const grids=[];',
    });

    const result = await checkBudgets(root);

    expect(result.failures).toEqual([]);
    expect(result.artRawBytes).toBeGreaterThan(0);
  });

  it('fails when art sits in the initial graph, however deep', async () => {
    const root = await dist({
      'assets/index-a.js': 'import"./screen-b.js";',
      'assets/screen-b.js': 'import"./art-c.js";',
      'assets/art-c.js': 'export const grids=[];',
    });

    const result = await checkBudgets(root);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/art is in the initial graph/);
  });

  it('fails when art outgrows D-24’s ceiling', async () => {
    const root = await dist({
      'assets/index-a.js': '',
      'assets/art-c.js': 'x'.repeat(BUDGETS.artRawBytes + 1),
    });

    const result = await checkBudgets(root);

    expect(result.failures.some((failure) => failure.includes('D-24'))).toBe(true);
  });

  it('counts every art chunk, and no chunk that merely sounds like one', async () => {
    const root = await dist({
      'assets/index-a.js': '',
      'assets/art-c.js': 'x'.repeat(100),
      'assets/art-d.js': 'x'.repeat(50),
      'assets/party-e.js': 'x'.repeat(1000),
    });

    expect((await checkBudgets(root)).artRawBytes).toBe(150);
  });

  it('leaves sourcemaps out of the install cost, which no browser fetches', async () => {
    const root = await dist({
      'assets/index-a.js': 'x'.repeat(10),
      'assets/index-a.js.map': 'x'.repeat(10_000),
    });

    expect((await checkBudgets(root)).totalPrecacheBytes).toBe(10);
  });
});
