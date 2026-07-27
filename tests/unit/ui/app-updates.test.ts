/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.9 — Offline readiness UI, T-0.10 — Repair and version display,
 *          T-0.12 — Storage persistence and quota, T-0.14 — Install UX
 * @story   US-1.1, US-1.5, US-1.8, US-1.9
 * @design  11-pwa-lifecycle.md §4, §6, §7; 10-ui-ux.md §8.1, §9
 *
 * Purpose: the Settings → App & updates screen carries four `11` requirements at once, and until
 * now was covered only by E2E. The states that matter here are the *unhappy* ones — no runtime,
 * an update that will not install, storage under pressure — because those are what the screen
 * exists for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenContext } from '../../../src/app/screen.ts';
import { REPAIR_PROMISE } from '../../../src/pwa/repair.ts';
import type * as RepairModule from '../../../src/pwa/repair.ts';

const runtimeRef: { current: unknown } = { current: null };

vi.mock('../../../src/pwa/boot.ts', () => ({
  pwaRuntime: () => runtimeRef.current,
}));

const repairSpy = vi.fn(async () => {});
vi.mock('../../../src/pwa/repair.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RepairModule>();
  return { ...actual, repair: () => repairSpy() };
});

const { appUpdatesScreen } = await import('../../../src/ui/screens/app-updates.ts');

function context(): ScreenContext & { host: HTMLElement } {
  const host = document.createElement('main');
  return { host, params: {}, query: {}, navigate: vi.fn() } as ScreenContext & {
    host: HTMLElement;
  };
}

/** A runtime whose every part is controllable, so each display state can be staged. */
function fakeRuntime(overrides: Record<string, unknown> = {}) {
  const versionListeners: (() => void)[] = [];
  const installListeners: ((state: string) => void)[] = [];

  return {
    versionListeners,
    installListeners,
    runningVersion: '1.2.3',
    runningBuild: 'abc1234',
    detector: {
      status: {
        deployed: { builtAt: new Date().toISOString() },
        lastCheckedAt: Date.now(),
        state: { kind: 'current' },
      },
      check: vi.fn(async () => ({ state: { kind: 'current' } })),
      subscribe: (listener: () => void) => {
        versionListeners.push(listener);
        return () => {};
      },
    },
    controller: { autoUpdate: true, setAutoUpdate: vi.fn() },
    integrity: { downloadEverything: vi.fn(async () => {}) },
    install: {
      state: 'unavailable',
      promptInstall: vi.fn(async () => {}),
      subscribe: (listener: (state: string) => void) => {
        installListeners.push(listener);
        return () => {};
      },
    },
    readiness: () => ({ kind: 'ready' }),
    refreshReadiness: vi.fn(async () => ({ kind: 'ready' })),
    ...overrides,
  };
}

