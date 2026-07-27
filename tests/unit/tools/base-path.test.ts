/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.2 — Derive `base` from the repository name at build
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §2
 * @invariant INV-4
 */
import { describe, expect, it } from 'vitest';
import { normaliseBase, resolveBasePath } from '../../../tools/base-path.ts';

describe('normaliseBase', () => {
  it.each([
    ['Sport-Game', '/Sport-Game/'],
    ['/Sport-Game', '/Sport-Game/'],
    ['Sport-Game/', '/Sport-Game/'],
    ['/Sport-Game/', '/Sport-Game/'],
    ['  Sport-Game  ', '/Sport-Game/'],
    ['/', '/'],
    ['', '/'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseBase(input)).toBe(expected);
  });
});

describe('resolveBasePath', () => {
  it('derives the base path from the repository name CI provides', () => {
    expect(resolveBasePath({ GITHUB_REPOSITORY: 'KJLJon/Sport-Game' })).toBe('/Sport-Game/');
  });

  it('follows a repository rename with no code change', () => {
    expect(resolveBasePath({ GITHUB_REPOSITORY: 'KJLJon/Family-Sports' })).toBe('/Family-Sports/');
  });

  it('lets an explicit BASE_PATH win, so local dev can serve from the root', () => {
    expect(resolveBasePath({ BASE_PATH: '/', GITHUB_REPOSITORY: 'KJLJon/Sport-Game' })).toBe('/');
  });

  it('falls back when nothing is set', () => {
    expect(resolveBasePath({})).toBe('/Sport-Game/');
  });

  it('ignores empty environment values rather than producing "//"', () => {
    expect(resolveBasePath({ BASE_PATH: '', GITHUB_REPOSITORY: '' })).toBe('/Sport-Game/');
  });

  it('always ends with a trailing slash, which service-worker scoping requires', () => {
    for (const repo of ['a/b', 'owner/x-y-z', 'owner/Repo.Name']) {
      expect(resolveBasePath({ GITHUB_REPOSITORY: repo }).endsWith('/')).toBe(true);
      expect(resolveBasePath({ GITHUB_REPOSITORY: repo }).startsWith('/')).toBe(true);
    }
  });
});
