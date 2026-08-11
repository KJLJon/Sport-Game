/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (every component ships with a states matrix and appears in the gallery),
 *          12-quality-and-testing.md §1
 *
 * Purpose: `10` §5 makes two demands of `#/dev/ui` that nothing had been checking — that every
 * component in the inventory is *in* it, and that it renders deterministically, since it is also
 * the visual-regression target.
 *
 * The inventory check is the one that matters. It is how T-9.1's four missing components were
 * found, and it is what stops the next one being missed: adding a primitive without a gallery
 * entry now fails here rather than at a design review nobody schedules.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { galleryScreen } from '../../../src/ui/gallery/gallery.ts';

function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  galleryScreen().mount({
    host,
    query: new URLSearchParams(),
    params: {},
    navigate: () => {},
    setTitle: () => {},
  } as never);
  return host;
}

let host: HTMLElement;

beforeEach(() => {
  host = render();
});

/**
 * `10` §5's inventory, each entry paired with the selector that proves it is on the page. Where
 * the spec names something the app builds inside a screen rather than as a primitive — the match
 * HUD and the minimap are canvas drawing, the court diagram is the sport's own render — the row is
 * absent deliberately, and T-9.9's screen-level visual suite covers those instead.
 */
const INVENTORY: readonly (readonly [string, string])[] = [
  ['buttons', '.button--primary'],
  ['button · secondary', '.button--secondary'],
  ['button · ghost', '.button--ghost'],
  ['button · destructive', '.button--destructive'],
  ['button · icon', '.button--icon'],
  ['segmented control', '.segmented'],
  ['switch', '.switch'],
  ['tab bar', '.tab-bar'],
  ['sheet · half', ".sheet[data-height='half']"],
  ['sheet · full', ".sheet[data-height='full']"],
  ['dialog', '.dialog'],
  ['toast', '.toast'],
  ['banner', '.banner'],
  ['athlete list row', '.athlete-row'],
  ['rating bar', '.rating-bar'],
  ['familiarity ring', '.familiarity-ring'],
  ['attribute radar', '.attribute-radar'],
  ['stat table', '.stat-table'],
  ['coin pill', '.coin-pill'],
  ['progress bar', '.progress-bar'],
  ['star rating', '.star-rating'],
  ['empty state', '.empty-state'],
  ['skeleton loader', '.skeleton'],
  ['error state', '.error-state'],
  ['onboarding coach-mark', '.coach-mark'],
  ['play-call card', '.play-call'],
];

describe('the component gallery (`10` §5)', () => {
  it('shows every component in the inventory', () => {
    const missing = INVENTORY.filter(([, selector]) => host.querySelector(selector) === null).map(
      ([name]) => name,
    );

    expect(missing).toEqual([]);
  });

  it('shows the states matrix `10` §5 requires, including the two a screenshot cannot hold', () => {
    // Pressed and focus are transient; the gallery pins them through `data-force`.
    expect(host.querySelector(".button[data-force='pressed']")).not.toBeNull();
    expect(host.querySelector(".button[data-force='focus']")).not.toBeNull();
    expect(host.querySelector('.button:disabled, .button[aria-disabled="true"]')).not.toBeNull();
    // Loading is a real state of the component, not a forced one.
    expect(host.querySelector('.button[aria-busy="true"]')).not.toBeNull();
  });

  it('renders identically twice, because it is the visual-regression target', () => {
    // `10` §5 asks for no random data and no clocks. Element ids are the one thing that legitimately
    // differs between two renders in the same document — two dialogs on one page cannot share one —
    // and no id is drawn, so they are normalised out rather than pinned down.
    const normalise = (html: string): string =>
      html.replace(/-title-\d+/g, '-title-N').replace(/call-sheet-\d+/g, 'call-sheet-N');

    const first = normalise(render().innerHTML);
    const second = normalise(render().innerHTML);

    expect(second).toBe(first);
  });

  it('leaves no live region or auto-playing surprise in a snapshot target', () => {
    // A gallery that announces itself would fight the a11y sweep on every other screen.
    expect(host.querySelector('[aria-live="assertive"]')).toBeNull();
  });
});
