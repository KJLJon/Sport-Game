/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §11 (token discipline)
 *
 * The API index is only worth reading if it is accurate. These pin the shapes it renders — a
 * wrong signature costs more than no signature, because it gets believed.
 */
import { describe, expect, it } from 'vitest';
import { collectSymbols, render, summaryOf } from '../../../tools/api-index.ts';

function symbols(source: string): ReturnType<typeof collectSymbols> {
  return collectSymbols(source, 'sample.ts');
}

describe('collectSymbols', () => {
  it('renders an exported function with its parameters and declared return', () => {
    expect(
      symbols('export function startRun(game: G, config: C): ArcadeRun { return x; }'),
    ).toEqual([
      { kind: 'function', name: 'startRun', signature: '(game, config) => ArcadeRun', summary: '' },
    ]);
  });

  it('marks optional and defaulted parameters, and rest parameters', () => {
    const [symbol] = symbols(
      'export function f(a: number, b = 2, c?: string, ...rest: X[]): void {}',
    );
    expect(symbol?.signature).toBe('(a, b?, c?, ...rest) => void');
  });

  it('says the return type is inferred rather than guessing at it', () => {
    const [symbol] = symbols('export function f(a: number) { return a; }');
    expect(symbol?.signature).toBe('(a) => ?');
  });

  it('renders a class by its constructor and its own name', () => {
    const source = 'export class ArcadeRun { constructor(game: G, config: C, overrides?: O) {} }';
    expect(symbols(source)[0]).toEqual({
      kind: 'class',
      name: 'ArcadeRun',
      signature: '(game, config, overrides?) => ArcadeRun',
      summary: '',
    });
  });

  it('renders a class with no constructor as taking nothing', () => {
    expect(symbols('export class Bus { publish(e: E): void {} }')[0]?.signature).toBe('() => Bus');
  });

  it('renders an interface as its member names', () => {
    const source = 'export interface CanvasSize { width: number; height: number; dpr: number }';
    expect(symbols(source)[0]).toMatchObject({
      kind: 'interface',
      name: 'CanvasSize',
      signature: '{ width, height, dpr }',
    });
  });

  it('caps long member lists with a count of the remainder', () => {
    const fields = Array.from({ length: 14 }, (_, i) => `f${i}: number`).join('; ');
    expect(symbols(`export interface Wide { ${fields} }`)[0]?.signature).toContain('…+4');
  });

  it('renders type aliases and enums', () => {
    expect(symbols("export type Side = 'home' | 'away';")[0]).toMatchObject({
      kind: 'type',
      signature: "= 'home' | 'away'",
    });
    expect(symbols('export enum Phase { Tip, Live, Done }')[0]).toMatchObject({
      kind: 'enum',
      signature: '{ Tip, Live, Done }',
    });
  });

  it('treats an exported arrow constant as a function', () => {
    const [symbol] = symbols('export const clamp = (v: number, lo: number): number => v;');
    expect(symbol).toMatchObject({ kind: 'function', signature: '(v, lo) => number' });
  });

  it('keeps the annotation on a plain exported constant', () => {
    expect(symbols('export const READY_SECONDS: number = 3;')[0]).toMatchObject({
      kind: 'const',
      name: 'READY_SECONDS',
      signature: ': number',
    });
  });

  it('lists every declarator in one exported statement', () => {
    expect(symbols('export const a = 1, b = 2;').map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('ignores everything that is not exported', () => {
    expect(symbols('function hidden(): void {}\nconst also = 1;\nclass Nope {}')).toEqual([]);
  });

  it('records named and star re-exports with their module', () => {
    const source =
      "export { basketball } from './basketball/index.ts';\nexport * from './types.ts';";
    expect(symbols(source)).toEqual([
      {
        kind: 're-export',
        name: 'basketball',
        signature: "from './basketball/index.ts'",
        summary: '',
      },
      { kind: 're-export', name: '*', signature: "from './types.ts'", summary: '' },
    ]);
  });

  it('attaches the JSDoc summary to the symbol it documents', () => {
    const source = '/** Starts one run. */\nexport function startRun(): void {}';
    expect(symbols(source)[0]?.summary).toBe('Starts one run.');
  });

  it('does not mistake a spec header for a summary', () => {
    const source = '/**\n * @spec 001-initial-dev\n * Purpose: x\n */\nexport const a = 1;';
    expect(symbols(source)[0]?.summary).toBe('');
  });
});

describe('summaryOf', () => {
  it('reads the first prose line across a multi-line comment', () => {
    const source =
      '/**\n * One run of one mini-game.\n * More detail here.\n */\nexport const a = 1;';
    expect(summaryOf(source, 0)).toBe('One run of one mini-game.');
  });

  it('returns nothing when there is no JSDoc', () => {
    expect(summaryOf('// plain\nexport const a = 1;', 0)).toBe('');
  });
});

describe('render', () => {
  const files = [
    { path: 'modes/arcade/session.ts', symbols: symbols('export function startRun(g: G): R {}') },
    { path: 'modes/arcade/types.ts', symbols: symbols('export interface Cfg { a: number }') },
    { path: 'sports/types.ts', symbols: symbols('export interface SportModule { id: string }') },
    { path: 'empty.ts', symbols: [] },
  ];

  it('groups by directory and prints one self-contained line per symbol', () => {
    const markdown = render(files);
    expect(markdown).toContain('## src/modes/arcade/');
    expect(markdown).toContain('## src/sports/');
    expect(markdown).toContain('- `src/modes/arcade/session.ts`  function startRun  (g) => R');
  });

  it('emits one heading per directory, not one per file', () => {
    expect(render(files).match(/^## src\/modes\/arcade\//gm)).toHaveLength(1);
  });

  it('skips modules with nothing exported', () => {
    expect(render(files)).not.toContain('empty.ts');
  });
});
