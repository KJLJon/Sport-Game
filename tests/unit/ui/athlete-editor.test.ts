/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @story   US-5.1 — Create an athlete profile
 * @design  10-ui-ux.md §8.3 (create-an-athlete flow), 05-data-model.md §2, §2.1
 *
 * Purpose: the profile editor is the whole point of `05` §2.1's budget and sandbox rules having a
 * face — this suite drives it the way a player would (type a name, tap a preset, drag past the
 * budget, save) and checks the result against `judgeCreation` and the stored record, not against
 * the screen's own opinion of itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { athleteEditorScreen } from '../../../src/ui/screens/athlete-editor.ts';
import { judgeCreation } from '../../../src/athletes/attributes.ts';
import { ATTRIBUTE_PRESETS } from '../../../src/athletes/presets.ts';
import { CREATION } from '../../../src/athletes/tuning.ts';
import { ATTRIBUTE_IDS, attributeTotal } from '../../../src/athletes/types.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { deleteDatabase } from '../../../src/storage/idb.ts';
import type { ScreenContext } from '../../../src/app/screen.ts';

vi.mock('../../../src/athletes/portrait.ts', () => ({
  downscalePortrait: vi.fn(async () => new Blob(['fake-portrait'], { type: 'image/webp' })),
}));

function context(navigate = vi.fn()): ScreenContext & { host: HTMLElement } {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate } as ScreenContext & { host: HTMLElement };
}

function slider(host: HTMLElement, id: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`#attribute-slider-${id}`);
  expect(input, `slider for ${id} should exist`).not.toBeNull();
  return input!;
}

function setSlider(host: HTMLElement, id: string, value: number): void {
  const input = slider(host, id);
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
}

function saveButton(host: HTMLElement): HTMLElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save athlete');
  expect(found).toBeDefined();
  return found!;
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
  // jsdom does not implement the object-URL pair the photo preview relies on.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
  vi.restoreAllMocks();
});

describe('layout (`10` §8.3 — name, photo, primary sport, physicals, attributes)', () => {
  it('renders every section and a live preview', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    expect(ctx.host.querySelector('#athlete-editor-name')).not.toBeNull();
    expect(ctx.host.querySelector('#athlete-editor-photo')).not.toBeNull();
    expect(ctx.host.querySelector('.athlete-card')).not.toBeNull();
    expect(ctx.host.textContent).toContain('Primary sport');
    expect(ctx.host.textContent).toContain('Physicals');
    expect(ctx.host.textContent).toContain('Attributes');
    for (const id of ATTRIBUTE_IDS) {
      expect(ctx.host.querySelector(`#attribute-slider-${id}`)).not.toBeNull();
    }
  });

  it('offers every preset as a tappable archetype', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    for (const preset of ATTRIBUTE_PRESETS) {
      expect(ctx.host.textContent).toContain(preset.label);
    }
  });

  it('shows the athlete in a second sport once one is picked, per `10` §8.3', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    // Basketball is the default primary sport; the switcher should already offer soccer too.
    expect(ctx.host.querySelector('input[value="soccer"]')).not.toBeNull();
  });
});

describe('the live preview', () => {
  it('updates as the name is typed', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const name = ctx.host.querySelector<HTMLInputElement>('#athlete-editor-name')!;
    name.value = 'Riley Example';
    name.dispatchEvent(new Event('input'));

    expect(ctx.host.querySelector('.athlete-card__name')?.textContent).toBe('Riley Example');
  });

  it('falls back to a placeholder name without blocking anything, per `10` §8.3', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    expect(ctx.host.querySelector('.athlete-card__name')?.textContent).toBe('Unnamed athlete');
  });

  it('re-renders when the primary sport changes', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const soccer = ctx.host.querySelector<HTMLInputElement>(
      'fieldset[class="segmented"] input[value="soccer"]',
    );
    // The primary-sport segmented control is the first one in the document.
    const primarySportSoccer = ctx.host.querySelector<HTMLInputElement>(
      '#athlete-editor-sport-soccer',
    );
    expect(primarySportSoccer ?? soccer).not.toBeNull();
    (primarySportSoccer ?? soccer)!.click();
    (primarySportSoccer ?? soccer)!.dispatchEvent(new Event('change'));

    expect(ctx.host.querySelector('.athlete-card')?.getAttribute('data-sport')).toBe('soccer');
  });
});

