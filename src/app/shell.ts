/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL, US-13.1 — Works on my phone
 * @design  10-ui-ux.md §4 (layout), §7 (screen map), 04-architecture.md §9
 *
 * Purpose: the persistent chrome — header, screen host, bottom tabs, banner slot — and the
 * mount/unmount lifecycle that keeps exactly one screen alive at a time.
 */
import type { RouteMatch, Router } from './router.ts';
import type { ChromeMode, Screen, ScreenDefinition } from './screen.ts';
import { readOrientation, shouldPromptRotate, type Orientation } from './orientation.ts';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  /** Inline SVG path data. No icon fonts, no external requests (`04` §12). */
  readonly icon: string;
}

export interface ShellOptions {
  readonly root: HTMLElement;
  readonly router: Router<ScreenDefinition>;
  readonly tabs: readonly TabDefinition[];
  readonly window: Window;
}

interface ShellElements {
  readonly frame: HTMLDivElement;
  readonly header: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly main: HTMLElement;
  readonly banners: HTMLDivElement;
  readonly tabBar: HTMLElement;
  readonly rotate: HTMLDivElement;
  readonly live: HTMLDivElement;
}

export class AppShell {
  readonly #options: ShellOptions;
  readonly #elements: ShellElements;
  #activeScreen: Screen | null = null;
  #mountToken = 0;
  #unsubscribe: (() => void) | null = null;
  #onOrientationChange: (() => void) | null = null;

  constructor(options: ShellOptions) {
    this.#options = options;
    this.#elements = buildChrome(options);
  }

  /** Mounts the chrome, wires the router, and renders the first screen. */
  start(): void {
    const { root, router, window } = this.#options;
    root.replaceChildren(this.#elements.frame);

    this.#unsubscribe = router.subscribe((match) => {
      void this.#showRoute(match);
    });
    router.start();

    this.#onOrientationChange = () => this.#applyOrientation(router.current);
    window.addEventListener('resize', this.#onOrientationChange);
    window.addEventListener('orientationchange', this.#onOrientationChange);
  }

  stop(): void {
    const { window } = this.#options;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#onOrientationChange) {
      window.removeEventListener('resize', this.#onOrientationChange);
      window.removeEventListener('orientationchange', this.#onOrientationChange);
      this.#onOrientationChange = null;
    }
    this.#options.router.stop();
    this.#teardownScreen();
  }

  /** The region update banners and offline notices render into (`11` §4). */
  get bannerHost(): HTMLElement {
    return this.#elements.banners;
  }

  /** Politely announces to screen readers; used for score and match events (`10` §11). */
  announce(message: string): void {
    this.#elements.live.textContent = message;
  }

  async #showRoute(match: RouteMatch<ScreenDefinition> | null): Promise<void> {
    const token = ++this.#mountToken;
    this.#teardownScreen();

    if (match === null) {
      this.#elements.title.textContent = 'Not found';
      this.#elements.main.replaceChildren(notFound(this.#options));
      return;
    }

    const definition = match.route;
    this.#elements.title.textContent = definition.title;
    this.#applyChrome(definition.chrome ?? 'full');
    this.#applyOrientation(match);
    this.#syncTabs(match.location.path);

    let screen: Screen;
    try {
      screen = await definition.load();
    } catch {
      // A code-split chunk the browser has evicted, with no network to re-fetch it (`11` §5.2).
      // A blank screen would be the worst possible answer here.
      if (token !== this.#mountToken) return;
      this.#elements.main.replaceChildren(chunkUnavailable(this.#options));
      return;
    }

    // A second navigation may have landed while the chunk was loading.
    if (token !== this.#mountToken) return;

    this.#activeScreen = screen;
    await screen.mount({
      host: this.#elements.main,
      params: match.params,
      query: match.location.query,
      navigate: (path, query) => this.#options.router.navigate(path, query),
    });
  }

  #teardownScreen(): void {
    this.#activeScreen?.unmount?.();
    this.#activeScreen = null;
    this.#elements.main.replaceChildren();
  }

  #applyChrome(mode: ChromeMode): void {
    this.#elements.frame.dataset['chrome'] = mode;
  }

  #applyOrientation(match: RouteMatch<ScreenDefinition> | null): void {
    const { window } = this.#options;
    const wanted = match?.route.orientation ?? 'any';
    const actual: Orientation = readOrientation(window.screen, {
      width: window.innerWidth,
      height: window.innerHeight,
    });

    const prompt = shouldPromptRotate(wanted, actual, null);
    this.#elements.rotate.hidden = !prompt;
    if (prompt) {
      this.#elements.rotate.textContent =
        wanted === 'landscape' ? 'Turn your phone sideways to play.' : 'Turn your phone upright.';
    }
  }

