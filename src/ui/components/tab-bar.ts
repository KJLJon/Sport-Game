/**
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory — tab bar), §4 (layout), §11 (accessibility)
 * @invariant INV-11 (`10` §11 — nothing carried by colour alone), INV-12 (44 px targets)
 *
 * Purpose: the tab bar `10` §5 names. It was built inside the app shell in Phase 0 and never came
 * out, so it had no states matrix and never appeared in the gallery — which is why T-9.1 exists.
 *
 * The shell still owns *where* the bar sits; this owns what it is. The current tab is marked by a
 * bar and by `aria-current`, not by its colour alone.
 */
import { el, svg } from '../dom.ts';

export interface TabDef {
  /** Route path, without the leading `#`. */
  readonly path: string;
  readonly label: string;
  /** A single SVG path `d`. Icons are inline geometry — nothing is fetched (`07` D-04). */
  readonly icon: string;
}

export interface TabBarOptions {
  readonly tabs: readonly TabDef[];
  /** The path currently shown, so the bar can mark it. */
  readonly currentPath?: string;
  /**
   * Names the landmark. Two navigations on one page must be told apart by name, and "Main" is what
   * the shell has always called this one.
   */
  readonly label?: string;
  /** Extra classes for the owner's placement rules — the shell pins it to the bottom. */
  readonly className?: string;
}

/**
 * Which tab a path belongs to: the longest tab path that prefixes it, so `/squad/athlete/7` marks
 * Squad rather than nothing. Exported because this is the part with a decision in it.
 */
export function activeTab(tabs: readonly TabDef[], path: string | undefined): TabDef | undefined {
  if (path === undefined) return undefined;
  let best: TabDef | undefined;
  for (const tab of tabs) {
    if (path !== tab.path && !path.startsWith(`${tab.path}/`)) continue;
    if (best === undefined || tab.path.length > best.path.length) best = tab;
  }
  return best;
}

export function tabBar(doc: Document, options: TabBarOptions): HTMLElement {
  const current = activeTab(options.tabs, options.currentPath);

  return el(doc, 'nav', {
    class: options.className === undefined ? 'tab-bar' : `tab-bar ${options.className}`,
    attrs: { 'aria-label': options.label ?? 'Main' },
    children: options.tabs.map((tab) =>
      el(doc, 'a', {
        class: 'tab-bar__tab',
        attrs: {
          href: `#${tab.path}`,
          'data-path': tab.path,
          // `false` rather than absent: the shell rewrites this attribute on every route change,
          // and an attribute it can find is one it does not have to create.
          'aria-current': tab === current ? 'page' : 'false',
        },
        children: [
          svg(doc, 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [
            svg(doc, 'path', { d: tab.icon }),
          ]),
          el(doc, 'span', { class: 'tab-bar__label', text: tab.label }),
        ],
      }),
    ),
  });
}
