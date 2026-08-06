/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.3 — Tournament mode: 4/8/16 bracket, persistence, results, rewards; playable in Live
 *          or Playbook
 * @story   US-7.4 — Play a tournament
 * @design  10-ui-ux.md §7 (Progress → Tournaments), §10 (states), 05-data-model.md §5.3 (the prize)
 * @invariant INV-9 (a tournament match is an ordinary match), INV-11 (44 px targets; the bracket is
 *            a list, not a picture)
 *
 * Purpose: start a tournament, see the bracket, play the next match, collect the prize.
 *
 * **The result is claimed on return, not reported by the match.** The player leaves for an ordinary
 * Live or Playbook match and comes back; this screen looks for a `MatchRecord` filed since they
 * left and advances the bracket with it. That is what keeps `modes/live/` and `modes/playbook/`
 * ignorant of tournaments — they file the same record they always did, and the bracket reads it.
 *
 * **The bracket is a list of rounds, not a drawing.** A drawn bracket is illegible at 360 px and
 * impossible for a screen reader; rounds as headed lists say the same thing and can be read aloud.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import {
  TOURNAMENT_PRIZE_COINS,
  TOURNAMENT_SIZES,
  clearTournament,
  createTournament,
  nextOpponent,
  playerMatch,
  readTournament,
  recordPlayerResult,
  roundName,
  saveTournament,
  standingText,
  startPlayerMatch,
  type Tournament,
  type TournamentSize,
} from '../../modes/tournament.ts';
import { MetaKind } from '../../achievements/types.ts';
import { recordMetaEvents } from '../../achievements/session.ts';
import { resultOf, type MatchRecord, type StatMode } from '../../stats/types.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '../../modes/difficulty.ts';
import { PLAYABLE_SPORTS, playableSport } from '../../sports/playable.ts';
import { button } from '../components/button.ts';
import { coinPill } from '../components/meters.ts';
import { errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import type { SportId } from '../../sports/types.ts';
import type { Difficulty } from '../../modes/difficulty.ts';
import './tournament.css';

/** Where a tournament match is played. The bracket does not care which; the player does. */
function matchHref(tournament: Tournament): string {
  return tournament.mode === 'live'
    ? `#/play/live/${tournament.sport}?difficulty=${tournament.difficulty}`
    : `#/play/playbook/match?sport=${tournament.sport}&difficulty=${tournament.difficulty}`;
}

/** The record the player's tournament match produced, if they have played one since leaving. */
export function claimableResult(
  tournament: Tournament,
  history: readonly MatchRecord[],
): MatchRecord | null {
  if (tournament.pending === null) return null;
  return (
    history.find(
      (record) =>
        record.playedAt >= tournament.pending!.since &&
        record.sportId === tournament.sport &&
        record.mode === tournament.mode,
    ) ?? null
  );
}

function bracketList(doc: Document, tournament: Tournament): HTMLElement {
  return el(doc, 'div', {
    class: 'tournament__bracket',
    children: tournament.rounds.map((round, roundIndex) =>
      el(doc, 'section', {
        class: 'tournament__round',
        dataset: { current: String(roundIndex === tournament.round) },
        children: [
          el(doc, 'h3', {
            class: 'tournament__round-name',
            text: roundName(tournament.size, roundIndex),
          }),
          el(doc, 'ul', {
            class: 'tournament__matches',
            children: round.map((match) => {
              const home = match.home === null ? null : tournament.entrants[match.home];
              const away = match.away === null ? null : tournament.entrants[match.away];
              const decided = match.winner !== null;
              const winnerName =
                match.winner === null ? '' : (tournament.entrants[match.winner]?.name ?? '');

              return el(doc, 'li', {
                class: 'tournament__match',
                dataset: {
                  played: String(decided),
                  player: String(home?.player === true || away?.player === true),
                },
                children: [
                  el(doc, 'span', {
                    class: 'tournament__pair',
                    text: `${home?.name ?? 'TBC'} v ${away?.name ?? 'TBC'}`,
                  }),
                  el(doc, 'span', {
                    class: 'tournament__outcome',
                    // The winner in words, and the score when it was actually played. A bracket
                    // that only bolded the winner would say nothing to a screen reader.
                    text: decided
                      ? match.score === null
                        ? `${winnerName} through`
                        : `${winnerName} through, ${match.score[0]}–${match.score[1]}`
                      : 'To play',
                  }),
                ],
              });
            }),
          }),
        ],
      }),
    ),
  });
}

export function tournamentScreen(): Screen {
  return {
    async mount({ host, navigate }: ScreenContext): Promise<void> {
      const doc = host.ownerDocument;
      let tournament: Tournament | null;

      try {
        tournament = await readTournament((await appDatabase()).db);
      } catch {
        host.replaceChildren(
          errorState(doc, {
            heading: 'Your tournament could not be read',
            body: 'Try again, or repair the app from Settings.',
            action: { label: 'Back to Progress', href: '#/progress' },
          }),
        );
        return;
      }

      // ── claim a result the player went away and earned ─────────────────
      if (tournament !== null && tournament.pending !== null) {
        const db = await appDatabase();
        const record = claimableResult(tournament, await db.matches.recent(20));
        if (record !== null) {
          const result = resultOf(record);
          const side = record.playerSide === 1 ? 1 : 0;
          tournament = recordPlayerResult(tournament, {
            won: result === 'win',
            score: [record.score[side], record.score[side === 0 ? 1 : 0]],
          });
          await saveTournament(db.db, tournament);

          if (tournament.status === 'won') {
            // `05` §5.3 — 1 500 coins and a Gold pack, paid once, when the final is won.
            await db.economy.earn(TOURNAMENT_PRIZE_COINS, 'tournament', 'Tournament won');
            await db.economy.owePack('gold');
            void recordMetaEvents(db, [
              { kind: MetaKind.TOURNAMENT_WON, at: Date.now(), detail: { size: tournament.size } },
            ]);
          }
        }
      }

      const start = async (
        sport: SportId,
        mode: StatMode,
        difficulty: Difficulty,
        size: TournamentSize,
      ): Promise<void> => {
        const db = await appDatabase();
        const now = Date.now();
        const created = createTournament({
          seed: `tournament-${now.toString(36)}`,
          sport,
          mode,
          difficulty,
          size,
          playerTeamName: 'Your team',
          now,
        });
        await saveTournament(db.db, created);
        navigate('/progress/tournament');
      };

      const play = async (): Promise<void> => {
        if (tournament === null) return;
        const db = await appDatabase();
        const started = startPlayerMatch(tournament, Date.now());
        await saveTournament(db.db, started);
        // An ordinary match link. The bracket claims the record when the player comes back.
        globalThis.location.hash = matchHref(started);
      };

      const abandon = async (): Promise<void> => {
        await clearTournament((await appDatabase()).db);
        navigate('/progress/tournament');
      };

      // ── the setup form, when there is no tournament ─────────────────────
      if (tournament === null) {
        let sport: SportId = PLAYABLE_SPORTS[0]?.id ?? 'basketball';
        let mode: StatMode = 'live';
        let difficulty: Difficulty = 'pro';
        let size: TournamentSize = 8;

        const choose = <T extends string>(
          id: string,
          label: string,
          options: readonly (readonly [T, string])[],
          value: T,
          onChange: (next: T) => void,
        ): HTMLElement =>
          el(doc, 'div', {
            class: 'tournament__field',
            children: [
              el(doc, 'label', { text: label, attrs: { for: id } }),
              el(doc, 'select', {
                class: 'tournament__select',
                attrs: { id },
                on: { change: (event) => onChange((event.target as HTMLSelectElement).value as T) },
                children: options.map(([optionValue, text]) =>
                  el(doc, 'option', {
                    text,
                    attrs: { value: optionValue, selected: optionValue === value },
                  }),
                ),
              }),
            ],
          });

        host.replaceChildren(
          el(doc, 'section', {
            class: 'tournament',
            children: [
              el(doc, 'h1', { class: 'tournament__title', text: 'Tournament' }),
              el(doc, 'p', {
                class: 'tournament__note',
                text: `Single elimination against CPU teams. Win it for ${TOURNAMENT_PRIZE_COINS.toLocaleString('en-US')} coins and a Gold pack.`,
              }),
              choose(
                'tournament-sport',
                'Sport',
                PLAYABLE_SPORTS.map((entry) => [entry.id, entry.displayName] as const),
                sport,
                (next) => {
                  sport = next;
                },
              ),
              choose(
                'tournament-mode',
                'Mode',
                [
                  ['live', 'Live'],
                  ['playbook', 'Playbook'],
                ] as const,
                mode,
                (next) => {
                  mode = next;
                },
              ),
              choose(
                'tournament-difficulty',
                'Difficulty',
                DIFFICULTIES.map((entry) => [entry, DIFFICULTY_PROFILES[entry].label] as const),
                difficulty,
                (next) => {
                  difficulty = next;
                },
              ),
              choose(
                'tournament-size',
                'Teams',
                TOURNAMENT_SIZES.map((entry) => [String(entry), `${entry} teams`] as const),
                String(size),
                (next) => {
                  size = Number(next) as TournamentSize;
                },
              ),
              button(doc, {
                label: 'Start tournament',
                variant: 'primary',
                size: 'large',
                onClick: () => {
                  void start(sport, mode, difficulty, size);
                },
              }),
            ],
          }),
        );
        return;
      }

      // ── the running (or finished) bracket ───────────────────────────────
      const running = tournament.status === 'running';
      const opponent = nextOpponent(tournament);
      const slot = playerMatch(tournament);

      host.replaceChildren(
        el(doc, 'section', {
          class: 'tournament',
          children: [
            el(doc, 'h1', {
              class: 'tournament__title',
              text: `${playableSport(tournament.sport).displayName} tournament`,
            }),
            el(doc, 'p', { class: 'tournament__standing', text: standingText(tournament) }),
            el(doc, 'p', {
              class: 'tournament__note',
              text: `${tournament.size} teams · ${tournament.mode === 'live' ? 'Live' : 'Playbook'} · ${DIFFICULTY_PROFILES[tournament.difficulty].label}`,
            }),

            tournament.status === 'won'
              ? el(doc, 'p', {
                  class: 'tournament__prize',
                  children: [
                    el(doc, 'span', { text: 'Prize paid: ' }),
                    coinPill(doc, { amount: TOURNAMENT_PRIZE_COINS, signed: true }),
                    el(doc, 'span', { text: ' and a Gold pack, waiting in the Store.' }),
                  ],
                })
              : null,

            running && slot !== null && opponent !== null
              ? el(doc, 'div', {
                  class: 'tournament__next',
                  children: [
                    el(doc, 'p', {
                      class: 'tournament__next-line',
                      text: `Next: ${roundName(tournament.size, slot.round)} against ${opponent.name}.`,
                    }),
                    button(doc, {
                      label: tournament.pending === null ? 'Play the match' : 'Play it again',
                      variant: 'primary',
                      size: 'large',
                      onClick: () => {
                        void play();
                      },
                    }),
                    tournament.pending === null
                      ? null
                      : el(doc, 'p', {
                          class: 'tournament__pending',
                          text: 'Waiting on that match. Finish it and come back here.',
                        }),
                  ],
                })
              : null,

            bracketList(doc, tournament),

            el(doc, 'div', {
              class: 'tournament__actions',
              children: [
                button(doc, {
                  label: running ? 'Abandon tournament' : 'Start another',
                  variant: 'ghost',
                  onClick: () => {
                    void abandon();
                  },
                }),
              ],
            }),
          ],
        }),
      );
    },
  };
}
