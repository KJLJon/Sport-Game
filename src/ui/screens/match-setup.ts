/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.2 — Match setup screens for Live and Playbook: sport, teams, difficulty, length,
 *          rules toggles
 * @story   US-10.2 — Set up an exhibition
 * @design  10-ui-ux.md §8.1 (pick a sport, then how to play), §7 (screen map), §10 (states),
 *          09-modes-and-arcade.md §1
 * @invariant INV-5 (the screen names no sport), INV-8 (the opponent is a function of its seed),
 *            INV-11 (44 px targets)
 *
 * Purpose: the screen between the Play hub and a Live match. Who you are, who you are playing, how
 * hard, how long, and which laws are in force.
 *
 * **The sport arrives on the URL, as it does for Playbook.** `10` §8.1 puts the sport choice one
 * screen earlier, so repeating it here would be two places to change one thing. What this screen
 * does is honour it — the squad size, the roster check, the opponent, and the heading all come from
 * the sport module.
 *
 * **Starting a match is a link, not a callback.** Everything chosen here encodes into query
 * parameters (`modes/match-setup.ts`), so the match is shareable, the back button returns to this
 * screen with the same choices, and T-8.4's resume can describe a match by its URL.
 *
 * **A save with too few athletes is told so here rather than at kickoff.** The deep link
 * `#/play/live/soccer` still opens a match from nothing — it falls back to seeded athletes — but a
 * player who came through this screen gets the honest sentence and a way to fix it (`10` §10).
 */
import { el } from '../dom.ts';
import { button } from '../components/button.ts';
import { emptyState, errorState } from '../components/states.ts';
import {
  difficultySection,
  lengthSection,
  opponentSection,
  rulesSection,
  setupSection,
  teamSection,
  type TeamChoice,
} from '../components/setup.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import {
  DEFAULT_MATCH_SETUP,
  decodeSetup,
  liveMatchHref,
  type MatchSetupChoice,
} from '../../modes/match-setup.ts';
import { isRosterProblem, resolveRosters } from '../../modes/rosters.ts';
import { lastDifficulty, rememberDifficulty } from '../../modes/last-played.ts';
import { loadSport } from '../../sports/playable.ts';
import type { SportModule } from '../../sports/types.ts';
import type { CpuTeam } from '../../teams/cpu-team.ts';
import { generateCpuTeam } from '../../teams/cpu-team.ts';
import './match-setup.css';

/**
 * A fresh opponent seed.
 *
 * Time-based rather than counter-based so two re-rolls in one session cannot collide, and recorded
 * in the link so the opponent you were shown is the opponent you play (INV-8).
 */
export function newOpponentSeed(): string {
  return `opponent-${Date.now().toString(36)}`;
}

/**
 * Whether this sport has an offside law worth offering a switch for.
 *
 * Asked of the sport through `ruleSwitches` rather than answered from a list of sport ids kept in
 * this file. The difference is INV-5: a screen that knows soccer flags offside and basketball does
 * not is a screen that has to be edited to add hockey.
 */
function hasOffside(sport: SportModule): boolean {
  return sport.ruleSwitches?.includes('offside') === true;
}

export function matchSetupScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const sport = await loadSport(context.params['sport'] ?? context.query['sport']);

      // The link's choices win over the defaults, and the remembered difficulty fills the gap — the
      // same precedence Playbook uses, so the two modes cannot disagree about "your difficulty".
      let choice: MatchSetupChoice = {
        ...decodeSetup(context.query, sport.id),
        difficulty: lastDifficulty(),
        opponentSeed: context.query['vs'] ?? newOpponentSeed(),
      };

      let db;
      try {
        db = await appDatabase();
      } catch {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'Your save could not be opened',
            body: 'A match needs your athletes. Try again, or repair the app from Settings.',
          }),
        );
        return;
      }

      const teams = await db.teams.getAll();
      const teamChoices: TeamChoice[] = teams
        .filter((team) => team.editable)
        .map((team) => ({ team, ready: true }));

      let opponent: CpuTeam = previewOpponent(choice, sport);

      const render = async (): Promise<void> => {
        const resolved = await resolveRosters({
          db,
          sport,
          teamId: choice.teamId,
          opponentSeed: choice.opponentSeed,
          difficulty: choice.difficulty,
        });

        if (isRosterProblem(resolved)) {
          context.host.replaceChildren(
            emptyState(doc, {
              heading: resolved.heading,
              body: resolved.body,
              action: { label: 'Go to the squad', href: '#/squad' },
            }),
          );
          return;
        }
        opponent = resolved.opponent;

        const rerender = (): void => {
          void render();
        };

        context.host.replaceChildren(
          el(doc, 'section', {
            class: 'match-setup',
            children: [
              el(doc, 'h1', {
                class: 'match-setup__title',
                text: `${sport.meta.displayName} · Live`,
              }),
              el(doc, 'p', {
                class: 'match-setup__lede',
                text: 'Your athletes, on the field, under your thumbs.',
              }),

              teamChoices.length === 0
                ? setupSection(doc, 'Who are you playing as?', [
                    el(doc, 'p', {
                      class: 'setup-section__hint',
                      text: 'Your athletes. Make a team in the Squad tab to play under a name and a crest.',
                    }),
                  ])
                : teamSection(doc, teamChoices, choice.teamId, (teamId) => {
                    choice = { ...choice, teamId };
                    rerender();
                  }),

              opponentSection(doc, opponent, () => {
                choice = { ...choice, opponentSeed: newOpponentSeed() };
                rerender();
              }),

              difficultySection(doc, choice.difficulty, (difficulty) => {
                choice = { ...choice, difficulty };
                // Remembered the moment it changes, because the match is reached by following a
                // link out of this screen: there is no later moment to record it in.
                rememberDifficulty(difficulty);
                rerender();
              }),

              lengthSection(doc, choice.length, (length) => {
                choice = { ...choice, length };
                rerender();
              }),

              rulesSection(doc, choice.rules, hasOffside(sport), (rules) => {
                choice = { ...choice, rules };
                rerender();
              }),

              el(doc, 'div', {
                class: 'match-setup__actions',
                children: [
                  button(doc, {
                    label: 'Kick off',
                    variant: 'primary',
                    size: 'large',
                    href: liveMatchHref(choice),
                  }),
                  button(doc, { label: 'Back', variant: 'ghost', href: '#/play' }),
                ],
              }),
            ],
          }),
        );
      };

      await render();
    },
  };
}

/** The opponent for the current choice, without touching the database. */
function previewOpponent(choice: MatchSetupChoice, sport: SportModule): CpuTeam {
  return generateCpuTeam({
    seed: `${choice.opponentSeed}:${sport.id}`,
    sportId: sport.id,
    size: sport.meta.squadSize,
    difficulty: choice.difficulty,
  });
}

export { DEFAULT_MATCH_SETUP };
