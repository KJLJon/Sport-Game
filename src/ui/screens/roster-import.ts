/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.15 — Roster import: file + URL, schema validation, per-record errors, merge/conflict,
 *          responsibility notice
 * @story   US-5.7 — Import a roster file
 * @design  10-ui-ux.md §7 (screen map — "Squad ▸ Import / Export"), §10 (states usually forgotten),
 *          §11 (accessibility), 05-data-model.md §8 (roster import schema)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: `#/squad/import` — pick a roster file or type a URL, see exactly what will be imported
 * and what is wrong with it before anything is written, resolve any conflicts with the existing
 * roster, and confirm. All the validation is `../../athletes/roster-import.ts`'s job; this file
 * only wires that to the file/URL pickers, the preview, and the write.
 *
 * Nothing reaches `AthleteRepository` until the player presses "Import" on the preview — a parsed
 * file is just data sitting in memory until then, so a bad file or a change of mind costs nothing.
 */
import {
  classifyImports,
  mergeRoster,
  parseRosterFile,
  type ClassifiedImport,
  type ConflictResolution,
  type ImportIssue,
  type ImportResult,
} from '../../athletes/roster-import.ts';
import type { Athlete } from '../../athletes/types.ts';
import { appDatabase, type AppDatabase } from '../../storage/app-db.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { button } from '../components/button.ts';
import { segmented } from '../components/controls.ts';
import { errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import './roster-import.css';

const CONFLICT_OPTIONS: ReadonlyArray<{ value: ConflictResolution; label: string }> = [
  { value: 'skip', label: 'Skip' },
  { value: 'replace', label: 'Replace' },
  { value: 'keep-both', label: 'Import as new' },
];

/** Reads a picked `File` as text. `FileReader` rather than `File.text()` — the latter is missing
 * from some in-scope WebViews this app still targets. */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

/**
 * Fetches a user-typed URL. This app makes no runtime network requests outside optional P2P STUN
 * (CLAUDE.md §8.2) — a player fetching a URL they themselves typed, on demand, is the one
 * permitted exception the rule already carves out, not a new one. `fetch` rejecting covers a bad
 * address, being offline, and a CORS-blocked response alike, so the message below names all three
 * rather than guessing which one happened.
 */
async function fetchRosterUrl(url: string): Promise<{ text: string } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return {
      error:
        'Could not reach that URL. Check the address, your connection, or whether that ' +
        'server allows this app to read it.',
    };
  }
  if (!response.ok) {
    return { error: `That URL responded with an error (HTTP ${response.status}).` };
  }
  try {
    return { text: await response.text() };
  } catch {
    return { error: 'That URL did not return readable text.' };
  }
}

function issueList(doc: Document, issues: readonly ImportIssue[]): HTMLElement | null {
  if (issues.length === 0) return null;
  return el(doc, 'ul', {
    class: 'roster-import__issues',
    children: issues.map((issue) =>
      el(doc, 'li', {
        class: 'roster-import__issue',
        dataset: { severity: issue.severity },
        children: [
          // The severity word carries the meaning; the colour (`roster-import.css`) only echoes
          // it — `10` §11 rules out colour as the only signal.
          el(doc, 'span', {
            class: 'roster-import__issue-severity',
            text: issue.severity === 'error' ? 'Error' : 'Warning',
          }),
          el(doc, 'span', {
            class: 'roster-import__issue-message',
            text: issue.record === 0 ? issue.message : `Record ${issue.record}: ${issue.message}`,
          }),
        ],
      }),
    ),
  });
}

