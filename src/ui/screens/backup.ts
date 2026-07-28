/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.16 — Roster and full-backup export/import with version checks and change preview
 * @story   US-12.1 — Back up and restore everything
 * @story   US-5.8 — Export and import my roster
 * @design  10-ui-ux.md §7 (screen map), §10 (states usually forgotten), §11 (accessibility)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the screen behind `#/settings/data`. Two exports, one import, and — the part US-12.1
 * actually turns on — a preview of what an import would change, with a confirmation before
 * anything is written.
 *
 * Everything downloads from an in-memory blob URL. There is no upload path and no server: a backup
 * never leaves the device unless the person carries it somewhere themselves, which is what makes
 * "never sends anything anywhere" true rather than aspirational.
 */
import {
  backupFilename,
  exportBackup,
  exportRoster,
  parseBackup,
  previewBackup,
  restoreBackup,
  serialiseBackup,
  type Backup,
  type BackupPreview,
  type RestoreMode,
} from '../../storage/backup.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { button } from '../components/button.ts';
import { errorState, skeleton } from '../components/states.ts';
import { toast } from '../components/feedback.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import './backup.css';

/** Hands a file to the browser's download machinery and releases the URL straight after. */
function download(doc: Document, filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el(doc, 'a', { attrs: { href: url, download: filename } });
  doc.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function backupScreen(): Screen {
  let pending: { backup: Backup; preview: BackupPreview } | null = null;
  let mode: RestoreMode = 'merge';

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      context.host.replaceChildren(skeleton(doc, { lines: 4 }));

      let db: Awaited<ReturnType<typeof appDatabase>>;
      try {
        db = await appDatabase();
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'Your data could not be opened',
            body: 'This build cannot read what is saved. Nothing has been changed or lost.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      const status = el(doc, 'p', {
        class: 'backup__status',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      const previewHost = el(doc, 'div', { class: 'backup__preview' });

      const renderPreview = (): void => {
        if (pending === null) {
          previewHost.replaceChildren();
          return;
        }

        const { preview } = pending;
        const rows = preview.changes.filter((c) => c.added + c.replaced > 0);

        previewHost.replaceChildren(
          el(doc, 'section', {
            class: 'backup__panel',
            children: [
              el(doc, 'h3', { text: 'What this would change' }),
              el(doc, 'p', {
                class: 'backup__summary',
                text: preview.noOp
                  ? 'Nothing — this backup matches what is already here.'
                  : `${preview.totalAdded} added, ${preview.totalReplaced} replaced, ${preview.totalUnchanged} unchanged.`,
              }),
              rows.length === 0
                ? null
                : el(doc, 'ul', {
                    class: 'backup__changes',
                    children: rows.map((change) =>
                      el(doc, 'li', {
                        text: `${change.store}: ${change.added} added, ${change.replaced} replaced${
                          change.notInBackup > 0
                            ? `, ${change.notInBackup} here but not in the backup`
                            : ''
                        }`,
                      }),
                    ),
                  }),
              el(doc, 'fieldset', {
                class: 'backup__mode',
                children: [
                  el(doc, 'legend', { text: 'How to apply it' }),
                  modeOption(
                    doc,
                    'merge',
                    'Merge — keep anything the backup does not mention',
                    mode,
                    (next) => {
                      mode = next;
                    },
                  ),
                  modeOption(
                    doc,
                    'replace',
                    'Replace — remove anything the backup does not mention',
                    mode,
                    (next) => {
                      mode = next;
                    },
                  ),
                ],
              }),
              el(doc, 'div', {
                class: 'backup__actions',
                children: [
                  button(doc, {
                    label: 'Restore this backup',
                    variant: 'primary',
                    onClick: () => {
                      const current = pending;
                      if (current === null) return;
                      void restoreBackup(db.db, current.backup, mode).then((applied) => {
                        pending = null;
                        renderPreview();
                        status.textContent = `Restored: ${applied.totalAdded} added, ${applied.totalReplaced} replaced.`;
                        context.host.appendChild(toast(doc, { message: 'Backup restored.' }));
                      });
                    },
                  }),
                  button(doc, {
                    label: 'Cancel',
                    variant: 'ghost',
                    onClick: () => {
                      pending = null;
                      renderPreview();
                      status.textContent = 'Import cancelled. Nothing was changed.';
                    },
                  }),
                ],
              }),
            ],
          }),
        );
      };

      const file = el(doc, 'input', {
        class: 'backup__file',
        attrs: { type: 'file', accept: '.json,application/json', id: 'backup-file' },
        on: {
          change: () => {
            const chosen = (file as HTMLInputElement).files?.[0];
            if (chosen === undefined) return;

            void chosen.text().then(async (text) => {
              const parsed = parseBackup(text);
              if ('problem' in parsed) {
                pending = null;
                renderPreview();
                status.textContent = parsed.problem.message;
                return;
              }

              pending = {
                backup: parsed.backup,
                preview: await previewBackup(db.db, parsed.backup),
              };
              status.textContent = 'Backup read. Nothing has been changed yet — review it below.';
              renderPreview();
            });
          },
        },
      });

      context.host.replaceChildren(
        el(doc, 'div', {
          class: 'backup',
          children: [
            el(doc, 'header', {
              children: [
                el(doc, 'h2', { text: 'Data & backup' }),
                el(doc, 'p', {
                  class: 'backup__lede',
                  text: 'Everything is stored on this device. A backup is a file you keep — nothing is ever uploaded.',
                }),
              ],
            }),

            el(doc, 'section', {
              class: 'backup__panel',
              children: [
                el(doc, 'h3', { text: 'Export' }),
                el(doc, 'div', {
                  class: 'backup__actions',
                  children: [
                    button(doc, {
                      label: 'Export everything',
                      variant: 'primary',
                      onClick: () => {
                        void exportBackup(db.db).then((backup) => {
                          download(doc, backupFilename(backup.createdAt), serialiseBackup(backup));
                          status.textContent = 'Backup downloaded.';
                        });
                      },
                    }),
                    button(doc, {
                      label: 'Export roster only',
                      variant: 'secondary',
                      onClick: () => {
                        void exportRoster(db.db).then((backup) => {
                          download(
                            doc,
                            backupFilename(backup.createdAt).replace('backup', 'roster'),
                            serialiseBackup(backup),
                          );
                          status.textContent = 'Roster downloaded.';
                        });
                      },
                    }),
                  ],
                }),
              ],
            }),

            el(doc, 'section', {
              class: 'backup__panel',
              children: [
                el(doc, 'h3', { text: 'Import' }),
                el(doc, 'p', {
                  class: 'backup__lede',
                  text: 'Importing shows you exactly what would change and asks before writing anything.',
                }),
                el(doc, 'label', { attrs: { for: 'backup-file' }, text: 'Choose a backup file' }),
                file,
              ],
            }),

            status,
            previewHost,
          ],
        }),
      );
    },
  };
}

function modeOption(
  doc: Document,
  value: RestoreMode,
  label: string,
  current: RestoreMode,
  onChange: (mode: RestoreMode) => void,
): HTMLElement {
  const input = el(doc, 'input', {
    attrs: {
      type: 'radio',
      name: 'restore-mode',
      value,
      id: `restore-${value}`,
      checked: value === current,
    },
    on: { change: () => onChange(value) },
  });

  return el(doc, 'label', {
    class: 'backup__mode-option',
    attrs: { for: `restore-${value}` },
    children: [input, el(doc, 'span', { text: label })],
  });
}
