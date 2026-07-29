/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.17 — Spec-header lint rule + traceability report generator
 * @story   —
 * @design  CLAUDE.md §11 (token discipline), CLAUDE.md §6 (generated docs)
 *
 * Purpose: generates `docs/api-index.md` — one line per exported symbol under `src/`, with its
 * shape and its one-line summary — so a session can answer "what does this module export, and
 * what is the signature" from a single file instead of a dozen exploratory reads.
 *
 * **Why syntactic, not a type-checked program.** The index is a navigation aid, not documentation
 * of record: it prints what the source *declares*. Building a full `ts.Program` would resolve
 * inferred return types at the cost of seconds per run and a dependency on a green typecheck,
 * and an index that only works when the build is green is useless exactly when you need it most.
 * Where a return type is not annotated the line says so rather than guessing.
 *
 * Added in Phase 5 alongside `pnpm trace`; regenerate both at every phase gate.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const OUT = fileURLToPath(new URL('../docs/api-index.md', import.meta.url));

export interface ApiSymbol {
  /** `class` · `function` · `const` · `interface` · `type` · `enum` · `re-export`. */
  readonly kind: string;
  readonly name: string;
  /** Rendered shape: a parameter list and return, a member list, or an aliased type. */
  readonly signature: string;
  /** First prose line of the leading JSDoc, or `''`. */
  readonly summary: string;
}

export interface ApiFile {
  readonly path: string;
  readonly symbols: readonly ApiSymbol[];
}

const MAX_TYPE = 64;
const MAX_MEMBERS = 10;

function squash(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, limit = MAX_TYPE): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function textOf(node: ts.Node | undefined, source: string): string {
  if (node === undefined) return '';
  return truncate(squash(source.slice(node.pos, node.end)));
}

function nameOf(node: ts.Node | undefined): string {
  if (node === undefined) return '?';
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return '?';
}

/**
 * Takes the leading JSDoc's first prose line. Tag lines (`@param`, the spec header's `@task`) are
 * not summaries, so a comment that opens with a tag yields nothing.
 */
export function summaryOf(source: string, pos: number): string {
  const ranges = ts.getLeadingCommentRanges(source, pos) ?? [];
  const doc = [...ranges]
    .reverse()
    .find((range) => source.slice(range.pos, range.pos + 3) === '/**');
  if (doc === undefined) return '';

  for (const raw of source.slice(doc.pos + 3, doc.end - 2).split('\n')) {
    const line = raw.replace(/^\s*\*+\s?/, '').trim();
    if (line === '') continue;
    if (line.startsWith('@')) return '';
    return truncate(squash(line), 110);
  }
  return '';
}

function params(list: readonly ts.ParameterDeclaration[]): string {
  const rendered = list.map((param) => {
    const optional = param.questionToken !== undefined || param.initializer !== undefined;
    const spread = param.dotDotDotToken !== undefined ? '...' : '';
    return `${spread}${nameOf(param.name)}${optional ? '?' : ''}`;
  });
  return `(${rendered.join(', ')})`;
}

function returns(type: ts.TypeNode | undefined, source: string): string {
  return type === undefined ? ' => ?' : ` => ${textOf(type, source)}`;
}

function members(names: readonly string[]): string {
  const shown = names.slice(0, MAX_MEMBERS);
  const tail = names.length > MAX_MEMBERS ? `, …+${names.length - MAX_MEMBERS}` : '';
  return `{ ${shown.join(', ')}${tail} }`;
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    : false;
}

function fromValueDeclaration(
  declaration: ts.VariableDeclaration,
  source: string,
  kind: string,
): ApiSymbol {
  const name = nameOf(declaration.name);
  const init = declaration.initializer;

  if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
    return {
      kind: 'function',
      name,
      signature: `${params(init.parameters)}${returns(init.type, source)}`,
      summary: '',
    };
  }

  const annotated = declaration.type !== undefined ? `: ${textOf(declaration.type, source)}` : '';
  return { kind, name, signature: annotated, summary: '' };
}

