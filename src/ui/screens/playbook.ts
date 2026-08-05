/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.10 — Playbook flow UI: setup, turn screen, key-moment transition, results
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  10-ui-ux.md §8.4 (Playbook turn), §7 (screen map), §8.1 (pick a sport, then a mode),
 *          09-modes-and-arcade.md §2.1, §2.4, §4
 * @invariant INV-5 (the screen renders a `PlaybookAdapter`, and names no sport rule)
 *
 * Purpose: the setup screen — which sport, who is playing, against whom, how hard, how fast, and
 * how often the game hands you a moment. One tap from here starts a match.
 *
 * **Every choice on this screen is a choice `09` names.** Difficulty is §2.5's one ladder, key
 * moments are §2.4's frequency setting, turn speed and Auto-call are §2.1's, and the opponent is
 * §4's hot seat or the CPU. Nothing has been invented to fill the screen out.
 *
 * **The sport arrives on the URL rather than as a control here** (T-6.21). `10` §8.1 puts the sport
 * choice one screen earlier — the Play hub is "pick a sport, then pick how to play" — so repeating
 * it here would be two places to change one thing. What this screen does is *honour* it: the squad
 * size, the roster check, and the heading all come from the sport module, which is why the same
 * screen sets up a five-a-side basketball match and an eleven-a-side soccer one.
 */
import { el } from '../dom.ts';
import { button } from '../components/button.ts';
import { segmented } from '../components/controls.ts';
import { emptyState, errorState } from '../components/states.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import type { Athlete } from '../../athletes/types.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES, type Difficulty } from '../../modes/difficulty.ts';
import { lastDifficulty, rememberDifficulty } from '../../modes/last-played.ts';
import { KEY_MOMENT_FREQUENCIES, type KeyMomentFrequency } from '../../modes/playbook/types.ts';
import { TURN_SPEEDS, type TurnSpeed } from '../../modes/playbook/pace.ts';
import { PARTY_LIMITS, seatPlayers } from '../../modes/local-players.ts';
import { MATCH_LENGTHS, type MatchLength } from '../../modes/match-setup.ts';
import { seatList } from '../components/party.ts';
import { lengthSection } from '../components/setup.ts';
import { DEFAULT_SPORT, isPlayable, loadSport } from '../../sports/playable.ts';
import type { SportId } from '../../sports/types.ts';

/** What the setup screen collects, and what the match screen reads back off the URL. */
export interface PlaybookSetupChoice {
  readonly sport: SportId;
  readonly difficulty: Difficulty;
  readonly keyMoments: KeyMomentFrequency;
  readonly speed: TurnSpeed;
  readonly hotSeat: boolean;
  /**
   * How long a period runs (T-8.2), shared with Live so "Short" means the same thing in both modes.
   *
   * **The rules toggles Live gained are deliberately not here.** Soccer's Playbook adapter has no
   * foul model at all — it says so in its own header — so a fouls switch would do nothing in one
   * sport and something in the other, in one mode and not the other. A control that half-works is
   * the thing this codebase keeps deciding is worse than no control.
   */
  readonly length: MatchLength;
}

