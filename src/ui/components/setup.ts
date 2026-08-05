/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.2 — Match setup screens for Live and Playbook: sport, teams, difficulty, length,
 *          rules toggles
 * @story   US-10.2 — Set up an exhibition
 * @design  10-ui-ux.md §8.1 (setup), §3.2 (targets), §11 (never colour alone),
 *          09-modes-and-arcade.md §2.5 (one difficulty ladder)
 * @invariant INV-6 (difficulty never touches an attribute), INV-11 (44 px targets, no information
 *            by colour alone)
 *
 * Purpose: the controls Live and Playbook both need, built once. Each returns a section element and
 * reports changes through a callback; none of them owns the choice, which stays with the screen.
 *
 * **Every control says what it does, not what it is called.** "Full — the sport's own match length"
 * rather than "Full"; "Fouls · whistle for contact" rather than a bare switch. A settings label
 * that only names itself asks the player to already know the answer.
 */
import { el } from '../dom.ts';
import { segmented, switchControl } from './controls.ts';
import { crest } from './crest.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES, type Difficulty } from '../../modes/difficulty.ts';
import {
  LENGTH_BLURBS,
  LENGTH_LABELS,
  MATCH_LENGTHS,
  type MatchLength,
  type RuleOptions,
} from '../../modes/match-setup.ts';
import type { CpuTeam } from '../../teams/cpu-team.ts';
import type { Team } from '../../teams/types.ts';

/** A titled block, so every section on both setup screens is shaped the same way. */
export function setupSection(
  doc: Document,
  title: string,
  children: readonly (Node | null)[],
  hint?: string,
): HTMLElement {
  return el(doc, 'div', {
    class: 'setup-section',
    children: [
      el(doc, 'h2', { class: 'setup-section__title', text: title }),
      ...children,
      hint === undefined ? null : el(doc, 'p', { class: 'setup-section__hint', text: hint }),
    ],
  });
}

export function difficultySection(
  doc: Document,
  value: Difficulty,
  onChange: (value: Difficulty) => void,
): HTMLElement {
  return setupSection(
    doc,
    'How hard should the CPU be?',
    [
      segmented(doc, {
        legend: 'Difficulty',
        name: 'setup-difficulty',
        value,
        options: DIFFICULTIES.map((id) => ({ value: id, label: DIFFICULTY_PROFILES[id].label })),
        onChange,
      }),
    ],
    // INV-6, said out loud on the screen where somebody would otherwise assume the opposite.
    'Difficulty changes how the CPU plays and how much help you get — never how good anyone is.',
  );
}

export function lengthSection(
  doc: Document,
  value: MatchLength,
  onChange: (value: MatchLength) => void,
): HTMLElement {
  return setupSection(doc, 'How long?', [
    segmented(doc, {
      legend: 'Match length',
      name: 'setup-length',
      value,
      options: MATCH_LENGTHS.map((id) => ({ value: id, label: LENGTH_LABELS[id] })),
      onChange,
    }),
    el(doc, 'p', { class: 'setup-section__hint', text: LENGTH_BLURBS[value] }),
  ]);
}

/**
 * The rules switches.
 *
 * `supportsOffside` comes from the sport rather than from a list here: a sport with no offside law
 * must not be offered a switch for one, and the screen must not be the place that knows which
 * sports those are (INV-5).
 */
export function rulesSection(
  doc: Document,
  value: RuleOptions,
  supportsOffside: boolean,
  onChange: (value: RuleOptions) => void,
): HTMLElement {
  return setupSection(
    doc,
    'Rules',
    [
      switchControl(doc, {
        label: 'Fouls',
        description: 'Whistle for contact. Off means nothing is ever given.',
        checked: value.fouls,
        onChange: (fouls) => onChange({ ...value, fouls }),
      }),
      supportsOffside
        ? switchControl(doc, {
            label: 'Offside',
            description: 'Flag attackers behind the last defender.',
            checked: value.offside,
            onChange: (offside) => onChange({ ...value, offside }),
          })
        : null,
    ],
    'Turning a rule off makes a looser, faster game. It does not make anyone better.',
  );
}

export interface TeamChoice {
  readonly team: Team;
  readonly ready: boolean;
}

/**
 * Which of the player's teams is playing, or "my athletes" when they have not made one.
 *
 * The "my athletes" option is always offered and always first, because a player who has never
 * opened the team editor still has a squad and still has to be able to start a match (`10` §10).
 */
export function teamSection(
  doc: Document,
  teams: readonly TeamChoice[],
  value: string | null,
  onChange: (teamId: string | null) => void,
): HTMLElement {
  const options = [
    { value: '', label: 'My athletes' },
    ...teams.map((choice) => ({ value: choice.team.id, label: choice.team.name })),
  ];

  return setupSection(doc, 'Who are you playing as?', [
    segmented(doc, {
      legend: 'Your team',
      name: 'setup-team',
      value: value ?? '',
      options,
      onChange: (id) => onChange(id === '' ? null : id),
    }),
  ]);
}

/**
 * The generated opponent, with a button to roll another (T-7.9).
 *
 * Shown rather than chosen from a list: the opponent is a function of a seed, so there is no list to
 * browse — there is one opponent per seed and an unlimited supply of seeds. Its crest and colours
 * are drawn because a name alone does not make a team feel like a team.
 */
export function opponentSection(
  doc: Document,
  opponent: CpuTeam,
  onReroll: () => void,
): HTMLElement {
  const identity = el(doc, 'div', {
    class: 'setup-opponent',
    children: [
      crest(doc, {
        crestId: opponent.team.crestId,
        colours: opponent.team.colours,
        size: 48,
        label: opponent.team.name,
      }),
      el(doc, 'div', {
        class: 'setup-opponent__text',
        children: [
          el(doc, 'p', { class: 'setup-opponent__name', text: opponent.team.name }),
          // The style is a sentence, not a colour or a bar: it is the one thing that tells you what
          // the match will feel like before you start it.
          el(doc, 'p', { class: 'setup-opponent__style', text: opponent.style.blurb }),
        ],
      }),
    ],
  });

  const reroll = el(doc, 'button', {
    class: 'button button--ghost',
    attrs: { type: 'button' },
    text: 'Another opponent',
    on: { click: onReroll },
  });

  return setupSection(doc, 'Against', [identity, reroll]);
}
