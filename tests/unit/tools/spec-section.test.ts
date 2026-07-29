/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §11.2 (prefer the quiet command)
 *
 * A section printer that silently prints the wrong range is worse than grep, because grep at
 * least shows its working. These pin the boundaries.
 */
import { describe, expect, it } from 'vitest';
import {
  extractSection,
  findHeading,
  parseHeadings,
  resolveDoc,
} from '../../../tools/spec-section.ts';

const DOC = [
  '# 09 — Play Modes',
  '',
  'Intro prose.',
  '',
  '## 1. Three ways',
  '',
  'One.',
  '',
  '## 2. Playbook mode (turn-based)',
  '',
  'Two.',
  '',
  '### 2.1 Shape of a match',
  '',
  'Two point one.',
  '',
  '### 2.2 Basketball',
  '',
  'Two point two.',
  '',
  '## 3. Arcade mode',
  '',
  'Three.',
  '',
].join('\n');

describe('parseHeadings', () => {
  it('reads depth, number, and line for each heading', () => {
    expect(parseHeadings(DOC)).toEqual([
      { depth: 1, number: '09', title: '— Play Modes', line: 1 },
      { depth: 2, number: '1', title: 'Three ways', line: 5 },
      { depth: 2, number: '2', title: 'Playbook mode (turn-based)', line: 9 },
      { depth: 3, number: '2.1', title: 'Shape of a match', line: 13 },
      { depth: 3, number: '2.2', title: 'Basketball', line: 17 },
      { depth: 2, number: '3', title: 'Arcade mode', line: 21 },
    ]);
  });

  it('leaves unnumbered headings unnumbered', () => {
    expect(parseHeadings('## Phase 5 — Playbook')[0]).toEqual({
      depth: 2,
      number: null,
      title: 'Phase 5 — Playbook',
      line: 1,
    });
  });

  it('ignores hashes inside fenced code', () => {
    const fenced = ['## Real', '', '```sh', '# not a heading', '```', '', '## Also real'].join(
      '\n',
    );
    expect(parseHeadings(fenced).map((h) => h.title)).toEqual(['Real', 'Also real']);
  });
});

describe('findHeading', () => {
  const headings = parseHeadings(DOC);

  it('matches a section number exactly, not as a prefix', () => {
    expect(findHeading(headings, '2')?.title).toBe('Playbook mode (turn-based)');
    expect(findHeading(headings, '2.1')?.title).toBe('Shape of a match');
  });

  it('accepts a leading section sign', () => {
    expect(findHeading(headings, '§3')?.title).toBe('Arcade mode');
  });

  it('falls back to a case-insensitive title match', () => {
    expect(findHeading(headings, 'arcade')?.number).toBe('3');
  });

  it('returns null when nothing matches', () => {
    expect(findHeading(headings, 'offside')).toBeNull();
  });
});

describe('extractSection', () => {
  const headings = parseHeadings(DOC);

  it('takes a section together with its subsections', () => {
    const section = extractSection(DOC, findHeading(headings, '2') as never);
    expect(section.text).toContain('### 2.1');
    expect(section.text).toContain('Two point two.');
    expect(section.text).not.toContain('Arcade mode');
    expect(section).toMatchObject({ firstLine: 9, lastLine: 19 });
  });

  it('takes a subsection alone', () => {
    const section = extractSection(DOC, findHeading(headings, '2.1') as never);
    expect(section.text).toContain('Two point one.');
    expect(section.text).not.toContain('2.2');
  });

  it('runs a final section to the end of the document', () => {
    const section = extractSection(DOC, findHeading(headings, '3') as never);
    expect(section.text.trimEnd().endsWith('Three.')).toBe(true);
  });
});

describe('resolveDoc', () => {
  const names = ['03-phases-and-tasks.md', '09-modes-and-arcade.md', 'PROGRESS.md', 'README.md'];

  it('pads a bare number to the filename prefix', async () => {
    expect(await resolveDoc(names, '9')).toBe('09-modes-and-arcade.md');
    expect(await resolveDoc(names, '03')).toBe('03-phases-and-tasks.md');
  });

  it('matches a name fragment case-insensitively', async () => {
    expect(await resolveDoc(names, 'progress')).toBe('PROGRESS.md');
    expect(await resolveDoc(names, 'modes.md')).toBe('09-modes-and-arcade.md');
  });

  it('returns null for an unknown document', async () => {
    expect(await resolveDoc(names, '99')).toBeNull();
  });
});
