/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.8 — Update application, T-0.9 — Integrity self-check, T-0.10 — Repair
 * @story   US-1.4, US-1.7, US-1.8, US-1.9
 * @design  11-pwa-lifecycle.md §3, §4, §5, §6
 *
 * Purpose: wires the PWA layer together and exposes it as one object the UI can read. Kept apart
 * from `main.ts` so the whole lifecycle can be constructed in a test with fakes.
 */
import { prefs as defaultPrefs, type Prefs } from '../storage/prefs.ts';
import { banner as bannerComponent } from '../ui/components/feedback.ts';
import { PersistenceNudger } from '../storage/persistence.ts';
import { InstallController } from './install.ts';
import { IntegrityChecker, type Readiness } from './integrity.ts';
import { registerServiceWorker } from './register.ts';
import { ActivityTracker } from './safe-point.ts';
import { UpdateController, type BannerDecision } from './update-controller.ts';
import { UpdateDetector, type DetectorStatus } from './update-detector.ts';
import { RUNNING_BUILD } from './version.ts';

export interface PwaRuntime {
  readonly detector: UpdateDetector;
  readonly controller: UpdateController;
  readonly integrity: IntegrityChecker;
  readonly install: InstallController;
  readonly persistence: PersistenceNudger;
  readonly activity: ActivityTracker;
  readonly runningBuild: string;
  readonly runningVersion: string;
  /** Latest readiness result, for the Settings display. */
  readonly readiness: () => Readiness;
  refreshReadiness(): Promise<Readiness>;
}

export interface BootOptions {
  /** Where update banners render — `AppShell.bannerHost`. */
  readonly bannerHost: HTMLElement;
  readonly prefs?: Prefs;
  readonly onStuck?: (status: DetectorStatus) => void;
}

/** A single runtime instance, so Settings and the shell see the same state. */
let runtime: PwaRuntime | null = null;

export function pwaRuntime(): PwaRuntime | null {
  return runtime;
}

export async function bootPwa(options: BootOptions): Promise<PwaRuntime> {
  const prefs = options.prefs ?? defaultPrefs;
  const outcome = await registerServiceWorker();
  const registration = outcome.status === 'registered' ? outcome.registration : undefined;

  const detector = new UpdateDetector({
    registration,
    runningVersion: __APP_VERSION__,
    runningBuild: RUNNING_BUILD,
  });

  const activity = new ActivityTracker();
  activity.touch(Date.now());

  const controller = new UpdateController({
    detector,
    registration,
    prefs,
    getActivity: () => activity.activity,
    onBanner: (decision, apply, later) => renderBanner(options.bannerHost, decision, apply, later),
    ...(options.onStuck ? { onStuck: options.onStuck } : {}),
  });

  const integrity = new IntegrityChecker({ prefs, base: import.meta.env.BASE_URL });
  const install = new InstallController();
  install.start();

  // `11` §7 — asked on first write rather than at launch, when the browser is most likely to say
  // no and least likely to be asked again.
  const persistence = new PersistenceNudger();
  void persistence.reach('first-write');

  let readiness: Readiness = { kind: 'unknown' };
  const refreshReadiness = async (): Promise<Readiness> => {
    readiness = await integrity.check();
    return readiness;
  };

  detector.start();
  controller.start();

  // `11` §5.2 — the check runs in an idle callback so it never affects launch time.
  scheduleIdle(() => void refreshReadiness());

  runtime = {
    detector,
    controller,
    integrity,
    install,
    persistence,
    activity,
    runningBuild: RUNNING_BUILD,
    runningVersion: __APP_VERSION__,
    readiness: () => readiness,
    refreshReadiness,
  };
  return runtime;
}

function scheduleIdle(task: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (typeof idle === 'function') idle(task);
  else setTimeout(task, 1500);
}

function renderBanner(
  host: HTMLElement,
  decision: BannerDecision,
  apply: () => void,
  later: () => void,
): void {
  host.replaceChildren();
  if (!decision.show) return;

  const message = decision.forced
    ? 'This version can no longer load your data safely. Update to keep playing.'
    : 'Update ready.';

  host.appendChild(
    bannerComponent(host.ownerDocument, {
      message,
      tone: decision.forced ? 'warning' : 'success',
      actions: decision.dismissible
        ? [
            { label: 'Update now', variant: 'primary', onSelect: apply },
            { label: 'Later', onSelect: later },
          ]
        : [{ label: 'Update now', variant: 'primary', onSelect: apply }],
    }),
  );
}
