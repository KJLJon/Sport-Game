/**
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory — attribute radar), §6 (the athlete card),
 *          §11 (accessibility)
 * @invariant INV-11 (`10` §11 — nothing carried by colour alone)
 *
 * Purpose: the attribute radar `10` §6 puts on the full athlete card — the eleven sport-neutral
 * attributes as one shape, so two athletes can be told apart at a glance by silhouette.
 *
 * The polygon is a picture and nothing else: the numbers it draws are also emitted as a real list
 * beside it, because a shape is exactly the kind of thing a screen reader cannot read and a
 * colourblind player cannot separate from a second shape drawn over it.
 */
import { attributeLabel } from '../../athletes/explain.ts';
import { ATTRIBUTE_IDS } from '../../athletes/types.ts';
import type { AttributeId, Attributes } from '../../athletes/types.ts';
import { el, svg } from '../dom.ts';

/** Attributes are 1–99 like every other rating in the game (`05` §2). */
const ATTRIBUTE_MAX = 99;

/** Rings drawn behind the shape, so a reader can judge magnitude without a scale beside it. */
const GRID_RINGS = [0.25, 0.5, 0.75, 1] as const;

export interface RadarSeries {
  /** Named in the legend and in every point's accessible text. */
  readonly label: string;
  readonly attributes: Attributes;
  /**
   * Which of the two shapes this is. `compare` is drawn as a dashed outline with no fill, so the
   * two are distinguishable when printed, dimmed, or seen by someone who cannot separate the
   * colours (INV-11).
   */
  readonly role?: 'primary' | 'compare';
}

export interface AttributeRadarOptions {
  /** One series, or two to compare. A third would be unreadable, and is not offered. */
  readonly series: readonly [RadarSeries] | readonly [RadarSeries, RadarSeries];
  /** Viewport edge in px. The SVG scales; this only fixes its intrinsic size. */
  readonly size?: number;
  /**
   * Drops the value list, for the compact contexts that already show the numbers elsewhere. The
   * accessible description on the figure stays either way — this hides text, never meaning.
   */
  readonly hideValues?: boolean;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The eleven axes, evenly spaced, first one at twelve o'clock.
 *
 * Exported because the geometry is the part worth testing: a polygon in a jsdom test is a string
 * of coordinates, and asserting against that string tests the formatter, not the shape.
 */
export function radarPoints(values: readonly number[], radius: number, centre: number): Point[] {
  const count = values.length;
  return values.map((value, index) => {
    const fraction = Math.min(1, Math.max(0, value / ATTRIBUTE_MAX));
    // −π/2 puts the first axis at the top; the rest run clockwise from there.
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      x: centre + Math.cos(angle) * radius * fraction,
      y: centre + Math.sin(angle) * radius * fraction,
    };
  });
}

function pointsAttribute(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

/** "Speed 82, Acceleration 74, …" — the shape said in words, for the accessible description. */
export function radarDescription(series: RadarSeries): string {
  const parts = ATTRIBUTE_IDS.map(
    (id) => `${attributeLabel(id)} ${Math.round(series.attributes[id])}`,
  );
  return `${series.label}: ${parts.join(', ')}`;
}

function axisLabels(doc: Document, radius: number, centre: number): SVGElement[] {
  const count = ATTRIBUTE_IDS.length;
  return ATTRIBUTE_IDS.map((id, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const x = centre + Math.cos(angle) * (radius + 10);
    const y = centre + Math.sin(angle) * (radius + 10);
    // Anchor away from the centre so a label never overlaps its own spoke.
    const anchor =
      Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    const node = svg(doc, 'text', {
      class: 'attribute-radar__axis-label',
      x: x.toFixed(2),
      y: y.toFixed(2),
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
    });
    // Three letters is what fits at 200 px without the labels colliding at the diagonals.
    node.textContent = attributeLabel(id).slice(0, 3).toUpperCase();
    return node;
  });
}

function valueList(doc: Document, series: readonly RadarSeries[]): HTMLElement {
  const rows = ATTRIBUTE_IDS.map((id: AttributeId) =>
    el(doc, 'div', {
      class: 'attribute-radar__row',
      children: [
        el(doc, 'span', { class: 'attribute-radar__name', text: attributeLabel(id) }),
        ...series.map((entry, index) =>
          el(doc, 'span', {
            class: 'attribute-radar__value',
            dataset: { role: entry.role ?? (index === 0 ? 'primary' : 'compare') },
            text: String(Math.round(entry.attributes[id])),
          }),
        ),
      ],
    }),
  );

  return el(doc, 'div', { class: 'attribute-radar__values', children: rows });
}

export function attributeRadar(doc: Document, options: AttributeRadarOptions): HTMLElement {
  const size = options.size ?? 200;
  const centre = size / 2;
  // Room outside the polygon for the axis labels, which sit 10 px beyond the outer ring. 26 px was
  // not enough: a three-letter label anchored `end` on the left-hand axes ran off the viewBox and
  // rendered as "\WA". Checked in a browser at 390 px and at 1.3× UI scale.
  const radius = centre - 34;

  const grid = GRID_RINGS.map((ring) =>
    svg(doc, 'polygon', {
      class: 'attribute-radar__ring',
      points: pointsAttribute(
        radarPoints(
          ATTRIBUTE_IDS.map(() => ATTRIBUTE_MAX * ring),
          radius,
          centre,
        ),
      ),
    }),
  );

  const spokes = radarPoints(
    ATTRIBUTE_IDS.map(() => ATTRIBUTE_MAX),
    radius,
    centre,
  ).map((point) =>
    svg(doc, 'line', {
      class: 'attribute-radar__spoke',
      x1: String(centre),
      y1: String(centre),
      x2: point.x.toFixed(2),
      y2: point.y.toFixed(2),
    }),
  );

  const shapes = options.series.map((entry, index) => {
    const role = entry.role ?? (index === 0 ? 'primary' : 'compare');
    const points = radarPoints(
      ATTRIBUTE_IDS.map((id) => entry.attributes[id]),
      radius,
      centre,
    );
    return svg(doc, 'polygon', {
      class: 'attribute-radar__shape',
      'data-role': role,
      points: pointsAttribute(points),
    });
  });

  const figure = svg(
    doc,
    'svg',
    {
      class: 'attribute-radar__plot',
      viewBox: `0 0 ${size} ${size}`,
      // The shape duplicates the value list beside it, so it is decoration to assistive tech.
      'aria-hidden': 'true',
      focusable: 'false',
    },
    [...grid, ...spokes, ...axisLabels(doc, radius, centre), ...shapes],
  );

  const description = options.series.map(radarDescription).join('. ');

  const legend =
    options.series.length > 1
      ? el(doc, 'div', {
          class: 'attribute-radar__legend',
          children: options.series.map((entry, index) =>
            el(doc, 'span', {
              class: 'attribute-radar__key',
              dataset: { role: entry.role ?? (index === 0 ? 'primary' : 'compare') },
              text: entry.label,
            }),
          ),
        })
      : null;

  return el(doc, 'figure', {
    class: 'attribute-radar',
    attrs: { role: 'group', 'aria-label': `Attribute radar. ${description}` },
    children: [figure, legend, options.hideValues === true ? null : valueList(doc, options.series)],
  });
}