  #syncTabs(path: string): void {
    for (const anchor of this.#elements.tabBar.querySelectorAll('a[data-path]')) {
      const tabPath = anchor.getAttribute('data-path') ?? '';
      const active = path === tabPath || path.startsWith(`${tabPath}/`);
      anchor.setAttribute('aria-current', active ? 'page' : 'false');
    }
  }
}

function buildChrome(options: ShellOptions): ShellElements {
  const doc = options.root.ownerDocument;

  const frame = doc.createElement('div');
  frame.className = 'shell';
  frame.dataset['chrome'] = 'full';

  const header = doc.createElement('header');
  header.className = 'shell__header';

  const title = doc.createElement('h1');
  title.className = 'shell__title';
  title.textContent = 'Sport-Game';
  header.appendChild(title);

  const banners = doc.createElement('div');
  banners.className = 'shell__banners';

  const main = doc.createElement('main');
  main.className = 'shell__main';
  main.id = 'main';
  main.tabIndex = -1;

  const skip = doc.createElement('a');
  skip.className = 'shell__skip';
  skip.href = '#main';
  skip.textContent = 'Skip to content';

  const rotate = doc.createElement('div');
  rotate.className = 'shell__rotate';
  rotate.hidden = true;
  rotate.setAttribute('role', 'status');

  const live = doc.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');

  const tabBar = buildTabBar(doc, options.tabs);

  frame.append(skip, header, banners, main, rotate, live, tabBar);
  return { frame, header, title, main, banners, tabBar, rotate, live };
}

function buildTabBar(doc: Document, tabs: readonly TabDefinition[]): HTMLElement {
  const nav = doc.createElement('nav');
  nav.className = 'shell__tabs';
  nav.setAttribute('aria-label', 'Main');

  for (const tab of tabs) {
    const anchor = doc.createElement('a');
    anchor.className = 'shell__tab';
    anchor.href = `#${tab.path}`;
    anchor.setAttribute('data-path', tab.path);
    anchor.setAttribute('aria-current', 'false');

    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', tab.icon);
    svg.appendChild(path);

    const label = doc.createElement('span');
    label.className = 'shell__tab-label';
    label.textContent = tab.label;

    anchor.append(svg, label);
    nav.appendChild(anchor);
  }

  return nav;
}

/** `10` §10 — the offline state, which is where a family-friendly app either holds up or not. */
function chunkUnavailable(options: ShellOptions): HTMLElement {
  const doc = options.root.ownerDocument;
  const wrap = doc.createElement('section');
  wrap.className = 'empty-state';
  wrap.setAttribute('role', 'alert');

  const heading = doc.createElement('h2');
  heading.textContent = "This part isn't downloaded yet";

  const body = doc.createElement('p');
  body.textContent = 'Reconnect once and it will be restored. Your roster and progress are safe.';

  const action = doc.createElement('a');
  action.className = 'button button--primary';
  action.href = '#/';
  action.textContent = 'Go home';

  wrap.append(heading, body, action);
  return wrap;
}

function notFound(options: ShellOptions): HTMLElement {
  const doc = options.root.ownerDocument;
  const wrap = doc.createElement('section');
  wrap.className = 'empty-state';

  const heading = doc.createElement('h2');
  heading.textContent = "That screen doesn't exist";

  const body = doc.createElement('p');
  body.textContent = 'The link may be from an older version of the game.';

  const action = doc.createElement('a');
  action.className = 'button button--primary';
  action.href = '#/';
  action.textContent = 'Go home';

  wrap.append(heading, body, action);
  return wrap;
}
