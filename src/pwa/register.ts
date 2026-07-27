/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.6 — Service worker registration and scope
 * @story   US-1.2 — Play offline, US-1.3 — Scoped to the repository directory
 * @design  04-architecture.md §2 (service worker scope), 11-pwa-lifecycle.md §3
 * @invariant INV-4 (no literal repository path)
 *
 * Purpose: registers the worker at the base path. A worker's maximum scope is its own directory,
 * so serving `sw.js` from the base path gives us path scoping for free — it physically cannot
 * claim clients belonging to another project on the same `github.io` account.
 */

export type RegistrationOutcome =
  | { readonly status: 'registered'; readonly registration: ServiceWorkerRegistration }
  | { readonly status: 'unsupported' }
  | { readonly status: 'failed'; readonly error: unknown };

export const SW_URL = `${import.meta.env.BASE_URL}sw.js`;
export const SW_SCOPE = import.meta.env.BASE_URL;

export interface RegisterOptions {
  /** Injected for tests. Defaults to `navigator.serviceWorker`. */
  readonly container?: ServiceWorkerContainer | undefined;
}

/**
 * Registers, and immediately asks the browser to re-check the script — trigger 1 of the five in
 * `11` §3. Never throws: a failed registration means no offline support, not a broken app.
 */
export async function registerServiceWorker(
  options: RegisterOptions = {},
): Promise<RegistrationOutcome> {
  const container = options.container ?? globalThis.navigator?.serviceWorker;
  if (container === undefined) return { status: 'unsupported' };

  try {
    const registration = await container.register(SW_URL, { scope: SW_SCOPE });
    // Trigger 1 — on every launch (`11` §3).
    void registration.update().catch(() => {
      // Offline at launch is the normal case, not an error worth surfacing.
    });
    return { status: 'registered', registration };
  } catch (error) {
    return { status: 'failed', error };
  }
}

/**
 * Unregisters every worker in our scope. Used by Repair (`11` §6) — and by nothing else, because
 * unregistering is how an app loses offline support.
 */
export async function unregisterOurWorkers(options: RegisterOptions = {}): Promise<number> {
  const container = options.container ?? globalThis.navigator?.serviceWorker;
  if (container === undefined) return 0;

  const registrations = await container.getRegistrations();
  const ours = registrations.filter((registration) => registration.scope.endsWith(SW_SCOPE));
  await Promise.all(ours.map((registration) => registration.unregister()));
  return ours.length;
}
