/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §6 (code documentation — spec traceability)
 * @invariant INV-15 (every src/ module carries a valid, resolving spec header)
 *
 * Purpose: parses spec headers, and parses `03` and `02` for the task and story IDs a header is
 * allowed to name. Shared by the lint rule, the traceability generator, and the PROGRESS
 * validator, so all three agree on what "resolves" means.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface SpecHeader {
  readonly spec: string;
  readonly phase: string;
  readonly tasks: readonly string[];
  readonly stories: readonly string[];
  readonly design: readonly string[];
  readonly invariants: readonly string[];
  readonly purpose: string;
  /** True when an `@story` tag is present at all, including the em dash pure tooling uses. */
  readonly storyDeclared: boolean;
}

export interface HeaderProblem {
  readonly field: string;
  readonly message: string;
}

const TASK_ID = /\bT-\d+\.\d+\b/g;
const STORY_ID = /\bUS-\d+\.\d+\b/g;

/** Reads the leading block comment. A header anywhere else is not a header. */
export function extractHeaderComment(source: string): string | null {
  const trimmed = source.replace(/^#!.*\n/, '').trimStart();
  if (!trimmed.startsWith('/**')) return null;
  const end = trimmed.indexOf('*/');
  if (end === -1) return null;
  return trimmed.slice(0, end + 2);
}

function tag(comment: string, name: string): string | null {
  const match = new RegExp(`@${name}\\s+([^\\n]*(?:\\n\\s*\\*\\s{2,}[^\\n@][^\\n]*)*)`).exec(
    comment,
  );
  if (match?.[1] === undefined) return null;
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s*/, '').trim())
    .join(' ')
    .trim();
}

export function parseHeader(source: string): SpecHeader | null {
  const comment = extractHeaderComment(source);
  if (comment === null) return null;

  const purposeMatch = /Purpose:\s*([\s\S]*?)(?:\n\s*\*\/|$)/.exec(comment);
  const purpose =
    purposeMatch?.[1]
      ?.split('\n')
      .map((line) => line.replace(/^\s*\*\s*/, '').trim())
      .join(' ')
      .trim() ?? '';

  const taskField = tag(comment, 'task') ?? '';
  const storyField = tag(comment, 'story') ?? '';

  return {
    spec: tag(comment, 'spec') ?? '',
    phase: tag(comment, 'phase') ?? '',
    tasks: [...taskField.matchAll(TASK_ID)].map((match) => match[0]),
    stories: [...storyField.matchAll(STORY_ID)].map((match) => match[0]),
    design: (tag(comment, 'design') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
    invariants: [...(tag(comment, 'invariant') ?? '').matchAll(/\bINV-\d+\b/g)].map((m) => m[0]),
    purpose,
    storyDeclared: /@story\s+\S/.test(comment),
  };
}

export interface KnownIds {
  readonly tasks: ReadonlySet<string>;
  readonly stories: ReadonlySet<string>;
}

/** Collects every task ID from `03` and every story ID from `02`. */
export async function loadKnownIds(specDir: string): Promise<KnownIds> {
  const phases = await readFile(join(specDir, '03-phases-and-tasks.md'), 'utf8');
  const stories = await readFile(join(specDir, '02-user-stories.md'), 'utf8');
  return {
    tasks: new Set([...phases.matchAll(TASK_ID)].map((match) => match[0])),
    stories: new Set([...stories.matchAll(STORY_ID)].map((match) => match[0])),
  };
}

/** `CLAUDE.md` §6 — `@spec`, `@phase`, `@task`, `@story`, and `Purpose` are mandatory. */
export function validateHeader(header: SpecHeader | null, known: KnownIds): HeaderProblem[] {
  if (header === null) {
    return [{ field: 'header', message: 'missing spec header (CLAUDE.md §6, INV-15)' }];
  }

  const problems: HeaderProblem[] = [];

  if (header.spec === '') problems.push({ field: '@spec', message: '@spec is required' });
  if (header.phase === '') problems.push({ field: '@phase', message: '@phase is required' });
  if (header.purpose === '') {
    problems.push({ field: 'Purpose', message: 'a Purpose: line is required' });
  }

  if (header.tasks.length === 0) {
    problems.push({
      field: '@task',
      message: '@task is required — a module that cannot name a task should not exist',
    });
  }
  for (const task of header.tasks) {
    if (!known.tasks.has(task)) {
      problems.push({ field: '@task', message: `${task} does not resolve against 03` });
    }
  }

  // `@story` must be present. Pure tooling with no user-facing story declares an em dash, which
  // is a deliberate statement rather than an omission.
  if (!header.storyDeclared) {
    problems.push({ field: '@story', message: '@story is required (use — for pure tooling)' });
  }
  for (const story of header.stories) {
    if (!known.stories.has(story)) {
      problems.push({ field: '@story', message: `${story} does not resolve against 02` });
    }
  }

  return problems;
}

export interface TracedFile {
  readonly path: string;
  /** `null` when the file carries no leading block comment at all — an INV-15 violation. */
  readonly header: SpecHeader | null;
}

const SOURCE_EXTENSIONS = ['.ts', '.css'];

/** Walks a directory, returning source files with parsed headers. */
export async function traceDirectory(dir: string, root: string = dir): Promise<TracedFile[]> {
  const out: TracedFile[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      out.push(...(await traceDirectory(full, root)));
      continue;
    }
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (entry.name.endsWith('.d.ts')) continue;

    out.push({
      path: full.slice(root.length + 1),
      header: parseHeader(await readFile(full, 'utf8')),
    });
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}
