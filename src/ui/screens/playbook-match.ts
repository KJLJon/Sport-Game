/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.10 — Playbook flow UI: setup, turn screen, key-moment transition, results
 * @task    T-5.9 — Playbook hot-seat: pass-the-device screens, hidden calls, local player names
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @story   US-15.3 — See what happened, not read about it
 * @story   US-17.1 — Play against someone else on one device
 * @design  10-ui-ux.md §8.4 (Playbook turn), 09-modes-and-arcade.md §2.1, §2.4, §4
 * @invariant INV-5 (no sport rule here), INV-9 (the screen reads the match, never a mode flag)
 *
 * Purpose: the turn screen. `10` §8.4 in order — "court diagram up top, your call options as
 * three-to-six large cards along the bottom, opponent's last call and the running score always
 * visible. Tap a card → brief confirm-by-tap on a target athlete if the call needs one →
 * resolution animates → narration line → next turn. A key moment interrupts with a full-screen
 * arcade challenge and returns you to the flow."
 *
 * **The screen owns the frame loop and nothing else.** Every decision it presents comes from the
 * match: the calls from `match.calls(side)`, the animation from `match.diagram(turn)`, the words
 * from `match.narrate(turn)`, the moment from `match.keyMoment()`. That is what keeps it honest
 * about INV-5 — it renders a `PlaybookAdapter`, whichever sport supplied it.
 *
 * **A key moment is a phase, not a route.** Navigating away and back would lose the match, so the
 * arcade challenge is mounted into the same host and torn down again. `09` §2.4 calls it an
 * interruption, and an interruption returns you to where you were.
 *
 * **The sport is a parameter now** (T-6.21). This screen used to import `basketball`,
 * `basketballSquads`, and `createBasketballPlaybook` by name, which read as harmless while there
 * was one Playbook sport and was in fact the reason `#/play/playbook` could not reach soccer at
 * all — the claim above that it "could render soccer's tomorrow" was true of every line except its
 * imports. It now loads the module named on the URL and builds the match from the seam:
 * `module.playbook` is the adapter, `adapter.squads()` turns the roster into two squads,
 * `module.rules` is the clock, and `module.arcade` is where a key moment's mini-game comes from.
 * Nothing below reads a sport id.
 */
import { CanvasHost } from '../../app/canvas-host.ts';
import { createLoop, type Loop } from '../../engine/loop.ts';
import { Button, EMPTY_FRAME, makeFrame, type InputFrame } from '../../engine/input/types.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import type { Canvas2D } from '../../engine/render/renderer.ts';
import { el } from '../dom.ts';
import { button } from '../components/button.ts';
import { switchControl } from '../components/controls.ts';
import { emptyState, errorState } from '../components/states.ts';
import { callSheet, type CallSheetHandle } from '../components/play-call.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { loadSport } from '../../sports/playable.ts';
import { PlaybookMatch } from '../../modes/playbook/match.ts';
import { drawDiagram, type TurnDiagram } from '../../modes/playbook/diagram.ts';
import { TurnPlayback, coachTakesTurn, type PacePrefs } from '../../modes/playbook/pace.ts';
import { outcomeOf, startKeyMoment } from '../../modes/playbook/key-moment.ts';
import {
  buildReport,
  describeCalls,
  describeKeyMoments,
  describeLuck,
} from '../../modes/playbook/report.ts';
import { HotSeat, seatsFor } from '../../modes/playbook/hot-seat.ts';
import type { ArcadeRun } from '../../modes/arcade/session.ts';
import { PARTY_LIMITS, seatPlayers } from '../../modes/local-players.ts';
import { reducedMotion as motionReduced } from '../../modes/arcade/accessibility.ts';
import type { Side } from '../../engine/match/events.ts';
import { readSetup, setupParams, splitRoster } from './playbook.ts';
import { scalePeriodSteps } from '../../modes/match-setup.ts';
import {
  CHECKPOINT_VERSION,
  clearCheckpoint,
  describeMatch,
  saveCheckpoint,
} from '../../modes/checkpoint.ts';
import { buildRecord } from '../../stats/record.ts';
import { buildHash } from '../../app/router.ts';

/**
 * The match, with the sport's own between-turn state erased.
 *
 * Every use of it here hands the state straight back to the adapter that made it, which is exactly
 * the contract `PlaybookState.detail` documents — the screen never reads inside it.
 */
type Match = PlaybookMatch<unknown>;

/** What the screen is showing right now. */
type Stage = 'calling' | 'handover' | 'moment' | 'resolving' | 'over';

