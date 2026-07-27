/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §2 (SPA routing on Pages)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHash,
  matchPattern,
  parseHash,
  resolveRoute,
  Router,
  type RouteDefinition,
  type RouterTarget,
} from '../../../src/app/router.ts';

describe('parseHash', () => {
  it.each([
    ['', '/', []],
    ['#', '/', []],
    ['#/', '/', []],
    ['#/play', '/play', ['play']],
    ['#play', '/play', ['play']],
    ['#/play/live', '/play/live', ['play', 'live']],
    ['#//play//live//', '/play/live', ['play', 'live']],
  ])('parses %j', (hash, path, segments) => {
    const location = parseHash(hash);
    expect(location.path).toBe(path);
    expect(location.segments).toEqual(segments);
  });

  it('reads query parameters from the fragment', () => {
    expect(parseHash('#/play/live?sport=basketball&difficulty=pro').query).toEqual({
      sport: 'basketball',
      difficulty: 'pro',
    });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseHash('#/squad/athlete/Ada%20Lovelace').segments[2]).toBe('Ada Lovelace');
  });

  it('treats a malformed escape as data rather than throwing', () => {
    expect(() => parseHash('#/squad/%E0%A4%A')).not.toThrow();
    expect(parseHash('#/squad/%E0%A4%A').segments[1]).toBe('%E0%A4%A');
  });
});

describe('buildHash', () => {
  it('round-trips through parseHash', () => {
    const hash = buildHash('/squad/athlete/Ada Lovelace', { sport: 'soccer' });
    const location = parseHash(hash);
    expect(location.segments).toEqual(['squad', 'athlete', 'Ada Lovelace']);
    expect(location.query).toEqual({ sport: 'soccer' });
  });

  it('produces a bare home hash with no query', () => {
    expect(buildHash('/')).toBe('#/');
  });
});

describe('matchPattern', () => {
  it('captures named parameters', () => {
    expect(matchPattern('/squad/athlete/:id', parseHash('#/squad/athlete/42'))).toEqual({
      id: '42',
    });
  });

  it('rejects a different length', () => {
    expect(matchPattern('/squad/athlete/:id', parseHash('#/squad/athlete'))).toBeNull();
  });

  it('rejects a differing literal segment', () => {
    expect(matchPattern('/squad/athlete/:id', parseHash('#/squad/team/42'))).toBeNull();
  });

  it('matches the root pattern', () => {
    expect(matchPattern('/', parseHash('#/'))).toEqual({});
  });
});

describe('resolveRoute', () => {
  const routes: readonly RouteDefinition<string>[] = [
    { pattern: '/squad/:id', value: 'param' },
    { pattern: '/squad/new', value: 'literal' },
  ];

  it('prefers a literal segment over a parameter regardless of declaration order', () => {
    expect(resolveRoute(routes, parseHash('#/squad/new'))?.route).toBe('literal');
    expect(resolveRoute(routes, parseHash('#/squad/7'))?.route).toBe('param');
  });

  it('returns null when nothing matches', () => {
    expect(resolveRoute(routes, parseHash('#/store'))).toBeNull();
  });
});

/** A `window`-shaped double: setting `hash` fires `hashchange`, exactly as a browser does. */
function fakeTarget(initial = '#/'): RouterTarget & { setHash(next: string): void } {
  const listeners = new Set<() => void>();
  const location = {
    _hash: initial,
    get hash() {
      return this._hash;
    },
    set hash(next: string) {
      if (next === this._hash) return;
      this._hash = next;
      for (const listener of listeners) listener();
    },
  };

  return {
    location,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    setHash: (next) => {
      location.hash = next;
    },
  };
}

describe('Router', () => {
  const routes: readonly RouteDefinition<string>[] = [
    { pattern: '/', value: 'home' },
    { pattern: '/play', value: 'play' },
    { pattern: '/squad/athlete/:id', value: 'athlete' },
  ];

  let target: ReturnType<typeof fakeTarget>;

  beforeEach(() => {
    target = fakeTarget('#/');
  });

  it('emits the initial route on start', () => {
    const router = new Router({ routes, target });
    const listener = vi.fn();
    router.subscribe(listener);
    router.start();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(router.current?.route).toBe('home');
  });

  it('emits on hashchange', () => {
    const router = new Router({ routes, target });
    router.start();
    const listener = vi.fn();
    router.subscribe(listener);
    listener.mockClear();

    target.setHash('#/play');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(router.current?.route).toBe('play');
  });

  it('navigates by setting the hash', () => {
    const router = new Router({ routes, target });
    router.start();

    router.navigate('/squad/athlete/9');

    expect(target.location.hash).toBe('#/squad/athlete/9');
    expect(router.current?.route).toBe('athlete');
    expect(router.current?.params).toEqual({ id: '9' });
  });

  it('still emits when navigating to the hash already showing', () => {
    const router = new Router({ routes, target });
    router.start();
    const listener = vi.fn();
    router.subscribe(listener);
    listener.mockClear();

    router.navigate('/');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports no match for an unknown deep link by default', () => {
    const router = new Router({ routes, target });
    router.start();

    target.setHash('#/does/not/exist');

    expect(router.current).toBeNull();
  });

  it('falls back to home when a fallback is configured', () => {
    const router = new Router({ routes, target, fallbackPath: '/' });
    router.start();

    target.setHash('#/does/not/exist');

    expect(router.current?.route).toBe('home');
  });

  it('reports null when even the fallback is unroutable', () => {
    const router = new Router({ routes: [], target, fallbackPath: '/' });
    router.start();
    expect(router.current).toBeNull();
  });

  it('stops listening after stop()', () => {
    const router = new Router({ routes, target });
    router.start();
    const listener = vi.fn();
    router.subscribe(listener);
    listener.mockClear();

    router.stop();
    target.setHash('#/play');

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes cleanly', () => {
    const router = new Router({ routes, target });
    router.start();
    const listener = vi.fn();
    const off = router.subscribe(listener);
    off();
    listener.mockClear();

    target.setHash('#/play');

    expect(listener).not.toHaveBeenCalled();
  });
});
