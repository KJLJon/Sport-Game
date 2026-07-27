/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (states matrix), §11 (accessibility)
 *
 * Purpose: the states matrix `10` §5 requires of every primitive, plus the accessibility
 * properties that make the visual-regression snapshots meaningful rather than decorative.
 */
import { describe, expect, it, vi } from 'vitest';
import { button } from '../../../src/ui/components/button.ts';
import { segmented, switchControl } from '../../../src/ui/components/controls.ts';
import {
  coinPill,
  familiarityRank,
  familiarityRing,
  progressBar,
  ratingBar,
  starRating,
} from '../../../src/ui/components/meters.ts';
import { banner, dialog, sheet, toast } from '../../../src/ui/components/feedback.ts';
import { emptyState, errorState, skeleton } from '../../../src/ui/components/states.ts';

const doc = document;

describe('button', () => {
  it('renders each variant with its modifier class', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'destructive', 'icon'] as const) {
      expect(button(doc, { label: 'Go', variant }).className).toContain(`button--${variant}`);
    }
  });

  it('meets the 44 px target rule by carrying no inline size override', () => {
    // Size is a token concern; the component must not fight it with inline styles (`10` §3.2).
    expect(button(doc, { label: 'Go' }).getAttribute('style')).toBeNull();
  });

  it('disables while loading, so a double-tap cannot fire the action twice', () => {
    const node = button(doc, { label: 'Saving', loading: true }) as HTMLButtonElement;
    expect(node.disabled).toBe(true);
    expect(node.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the label available to screen readers in the icon-only variant', () => {
    const node = button(doc, { label: 'Close', variant: 'icon', icon: 'M0 0h1v1H0z' });
    expect(node.querySelector('.sr-only')?.textContent).toBe('Close');
    expect(node.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders an anchor when given an href, so links stay links', () => {
    const node = button(doc, { label: 'Settings', href: '#/settings' });
    expect(node.tagName).toBe('A');
    expect(node.getAttribute('href')).toBe('#/settings');
  });

  it('marks a disabled anchor with aria-disabled, since anchors have no disabled property', () => {
    const node = button(doc, { label: 'Settings', href: '#/settings', disabled: true });
    expect(node.getAttribute('aria-disabled')).toBe('true');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    button(doc, { label: 'Go', onClick }).dispatchEvent(new Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('sets no text via innerHTML, so an untrusted label cannot inject markup', () => {
    const node = button(doc, { label: '<img src=x onerror=alert(1)>' });
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('segmented', () => {
  it('is a labelled radio group with one option checked', () => {
    const node = segmented(doc, {
      legend: 'Difficulty',
      name: 'difficulty',
      value: 'pro',
      options: [
        { value: 'rookie', label: 'Rookie' },
        { value: 'pro', label: 'Pro' },
      ],
    });

    expect(node.querySelector('legend')?.textContent).toBe('Difficulty');
    const checked = node.querySelectorAll<HTMLInputElement>('input:checked');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.value).toBe('pro');
  });

  it('reports the newly selected value', () => {
    const onChange = vi.fn();
    const node = segmented(doc, {
      legend: 'Difficulty',
      name: 'd2',
      value: 'rookie',
      options: [
        { value: 'rookie', label: 'Rookie' },
        { value: 'pro', label: 'Pro' },
      ],
      onChange,
    });

    node.querySelectorAll('input')[1]?.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('pro');
  });

  it('honours a disabled option', () => {
    const node = segmented(doc, {
      legend: 'Difficulty',
      name: 'd3',
      value: 'rookie',
      options: [
        { value: 'rookie', label: 'Rookie' },
        { value: 'legend', label: 'Legend', disabled: true },
      ],
    });
    expect(node.querySelectorAll<HTMLInputElement>('input')[1]?.disabled).toBe(true);
  });
});

describe('switchControl', () => {
  it('exposes role=switch with the right aria-checked', () => {
    const node = switchControl(doc, { label: 'Haptics', checked: true });
    const input = node.querySelector('input');
    expect(input?.getAttribute('role')).toBe('switch');
    expect(input?.getAttribute('aria-checked')).toBe('true');
  });

  it('updates aria-checked and reports the change on toggle', () => {
    const onChange = vi.fn();
    const node = switchControl(doc, { label: 'Haptics', checked: false, onChange });
    const input = node.querySelector<HTMLInputElement>('input');

    input!.checked = true;
    input!.dispatchEvent(new Event('change'));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(input!.getAttribute('aria-checked')).toBe('true');
  });
});

describe('ratingBar', () => {
  it('reports the value on a meter role', () => {
    const track = ratingBar(doc, { label: 'Shooting', value: 84 }).querySelector('[role="meter"]');
    expect(track?.getAttribute('aria-valuenow')).toBe('84');
    expect(track?.getAttribute('aria-valuemax')).toBe('99');
  });

  it('clamps out-of-range values rather than overflowing the track', () => {
    const high = ratingBar(doc, { label: 'X', value: 140 }).querySelector('[role="meter"]');
    const low = ratingBar(doc, { label: 'X', value: -20 }).querySelector('[role="meter"]');
    expect(high?.getAttribute('aria-valuenow')).toBe('99');
    expect(low?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('carries tone as data, so CSS can add a non-colour channel (`10` §11)', () => {
    expect(
      ratingBar(doc, { label: 'Handling', value: 30, tone: 'weak' }).getAttribute('data-tone'),
    ).toBe('weak');
  });

  it('keeps the value in aria even when it is visually hidden', () => {
    const node = ratingBar(doc, { label: 'Shooting', value: 71, hideValue: true });
    expect(node.querySelector('.rating-bar__value')).toBeNull();
    expect(node.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('71');
  });
});

describe('progressBar', () => {
  it('reports a determinate value as a percentage', () => {
    const bar = progressBar(doc, { label: 'Downloading', value: 0.82 });
    expect(bar.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('82');
    expect(bar.querySelector('.progress-bar__value')?.textContent).toBe('82%');
  });

  it('omits aria-valuenow when indeterminate, which is what "unknown" means', () => {
    const bar = progressBar(doc, { label: 'Checking' });
    expect(bar.getAttribute('data-indeterminate')).toBe('true');
    expect(bar.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBeNull();
  });

  it('prefers explicit valueText over the percentage', () => {
    const bar = progressBar(doc, { label: 'Level 4', value: 0.34, valueText: '820 / 2,400 XP' });
    expect(bar.querySelector('.progress-bar__value')?.textContent).toBe('820 / 2,400 XP');
    expect(bar.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe(
      '820 / 2,400 XP',
    );
  });
});

describe('familiarityRank', () => {
  it.each([
    [0, 'Novice'],
    [0.19, 'Novice'],
    [0.2, 'Learning'],
    [0.45, 'Competent'],
    [0.65, 'Comfortable'],
    [0.99, 'Natural'],
    [1, 'Natural'],
  ])('maps %s to %s', (value, rank) => {
    expect(familiarityRank(value)).toBe(rank);
  });

  it('clamps rather than throwing on out-of-range input', () => {
    expect(familiarityRank(-3)).toBe('Novice');
    expect(familiarityRank(9)).toBe('Natural');
  });
});

describe('familiarityRing', () => {
  it('states the rank and the percentage in words, never colour alone', () => {
    const node = familiarityRing(doc, { value: 0.92, sport: 'Basketball' });
    expect(node.getAttribute('aria-label')).toBe('Basketball familiarity: Natural, 92%');
    expect(node.querySelector('.familiarity-ring__rank')?.textContent).toBe('Natural');
  });

  it('draws an empty ring at zero and a full ring at one', () => {
    const empty = familiarityRing(doc, { value: 0, sport: 'Soccer' });
    const full = familiarityRing(doc, { value: 1, sport: 'Soccer' });
    const emptyFill = empty.querySelector('.familiarity-ring__fill');
    const fullFill = full.querySelector('.familiarity-ring__fill');

    expect(Number(emptyFill?.getAttribute('stroke-dashoffset'))).toBeCloseTo(
      Number(emptyFill?.getAttribute('stroke-dasharray')),
    );
    expect(Number(fullFill?.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
  });
});

describe('starRating', () => {
  it('labels the count for screen readers', () => {
    expect(starRating(doc, { value: 2 }).getAttribute('aria-label')).toBe('2 of 3 stars');
  });

  it('marks exactly the earned stars', () => {
    const node = starRating(doc, { value: 2, max: 5 });
    expect(node.querySelectorAll('svg')).toHaveLength(5);
    expect(node.querySelectorAll('svg.is-earned')).toHaveLength(2);
  });

  it('clamps above max and below zero', () => {
    expect(starRating(doc, { value: 9, max: 3 }).querySelectorAll('svg.is-earned')).toHaveLength(3);
    expect(starRating(doc, { value: -2, max: 3 }).querySelectorAll('svg.is-earned')).toHaveLength(
      0,
    );
  });
});

describe('coinPill', () => {
  it('groups thousands', () => {
    expect(coinPill(doc, { amount: 1250 }).textContent).toContain('1,250');
  });

  it('signs rewards and costs, using a real minus sign for tabular alignment', () => {
    expect(coinPill(doc, { amount: 250, signed: true }).textContent).toContain('+250');
    expect(coinPill(doc, { amount: -400, signed: true }).textContent).toContain('−400');
  });

  it('marks a debit as data as well as colour', () => {
    expect(coinPill(doc, { amount: -400 }).getAttribute('data-tone')).toBe('debit');
    expect(coinPill(doc, { amount: 400 }).getAttribute('data-tone')).toBe('credit');
  });

  it('gives the whole pill one accessible label', () => {
    expect(coinPill(doc, { amount: 250, signed: true }).getAttribute('aria-label')).toBe(
      '+250 coins',
    );
  });
});

describe('dialog', () => {
  it('is labelled by its title', () => {
    const node = dialog(doc, {
      title: 'Erase everything?',
      body: 'This cannot be undone.',
      actions: [],
    });
    const id = node.getAttribute('aria-labelledby');
    expect(node.querySelector(`#${id}`)?.textContent).toBe('Erase everything?');
  });

  it('runs the selected action', () => {
    const onSelect = vi.fn();
    const node = dialog(doc, {
      title: 'Erase everything?',
      body: 'This cannot be undone.',
      actions: [{ label: 'Erase', variant: 'destructive', onSelect }],
    });
    node.querySelector('button')?.dispatchEvent(new Event('click'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('refuses to cancel when not dismissible, which forced updates rely on', () => {
    const node = dialog(doc, {
      title: 'Update required',
      body: 'This version can no longer load your data safely.',
      actions: [],
      dismissible: false,
    });
    const event = new Event('cancel', { cancelable: true });
    node.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('sheet', () => {
  it('is a labelled modal region with a close control', () => {
    const onClose = vi.fn();
    const node = sheet(doc, { title: 'Pick a sport', children: [], onClose });
    expect(node.getAttribute('aria-label')).toBe('Pick a sport');
    expect(node.getAttribute('aria-modal')).toBe('true');
    node.querySelector('.sheet__header button')?.dispatchEvent(new Event('click'));
    expect(onClose).toHaveBeenCalled();
  });

  it('supports half and full heights', () => {
    expect(sheet(doc, { title: 'x', children: [] }).getAttribute('data-height')).toBe('half');
    expect(
      sheet(doc, { title: 'x', children: [], height: 'full' }).getAttribute('data-height'),
    ).toBe('full');
  });
});

describe('toast', () => {
  it('is polite by default and assertive only when something is wrong', () => {
    expect(toast(doc, { message: 'Saved.' }).getAttribute('aria-live')).toBe('polite');
    expect(toast(doc, { message: 'Save failed.', tone: 'danger' }).getAttribute('aria-live')).toBe(
      'assertive',
    );
  });

  it('runs its action', () => {
    const onSelect = vi.fn();
    const node = toast(doc, { message: 'Sold.', action: { label: 'Undo', onSelect } });
    node.querySelector('button')?.dispatchEvent(new Event('click'));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('banner', () => {
  it('is a status region, not a dialog — `11` §4 forbids a modal update prompt', () => {
    const node = banner(doc, { message: 'Update ready.', actions: [] });
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-modal')).toBeNull();
  });

  it('renders each action and runs the right one', () => {
    const update = vi.fn();
    const later = vi.fn();
    const node = banner(doc, {
      message: 'Update ready.',
      actions: [
        { label: 'Update now', variant: 'primary', onSelect: update },
        { label: 'Later', onSelect: later },
      ],
    });

    const buttons = node.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons[1]?.dispatchEvent(new Event('click'));
    expect(later).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('states', () => {
  it('gives an empty state exactly one suggested action (`10` §10)', () => {
    const node = emptyState(doc, {
      heading: 'No athletes yet',
      body: 'Create one to get started.',
      action: { label: 'Create an athlete', href: '#/squad' },
    });
    expect(node.querySelectorAll('.button')).toHaveLength(1);
    expect(node.querySelector('.button')?.getAttribute('href')).toBe('#/squad');
  });

  it('announces an error state and keeps the technical detail collapsed', () => {
    const node = errorState(doc, {
      heading: "That backup didn't load",
      body: 'It was made by a newer version of the game.',
      detail: 'schemaVersion 9 > supported 7',
    });
    expect(node.getAttribute('role')).toBe('alert');
    expect(node.querySelector('details')).not.toBeNull();
    expect(node.querySelector('pre')?.textContent).toBe('schemaVersion 9 > supported 7');
  });

  it('marks a skeleton busy so the wait is not silent', () => {
    const node = skeleton(doc, { lines: 4 });
    expect(node.getAttribute('aria-busy')).toBe('true');
    expect(node.querySelectorAll('.skeleton__line')).toHaveLength(4);
  });

  it('never renders fewer than one skeleton line', () => {
    expect(skeleton(doc, { lines: 0 }).querySelectorAll('.skeleton__line')).toHaveLength(1);
  });
});
