/**
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory — stat table), §6 (career stats per sport),
 *          §11 (accessibility)
 *
 * Purpose: the stat table `10` §5 names — box scores, career lines, season splits. One `<table>`
 * with real `<th scope>` cells, because a screen reader navigates a table by its headers and a grid
 * of `<div>`s is not a table however it looks.
 *
 * Numbers are right-aligned with tabular figures (`10` §3.2) so a column of them reads as a column.
 */
import { el } from '../dom.ts';

export interface StatColumn {
  /** Keys into each row's `values`. */
  readonly key: string;
  /** The `<th scope="col">` text — short, because a column header is read once per cell. */
  readonly label: string;
  /**
   * Spelled out for the header's `title`, since "FG" is not a word. Omit when the label already
   * says what it means.
   */
  readonly description?: string;
  /** Numeric columns are right-aligned and tabular. Default `true`; the row header is neither. */
  readonly numeric?: boolean;
}

export interface StatRow {
  /** The `<th scope="row">` — an athlete's name, a season, a sport. */
  readonly header: string;
  readonly values: Readonly<Record<string, string | number>>;
  /** Highlights the row the reader is in — their own athlete in a list of ten. */
  readonly emphasis?: boolean;
}

export interface StatTableOptions {
  /**
   * A `<caption>`, which is a table's accessible name. Required: `10` §11 has no exemption for a
   * table, and there is no context in which "which table is this" is not worth one line.
   */
  readonly caption: string;
  readonly columns: readonly StatColumn[];
  readonly rows: readonly StatRow[];
  /**
   * Heads the row-header column — "Athlete", "Season". Omit and the corner is an empty `<td>`,
   * which is the convention when the row headers need no name of their own.
   */
  readonly rowHeaderLabel?: string;
  /** A `<tfoot>` line — totals, averages. Same shape as a row, drawn heavier. */
  readonly totals?: StatRow;
  /** Shown in place of the body when `rows` is empty (`10` §10 — the forgotten states). */
  readonly emptyText?: string;
}

/** Missing values render as an em dash, never as blank — a gap should look deliberate. */
const MISSING = '—';

function cellText(row: StatRow, column: StatColumn): string {
  const value = row.values[column.key];
  if (value === undefined || value === null || value === '') return MISSING;
  return typeof value === 'number' ? String(value) : value;
}

function bodyRow(doc: Document, row: StatRow, columns: readonly StatColumn[]): HTMLElement {
  return el(doc, 'tr', {
    class: 'stat-table__row',
    dataset: row.emphasis === true ? { emphasis: 'true' } : {},
    children: [
      el(doc, 'th', {
        class: 'stat-table__row-header',
        attrs: { scope: 'row' },
        text: row.header,
      }),
      ...columns.map((column) =>
        el(doc, 'td', {
          class: 'stat-table__cell',
          dataset: { numeric: String(column.numeric !== false) },
          text: cellText(row, column),
        }),
      ),
    ],
  });
}

export function statTable(doc: Document, options: StatTableOptions): HTMLElement {
  const { columns, rows } = options;

  const head = el(doc, 'thead', {
    children: [
      el(doc, 'tr', {
        children: [
          // Named, the corner is a real column header. Unnamed, it is an empty `<td>` rather than
          // an empty `<th>` — a header cell with nothing in it is a cell a screen reader announces
          // for no reason.
          options.rowHeaderLabel === undefined
            ? el(doc, 'td', { class: 'stat-table__corner' })
            : el(doc, 'th', {
                class: 'stat-table__column-header stat-table__corner',
                attrs: { scope: 'col' },
                dataset: { numeric: 'false' },
                text: options.rowHeaderLabel,
              }),
          ...columns.map((column) =>
            el(doc, 'th', {
              class: 'stat-table__column-header',
              attrs: {
                scope: 'col',
                title: column.description ?? null,
                'aria-label': column.description ?? null,
              },
              dataset: { numeric: String(column.numeric !== false) },
              text: column.label,
            }),
          ),
        ],
      }),
    ],
  });

  const body = el(doc, 'tbody', {
    children:
      rows.length > 0
        ? rows.map((row) => bodyRow(doc, row, columns))
        : [
            el(doc, 'tr', {
              class: 'stat-table__row',
              children: [
                el(doc, 'td', {
                  class: 'stat-table__empty',
                  attrs: { colspan: columns.length + 1 },
                  text: options.emptyText ?? 'Nothing here yet.',
                }),
              ],
            }),
          ],
  });

  const foot =
    options.totals === undefined
      ? null
      : el(doc, 'tfoot', {
          children: [bodyRow(doc, options.totals, columns)],
        });

  return el(doc, 'div', {
    class: 'stat-table',
    // A wide table scrolls inside its own box rather than pushing the page sideways. It is
    // focusable so the scroll is reachable from a keyboard, which needs a role and a name.
    attrs: { tabindex: '0', role: 'region', 'aria-label': options.caption },
    children: [
      el(doc, 'table', {
        class: 'stat-table__table',
        children: [
          el(doc, 'caption', { class: 'stat-table__caption', text: options.caption }),
          head,
          body,
          foot,
        ],
      }),
    ],
  });
}
