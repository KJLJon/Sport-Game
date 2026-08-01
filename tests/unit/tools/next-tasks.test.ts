/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.18 — PROGRESS.md validation script
 * @story   —
 * @design  CLAUDE.md §2 (picking the next task)
 */
import { describe, expect, it } from 'vitest';
import { parseTaskDefs, selectNext, type TaskDef } from '../../../tools/next-tasks.ts';

const TASKS = `## Phase 6 — Soccer

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-6.1 | Soccer rules | L | | US-4.1 | |
| T-6.2 | Soccer AI | M | T-6.1 | US-4.3 | sonnet |

## Phase 7 — CPU AI depth

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-7.1 | Utility scoring | L | T-6.1 | US-7.1 | |
| T-7.2 | Roles | L | T-7.1 | US-7.1 | |
`;

function defs(): TaskDef[] {
  return parseTaskDefs(TASKS);
}

describe('parseTaskDefs', () => {
  it('reads id, phase, size, deps, stories, and agent', () => {
    expect(defs()).toEqual([
      {
        id: 'T-6.1',
        phase: 6,
        description: 'Soccer rules',
        size: 'L',
        deps: [],
        stories: ['US-4.1'],
        agent: '',
      },
      {
        id: 'T-6.2',
        phase: 6,
        description: 'Soccer AI',
        size: 'M',
        deps: ['T-6.1'],
        stories: ['US-4.3'],
        agent: 'sonnet',
      },
      {
        id: 'T-7.1',
        phase: 7,
        description: 'Utility scoring',
        size: 'L',
        deps: ['T-6.1'],
        stories: ['US-7.1'],
        agent: '',
      },
      {
        id: 'T-7.2',
        phase: 7,
        description: 'Roles',
        size: 'L',
        deps: ['T-7.1'],
        stories: ['US-7.1'],
        agent: '',
      },
    ]);
  });

  it('ignores the phase map and any other table without task IDs', () => {
    expect(parseTaskDefs('| 7 | CPU AI | Opponents | — |')).toEqual([]);
  });
});

describe('selectNext', () => {
  const status = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it('scopes to the lowest phase with work left, so a gate is not run past', () => {
    const result = selectNext(defs(), status({ 'T-6.1': 'done' }), { limit: 10 });
    expect(result.phase).toBe(6);
    expect(result.ready.map((task) => task.id)).toEqual(['T-6.2']);
  });

  it('moves on once the phase is done', () => {
    const result = selectNext(defs(), status({ 'T-6.1': 'done', 'T-6.2': 'done' }), { limit: 10 });
    expect(result.phase).toBe(7);
    expect(result.ready.map((task) => task.id)).toEqual(['T-7.1']);
    expect(result.blocked).toEqual([
      { task: expect.objectContaining({ id: 'T-7.2' }), waitingOn: ['T-7.1'] },
    ]);
  });

  it('treats a cut dependency as satisfied', () => {
    const result = selectNext(defs(), status({ 'T-6.1': 'cut', 'T-6.2': 'done' }), { limit: 10 });
    expect(result.ready.map((task) => task.id)).toEqual(['T-7.1']);
  });

  it('keeps an in_progress task in the ready list — it is the work to resume', () => {
    const result = selectNext(defs(), status({ 'T-6.1': 'done', 'T-6.2': 'in_progress' }), {
      limit: 10,
    });
    expect(result.ready.map((task) => task.id)).toEqual(['T-6.2']);
  });

  it('honours an explicit phase and the limit', () => {
    const result = selectNext(defs(), status({ 'T-6.1': 'done' }), { phase: 7, limit: 1 });
    expect(result.phase).toBe(7);
    expect(result.ready.map((task) => task.id)).toEqual(['T-7.1']);
  });
});
