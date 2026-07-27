/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold
 * @design  12-quality-and-testing.md §3
 *
 * Purpose: shared filesystem walk for the invariant suite, which reasons about the source tree
 * as text rather than as modules.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.css', '.html'];

/** Recursively lists source files under `dir`, skipping build output and dependencies. */
export async function walkSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...(await walkSourceFiles(full)));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }

  return out.sort();
}
