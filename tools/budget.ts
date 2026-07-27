/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.15 — CI: bundle-size budgets
 * @story   —
 * @design  12-quality-and-testing.md §6 (performance budgets), 04-architecture.md §9
 *
 * Purpose: fails the build when the bundle outgrows its budget. `12` §6 sets the numbers; this
 * checks them against what was actually emitted, so a budget cannot quietly drift upward.
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
} as const;

export interface BudgetResult {
  readonly initialJsGzipBytes: number;
  readonly totalPrecacheBytes: number;
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

  return { initialJsGzipBytes, totalPrecacheBytes, failures };
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

  if (result.failures.length > 0) {
    console.error('\nbudget exceeded:');
    for (const failure of result.failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('budget.ts') === true) {
  await main();
}
