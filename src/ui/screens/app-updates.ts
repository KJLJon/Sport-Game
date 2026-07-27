/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.9 — Offline-readiness UI, T-0.10 — Repair, "check for update now", version display
 * @story   US-1.8 — Keeps working offline, US-1.9 — A way out when the app gets stuck
 * @design  11-pwa-lifecycle.md §4, §5.3, §6; 10-ui-ux.md §7, §9 (copy tone)
 *
 * Purpose: Settings → App & updates. `11` §4 requires "am I actually on the new one?" to be
 * answerable at any time, so the running version, build hash, build date, and last check are all
 * displayed. Repair states plainly what it will not touch, because otherwise nobody presses it.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import { button } from '../components/button.ts';
import { switchControl } from '../components/controls.ts';
import { pwaRuntime } from '../../pwa/boot.ts';
import { describeReadiness } from '../../pwa/integrity.ts';
import { REPAIR_PROMISE, repair } from '../../pwa/repair.ts';
import { describeAge } from '../../pwa/version.ts';

function row(doc: Document, label: string, value: string): HTMLElement {
  return el(doc, 'div', {
    class: 'kv-row',
    children: [
      el(doc, 'span', { class: 'kv-row__label', text: label }),
      el(doc, 'span', { class: 'kv-row__value', text: value }),
    ],
  });
}

export function appUpdatesScreen(): Screen {
  let unsubscribe: (() => void) | null = null;

  return {
    mount({ host }: ScreenContext): void {
      const doc = host.ownerDocument;
      const runtime = pwaRuntime();

      const versionBlock = el(doc, 'section', { class: 'panel' });
      const readinessBlock = el(doc, 'section', { class: 'panel' });
      const checkResult = el(doc, 'p', { class: 'panel__note', attrs: { role: 'status' } });

      const renderVersion = (): void => {
        const deployed = runtime?.detector.status.deployed ?? null;
        const lastChecked = runtime?.detector.status.lastCheckedAt ?? null;

        versionBlock.replaceChildren(
          el(doc, 'h2', { class: 'panel__title', text: 'Version' }),
          row(doc, 'Running', runtime?.runningVersion ?? 'unknown'),
          row(doc, 'Build', runtime?.runningBuild ?? 'unknown'),
          row(doc, 'Built', deployed ? describeAge(deployed.builtAt) : 'unknown'),
          row(
            doc,
            'Last checked',
            lastChecked === null ? 'not yet' : describeAge(new Date(lastChecked).toISOString()),
          ),
        );
      };

      const renderReadiness = (): void => {
        readinessBlock.replaceChildren(
          el(doc, 'h2', { class: 'panel__title', text: 'Offline' }),
          el(doc, 'p', {
            class: 'panel__note',
            text: describeReadiness(runtime?.readiness() ?? { kind: 'unknown' }),
          }),
          button(doc, {
            label: 'Download everything for offline',
            variant: 'secondary',
            onClick: () => {
              void runtime?.integrity.downloadEverything().then(() => {
                void runtime.refreshReadiness().then(renderReadiness);
              });
            },
          }),
        );
      };

      const checkNow = button(doc, {
        label: 'Check for update now',
        variant: 'secondary',
        onClick: () => {
          checkResult.textContent = 'Checking…';
          void runtime?.detector.check().then((status) => {
            checkResult.textContent =
              status.state.kind === 'ready'
                ? 'An update is ready to install.'
                : status.state.kind === 'stuck'
                  ? 'A newer version is deployed but will not install. Try Repair below.'
                  : "You're on the latest version.";
            renderVersion();
          });
        },
      });

      const autoUpdate = switchControl(doc, {
        label: 'Auto-update',
        description: 'Applies updates when you are not mid-match, mid-edit, or opening a pack.',
        checked: runtime?.controller.autoUpdate ?? true,
        onChange: (checked) => runtime?.controller.setAutoUpdate(checked),
      });

      const repairBlock = el(doc, 'section', {
        class: 'panel panel--danger',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Repair app' }),
          el(doc, 'p', {
            class: 'panel__note',
            text: 'Clears the cached game files and reinstalls them from scratch. Fixes an app that will not update or will not load.',
          }),
          // Said in full, verbatim, because it is the only reason anyone presses this (`11` §6).
          el(doc, 'p', { class: 'panel__note panel__note--strong', text: REPAIR_PROMISE }),
          button(doc, {
            label: 'Repair app',
            variant: 'destructive',
            onClick: () => void repair(),
          }),
        ],
      });

      renderVersion();
      renderReadiness();

      host.replaceChildren(
        el(doc, 'div', {
          class: 'stack',
          children: [
            versionBlock,
            el(doc, 'section', {
              class: 'panel',
              children: [
                el(doc, 'h2', { class: 'panel__title', text: 'Updates' }),
                autoUpdate,
                checkNow,
                checkResult,
              ],
            }),
            readinessBlock,
            repairBlock,
          ],
        }),
      );

      unsubscribe = runtime?.detector.subscribe(renderVersion) ?? null;
    },

    unmount(): void {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
