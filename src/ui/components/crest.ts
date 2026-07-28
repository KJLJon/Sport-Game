/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @story   US-6.1 — Build a team
 * @design  10-ui-ux.md §11 (accessibility), 05-data-model.md §1 (storage overview)
 *
 * Purpose: draws one of the eight generic crests (`teams/types.ts`'s `CREST_IDS`) in a team's two
 * colours. `10` §11 and CLAUDE.md §8.11 forbid conveying anything by colour alone, so the shapes
 * carry the real difference: `shield`, `circle`, `diamond`, and `star` are distinct silhouettes,
 * and `chevron`, `stripes`, `halves`, and `quarters` are distinct two-colour divisions of the same
 * shield field. Two teams that happen to share a hue are still told apart in greyscale.
 *
 * `CREST_GEOMETRY` is the pure half — plain data, no DOM, so a test can assert every id draws a
 * genuinely different shape without touching jsdom. `crest()` is the thin DOM half that turns that
 * data into an inline SVG (there is no crest artwork shipped or fetched — `07` D-04, no network).
 */
import { svg } from '../dom.ts';
import { CREST_IDS, type CrestId, type TeamColours } from '../../teams/types.ts';

/** The outline every crest is drawn (and, for the patterned crests, clipped) inside. */
export type CrestOutline =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: 'polygon'; readonly points: string };

/** A secondary-coloured shape drawn inside the outline, for the crests built from two fields. */
export type CrestMark =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'polygon'; readonly points: string };

export interface CrestGeometry {
  readonly outline: CrestOutline;
  /** Empty for the plain silhouettes — the outline alone is the whole crest. */
  readonly marks: readonly CrestMark[];
}

// A shield field shared by the crests that are a *division* of colour rather than a distinct
// silhouette (`chevron`, `stripes`, `halves`, `quarters`) — heraldry's usual canvas.
const SHIELD_PATH = 'M50 4 L92 18 V50 C92 78 66 94 50 96 C34 94 8 78 8 50 V18 Z';

// A regular 5-point star, one point up, centred on the 100×100 viewBox. Computed once, by hand,
// rather than at runtime — it never changes, and runtime trig would just be the same ten numbers
// recomputed on every render.
const STAR_POINTS =
  '50,4 61.17,34.63 93.75,35.79 68.07,55.87 77.05,87.21 50,69 22.95,87.21 31.93,55.87 6.25,35.79 38.83,34.63';

/** Every crest, keyed by id, as plain geometry — testable with no DOM. */
export const CREST_GEOMETRY: Readonly<Record<CrestId, CrestGeometry>> = {
  shield: { outline: { kind: 'path', d: SHIELD_PATH }, marks: [] },
  circle: { outline: { kind: 'circle', cx: 50, cy: 50, r: 44 }, marks: [] },
  diamond: { outline: { kind: 'polygon', points: '50,4 96,50 50,96 4,50' }, marks: [] },
  star: { outline: { kind: 'polygon', points: STAR_POINTS }, marks: [] },
  chevron: {
    outline: { kind: 'path', d: SHIELD_PATH },
    marks: [{ kind: 'polygon', points: '10,30 50,58 90,30 90,46 50,74 10,46' }],
  },
  stripes: {
    outline: { kind: 'path', d: SHIELD_PATH },
    marks: [
      { kind: 'rect', x: 25, y: 0, width: 25, height: 100 },
      { kind: 'rect', x: 75, y: 0, width: 25, height: 100 },
    ],
  },
  halves: {
    outline: { kind: 'path', d: SHIELD_PATH },
    marks: [{ kind: 'rect', x: 50, y: 0, width: 50, height: 100 }],
  },
  quarters: {
    outline: { kind: 'path', d: SHIELD_PATH },
    marks: [
      { kind: 'rect', x: 0, y: 0, width: 50, height: 50 },
      { kind: 'rect', x: 50, y: 50, width: 50, height: 50 },
    ],
  },
};

/** `shield` → `"Shield"`, for accessible names and picker labels. */
export function crestLabel(crestId: CrestId): string {
  return crestId.charAt(0).toUpperCase() + crestId.slice(1);
}

function outlineElement(
  doc: Document,
  outline: CrestOutline,
  attrs: Record<string, string>,
): SVGElement {
  if (outline.kind === 'path') return svg(doc, 'path', { d: outline.d, ...attrs });
  if (outline.kind === 'circle') {
    return svg(doc, 'circle', {
      cx: String(outline.cx),
      cy: String(outline.cy),
      r: String(outline.r),
      ...attrs,
    });
  }
  return svg(doc, 'polygon', { points: outline.points, ...attrs });
}

function markElement(doc: Document, mark: CrestMark, attrs: Record<string, string>): SVGElement {
  if (mark.kind === 'rect') {
    return svg(doc, 'rect', {
      x: String(mark.x),
      y: String(mark.y),
      width: String(mark.width),
      height: String(mark.height),
      ...attrs,
    });
  }
  return svg(doc, 'polygon', { points: mark.points, ...attrs });
}

// Unique per crest instance so two crests on the same screen never share a `<clipPath id>` — an
// id collision would make the second crest clip to the first one's outline instead of its own.
let clipSequence = 0;

export interface CrestOptions {
  readonly crestId: CrestId;
  readonly colours: TeamColours;
  /** Square side length in px. Defaults to a list-row size. */
  readonly size?: number;
  /** A real accessible name, e.g. `"River City crest, shield"` — never omitted, never generic. */
  readonly label: string;
}

const DEFAULT_SIZE = 48;

/** Renders one crest as an inline, self-contained SVG (`07` D-04 — no artwork fetched or shipped). */
export function crest(doc: Document, options: CrestOptions): SVGElement {
  const geometry = CREST_GEOMETRY[options.crestId];
  const size = String(options.size ?? DEFAULT_SIZE);

  const field = outlineElement(doc, geometry.outline, {
    fill: options.colours.primary,
    stroke: options.colours.secondary,
    'stroke-width': '4',
    'stroke-linejoin': 'round',
  });

  const children: SVGElement[] = [field];

  if (geometry.marks.length > 0) {
    clipSequence += 1;
    const clipId = `crest-clip-${clipSequence}`;
    const clipShape = outlineElement(doc, geometry.outline, {});
    children.push(
      svg(doc, 'clipPath', { id: clipId }, [clipShape]),
      svg(
        doc,
        'g',
        { 'clip-path': `url(#${clipId})` },
        geometry.marks.map((mark) => markElement(doc, mark, { fill: options.colours.secondary })),
      ),
    );
  }

  return svg(
    doc,
    'svg',
    {
      class: 'crest',
      viewBox: '0 0 100 100',
      width: size,
      height: size,
      role: 'img',
      'aria-label': options.label,
    },
    children,
  );
}

/** All eight ids, in the order the crest picker offers them. Re-exported for convenience. */
export const ALL_CREST_IDS = CREST_IDS;
