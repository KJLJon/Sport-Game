/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.8 — Assist system: aim, pass, auto-switch, timing forgiveness
 * @story   US-7.3 — Get help without being carried
 * @design  06-game-design.md §2 (assists), 10-ui-ux.md §5 (components), §11 (accessibility)
 *
 * Purpose: the four assist dials, as a screen. `06` §2 says they are tunable independently of
 * difficulty, which only means anything if there is somewhere to tune them.
 *
 * Two things the screen has to say out loud, because neither is guessable:
 *
 * 1. **What each assist actually does.** "Aim assist" is not self-explanatory to anyone who has not
 *    built one, and a family-friendly game cannot ship a settings screen that assumes the reader
 *    already knows.
 * 2. **Whether the no-assist bonus is currently live.** It is the reward for turning help off
 *    (US-7.3), so the moment it switches on or off is the moment to say so — and it is stated as a
 *    sentence, never as a colour (`10` §11).
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { NO_ASSIST_BONUS, assistsOff, type AssistSettings } from '../../modes/assists.ts';
import {
  assistsAreCustom,
  lastDifficulty,
  loadAssists,
  resetAssists,
  saveAssists,
} from '../../modes/last-played.ts';
import { DIFFICULTY_PROFILES } from '../../modes/difficulty.ts';
import { button } from '../components/button.ts';
import { segmented, switchControl } from '../components/controls.ts';
import { el } from '../dom.ts';

/** The four strengths a 0–1 dial offers. Named, because "0.65" is not a setting anyone chooses. */
const STRENGTHS = [
  { value: 'off', label: 'Off', amount: 0 },
  { value: 'light', label: 'Light', amount: 0.3 },
  { value: 'moderate', label: 'Moderate', amount: 0.65 },
  { value: 'strong', label: 'Strong', amount: 1 },
] as const;

type StrengthName = (typeof STRENGTHS)[number]['value'];

/** The three release-window widths, as multipliers (`06` §7's "your shot-timing window" row). */
const WINDOWS = [
  { value: 'tight', label: 'Tight', amount: 0.8 },
  { value: 'normal', label: 'Normal', amount: 1 },
  { value: 'generous', label: 'Generous', amount: 1.35 },
] as const;

type WindowName = (typeof WINDOWS)[number]['value'];

/** The named strength nearest a stored amount — old builds and hand-edited storage both land here. */
export function strengthOf(amount: number): StrengthName {
  let best: StrengthName = 'off';
  let distance = Infinity;
  for (const strength of STRENGTHS) {
    const gap = Math.abs(strength.amount - amount);
    if (gap < distance) {
      distance = gap;
      best = strength.value;
    }
  }
  return best;
}

export function windowOf(amount: number): WindowName {
  let best: WindowName = 'normal';
  let distance = Infinity;
  for (const size of WINDOWS) {
    const gap = Math.abs(size.amount - amount);
    if (gap < distance) {
      distance = gap;
      best = size.value;
    }
  }
  return best;
}

function amountOf(name: StrengthName): number {
  return STRENGTHS.find((strength) => strength.value === name)?.amount ?? 0;
}

function windowAmountOf(name: WindowName): number {
  return WINDOWS.find((size) => size.value === name)?.amount ?? 1;
}

/** The sentence under the switches: whether the bonus is live, and what it is worth. */
export function bonusText(assists: AssistSettings): string {
  const percent = Math.round(NO_ASSIST_BONUS * 100);
  return assistsOff(assists)
    ? `No assists: you are earning ${percent}% more coins and XP.`
    : `Turn all four off to earn ${percent}% more coins and XP.`;
}

export function assistsScreen(): Screen {
  return {
    mount({ host }: ScreenContext): void {
      render(host);
    },
  };
}

/**
 * Draws the screen into `host`. Separate from `mount` so that "follow my difficulty again" can
 * redraw by calling it: the controls read their value once at build time, so a reset that leaves
 * them showing the old choice would be lying about what is stored.
 */
function render(host: Element): void {
  const doc = host.ownerDocument as Document;

  let assists = loadAssists();
  const bonus = el(doc, 'p', { class: 'panel__note', text: bonusText(assists) });
  const source = el(doc, 'p', { class: 'panel__note' });

  const describeSource = (): void => {
    source.textContent = assistsAreCustom()
      ? 'These are your settings. They apply at every difficulty.'
      : `Following ${DIFFICULTY_PROFILES[lastDifficulty()].label}’s defaults. Change anything to make them yours.`;
  };

  const update = (next: AssistSettings): void => {
    assists = next;
    saveAssists(next);
    bonus.textContent = bonusText(next);
    describeSource();
  };

  describeSource();

  const dials = el(doc, 'div', {
    class: 'panel',
    children: [
      el(doc, 'h2', { class: 'panel__title', text: 'Aiming' }),
      segmented(doc, {
        legend: 'Aim assist',
        name: 'assist-aim',
        value: strengthOf(assists.aim),
        options: STRENGTHS.map((strength) => ({
          value: strength.value,
          label: strength.label,
        })),
        onChange: (value) => update({ ...assists, aim: amountOf(value) }),
      }),
      el(doc, 'p', {
        class: 'panel__note',
        text: 'How much a shot or a pass is nudged towards what you plainly meant.',
      }),
      segmented(doc, {
        legend: 'Pass assist',
        name: 'assist-pass',
        value: strengthOf(assists.pass),
        options: STRENGTHS.map((strength) => ({
          value: strength.value,
          label: strength.label,
        })),
        onChange: (value) => update({ ...assists, pass: amountOf(value) }),
      }),
      el(doc, 'p', {
        class: 'panel__note',
        text: 'How generously a pass finds the teammate you are pointing at.',
      }),
    ],
  });

  const timing = el(doc, 'div', {
    class: 'panel',
    children: [
      el(doc, 'h2', { class: 'panel__title', text: 'Timing and control' }),
      segmented(doc, {
        legend: 'Shot-timing window',
        name: 'assist-timing',
        value: windowOf(assists.timing),
        options: WINDOWS.map((size) => ({ value: size.value, label: size.label })),
        onChange: (value) => update({ ...assists, timing: windowAmountOf(value) }),
      }),
      el(doc, 'p', {
        class: 'panel__note',
        text: 'How forgiving the release is. It changes the window, never whether the shot goes in.',
      }),
      switchControl(doc, {
        label: 'Auto-switch',
        checked: assists.autoSwitch,
        description: 'Take control of whoever is nearest the ball when possession changes.',
        onChange: (checked) => update({ ...assists, autoSwitch: checked }),
      }),
    ],
  });

  host.replaceChildren(
    el(doc, 'section', {
      class: 'stack',
      children: [
        el(doc, 'p', {
          class: 'panel__note',
          text: 'Assists are separate from difficulty. You can play Legend with all the help, or Rookie with none.',
        }),
        source,
        dials,
        timing,
        bonus,
        el(doc, 'div', {
          class: 'panel',
          children: [
            button(doc, {
              label: 'Follow my difficulty again',
              variant: 'ghost',
              onClick: () => {
                resetAssists();
                render(host);
              },
            }),
          ],
        }),
      ],
    }),
  );
}