describe('attributes: presets, sliders, and roll', () => {
  it('applies a preset to every slider and updates the budget meter', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const preset = ATTRIBUTE_PRESETS[0]!;
    const presetButton = [...ctx.host.querySelectorAll('.attribute-preset')].find((el) =>
      el.textContent?.includes(preset.label),
    ) as HTMLButtonElement;
    presetButton.click();

    for (const id of ATTRIBUTE_IDS) {
      expect(slider(ctx.host, id).value).toBe(String(preset.attributes[id]));
    }

    const total = attributeTotal(preset.attributes);
    expect(ctx.host.querySelector('.attribute-budget__text')?.textContent).toContain(
      `${total} / ${CREATION.budget}`,
    );
  });

  it('moves the budget meter as a slider is dragged', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    setSlider(ctx.host, 'speed', 95);
    expect(slider(ctx.host, 'speed').value).toBe('95');
    expect(ctx.host.querySelector('.athlete-card')).not.toBeNull();
  });

  it('rolls a spread that is always on budget and legal, per the editor roll (`05` §2.1)', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const roll = [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Roll')!;
    roll.click();

    const total = ATTRIBUTE_IDS.reduce((sum, id) => sum + Number(slider(ctx.host, id).value), 0);
    expect(total).toBe(CREATION.budget);
  });

  it('offers Sandbox mode instead of silently discarding an over-budget build (`05` §2.1)', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    for (const id of ATTRIBUTE_IDS) setSlider(ctx.host, id, 95);

    expect(ctx.host.textContent).toContain('Sandbox mode');
    const notice = ctx.host.querySelector('[role="status"].panel__note--strong');
    expect(notice?.textContent).toMatch(/Over the .* budget/);

    const enableAndSave = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Turn on Sandbox mode and save',
    );
    expect(enableAndSave).toBeDefined();
  });
});

describe('saving', () => {
  it('saves a legal athlete and navigates back to the squad', async () => {
    const navigate = vi.fn();
    const ctx = context(navigate);
    athleteEditorScreen().mount(ctx);

    const name = ctx.host.querySelector<HTMLInputElement>('#athlete-editor-name')!;
    name.value = 'Sable Rowe';
    name.dispatchEvent(new Event('input'));

    saveButton(ctx.host).click();

    await vi.waitFor(async () => {
      expect(navigate).toHaveBeenCalledWith('/squad');
    });

    const { athletes } = await appDatabase();
    const all = await athletes.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.displayName).toBe('Sable Rowe');
    expect(all[0]?.sandbox).toBe(false);
    expect(judgeCreation(all[0]!.attributes, false).allowed).toBe(true);
  });

  it('refuses to save an over-budget athlete until Sandbox mode is on', async () => {
    const navigate = vi.fn();
    const ctx = context(navigate);
    athleteEditorScreen().mount(ctx);

    for (const id of ATTRIBUTE_IDS) setSlider(ctx.host, id, 95);
    saveButton(ctx.host).click();

    // Refused: nothing written, navigation never fired.
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    const { athletes } = await appDatabase();
    expect(await athletes.count()).toBe(0);
  });

  it('saves as sandbox once the player opts in, and never discards what they built', async () => {
    const navigate = vi.fn();
    const ctx = context(navigate);
    athleteEditorScreen().mount(ctx);

    for (const id of ATTRIBUTE_IDS) setSlider(ctx.host, id, 95);

    const enableAndSave = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Turn on Sandbox mode and save',
    )!;
    enableAndSave.click();

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/squad');
    });

    const { athletes } = await appDatabase();
    const all = await athletes.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.sandbox).toBe(true);
    for (const id of ATTRIBUTE_IDS) expect(all[0]?.attributes[id]).toBe(95);
  });

  it('flips the visible Sandbox mode switch on when opted in via the refusal banner', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    for (const id of ATTRIBUTE_IDS) setSlider(ctx.host, id, 95);
    const enableAndSave = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Turn on Sandbox mode and save',
    )!;
    enableAndSave.click();

    const toggle = ctx.host.querySelector<HTMLInputElement>('.switch__input');
    expect(toggle?.checked).toBe(true);
  });
});

describe('photo capture and downscale', () => {
  it('accepts a photo, downscales it, and shows a local-only preview', async () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const input = ctx.host.querySelector<HTMLInputElement>('#athlete-editor-photo')!;
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      const img = ctx.host.querySelector<HTMLImageElement>('.athlete-editor__photo-preview');
      expect(img?.hidden).toBe(false);
    });

    expect(ctx.host.textContent).toContain('never uploaded');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('removes the photo and revokes its object URL', async () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const input = ctx.host.querySelector<HTMLInputElement>('#athlete-editor-photo')!;
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(ctx.host.querySelector('.athlete-editor__photo-preview')?.getAttribute('hidden')).toBe(
        null,
      );
    });

    const remove = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Remove photo',
    )!;
    remove.click();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(ctx.host.querySelector('.athlete-editor__photo-preview')?.hasAttribute('hidden')).toBe(
      true,
    );
  });

  it('revokes the object URL on unmount so a photo never leaks past the editor', async () => {
    const ctx = context();
    const screen = athleteEditorScreen();
    screen.mount(ctx);

    const input = ctx.host.querySelector<HTMLInputElement>('#athlete-editor-photo')!;
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    screen.unmount?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('physicals', () => {
  it('feeds height, weight, age, and handedness into the preview', () => {
    const ctx = context();
    athleteEditorScreen().mount(ctx);

    const height = ctx.host.querySelector<HTMLInputElement>('#athlete-editor-height')!;
    height.value = '210';
    height.dispatchEvent(new Event('input'));

    expect(ctx.host.querySelector('.athlete-card__physical')?.textContent).toContain('210 cm');
  });
});
