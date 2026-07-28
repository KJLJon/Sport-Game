/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.3 — Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint
 * @task    T-4.4 — Practice / scored / daily modes; seeded daily challenge
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.2 — Earn my mini-games
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @story   US-16.4 — Take a daily challenge
 * @design  09-modes-and-arcade.md §3 (arcade mode), 10-ui-ux.md §7 (screen map), §10 (states)
 * @invariant INV-3 (all storage through `src/storage/`), INV-10 (windows come from the athlete)
 *
 * Purpose: the screen behind `#/play/arcade`. A grid of games, the mode you want to play them in,
 * the athlete you want to play them with, and — for each — the honest statement of how wide that
 * athlete's window is here.
 *
 * **The window hint is the feature, not decoration.** US-16.3 asks the picker to "state plainly
 * whether this athlete's window here is wide or narrow", and it is the only place the fairness rule
 * becomes visible before you play. So it is on every tile, in words, recomputed when the athlete
 * changes — never a colour, never a bar on its own.
 *
 * A locked tile says what unlocks it (US-16.2) and never how to buy it, because there is no way to
 * buy it.
 */
import type { Athlete } from '../../athletes/types.ts';
import { basketball } from '../../sports/basketball/index.ts';
import { arcadeCatalogue } from '../../modes/arcade/registry.ts';
import { challengeCode, dailyChallenge, dateKey } from '../../modes/arcade/daily.ts';
import { starLine } from '../../modes/arcade/scoring.ts';
import { ARCADE_MODE_BLURBS } from '../../modes/arcade/modes.ts';
import { earnedAchievements, unlockStates } from '../../modes/arcade/unlocks.ts';
import { ArcadeRepository, type ArcadeBest } from '../../modes/arcade/records.ts';
import { ARCADE_MODES, type ArcadeGameDef, type ArcadeMode } from '../../modes/arcade/types.ts';
import { appDatabase } from '../../storage/app-db.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { button } from '../components/button.ts';
import { segmented } from '../components/controls.ts';
import { starRating } from '../components/meters.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import { el } from '../dom.ts';
import './arcade.css';

const MODE_LABELS: Readonly<Record<ArcadeMode, string>> = {
  practice: 'Practice',
  scored: 'Scored',
  daily: 'Daily',
};

/** The catalogue this build has. One sport today; soccer's five join it in Phase 6 (`09` §5). */
function catalogue(): readonly ArcadeGameDef[] {
  return arcadeCatalogue([basketball]);
}

function bestLine(best: ArcadeBest | undefined): string {
  return best === undefined
    ? 'No runs yet'
    : `Best ${best.score.toLocaleString('en-GB')} · ${best.runs} run${best.runs === 1 ? '' : 's'}`;
}

