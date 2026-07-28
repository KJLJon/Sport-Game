/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.18 — `PROGRESS.md` validation script: task IDs resolve, statuses valid, no orphans
 * @story   —
 * @design  CLAUDE.md §3 (PROGRESS.md — the resumable state)
 *
 * Purpose: `PROGRESS.md` is the project's memory, so it has to be trustworthy. This checks that
 * every task in `03` has a row, every row resolves to a real task, every status is one of the
 * five, and the In-flight block holds at most one task. A drifting tracker is worse than none.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadKnownIds } from './spec-index.ts';

const SPEC_DIR = fileURLToPath(new URL('../specs/001-initial-dev', import.meta.url));

export const VALID_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cut'] as const;
export type Status = (typeof VALID_STATUSES)[number];

export interface ProgressRow {
  readonly task: string;
  readonly status: string;
  readonly line: number;
}

/** Reads the task table rows: `| T-0.1 | description | S | \`done\` | … |`. */
export function parseRows(markdown: string): ProgressRow[] {
  const rows: ProgressRow[] = [];

  for (const [index, line] of markdown.split('\n').entries()) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const task = cells[1] ?? '';
    if (!/^T-\d+\.\d+$/.test(task)) continue;
    rows.push({ task, status: (cells[4] ?? '').replace(/`/g, ''), line: index + 1 });
  }

  return rows;
}

/** Reads the In-flight block's task, or `null` when nothing is in flight. */
export function parseInFlight(markdown: string): { task: string | null; status: string } {
  const block = /## In-flight([\s\S]*?)\n---/.exec(markdown)?.[1] ?? '';
  const taskLine = /\*\*Task:\*\*\s*(.*)/.exec(block)?.[1]?.trim() ?? '';
  const statusLine = /\*\*Status:\*\*\s*(.*)/.exec(block)?.[1]?.trim() ?? '';
  const id = /T-\d+\.\d+/.exec(taskLine)?.[0] ?? null;
  return { task: id, status: statusLine };
}

export interface CheckResult {
  readonly problems: readonly string[];
  readonly counted: Readonly<Record<Status, number>>;
}

export interface NotesLink {
  /** The row's task ID where there is one — decisions and gate rows are keyed by their own text. */
  readonly task: string;
  readonly file: string;
  readonly anchor: string;
  readonly line: number;
}

/**
 * Reads every `./notes/phase-N.md#anchor` link in the file. Since the Phase-5 split, a task row's
 * long-form rationale lives in the phase notes, and a link that points at nothing is the same as
 * having deleted the rationale — so the target is checked rather than trusted.
 */
export function parseNotesLinks(markdown: string): NotesLink[] {
  const out: NotesLink[] = [];

  for (const [index, line] of markdown.split('\n').entries()) {
    const task = /^\|\s*(T-\d+\.\d+)\s*\|/.exec(line)?.[1] ?? line.slice(0, 40).trim();
    for (const link of line.matchAll(/\]\(\.\/notes\/([^)#]+)#([^)]+)\)/g)) {
      out.push({ task, file: link[1] ?? '', anchor: link[2] ?? '', line: index + 1 });
    }
  }

  return out;
}

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return (
    heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      // One hyphen per space, not per run: GitHub turns `a · b` into `a--b` once `·` is dropped.
      .replace(/\s/g, '-')
  );
}

/** Every anchor a markdown file offers, from its headings. */
export function anchorsOf(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)?.[1];
    if (heading !== undefined) out.add(slug(heading.trim()));
  }
  return out;
}

export function check(
  markdown: string,
  knownTasks: ReadonlySet<string>,
  specTasks: readonly string[],
): CheckResult {
  const problems: string[] = [];
  const rows = parseRows(markdown);
  const seen = new Set<string>();
  const counted: Record<Status, number> = {
    todo: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    cut: 0,
  };

  for (const row of rows) {
    if (!knownTasks.has(row.task)) {
      problems.push(`line ${row.line}: ${row.task} does not resolve against 03`);
    }
    if (seen.has(row.task)) {
      problems.push(`line ${row.line}: ${row.task} appears more than once`);
    }
    seen.add(row.task);

    if (!(VALID_STATUSES as readonly string[]).includes(row.status)) {
      problems.push(
        `line ${row.line}: ${row.task} has status "${row.status}" — expected one of ${VALID_STATUSES.join(', ')}`,
      );
    } else {
      counted[row.status as Status] += 1;
    }
  }

  for (const task of specTasks) {
    if (!seen.has(task)) problems.push(`${task} is defined in 03 but has no row in PROGRESS.md`);
  }

  // `CLAUDE.md` §3.1 — exactly one task in flight, or none.
  const inFlight = parseInFlight(markdown);
  if (inFlight.task !== null) {
    if (!knownTasks.has(inFlight.task)) {
      problems.push(`In-flight names ${inFlight.task}, which does not resolve against 03`);
    }
    const row = rows.find((candidate) => candidate.task === inFlight.task);
    if (row === undefined) {
      problems.push(`In-flight names ${inFlight.task}, which has no row in the task table`);
    }
  }

  // `CLAUDE.md` §2 — never start a task while another is in progress.
  if (counted.in_progress > 1) {
    problems.push(`${counted.in_progress} tasks are in_progress; at most one may be`);
  }

  return { problems, counted };
}

async function main(): Promise<void> {
  const markdown = await readFile(join(SPEC_DIR, 'PROGRESS.md'), 'utf8');
  const phases = await readFile(join(SPEC_DIR, '03-phases-and-tasks.md'), 'utf8');
  const known = await loadKnownIds(SPEC_DIR);

  // Only IDs appearing in a table row of `03` are real tasks; prose mentions are not.
  const specTasks = [
    ...new Set(
      phases
        .split('\n')
        .filter((line) => line.startsWith('| T-'))
        .map((line) => /T-\d+\.\d+/.exec(line)?.[0] ?? '')
        .filter(Boolean),
    ),
  ];

  const result = check(markdown, known.tasks, specTasks);
  const problems = [...result.problems, ...(await checkNotesLinks(markdown))];

  const summary = Object.entries(result.counted)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
  console.log(`PROGRESS.md: ${summary}`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  }
}

/** Resolves every notes link against the file and heading it names. Filesystem, so not in `check`. */
async function checkNotesLinks(markdown: string): Promise<string[]> {
  const problems: string[] = [];
  const cache = new Map<string, Set<string> | null>();

  for (const link of parseNotesLinks(markdown)) {
    let anchors = cache.get(link.file);
    if (anchors === undefined) {
      anchors = await readFile(join(SPEC_DIR, 'notes', link.file), 'utf8')
        .then(anchorsOf)
        .catch(() => null);
      cache.set(link.file, anchors);
    }
    if (anchors === null) {
      problems.push(
        `line ${link.line}: ${link.task} links to notes/${link.file}, which is missing`,
      );
      continue;
    }
    if (!anchors.has(link.anchor)) {
      problems.push(
        `line ${link.line}: ${link.task} links to notes/${link.file}#${link.anchor}, which has no such heading`,
      );
    }
  }

  return problems;
}

if (process.argv[1]?.endsWith('progress-check.ts') === true) {
  await main();
}
