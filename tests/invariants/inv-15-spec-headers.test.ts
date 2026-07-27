/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §6, 12-quality-and-testing.md §3
 * @invariant INV-15 — every module in src/ carries a valid spec header resolving to a real task
 *
 * Purpose: the authoritative half of INV-15. The lint rule checks presence on every keystroke;
 * this resolves every task and story ID against `03` and `02`, which the rule cannot do cheaply.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadKnownIds, traceDirectory, validateHeader } from '../../tools/spec-index.ts';
import { buildReport, compareTaskIds } from '../../tools/spec-trace.ts';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const SPEC_DIR = fileURLToPath(new URL('../../specs/001-initial-dev', import.meta.url));

describe('INV-15 — spec headers', () => {
  it('finds modules to check', async () => {
    const files = await traceDirectory(SRC);
    expect(files.length).toBeGreaterThan(10);
  });

  it('every module carries a header whose IDs resolve against 03 and 02', async () => {
    const [files, known] = await Promise.all([traceDirectory(SRC), loadKnownIds(SPEC_DIR)]);

    const problems: string[] = [];
    for (const file of files) {
      for (const problem of validateHeader(file.header, known)) {
        problems.push(`${file.path}: ${problem.field} — ${problem.message}`);
      }
    }

    expect(problems, 'see CLAUDE.md §6').toEqual([]);
  });

  it('every module states a Purpose, since a module that cannot say why should not exist', async () => {
    const files = await traceDirectory(SRC);
    const silent = files.filter((file) => (file.header?.purpose ?? '') === '').map((f) => f.path);
    expect(silent).toEqual([]);
  });

  it('the report resolves both ways and reports no problems', async () => {
    const [files, known] = await Promise.all([traceDirectory(SRC), loadKnownIds(SPEC_DIR)]);
    const report = buildReport(files, known);

    expect(report.problems).toEqual([]);
    expect(report.markdown).toContain('## Task → files');
    expect(report.markdown).toContain('## File → task');
    expect(report.fileCount).toBe(files.length);
    expect(report.taskCount).toBeGreaterThan(0);
  });
});

describe('compareTaskIds', () => {
  it('orders T-0.2 before T-0.10, which a string sort would not', () => {
    expect(['T-0.10', 'T-0.2', 'T-0.1'].sort(compareTaskIds)).toEqual(['T-0.1', 'T-0.2', 'T-0.10']);
  });

  it('orders by phase first', () => {
    expect(['T-2.1', 'T-0.18'].sort(compareTaskIds)).toEqual(['T-0.18', 'T-2.1']);
  });
});
