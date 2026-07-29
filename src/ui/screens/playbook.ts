/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.10 — Playbook flow UI: setup, turn screen, key-moment transition, results
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  10-ui-ux.md §8.4 (Playbook turn), §7 (screen map), 09-modes-and-arcade.md §2.1, §2.4, §4
 * @invariant INV-5 (the screen renders a `PlaybookAdapter`, and names no sport rule)
 *
 * Purpose: the setup screen — who is playing, against whom, how hard, how fast, and how often the
 * game hands you a moment. One tap from here starts a match.
 *
 * **Every choice on this screen is a choice `09` names.** Difficulty is §2.5's one ladder, key
 * moments are §2.4's frequency setting, turn speed and Auto-call are §2.1's, and the opponent is
 * §4's hot seat or the CPU. Nothing has been invented to fill the screen out.
 */
import { el } from '../dom.ts';
import { button } from '../components/button.ts';
import { segmented } from '../components/controls.ts';
import { emptyState, errorState } from '../components/states.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import type { Athlete } from '../../athletes/types.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES, type Difficulty } from '../../modes/difficulty.ts';
import { KEY_MOMENT_FREQUENCIES, type KeyMomentFrequency } from '../../modes/playbook/types.ts';
import { TURN_SPEEDS, type TurnSpeed } from '../../modes/playbook/pace.ts';
import { PARTY_LIMITS, seatPlayers } from '../../modes/local-players.ts';

const SQUAD_SIZE = 5;

/** What the setup screen collects, and what the match screen reads back off the URL. */
export interface PlaybookSetupChoice {
  readonly difficulty: Difficulty;
  readonly keyMoments: KeyMomentFrequency;
  readonly speed: TurnSpeed;
  readonly hotSeat: boolean;
}

export const DEFAULT_SETUP: PlaybookSetupChoice = {
  difficulty: 'pro',
  keyMoments: 'standard',
  speed: 'normal',
  hotSeat: false,
};

/** Plain-language labels. Colour and position never carry meaning on their own (`10` §11). */
const KEY_MOMENT_LABELS: Readonly<Record<KeyMomentFrequency, string>> = {
  off: 'Off',
  clutch: 'Clutch only',
  standard: 'Standard',
  every: 'Every chance',
};

const SPEED_LABELS: Readonly<Record<TurnSpeed, string>> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
  instant: 'Instant',
};

const KEY_MOMENT_BLURBS: Readonly<Record<KeyMomentFrequency, string>> = {
  off: 'Pure simulation. Your calls decide everything.',
  clutch: 'Only when the match is on the line.',
  standard: 'The big moments, a few times a quarter.',
  every: 'Play every chance yourself.',
};

/** Encodes the choice into a query string, so a match is a link and the back button works. */
export function setupQuery(choice: PlaybookSetupChoice): string {
  const params = [
    `difficulty=${choice.difficulty}`,
    `moments=${choice.keyMoments}`,
    `speed=${choice.speed}`,
  ];
  if (choice.hotSeat) params.push('hotseat=1');
  return params.join('&');
}

/** Reads it back, falling back to the defaults for anything a newer build wrote. */
export function readSetup(query: Readonly<Record<string, string>>): PlaybookSetupChoice {
  const difficulty = query['difficulty'];
  const moments = query['moments'];
  const speed = query['speed'];
  return {
    difficulty: (DIFFICULTIES as readonly string[]).includes(difficulty ?? '')
      ? (difficulty as Difficulty)
      : DEFAULT_SETUP.difficulty,
    keyMoments: (KEY_MOMENT_FREQUENCIES as readonly string[]).includes(moments ?? '')
      ? (moments as KeyMomentFrequency)
      : DEFAULT_SETUP.keyMoments,
    speed: (TURN_SPEEDS as readonly string[]).includes(speed ?? '')
      ? (speed as TurnSpeed)
      : DEFAULT_SETUP.speed,
    hotSeat: query['hotseat'] === '1',
  };
}

