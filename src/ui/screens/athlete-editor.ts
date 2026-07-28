/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @story   US-5.1 — Create an athlete profile
 * @design  10-ui-ux.md §8.3 (create-an-athlete flow), §5 (component inventory), §11 (accessibility),
 *          05-data-model.md §2 (athlete fields), §2.1 (attributes, creation budget, sandbox)
 * @invariant INV-14 (no network — the photo path never leaves the device)
 *
 * Purpose: `#/squad/athlete/new`, the screen behind "Make your own athlete" (`10` §8.1, §8.3). It
 * walks name → photo → primary sport → physicals → attributes, with a live preview that rebuilds
 * on every change — the same `athleteCardFull` the roster uses, so what this screen shows is never
 * a lookalike of the real card. Nothing is mandatory except a name, and even a blank one is fine:
 * `createAthlete` supplies a placeholder rather than blocking the save.
 *
 * The three attribute paths — presets, sliders, roll — all funnel through one piece of state and
 * one `AttributeSlidersHandle`, so the budget meter is always looking at what Save would actually
 * see. Going over budget is never treated as an error to block: `05` §2.1 keeps the "make Messi"
 * fantasy available through Sandbox mode, so a refusal here offers the way past it rather than
 * discarding what the player built.
 */
import { createRng, randomSeed } from '../../engine/rng.ts';
import { judgeCreation, rollWithinBudget } from '../../athletes/attributes.ts';
import { createAthlete } from '../../athletes/create.ts';
import { downscalePortrait } from '../../athletes/portrait.ts';
import { ATTRIBUTE_PRESETS, type AttributePreset } from '../../athletes/presets.ts';
import { CREATION_DEFAULTS } from '../../athletes/tuning.ts';
import {
  ATHLETE_BOUNDS,
  ATTRIBUTE_IDS,
  type Athlete,
  type AttributeId,
  type Attributes,
  type Handedness,
} from '../../athletes/types.ts';
import { RATEABLE_SPORTS, sportsForAthlete } from '../../sports/catalogue.ts';
import type { SportId } from '../../sports/types.ts';
import { appDatabase } from '../../storage/app-db.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import { athleteCardFull } from '../components/athlete-card.ts';
import { attributeSliders, type AttributeSlidersHandle } from '../components/attribute-sliders.ts';
import { button } from '../components/button.ts';
import { segmented, switchControl } from '../components/controls.ts';
import '../components/athlete-card.css';
import './athlete-editor.css';

const HANDEDNESS_OPTIONS: ReadonlyArray<{ value: Handedness; label: string }> = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'both', label: 'Both' },
];

function defaultAttributes(): Attributes {
  const result = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) result[id] = CREATION_DEFAULTS.attribute;
  return result;
}