/** Reads one file's exported surface. Non-exported declarations are deliberately invisible. */
export function collectSymbols(source: string, fileName: string): ApiSymbol[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS,
  );
  const out: ApiSymbol[] = [];

  for (const statement of file.statements) {
    const summary = summaryOf(source, statement.pos);
    const push = (symbol: Omit<ApiSymbol, 'summary'>, own = summary): void => {
      out.push({ ...symbol, summary: own });
    };

    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      push({
        kind: 'function',
        name: nameOf(statement.name),
        signature: `${params(statement.parameters)}${returns(statement.type, source)}`,
      });
      continue;
    }

    if (ts.isClassDeclaration(statement) && isExported(statement)) {
      const name = nameOf(statement.name);
      const ctor = statement.members.find(ts.isConstructorDeclaration);
      push({
        kind: 'class',
        name,
        signature: `${ctor === undefined ? '()' : params(ctor.parameters)} => ${name}`,
      });
      continue;
    }

    if (ts.isInterfaceDeclaration(statement) && isExported(statement)) {
      push({
        kind: 'interface',
        name: nameOf(statement.name),
        signature: members(statement.members.map((member) => nameOf(member.name))),
      });
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement) && isExported(statement)) {
      push({
        kind: 'type',
        name: nameOf(statement.name),
        signature: `= ${textOf(statement.type, source)}`,
      });
      continue;
    }

    if (ts.isEnumDeclaration(statement) && isExported(statement)) {
      push({
        kind: 'enum',
        name: nameOf(statement.name),
        signature: members(statement.members.map((member) => nameOf(member.name))),
      });
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      const kind = statement.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let';
      for (const [index, declaration] of statement.declarationList.declarations.entries()) {
        const symbol = fromValueDeclaration(declaration, source, kind);
        push(symbol, index === 0 ? summary : '');
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const from =
        statement.moduleSpecifier === undefined
          ? ''
          : ` from ${squash(source.slice(statement.moduleSpecifier.pos, statement.moduleSpecifier.end))}`;
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          push({ kind: 're-export', name: nameOf(element.name), signature: from.trim() }, '');
        }
      } else {
        push({ kind: 're-export', name: '*', signature: from.trim() }, '');
      }
    }
  }

  return out;
}

async function walk(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      out.push(...(await walk(full, root)));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push(full.slice(root.length + 1));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function render(files: readonly ApiFile[]): string {
  const total = files.reduce((sum, file) => sum + file.symbols.length, 0);
  const lines: string[] = [
    '# API index',
    '',
    '<!-- Generated by `pnpm api`. Do not edit by hand. -->',
    '',
    `${total} exported symbols across ${files.length} modules under \`src/\`. Read this before`,
    'opening a source file — it is the cheapest way to find a name, a signature, or an owner.',
    '',
    'Return types are as *declared*: `=> ?` means the source left it to inference.',
    '',
  ];

  let currentDir = '';
  for (const file of files) {
    if (file.symbols.length === 0) continue;
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    if (dir !== currentDir) {
      lines.push(`## src/${dir === '.' ? '' : `${dir}/`}`, '');
      currentDir = dir;
    }
    for (const symbol of file.symbols) {
      const signature = symbol.signature === '' ? '' : `  ${symbol.signature}`;
      const summary = symbol.summary === '' ? '' : `  — ${symbol.summary}`;
      lines.push(`- \`src/${file.path}\`  ${symbol.kind} ${symbol.name}${signature}${summary}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function main(): Promise<void> {
  const paths = await walk(SRC, SRC);
  const files: ApiFile[] = [];
  for (const path of paths) {
    const source = await readFile(join(SRC, path), 'utf8');
    files.push({ path, symbols: collectSymbols(source, path) });
  }

  const markdown = render(files);
  await mkdir(fileURLToPath(new URL('../docs', import.meta.url)), { recursive: true });
  await writeFile(OUT, markdown, 'utf8');

  const total = files.reduce((sum, file) => sum + file.symbols.length, 0);
  console.log(`api-index: ${total} symbols across ${files.length} modules → docs/api-index.md`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  await main();
}