beforeEach(() => {
  runtimeRef.current = null;
  repairSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Text of the whole screen, for assertions that do not care about structure. */
function text(host: HTMLElement): string {
  return host.textContent ?? '';
}

describe('with no PWA runtime — an unsupported or not-yet-booted browser', () => {
  it('still renders every panel rather than failing', async () => {
    const ctx = context();
    appUpdatesScreen().mount(ctx);

    // Storage renders asynchronously — it has to ask the browser for a quota estimate first.
    const synchronous = [...ctx.host.querySelectorAll('.panel__title')].map((el) => el.textContent);
    expect(synchronous).toEqual(['Install', 'Version', 'Updates', 'Offline', 'Repair app']);

    await vi.waitFor(() => {
      const titles = [...ctx.host.querySelectorAll('.panel__title')].map((el) => el.textContent);
      expect(titles).toContain('Storage');
    });
  });

  it('says "unknown" instead of inventing a version', () => {
    const ctx = context();
    appUpdatesScreen().mount(ctx);

    const values = [...ctx.host.querySelectorAll('.kv-row__value')].map((el) => el.textContent);
    expect(values.slice(0, 3)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(values[3]).toBe('not yet');
  });

  it('explains that installing is unavailable, without hiding the panel', () => {
    const ctx = context();
    appUpdatesScreen().mount(ctx);
    expect(text(ctx.host)).toMatch(/Installing is not available in this browser/);
  });

  it('unmounts cleanly when nothing was subscribed', () => {
    const ctx = context();
    const screen = appUpdatesScreen();
    screen.mount(ctx);
    expect(() => screen.unmount?.()).not.toThrow();
  });
});

describe('version and update checking', () => {
  it('answers "am I on the new one?" with version, build, and last check (`11` §4)', () => {
    runtimeRef.current = fakeRuntime();
    const ctx = context();
    appUpdatesScreen().mount(ctx);

    const labels = [...ctx.host.querySelectorAll('.kv-row__label')].map((el) => el.textContent);
    expect(labels).toEqual(['Running', 'Build', 'Built', 'Last checked']);

    const values = [...ctx.host.querySelectorAll('.kv-row__value')].map((el) => el.textContent);
    expect(values[0]).toBe('1.2.3');
    expect(values[1]).toBe('abc1234');
  });

  it('reports the happy result of an explicit check', async () => {
    runtimeRef.current = fakeRuntime();
    const ctx = context();
    appUpdatesScreen().mount(ctx);

    const check = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check for update now',
    );
    check?.click();
    expect(ctx.host.querySelector('[role="status"]')?.textContent).toBe('Checking…');

    await vi.waitFor(() => {
      expect(ctx.host.querySelector('[role="status"]')?.textContent).toBe(
        "You're on the latest version.",
      );
    });
  });

  it('points at Repair when an update is deployed but stuck (`11` §3)', async () => {
    const runtime = fakeRuntime();
    runtime.detector.check = vi.fn(async () => ({ state: { kind: 'stuck' } }));
    runtimeRef.current = runtime;

    const ctx = context();
    appUpdatesScreen().mount(ctx);
    [...ctx.host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Check for update now')
      ?.click();

    await vi.waitFor(() => {
      expect(ctx.host.querySelector('[role="status"]')?.textContent).toMatch(/Try Repair/);
    });
  });

  it('announces a ready update', async () => {
    const runtime = fakeRuntime();
    runtime.detector.check = vi.fn(async () => ({ state: { kind: 'ready' } }));
    runtimeRef.current = runtime;

    const ctx = context();
    appUpdatesScreen().mount(ctx);
    [...ctx.host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Check for update now')
      ?.click();

    await vi.waitFor(() => {
      expect(ctx.host.querySelector('[role="status"]')?.textContent).toMatch(/ready to install/);
    });
  });

  it('re-renders the version block when the detector reports a change', () => {
    const runtime = fakeRuntime();
    runtimeRef.current = runtime;

    const ctx = context();
    appUpdatesScreen().mount(ctx);
    expect(runtime.versionListeners).toHaveLength(1);

    runtime.runningVersion = '2.0.0';
    runtime.versionListeners[0]?.();
    expect(ctx.host.querySelector('.kv-row__value')?.textContent).toBe('2.0.0');
  });

  it('toggles auto-update through the controller', () => {
    const runtime = fakeRuntime();
    runtimeRef.current = runtime;

    const ctx = context();
    appUpdatesScreen().mount(ctx);

    // Driven as a change event rather than a click: jsdom's checkbox click does not always
    // produce one, and `change` is what the control actually listens for.
    const toggle = ctx.host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle).not.toBeNull();
    toggle!.checked = false;
    toggle!.dispatchEvent(new Event('change'));

    expect(runtime.controller.setAutoUpdate).toHaveBeenCalledWith(false);
  });
});

describe('install states (`10` §8.1)', () => {
  it('offers the install button when the browser will prompt', () => {
    runtimeRef.current = fakeRuntime({
      install: {
        state: 'promptable',
        promptInstall: vi.fn(async () => {}),
        subscribe: () => () => {},
      },
    });

    const ctx = context();
    appUpdatesScreen().mount(ctx);

    const install = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Install',
    );
    expect(install).toBeDefined();
    install?.click();
  });

  it('gives iOS the manual Add to Home Screen steps', () => {
    runtimeRef.current = fakeRuntime({
      install: { state: 'ios-manual', promptInstall: vi.fn(), subscribe: () => () => {} },
    });

    const ctx = context();
    appUpdatesScreen().mount(ctx);

    expect(ctx.host.querySelectorAll('.steps li').length).toBeGreaterThan(1);
    expect(text(ctx.host)).toMatch(/Add it to your Home Screen/);
  });

  it('says so plainly once installed', () => {
    runtimeRef.current = fakeRuntime({
      install: { state: 'installed', promptInstall: vi.fn(), subscribe: () => () => {} },
    });

    const ctx = context();
    appUpdatesScreen().mount(ctx);
    expect(text(ctx.host)).toMatch(/Installed\. It works offline already\./);
  });

  it('re-renders when the install state changes mid-session', () => {
    const runtime = fakeRuntime();
    runtimeRef.current = runtime;

    const ctx = context();
    appUpdatesScreen().mount(ctx);
    runtime.installListeners[0]?.('installed');

    expect(text(ctx.host)).toMatch(/Installed/);
  });
});

describe('offline readiness and repair', () => {
  it('downloads everything for offline and refreshes the readiness display', async () => {
    const runtime = fakeRuntime();
    runtimeRef.current = runtime;

    const ctx = context();
    appUpdatesScreen().mount(ctx);
    [...ctx.host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Download everything for offline')
      ?.click();

    await vi.waitFor(() => {
      expect(runtime.integrity.downloadEverything).toHaveBeenCalled();
      expect(runtime.refreshReadiness).toHaveBeenCalled();
    });
  });

  it('states in full what Repair will not touch (`11` §6)', () => {
    const ctx = context();
    appUpdatesScreen().mount(ctx);

    expect(text(ctx.host)).toContain(REPAIR_PROMISE);
    expect(REPAIR_PROMISE.toLowerCase()).toMatch(/never touched by repair/);
  });

  it('marks Repair as destructive rather than as an ordinary button', () => {
    const ctx = context();
    appUpdatesScreen().mount(ctx);

    const repairButton = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Repair app',
    );
    expect(repairButton?.className).toMatch(/destructive/);
    expect(ctx.host.querySelector('.panel--danger')).not.toBeNull();
  });

  it('runs Repair on press', () => {
    const ctx = context();
    appUpdatesScreen().mount(ctx);
    [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Repair app')?.click();

    expect(repairSpy).toHaveBeenCalled();
  });
});

describe('storage (`11` §7)', () => {
  it('reports usage against quota when the browser provides it', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
      },
    });

    const ctx = context();
    appUpdatesScreen().mount(ctx);

    await vi.waitFor(() => {
      expect(text(ctx.host)).toMatch(/Used/);
      expect(text(ctx.host)).toMatch(/of/);
    });
  });

  it('warns when storage is nearly full', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 95 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
      },
    });

    const ctx = context();
    appUpdatesScreen().mount(ctx);

    await vi.waitFor(() => {
      expect(text(ctx.host)).toMatch(/Storage is nearly full/);
    });
  });

  it('says usage is unavailable rather than showing a wrong number', async () => {
    vi.stubGlobal('navigator', {});

    const ctx = context();
    appUpdatesScreen().mount(ctx);

    await vi.waitFor(() => {
      expect(text(ctx.host)).toMatch(/Usage is not reported here/);
    });
  });
});
