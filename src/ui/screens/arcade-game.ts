/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.3 — Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint
 * @task    T-4.12 — Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.3, 10-ui-ux.md §7 (screen map), §11 (accessibility)
 * @invariant INV-3 (all storage through `src/storage/`), INV-8 (determinism)
 *
 * Purpose: the screen a run is played on. It owns the canvas, the loop, the one button, and the
 * HUD; the run itself is `ArcadeRun`, which knows nothing about any of that.
 *
 * **One button, anywhere.** The whole stage is the button (`09` §3.1 — one thumb, no reading), so
 * there is no target to find and nothing to hit accurately. Space and Enter do the same thing, so
 * the game is playable from a keyboard, and the tap surface is a real `<button>` with a label, so a
 * screen reader announces what it does rather than reading an unlabelled canvas.
 *
 * **Everything the HUD says, it says in words.** Score, lives, the clock, and the last outcome are
 * text; the meter on the canvas is drawn as a shape with an outline rather than a tint. That is
 * `10` §11 and T-4.12, and it is also just easier to read at arm's length.
 */
import { CanvasHost } from '../../app/canvas-host.ts';
import { createLoop, type Loop } from '../../engine/loop.ts';
import { Button, EMPTY_FRAME, makeFrame, type InputFrame } from '../../engine/input/types.ts';
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { Athlete } from '../../athletes/types.ts';
import { basketball } from '../../sports/basketball/index.ts';
import { arcadeCatalogue, findGame } from '../../modes/arcade/registry.ts';
import { dailyChallenge, dailyConfig, dateKey } from '../../modes/arcade/daily.ts';
import { startRun } from '../../modes/arcade/modes.ts';
import { ArcadeRepository } from '../../modes/arcade/records.ts';
import {
  PARTY_FORMATS,
  currentTurn,
  partyWinner,
  passPrompt,
  recordTurn,
  standings,
  startParty,
  turnConfig,
  type PartyFormat,
  type PartyState,
} from '../../modes/arcade/party.ts';
import { PARTY_LIMITS, seatPlayers } from '../../modes/local-players.ts';
import { arcadeProgression, progressionSummary } from '../../modes/arcade/progression.ts';
import { accuracy } from '../../modes/arcade/scoring.ts';
import {
  isArcadeMode,
  type ArcadeConfig,
  type ArcadeGameDef,
  type ArcadeLayout,
  type ArcadeMode,
} from '../../modes/arcade/types.ts';
import {
  applyMotionPreference,
  arcadeLayout,
  drawOutcomeFeedback,
  type FeedbackState,
} from '../../modes/arcade/accessibility.ts';
import { appDatabase } from '../../storage/app-db.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { button } from '../components/button.ts';
import { starRating } from '../components/meters.ts';
import { errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import './arcade.css';

function seedFor(game: ArcadeGameDef, mode: ArcadeMode): string {
  return `${mode}:${game.id}:${Date.now().toString(36)}`;
}

/** A stat block: a label above a number, both readable without colour. */
function stat(doc: Document, label: string, value: string): HTMLElement {
  return el(doc, 'div', {
    class: 'arcade-run__stat',
    children: [
      el(doc, 'span', { class: 'arcade-run__stat-label', text: label }),
      el(doc, 'span', { class: 'arcade-run__stat-value', text: value }),
    ],
  });
}

export function arcadeGameScreen(): Screen {
  let loop: Loop | null = null;
  let host: CanvasHost | null = null;
  let detachResize: (() => void) | null = null;
  const listeners: (() => void)[] = [];

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const view = doc.defaultView;
      const games = arcadeCatalogue([basketball]);
      const game = findGame(games, context.params['id'] ?? '');

      if (game === undefined) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'No such game',
            body: 'That mini-game is not in this build. It may be from a newer version.',
          }),
        );
        return;
      }

      const requested = context.query['mode'] ?? 'scored';
      const mode: ArcadeMode = isArcadeMode(requested) ? requested : 'scored';

      let config: ArcadeConfig;
      try {
        config = await buildConfig(game, games, mode, context.query['athlete']);
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'That run could not be set up',
            body: 'Pick an athlete from the arcade hub and try again.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      const layout: ArcadeLayout = arcadeLayout(view);
      applyMotionPreference(doc, view);

      /**
       * A party, or `null` for a solo run. Everything about the party — the shared seed, the shared
       * athlete, the order, the ranking — is `party.ts`'s; this screen only shows whose turn it is.
       */
      let party: PartyState | null = buildParty(game, config, context.query);
      let run = startRun(game, party === null ? config : (turnConfig(party) ?? config));
      let recorded = false;
      /** What the finished run was worth to the athlete (US-16.5). Filled in when the run ends. */
      let learned = 'Practice runs are not scored or rewarded.';

      // ── Chrome ────────────────────────────────────────────────────────────
      const section = el(doc, 'section', { class: 'arcade-run' });
      const hud = el(doc, 'div', { class: 'arcade-run__hud' });
      const stage = el(doc, 'div', { class: 'arcade-run__stage' });
      const overlay = el(doc, 'div', { class: 'arcade-run__overlay' });
      const actions = el(doc, 'div', { class: 'arcade-run__actions' });

      const tap = el(doc, 'button', {
        class: 'arcade-run__tap',
        attrs: { type: 'button', 'aria-label': `${game.name} — tap to act` },
      });

      let pressed = false;
      let previous: InputFrame = EMPTY_FRAME;
      const press = (): void => {
        pressed = true;
      };
      tap.addEventListener('pointerdown', press);
      tap.addEventListener('click', press);

      const onKey = (event: KeyboardEvent): void => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          press();
        }
      };
      doc.addEventListener('keydown', onKey);
      listeners.push(() => doc.removeEventListener('keydown', onKey));

      const canvasHost = new CanvasHost(doc);
      host = canvasHost;
      stage.append(canvasHost.canvas, overlay, tap);

      // A canvas with no 2D context is a real state — a headless test, an exotic webview — and the
      // run must still be playable, since everything the HUD says it says in text anyway.
      let context2d: Canvas2D | null = null;
      try {
        context2d = canvasHost.canvas.getContext('2d') as Canvas2D | null;
      } catch {
        context2d = null;
      }

      detachResize = canvasHost.onResize(() => undefined);
      if (view !== null) canvasHost.attach(stage, view);

      const renderHud = (): void => {
        const state = run.view();
        const clock = state.remaining;
        hud.replaceChildren(
          stat(doc, 'Score', state.score.toLocaleString('en-GB')),
          stat(
            doc,
            state.livesMax === null ? 'Attempts' : 'Lives',
            state.livesMax === null
              ? String(state.attempts)
              : `${state.lives ?? 0} of ${state.livesMax}`,
          ),
          clock === null
            ? stat(doc, 'Made', `${state.made}/${state.attempts}`)
            : stat(doc, 'Time', `${Math.ceil(clock)}s`),
          stat(doc, 'Streak', String(state.streak)),
          starRating(doc, { value: state.stars, label: `${state.stars} of 3 stars so far` }),
        );
      };

      const renderOverlay = (): void => {
        const state = run.view();

        if (state.phase === 'ready') {
          const turn = party === null ? null : currentTurn(party);
          overlay.replaceChildren(
            turn === null
              ? el(doc, 'p', { class: 'arcade-run__prompt', text: state.prompt })
              : el(doc, 'p', {
                  class: 'arcade-run__prompt',
                  text: passPrompt(turn, game.id),
                }),
            el(doc, 'p', { text: state.prompt }),
            el(doc, 'p', { text: state.calibration.hint }),
            el(doc, 'p', { text: 'Tap anywhere to start.' }),
          );
          actions.replaceChildren();
          return;
        }

        if (state.phase === 'running') {
          overlay.replaceChildren(
            el(doc, 'p', {
              class: 'arcade-run__outcome',
              attrs: { 'aria-live': 'polite' },
              text: state.lastOutcome?.label ?? '',
            }),
          );
          actions.replaceChildren(
            button(doc, {
              label: 'Quit',
              variant: 'ghost',
              onClick: () => run.quit(),
            }),
          );
          return;
        }

        if (party !== null) {
          renderPartyOver();
          return;
        }

        const result = run.result();
        overlay.replaceChildren(
          el(doc, 'p', { class: 'arcade-run__prompt', text: 'Run over' }),
          starRating(doc, { value: result?.stars ?? 0, label: `${result?.stars ?? 0} of 3 stars` }),
          el(doc, 'p', {
            text: `${(result?.score ?? 0).toLocaleString('en-GB')} points · ${result?.made ?? 0} of ${
              result?.attempts ?? 0
            } (${Math.round(accuracy(result?.made ?? 0, result?.attempts ?? 0))}%)`,
          }),
          el(doc, 'p', { class: 'arcade-run__learned', text: learned }),
        );
        actions.replaceChildren(
          button(doc, {
            label: 'Play again',
            variant: 'primary',
            onClick: () => {
              run = startRun(game, { ...config, seed: seedFor(game, config.mode) });
              recorded = false;
              renderHud();
              renderOverlay();
            },
          }),
          button(doc, {
            label: 'Back to the arcade',
            variant: 'ghost',
            onClick: () => context.navigate('/play/arcade'),
          }),
        );
      };

      /** The between-turns and end-of-party screens. */
      const renderPartyOver = (): void => {
        if (party === null) return;
        const result = run.result();

        if (!party.finished) {
          const next = currentTurn(party);
          overlay.replaceChildren(
            el(doc, 'p', { class: 'arcade-run__prompt', text: `${result?.score ?? 0} points` }),
            el(doc, 'p', { text: next === null ? '' : passPrompt(next, game.id) }),
          );
          actions.replaceChildren(
            button(doc, {
              label: 'Ready',
              variant: 'primary',
              onClick: () => {
                const config = turnConfig(party!);
                if (config === null) return;
                run = startRun(game, config);
                recorded = false;
                renderHud();
                renderOverlay();
              },
            }),
          );
          return;
        }

        const winner = partyWinner(party);
        overlay.replaceChildren(
          el(doc, 'p', {
            class: 'arcade-run__prompt',
            text: winner === null ? 'Tied at the top' : `${winner.name} wins`,
          }),
          el(doc, 'ol', {
            class: 'arcade-run__standings',
            children: standings(party).map((row) =>
              el(doc, 'li', {
                text: `${row.place}. ${row.player.name} — ${row.total.toLocaleString('en-GB')}${
                  row.eliminated ? ' (out)' : ''
                }`,
              }),
            ),
          }),
        );
        actions.replaceChildren(
          button(doc, {
            label: 'Back to the arcade',
            variant: 'primary',
            onClick: () => context.navigate('/play/arcade'),
          }),
        );
      };

      /**
       * Files the finished run: the personal best, and what the athlete learned from it (T-4.10).
       * Practice never reaches storage — `recordRun` and `arcadeProgression` both refuse it, which
       * is what makes "unlimited and unrewarded" safe rather than a rule the caller has to keep.
       */
      const record = (): void => {
        const result = run.result();
        if (result === null || recorded) return;
        recorded = true;

        // A party turn is a contest between people on one shared athlete; it does not touch that
        // athlete's progression or anyone's personal best, because the athlete is not theirs.
        if (party !== null) {
          party = recordTurn(party, result);
          renderPartyOver();
          return;
        }

        const progress = arcadeProgression({
          result,
          athlete: config.athlete,
          awards: basketball.xpAwards ?? [],
        });
        learned = progressionSummary(progress);
        renderOverlay();

        void appDatabase()
          .then(async ({ db, athletes }) => {
            await new ArcadeRepository(db).recordRun(result, game.stars);
            // The daily's athlete is generated, not one of yours, so there is nothing to store.
            if (progress !== null && config.mode !== 'daily') await athletes.put(progress.athlete);
          })
          .catch(() => {
            // A lost personal best is not worth interrupting the run-over screen for.
          });
      };

      section.append(hud, stage, actions);
      context.host.replaceChildren(section);
      renderHud();
      renderOverlay();

      /** The outcome banner's state. Reset every time a new outcome lands (T-4.12). */
      let feedback: FeedbackState | null = null;
      let lastOutcomeLabel: string | null = null;

      let lastPhase = run.view().phase;
      loop = createLoop({
        step: (stepMs) => {
          if (run.finished) return;
          const frame = makeFrame(0, 0, pressed ? Button.A : 0, previous);
          run.step(frame, stepMs / 1000);
          previous = frame;
          pressed = false;

          const outcome = run.view().lastOutcome;
          const label = outcome === null ? null : `${outcome.label}:${run.view().attempts}`;
          if (outcome !== null && label !== lastOutcomeLabel) {
            lastOutcomeLabel = label;
            feedback = { outcome, age: 0 };
          } else if (feedback !== null) {
            feedback = { ...feedback, age: feedback.age + stepMs / 1000 };
          }
        },
        render: () => {
          const state = run.view();
          if (state.phase !== lastPhase) {
            lastPhase = state.phase;
            renderOverlay();
            if (state.phase === 'over') record();
          }
          renderHud();

          if (context2d === null) return;
          const size = canvasHost.size;
          context2d.save();
          context2d.scale(size.dpr, size.dpr);
          context2d.clearRect(0, 0, size.width, size.height);
          const frameLayout = { ...layout, width: size.width, height: size.height };
          run.draw(context2d, frameLayout);
          drawOutcomeFeedback(context2d, frameLayout, feedback);
          context2d.restore();
        },
      });
      loop.start();
    },

    unmount(): void {
      loop?.stop();
      loop = null;
      detachResize?.();
      detachResize = null;
      for (const off of listeners) off();
      listeners.length = 0;
      host?.detach();
      host = null;
    },
  };
}