export function playbookMatchScreen(): Screen {
  let loop: Loop | null = null;
  let detachResize: (() => void) | null = null;

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const view = doc.defaultView;
      const setup = readSetup(context.query);

      const module = await loadSport(setup.sport);
      const adapter = module.playbook;
      if (adapter === undefined) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'That match could not be set up',
            body: `${module.meta.displayName} has no Playbook yet. Pick another sport from Play.`,
          }),
        );
        return;
      }

      let roster;
      try {
        const { athletes } = await appDatabase();
        roster = splitRoster(await athletes.getAll(), module.meta.squadSize);
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'That match could not be set up',
            body: 'Playbook needs your roster. Try again from the Playbook screen.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      if (roster === null) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'Not enough athletes yet',
            body: `Playbook needs ${module.meta.squadSize} to field a side.`,
            action: { label: 'Go to the squad', href: '#/squad' },
          }),
        );
        return;
      }

      const match: Match = new PlaybookMatch<unknown>({
        seed: `playbook-${Date.now()}`,
        adapter,
        sport: module.id,
        // The player's chosen length (T-8.2), over the sport's own period.
        rules: {
          ...module.rules,
          periodSteps: scalePeriodSteps(module.rules.periodSteps, setup.length),
        },
        squads: adapter.squads(roster.home, roster.away),
        playerSide: 0,
        difficulty: setup.difficulty,
        keyMoments: setup.keyMoments,
      });

      const pace: { current: PacePrefs } = {
        current: { speed: setup.speed, autoCall: 'off' },
      };
      const reduceMotion = motionReduced(view);

      const seats = setup.hotSeat ? seatsFor(seatPlayers(PARTY_LIMITS.min)) : null;
      const hotSeat =
        seats === null ? null : new HotSeat({ seats, firstSide: match.view().possession });

      let stage: Stage = seats === null ? 'calling' : 'handover';
      let playback: TurnPlayback | null = null;
      let diagram: TurnDiagram | null = null;
      let run: ArcadeRun | null = null;
      let holding = false;
      let previousFrame: InputFrame = EMPTY_FRAME;
      let sheet: CallSheetHandle | null = null;

      const board = el(doc, 'div', { class: 'playbook-match__board' });
      const stageHost = el(doc, 'div', { class: 'playbook-match__stage' });
      const root = el(doc, 'section', { class: 'playbook-match', children: [board, stageHost] });
      context.host.replaceChildren(root);

      // ── the court diagram ────────────────────────────────────────────────
      const canvasHost = new CanvasHost(doc);
      board.appendChild(canvasHost.canvas);
      // A canvas with no 2D context is a real state — a headless test, an exotic webview — and the
      // match must stay playable, because everything the diagram shows is also said in words.
      let context2d: Canvas2D | null = null;
      try {
        context2d = canvasHost.canvas.getContext('2d') as Canvas2D | null;
      } catch {
        context2d = null;
      }
      detachResize = canvasHost.onResize(() => undefined);
      if (view !== null) canvasHost.attach(board, view);

      /**
       * Files the finished match (T-8.5).
       *
       * The *same* builder Live uses, fed the same event history off the same bus. Playbook keeps no
       * running box score, so this one is derived from the events — which is not a mode branch but a
       * caller handing over work it happens not to have done. That the two modes' records come out
       * identically shaped from identical streams is INV-9 paying for itself.
       */
      let recorded = false;
      const recordMatch = (): void => {
        if (recorded) return;
        recorded = true;

        const state = match.view();
        void appDatabase()
          .then((db) =>
            db.matches.record(
              buildRecord({
                id: `${setup.sport}-playbook:${Date.now().toString(36)}`,
                playedAt: Date.now(),
                sportId: module.id,
                mode: 'playbook',
                difficulty: setup.difficulty,
                score: state.score,
                playerSide: 0,
                teamNames: ['Home', 'Away'],
                periodsPlayed: state.period,
                events: match.events,
              }),
            ),
          )
          .catch(() => {});
      };

      /**
       * Records where this match has got to (T-8.4).
       *
       * Playbook resumes better than Live does: a turn-based match has no positions to lose, so the
       * score and the period *are* most of its state. What still resets is the box score and
       * whatever the adapter was tracking about tendencies.
       */
      const writeCheckpoint = (): void => {
        const state = match.view();
        if (match.finished) return;

        void appDatabase()
          .then((db) =>
            saveCheckpoint(db.db, {
              schemaVersion: CHECKPOINT_VERSION,
              mode: 'playbook',
              sport: module.id,
              href: buildHash('/play/playbook/match', setupParams(setup)),
              label: `${module.meta.displayName} · Playbook`,
              detail: describeMatch(state.score, module.meta.periodName, state.period),
              savedAt: Date.now(),
            }),
          )
          .catch(() => {});
      };

      /** Which side the human is calling for right now — themselves, or either seat in hot seat. */
      const callingSide = (): Side => (hotSeat === null ? 0 : (hotSeat.side ?? 0));

      const renderBoard = (): void => {
        const state = match.view();
        board.replaceChildren(
          canvasHost.canvas,
          el(doc, 'div', {
            class: 'playbook-match__score',
            children: [
              el(doc, 'span', { class: 'playbook-match__points', text: `${state.score[0]}` }),
              el(doc, 'span', { class: 'playbook-match__sep', text: '–' }),
              el(doc, 'span', { class: 'playbook-match__points', text: `${state.score[1]}` }),
              el(doc, 'span', {
                class: 'playbook-match__clock',
                // The sport names its own period: a soccer match counts halves, not quarters.
                text: `${periodLabel(module.meta.periodName, state.period)} · ${clockText(state.periodClock)}`,
              }),
            ],
          }),
          el(doc, 'p', {
            class: 'playbook-match__narration',
            attrs: { 'aria-live': 'polite' },
            text: state.lastTurn === null ? '' : match.narrate(state.lastTurn).text,
          }),
        );
      };

      const lastOpponentCall = (): string | undefined => {
        const last = match.turns.at(-1);
        if (last === undefined) return undefined;
        const theirs = last.attacking === callingSide() ? last.calls.defence : last.calls.offence;
        return theirs.call;
      };

      const renderStage = (): void => {
        renderBoard();
        stageHost.replaceChildren();

        if (stage === 'over') {
          stageHost.appendChild(results());
          return;
        }

        if (stage === 'handover' && hotSeat !== null) {
          const line = hotSeat.view();
          stageHost.appendChild(
            el(doc, 'div', {
              class: 'playbook-match__handover',
              children: [
                el(doc, 'p', { class: 'playbook-match__prompt', text: line.prompt }),
                button(doc, {
                  label: 'Ready',
                  variant: 'primary',
                  size: 'large',
                  onClick: () => {
                    hotSeat.ready();
                    stage = 'calling';
                    renderStage();
                  },
                }),
              ],
            }),
          );
          return;
        }

        if (stage === 'resolving' || stage === 'moment') {
          stageHost.appendChild(
            el(doc, 'p', {
              class: 'playbook-match__prompt',
              text: stage === 'moment' ? 'Your moment.' : 'Hold to fast-forward.',
            }),
          );
          return;
        }

        const side = callingSide();
        sheet = callSheet(doc, {
          calls: match.calls(side),
          squad: match.state.squads[side === 1 ? 1 : 0].players,
          ...(lastOpponentCall() === undefined
            ? {}
            : { opponentLastCall: lastOpponentCall() as string }),
          onChoose: (choice) => {
            match.submit({ side, ...choice });
            afterCall();
          },
        });

        stageHost.appendChild(sheet.element);
        stageHost.appendChild(
          switchControl(doc, {
            label: 'Auto-call',
            description:
              'The assistant coach calls the ordinary possessions. Key moments stay yours.',
            checked: pace.current.autoCall === 'on',
            onChange: (checked) => {
              pace.current = { ...pace.current, autoCall: checked ? 'on' : 'off' };
              if (checked) autoPlayCall();
            },
          }),
        );
      };

      /** The coach takes this call, when the toggle is on and there is nothing to play. */
      const autoPlayCall = (): void => {
        if (!coachTakesTurn(pace.current, false) || hotSeat !== null) return;
        const call = match.coachCall(0);
        if (call === null) return;
        match.submit(call);
        afterCall();
      };

      const afterCall = (): void => {
        if (hotSeat !== null) {
          hotSeat.submitted();
          if (hotSeat.phase !== 'ready') {
            stage = 'handover';
            renderStage();
            return;
          }
        } else {
          const cpu = match.autoCall(1);
          if (cpu !== null) match.submit(cpu);
        }
        resolveTurn();
      };

      const resolveTurn = (): void => {
        const resolution = match.resolve();
        if (match.phase === 'key-moment') {
          startMoment();
          return;
        }
        beginPlayback(resolution);
      };

      const beginPlayback = (resolution: Parameters<typeof match.narrate>[0]): void => {
        diagram = match.diagram(resolution);
        playback = diagram === null ? null : new TurnPlayback(diagram);
        stage = 'resolving';
        renderStage();
        if (playback === null) commitTurn();
      };

      const commitTurn = (): void => {
        match.advance();
        playback = null;
        diagram = null;
        sheet?.reset();

        if (match.finished) {
          // Finished is not interrupted (T-8.4).
          void appDatabase()
            .then((db) => clearCheckpoint(db.db))
            .catch(() => {});
          recordMatch();
          stage = 'over';
          renderStage();
          return;
        }

        // A turn is Playbook's natural checkpoint: it is the only moment the match state is settled
        // and nothing is mid-animation, and it is frequent enough that a kill costs one call.
        writeCheckpoint();

        if (hotSeat !== null) {
          hotSeat.nextTurn(match.view().possession);
          stage = 'handover';
          renderStage();
          return;
        }

        stage = 'calling';
        renderStage();
        autoPlayCall();
      };

      // ── the key moment ───────────────────────────────────────────────────
      const startMoment = (): void => {
        const invocation = match.keyMoment();
        if (invocation === null) {
          beginPlayback(match.turns.at(-1) as never);
          return;
        }
        run = startKeyMoment(module.arcade ?? [], match.state, invocation, 'moment');
        if (run === null) {
          // The sport proposed a game this build does not have. Taking the sim's outcome is the
          // honest fallback; inventing one would be worse than the interruption never happening.
          match.settleKeyMoment({ made: false, quality: 0 });
          beginPlayback(match.turns.at(-1) as never);
          return;
        }
        stage = 'moment';
        renderStage();
      };

      const finishMoment = (): void => {
        if (run === null) return;
        const resolution = match.settleKeyMoment(outcomeOf(run));
        run = null;
        beginPlayback(resolution);
      };

      // ── results ──────────────────────────────────────────────────────────
      const results = (): HTMLElement => {
        const report = buildReport(match.state, match.turns);
        const mine = report.sides[0];
        return el(doc, 'div', {
          class: 'playbook-match__results',
          children: [
            el(doc, 'h2', {
              text:
                report.winner === 0 ? 'You won.' : report.winner === 1 ? 'You lost.' : 'A draw.',
            }),
            el(doc, 'p', { text: describeKeyMoments(mine.keyMoments) }),
            el(doc, 'p', { text: describeCalls(mine) }),
            el(doc, 'p', { text: describeLuck(mine) }),
            button(doc, {
              label: 'Back to Playbook',
              variant: 'primary',
              onClick: () => context.navigate('#/play/playbook'),
            }),
          ],
        });
      };

      // ── input ────────────────────────────────────────────────────────────
      const onDown = (): void => {
        holding = true;
      };
      const onUp = (): void => {
        holding = false;
        // A tap during the animation skips to the end, which is what `09` §2.1's hold-to-fast-
        // forward implies at its limit and what an impatient thumb expects.
        if (stage === 'resolving' && playback !== null) playback.skip();
      };
      board.addEventListener('pointerdown', onDown);
      board.addEventListener('pointerup', onUp);
      board.addEventListener('pointercancel', onUp);

      // ── the loop ─────────────────────────────────────────────────────────
      const frame = (stepMs: number): void => {
        const dt = stepMs / 1000;
        if (stage === 'moment' && run !== null) {
          previousFrame = inputFrame(holding, previousFrame);
          run.step(previousFrame, dt);
          if (run.finished || run.view().attempts > 0) finishMoment();
          return;
        }

        if (stage === 'resolving' && playback !== null && diagram !== null) {
          playback.advance(dt, pace.current.speed, holding, reduceMotion);
          if (context2d !== null) {
            const size = canvasHost.size;
            context2d.clearRect(0, 0, size.width, size.height);
            drawDiagram(context2d, playback.frame(), {
              x: 0,
              y: 0,
              width: size.width,
              height: size.height,
            });
          }
          if (playback.finished) commitTurn();
        }
      };

      loop = createLoop({ step: frame, render: () => undefined });
      loop.start();

      renderStage();
      if (hotSeat === null) autoPlayCall();
    },

    unmount(): void {
      loop?.stop();
      loop = null;
      detachResize?.();
      detachResize = null;
    },
  };
}

/** A press frame while the screen is held, so an arcade moment sees a real input. */
function inputFrame(holding: boolean, previous: InputFrame): InputFrame {
  return makeFrame(0, 0, holding ? Button.A : 0, previous);
}

/**
 * `Q3`, `H2` — the sport's own period name, initialled to fit a scoreboard.
 *
 * A basketball quarter and a soccer half are the same field on `PlaybookState`, and showing `Q2` in
 * a soccer match was the sort of small wrongness that makes a whole screen read as a port.
 */
export function periodLabel(periodName: string, period: number): string {
  return `${(periodName[0] ?? 'P').toUpperCase()}${period}`;
}

/** `M:SS`, as a scoreboard shows it. */
export function clockText(gameSeconds: number): string {
  const total = Math.max(0, Math.ceil(gameSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
