/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §11.2 (prefer the quiet command)
 *
 * Purpose: prints one section of one spec document. `pnpm spec 09 5` gives §5 of
 * `09-modes-and-arcade.md`; `pnpm spec 03 "Phase 5"` gives that block; `pnpm spec 09` with no
 * selector gives the outline. This replaces the grep-for-a-line-number-then-read-a-range dance
 * that `CLAUDE.md` §11.2 asks for but does not make easy.
 *
 * A section runs from its heading to the next heading of the same or shallower depth, so asking
 * for `§2` gets `2.1`–`2.5` with it and asking for `§2.4` gets only that subsection.
 *
 * Added in Phase 5.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = fileURLToPath(new URL('../specs/001-initial-dev', import.meta.url));

export interface Heading {
  /** `#` count: 1 for the title, 2 for `##`, and so on. */
  readonly depth: number;
  /** Leading number when the heading carries one: `2.4` for `### 2.4 Key moments`. */
  readonly number: string | null;
  readonly title: string;
  /** 1-based line number of the heading itself. */
  readonly line: number;
}

const FENCE = /^\s*```/;

/** Headings outside fenced code blocks. A `# comment` inside a snippet is not a heading. */
export function parseHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;

  for (const [index, line] of markdown.split('\n').entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match === null) continue;

    const text = (match[2] ?? '').trim();
    const numbered = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(text);
    out.push({
      depth: (match[1] ?? '').length,
      number: numbered?.[1] ?? null,
      title: numbered?.[2] ?? text,
      line: index + 1,
    });
  }

  return out;
}

/**
 * Finds the heading a selector names. A selector that parses as a section number matches the
 * number exactly; anything else is a case-insensitive substring of the heading text.
 */
export function findHeading(headings: readonly Heading[], selector: string): Heading | null {
  const wanted = selector.trim().replace(/^§/, '');

  if (/^\d+(\.\d+)*$/.test(wanted)) {
    const exact = headings.find((heading) => heading.number === wanted);
    if (exact !== undefined) return exact;
  }

  const needle = wanted.toLowerCase();
  return (
    headings.find((heading) =>
      `${heading.number ?? ''} ${heading.title}`.toLowerCase().includes(needle),
    ) ?? null
  );
}

export interface Extract {
  readonly heading: Heading;
  readonly text: string;
  readonly firstLine: number;
  readonly lastLine: number;
}

/** Slices from a heading to the next heading of the same or shallower depth. */
export function extractSection(markdown: string, heading: Heading): Extract {
  const lines = markdown.split('\n');
  const following = parseHeadings(markdown).find(
    (candidate) => candidate.line > heading.line && candidate.depth <= heading.depth,
  );
  const end = following === undefined ? lines.length : following.line - 1;
  const body = lines.slice(heading.line - 1, end);

  while (body.length > 0 && (body.at(-1) ?? '').trim() === '') body.pop();

  return {
    heading,
    text: body.join('\n'),
    firstLine: heading.line,
    lastLine: heading.line + body.length - 1,
  };
}

/** Resolves `09`, `9`, or `modes` to a spec filename. */
export async function resolveDoc(names: readonly string[], token: string): Promise<string | null> {
  const wanted = token.trim().toLowerCase().replace(/\.md$/, '');
  const padded = /^\d+$/.test(wanted) ? wanted.padStart(2, '0') : null;

  if (padded !== null) {
    return names.find((name) => name.startsWith(`${padded}-`)) ?? null;
  }
  return names.find((name) => name.toLowerCase().includes(wanted)) ?? null;
}

function outline(name: string, headings: readonly Heading[]): string {
  const lines = [`${name} — outline`, ''];
  for (const heading of headings) {
    if (heading.depth > 3) continue;
    const indent = '  '.repeat(Math.max(0, heading.depth - 1));
    const number = heading.number === null ? '' : `${heading.number} `;
    lines.push(`${indent}${number}${heading.title}  (line ${heading.line})`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const [doc, ...rest] = process.argv.slice(2);
  const names = (await readdir(SPEC_DIR)).filter((name) => name.endsWith('.md')).sort();

  if (doc === undefined) {
    console.error(
      'usage: pnpm spec <doc> [section]     e.g. pnpm spec 09 5   ·   pnpm spec 03 "Phase 5"',
    );
    console.error(`docs: ${names.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const file = await resolveDoc(names, doc);
  if (file === null) {
    console.error(`no spec document matches "${doc}". Available: ${names.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const markdown = await readFile(join(SPEC_DIR, file), 'utf8');
  const headings = parseHeadings(markdown);
  const selector = rest.join(' ').trim();

  if (selector === '') {
    console.log(outline(file, headings));
    return;
  }

  const heading = findHeading(headings, selector);
  if (heading === null) {
    console.error(`no section matches "${selector}" in ${file}.\n`);
    console.error(outline(file, headings));
    process.exitCode = 1;
    return;
  }

  const section = extractSection(markdown, heading);
  console.log(`${file} · lines ${section.firstLine}–${section.lastLine}\n`);
  console.log(section.text);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  await main();
}