export function athleteEditorScreen(): Screen {
  let objectUrl: string | null = null;

  return {
    mount(context: ScreenContext): void {
      const doc = context.host.ownerDocument;

      // ── Form state ───────────────────────────────────────────────────────
      let displayName = '';
      let primarySport: SportId = RATEABLE_SPORTS[0]?.id ?? 'basketball';
      let heightCm = CREATION_DEFAULTS.heightCm;
      let weightKg = CREATION_DEFAULTS.weightKg;
      let age = CREATION_DEFAULTS.age;
      let handedness: Handedness = CREATION_DEFAULTS.handedness as Handedness;
      let attributes: Attributes = defaultAttributes();
      let sandboxMode = false;
      let portraitBlob: Blob | null = null;

      // ── Live preview (`10` §8.3 — "a live preview card updates as you go") ──
      const previewHost = el(doc, 'div', { class: 'athlete-editor__preview' });

      function buildDraftAthlete(): Athlete {
        const verdict = judgeCreation(attributes, sandboxMode);
        return createAthlete({
          displayName,
          primarySport,
          attributes,
          heightCm,
          weightKg,
          age,
          handedness,
          sandbox: verdict.sandbox,
          id: 'draft',
          custodyId: 'draft',
          createdAt: 0,
        });
      }

      function renderPreview(): void {
        const draft = buildDraftAthlete();
        const sports = sportsForAthlete(primarySport);
        previewHost.replaceChildren(
          athleteCardFull(doc, {
            athlete: draft,
            sports: sports.length === 0 ? RATEABLE_SPORTS : sports,
          }),
        );
      }

      // ── Name ─────────────────────────────────────────────────────────────
      const nameInput = el(doc, 'input', {
        class: 'text-input',
        attrs: {
          type: 'text',
          id: 'athlete-editor-name',
          maxlength: ATHLETE_BOUNDS.maxNameLength,
          placeholder: 'Unnamed athlete',
          autocomplete: 'off',
        },
      }) as HTMLInputElement;
      nameInput.addEventListener('input', () => {
        displayName = nameInput.value;
        renderPreview();
      });

      const nameField = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Name' }),
          el(doc, 'label', {
            class: 'sr-only',
            text: 'Athlete name',
            attrs: { for: 'athlete-editor-name' },
          }),
          nameInput,
        ],
      });

      // ── Photo (`10` §8.3 — "camera / library / skip") ───────────────────
      const photoPreview = el(doc, 'img', {
        class: 'athlete-editor__photo-preview',
        attrs: { alt: '', hidden: true },
      }) as HTMLImageElement;

      const photoStatus = el(doc, 'p', {
        class: 'panel__note',
        text: 'No photo yet. Stored on this device only — never uploaded.',
      });

      const removePhotoButton = button(doc, {
        label: 'Remove photo',
        variant: 'ghost',
        onClick: () => clearPhoto(),
      });
      removePhotoButton.hidden = true;

      const fileInput = el(doc, 'input', {
        class: 'sr-only',
        attrs: {
          type: 'file',
          accept: 'image/*',
          capture: 'environment',
          id: 'athlete-editor-photo',
        },
      }) as HTMLInputElement;

      function clearObjectUrl(): void {
        if (objectUrl !== null) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      }

      function clearPhoto(): void {
        clearObjectUrl();
        portraitBlob = null;
        photoPreview.hidden = true;
        photoPreview.removeAttribute('src');
        photoStatus.textContent = 'No photo yet. Stored on this device only — never uploaded.';
        removePhotoButton.hidden = true;
        fileInput.value = '';
      }

      function setPhoto(blob: Blob): void {
        clearObjectUrl();
        portraitBlob = blob;
        objectUrl = URL.createObjectURL(blob);
        photoPreview.src = objectUrl;
        photoPreview.hidden = false;
        photoStatus.textContent = 'Photo set. Stored on this device only — never uploaded.';
        removePhotoButton.hidden = false;
      }

      async function handlePhotoFile(file: File): Promise<void> {
        photoStatus.textContent = 'Processing photo…';
        try {
          const downscaled = await downscalePortrait(file);
          setPhoto(downscaled);
        } catch {
          photoStatus.textContent = 'Could not read that photo. Try a different one, or skip.';
        }
      }

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file !== undefined) void handlePhotoFile(file);
      });

      const photoField = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Photo' }),
          photoPreview,
          el(doc, 'div', {
            class: 'athlete-editor__photo-actions',
            children: [
              button(doc, {
                label: 'Add photo',
                variant: 'secondary',
                onClick: () => fileInput.click(),
              }),
              removePhotoButton,
            ],
          }),
          fileInput,
          photoStatus,
        ],
      });

      // ── Primary sport ────────────────────────────────────────────────────
      const sportField = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Primary sport' }),
          segmented(doc, {
            legend: 'Primary sport',
            name: 'athlete-editor-sport',
            options: RATEABLE_SPORTS.map((sport) => ({
              value: sport.id,
              label: sport.displayName,
            })),
            value: primarySport,
            onChange: (value) => {
              primarySport = value;
              renderPreview();
            },
          }),
        ],
      });

      // ── Physicals ────────────────────────────────────────────────────────
      function numberField(
        label: string,
        id: string,
        value: number,
        bounds: { readonly min: number; readonly max: number },
        onChange: (next: number) => void,
      ): HTMLElement {
        const input = el(doc, 'input', {
          class: 'text-input',
          attrs: { type: 'number', id, min: bounds.min, max: bounds.max, step: 1, value },
        }) as HTMLInputElement;
        input.addEventListener('input', () => {
          const next = Number(input.value);
          if (Number.isFinite(next)) {
            onChange(next);
            renderPreview();
          }
        });
        return el(doc, 'div', {
          class: 'field',
          children: [el(doc, 'label', { text: label, attrs: { for: id } }), input],
        });
      }

      const physicalsField = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Physicals' }),
          el(doc, 'div', {
            class: 'athlete-editor__physicals-grid',
            children: [
              numberField(
                'Height (cm)',
                'athlete-editor-height',
                heightCm,
                ATHLETE_BOUNDS.heightCm,
                (v) => (heightCm = v),
              ),
              numberField(
                'Weight (kg)',
                'athlete-editor-weight',
                weightKg,
                ATHLETE_BOUNDS.weightKg,
                (v) => (weightKg = v),
              ),
              numberField('Age', 'athlete-editor-age', age, ATHLETE_BOUNDS.age, (v) => (age = v)),
            ],
          }),
          segmented(doc, {
            legend: 'Handedness',
            name: 'athlete-editor-handedness',
            options: HANDEDNESS_OPTIONS,
            value: handedness,
            onChange: (value) => {
              handedness = value;
              renderPreview();
            },
          }),
        ],
      });

      // ── Attributes: presets, sliders, roll (`10` §8.3) ──────────────────
      function presetCard(preset: AttributePreset): HTMLElement {
        return el(doc, 'button', {
          class: 'attribute-preset',
          attrs: {
            type: 'button',
            'aria-label': `${preset.label} preset — ${preset.description}`,
          },
          children: [
            el(doc, 'span', { class: 'attribute-preset__label', text: preset.label }),
            el(doc, 'span', { class: 'attribute-preset__description', text: preset.description }),
          ],
          on: {
            click: () => {
              attributes = { ...preset.attributes };
              slidersHandle.setAttributes(attributes);
            },
          },
        });
      }

      const slidersHandle: AttributeSlidersHandle = attributeSliders(doc, {
        initial: attributes,
        onChange: (next) => {
          attributes = next;
          renderPreview();
          renderSandboxNotice();
        },
      });

      const rollButton = button(doc, {
        label: 'Roll',
        variant: 'secondary',
        onClick: () => {
          const rolled = rollWithinBudget(createRng(randomSeed()));
          attributes = rolled;
          slidersHandle.setAttributes(rolled);
        },
      });

      const sandboxSwitch = switchControl(doc, {
        label: 'Sandbox mode',
        description:
          'Lets this athlete go over the point budget. Sandbox athletes are playable in ' +
          'exhibitions but excluded from tournaments, fairness achievements, and P2P unless the ' +
          'peer opts in.',
        checked: sandboxMode,
        onChange: (checked) => {
          sandboxMode = checked;
          renderPreview();
          renderSandboxNotice();
        },
      });

      function syncSandboxSwitch(): void {
        const input = sandboxSwitch.querySelector<HTMLInputElement>('.switch__input');
        if (input === null) return;
        input.checked = sandboxMode;
        input.setAttribute('aria-checked', sandboxMode ? 'true' : 'false');
      }

      const sandboxNotice = el(doc, 'div', { class: 'athlete-editor__sandbox-notice' });

      function renderSandboxNotice(): void {
        const verdict = judgeCreation(attributes, sandboxMode);
        if (verdict.allowed) {
          sandboxNotice.replaceChildren();
          return;
        }
        sandboxNotice.replaceChildren(
          el(doc, 'p', {
            class: 'panel__note panel__note--strong',
            attrs: { role: 'status' },
            text: verdict.reason ?? 'This spread needs Sandbox mode to save.',
          }),
          button(doc, {
            label: 'Turn on Sandbox mode and save',
            variant: 'secondary',
            onClick: () => {
              sandboxMode = true;
              syncSandboxSwitch();
              void handleSave();
            },
          }),
        );
      }

      const attributesField = el(doc, 'section', {
        class: 'panel',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Attributes' }),
          el(doc, 'p', {
            class: 'panel__note',
            text: 'Tap a preset, drag the sliders, or roll — whichever gets you there.',
          }),
          el(doc, 'h3', { class: 'attribute-presets__heading', text: 'Presets' }),
          el(doc, 'div', {
            class: 'attribute-presets',
            children: ATTRIBUTE_PRESETS.map((preset) => presetCard(preset)),
          }),
          el(doc, 'h3', { class: 'attribute-presets__heading', text: 'Sliders' }),
          slidersHandle.element,
          rollButton,
          sandboxSwitch,
          sandboxNotice,
        ],
      });

      // ── Save ─────────────────────────────────────────────────────────────
      const saveStatus = el(doc, 'p', { class: 'panel__note', attrs: { role: 'status' } });

      async function handleSave(): Promise<void> {
        renderSandboxNotice();
        const verdict = judgeCreation(attributes, sandboxMode);
        if (!verdict.allowed) return;

        const athlete = createAthlete({
          displayName,
          primarySport,
          attributes,
          heightCm,
          weightKg,
          age,
          handedness,
          sandbox: verdict.sandbox,
        });
        // TODO(T-3.16): persist `portraitBlob` (already downscaled and local-only) to the blob
        // store and set `athlete.portraitBlobId` to its key before writing the record. The blob
        // store does not exist yet, so the photo is produced but not yet attached to a save.
        void portraitBlob;

        saveStatus.textContent = 'Saving…';
        try {
          const { athletes } = await appDatabase();
          await athletes.put(athlete);
        } catch {
          saveStatus.textContent = 'Could not save — this build cannot write to storage right now.';
          return;
        }

        saveStatus.textContent = `${athlete.displayName} saved${
          athlete.sandbox ? ' as a sandbox athlete' : ''
        }.`;
        context.navigate('/squad');
      }

      const saveField = el(doc, 'section', {
        class: 'panel',
        children: [
          button(doc, {
            label: 'Save athlete',
            variant: 'primary',
            size: 'large',
            onClick: () => void handleSave(),
          }),
          saveStatus,
        ],
      });

      renderPreview();
      renderSandboxNotice();

      context.host.replaceChildren(
        el(doc, 'div', {
          class: 'athlete-editor',
          children: [
            previewHost,
            el(doc, 'div', {
              class: 'athlete-editor__form stack',
              children: [
                nameField,
                photoField,
                sportField,
                physicalsField,
                attributesField,
                saveField,
              ],
            }),
          ],
        }),
      );
    },

    unmount(): void {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    },
  };
}
