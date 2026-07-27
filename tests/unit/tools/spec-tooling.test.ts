/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule, T-0.18 — PROGRESS.md validation script
 * @story   —
 * @design  CLAUDE.md §3, §6
 */
import { describe, expect, it } from 'vitest';
import { parseHeader, validateHeader, type KnownIds } from '../../../tools/spec-index.ts';
import { VALID_STATUSES, check, parseInFlight, parseRows } from '../../../tools/progress-check.ts';

const KNOWN: KnownIds = {
  tasks: new Set(['T-0.1', 'T-0.2', 'T-1.1']),
  stories: new Set(['US-1.1', 'US-1.3']),
};

const GOOD = `/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation
 * @task    T-0.1 — Scaffold, T-0.2 — Base path
 * @story   US-1.1 — Install the game
 * @design  04-architecture.md §2, 11-pwa-lifecycle.md §3
 * @invariant INV-4 (no literal path), INV-3
 *
 * Purpose: does a thing, for a reason.
 */
export const x = 1;
`;

describe('parseHeader', () => {
  it('reads every field', () => {
    const header = parseHeader(GOOD);
    expect(header).toMatchObject({
      spec: '001-initial-dev',
      tasks: ['T-0.1', 'T-0.2'],
      stories: ['US-1.1'],
      invariants: ['INV-4', 'INV-3'],
      storyDeclared: true,
    });
    expect(header?.phase).toContain('Foundation');
    expect(header?.purpose).toBe('does a thing, for a reason.');
    expect(header?.design).toHaveLength(2);
  });

  it('reads a purpose that wraps across lines', () => {
    const wrapped = GOOD.replace(
      'Purpose: does a thing, for a reason.',
      'Purpose: does a thing,\n * for a reason that needed two lines.',
    );
    expect(parseHeader(wrapped)?.purpose).toBe('does a thing, for a reason that needed two lines.');
  });

  it('returns null when there is no leading block comment', () => {
    expect(parseHeader('export const x = 1;\n')).toBeNull();
    expect(parseHeader('// a line comment\nexport const x = 1;\n')).toBeNull();
  });

  it('ignores a block comment that is not first — a header has to open the file', () => {
    expect(parseHeader('export const x = 1;\n/** @spec 001 */\n')).toBeNull();
  });

  it('accepts the em dash pure tooling uses for @story', () => {
    const tooling = GOOD.replace('@story   US-1.1 — Install the game', '@story   —');
    const header = parseHeader(tooling);
    expect(header?.stories).toEqual([]);
    expect(header?.storyDeclared).toBe(true);
  });
});

describe('validateHeader', () => {
  it('accepts a complete, resolving header', () => {
    expect(validateHeader(parseHeader(GOOD), KNOWN)).toEqual([]);
  });

  it('rejects a missing header outright', () => {
    expect(validateHeader(null, KNOWN)).toHaveLength(1);
  });

  it('rejects a task ID that does not exist in 03', () => {
    const bad = parseHeader(GOOD.replace('T-0.1 — Scaffold, T-0.2 — Base path', 'T-9.9 — Made up'));
    expect(validateHeader(bad, KNOWN)).toEqual([
      { field: '@task', message: 'T-9.9 does not resolve against 03' },
    ]);
  });

  it('rejects a story ID that does not exist in 02', () => {
    const bad = parseHeader(GOOD.replace('US-1.1 — Install the game', 'US-9.9 — Made up'));
    expect(validateHeader(bad, KNOWN).map((p) => p.field)).toEqual(['@story']);
  });

  it('requires a task, because a module that cannot name one should not exist', () => {
    const bad = parseHeader(GOOD.replace('@task    T-0.1 — Scaffold, T-0.2 — Base path\n * ', ''));
    expect(validateHeader(bad, KNOWN).some((p) => p.field === '@task')).toBe(true);
  });

  it('requires a Purpose', () => {
    const bad = parseHeader(GOOD.replace('Purpose: does a thing, for a reason.', ''));
    expect(validateHeader(bad, KNOWN).some((p) => p.field === 'Purpose')).toBe(true);
  });
});

const PROGRESS = `# PROGRESS

## In-flight

- **Task:** T-0.2 — Base path
- **Status:** in_progress

---

## Tasks

| Task | Description | Size | Status | Commits |
|---|---|---|---|---|
| T-0.1 | Scaffold | S | \`done\` | abc |
| T-0.2 | Base path | S | \`in_progress\` | |
| T-1.1 | PRNG | S | \`todo\` | |
`;

describe('PROGRESS.md validation', () => {
  const specTasks = ['T-0.1', 'T-0.2', 'T-1.1'];

  it('parses rows and the in-flight block', () => {
    expect(parseRows(PROGRESS).map((row) => row.task)).toEqual(['T-0.1', 'T-0.2', 'T-1.1']);
    expect(parseInFlight(PROGRESS).task).toBe('T-0.2');
  });

  it('reports no problems for a consistent file', () => {
    const result = check(PROGRESS, KNOWN.tasks, specTasks);
    expect(result.problems).toEqual([]);
    expect(result.counted).toMatchObject({ done: 1, in_progress: 1, todo: 1 });
  });

  it('catches a row whose task does not exist in 03', () => {
    const bad = PROGRESS.replace('| T-1.1 | PRNG', '| T-9.9 | Ghost');
    expect(check(bad, KNOWN.tasks, specTasks).problems.join()).toMatch(/T-9.9 does not resolve/);
  });

  it('catches a task defined in 03 with no row — an orphan', () => {
    const bad = PROGRESS.replace('| T-1.1 | PRNG | S | `todo` | |\n', '');
    expect(check(bad, KNOWN.tasks, specTasks).problems.join()).toMatch(/T-1.1 is defined in 03/);
  });

  it('catches a duplicated row', () => {
    const bad = `${PROGRESS}| T-0.1 | Scaffold again | S | \`done\` | |\n`;
    expect(check(bad, KNOWN.tasks, specTasks).problems.join()).toMatch(/more than once/);
  });

  it('catches an invalid status', () => {
    const bad = PROGRESS.replace('`todo`', '`nearly`');
    expect(check(bad, KNOWN.tasks, specTasks).problems.join()).toMatch(/expected one of/);
  });

  it('catches two tasks in progress at once (`CLAUDE.md` §2)', () => {
    const bad = PROGRESS.replace(
      '| T-1.1 | PRNG | S | `todo`',
      '| T-1.1 | PRNG | S | `in_progress`',
    );
    expect(check(bad, KNOWN.tasks, specTasks).problems.join()).toMatch(/at most one may be/);
  });

  it('catches an in-flight task with no row in the table', () => {
    const bad = PROGRESS.replace('**Task:** T-0.2 — Base path', '**Task:** T-1.1 — PRNG').replace(
      '| T-1.1 | PRNG | S | `todo` | |\n',
      '',
    );
    expect(check(bad, KNOWN.tasks, ['T-0.1', 'T-0.2']).problems.join()).toMatch(/has no row/);
  });

  it('accepts an empty in-flight block', () => {
    const idle = PROGRESS.replace('**Task:** T-0.2 — Base path', '**Task:** —').replace(
      '**Status:** in_progress',
      '**Status:** none',
    );
    expect(parseInFlight(idle).task).toBeNull();
    // The table still has an in_progress row, which is a separate concern from In-flight.
    expect(check(idle, KNOWN.tasks, specTasks).problems).toEqual([]);
  });

  it('recognises exactly the five statuses from `CLAUDE.md` §3.2', () => {
    expect([...VALID_STATUSES]).toEqual(['todo', 'in_progress', 'blocked', 'done', 'cut']);
  });
});