export function arcadeScreen(): Screen {
  let cleanup: (() => void) | null = null;

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      context.host.replaceChildren(skeleton(doc, { lines: 4, label: 'Loading the arcade' }));

      const games = catalogue();
      let athletes: Athlete[];
      let bests: ReadonlyMap<string, ArcadeBest>;
      let unlocked: ReadonlyMap<string, { unlocked: boolean; requirement: string }>;

      try {
        const db = await appDatabase();
        const arcade = new ArcadeRepository(db.db);
        [athletes, bests, unlocked] = await Promise.all([
          db.athletes.getAll(),
          arcade.overallBests(),
          earnedAchievements(db.db).then((earned) => unlockStates(games, earned)),
        ]);
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'The arcade could not be opened',
            body: 'This build cannot read what is saved. Nothing has been changed or lost.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      let mode: ArcadeMode = 'scored';
      let chosen: Athlete | undefined = athletes[0];

      const section = el(doc, 'section', { class: 'arcade' });
      const grid = el(doc, 'div', { class: 'arcade__grid' });
      const hintHost = el(doc, 'div', { class: 'arcade__picker' });

      const play = (game: ArcadeGameDef): void => {
        const query: Record<string, string> = { mode };
        if (chosen !== undefined && mode !== 'daily') query['athlete'] = chosen.id;
        context.navigate(`/play/arcade/${game.id}`, query);
      };

      /** One tile. Rebuilt whenever the athlete or the mode changes, because the hint moves. */
      const tile = (game: ArcadeGameDef): HTMLElement => {
        const state = unlocked.get(game.id) ?? { unlocked: true, requirement: '' };
        const best = bests.get(game.id);
        const calibration = chosen === undefined ? null : game.calibrate(chosen, 'pro');

        const children = [
          el(doc, 'h3', { class: 'arcade-tile__name', text: game.name }),
          el(doc, 'p', { class: 'arcade-tile__blurb', text: game.blurb }),
          state.unlocked
            ? el(doc, 'div', {
                class: 'arcade-tile__meta',
                children: [
                  starRating(doc, {
                    value: best?.stars ?? 0,
                    label: `${best?.stars ?? 0} of 3 stars at ${game.name}`,
                  }),
                  el(doc, 'span', { class: 'arcade-tile__best', text: bestLine(best) }),
                ],
              })
            : el(doc, 'p', {
                class: 'arcade-tile__locked',
                // `10` §11 — the lock is stated in words, not signalled by a dimmed colour.
                text: `Locked — ${state.requirement}`,
              }),
          state.unlocked && calibration !== null
            ? el(doc, 'p', { class: 'arcade-tile__hint', text: calibration.hint })
            : null,
          el(doc, 'p', {
            class: 'arcade-tile__stars',
            text: `${game.durationSeconds}s · stars at ${starLine(game)}`,
          }),
        ];

        if (!state.unlocked) {
          return el(doc, 'article', {
            class: 'arcade-tile arcade-tile--locked',
            children,
          });
        }

        return el(doc, 'button', {
          class: 'arcade-tile',
          attrs: { type: 'button' },
          on: { click: () => play(game) },
          children,
        });
      };

      const renderGrid = (): void => {
        grid.replaceChildren(...games.map(tile));
      };

      /** The athlete picker. A `<select>`, so it is one tap and works with every assistive tool. */
      const renderPicker = (): void => {
        if (mode === 'daily') {
          const challenge = dailyChallenge(dateKey(), games);
          hintHost.replaceChildren(
            el(doc, 'div', {
              class: 'arcade__daily',
              children: [
                el(doc, 'h2', { class: 'arcade__daily-title', text: "Today's challenge" }),
                challenge === null
                  ? el(doc, 'p', { text: 'No games are available yet.' })
                  : el(doc, 'div', {
                      children: [
                        el(doc, 'p', {
                          text: `${challenge.game.name} with ${challenge.athlete.displayName}. The same run for everybody, everywhere, until midnight UTC.`,
                        }),
                        el(doc, 'ul', {
                          class: 'arcade__modifiers',
                          children: challenge.modifiers.map((modifier) =>
                            el(doc, 'li', { text: `${modifier.name} — ${modifier.description}` }),
                          ),
                        }),
                        el(doc, 'p', {
                          class: 'arcade__code',
                          text: `Challenge code: ${challengeCode(challenge)}`,
                        }),
                        button(doc, {
                          label: `Play ${challenge.game.name}`,
                          variant: 'primary',
                          onClick: () => play(challenge.game),
                        }),
                      ],
                    }),
              ],
            }),
          );
          return;
        }

        if (athletes.length === 0) {
          hintHost.replaceChildren(
            emptyState(doc, {
              heading: 'No athletes yet',
              body: 'Arcade games are calibrated to an athlete, so pick one up first.',
              action: { label: 'Make an athlete', href: '#/squad/athlete/new' },
            }),
          );
          return;
        }

        const select = el(doc, 'select', {
          class: 'arcade__athlete',
          attrs: { id: 'arcade-athlete' },
          children: athletes.map((subject) =>
            el(doc, 'option', {
              text: `${subject.displayName} — ${subject.primarySport}`,
              attrs: { value: subject.id, selected: subject.id === chosen?.id },
            }),
          ),
          on: {
            change: (event) => {
              const id = (event.target as HTMLSelectElement).value;
              chosen = athletes.find((subject) => subject.id === id) ?? chosen;
              renderGrid();
            },
          },
        });

        hintHost.replaceChildren(
          el(doc, 'label', {
            class: 'arcade__athlete-label',
            attrs: { for: 'arcade-athlete' },
            text: 'Playing as',
          }),
          select,
          el(doc, 'p', {
            class: 'arcade__picker-note',
            text: 'Every game states how wide this athlete’s window is before you start.',
          }),
        );
      };

      section.append(
        el(doc, 'p', { class: 'arcade__lede', text: ARCADE_MODE_BLURBS[mode] }),
        segmented(doc, {
          legend: 'How to play',
          name: 'arcade-mode',
          value: mode,
          options: ARCADE_MODES.map((value) => ({ value, label: MODE_LABELS[value] })),
          onChange: (value) => {
            mode = value;
            const lede = section.querySelector('.arcade__lede');
            if (lede !== null) lede.textContent = ARCADE_MODE_BLURBS[mode];
            renderPicker();
            renderGrid();
          },
        }),
        hintHost,
        grid,
      );

      renderPicker();
      renderGrid();
      context.host.replaceChildren(section);
      cleanup = () => {
        grid.replaceChildren();
      };
    },

    unmount(): void {
      cleanup?.();
      cleanup = null;
    },
  };
}
