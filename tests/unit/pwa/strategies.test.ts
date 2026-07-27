/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.6 — Service worker: per-class cache strategies, atomic precache, versioned caches
 * @story   US-1.2 — Play offline, US-1.6 — Reliable updates
 * @design  11-pwa-lifecycle.md §2 (cache strategy, per resource class)
 *
 * Purpose: the routing table in `11` §2 is the difference between an app that updates and one
 * that stale-locks. Every row of that table gets an assertion here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_TIMEOUT_MS,
  cacheKindFor,
  fetchWithTimeout,
  isCacheable,
  routeFor,
  type RouteInput,
} from '../../../src/pwa/strategies.ts';

const ORIGIN = 'https://kjljon.github.io';
const BASE = '/Sport-Game/';

function route(path: string, overrides: Partial<RouteInput> = {}) {
  return routeFor({
    url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
    base: BASE,
    origin: ORIGIN,
    isNavigation: false,
    method: 'GET',
    ...overrides,
  });
}

describe('routeFor — the `11` §2 table', () => {
  it('never caches version.json: it is the source of truth about what is deployed', () => {
    expect(route('/Sport-Game/version.json')).toBe('network-only');
  });

  it('leaves sw.js to the browser — intercepting it is how updates get stuck', () => {
    expect(route('/Sport-Game/sw.js')).toBe('passthrough');
  });

  it('serves navigations network-first, which is what prevents stale-lock', () => {
    expect(route('/Sport-Game/', { isNavigation: true })).toBe('navigation');
    expect(route('/Sport-Game/index.html', { isNavigation: true })).toBe('navigation');
    // A deep hash link is still one navigation to the same document.
    expect(route('/Sport-Game/#/squad/athlete/4', { isNavigation: true })).toBe('navigation');
  });

  it('serves content-hashed assets cache-first, where staleness is impossible', () => {
    expect(route('/Sport-Game/assets/index-BpcRC-PF.js')).toBe('cache-first');
    expect(route('/Sport-Game/assets/index-BVXbWZ0i.css')).toBe('cache-first');
    expect(route('/Sport-Game/icons/icon-192.png')).toBe('cache-first');
  });

  it('serves the manifest network-first so install metadata cannot stale-lock', () => {
    expect(route('/Sport-Game/manifest.webmanifest')).toBe('network-first');
  });

  it('defaults unhashed resources under our base to network-first', () => {
    expect(route('/Sport-Game/robots.txt')).toBe('network-first');
  });
});

describe('routeFor — scoping', () => {
  it('never touches a sibling project on the same Pages account', () => {
    expect(route('/Other-Project/assets/app.js')).toBe('passthrough');
    expect(route('/Other-Project/', { isNavigation: true })).toBe('passthrough');
    expect(route('/')).toBe('passthrough');
  });

  it('never touches a cross-origin request', () => {
    expect(route('https://cdn.example.test/lib.js')).toBe('passthrough');
    // Even one that mimics our path.
    expect(route('https://evil.example.test/Sport-Game/assets/app.js')).toBe('passthrough');
  });

  it('passes non-GET straight through', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      expect(route('/Sport-Game/assets/app.js', { method })).toBe('passthrough');
    }
  });

  it('does not throw on a malformed URL', () => {
    expect(
      routeFor({
        url: 'not a url',
        base: BASE,
        origin: ORIGIN,
        isNavigation: false,
        method: 'GET',
      }),
    ).toBe('passthrough');
  });

  it('follows a repository rename, because the base path is a parameter', () => {
    expect(
      routeFor({
        url: `${ORIGIN}/Renamed/assets/app.js`,
        base: '/Renamed/',
        origin: ORIGIN,
        isNavigation: false,
        method: 'GET',
      }),
    ).toBe('cache-first');
  });
});

describe('cacheKindFor', () => {
  it('maps each caching strategy to its own cache', () => {
    expect(cacheKindFor('cache-first')).toBe('precache');
    expect(cacheKindFor('navigation')).toBe('shell');
    expect(cacheKindFor('network-first')).toBe('runtime');
  });

  it('gives the non-caching strategies no cache at all', () => {
    expect(cacheKindFor('network-only')).toBeNull();
    expect(cacheKindFor('passthrough')).toBeNull();
  });
});

describe('fetchWithTimeout', () => {
  it('returns the response when the network is quick', async () => {
    const response = new Response('ok');
    await expect(
      fetchWithTimeout(new Request('https://x.test/'), 50, async () => response),
    ).resolves.toBe(response);
  });

  it('gives up after the timeout rather than hanging the navigation', async () => {
    vi.useFakeTimers();
    const pending = fetchWithTimeout(
      new Request('https://x.test/'),
      NAVIGATION_TIMEOUT_MS,
      () => new Promise<Response>(() => {}),
    );
    await vi.advanceTimersByTimeAsync(NAVIGATION_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('reports a network failure as null, since both mean "fall back to cache"', async () => {
    await expect(
      fetchWithTimeout(new Request('https://x.test/'), 50, async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).resolves.toBeNull();
  });
});

describe('isCacheable', () => {
  it('accepts a plain 200', () => {
    expect(isCacheable(new Response('ok', { status: 200 }))).toBe(true);
  });

  it('rejects errors and redirects, which would poison the cache', () => {
    expect(isCacheable(new Response('', { status: 404 }))).toBe(false);
    expect(isCacheable(new Response('', { status: 500 }))).toBe(false);
    expect(isCacheable(new Response('', { status: 206 }))).toBe(false);
  });

  it('rejects an opaque response, whose status we cannot see', () => {
    const opaque = new Response('', { status: 200 });
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    expect(isCacheable(opaque)).toBe(false);
  });
});
