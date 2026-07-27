/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.7 — `version.json` emission + all five update-detection triggers
 * @story   US-1.4 — Get updates reliably
 * @design  11-pwa-lifecycle.md §3 (update detection)
 *
 * Purpose: each of the five triggers gets its own assertion, and so does the case the whole
 * design exists for — a deployed build that differs while no worker is waiting, which is the
 * "I couldn't get the update" symptom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOREGROUND_MIN_INTERVAL_MS,
  POLL_INTERVAL_MS,
  UpdateDetector,
  type DetectorOptions,
} from '../../../src/pwa/update-detector.ts';
import type { VersionInfo } from '../../../src/pwa/version.ts';

const RUNNING_BUILD = 'abc1234';

const SAME: VersionInfo = {
  buildHash: RUNNING_BUILD,
  version: '1.0.0',
  builtAt: '2026-07-27T10:00:00Z',
  minSupportedVersion: '1.0.0',
};

const NEWER: VersionInfo = { ...SAME, buildHash: 'def5678', version: '1.1.0' };
const BREAKING: VersionInfo = { ...NEWER, minSupportedVersion: '1.1.0' };

/** A registration double: `update()` is observable, and `waiting` is settable. */
function fakeRegistration(waiting: ServiceWorker | null = null) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    waiting,
    installing: null as ServiceWorker | null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

/** A `document` double whose visibility can be flipped. */
function fakeDocument() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    fire: () => {
      for (const listener of listeners) listener();
    },
  };
}

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

