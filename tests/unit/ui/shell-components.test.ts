/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory), §8.1 (first launch), §11 (accessibility)
 * @invariant INV-11 (nothing carried by colour alone), INV-12 (44 px targets)
 *
 * Purpose: the three inventory entries that had no component — the tab bar, which had lived inside
 * the app shell since Phase 0; the athlete list row, which four screens had each built their own
 * of; and the onboarding coach-mark, which nothing had built at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { activeTab, tabBar, type TabDef } from '../../../src/ui/components/tab-bar.ts';
import { athleteRow } from '../../../src/ui/components/athlete-row.ts';
import { coachMark } from '../../../src/ui/components/coach-mark.ts';
import { athlete } from '../../helpers/athletes.ts';

const TABS: TabDef[] = [
  { path: '/', label: 'Home', icon: 'M4 4h16v16H4z' },
  { path: '/squad', label: 'Squad', icon: 'M4 4h16v16H4z' },
  { path: '/squad/lineup', label: 'Lineup', icon: 'M4 4h16v16H4z' },
];

describe('the tab bar (`10` §5)', () => {
  it('is a named landmark of links, one per tab', () => {
    const bar = tabBar(document, { tabs: TABS });

    expect(bar.tagName).toBe('NAV');
    expect(bar.getAttribute('aria-label')).toBe('Main');
    expect([...bar.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/',
      '#/squad',
      '#/squad/lineup',
    ]);
  });

  it('marks the current tab with `aria-current`, and only that one', () => {
    const bar = tabBar(document, { tabs: TABS, currentPath: '/squad' });
    const current = [...bar.querySelectorAll('a')].filter(
      (a) => a.getAttribute('aria-current') === 'page',
    );

    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('data-path')).toBe('/squad');
  });

  it('resolves a deep path to its tab, and prefers the longest match', () => {
    // A screen below Squad still marks Squad.
    expect(activeTab(TABS, '/squad/athlete/7')?.path).toBe('/squad');
    // …but a tab of its own wins over its parent, however the tabs are ordered.
    expect(activeTab(TABS, '/squad/lineup')?.path).toBe('/squad/lineup');
    expect(activeTab(TABS, '/squad/lineup/edit')?.path).toBe('/squad/lineup');
    // `/` is not a prefix of everything: it would otherwise match every path in the app.
    expect(activeTab(TABS, '/store')).toBeUndefined();
    expect(activeTab(TABS, undefined)).toBeUndefined();
  });

  it('hides its icons from assistive tech — the label already says it', () => {
    const bar = tabBar(document, { tabs: TABS });

    for (const svg of bar.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
    }
    expect([...bar.querySelectorAll('.tab-bar__label')].map((n) => n.textContent)).toEqual([
      'Home',
      'Squad',
      'Lineup',
    ]);
  });

  it('takes the owner’s placement class without losing its own', () => {
    const bar = tabBar(document, { tabs: TABS, className: 'shell__tabs', label: 'Modes' });

    expect(bar.className).toBe('tab-bar shell__tabs');
    expect(bar.getAttribute('aria-label')).toBe('Modes');
  });
});

describe('the athlete list row (`10` §5)', () => {
  it('shows the athlete, and names the bare overall for a screen reader', () => {
    const row = athleteRow(document, {
      athlete: athlete({ displayName: 'Ada Kovač' }),
      overall: 78.4,
      position: 'PG',
      meta: 'Basketball · rare',
    });

    expect(row.tagName).toBe('LI');
    expect(row.querySelector('.athlete-row__name')?.textContent).toBe('Ada Kovač');
    expect(row.querySelector('.athlete-row__portrait')?.textContent).toBe('AK');
    // Rounded, and never a naked number in the accessibility tree.
    expect(row.querySelector('.athlete-row__overall')?.textContent).toBe('78');
    expect(row.querySelector('.athlete-row__overall')?.getAttribute('aria-label')).toBe(
      'Overall 78',
    );
  });

  it('says why a row cannot be used, rather than only dimming it (INV-11)', () => {
    const row = athleteRow(document, {
      athlete: athlete(),
      disabled: true,
      warning: 'In your starting five.',
    });

    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.querySelector('.athlete-row__warning')?.textContent).toBe('In your starting five.');
    // Still readable: disabling a row does not remove it from the list.
    expect(row.dataset.disabled).toBe('true');
  });

  it('links the name when given a href, and leaves the trailing controls outside it', () => {
    const sell = document.createElement('button');
    const row = athleteRow(document, {
      athlete: athlete(),
      href: '#/squad/athlete/1',
      trailing: [sell],
    });

    const link = row.querySelector('a.athlete-row__name');
    expect(link?.getAttribute('href')).toBe('#/squad/athlete/1');
    expect(link?.contains(sell)).toBe(false);
    expect(row.querySelector('.athlete-row__trailing')?.contains(sell)).toBe(true);
  });

  it('renders nothing it was not given', () => {
    const row = athleteRow(document, { athlete: athlete(), as: 'div' });

    expect(row.tagName).toBe('DIV');
    expect(row.querySelector('.athlete-row__meta')).toBeNull();
    expect(row.querySelector('.athlete-row__warning')).toBeNull();
    expect(row.querySelector('.athlete-row__position')).toBeNull();
    // No overall and no trailing controls means no trailing block at all, not an empty one.
    expect(row.querySelector('.athlete-row__trailing')).toBeNull();
    expect(row.dataset.selected).toBe('false');
  });
});

describe('the onboarding coach-mark (`10` §5, §8.1)', () => {
  it('is a note, not a dialog — it can be ignored', () => {
    const { element } = coachMark(document, { body: 'Tap here to start a match.' });

    expect(element.getAttribute('role')).toBe('note');
    expect(element.getAttribute('aria-live')).toBe('polite');
    expect(element.querySelector('.coach-mark__text')?.textContent).toBe(
      'Tap here to start a match.',
    );
  });

  it('dismisses from its button, and fires `onDismiss` exactly once', () => {
    const onDismiss = vi.fn();
    const { element, dismiss } = coachMark(document, { body: 'Tap here.', onDismiss });
    document.body.append(element);

    element.querySelector<HTMLButtonElement>('.coach-mark__dismiss')?.click();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(element.isConnected).toBe(false);
    // A second dismissal — from the owner, or from a stray Escape — is not a second callback.
    dismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape, without letting the key reach whatever is behind it', () => {
    const onDismiss = vi.fn();
    const outer = vi.fn();
    const { element } = coachMark(document, { body: 'Tap here.', onDismiss });
    const host = document.createElement('div');
    host.addEventListener('keydown', outer);
    host.append(element);
    document.body.append(host);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('counts a sequence in words, never as dots alone (INV-11)', () => {
    const { element } = coachMark(document, {
      title: 'Your squad',
      body: 'Everyone you own lives here.',
      placement: 'above',
      step: { index: 3, total: 5 },
      dismissLabel: 'Next',
    });

    expect(element.querySelector('.coach-mark__step')?.textContent).toBe('Step 3 of 5');
    expect(element.querySelector('.coach-mark__title')?.textContent).toBe('Your squad');
    expect(element.dataset.placement).toBe('above');
    expect(element.querySelector('.coach-mark__dismiss')?.textContent).toBe('Next');
  });
});
