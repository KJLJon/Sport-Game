/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.18 — `PROGRESS.md` validation script: task IDs resolve, statuses valid, no orphans
 * @story   —
 * @design  CLAUDE.md §2 (the work loop — picking the next task), §11 (token discipline)
 *
 * Purpose: answers "what do I do next?" in one command instead of a session-start read of two
 * long markdown files. Joins `03`'s task table (size, deps, stories, suggested agent) with
 * `PROGRESS.md`'s statuses and prints the ready tasks — dependencies all `done` — in order,
 * with what is blocking everything else.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseRows, parseInFlight } from './progress-check.ts';

const SPEC_DIR = fileURLToPath(new URL('../specs/001-initial-dev', import.meta.url));

export interface TaskDef {
  readonly id: string;
  readonly phase: number;
  readonly description: string;
  readonly size: string;
  readonly deps: readonly string[];
  readonly stories: readonly string[];
  readonly agent: string;
}

/** Reads `03`'s per-phase task tables: `| T-7.1 | task | L | T-2.8 | US-7.1 | sonnet |`. */
export function parseTaskDefs(markdown: string): TaskDef[] {
  const defs: TaskDef[] = [];
  let phase = -1;

  for (const line of markdown.split('\n')) {
    const heading = /^##\s+Phase\s+(\d+)\b/.exec(line);
    if (heading?.[1] !== undefined) phase = Number(heading[1]);
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').map((cell) => cell.trim());
    const id = cells[1] ?? '';
    if (!/^T-\d+\.\d+$/.test(id)) continue;

    defs.push({
      id,
      phase,
      description: cells[2] ?? '',
      size: cells[3] ?? '',
      deps: [...(cells[4] ?? '').matchAll(/T-\d+\.\d+/g)].map((m) => m[0]),
      stories: [...(cells[5] ?? '').matchAll(/US-\d+\.\d+/g)].map((m) => m[0]),
      agent: cells[6] ?? '',
    });
  }

  return defs;
}

/** A task's dependencies are satisfied when every one of them is `done` or `cut`. */
function satisfied(deps: readonly string[], status: ReadonlyMap<string, string>): boolean {
  return deps.every((dep) => {
    const state = status.get(dep);
    return state === 'done' || state === 'cut';
  });
}

export interface NextTasks {
  readonly inFlight: { readonly task: string | null; readonly status: string };
  readonly ready: readonly TaskDef[];
  readonly blocked: readonly { readonly task: TaskDef; readonly waitingOn: readonly string[] }[];
  readonly phase: number | null;
}

export function selectNext(
  defs: readonly TaskDef[],
  status: ReadonlyMap<string, string>,
  options: { readonly phase?: number; readonly limit: number },
): NextTasks {
  const open = defs.filter((def) => {
    const state = status.get(def.id) ?? 'todo';
    return state !== 'done' && state !== 'cut';
  });

  // Default to the lowest phase with work left in it — the gate protocol forbids running ahead.
  const phase = options.phase ?? open[0]?.phase ?? null;
  const scoped = phase === null ? open : open.filter((def) => def.phase === phase);

  const ready = scoped.filter((def) => satisfied(def.deps, status)).slice(0, options.limit);
  const blocked = scoped
    .filter((def) => !satisfied(def.deps, status))
    .map((def) => ({
      task: def,
      waitingOn: def.deps.filter((dep) => {
        const state = status.get(dep);
        return state !== 'done' && state !== 'cut';
      }),
    }));

  return { inFlight: { task: null, status: '' }, ready, blocked, phase };
}

function format(result: NextTasks, status: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  const { inFlight } = result;

  if (inFlight.task !== null && inFlight.status === 'in_progress') {
    lines.push(`⏳ IN FLIGHT — ${inFlight.task} is in_progress. Finish or park it first.`, '');
  }

  lines.push(`Phase ${result.phase ?? '—'} · ready now:`);
  if (result.ready.length === 0) lines.push('  (nothing — the phase is done or fully blocked)');

  for (const def of result.ready) {
    const state = status.get(def.id) ?? 'todo';
    const marks = [def.size, state !== 'todo' ? state : '', def.agent && `agent:${def.agent}`]
      .filter(Boolean)
      .join(' ');
    lines.push(`  ${def.id.padEnd(7)} ${`[${marks}]`.padEnd(16)} ${def.description}`);
    if (def.stories.length > 0) lines.push(`  ${' '.repeat(7)} ${def.stories.join(', ')}`);
  }

  if (result.blocked.length > 0) {
    lines.push('', 'blocked:');
    for (const { task, waitingOn } of result.blocked) {
      lines.push(`  ${task.id.padEnd(7)} ← ${waitingOn.join(', ')}`);
    }
  }

  return lines.join('\n');
}

export async function run(argv: readonly string[]): Promise<string> {
  const phaseArg = argv.find((arg) => /^\d+$/.test(arg));
  const limitArg = /^--limit=(\d+)$/.exec(argv.find((a) => a.startsWith('--limit=')) ?? '')?.[1];

  const [tasksMd, progressMd] = await Promise.all([
    readFile(join(SPEC_DIR, '03-phases-and-tasks.md'), 'utf8'),
    readFile(join(SPEC_DIR, 'PROGRESS.md'), 'utf8'),
  ]);

  const defs = parseTaskDefs(tasksMd);
  const status = new Map(parseRows(progressMd).map((row) => [row.task, row.status]));
  const selected = selectNext(defs, status, {
    ...(phaseArg === undefined ? {} : { phase: Number(phaseArg) }),
    limit: limitArg === undefined ? 10 : Number(limitArg),
  });

  return format({ ...selected, inFlight: parseInFlight(progressMd) }, status);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  console.log(await run(process.argv.slice(2)));
}
