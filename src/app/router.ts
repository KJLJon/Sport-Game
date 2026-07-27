/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §2 (SPA routing on Pages), 10-ui-ux.md §7 (screen map)
 * @invariant INV-4 (no literal repository path)
 *
 * Purpose: hash-based routing. GitHub Pages has no rewrite rules, so deep links have to live in
 * the fragment — `#/squad/athlete/42` — which also keeps every route inside the service worker's
 * path scope no matter what the base path turns out to be.
 */

/** A parsed location: the path segments and the query, both already decoded. */
export interface RouteLocation {
  /** Normalised path, always leading-slash, never trailing-slash: `/squad/athlete`. */
  readonly path: string;
  /** Path split on `/`, empty segments removed. */
  readonly segments: readonly string[];
  /** Query parameters from the portion after `?` in the hash. */
  readonly query: Readonly<Record<string, string>>;
  /** The raw hash this was parsed from, useful for logging a miss. */
  readonly raw: string;
}

/** Values captured from `:name` segments in a route pattern. */
export type RouteParams = Readonly<Record<string, string>>;

export interface RouteMatch<T> {
  readonly route: T;
  readonly params: RouteParams;
  readonly location: RouteLocation;
}

export interface RouteDefinition<T> {
  /** Pattern with optional `:param` segments, e.g. `/squad/athlete/:id`. */
  readonly pattern: string;
  readonly value: T;
}

const HOME: RouteLocation = { path: '/', segments: [], query: {}, raw: '#/' };

/**
 * Parses a `location.hash` into a {@link RouteLocation}. Tolerates every shape a browser or a
 * hand-typed URL can produce: ``, `#`, `#/`, `#foo`, `#/foo/bar?x=1`.
 */
export function parseHash(hash: string): RouteLocation {
  const raw = hash === '' ? '#/' : hash;
  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
  const queryStart = withoutHash.indexOf('?');
  const pathPart = queryStart === -1 ? withoutHash : withoutHash.slice(0, queryStart);
  const queryPart = queryStart === -1 ? '' : withoutHash.slice(queryStart + 1);

  const segments = pathPart
    .split('/')
    .map((segment) => safeDecode(segment))
    .filter((segment) => segment !== '');

  const query: Record<string, string> = {};
  if (queryPart !== '') {
    for (const [key, value] of new URLSearchParams(queryPart)) {
      query[key] = value;
    }
  }

  return { path: `/${segments.join('/')}`, segments, query, raw };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape sequence is data, not a crash.
    return segment;
  }
}

/** Builds a hash string from a path and optional query. The inverse of {@link parseHash}. */
export function buildHash(path: string, query: Record<string, string> = {}): string {
  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment));
  const search = new URLSearchParams(query).toString();
  return `#/${segments.join('/')}${search === '' ? '' : `?${search}`}`;
}

/** Matches a location against a `:param` pattern, or returns `null`. */
export function matchPattern(pattern: string, location: RouteLocation): RouteParams | null {
  const patternSegments = pattern.split('/').filter((segment) => segment !== '');

  if (patternSegments.length !== location.segments.length) return null;

  const params: Record<string, string> = {};
  for (const [index, expected] of patternSegments.entries()) {
    const actual = location.segments[index];
    if (actual === undefined) return null;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }

  return params;
}

/**
 * Resolves a location against an ordered route table. Literal segments beat parameters, so
 * `/squad/new` wins over `/squad/:id` regardless of declaration order.
 */
export function resolveRoute<T>(
  routes: readonly RouteDefinition<T>[],
  location: RouteLocation,
): RouteMatch<T> | null {
  let best: { match: RouteMatch<T>; specificity: number } | null = null;

  for (const route of routes) {
    const params = matchPattern(route.pattern, location);
    if (params === null) continue;

    const specificity = route.pattern
      .split('/')
      .filter((segment) => segment !== '' && !segment.startsWith(':')).length;

    if (best === null || specificity > best.specificity) {
      best = { match: { route: route.value, params, location }, specificity };
    }
  }

  return best?.match ?? null;
}

export type RouteListener<T> = (match: RouteMatch<T> | null, location: RouteLocation) => void;

export interface RouterOptions<T> {
  readonly routes: readonly RouteDefinition<T>[];
  /** Where an unmatched hash sends the player. Defaults to `/`. */
  readonly fallbackPath?: string;
  /** Injected for tests; defaults to `window`. */
  readonly target?: RouterTarget;
}

/** The slice of `window` the router needs — narrowed so tests can supply a fake. */
export interface RouterTarget {
  readonly location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/**
 * Owns the current route and notifies listeners on change. Deliberately does not touch the DOM —
 * the shell decides what a route means.
 */
export class Router<T> {
  readonly #routes: readonly RouteDefinition<T>[];
  readonly #fallbackPath: string;
  readonly #target: RouterTarget;
  readonly #listeners = new Set<RouteListener<T>>();
  readonly #onHashChange = () => this.#emit();
  #current: RouteMatch<T> | null = null;
  #started = false;

  constructor(options: RouterOptions<T>) {
    this.#routes = options.routes;
    this.#fallbackPath = options.fallbackPath ?? '/';
    this.#target = options.target ?? (globalThis.window as unknown as RouterTarget);
  }

  get current(): RouteMatch<T> | null {
    return this.#current;
  }

  get location(): RouteLocation {
    return parseHash(this.#target.location.hash);
  }

  /** Begins listening and emits the initial route immediately. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#target.addEventListener('hashchange', this.#onHashChange);
    this.#emit();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#target.removeEventListener('hashchange', this.#onHashChange);
  }

  subscribe(listener: RouteListener<T>): () => void {
    this.#listeners.add(listener);
    if (this.#started) listener(this.#current, this.location);
    return () => this.#listeners.delete(listener);
  }

  /** Navigates by setting the hash; the `hashchange` event does the rest. */
  navigate(path: string, query: Record<string, string> = {}): void {
    const next = buildHash(path, query);
    if (this.#target.location.hash === next) {
      // Setting an identical hash fires no event, so emit directly to stay consistent.
      this.#emit();
      return;
    }
    this.#target.location.hash = next;
  }

  #emit(): void {
    const location = this.location;
    let match = resolveRoute(this.#routes, location);

    if (match === null && location.path !== this.#fallbackPath) {
      match = resolveRoute(this.#routes, parseHash(buildHash(this.#fallbackPath)));
    }

    this.#current = match;
    for (const listener of this.#listeners) listener(match, location);
  }
}

export const HOME_LOCATION = HOME;
