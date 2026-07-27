/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.8 — Update application, T-0.9 — Integrity self-check, T-0.10 — Repair
 * @story   US-1.4, US-1.7, US-1.8, US-1.9
 * @design  11-pwa-lifecycle.md §4, §5, §6
 */
import { describe, expect, it, vi } from 'vitest';
import { IDLE_REQUIRED_MS, isSafePoint, type AppActivity } from '../../../src/pwa/safe-point.ts';
import {
  SNOOZE_MS,
  UpdateController,
  bannerFor,
  decide,
} from '../../../src/pwa/update-controller.ts';
import { classify, describeReadiness, isCritical } from '../../../src/pwa/integrity.ts';
import { Prefs, memoryStore } from '../../../src/storage/prefs.ts';
import type { DetectorStatus } from '../../../src/pwa/update-detector.ts';
import type { VersionInfo } from '../../../src/pwa/version.ts';

const NOW = 1_000_000;
const BASE = '/Sport-Game/';

const DEPLOYED: VersionInfo = {
  buildHash: 'def5678',
  version: '1.1.0',
  builtAt: '2026-07-27T10:00:00Z',
  minSupportedVersion: '1.0.0',
};

const IDLE: AppActivity = {
  path: '/',
  inMatch: false,
  unsavedEditor: false,
  midCeremony: false,
  lastInteractionAt: NOW - IDLE_REQUIRED_MS,
};

function status(state: DetectorStatus['state']): DetectorStatus {
  return { state, lastCheckedAt: NOW, deployed: DEPLOYED, checking: false };
}

const READY = status({ kind: 'ready', deployed: DEPLOYED, forced: false });
const FORCED = status({ kind: 'ready', deployed: DEPLOYED, forced: true });
const STUCK = status({ kind: 'stuck', deployed: DEPLOYED });
const NONE = status({ kind: 'none' });

describe('isSafePoint — `11` §4', () => {
  it('allows a silent update when idle on a quiet screen', () => {
    expect(isSafePoint(IDLE, NOW)).toBe(true);
  });

  it('never mid-match', () => {
    expect(isSafePoint({ ...IDLE, inMatch: true }, NOW)).toBe(false);
  });

  it('never with an unsaved editor open', () => {
    expect(isSafePoint({ ...IDLE, unsavedEditor: true }, NOW)).toBe(false);
  });

  it('never mid-pack-opening', () => {
    expect(isSafePoint({ ...IDLE, midCeremony: true }, NOW)).toBe(false);
  });

  it('never on a screen not on the quiet list', () => {
    expect(isSafePoint({ ...IDLE, path: '/play/live' }, NOW)).toBe(false);
    expect(isSafePoint({ ...IDLE, path: '/squad/athlete/4' }, NOW)).toBe(false);
  });

  it('requires five seconds of idle', () => {
    expect(isSafePoint({ ...IDLE, lastInteractionAt: NOW - 1000 }, NOW)).toBe(false);
    expect(isSafePoint({ ...IDLE, lastInteractionAt: NOW - IDLE_REQUIRED_MS }, NOW)).toBe(true);
  });
});

describe('decide — `11` §4', () => {
  const base = { activity: IDLE, autoUpdate: true, snoozedUntil: 0, now: NOW };

  it('does nothing when there is no update', () => {
    expect(decide({ ...base, status: NONE })).toBe('nothing');
  });

  it('applies silently at a safe point when auto-update is on', () => {
    expect(decide({ ...base, status: READY })).toBe('apply-silently');
  });

  it('shows a banner instead when auto-update is off', () => {
    expect(decide({ ...base, status: READY, autoUpdate: false })).toBe('show-banner');
  });

  it('shows a banner rather than reloading mid-match', () => {
    const activity = { ...IDLE, inMatch: true };
    expect(decide({ ...base, status: READY, activity })).toBe('show-banner');
  });

  it('honours a 24-hour snooze', () => {
    const snoozed = { ...base, status: READY, autoUpdate: false, snoozedUntil: NOW + SNOOZE_MS };
    expect(decide(snoozed)).toBe('nothing');
    expect(decide({ ...snoozed, now: NOW + SNOOZE_MS + 1 })).toBe('show-banner');
  });

  it('a forced update outranks the snooze and the safe-point rule alike', () => {
    expect(
      decide({
        ...base,
        status: FORCED,
        activity: { ...IDLE, inMatch: true },
        snoozedUntil: NOW + SNOOZE_MS,
      }),
    ).toBe('show-banner');
  });

  it('offers Repair when the deployed build differs but nothing is waiting', () => {
    expect(decide({ ...base, status: STUCK })).toBe('offer-repair');
  });
});

describe('bannerFor', () => {
  it('is dismissable for an ordinary update', () => {
    expect(bannerFor(READY, 'show-banner')).toEqual({
      show: true,
      dismissible: true,
      forced: false,
    });
  });

  it('is not dismissable below minSupportedVersion', () => {
    expect(bannerFor(FORCED, 'show-banner')).toEqual({
      show: true,
      dismissible: false,
      forced: true,
    });
  });

  it('shows nothing for any other action', () => {
    expect(bannerFor(READY, 'apply-silently').show).toBe(false);
    expect(bannerFor(NONE, 'nothing').show).toBe(false);
  });
});