/**
 * Flushes the promise chain inside `check()` without firing the fifteen-minute poll — which
 * `runOnlyPendingTimers` would, making every launch look like two checks.
 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

describe('UpdateDetector', () => {
  let clock = 1_000_000;
  let detector: UpdateDetector | null = null;

  function build(overrides: Partial<DetectorOptions> = {}): {
    detector: UpdateDetector;
    registration: ReturnType<typeof fakeRegistration>;
    doc: ReturnType<typeof fakeDocument>;
    win: ReturnType<typeof fakeWindow>;
    fetchVersionImpl: ReturnType<typeof vi.fn>;
  } {
    const registration = fakeRegistration();
    const doc = fakeDocument();
    const win = fakeWindow();
    const fetchVersionImpl = vi.fn().mockResolvedValue({ status: 'ok', info: SAME });

    const instance = new UpdateDetector({
      registration: registration as unknown as ServiceWorkerRegistration,
      runningVersion: '1.0.0',
      runningBuild: RUNNING_BUILD,
      document: doc as unknown as Document,
      window: win as unknown as Window,
      fetchVersionImpl: fetchVersionImpl as never,
      now: () => clock,
      ...overrides,
    });

    detector = instance;
    return { detector: instance, registration, doc, win, fetchVersionImpl };
  }

  beforeEach(() => {
    clock = 1_000_000;
    vi.useFakeTimers();
  });

  afterEach(() => {
    detector?.stop();
    detector = null;
    vi.useRealTimers();
  });

  it('trigger 1 — checks on launch', async () => {
    const { detector: d, registration, fetchVersionImpl } = build();
    d.start();
    await settle();

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(fetchVersionImpl).toHaveBeenCalledTimes(1);
    expect(d.status.lastCheckedAt).toBe(clock);
  });

  it('trigger 2 — rechecks on foreground', async () => {
    const { detector: d, doc, fetchVersionImpl } = build();
    d.start();
    await settle();
    fetchVersionImpl.mockClear();

    clock += FOREGROUND_MIN_INTERVAL_MS + 1;
    doc.fire();
    await settle();

    expect(fetchVersionImpl).toHaveBeenCalledTimes(1);
  });

  it('trigger 2 — but not more than once a minute', async () => {
    const { detector: d, doc, fetchVersionImpl } = build();
    d.start();
    await settle();
    fetchVersionImpl.mockClear();

    clock += 5_000;
    doc.fire();
    await settle();

    expect(fetchVersionImpl).not.toHaveBeenCalled();
  });

  it('trigger 2 — ignores going to the background', async () => {
    const { detector: d, doc, fetchVersionImpl } = build();
    d.start();
    await settle();
    fetchVersionImpl.mockClear();

    clock += FOREGROUND_MIN_INTERVAL_MS + 1;
    doc.visibilityState = 'hidden';
    doc.fire();
    await settle();

    expect(fetchVersionImpl).not.toHaveBeenCalled();
  });

  it('trigger 3 — polls every fifteen minutes while open', async () => {
    const { detector: d, fetchVersionImpl } = build();
    d.start();
    await settle();
    fetchVersionImpl.mockClear();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchVersionImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchVersionImpl).toHaveBeenCalledTimes(2);
  });

  it('trigger 4 — an explicit check from Settings reports what it found', async () => {
    const { detector: d, fetchVersionImpl } = build();
    fetchVersionImpl.mockResolvedValue({ status: 'ok', info: SAME });

    const status = await d.check();

    expect(status.deployed).toEqual(SAME);
    expect(status.state.kind).toBe('none');
    expect(status.checking).toBe(false);
  });

  it('trigger 5 — a differing build with no waiting worker is reported as stuck', async () => {
    const { detector: d, fetchVersionImpl } = build();
    fetchVersionImpl.mockResolvedValue({ status: 'ok', info: NEWER });

    const status = await d.check();

    expect(status.state).toEqual({ kind: 'stuck', deployed: NEWER });
  });

  it('reports "ready" once a worker is waiting', async () => {
    const { detector: d, registration, fetchVersionImpl } = build();
    fetchVersionImpl.mockResolvedValue({ status: 'ok', info: NEWER });
    registration.waiting = {} as ServiceWorker;

    const status = await d.check();

    expect(status.state.kind).toBe('ready');
    expect(status.state.kind === 'ready' && status.state.forced).toBe(false);
  });

  it('marks the update forced below minSupportedVersion', async () => {
    const { detector: d, registration, fetchVersionImpl } = build();
    fetchVersionImpl.mockResolvedValue({ status: 'ok', info: BREAKING });
    registration.waiting = {} as ServiceWorker;

    const status = await d.check();

    expect(status.state.kind === 'ready' && status.state.forced).toBe(true);
  });

  it('keeps the last known version when a later check comes back offline', async () => {
    const { detector: d, fetchVersionImpl } = build();
    fetchVersionImpl.mockResolvedValueOnce({ status: 'ok', info: SAME });
    await d.check();

    fetchVersionImpl.mockResolvedValueOnce({ status: 'unknown' });
    const status = await d.check();

    expect(status.deployed).toEqual(SAME);
  });

  it('stays quiet when nothing has changed', async () => {
    const { detector: d } = build();
    const status = await d.check();
    expect(status.state).toEqual({ kind: 'none' });
  });

  it('notifies subscribers immediately and on change', async () => {
    const { detector: d, fetchVersionImpl } = build();
    fetchVersionImpl.mockResolvedValue({ status: 'ok', info: NEWER });

    const listener = vi.fn();
    d.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    await d.check();
    expect(listener.mock.calls.length).toBeGreaterThan(1);
    expect(d.status.state.kind).toBe('stuck');
  });

  it('unsubscribes cleanly', async () => {
    const { detector: d } = build();
    const listener = vi.fn();
    d.subscribe(listener)();
    listener.mockClear();

    await d.check();
    expect(listener).not.toHaveBeenCalled();
  });

  it('rechecks when the device comes back online', async () => {
    const { detector: d, win, fetchVersionImpl } = build();
    d.start();
    await settle();
    fetchVersionImpl.mockClear();

    win.fire('online');
    await settle();

    expect(fetchVersionImpl).toHaveBeenCalledTimes(1);
  });

  it('stops every trigger on stop()', async () => {
    const { detector: d, doc, win, fetchVersionImpl } = build();
    d.start();
    await settle();
    d.stop();
    fetchVersionImpl.mockClear();

    clock += FOREGROUND_MIN_INTERVAL_MS + 1;
    doc.fire();
    win.fire('online');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

    expect(fetchVersionImpl).not.toHaveBeenCalled();
  });

  it('works with no registration at all — an unsupported browser still gets trigger 5', async () => {
    const { detector: d, fetchVersionImpl } = build({ registration: undefined });
    fetchVersionImpl.mockResolvedValue({ status: 'ok', info: NEWER });

    const status = await d.check();

    expect(status.state.kind).toBe('stuck');
  });

  it('survives a registration.update() that rejects while offline', async () => {
    const { detector: d, registration } = build();
    registration.update.mockRejectedValue(new Error('offline'));

    await expect(d.check()).resolves.toBeDefined();
  });
});
