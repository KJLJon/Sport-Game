/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory), §11 (accessibility)
 *
 * Purpose: the segmented control and the switch. Both are built from native semantics — a radio
 * group and a checkbox — so keyboard navigation and screen-reader behaviour come for free
 * instead of being reimplemented approximately.
 */
import { el } from '../dom.ts';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SegmentedOptions<T extends string> {
  /** Labels the group for screen readers. Required — an unlabelled group is a bug. */
  readonly legend: string;
  readonly name: string;
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange?: (value: T) => void;
}

export function segmented<T extends string>(
  doc: Document,
  options: SegmentedOptions<T>,
): HTMLElement {
  const fieldset = el(doc, 'fieldset', { class: 'segmented' });
  fieldset.appendChild(el(doc, 'legend', { class: 'sr-only', text: options.legend }));

  for (const option of options.options) {
    const id = `${options.name}-${option.value}`;

    const input = el(doc, 'input', {
      class: 'segmented__input',
      attrs: {
        type: 'radio',
        id,
        name: options.name,
        value: option.value,
        checked: option.value === options.value,
        disabled: option.disabled ?? false,
      },
    });

    if (options.onChange) {
      input.addEventListener('change', () => options.onChange?.(option.value));
    }

    const label = el(doc, 'label', {
      class: 'segmented__label',
      text: option.label,
      attrs: { for: id },
    });

    fieldset.append(input, label);
  }

  return fieldset;
}

export interface SwitchOptions {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  /** Shown under the label. Use it to say what the setting actually does. */
  readonly description?: string;
  readonly onChange?: (checked: boolean) => void;
}

export function switchControl(doc: Document, options: SwitchOptions): HTMLElement {
  const input = el(doc, 'input', {
    class: 'switch__input',
    attrs: {
      type: 'checkbox',
      role: 'switch',
      checked: options.checked,
      disabled: options.disabled ?? false,
      'aria-checked': options.checked ? 'true' : 'false',
    },
  }) as HTMLInputElement;

  input.addEventListener('change', () => {
    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    options.onChange?.(input.checked);
  });

  return el(doc, 'label', {
    class: 'switch',
    children: [
      el(doc, 'span', {
        class: 'switch__text',
        children: [
          el(doc, 'span', { class: 'switch__label', text: options.label }),
          options.description !== undefined
            ? el(doc, 'span', { class: 'switch__description', text: options.description })
            : null,
        ],
      }),
      input,
      el(doc, 'span', { class: 'switch__track', attrs: { 'aria-hidden': 'true' } }),
    ],
  });
}
