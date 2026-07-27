/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.7 — `version.json` emission + all five update-detection triggers
 * @story   US-1.4 — Get updates reliably
 * @design  11-pwa-lifecycle.md §3, §4
 */
import { describe, expect, it, vi } from 'vitest';
import {
  compareToDeployed,
  compareVersions,
  describeAge,
  fetchVersion,
  type VersionInfo,
} from '../../../src/pwa/version.ts';
import { buildVersionInfo, serialiseVersionInfo } from '../../../tools/version.ts';

const DEPLOYED: VersionInfo = {
  buildHash: 'def5678',
  version: '1.2.0',
  builtAt: '2026-07-27T10:14:00Z',
  minSupportedVersion: '1.0.0',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchVersion', () => {
  it('requests with no-store, because a cached version file defeats the whole design', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(DEPLOYED));
    await fetchVersion({ fetcher: fetcher as unknown as typeof fetch });

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.cache).toBe('no-store');
  });

  it('returns the parsed document', async () => {
    const result = await fetchVersion({
      fetcher: (async () => jsonResponse(DEPLOYED)) as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: 'ok', info: DEPLOYED });
  });

  it('reports "unknown" offline rather than throwing — that is the expected case here', async () => {
    const result = await fetchVersion({
      fetcher: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: 'unknown' });
  });

  it('reports "invalid" for a non-200 or a document of the wrong shape', async () => {
    await expect(
      fetchVersion({ fetcher: (async () => jsonResponse({}, 404)) as unknown as typeof fetch }),
    ).resolves.toEqual({ status: 'invalid' });

    await expect(
      fetchVersion({
        fetcher: (async () => jsonResponse({ buildHash: 'x' })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('reports "unknown" for a body that is not JSON at all', async () => {
    await expect(
      fetchVersion({
        fetcher: (async () => new Response('<html>404</html>')) as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ status: 'unknown' });
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0', '1.0.0', 0],
    ['1', '1.0.1', -1],
  ])('compares %s to %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });

  it('treats a non-numeric part as zero rather than NaN-ing the comparison', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
  });
});

describe('compareToDeployed', () => {
  it('detects a different build', () => {
    expect(compareToDeployed(DEPLOYED, 'abc1234', '1.2.0').differs).toBe(true);
    expect(compareToDeployed(DEPLOYED, 'def5678', '1.2.0').differs).toBe(false);
  });

  it('forces the update when the running version is below minSupportedVersion', () => {
    expect(compareToDeployed(DEPLOYED, 'abc1234', '0.9.0').forced).toBe(true);
    expect(compareToDeployed(DEPLOYED, 'abc1234', '1.0.0').forced).toBe(false);
    expect(compareToDeployed(DEPLOYED, 'abc1234', '1.2.0').forced).toBe(false);
  });
});

describe('describeAge', () => {
  const NOW = Date.parse('2026-07-27T12:00:00Z');

  it.each([
    ['2026-07-27T11:59:30Z', 'just now'],
    ['2026-07-27T11:30:00Z', '30 minutes ago'],
    ['2026-07-27T11:00:00Z', '1 hour ago'],
    ['2026-07-24T12:00:00Z', '3 days ago'],
    ['2026-07-06T12:00:00Z', '3 weeks ago'],
  ])('describes %s as %s', (builtAt, expected) => {
    expect(describeAge(builtAt, NOW)).toBe(expected);
  });

  it('says "unknown" rather than "NaN days ago" for an unparseable timestamp', () => {
    expect(describeAge('not a date', NOW)).toBe('unknown');
  });

  it('never reports a negative age from a clock skewed backwards', () => {
    expect(describeAge('2026-07-27T13:00:00Z', NOW)).toBe('just now');
  });
});

describe('buildVersionInfo', () => {
  it('carries the build hash, so it can be compared to the running build', () => {
    const info = buildVersionInfo('abc1234', '1.2.0', {}, new Date('2026-07-27T10:14:00Z'));
    expect(info.buildHash).toBe('abc1234');
    expect(info.version).toBe('1.2.0');
    expect(info.builtAt).toBe('2026-07-27T10:14:00.000Z');
  });

  it('honours SOURCE_DATE_EPOCH, so a rebuild can be byte-identical', () => {
    const info = buildVersionInfo('abc1234', '1.2.0', { SOURCE_DATE_EPOCH: '1800000000' });
    expect(info.builtAt).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it('serialises to a document fetchVersion accepts', async () => {
    const json = serialiseVersionInfo(buildVersionInfo('abc1234', '1.2.0'));
    const result = await fetchVersion({
      fetcher: (async () => new Response(json)) as unknown as typeof fetch,
    });
    expect(result.status).toBe('ok');
  });
});
