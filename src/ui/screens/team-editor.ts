/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @story   US-6.1 — Build a team
 * @design  10-ui-ux.md §8.3 (the shape of a create flow), §11 (accessibility), 05-data-model.md §1
 *
 * Purpose: `#/squad/teams/new` and `#/squad/teams/:id` — the one screen behind both creating and
 * editing a team, the way `05` §1 describes it: "team identity, colours, crest." Which mode it's in
 * is read off whether the route handed it an id, not from two copies of the same form.
 *
 * Colours and crest are both real radio groups (`10` §11 — pickers are controls, not click targets
 * on a div), and the colour options are named rather than shown as bare swatches, because asking
 * someone to pick "the green one" is exactly what a colourblind-safe palette is supposed to avoid.
 * A live scoreboard preview keeps the crest and short name — the two things that actually tell two
 * teams apart — in view as both change.
 *
 * Editing a CPU team (`editable: false`) is refused outright rather than silently allowed: those
 * teams exist to keep a ladder balanced, and a quiet edit here would unbalance it without saying so.
 */
import { newId } from '../../athletes/create.ts';
import { appDatabase } from '../../storage/app-db.ts';
import {
  CREST_IDS,
  TEAM_BOUNDS,
  TEAM_PALETTES,
  isCrestId,
  type CrestId,
  type Team,
  type TeamColours,
} from '../../teams/types.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import { crest, crestLabel } from '../components/crest.ts';
import { button } from '../components/button.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import './teams.css';

/** Record schema version for a freshly created team. Migrations (`05` §9) own bumping this. */
const TEAM_SCHEMA_VERSION = 1;

function paletteMatching(colours: TeamColours): string | undefined {
  return TEAM_PALETTES.find(
    (palette) =>
      palette.colours.primary === colours.primary &&
      palette.colours.secondary === colours.secondary,
  )?.id;
}