export function rosterImportScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;

      let db: AppDatabase;
      try {
        db = await appDatabase();
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'The roster could not be opened',
            body: 'This build cannot read what is saved, so an import cannot be checked for conflicts.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      // ── Screen state ─────────────────────────────────────────────────────
      let parsed: ImportResult | null = null;
      let classified: ClassifiedImport[] = [];
      const resolutions = new Map<string, ConflictResolution>();
      let pickerBusy = false;
      let writeStatus: 'idle' | 'writing' | 'done' = 'idle';
      let writtenCount = 0;

      const noticeSection = el(doc, 'section', {
        class: 'panel roster-import__notice',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Before you import' }),
          el(doc, 'p', {
            class: 'panel__note panel__note--strong',
            text:
              'Imported content is your responsibility. This app ships no roster files and does ' +
              'not link to any — only import files you trust the source of.',
          }),
        ],
      });

      // ── File picker ──────────────────────────────────────────────────────
      const fileInput = el(doc, 'input', {
        class: 'sr-only',
        attrs: { type: 'file', accept: '.json,application/json', id: 'roster-import-file' },
      }) as HTMLInputElement;

      const fileStatus = el(doc, 'p', { class: 'panel__note', attrs: { role: 'status' } });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file !== undefined) void handleFile(file);
      });

      async function handleFile(file: File): Promise<void> {
        pickerBusy = true;
        fileStatus.textContent = `Reading ${file.name}…`;
        try {
          const text = await readFileAsText(file);
          await handleParsed(text);
        } catch {
          fileStatus.textContent = 'Could not read that file. Try a different one.';
        } finally {
          pickerBusy = false;
          fileInput.value = '';
          render();
        }
      }

      const fileSection = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Import from a file' }),
          button(doc, {
            label: 'Choose file…',
            variant: 'secondary',
            onClick: () => fileInput.click(),
          }),
          fileInput,
          fileStatus,
        ],
      });

      // ── URL picker ───────────────────────────────────────────────────────
      const urlInput = el(doc, 'input', {
        class: 'text-input',
        attrs: {
          type: 'url',
          id: 'roster-import-url',
          placeholder: 'https://example.com/my-roster.json',
          autocomplete: 'off',
          inputmode: 'url',
        },
      }) as HTMLInputElement;

      const urlStatus = el(doc, 'p', { class: 'panel__note', attrs: { role: 'status' } });

      const urlButton = button(doc, {
        label: 'Fetch',
        variant: 'secondary',
        onClick: () => void handleUrl(),
      });

      async function handleUrl(): Promise<void> {
        const url = urlInput.value.trim();
        if (url === '') {
          urlStatus.textContent = 'Type a URL first.';
          return;
        }
        pickerBusy = true;
        urlStatus.textContent = 'Fetching…';
        render();

        const outcome = await fetchRosterUrl(url);
        if ('error' in outcome) {
          urlStatus.textContent = outcome.error;
        } else {
          urlStatus.textContent = '';
          await handleParsed(outcome.text);
        }
        pickerBusy = false;
        render();
      }

      const urlSection = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Import from a URL' }),
          el(doc, 'div', {
            class: 'roster-import__url-row',
            children: [
              el(doc, 'label', {
                class: 'sr-only',
                text: 'Roster file URL',
                attrs: { for: 'roster-import-url' },
              }),
              urlInput,
              urlButton,
            ],
          }),
          urlStatus,
        ],
      });

      // ── Parse + classify ─────────────────────────────────────────────────
      async function handleParsed(text: string): Promise<void> {
        writeStatus = 'idle';
        resolutions.clear();
        parsed = parseRosterFile(text);
        if (parsed.athletes.length === 0) {
          classified = [];
          return;
        }
        const existing = await db.athletes.getAll();
        classified = classifyImports(parsed.athletes, existing);
        for (const entry of classified) {
          if (entry.classification === 'conflict') resolutions.set(entry.athlete.id, 'skip');
        }
      }

      function acceptedToWrite(): Athlete[] {
        return mergeRoster(classified, resolutions);
      }

      // ── Preview ──────────────────────────────────────────────────────────
      const previewHost = el(doc, 'div', { class: 'roster-import__preview' });

      function conflictRow(entry: ClassifiedImport, index: number): HTMLElement {
        const existingName = entry.conflictsWith?.displayName ?? 'an existing athlete';
        const reason =
          entry.reason === 'custodyId' ? 'same custody id as' : 'same name and primary sport as';

        return el(doc, 'li', {
          class: 'roster-import__conflict',
          children: [
            el(doc, 'p', {
              class: 'roster-import__conflict-label',
              text: `${entry.athlete.displayName} — ${reason} ${existingName}.`,
            }),
            segmented(doc, {
              legend: `What to do with ${entry.athlete.displayName}`,
              name: `roster-import-conflict-${index}`,
              options: CONFLICT_OPTIONS,
              value: resolutions.get(entry.athlete.id) ?? 'skip',
              onChange: (value) => {
                resolutions.set(entry.athlete.id, value);
                renderSummary();
              },
            }),
          ],
        });
      }

      const summaryHost = el(doc, 'div', { class: 'roster-import__summary' });
      const importButton = button(doc, {
        label: 'Import',
        variant: 'primary',
        onClick: () => void handleConfirm(),
      });

      function renderSummary(): void {
        if (parsed === null) {
          summaryHost.replaceChildren();
          return;
        }
        const toWrite = acceptedToWrite();
        const newCount = classified.filter((c) => c.classification === 'new').length;
        const conflictCount = classified.length - newCount;

        summaryHost.replaceChildren(
          el(doc, 'p', {
            class: 'roster-import__summary-line',
            attrs: { role: 'status' },
            text:
              `${parsed.accepted} record${parsed.accepted === 1 ? '' : 's'} parsed ` +
              `(${newCount} new, ${conflictCount} conflicting)` +
              (parsed.rejected > 0
                ? `, ${parsed.rejected} rejected — see the issues below.`
                : '.') +
              ` ${toWrite.length} will be written if you import now.`,
          }),
        );
        importButton.toggleAttribute('disabled', toWrite.length === 0 || writeStatus === 'writing');
      }

      async function handleConfirm(): Promise<void> {
        if (parsed === null) return;
        const toWrite = acceptedToWrite();
        if (toWrite.length === 0) return;

        writeStatus = 'writing';
        renderPreview();
        try {
          await db.athletes.putMany(toWrite);
        } catch {
          writeStatus = 'idle';
          renderPreview();
          summaryHost.appendChild(
            el(doc, 'p', {
              class: 'panel__note panel__note--strong',
              attrs: { role: 'alert' },
              text: 'Could not save — this build cannot write to storage right now.',
            }),
          );
          return;
        }

        writtenCount = toWrite.length;
        writeStatus = 'done';
        parsed = null;
        classified = [];
        resolutions.clear();
        render();
      }

      function renderPreview(): void {
        if (writeStatus === 'done') {
          previewHost.replaceChildren(
            el(doc, 'section', {
              class: 'panel',
              attrs: { role: 'status' },
              children: [
                el(doc, 'h2', { class: 'panel__title', text: 'Import complete' }),
                el(doc, 'p', {
                  class: 'panel__note',
                  text: `${writtenCount} athlete${writtenCount === 1 ? '' : 's'} added to your roster.`,
                }),
                button(doc, {
                  label: 'Go to your squad',
                  variant: 'primary',
                  onClick: () => context.navigate('/squad'),
                }),
              ],
            }),
          );
          return;
        }

        if (parsed === null) {
          previewHost.replaceChildren();
          return;
        }

        const fileError = parsed.issues.find((issue) => issue.record === 0);
        if (fileError !== undefined && parsed.athletes.length === 0) {
          previewHost.replaceChildren(
            errorState(doc, {
              heading: 'That file could not be imported',
              body: fileError.message,
            }),
          );
          return;
        }

        const conflicts = classified.filter((entry) => entry.classification === 'conflict');
        const children: HTMLElement[] = [el(doc, 'h2', { class: 'panel__title', text: 'Preview' })];
        if (parsed.rosterName !== undefined) {
          children.push(
            el(doc, 'p', { class: 'panel__note', text: `From: "${parsed.rosterName}"` }),
          );
        }
        children.push(summaryHost);

        const issues = issueList(doc, parsed.issues);
        if (issues !== null) children.push(issues);

        if (conflicts.length > 0) {
          children.push(
            el(doc, 'h3', { class: 'roster-import__section-heading', text: 'Resolve conflicts' }),
            el(doc, 'ul', {
              class: 'roster-import__conflicts',
              children: conflicts.map((entry, index) => conflictRow(entry, index)),
            }),
          );
        }

        children.push(importButton);

        previewHost.replaceChildren(el(doc, 'section', { class: 'panel', children }));
        renderSummary();
      }

      // ── Layout ───────────────────────────────────────────────────────────
      function render(): void {
        urlButton.toggleAttribute('disabled', pickerBusy);
        renderPreview();
      }

      context.host.replaceChildren(
        el(doc, 'div', {
          class: 'roster-import stack',
          children: [
            el(doc, 'header', {
              class: 'roster-import__header',
              children: [el(doc, 'h1', { class: 'roster-import__title', text: 'Import a roster' })],
            }),
            noticeSection,
            fileSection,
            urlSection,
            previewHost,
          ],
        }),
      );

      render();
    },
  };
}
