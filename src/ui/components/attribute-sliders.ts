/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @story   US-5.1 — Create an athlete profile
 * @design  10-ui-ux.md §8.3 (create-an-athlete flow — "sliders with a live budget meter"),
 *          §5 (component inventory), §11 (accessibility), 05-data-model.md §2.1 (budget, sandbox)
 *
 * Purpose: the eleven attribute sliders and the budget meter underneath them, as one component,
 * because the two only mean something together — the meter is what tells a player dragging any
 * one slider what it just cost them. `budgetState` (T-3.2) is called on every change; nothing
 * here recomputes or re-derives the budget rule itself.
 *
 * A slider drag only ever touches this component's own DOM — the meter's fill and text, and the
 * one slider's value label — never a parent re-render, so a full-height rebuild never steals focus
 * out from under a thumb mid-drag. `setAttributes` (presets, roll, fit-to-budget) is the one path
 * that legitimately moves every slider at once, and it goes through the same update routine.
 *
 * Labels come from `athletes/explain.ts`'s `attributeLabels()` — the same humaniser the athlete
 * card's radar and "why this rating" lines use — rather than a second table kept here in step with
 * it by hand.
 */
import { budgetState } from '../../athletes/attributes.ts';
import { attributeLabels } from '../../athletes/explain.ts';
import { ATTRIBUTE_IDS, type AttributeId, type Attributes } from '../../athletes/types.ts';
import { CREATION } from '../../athletes/tuning.ts';
import { clamp01, el, percent } from '../dom.ts';

export interface AttributeSlidersOptions {
  readonly initial: Attributes;
  /** Fired on every change — a drag, a preset, a roll — with the full, current spread. */
  readonly onChange: (attributes: Attributes) => void;
}

export interface AttributeSlidersHandle {
  readonly element: HTMLElement;
  /** Moves every slider at once (preset, roll, fit-to-budget) without rebuilding the DOM. */
  setAttributes(attributes: Attributes): void;
}

interface Row {
  readonly input: HTMLInputElement;
  readonly value: HTMLElement;
}

export function attributeSliders(
  doc: Document,
  options: AttributeSlidersOptions,
): AttributeSlidersHandle {
  const current: Record<AttributeId, number> = { ...options.initial };
  const rows = new Map<AttributeId, Row>();

  const meterFill = el(doc, 'div', { class: 'attribute-budget__fill' });
  const meterText = el(doc, 'span', { class: 'attribute-budget__text' });
  const meterTrack = el(doc, 'div', {
    class: 'attribute-budget__track',
    attrs: { role: 'meter', 'aria-label': 'Attribute point budget' },
    children: [meterFill],
  });

  function renderMeter(): void {
    const state = budgetState(current);
    const fraction = clamp01(state.total / state.budget);
    meterFill.style.setProperty('--fill', percent(fraction));
    meterTrack.dataset.tone = state.withinBudget ? 'ok' : 'over';
    meterTrack.setAttribute('aria-valuemin', '0');
    meterTrack.setAttribute('aria-valuemax', String(state.budget));
    meterTrack.setAttribute('aria-valuenow', String(state.total));

    const remainderText =
      state.remaining >= 0
        ? `${state.remaining} left`
        : `${Math.abs(state.remaining)} over — needs Sandbox mode to save`;
    const text = `${state.total} / ${state.budget} points · ${remainderText}`;
    meterText.textContent = text;
    meterTrack.setAttribute('aria-valuetext', text);
  }

  function applyRow(id: AttributeId): void {
    const row = rows.get(id);
    if (row === undefined) return;
    row.input.value = String(current[id]);
    row.value.textContent = String(current[id]);
  }

  const list = el(doc, 'div', { class: 'attribute-sliders__list' });
  for (const { id, label } of attributeLabels()) {
    const sliderId = `attribute-slider-${id}`;
    const valueEl = el(doc, 'output', {
      class: 'attribute-slider__value',
      text: String(current[id]),
      attrs: { for: sliderId },
    });

    const input = el(doc, 'input', {
      class: 'attribute-slider__input',
      attrs: {
        type: 'range',
        id: sliderId,
        min: CREATION.attribute.min,
        max: CREATION.attribute.max,
        step: 1,
        value: current[id],
      },
    }) as HTMLInputElement;

    input.addEventListener('input', () => {
      const next = Number(input.value);
      current[id] = next;
      valueEl.textContent = String(next);
      renderMeter();
      options.onChange({ ...current });
    });

    rows.set(id, { input, value: valueEl });

    list.appendChild(
      el(doc, 'div', {
        class: 'attribute-slider',
        children: [
          el(doc, 'label', {
            class: 'attribute-slider__label',
            text: label,
            attrs: { for: sliderId },
          }),
          input,
          valueEl,
        ],
      }),
    );
  }

  renderMeter();

  const element = el(doc, 'div', {
    class: 'attribute-sliders',
    children: [
      list,
      el(doc, 'div', {
        class: 'attribute-budget',
        children: [meterTrack, meterText],
      }),
    ],
  });

  return {
    element,
    setAttributes(attributes: Attributes): void {
      for (const id of ATTRIBUTE_IDS) {
        current[id] = attributes[id];
        applyRow(id);
      }
      renderMeter();
      options.onChange({ ...current });
    },
  };
}
