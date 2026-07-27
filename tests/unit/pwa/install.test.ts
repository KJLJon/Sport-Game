/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.14 — Install UX: `beforeinstallprompt` capture, custom button, iOS A2HS
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §8.1, §10
 */
import { describe, expect, it, vi } from 'vitest';
import {
  IOS_STEPS,
  InstallController,
  availability,
  isIosSafari,
  type BeforeInstallPromptEvent,
} from '../../../src/pwa/install.ts';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126 Mobile/15E148 Safari/604.1';

describe('isIosSafari', () => {
  it('detects iPhone Safari', () => {
    expect(isIosSafari(SAFARI_IOS)).toBe(true);
  });

  it('does not mistake Chrome on iOS for Safari — it has no A2HS menu item', () => {
    expect(isIosSafari(CHROME_IOS)).toBe(false);
  });

  it('does not fire on Android or desktop', () => {
    expect(isIosSafari(CHROME_ANDROID)).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Windows NT 10.0) Chrome/126')).toBe(false);
  });
});

describe('availability', () => {
  it('offers nothing once installed', () => {
    expect(availability({ userAgent: CHROME_ANDROID, standalone: true }, true)).toBe('installed');
    expect(availability({ userAgent: SAFARI_IOS, standalone: true }, false)).toBe('installed');
  });

  it('offers the button when a prompt is held', () => {
    expect(availability({ userAgent: CHROME_ANDROID, standalone: false }, true)).toBe('promptable');
  });

  it('offers the manual steps on iOS, where there is no API at all', () => {
    expect(availability({ userAgent: SAFARI_IOS, standalone: false }, false)).toBe('ios-manual');
  });

  it('offers nothing where the criteria are unmet', () => {
    expect(availability({ userAgent: CHROME_ANDROID, standalone: false }, false)).toBe(
      'unavailable',
    );
  });

  it('has iOS steps that name the actual controls', () => {
    expect(IOS_STEPS.join(' ')).toMatch(/Share/);
    expect(IOS_STEPS.join(' ')).toMatch(/Add to Home Screen/);
  });
});

/** A `window` double with a settable user agent and working event dispatch. */
function fakeWindow(userAgent = CHROME_ANDROID, standalone = false) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    navigator: { userAgent, standalone: standalone || undefined },
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
    dispatch: (type: string, event: Event) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function promptEvent(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent & Event {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent & Event;
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  return event;
}

describe('InstallController', () => {
  it('starts unavailable and becomes promptable once the event fires', () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();
    expect(controller.state).toBe('unavailable');

    win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    expect(controller.state).toBe('promptable');
    controller.stop();
  });

  it('suppresses the browser mini-infobar so we can place the offer ourselves', () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();

    const event = promptEvent('accepted');
    const prevented = vi.spyOn(event, 'preventDefault');
    win.dispatch('beforeinstallprompt', event);

    expect(prevented).toHaveBeenCalled();
    controller.stop();
  });

  it('replays the deferred prompt and reports the outcome', async () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();

    const event = promptEvent('accepted');
    win.dispatch('beforeinstallprompt', event);

    await expect(controller.promptInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('treats the deferred prompt as single-use', async () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();
    win.dispatch('beforeinstallprompt', promptEvent('dismissed'));

    await expect(controller.promptInstall()).resolves.toBe('dismissed');
    await expect(controller.promptInstall()).resolves.toBe('unavailable');
    controller.stop();
  });

  it('reports installed after appinstalled, and drops the stale prompt', async () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();
    win.dispatch('beforeinstallprompt', promptEvent('accepted'));

    win.dispatch('appinstalled', new Event('appinstalled'));

    expect(controller.state).toBe('installed');
    await expect(controller.promptInstall()).resolves.toBe('unavailable');
    controller.stop();
  });

  it('reports installed from the start when launched standalone', () => {
    const win = fakeWindow(CHROME_ANDROID, true);
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();
    expect(controller.state).toBe('installed');
    controller.stop();
  });

  it('offers the manual route on iOS Safari without waiting for an event that never comes', () => {
    const win = fakeWindow(SAFARI_IOS);
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();
    expect(controller.state).toBe('ios-manual');
    controller.stop();
  });

  it('notifies subscribers immediately and on change', () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    const listener = vi.fn();
    controller.start();
    controller.subscribe(listener);
    expect(listener).toHaveBeenCalledWith('unavailable');

    win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    expect(listener).toHaveBeenCalledWith('promptable');
    controller.stop();
  });

  it('survives a prompt() that rejects', async () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();

    const event = promptEvent('accepted');
    (event.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not allowed'));
    win.dispatch('beforeinstallprompt', event);

    await expect(controller.promptInstall()).resolves.toBe('unavailable');
    controller.stop();
  });

  it('stops listening after stop()', () => {
    const win = fakeWindow();
    const controller = new InstallController({ window: win as unknown as Window });
    controller.start();
    controller.stop();

    win.dispatch('beforeinstallprompt', promptEvent('accepted'));
    expect(controller.state).toBe('unavailable');
  });
});
