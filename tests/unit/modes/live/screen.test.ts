/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.11 — Pause menu, quit, in-match settings, post-match summary with box score
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §4 (match presentation), 10-ui-ux.md §6 (accessibility)
 * @invariant INV-11 (44 px targets; no information by colour alone)
 *
 * @vitest-environment jsdom
 *
 * Purpose: the panels a player reads when the game stops. The box score is asserted as a real
 * table with row and column headers, because "shows the box score" and "a screen reader can read
 * the box score" are different claims and only one of them is worth making.
 */
import { describe, expect, it } from 'vitest';
import { LiveMatch, simulateMatch } from '@/modes/live/match.ts';
import { basketball } from '@/sports/basketball/index.ts';
import {
  boxTable,
  pausePanel,
  readSafeArea,
  resultText,
  settingsPanel,
  summaryPanel,
  type MatchSettings,
} from '@/modes/live/screen.ts';

function played(steps = 4000): LiveMatch {
  const match = new LiveMatch({ seed: 'panel', sport: basketball, playerSide: 0 });
  for (let i = 0; i < steps; i++) match.step();
  return match;
}

describe('the pause menu', () => {
  it('is a modal dialog with resume first', () => {
    const match = played();
    const panel = pausePanel(document, match, { onResume: () => {}, onQuit: () => {} });

    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');

    const buttons = [...panel.querySelectorAll('button')];
    expect(buttons[0]?.textContent).toBe('Resume');
    expect(buttons.map((b) => b.textContent)).toContain('Quit match');
  });

  it('resumes and quits through its callbacks, not by reaching into the match', () => {
    const match = played();
    let resumed = 0;
    let quit = 0;
    const panel = pausePanel(document, match, { onResume: () => resumed++, onQuit: () => quit++ });
    const buttons = [...panel.querySelectorAll('button')];

    buttons[0]?.click();
    buttons[1]?.click();
    expect(resumed).toBe(1);
    expect(quit).toBe(1);
  });

  it('shows the score and the period, so you know what you paused', () => {
    const match = played();
    const view = match.view();
    const text =
      pausePanel(document, match, { onResume: () => {}, onQuit: () => {} }).textContent ?? '';
    expect(text).toContain(String(view.score[0]));
    expect(text).toContain(`${view.periodName} ${view.period}`);
  });
});

describe('in-match settings', () => {
  it('are labelled checkboxes that change the setting they name', () => {
    const settings: MatchSettings = {
      leftHanded: false,
      sound: true,
      cameraMotion: 'full' as const,
    };
    let changes = 0;
    const group = settingsPanel(document, settings, () => changes++);
    // Connected, because a checkbox's activation behaviour needs a document to happen in.
    document.body.appendChild(group);

    expect(group.querySelector('legend')?.textContent).toBe('Match settings');
    const boxes = [...group.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    // Each control has a label pointing at it, so the accessible name is the visible text.
    for (const box of boxes) {
      expect(group.querySelector(`label[for="${box.id}"]`)?.textContent).toBeTruthy();
    }

    boxes[0]?.click();
    expect(settings.leftHanded).toBe(true);
    expect(changes).toBe(1);

    boxes[1]?.click();
    expect(settings.sound).toBe(false);
  });

  it('offers the camera as three named choices rather than a checkbox (T-12.7)', () => {
    const settings: MatchSettings = { leftHanded: false, sound: true, cameraMotion: 'full' };
    let changes = 0;
    const group = settingsPanel(document, settings, () => changes++);
    document.body.appendChild(group);

    const select = group.querySelector('select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect([...(select?.options ?? [])].map((o) => o.value)).toEqual(['full', 'reduced', 'fixed']);
    // Three because there are three answers, and the middle one — follows the play, calmly — is
    // what most people who dislike a moving camera actually want.
    expect(group.querySelector(`label[for="${select?.id}"]`)?.textContent).toBe('Camera');

    if (select !== null) {
      select.value = 'reduced';
      select.dispatchEvent(new Event('change'));
    }
    expect(settings.cameraMotion).toBe('reduced');
    expect(changes).toBe(1);
  });

  it('appear in the pause menu only when the caller offers them', () => {
    const match = played();
    const without = pausePanel(document, match, { onResume: () => {}, onQuit: () => {} });
    expect(without.querySelector('fieldset')).toBeNull();

    const withSettings = pausePanel(document, match, {
      onResume: () => {},
      onQuit: () => {},
      settings: { leftHanded: false, sound: true, cameraMotion: 'full' as const },
    });
    expect(withSettings.querySelector('fieldset')).not.toBeNull();
  });
});

describe('the post-match summary', () => {
  it('states the result in words, not only in numbers', () => {
    expect(resultText(90, 80, 0)).toBe('You win.');
    expect(resultText(90, 80, 1)).toBe('You lose.');
    expect(resultText(80, 80, 0)).toBe('Tied.');
    // A spectated match has no "you".
    expect(resultText(90, 80, -1)).toBe('Home win.');
    expect(resultText(80, 90, -1)).toBe('Away win.');
  });

  it('shows the final score and a way out', { timeout: 20_000 }, () => {
    const match = simulateMatch({ seed: 'done', sport: basketball, playerSide: 0 });
    let done = 0;
    const panel = summaryPanel(document, match, () => done++);

    expect(panel.textContent).toContain('Full time');
    const button = panel.querySelector('button');
    button?.click();
    expect(done).toBe(1);
  });
});

describe('the box score table', () => {
  it('is a table a screen reader can navigate', () => {
    const match = played();
    const wrapper = boxTable(document, match);
    const tables = wrapper.querySelectorAll('table');

    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.querySelector('caption')).not.toBeNull();
      expect([...table.querySelectorAll('th[scope="col"]')].map((th) => th.textContent)).toEqual([
        'Athlete',
        'PTS',
        'FG',
        'REB',
        'AST',
      ]);
      // Every body row names its athlete in a row header, not a plain cell.
      expect(table.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0);
    }
  });

  it('ends each side with a team total that matches the scoreboard', () => {
    const match = played();
    const wrapper = boxTable(document, match);
    const rows = wrapper.querySelectorAll('table:first-of-type tbody tr');
    const last = rows[rows.length - 1];

    expect(last?.querySelector('th')?.textContent).toBe('Team');
    expect(last?.querySelectorAll('td')[0]?.textContent).toBe(String(match.view().score[0]));
  });
});

describe('safe-area reading', () => {
  it('reads the insets the shell publishes, and copes when it has published none', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    element.style.setProperty('--safe-top', '24px');

    const insets = readSafeArea(window, element);
    expect(insets.top).toBe(24);
    // Unset custom properties parse to NaN; the layout must never see one.
    expect(Number.isFinite(insets.bottom)).toBe(true);
    expect(insets.bottom).toBe(0);
  });
});