/** A minimal detector double — the controller only ever subscribes and reads `.status`. */
function fakeDetector(current: DetectorStatus) {
  const listeners = new Set<(s: DetectorStatus) => void>();
  return {
    status: current,
    subscribe: (listener: (s: DetectorStatus) => void) => {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    emit: (next: DetectorStatus) => {
      for (const listener of listeners) listener(next);
    },
  };
}

function fakeContainer() {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('UpdateController.apply — the single-reload guard', () => {
  function build(prefs = new Prefs(memoryStore())) {
    const postMessage = vi.fn();
    const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;
    const container = fakeContainer();
    const reload = vi.fn();
    const detector = fakeDetector(NONE);

    const controller = new UpdateController({
      detector: detector as never,
      registration,
      prefs,
      getActivity: () => IDLE,
      onBanner: () => {},
      container: container as unknown as ServiceWorkerContainer,
      reload,
      now: () => NOW,
    });

    return { controller, postMessage, container, reload, prefs };
  }

  it('posts SKIP_WAITING, waits for controllerchange, then reloads once', async () => {
    const { controller, postMessage, container, reload } = build();

    const applied = controller.apply();
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();

    container.fire();
    await applied;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses a second apply while one is in flight', async () => {
    const { controller, container } = build();
    const first = controller.apply();
    await expect(controller.apply()).resolves.toBe(false);
    container.fire();
    await first;
  });

  it('refuses to reload again when the guard survived a reload — no reload loop', async () => {
    const prefs = new Prefs(memoryStore());
    prefs.set('pwa.reloadGuard', true);
    const { controller, reload } = build(prefs);

    await expect(controller.apply()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the guard on start, since booting proves the reload completed', () => {
    const prefs = new Prefs(memoryStore());
    prefs.set('pwa.reloadGuard', true);
    const { controller } = build(prefs);

    controller.start();
    expect(prefs.get('pwa.reloadGuard', false)).toBe(false);
    controller.stop();
  });

  it('does nothing when no worker is waiting', async () => {
    const detector = fakeDetector(NONE);
    const reload = vi.fn();
    const controller = new UpdateController({
      detector: detector as never,
      registration: { waiting: null } as unknown as ServiceWorkerRegistration,
      prefs: new Prefs(memoryStore()),
      getActivity: () => IDLE,
      onBanner: () => {},
      reload,
      now: () => NOW,
    });

    await expect(controller.apply()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('UpdateController.later', () => {
  it('remembers the snooze for 24 hours and hides the banner', () => {
    const prefs = new Prefs(memoryStore());
    const onBanner = vi.fn();
    const controller = new UpdateController({
      detector: fakeDetector(NONE) as never,
      prefs,
      getActivity: () => IDLE,
      onBanner,
      now: () => NOW,
    });

    controller.later();

    expect(prefs.get('pwa.updateSnoozedUntil', 0)).toBe(NOW + SNOOZE_MS);
    expect(onBanner).toHaveBeenCalledWith({ show: false }, expect.anything(), expect.anything());
  });
});

describe('integrity — `11` §5.2', () => {
  it('treats the document and the entry chunk as critical', () => {
    expect(isCritical(BASE, BASE)).toBe(true);
    expect(isCritical(`${BASE}index.html`, BASE)).toBe(true);
    expect(isCritical(`${BASE}assets/index-BpcRC.js`, BASE)).toBe(true);
    expect(isCritical(`${BASE}assets/index-BVX.css`, BASE)).toBe(true);
  });

  it('treats a code-split screen or an icon as non-critical', () => {
    expect(isCritical(`${BASE}assets/home-bX3V.js`, BASE)).toBe(false);
    expect(isCritical(`${BASE}icons/icon-192.png`, BASE)).toBe(false);
  });

  it('reports ready when nothing is missing', () => {
    expect(classify([], BASE, true, 20)).toEqual({ kind: 'ready' });
  });

  it('heals silently when online and non-critical entries are gone', () => {
    const missing = [`${BASE}icons/icon-192.png`];
    expect(classify(missing, BASE, true, 20)).toEqual({ kind: 'healing', missing });
  });

  it('is honest rather than broken when the same happens offline', () => {
    const missing = [`${BASE}icons/icon-192.png`];
    expect(classify(missing, BASE, false, 20)).toEqual({ kind: 'incomplete', missing });
    expect(describeReadiness({ kind: 'incomplete', missing })).toMatch(/next time you are online/);
  });

  it('escalates to Repair when a critical entry is gone, online or not', () => {
    const missing = [`${BASE}assets/index-BpcRC.js`];
    expect(classify(missing, BASE, true, 20).kind).toBe('critical');
    expect(classify(missing, BASE, false, 20).kind).toBe('critical');
  });

  it('reports unknown before anything is precached', () => {
    expect(classify([], BASE, true, 0)).toEqual({ kind: 'unknown' });
  });

  it('never blames the player in its copy (`10` §9)', () => {
    for (const kind of ['ready', 'healing', 'incomplete', 'critical', 'unknown'] as const) {
      const text = describeReadiness({ kind, missing: [] } as never);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/error|fail|you (did|broke)/i);
    }
  });
});
