/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.4 — Basketball play catalogue (offence + defence calls) and call-selection UI
 * @story   US-15.2 — Call plays and see them resolve
 * @design  10-ui-ux.md §8.4 (Playbook turn), §11 (accessibility)
 *
 * The sheet's contract: one choice from a set, a second tap only when the call asks for one, and
 * nothing sport-specific reaching the component.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callSheet, readableRating } from '../../../src/ui/components/play-call.ts';
import type { CallChoice } from '../../../src/ui/components/play-call.ts';
import type { CallOption } from '../../../src/modes/playbook/types.ts';
import {
  BASKETBALL_CALLS,
  basketballSquads,
} from '../../../src/sports/basketball/playbook/index.ts';
import { evenRosters } from '../../../tools/playbook-rosters.ts';

const OFFENCE = BASKETBALL_CALLS.filter((call) => call.side === 'offence');
const SQUAD = basketballSquads(...evenRosters('sheet'))[0].players;

function mount(overrides: Partial<Parameters<typeof callSheet>[1]> = {}) {
  const chosen: CallChoice[] = [];
  const handle = callSheet(document, {
    calls: OFFENCE,
    squad: SQUAD,
    onChoose: (choice) => chosen.push(choice),
    ...overrides,
  });
  document.body.replaceChildren(handle.element);
  return { handle, chosen };
}

function cards(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.play-call__input')];
}

function pick(id: string): void {
  const input = cards().find((candidate) => candidate.value === id);
  expect(input).toBeDefined();
  input?.click();
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the call list', () => {
  it('renders one card per call, with its name and its "best when"', () => {
    mount();
    expect(cards()).toHaveLength(OFFENCE.length);
    const names = [...document.querySelectorAll('.play-call__name')].map(
      (node) => node.textContent,
    );
    expect(names).toEqual(OFFENCE.map((call) => call.name));
    expect(document.body.textContent).toContain('Best when you have a star mismatch.');
  });

  it('shows three to six cards, which is what `10` §8.4 asks the screen to fit', () => {
    expect(OFFENCE.length).toBeGreaterThanOrEqual(3);
    expect(OFFENCE.length).toBeLessThanOrEqual(6);
  });

  it('is a labelled radio group, so the platform does the keyboard work', () => {
    mount();
    expect(document.querySelector('legend')?.textContent).toBe('Choose a call');
    const names = new Set(cards().map((input) => input.name));
    expect(names.size).toBe(1);
    for (const input of cards()) expect(input.type).toBe('radio');
  });

  it('names the ratings a call keys off, in words rather than ids', () => {
    mount();
    const keys = [...document.querySelectorAll('.play-call__key')].map((node) => node.textContent);
    expect(keys).toContain('Three point');
    expect(keys).not.toContain('threePoint');
  });

  it('says in words that a targeted call wants a second tap', () => {
    mount();
    const targeted = [...document.querySelectorAll('.play-call__targeted')];
    expect(targeted).toHaveLength(OFFENCE.filter((call) => call.targeted === true).length);
    expect(targeted[0]?.textContent).toBe('Pick an athlete');
  });

  it('shows what the opponent called last turn (`10` §8.4)', () => {
    mount({ opponentLastCall: '2-3 Zone' });
    expect(document.querySelector('.play-call-sheet__opponent')?.textContent).toBe(
      'They called: 2-3 Zone',
    );
  });
});

describe('choosing', () => {
  it('reports an untargeted call on the first tap', () => {
    const { chosen } = mount();
    pick('motion');
    expect(chosen).toEqual([{ call: 'motion' }]);
  });

  it('asks for a target before reporting a targeted call', () => {
    const { chosen, handle } = mount();
    pick('isolation');
    expect(chosen).toEqual([]);
    expect(handle.pending()).toBe('isolation');
    expect(document.querySelector('.play-call-sheet__prompt')?.textContent).toBe(
      'Isolation — pick an athlete',
    );
  });

  it('offers every athlete on the floor, by name and role', () => {
    mount();
    pick('post-up');
    const targets = [...document.querySelectorAll('.play-call-target')];
    expect(targets).toHaveLength(SQUAD.length);
    expect(targets[0]?.textContent).toContain(SQUAD[0]?.athlete.displayName);
  });

  it('reports the call and the target once the second tap lands', () => {
    const { chosen, handle } = mount();
    pick('isolation');
    document.querySelector<HTMLButtonElement>('.play-call-target')?.click();
    expect(chosen).toEqual([{ call: 'isolation', target: SQUAD[0]?.id }]);
    expect(handle.pending()).toBeNull();
  });

  it('goes back to the list rather than opening a sheet over a sheet', () => {
    const { chosen, handle } = mount();
    pick('isolation');
    expect(cards()).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('.play-call-sheet__back')?.click();
    expect(cards()).toHaveLength(OFFENCE.length);
    expect(handle.pending()).toBeNull();
    expect(chosen).toEqual([]);
  });

  it('resets a half-made choice when the screen tells it to', () => {
    const { handle } = mount();
    pick('spot-up');
    expect(handle.pending()).toBe('spot-up');
    handle.reset();
    expect(handle.pending()).toBeNull();
    expect(cards()).toHaveLength(OFFENCE.length);
  });

  it('skips the target step when there is nobody to target', () => {
    const { chosen } = mount({ squad: [] });
    pick('isolation');
    expect(chosen).toEqual([{ call: 'isolation' }]);
  });

  it('returns to the list after a completed choice, ready for the next turn', () => {
    const { chosen } = mount();
    pick('motion');
    expect(cards()).toHaveLength(OFFENCE.length);
    pick('spot-up');
    document.querySelector<HTMLButtonElement>('.play-call-target')?.click();
    expect(chosen).toHaveLength(2);
  });
});

describe('the hot seat', () => {
  it('shows nothing to choose while the device is being passed (T-5.9)', () => {
    const onChoose = vi.fn();
    const handle = callSheet(document, { calls: OFFENCE, squad: SQUAD, hidden: true, onChoose });
    document.body.replaceChildren(handle.element);

    expect(cards()).toHaveLength(0);
    expect(document.querySelector('.play-call-sheet__hidden')?.textContent).toBe(
      'Pass the device to call.',
    );
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('still shows the opponent’s last call, which is not a secret', () => {
    mount({ hidden: true, opponentLastCall: 'Press' });
    expect(document.body.textContent).toContain('They called: Press');
  });
});

describe('readableRating', () => {
  it('turns a rating id into words', () => {
    expect(readableRating('threePoint')).toBe('Three point');
    expect(readableRating('perimeterD')).toBe('Perimeter d');
    expect(readableRating('passing')).toBe('Passing');
  });
});

describe('the sheet knows no sport', () => {
  it('renders a catalogue it has never seen', () => {
    const invented: CallOption[] = [
      { id: 'x', name: 'Overload the left', side: 'offence', blurb: 'Wide.', keys: ['crossing'] },
      { id: 'y', name: 'High press', side: 'defence', blurb: 'Squeeze.', keys: ['workRate'] },
    ];
    const { chosen } = mount({ calls: invented });
    expect(cards()).toHaveLength(2);
    pick('y');
    expect(chosen).toEqual([{ call: 'y' }]);
  });
});