export function teamEditorScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const id = context.params.id;
      const mode: 'create' | 'edit' = id === undefined ? 'create' : 'edit';

      context.host.replaceChildren(skeleton(doc, { lines: 5, label: 'Loading the team editor' }));

      let existing: Team | undefined;
      try {
        const { teams } = await appDatabase();
        if (id !== undefined) existing = await teams.get(id);
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'Could not open your teams',
            body: 'This build cannot read what is saved. Nothing has been changed or lost.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      if (mode === 'edit' && existing === undefined) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No such team',
            body: 'It may have been deleted, or the link may be out of date.',
            action: { label: 'Back to Teams', onSelect: () => context.navigate('/squad/teams') },
          }),
        );
        return;
      }

      if (existing !== undefined && !existing.editable) {
        context.host.replaceChildren(
          el(doc, 'div', {
            class: 'team-editor__refusal',
            children: [
              emptyState(doc, {
                heading: `${existing.name} can't be edited`,
                body:
                  'This is a CPU team, generated to keep matchups fair. Editing it here could ' +
                  'unbalance a ladder without anyone choosing that, so it stays as generated. Build ' +
                  'your own team instead if you want this matchup with different athletes.',
                action: {
                  label: 'Back to Teams',
                  onSelect: () => context.navigate('/squad/teams'),
                },
              }),
            ],
          }),
        );
        return;
      }

      // ── Form state ───────────────────────────────────────────────────────
      let name = existing?.name ?? '';
      let shortNameRaw = existing?.shortName ?? '';
      let colours: TeamColours = existing?.colours ?? TEAM_PALETTES[0]!.colours;
      let crestId: CrestId =
        existing !== undefined && isCrestId(existing.crestId) ? existing.crestId : CREST_IDS[0];
      let selectedPaletteId = paletteMatching(colours) ?? TEAM_PALETTES[0]!.id;

      const previewHost = el(doc, 'div', { class: 'team-editor__preview' });
      const crestPickerHost = el(doc, 'div', { class: 'crest-picker__grid' });

      function renderPreview(): void {
        const label = shortNameRaw.trim().toUpperCase();
        previewHost.replaceChildren(
          el(doc, 'div', {
            class: 'team-editor__scoreboard',
            children: [
              crest(doc, {
                crestId,
                colours,
                size: 64,
                label: `${name.trim() === '' ? 'New team' : name} crest, ${crestId}`,
              }),
              el(doc, 'span', { class: 'team-editor__scoreboard-short', text: label || '––' }),
            ],
          }),
        );
      }

      function renderCrestPicker(): void {
        crestPickerHost.replaceChildren(
          ...CREST_IDS.map((option) => {
            const input = el(doc, 'input', {
              class: 'crest-option__input',
              attrs: {
                type: 'radio',
                name: 'team-editor-crest',
                value: option,
                checked: option === crestId,
              },
            }) as HTMLInputElement;
            input.addEventListener('change', () => {
              crestId = option;
              renderPreview();
            });
            return el(doc, 'label', {
              class: 'crest-option',
              children: [
                input,
                crest(doc, { crestId: option, colours, size: 40, label: crestLabel(option) }),
                el(doc, 'span', { class: 'crest-option__name', text: crestLabel(option) }),
              ],
            });
          }),
        );
      }

      // ── Name and short name ──────────────────────────────────────────────
      const nameInput = el(doc, 'input', {
        class: 'text-input',
        attrs: {
          type: 'text',
          id: 'team-editor-name',
          maxlength: TEAM_BOUNDS.maxNameLength,
          placeholder: 'New team',
          autocomplete: 'off',
          value: name,
        },
      }) as HTMLInputElement;
      nameInput.addEventListener('input', () => {
        name = nameInput.value;
        renderPreview();
      });

      const shortNameInput = el(doc, 'input', {
        class: 'text-input',
        attrs: {
          type: 'text',
          id: 'team-editor-short-name',
          maxlength: TEAM_BOUNDS.shortName.max,
          placeholder: 'e.g. RVR',
          autocomplete: 'off',
          value: shortNameRaw,
        },
      }) as HTMLInputElement;
      const shortNameError = el(doc, 'p', {
        class: 'panel__note panel__note--strong',
        attrs: { role: 'alert' },
      });
      shortNameInput.addEventListener('input', () => {
        shortNameRaw = shortNameInput.value;
        shortNameError.textContent = '';
        renderPreview();
      });

      const identityField = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Name' }),
          el(doc, 'div', {
            class: 'team-editor__field',
            children: [
              el(doc, 'label', { text: 'Team name', attrs: { for: 'team-editor-name' } }),
              nameInput,
            ],
          }),
          el(doc, 'div', {
            class: 'team-editor__field',
            children: [
              el(doc, 'label', {
                text: 'Short name (2–4 letters, for the scoreboard)',
                attrs: { for: 'team-editor-short-name' },
              }),
              shortNameInput,
            ],
          }),
          shortNameError,
        ],
      });

      // ── Colours — named palettes, never a bare swatch (`10` §11) ────────
      const paletteField = el(doc, 'fieldset', {
        class: 'palette-picker panel',
        children: [
          el(doc, 'legend', { class: 'panel__title', text: 'Colours' }),
          el(doc, 'div', {
            class: 'palette-picker__grid',
            children: TEAM_PALETTES.map((palette) => {
              const input = el(doc, 'input', {
                class: 'palette-option__input',
                attrs: {
                  type: 'radio',
                  name: 'team-editor-palette',
                  value: palette.id,
                  checked: palette.id === selectedPaletteId,
                },
              }) as HTMLInputElement;
              input.addEventListener('change', () => {
                selectedPaletteId = palette.id;
                colours = palette.colours;
                renderPreview();
                renderCrestPicker();
              });
              const swatch = el(doc, 'span', {
                class: 'palette-option__swatch',
                attrs: { 'aria-hidden': 'true' },
                children: [
                  el(doc, 'span', { class: 'palette-option__swatch-half' }),
                  el(doc, 'span', { class: 'palette-option__swatch-half' }),
                ],
              });
              swatch.style.setProperty('--swatch-primary', palette.colours.primary);
              swatch.style.setProperty('--swatch-secondary', palette.colours.secondary);
              return el(doc, 'label', {
                class: 'palette-option',
                children: [
                  input,
                  swatch,
                  el(doc, 'span', { class: 'palette-option__name', text: palette.name }),
                ],
              });
            }),
          }),
        ],
      });

      // ── Crest — every shape rendered live, in the chosen colours ────────
      const crestField = el(doc, 'fieldset', {
        class: 'crest-picker panel',
        children: [el(doc, 'legend', { class: 'panel__title', text: 'Crest' }), crestPickerHost],
      });

      // ── Save ─────────────────────────────────────────────────────────────
      const saveStatus = el(doc, 'p', { class: 'panel__note', attrs: { role: 'status' } });

      async function handleSave(): Promise<void> {
        const trimmedShort = shortNameRaw.trim().toUpperCase();
        if (
          trimmedShort.length < TEAM_BOUNDS.shortName.min ||
          trimmedShort.length > TEAM_BOUNDS.shortName.max
        ) {
          shortNameError.textContent =
            `Short name needs ${TEAM_BOUNDS.shortName.min} to ${TEAM_BOUNDS.shortName.max} ` +
            'letters — it is how teams stay tellable apart without relying on colour.';
          return;
        }

        const team: Team = {
          id: existing?.id ?? newId(),
          schemaVersion: existing?.schemaVersion ?? TEAM_SCHEMA_VERSION,
          name: name.trim() === '' ? 'New team' : name.trim(),
          shortName: trimmedShort,
          colours,
          crestId,
          createdAt: existing?.createdAt ?? Date.now(),
          editable: true,
        };

        saveStatus.textContent = 'Saving…';
        try {
          const { teams } = await appDatabase();
          await teams.put(team);
        } catch {
          saveStatus.textContent = 'Could not save — this build cannot write to storage right now.';
          return;
        }

        saveStatus.textContent = `${team.name} saved.`;
        context.navigate('/squad/teams');
      }

      const saveField = el(doc, 'section', {
        class: 'panel',
        children: [
          button(doc, {
            label: mode === 'create' ? 'Create team' : 'Save team',
            variant: 'primary',
            size: 'large',
            onClick: () => void handleSave(),
          }),
          saveStatus,
        ],
      });

      renderPreview();
      renderCrestPicker();

      context.host.replaceChildren(
        el(doc, 'div', {
          class: 'team-editor',
          children: [
            previewHost,
            el(doc, 'div', {
              class: 'team-editor__form stack',
              children: [identityField, paletteField, crestField, saveField],
            }),
          ],
        }),
      );
    },
  };
}
