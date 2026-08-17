/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-0.15 — CI: bundle-size budgets
 * @task    T-13.10 — Bundle budget: every asset inside `12`'s size limits, offline, with no CDN
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  12-quality-and-testing.md §6 (performance budgets), 04-architecture.md §9,
 *          13-visual-overhaul.md §4 (T-13.10), 07-decisions.md D-24 (the 1.5 MB art ceiling)
 * @invariant INV-4 (no runtime network — art ships in the bundle or not at all)
 *
 * Purpose: fails the build when the bundle outgrows its budget. `12` §6 sets the numbers; this
 * checks them against what was actually emitted, so a budget cannot quietly drift upward.
 *
 * **The art line** (T-13.10) is two assertions, not one. The first is D-24's arithmetic: authored
 * sprite grids are text, they compress well, and 1.5 MB raw is the ceiling that arithmetic bought —
 * if frames ever approach it the rows get run-length encoded, because the rasteriser is their only
 * consumer, and the ceiling does not move. The second matters more: art must not be in the *initial
 * graph*. A first paint that waits on a megabyte of pixel data is the failure this catches, and it
 * is checked by walking the static import graph from the entry chunk rather than by trusting the
 * chunk split to have worked.
 */
import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

/** `12` §6. These may not be raised to make a build pass — they are the design. */
export const BUDGETS = {
  /** Initial JS, gzipped: everything the first paint needs. */
  initialJsGzipBytes: 200 * 1024,
  /** Total precache size — what an install costs the player. */
  totalPrecacheBytes: 6 * 1024 * 1024,
  /** Authored sprite art, raw. D-24's ceiling; it is never lowered to make a build pass. */
  artRawBytes: 1.5 * 1024 * 1024,
} as const;

export interface BudgetResult {
  readonly initialJsGzipBytes: number;
  readonly totalPrecacheBytes: number;
  /** Raw bytes of the art chunks (T-13.10). */
  readonly artRawBytes: number;
  readonly failures: readonly string[];
}

/** Files excluded from the install cost: sourcemaps are never fetched by the app. */
function counts(name: string): boolean {
  return !name.endsWith('.map');
}

async function walk(dir: string, root: string = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, root)));
    else out.push(full.slice(root.length + 1));
  }
  return out;
}

/**
 * The entry chunk is what a cold launch must download before anything renders. Code-split
 * chunks — screens, sports, the dev gallery — are deliberately not counted here.
 */
export function isInitialChunk(name: string): boolean {
  return /^assets\/index-[^/]+\.js$/.test(name);
}

/** The authored sprite art, split out by `vite.config.ts`'s `manualChunks` (T-13.10). */
export function isArtChunk(name: string): boolean {
  return /^assets\/art-[^/]+\.js$/.test(name);
}

/**
 * The modules a chunk pulls in *statically* — the ones a browser must fetch before it can run a
 * line of it. `import('./x.js')` is deliberately not one of them: a dynamic import is the whole
 * mechanism by which a route, a sport, or an atlas stays out of the first paint.
 */
export function staticImportsOf(source: string): string[] {
  const out: string[] = [];
  // Minified output has no whitespace to lean on — `import{a}from"./x.js"` and `export*from"./y.js"`
  // are both static edges. `import("./z.js")` is not, and the excluded `(` is what keeps it out.
  const patterns = [
    /import(?:[^;()"']*?from)?\s*["']([^"']+)["']/g,
    /export[^;()"']*?from\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined && specifier.startsWith('.')) out.push(specifier);
    }
  }
  return out;
}

/**
 * Every emitted file reachable from the entry chunk by static imports alone, entry included. What
 * is *not* in here is what a cold launch does not have to download.
 */
export async function initialGraph(dist: string, files: readonly string[]): Promise<Set<string>> {
  const emitted = new Set(files);
  const seen = new Set<string>();
  const queue = files.filter(isInitialChunk);

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);

    const source = await readFile(join(dist, name), 'utf8');
    for (const specifier of staticImportsOf(source)) {
      // Chunks sit beside each other under assets/, so a relative specifier resolves by basename.
      const resolved = join(name, '..', specifier).split('\\').join('/');
      if (emitted.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

export async function checkBudgets(dist: string = DIST): Promise<BudgetResult> {
  const files = (await walk(dist)).filter(counts);
  const failures: string[] = [];

  let initialJsGzipBytes = 0;
  for (const name of files.filter(isInitialChunk)) {
    initialJsGzipBytes += gzipSync(await readFile(join(dist, name))).byteLength;
  }

  let totalPrecacheBytes = 0;
  for (const name of files) {
    totalPrecacheBytes += (await stat(join(dist, name))).size;
  }

  let artRawBytes = 0;
  for (const name of files.filter(isArtChunk)) {
    artRawBytes += (await stat(join(dist, name))).size;
  }

  const graph = await initialGraph(dist, files);
  const artInInitialGraph = [...graph].filter(isArtChunk);

  if (initialJsGzipBytes > BUDGETS.initialJsGzipBytes) {
    failures.push(
      `initial JS ${format(initialJsGzipBytes)} gzipped exceeds ${format(BUDGETS.initialJsGzipBytes)}`,
    );
  }
  if (totalPrecacheBytes > BUDGETS.totalPrecacheBytes) {
    failures.push(
      `install size ${format(totalPrecacheBytes)} exceeds ${format(BUDGETS.totalPrecacheBytes)}`,
    );
  }
  if (artRawBytes > BUDGETS.artRawBytes) {
    failures.push(`art ${format(artRawBytes)} raw exceeds ${format(BUDGETS.artRawBytes)} (D-24)`);
  }
  if (artInInitialGraph.length > 0) {
    failures.push(
      `art is in the initial graph: ${artInInitialGraph.join(', ')} — import art behind a route-level dynamic import`,
    );
  }

  return { initialJsGzipBytes, totalPrecacheBytes, artRawBytes, failures };
}

export function format(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<void> {
  const result = await checkBudgets();

  console.log(
    `initial JS (gzip): ${format(result.initialJsGzipBytes)} / ${format(BUDGETS.initialJsGzipBytes)}`,
  );
  console.log(
    `install size:      ${format(result.totalPrecacheBytes)} / ${format(BUDGETS.totalPrecacheBytes)}`,
  );
  console.log(`art (raw):         ${format(result.artRawBytes)} / ${format(BUDGETS.artRawBytes)}`);

  if (result.failures.length > 0) {
    console.error('\nbudget exceeded:');
    for (const failure of result.failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('budget.ts') === true) {
  await main();
}
