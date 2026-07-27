/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory), 04-architecture.md §12 (privacy and security)
 *
 * Purpose: the small DOM helper every component is built from. There is no UI framework here
 * (`07` D-02), and imported roster data is untrusted (`04` §12), so nothing in this file has an
 * `innerHTML` path — text is always set as text.
 */

export type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly on?: Readonly<Record<string, (event: Event) => void>>;
  readonly children?: readonly Child[];
}

/** Creates an element. Attributes whose value is `null`, `undefined`, or `false` are skipped. */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);

  if (options.class !== undefined) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }

  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    node.dataset[name] = value;
  }

  for (const [type, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(type, handler);
  }

  append(node, options.children ?? []);
  return node;
}

/** Creates an SVG element in the right namespace, which `createElement` cannot do. */
export function svg(
  doc: Document,
  tag: string,
  attrs: Readonly<Record<string, string>> = {},
  children: readonly Element[] = [],
): SVGElement {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) node.appendChild(child);
  return node as SVGElement;
}

/** Appends children, skipping the falsy ones so `cond && node` reads naturally at call sites. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' ? parent.ownerDocument!.createTextNode(child) : child,
    );
  }
}

/** Clamps to `[0, 1]`, treating `NaN` as 0 — meters must never render a nonsense width. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Formats a fraction as a whole-number percentage string for CSS and for `aria-valuetext`. */
export function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}
