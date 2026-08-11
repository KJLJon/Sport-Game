/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory), §6 (the athlete card), §11 (accessibility)
 *
 * Purpose: the two data primitives `10` §5 named and the project had never built — the attribute
 * radar and the stat table. Both exist to carry numbers, so what is tested is that the numbers
 * survive the drawing: the radar's geometry against trigonometry rather than against a coordinate
 * string, and the table's structure against what a screen reader actually navigates.
 */
import { describe, expect, it } from 'vitest';
import { attributeRadar, radarDescription, radarPoints } from '../../../src/ui/components/radar.ts';
import { statTable } from '../../../src/ui/components/table.ts';
import { ATTRIBUTE_IDS, type Attributes } from '../../../src/athletes/types.ts';

function attributes(fill: number, overrides: Partial<Attributes> = {}): Attributes {
  const base = Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, fill])) as Attributes;
  return { ...base, ...overrides };
}

describe('the attribute radar (`10` §6)', () => {
  it('puts the first axis at twelve o’clock and runs clockwise', () => {
    const points = radarPoints([99, 99, 99, 99], 50, 100);

    // Directly above the centre: same x, smaller y.
    expect(points[0]?.x).toBeCloseTo(100, 5);
    expect(points[0]?.y).toBeCloseTo(50, 5);
    // A quarter turn clockwise is to the right.
    expect(points[1]?.x).toBeCloseTo(150, 5);
    expect(points[1]?.y).toBeCloseTo(100, 5);
  });

  it('scales each spoke by its value, and clamps beyond the 1–99 range', () => {
    // Four axes: top, right, bottom, left.
    const [low, high, over, under] = radarPoints([0, 99, 400, -50], 50, 100);

    // A zero sits on the centre; a 99 sits on the rim of its own axis.
    expect(low?.y).toBeCloseTo(100, 5);
    expect(high?.x).toBeCloseTo(150, 5);
    // Out-of-range values are clamped to the rim and to the centre, never drawn outside the plot.
    expect(over?.y).toBeCloseTo(150, 5);
    expect(under?.x).toBeCloseTo(100, 5);
    expect(under?.y).toBeCloseTo(100, 5);
  });

  it('says the whole shape in words, because a polygon reads as nothing', () => {
    const description = radarDescription({
      label: 'Ada',
      attributes: attributes(60, { speed: 88 }),
    });

    expect(description.startsWith('Ada: ')).toBe(true);
    expect(description).toContain('Speed 88');
    // Every one of the eleven attributes is named, not just the interesting ones.
    for (const id of ATTRIBUTE_IDS) {
      expect(description.toLowerCase()).toContain(id.slice(0, 4).toLowerCase());
    }
  });

  it('hides the drawing from assistive tech and names the group instead', () => {
    const node = attributeRadar(document, {
      series: [{ label: 'Ada', attributes: attributes(50) }],
    });

    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toContain('Speed 50');
    expect(node.querySelector('.attribute-radar__plot')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders one row per attribute, with a number per series', () => {
    const node = attributeRadar(document, {
      series: [
        { label: 'Ada', attributes: attributes(50, { strength: 71 }) },
        { label: 'Bo', attributes: attributes(40, { strength: 33 }) },
      ],
    });

    const rows = node.querySelectorAll('.attribute-radar__row');
    expect(rows).toHaveLength(ATTRIBUTE_IDS.length);
    expect(rows[0]?.querySelectorAll('.attribute-radar__value')).toHaveLength(2);

    const strengthRow = [...rows].find((row) => row.textContent?.startsWith('Strength'));
    expect(strengthRow?.textContent).toBe('Strength7133');
  });

  it('separates the two shapes by line style, not only by colour (INV-11)', () => {
    const node = attributeRadar(document, {
      series: [
        { label: 'Ada', attributes: attributes(50) },
        { label: 'Bo', attributes: attributes(40) },
      ],
    });

    const roles = [...node.querySelectorAll('.attribute-radar__shape')].map((shape) =>
      shape.getAttribute('data-role'),
    );
    expect(roles).toEqual(['primary', 'compare']);
    // The legend names both, so the distinction is readable as text too.
    expect(node.querySelectorAll('.attribute-radar__key')).toHaveLength(2);
  });

  it('drops the value list on request without dropping the accessible description', () => {
    const node = attributeRadar(document, {
      series: [{ label: 'Ada', attributes: attributes(50) }],
      hideValues: true,
    });

    expect(node.querySelector('.attribute-radar__values')).toBeNull();
    expect(node.getAttribute('aria-label')).toContain('Speed 50');
    // One series needs no legend — the shape is the only shape.
    expect(node.querySelector('.attribute-radar__legend')).toBeNull();
  });
});

const COLUMNS = [
  { key: 'points', label: 'PTS', description: 'Points' },
  { key: 'rebounds', label: 'REB' },
] as const;

describe('the stat table (`10` §5)', () => {
  it('is navigable: a caption, column scopes, and a row header per row', () => {
    const node = statTable(document, {
      caption: 'Home — 88',
      columns: [...COLUMNS],
      rows: [
        { header: 'Ada', values: { points: 24, rebounds: 7 } },
        { header: 'Bo', values: { points: 11, rebounds: 3 } },
      ],
    });

    expect(node.querySelector('caption')?.textContent).toBe('Home — 88');
    expect([...node.querySelectorAll('th[scope="col"]')].map((th) => th.textContent)).toEqual([
      'PTS',
      'REB',
    ]);
    expect(node.querySelectorAll('tbody th[scope="row"]')).toHaveLength(2);
    // The scroll box is reachable from a keyboard, and named when it gets there.
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(node.getAttribute('aria-label')).toBe('Home — 88');
  });

  it('leaves the corner an unnamed `td` unless the row headers are given a name', () => {
    const bare = statTable(document, { caption: 'Splits', columns: [...COLUMNS], rows: [] });
    expect(bare.querySelector('thead td.stat-table__corner')).not.toBeNull();

    const named = statTable(document, {
      caption: 'Splits',
      rowHeaderLabel: 'Athlete',
      columns: [...COLUMNS],
      rows: [],
    });
    expect(named.querySelector('thead th.stat-table__corner')?.textContent).toBe('Athlete');
  });

  it('spells short column labels out for the reader who cannot expand "FG"', () => {
    const node = statTable(document, { caption: 'Line', columns: [...COLUMNS], rows: [] });
    const [points, rebounds] = node.querySelectorAll('th[scope="col"]');

    expect(points?.getAttribute('aria-label')).toBe('Points');
    expect(points?.getAttribute('title')).toBe('Points');
    // No description, no attribute — a label that already says what it means is not repeated.
    expect(rebounds?.hasAttribute('aria-label')).toBe(false);
  });

  it('renders a missing value as an em dash rather than as nothing', () => {
    const node = statTable(document, {
      caption: 'Line',
      columns: [...COLUMNS],
      rows: [{ header: 'Ada', values: { points: 0 } }],
    });

    const cells = [...node.querySelectorAll('tbody td')].map((cell) => cell.textContent);
    // A real zero is a zero. Only an absent value becomes a dash.
    expect(cells).toEqual(['0', '—']);
  });

  it('puts totals in the foot and marks the reader’s own row', () => {
    const node = statTable(document, {
      caption: 'Line',
      columns: [...COLUMNS],
      rows: [{ header: 'Ada', values: { points: 24, rebounds: 7 }, emphasis: true }],
      totals: { header: 'Team', values: { points: 88, rebounds: 41 } },
    });

    expect(node.querySelector('tfoot th')?.textContent).toBe('Team');
    expect(node.querySelector('tbody tr')?.getAttribute('data-emphasis')).toBe('true');
  });

  it('says so when there is nothing to show (`10` §10)', () => {
    const node = statTable(document, {
      caption: 'Career',
      columns: [...COLUMNS],
      rows: [],
      emptyText: 'No matches played yet.',
    });

    const empty = node.querySelector('.stat-table__empty');
    expect(empty?.textContent).toBe('No matches played yet.');
    // The message spans the full width, including the row-header column.
    expect(empty?.getAttribute('colspan')).toBe('3');
  });
});
