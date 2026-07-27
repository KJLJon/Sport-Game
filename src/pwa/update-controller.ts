/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.8 — Update application: banner, safe-point auto-update, single-reload guard, force
 * @story   US-1.4 — Get updates reliably, US-1.7 — Never interrupted mid-match
 * @design  11-pwa-lifecycle.md §4 (applying an update)
 *
 * Purpose: turns "an update is ready" into "the app is now running it", without ever costing the
 * player a match. Applying means posting `SKIP_WAITING`, waiting for `controllerchange`, and
 * reloading exactly once — the one-shot guard is what stops the reload loop that makes an app
 * unusable.
 */
import type { Prefs } from '../storage/prefs.ts';
import { isSafePoint, type AppActivity } from './safe-point.ts';
import type { DetectorStatus, UpdateDetector } from './update-detector.ts';

/** `11` §4 — "Later" is remembered for 24 hours, then the banner returns. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

const PREF_AUTO_UPDATE = 'pwa.autoUpdate';
const PREF_SNOOZED_UNTIL = 'pwa.updateSnoozedUntil';
const PREF_RELOAD_GUARD = 'pwa.reloadGuard';

export type BannerDecision =
  | { readonly show: false }
  | { readonly show: true; readonly dismissible: boolean; readonly forced: boolean };

export interface DecideInput {
  readonly status: DetectorStatus;
  readonly activity: AppActivity;
  readonly autoUpdate: boolean;
  readonly snoozedUntil: number;
  readonly now: number;
}

export type UpdateAction = 'apply-silently' | 'show-banner' | 'offer-repair' | 'nothing';

/**
 * The whole of `11` §4 as one pure function, so the policy is testable without a service worker.
 */
export function decide(input: DecideInput): UpdateAction {
  const { status, activity, autoUpdate, snoozedUntil, now } = input;

  if (status.state.kind === 'stuck') return 'offer-repair';
  if (status.state.kind !== 'ready') return 'nothing';

  // A forced update outranks everything, including being mid-match: it is reserved for builds
  // that cannot safely load the player's data, so waiting is the more dangerous option.
  if (status.state.forced) return 'show-banner';

  // Never mid-match, never mid-edit, never mid-ceremony (`11` §4).
  if (autoUpdate && isSafePoint(activity, now)) return 'apply-silently';

  if (now < snoozedUntil) return 'nothing';
  return 'show-banner';
}

export function bannerFor(status: DetectorStatus, action: UpdateAction): BannerDecision {
  if (action !== 'show-banner') return { show: false };
  const forced = status.state.kind === 'ready' && status.state.forced;
  return { show: true, dismissible: !forced, forced };
}

export interface ControllerOptions {
  readonly detector: UpdateDetector;
  readonly registration?: ServiceWorkerRegistration | undefined;
  readonly prefs: Prefs;
  readonly getActivity: () => AppActivity;
  /** Renders or hides the banner. The controller owns policy, not markup. */
  readonly onBanner: (decision: BannerDecision, apply: () => void, later: () => void) => void;
  /** Called when the version poll says the SW mechanism has failed (`11` §3, trigger 5). */
  readonly onStuck?: (status: DetectorStatus) => void;
  readonly container?: ServiceWorkerContainer | undefined;
  readonly reload?: () => void;
  readonly now?: () => number;
}

export class UpdateController {
  readonly #options: ControllerOptions;
  readonly #now: () => number;
  #unsubscribe: (() => void) | null = null;
  #applying = false;

  constructor(options: ControllerOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  get autoUpdate(): boolean {
    return this.#options.prefs.get(PREF_AUTO_UPDATE, true);
  }

  setAutoUpdate(value: boolean): void {
    this.#options.prefs.set(PREF_AUTO_UPDATE, value);
  }

  start(): void {
    // Clear the one-shot guard: reaching here means the reload completed and the app booted.
    this.#options.prefs.remove(PREF_RELOAD_GUARD);
    this.#unsubscribe = this.#options.detector.subscribe((status) => this.#react(status));
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** Re-evaluates against the current activity. Call when the player returns to a safe screen. */
  reconsider(): void {
    this.#react(this.#options.detector.status);
  }

  #react(status: DetectorStatus): void {
    const action = decide({
      status,
      activity: this.#options.getActivity(),
      autoUpdate: this.autoUpdate,
      snoozedUntil: this.#options.prefs.get(PREF_SNOOZED_UNTIL, 0),
      now: this.#now(),
    });

    if (action === 'offer-repair') {
      this.#options.onStuck?.(status);
      return;
    }

    if (action === 'apply-silently') {
      void this.apply();
      return;
    }

    this.#options.onBanner(
      bannerFor(status, action),
      () => void this.apply(),
      () => this.later(),
    );
  }

  /** `11` §4 — "Later" is remembered for 24 h. It is never a modal, so this is always available. */
  later(): void {
    this.#options.prefs.set(PREF_SNOOZED_UNTIL, this.#now() + SNOOZE_MS);
    this.#options.onBanner({ show: false }, noop, noop);
  }

  /**
   * Posts `SKIP_WAITING`, waits for the controller to change, then reloads exactly once. The
   * guard survives the reload in storage, so a worker that keeps re-waiting cannot loop the app.
   */
  async apply(): Promise<boolean> {
    if (this.#applying) return false;
    this.#applying = true;

    const waiting = this.#options.registration?.waiting;
    if (!waiting) {
      this.#applying = false;
      return false;
    }

    if (this.#options.prefs.get(PREF_RELOAD_GUARD, false)) {
      // We already reloaded for this and came back to a waiting worker: something is wrong, and
      // reloading again would loop. Leave the banner up and let the player choose.
      this.#applying = false;
      return false;
    }

    const container = this.#options.container ?? globalThis.navigator?.serviceWorker;
    const changed = container
      ? new Promise<void>((resolve) => {
          container.addEventListener('controllerchange', () => resolve(), { once: true });
        })
      : Promise.resolve();

    waiting.postMessage({ type: 'SKIP_WAITING' });
    await changed;

    this.#options.prefs.set(PREF_RELOAD_GUARD, true);
    (this.#options.reload ?? (() => globalThis.location.reload()))();
    return true;
  }
}

function noop(): void {
  // Placeholder for the hide case, where no action is offered.
}