export const DEFAULT_SETUP: PlaybookSetupChoice = {
  sport: DEFAULT_SPORT,
  difficulty: 'pro',
  keyMoments: 'standard',
  speed: 'normal',
  hotSeat: false,
  length: 'full',
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

/**
 * Encodes the choice as router query parameters, so a match is a link and the back button works.
 *
 * Parameters, not a query *string*: `navigate(path, query)` builds and escapes the hash itself, and
 * handing it a pre-assembled `#/…?a=b` got the whole thing percent-encoded into one unmatchable
 * path segment — "Start match" landed on Not Found. Returning the record removes the temptation.
 */
export function setupParams(choice: PlaybookSetupChoice): Record<string, string> {
  return {
    sport: choice.sport,
    difficulty: choice.difficulty,
    moments: choice.keyMoments,
    speed: choice.speed,
    ...(choice.hotSeat ? { hotseat: '1' } : {}),
    ...(choice.length === DEFAULT_SETUP.length ? {} : { length: choice.length }),
  };
}

/** Reads it back, falling back to the defaults for anything a newer build wrote. */
export function readSetup(query: Readonly<Record<string, string>>): PlaybookSetupChoice {
  const sport = query['sport'];
  const difficulty = query['difficulty'];
  const moments = query['moments'];
  const speed = query['speed'];
  return {
    sport: isPlayable(sport) ? (sport as SportId) : DEFAULT_SETUP.sport,
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
    length: (MATCH_LENGTHS as readonly string[]).includes(query['length'] ?? '')
      ? (query['length'] as MatchLength)
      : DEFAULT_SETUP.length,
  };
}

/**
 * Enough athletes for two sides, or `null` with the reason.
 *
 * `size` is the sport's own `meta.squadSize` (T-6.21) — five for basketball, eleven for soccer.
 * It was a constant here while there was one Playbook sport, which is exactly the kind of hardcoded
 * five that stops a second sport from reaching the screen.
 */
export function splitRoster(
  roster: readonly Athlete[],
  size: number,
): { home: readonly Athlete[]; away: readonly Athlete[] } | null {
  if (roster.length < size) return null;
  const home = roster.slice(0, size);
  // A short roster plays itself rather than refusing: `09` §2 does not promise two full squads, and
  // "you need twenty-two athletes" is a worse first Playbook experience than a mirror match.
  const away = roster.length >= size * 2 ? roster.slice(size, size * 2) : home;
  return { home, away };
}

export function playbookScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      // The remembered level is the default, but a level in the link still wins — the same rule
      // Live follows, so the two modes cannot disagree about what "your difficulty" means (US-7.2).
      let choice = { ...readSetup(context.query), difficulty: lastDifficulty() };
      let seats = seatPlayers(PARTY_LIMITS.min);
      if (context.query['difficulty'] !== undefined) choice = readSetup(context.query);
      const module = await loadSport(choice.sport);
      const squadSize = module.meta.squadSize;

      // A sport reachable in Live but without a Playbook adapter is a real state — `catalogue.ts`
      // is what stops the player arriving here, and a hand-typed hash is what gets past it.
      if (module.playbook === undefined) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: `${module.meta.displayName} coaching is not built yet`,
            body: 'Pick another sport, or play this one live.',
            action: { label: 'Back to Play', href: '#/play' },
          }),
        );
        return;
      }

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

      if (splitRoster(roster, squadSize) === null) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'Not enough athletes yet',
            body: `${module.meta.displayName} Playbook needs ${squadSize} to field a side. Create a few, or restore a backup.`,
            action: { label: 'Go to the squad', href: '#/squad' },
          }),
        );
        return;
      }

      const render = (): void => {
        const root = el(doc, 'section', { class: 'playbook-setup' });

        root.appendChild(
          el(doc, 'h1', {
            class: 'playbook-setup__title',
            text: `${module.meta.displayName} Playbook`,
          }),
        );
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

        // Shared with Live (T-8.2), so "Short" means the same thing whichever mode you picked.
        root.appendChild(
          lengthSection(doc, choice.length, (length) => {
            choice = { ...choice, length };
            render();
          }),
        );

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
              render();
            },
          }),
        );

        // Who is in the other seat, editable here (T-8.15). Until now the only place a local name
        // could be typed was the arcade hub, so a Playbook hot-seat opponent stayed "Player 2" for
        // as long as they never opened Arcade — which is precisely what `US-17.3` is about.
        if (choice.hotSeat) {
          root.appendChild(
            el(doc, 'p', {
              class: 'playbook-setup__hint',
              text: 'Two people, one device. Names are kept on this device and never sent anywhere.',
            }),
          );
          root.appendChild(
            seatList(doc, {
              players: seats,
              onChange: (next) => {
                seats = next;
                render();
              },
            }),
          );
        }

        root.appendChild(
          button(doc, {
            label: 'Start match',
            variant: 'primary',
            size: 'large',
            onClick: () => {
              rememberDifficulty(choice.difficulty);
              context.navigate('/play/playbook/match', setupParams(choice));
            },
          }),
        );

        context.host.replaceChildren(root);
      };

      render();
    },
  };
}