/** Enough athletes for two sides, or `null` with the reason. */
export function splitRoster(
  roster: readonly Athlete[],
): { home: readonly Athlete[]; away: readonly Athlete[] } | null {
  if (roster.length < SQUAD_SIZE) return null;
  const home = roster.slice(0, SQUAD_SIZE);
  // A short roster plays itself rather than refusing: `09` §2 does not promise two full squads, and
  // "you need ten athletes" is a worse first Playbook experience than a mirror match.
  const away = roster.length >= SQUAD_SIZE * 2 ? roster.slice(SQUAD_SIZE, SQUAD_SIZE * 2) : home;
  return { home, away };
}

export function playbookScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      let choice = readSetup(context.query);

      let roster: readonly Athlete[];
      try {
        const { athletes } = await appDatabase();
        roster = await athletes.getAll();
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'Your roster could not be opened',
            body: 'Playbook needs your athletes. Try again, or repair the app from Settings.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      if (splitRoster(roster) === null) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'Not enough athletes yet',
            body: `Playbook needs ${SQUAD_SIZE} to field a side. Create a few, or restore a backup.`,
            action: { label: 'Go to the squad', href: '#/squad' },
          }),
        );
        return;
      }

      const render = (): void => {
        const root = el(doc, 'section', { class: 'playbook-setup' });

        root.appendChild(el(doc, 'h1', { class: 'playbook-setup__title', text: 'Playbook' }));
        root.appendChild(
          el(doc, 'p', {
            class: 'playbook-setup__blurb',
            text: 'Call the plays. The match resolves from your athletes’ ratings, not your thumbs.',
          }),
        );

        root.appendChild(
          segmented(doc, {
            legend: 'Difficulty',
            name: 'playbook-difficulty',
            value: choice.difficulty,
            options: DIFFICULTIES.map((id) => ({
              value: id,
              label: DIFFICULTY_PROFILES[id].label,
            })),
            onChange: (value) => {
              choice = { ...choice, difficulty: value };
            },
          }),
        );

        root.appendChild(
          segmented(doc, {
            legend: 'Key moments',
            name: 'playbook-moments',
            value: choice.keyMoments,
            options: KEY_MOMENT_FREQUENCIES.map((id) => ({
              value: id,
              label: KEY_MOMENT_LABELS[id],
            })),
            onChange: (value) => {
              choice = { ...choice, keyMoments: value };
              blurb.textContent = KEY_MOMENT_BLURBS[value];
            },
          }),
        );

        const blurb = el(doc, 'p', {
          class: 'playbook-setup__hint',
          text: KEY_MOMENT_BLURBS[choice.keyMoments],
        });
        root.appendChild(blurb);

        root.appendChild(
          segmented(doc, {
            legend: 'Turn speed',
            name: 'playbook-speed',
            value: choice.speed,
            options: TURN_SPEEDS.map((id) => ({ value: id, label: SPEED_LABELS[id] })),
            onChange: (value) => {
              choice = { ...choice, speed: value };
            },
          }),
        );

        const seats = seatPlayers(PARTY_LIMITS.min);
        root.appendChild(
          segmented(doc, {
            legend: 'Opponent',
            name: 'playbook-opponent',
            value: choice.hotSeat ? 'hotseat' : 'cpu',
            options: [
              { value: 'cpu', label: 'CPU' },
              { value: 'hotseat', label: `Hot seat — ${seats[1]?.name ?? 'Player 2'}` },
            ],
            onChange: (value) => {
              choice = { ...choice, hotSeat: value === 'hotseat' };
            },
          }),
        );

        root.appendChild(
          button(doc, {
            label: 'Start match',
            variant: 'primary',
            size: 'large',
            onClick: () => context.navigate(`#/play/playbook/match?${setupQuery(choice)}`),
          }),
        );

        context.host.replaceChildren(root);
      };

      render();
    },
  };
}
