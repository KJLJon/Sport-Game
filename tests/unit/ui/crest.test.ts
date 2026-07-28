/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @story   US-6.1 — Build a team
 * @design  10-ui-ux.md §11 (accessibility)
 *
 * Purpose: every crest id renders, and — the point of the whole component — no two of them are
 * the same shape. `CREST_GEOMETRY` is checked with no DOM at all; `crest()` is checked against
 * jsdom to confirm the geometry actually reaches the markup.
 */
import { describe, expect, it } from 'vitest';
import { CREST_IDS, TEAM_PALETTES } from '../../../src/teams/types.ts';
import { CREST_GEOMETRY, crest, crestLabel } from '../../../src/ui/components/crest.ts';

const COLOURS = TEAM_PALETTES[0]!.colours;

describe('CREST_GEOMETRY', () => {
  it('defines geometry for every crest id', () => {
    for (const id of CREST_IDS) {
      expect(CREST_GEOMETRY[id]).toBeDefined();
    }
  });

  it('gives every crest a genuinely different shape, so hue is never the only difference', () => {
    const serialised = CREST_IDS.map((id) => JSON.stringify(CREST_GEOMETRY[id]));
    expect(new Set(serialised).size).toBe(CREST_IDS.length);
  });

  it('draws the four plain silhouettes with no internal marks', () => {
    for (const id of ['shield', 'circle', 'diamond', 'star'] as const) {
      expect(CREST_GEOMETRY[id].marks).toEqual([]);
    }
  });

  it('draws the four field divisions as marks inside a shared shield outline', () => {
    for (const id of ['chevron', 'stripes', 'halves', 'quarters'] as const) {
      expect(CREST_GEOMETRY[id].outline).toEqual({ kind: 'path', d: expect.any(String) });
      expect(CREST_GEOMETRY[id].marks.length).toBeGreaterThan(0);
    }
  });
});

describe('crestLabel', () => {
  it('capitalises the crest id for display', () => {
    expect(crestLabel('shield')).toBe('Shield');
    expect(crestLabel('quarters')).toBe('Quarters');
  });
});

describe('crest()', () => {
  const doc = document;

  it('renders every crest id as a labelled, self-contained SVG', () => {
    for (const id of CREST_IDS) {
      const node = crest(doc, { crestId: id, colours: COLOURS, label: `Test crest, ${id}` });
      expect(node.tagName.toLowerCase()).toBe('svg');
      expect(node.getAttribute('role')).toBe('img');
      expect(node.getAttribute('aria-label')).toBe(`Test crest, ${id}`);
      expect(node.getAttribute('viewBox')).toBe('0 0 100 100');
    }
  });

  it('uses the given size for both dimensions', () => {
    const node = crest(doc, { crestId: 'circle', colours: COLOURS, size: 72, label: 'x' });
    expect(node.getAttribute('width')).toBe('72');
    expect(node.getAttribute('height')).toBe('72');
  });

  it('defaults to a list-row size when none is given', () => {
    const node = crest(doc, { crestId: 'circle', colours: COLOURS, label: 'x' });
    expect(node.getAttribute('width')).toBe(node.getAttribute('height'));
    expect(Number(node.getAttribute('width'))).toBeGreaterThan(0);
  });

  it('paints the team colours into the markup', () => {
    const node = crest(doc, {
      crestId: 'shield',
      colours: { primary: '#123456', secondary: '#abcdef' },
      label: 'x',
    });
    expect(node.outerHTML).toContain('#123456');
    expect(node.outerHTML).toContain('#abcdef');
  });

  it('renders a distinct clipPath per instance, so two crests on one screen never collide', () => {
    const first = crest(doc, { crestId: 'stripes', colours: COLOURS, label: 'a' });
    const second = crest(doc, { crestId: 'stripes', colours: COLOURS, label: 'b' });
    const firstClip = first.querySelector('clipPath')?.id;
    const secondClip = second.querySelector('clipPath')?.id;
    expect(firstClip).toBeDefined();
    expect(firstClip).not.toBe(secondClip);
  });

  it('produces different markup for every crest id even with identical colours', () => {
    const markup = CREST_IDS.map(
      (id) => crest(doc, { crestId: id, colours: COLOURS, label: id }).outerHTML,
    );
    expect(new Set(markup).size).toBe(CREST_IDS.length);
  });
});