/**
 * A party from the query, or `null`. `party=<seats>` is all it takes: the names come from what the
 * device remembers (US-17.3) and the athlete is the one already chosen, so everybody plays the same
 * person on the same seeds — the two halves of `09` §4's fairness.
 */
function buildParty(
  game: ArcadeGameDef,
  config: ArcadeConfig,
  query: Readonly<Record<string, string>>,
): PartyState | null {
  const seats = Number.parseInt(query['party'] ?? '', 10);
  if (!Number.isFinite(seats) || seats < PARTY_LIMITS.min) return null;

  const requested = query['format'] ?? 'rounds';
  const format: PartyFormat = (PARTY_FORMATS as readonly string[]).includes(requested)
    ? (requested as PartyFormat)
    : 'rounds';

  return startParty({
    game: game.id,
    players: seatPlayers(seats),
    format,
    rounds: 3,
    seed: `party:${game.id}:${Date.now().toString(36)}`,
    athlete: config.athlete,
    difficulty: config.difficulty,
  });
}

/**
 * The config for this run. The daily is built from the day rather than from the query, so a link to
 * it cannot be edited into an easier scenario.
 */
async function buildConfig(
  game: ArcadeGameDef,
  games: readonly ArcadeGameDef[],
  mode: ArcadeMode,
  athleteId: string | undefined,
): Promise<ArcadeConfig> {
  if (mode === 'daily') {
    const challenge = dailyChallenge(dateKey(), games);
    if (challenge !== null && challenge.game.id === game.id) return dailyConfig(challenge);
    // Playing a non-daily game in daily mode is a stale link; fall through to a scored run.
  }

  const { athletes } = await appDatabase();
  const roster = await athletes.getAll();
  const chosen: Athlete | undefined =
    roster.find((subject) => subject.id === athleteId) ?? roster[0];
  if (chosen === undefined) throw new Error('No athletes to play with');

  return {
    mode: mode === 'daily' ? 'scored' : mode,
    seed: seedFor(game, mode),
    athlete: chosen,
    difficulty: 'pro',
  };
}
