/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @task    T-2.11 — Pause menu, quit, in-match settings, post-match summary with box score
 * @story   US-2.3 — See what is happening
 * @story   US-2.4 — See the state of the match at a glance
 * @story   US-2.1 — Control my athlete with a virtual joystick
 * @design  06-game-design.md §4 (match presentation), §2 (controls), 10-ui-ux.md §4 (landscape,
 *          safe areas), §6 (accessibility)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-11 (44 px targets, no
 *            information by colour alone)
 *
 * **The camera does not fit the whole field** (T-6.12), and since T-12.2 it does not hold one zoom
 * either. A `CameraDirector` frames by phase of play — tight in a duel, wide on a counter, widest at
 * a set piece — from a `FramingSignal` this file assembles out of the world. The span numbers come
 * from the sport's own `camera` profile through the seam (T-12.6), so there is still no sport id
 * here; a sport that supplies no profile gets the defaults, which are T-6.12's 45 m rule generalised.
 *
 * `zoomFloor` survives as the floor beneath all of that: whatever the director asks for, the camera
 * never zooms out past the point where an athlete stops being legible on a phone.
 *
 * Purpose: the screen a match is played on. It owns the canvas, the loop, the camera, and the
 * input, and it is the only place those four meet.
 *
 * **Why the whole screen is one file.** The pause menu, the summary, and the HUD are three views of
 * the same running match, and the thing they share — when to stop the loop, when to release held
 * input, what the box score currently says — is the awkward part. Splitting them across files means
 * exporting that lifecycle, and a lifecycle with three owners is a lifecycle with none.
 *
 * **Nothing sport-specific is drawn here, and that was not always true.** Until T-6.16 this file
 * imported `sports/basketball/art.ts` by name and drew every athlete and every ball with it, on the
 * reasoning that a top-down athlete is generic. The body is; the *kit* is not, and the result was a
 * soccer match played by basketball players chasing an orange ball. Athletes, the ball, and overlays
 * all now go through `SportRenderer`, and this file names no sport at all.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { CanvasHost, type CanvasSize } from '../../app/canvas-host.ts';
import { Camera } from '../../engine/render/camera.ts';
import { CameraDirector } from '../../engine/render/director.ts';
import {
  DEFAULT_CAMERA_PROFILE,
  cameraProfile,
  legibleSpan,
  type CameraProfile,
} from '../../engine/render/framing.ts';
import { CAMERA_MOTION_KEY, cameraMotion, type CameraMotion } from '../../app/motion.ts';
import { prefs } from '../../storage/prefs.ts';
import { framingSignal } from './framing.ts';
import { Renderer, type Canvas2D, type OffscreenLayer } from '../../engine/render/renderer.ts';
import { MatchAudio } from './audio.ts';
import { createLoop, type Loop } from '../../engine/loop.ts';
import { InputRouter, TouchInput } from '../../engine/input/sources.ts';
import {
  DEFAULT_LAYOUT,
  defaultButtons,
  stickVisual,
  type ControlLayout,
} from '../../engine/input/joystick.ts';
import type { EntityId } from '../../engine/world.ts';
import { EventKind, type Side } from '../../engine/match/events.ts';
import type { SportModule } from '../../sports/types.ts';
import { LiveMatch, type MatchView } from './match.ts';
import type { Difficulty } from '../difficulty.ts';
import { lastDifficulty, loadAssists } from '../last-played.ts';
import type { AssistSettings } from '../assists.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { MatchRules } from '../../engine/match/state-machine.ts';
import type { RuleOptions } from '../match-setup.ts';
import {
  CHECKPOINT_VERSION,
  clearCheckpoint,
  describeMatch,
  saveCheckpoint,
  type MatchResumeState,
} from '../checkpoint.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { buildRecord } from '../../stats/record.ts';
import {
  DEFAULT_HUD_THEME,
  boxRows,
  drawHud,
  hudLayout,
  type HudLayout,
  type SafeArea,
} from './hud.ts';
import { drawMinimap, minimapFrame, minimapPoint } from './minimap.ts';
import { drawEdgeMarkers, edgeMarkers } from './awareness.ts';
import { teamLine } from './box-score.ts';

/**
 * The zoom the camera must not go below: whatever keeps an athlete legible on *this* screen, or the
 * whole field if that is smaller.
 *
 * T-6.12 set this with a fixed 45 m span, chosen against one phone. T-12.2 replaced the constant
 * with `legibleSpan`, which asks the same question — how wide can this go before an athlete stops
 * being a shape — as an equation in the viewport's own width. Two things follow: a tablet stops
 * being framed as if it were a phone, and spans wider than 45 m become reachable, without which the
 * set-piece framing this phase adds could never actually happen.
 *
 * Returning the fit-the-field scale for a small field is what makes it safe for every sport without
 * naming one.
 */
export function zoomFloor(
  viewWidth: number,
  fieldWidth: number,
  profile: CameraProfile = DEFAULT_CAMERA_PROFILE,
): number {
  const span = Math.min(legibleSpan(viewWidth, profile), fieldWidth);
  return viewWidth / span;
}

export interface LiveScreenOptions {
  readonly sport: SportModule;
  readonly seed: string;
  readonly playerSide?: 0 | 1;
  /** The CPU's level (T-7.7). Absent means the remembered default, which is Pro until it is set. */
  readonly difficulty?: Difficulty;
  /** The player's assists (T-7.8). Absent means the ones they have saved, or their level's. */
  readonly assists?: AssistSettings;
  /**
   * The athletes playing, per side (T-8.2).
   *
   * **Absent used to be the only possibility**, which meant every Live match was played by athletes
   * rolled from the seed while the player's squad sat in the database — Playbook used the real
   * roster and Live did not. It stays optional because a deep link to `#/play/live/soccer` from a
   * save with no athletes must still open a match rather than dead-end.
   */
  readonly rosters?: readonly (readonly Athlete[])[];
  /** Period-length override from the setup screen (T-8.2). */
  readonly rules?: Partial<MatchRules>;
  /** Which of the sport's laws are being enforced (T-8.2). Absent means all of them. */
  readonly ruleOptions?: RuleOptions;
  /** Team names as they were at kick-off, recorded with the match (T-8.5). */
  readonly teamNames?: readonly [string, string];
  /** Where an interrupted match left its clock and scoreboard (T-8.4). */
  readonly resumeFrom?: MatchResumeState;
  /**
   * The hash that re-opens this exact match, written into its checkpoint (T-8.4).
   *
   * Supplied by the route rather than built here, because only the route knows what it parsed —
   * and a checkpoint that pointed at a differently-configured match would resume the wrong game.
   * Absent means this match is not checkpointed at all.
   */
  readonly checkpointHref?: string;
}

/** Reads the safe-area insets the shell publishes as CSS custom properties (`10` §4). */
export function readSafeArea(window: Window, element: Element): SafeArea {
  const style = window.getComputedStyle(element);
  const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: read('--safe-top'),
    right: read('--safe-right'),
    bottom: read('--safe-bottom'),
    left: read('--safe-left'),
  };
}

export function liveScreen(options: LiveScreenOptions): Screen {
  let loop: Loop | null = null;
  let host: CanvasHost | null = null;
  let detachResize: (() => void) | null = null;
  const listeners: (() => void)[] = [];

  return {
    mount(context: ScreenContext): void {
      const doc = context.host.ownerDocument;
      const window = doc.defaultView;
      if (window === null) return;

      const difficulty = options.difficulty ?? lastDifficulty();
      const match = new LiveMatch({
        sport: options.sport,
        seed: options.seed,
        playerSide: options.playerSide ?? 0,
        difficulty,
        assists: options.assists ?? loadAssists(difficulty),
        ...(options.rosters === undefined ? {} : { rosters: options.rosters }),
        ...(options.rules === undefined ? {} : { rules: options.rules }),
        ...(options.ruleOptions === undefined ? {} : { ruleOptions: options.ruleOptions }),
        ...(options.resumeFrom === undefined ? {} : { resumeFrom: options.resumeFrom }),
      });

      const root = doc.createElement('div');
      root.className = 'live';
      context.host.replaceChildren(root);

      const canvasHost = new CanvasHost(doc, { className: 'live__canvas' });
      canvasHost.attach(root, window);
      host = canvasHost;

      const ctx = canvasHost.canvas.getContext('2d') as unknown as Canvas2D | null;
      if (ctx === null) return;

      // The sport's framing, or the defaults if it has no opinion (T-12.6).
      const profile = cameraProfile(options.sport.camera);

      const camera = new Camera({
        width: canvasHost.size.width,
        height: canvasHost.size.height,
        worldWidth: options.sport.field.width,
        worldHeight: options.sport.field.height,
        maxScale: 34,
        lookahead: profile.lookahead,
        maxLead: profile.maxLead,
        deadzone: profile.deadzone,
      });

      const director = new CameraDirector({
        camera,
        profile,
        fieldWidth: options.sport.field.width,
      });

      /**
       * Applies the camera-motion setting (T-12.7), including the zoom floor it implies.
       *
       * `fixed` is the one that needs more than the director: a camera that does not move must show
       * the whole field, so its floor is fit-the-field rather than the legibility floor — which
       * exists precisely to keep the camera zoomed *in*.
       */
      const applyCameraMotion = (next: CameraMotion): void => {
        director.setMotion(next);
        const size = canvasHost.size;
        camera.setMinScale(
          next === 'fixed'
            ? Math.min(
                size.width / options.sport.field.width,
                size.height / options.sport.field.height,
              )
            : zoomFloor(size.width, options.sport.field.width, profile),
        );
      };

      applyCameraMotion(cameraMotion(window));

      /**
       * Whether the next frame should *cut* rather than pan (T-12.5).
       *
       * True at mount, so a match opens already framed on the kickoff instead of easing in from the
       * widest zoom the floor allows — and true again at every period start, which is the one moment
       * a cut is right. Everything else pans, including a restart mid-half.
       *
       * It is a flag read on the next frame rather than a `snap()` inside the event handler, because
       * `period.start` is emitted during a step and the sport repositions everyone for the restart
       * *after* it. Snapping there would cut to where the players were a moment ago.
       */
      const cue = { snap: true };
      listeners.push(
        match.bus.on((matchEvent) => {
          if (matchEvent.kind === EventKind.PERIOD_START) cue.snap = true;
        }),
      );

      const renderer = new Renderer((w, h) => offscreen(doc, w, h));

      let controlLayout: ControlLayout = {
        ...DEFAULT_LAYOUT,
        width: canvasHost.size.width,
        height: canvasHost.size.height,
      };
      const touch = new TouchInput(controlLayout, defaultButtons(controlLayout));
      const input = new InputRouter(touch);

      let layout: HudLayout = hudLayout(
        canvasHost.size.width,
        canvasHost.size.height,
        readSafeArea(window, root),
      );

      detachResize = canvasHost.onResize((size: CanvasSize) => {
        camera.resize(size.width, size.height);
        // The floor is a function of the new width (T-12.2): a rotation changes how wide the camera
        // may go and still leave an athlete legible, so it is re-derived rather than carried over.
        applyCameraMotion(settings.cameraMotion);
        controlLayout = { ...DEFAULT_LAYOUT, width: size.width, height: size.height };
        touch.setLayout(controlLayout, defaultButtons(controlLayout));
        layout = hudLayout(size.width, size.height, readSafeArea(window, root));
      });

      const overlay = doc.createElement('div');
      overlay.className = 'live__overlay';
      root.appendChild(overlay);

      // The sport supplies the event→cue mapping; a sport without one is silent (T-6.16).
      const audio = new MatchAudio(null, {}, options.sport.audio ?? null);
      const stopAudio = audio.attach(match.bus);
      listeners.push(stopAudio);

      /**
       * WebAudio refuses to start before a user gesture, so the context is built on the first
       * pointer or key and never at mount. Once is enough — the flag is what stops every subsequent
       * tap from constructing another one.
       */
      let audioStarted = false;
      const startAudio = (): void => {
        if (audioStarted) return;
        audioStarted = true;
        const Ctor = (window as unknown as { AudioContext?: new () => unknown }).AudioContext;
        if (Ctor === undefined) return;
        audio.setContext(new Ctor() as never);
      };

      const settings: MatchSettings = {
        leftHanded: false,
        sound: true,
        cameraMotion: cameraMotion(window),
      };
      const applySettings = (): void => {
        controlLayout = { ...controlLayout, leftHanded: settings.leftHanded };
        touch.setLayout(controlLayout, defaultButtons(controlLayout));
        audio.setMuted(!settings.sound);
        applyCameraMotion(settings.cameraMotion);
        prefs.set(CAMERA_MOTION_KEY, settings.cameraMotion);
      };

      let paused = false;
      const setPaused = (next: boolean): void => {
        if (paused === next) return;
        paused = next;
        // Releasing held input is not optional: a joystick still held when the menu opens would
        // keep steering an athlete nobody is watching.
        if (paused) input.releaseAll();
        audio.setMuted(paused || !settings.sound);
        renderOverlay();
      };

      /**
       * Files the finished match (T-8.5). Once — `renderOverlay` runs on every frame that the
       * finished flag changes *and* on every settings change, and a match recorded twice is a
       * career counted twice.
       */
      let recorded = false;
      const recordMatch = (): void => {
        if (recorded) return;
        recorded = true;

        const view = match.view();
        void appDatabase()
          .then((db) =>
            db.matches.record(
              buildRecord({
                id: `${options.seed}:${Date.now().toString(36)}`,
                playedAt: Date.now(),
                sportId: options.sport.id,
                mode: 'live',
                difficulty,
                score: view.score,
                playerSide: view.playerSide,
                teamNames: options.teamNames ?? ['Home', 'Away'],
                periodsPlayed: view.period,
                events: match.bus.history(),
                box: match.box,
                ...(lineup === undefined ? {} : { lineup }),
              }),
            ),
          )
          .catch(() => {
            // A match that was played is worth more than a record of it. Losing the record is bad;
            // throwing on the summary screen the player is looking at is worse.
          });
      };

      const lineup = options.sport.lineup?.(match.sportState as never);

      const renderOverlay = (): void => {
        overlay.replaceChildren();
        if (match.finished) {
          // A finished match is not an interrupted one (T-8.4).
          dropCheckpoint();
          recordMatch();
          overlay.appendChild(summaryPanel(doc, match, () => context.navigate('/play')));
          return;
        }
        if (paused) {
          overlay.appendChild(
            pausePanel(doc, match, {
              onResume: () => setPaused(false),
              onQuit: () => {
                // Quitting is a decision, not an interruption: it must not leave a resume behind.
                dropCheckpoint();
                context.navigate('/play');
              },
              settings,
              onSettingsChange: () => {
                applySettings();
                renderOverlay();
              },
            }),
          );
        }
      };

      // Pointer plumbing. Touch controls are the primary input (`06` §2); the keyboard and gamepad
      // sources are already inside the router and need no wiring here.
      const pointer =
        (kind: 'down' | 'move' | 'up') =>
        (rawEvent: Event): void => {
          const e = rawEvent as PointerEvent;
          if (paused || match.finished) return;
          const rect = canvasHost.canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          if (kind === 'down') {
            // A tap on the minimap is a look, not a thumb on the stick (T-12.4). Checked before the
            // input router sees it, because a stick that spawned under the minimap would both steer
            // the athlete and move the camera from one touch.
            const frame = minimapFrame(
              layout,
              options.sport.field.width,
              options.sport.field.height,
            );
            const point = minimapPoint(
              frame,
              x,
              y,
              options.sport.field.width,
              options.sport.field.height,
            );
            if (point !== null) {
              director.peek(point.x, point.y);
              return;
            }
          }
          // Any other touch is play resuming: a peek the player has stopped caring about should
          // not keep the camera away from the ball.
          if (kind === 'down') {
            director.endPeek();
            touch.pointerDown(e.pointerId, x, y);
          } else if (kind === 'move') touch.pointerMove(e.pointerId, x, y);
          else touch.pointerUp(e.pointerId);
        };

      for (const [type, handler] of [
        ['pointerdown', pointer('down')],
        ['pointermove', pointer('move')],
        ['pointerup', pointer('up')],
        ['pointercancel', pointer('up')],
      ] as const) {
        canvasHost.canvas.addEventListener(type, handler);
        listeners.push(() => canvasHost.canvas.removeEventListener(type, handler));
      }

      const onKey = (rawEvent: Event): void => {
        const e = rawEvent as KeyboardEvent;
        startAudio();
        if (e.key === 'Escape') {
          if (match.finished) return;
          setPaused(!paused);
          return;
        }
        input.keyboard.keyDown(e.key);
      };
      const onKeyUp = (rawEvent: Event): void =>
        input.keyboard.keyUp((rawEvent as KeyboardEvent).key);
      doc.addEventListener('keydown', onKey);
      doc.addEventListener('keyup', onKeyUp);
      listeners.push(() => doc.removeEventListener('keydown', onKey));
      listeners.push(() => doc.removeEventListener('keyup', onKeyUp));

      /**
       * Writes where this match has got to (T-8.4).
       *
       * On a timer *and* on the way to the background, because those are two different failures:
       * backgrounding is the one the browser warns you about, and a kill — the case US-10.3 names —
       * gives no warning at all. The timer is what makes the second survivable.
       */
      const checkpoint = (): void => {
        const href = options.checkpointHref;
        if (href === undefined || match.finished) return;

        const current = match.view();
        void appDatabase()
          .then((db) =>
            saveCheckpoint(db.db, {
              schemaVersion: CHECKPOINT_VERSION,
              mode: 'live',
              sport: options.sport.id,
              href,
              label: `${options.sport.meta.displayName} · Live`,
              detail: describeMatch(current.score, current.periodName, current.period),
              savedAt: Date.now(),
              resume: {
                score: current.score,
                period: current.period,
                periodStep: match.stepInPeriod,
              },
            }),
          )
          .catch(() => {
            // A match in progress outranks a record of one.
          });
      };

      const dropCheckpoint = (): void => {
        void appDatabase()
          .then((db) => clearCheckpoint(db.db))
          .catch(() => {});
      };

      // Every ten seconds of play. Frequent enough that a kill loses a few seconds of clock, rare
      // enough that it is not a write per frame.
      const checkpointTimer = window.setInterval(checkpoint, 10_000);
      listeners.push(() => window.clearInterval(checkpointTimer));

      // Backgrounding is a pause. A match that kept running in a hidden tab would burn the clock.
      const onHidden = (): void => {
        if (doc.visibilityState === 'hidden') {
          setPaused(true);
          checkpoint();
        }
      };
      doc.addEventListener('visibilitychange', onHidden);
      listeners.push(() => doc.removeEventListener('visibilitychange', onHidden));

      let wasFinished = false;
      loop = createLoop({
        step: () => {
          if (paused || match.finished) return;
          match.setInput(input.sample());
          match.step();
        },
        render: () => {
          if (match.finished !== wasFinished) {
            wasFinished = match.finished;
            renderOverlay();
          }
          draw(
            ctx,
            renderer,
            camera,
            director,
            cue,
            match,
            options.sport,
            layout,
            controlLayout,
            touch,
            input,
          );
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

/** One frame. Split out so it is a function of state rather than of closure. */
function draw(
  ctx: Canvas2D,
  renderer: Renderer,
  camera: Camera,
  director: CameraDirector,
  cue: { snap: boolean },
  match: LiveMatch,
  sport: SportModule,
  layout: HudLayout,
  controlLayout: ControlLayout,
  touch: TouchInput,
  input: InputRouter,
): void {
  const view = match.view();
  const world = match.world;
  const ball = (match.sportState as { ball: EntityId }).ball;

  // The director frames by phase of play (T-12.2) from a signal that names no sport. Under the
  // `fixed` motion setting it declines to move the camera at all (T-12.7), which is why this is an
  // unconditional call rather than a branch here.
  const signal = framingSignal(world, view, ball);
  if (cue.snap) {
    cue.snap = false;
    director.snap(signal);
  } else {
    director.update(1 / 60, signal);
  }
  const transform = camera.view();

  renderer.setStatic(
    sport.render.fieldKey(sport.field, transform),
    transform.width,
    transform.height,
    () => {
      // Nothing: the static layer is drawn in world space by the sport, below.
    },
  );

  renderer.submit('field', (c, v) => sport.render.drawField(c, sport.field, v));
  renderer.submit('entities', (c, v) =>
    sport.render.drawAthletes(
      c,
      match.sportState as never,
      world,
      view.status.controlled,
      renderer.lodFor(v),
    ),
  );
  renderer.submit('ball', (c) => sport.render.drawBall(c, match.sportState as never, world, ball));
  renderer.submit('effects', (c, v) =>
    sport.render.drawOverlay(c, match.sportState as never, world, v),
  );

  renderer.submit('hud', (c) => {
    drawHud(c, view, layout, sport.hud);
    drawMinimap(
      c,
      minimapFrame(layout, sport.field.width, sport.field.height),
      view,
      world,
      sport.field.width,
      sport.field.height,
      { viewport: camera.viewport(), ball },
    );

    const point = { x: 0, y: 0 };
    drawEdgeMarkers(
      c,
      edgeMarkers(world, view, ball, (wx, wy) => camera.worldToScreen(wx, wy, point), layout),
      layout,
      DEFAULT_HUD_THEME,
      view.playerSide,
    );

    if (input.showTouchControls) {
      drawTouchControls(c, controlLayout, touch, buttonCaptions(sport, view));
    }
  });

  renderer.render(ctx, transform);
}

/**
 * What the three buttons currently do, in `defaultButtons()` order: A, B, then the modifier.
 *
 * The first two come from the sport, via `SportHudSpec.buttonLabels` keyed by the sport's own
 * `SportStatus.buttonContext`. The third is Sprint in both sports and in the keymap, and it does not
 * change with the situation, so it is not the sport's to name.
 *
 * An empty string means "draw no caption", which is what a sport that reports no context gets.
 *
 * @spec-ref 06-game-design.md §2 — context-sensitive button labels
 */
export function buttonCaptions(
  sport: SportModule,
  view: MatchView,
): readonly [string, string, string] {
  const context = view.status.buttonContext;
  const pair = context === undefined ? undefined : sport.hud.buttonLabels[context];
  return [pair?.[0] ?? '', pair?.[1] ?? '', 'Sprint'];
}

/**
 * The floating stick and the context buttons (`06` §2). Targets are ≥44 px by construction.
 *
 * **The captions are the point (T-6.29).** Before them this drew three bare circles, and the first
 * thing the user said after playing a deployed build was that they could not work out how to control
 * it. `buttonLabels` had carried the right words for both sports since T-2.10 and nothing read them.
 */
function drawTouchControls(
  ctx: Canvas2D,
  layout: ControlLayout,
  touch: TouchInput,
  captions: readonly [string, string, string] = ['', '', ''],
): void {
  const stick = stickVisual(touch.stick, layout);
  if (stick.visible) {
    ctx.strokeStyle = 'rgba(242, 237, 228, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, layout.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(242, 237, 228, 0.7)';
    ctx.beginPath();
    ctx.arc(stick.thumbX, stick.thumbY, layout.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  const buttons = defaultButtons(layout);
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    if (button === undefined) continue;

    const held = touch.isHeld(button.id);

    // A held button fills rather than brightens: a shape change, not a shade change, so the
    // feedback survives a colourblind player and a phone in sunlight alike (INV-11).
    ctx.strokeStyle = 'rgba(242, 237, 228, 0.5)';
    ctx.lineWidth = held ? 4 : 2;
    ctx.beginPath();
    ctx.arc(button.x, button.y, button.radius, 0, Math.PI * 2);
    ctx.stroke();

    const caption = captions[i] ?? '';
    if (caption === '') continue;

    // Sized to the button so the longest caption either sport has ("Shoot", "Tackle", "Sprint")
    // fits inside the smallest circle, and centred on it — a label beside the button reads as
    // belonging to whatever else is under it.
    ctx.fillStyle = 'rgba(242, 237, 228, 0.92)';
    ctx.font = `600 ${Math.round(button.radius * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(caption, button.x, button.y + button.radius * 0.15);
  }
}

/**
 * Settings a player can change without leaving the match (`06` §2, `10` §9).
 *
 * Deliberately short. Handedness and sound take effect the instant they are toggled, which is what
 * makes them worth putting here; the assist strengths in `06` §2 need the settings store and the
 * difficulty seam that arrive with Phase 7, and a toggle that quietly does nothing is worse than no
 * toggle at all.
 */
export interface MatchSettings {
  leftHanded: boolean;
  sound: boolean;
  /**
   * How much the camera may move (T-12.7).
   *
   * It is in the *match* settings rather than only in app Settings deliberately. Whether a camera
   * makes you unwell is not a thing you find out on a settings screen — it is a thing you find out
   * ninety seconds into a match, and the fix has to be reachable from there without losing the game
   * you are in the middle of.
   */
  cameraMotion: CameraMotion;
}

export interface PausePanelOptions {
  readonly onResume: () => void;
  readonly onQuit: () => void;
  readonly settings?: MatchSettings;
  readonly onSettingsChange?: () => void;
}

/**
 * The pause menu (`06` §4). Resume is the primary action and the first focusable thing, because it
 * is what almost everyone opening this menu wants.
 */
export function pausePanel(
  doc: Document,
  match: LiveMatch,
  options: PausePanelOptions,
): HTMLElement {
  const panel = doc.createElement('section');
  panel.className = 'live-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Paused');

  const heading = doc.createElement('h2');
  heading.textContent = 'Paused';

  const score = doc.createElement('p');
  score.className = 'live-panel__score';
  const view = match.view();
  score.textContent = `${view.score[0]} – ${view.score[1]} · ${view.periodName} ${view.period}`;

  const actions = doc.createElement('div');
  actions.className = 'live-panel__actions';
  actions.append(
    action(doc, 'Resume', 'primary', options.onResume),
    action(doc, 'Quit match', 'destructive', options.onQuit),
  );

  panel.append(heading, score, actions);
  if (options.settings !== undefined) {
    panel.appendChild(settingsPanel(doc, options.settings, options.onSettingsChange ?? (() => {})));
  }
  panel.appendChild(boxTable(doc, match));
  return panel;
}

/**
 * In-match settings, as real checkboxes with real labels so they are reachable and announced.
 *
 * The label is a sibling with `for`, not a wrapper. Nesting a control inside its own label makes
 * activation ambiguous — the label forwards the click to the control, and whether that double-fires
 * depends on the implementation. A `for`/`id` pair has one activation path and no argument.
 */
export function settingsPanel(
  doc: Document,
  settings: MatchSettings,
  onChange: () => void,
): HTMLElement {
  const group = doc.createElement('fieldset');
  group.className = 'live-panel__settings';

  const legend = doc.createElement('legend');
  legend.textContent = 'Match settings';
  group.appendChild(legend);

  const rows: readonly ['leftHanded' | 'sound', string][] = [
    ['leftHanded', 'Left-handed controls'],
    ['sound', 'Sound'],
  ];

  for (const [key, label] of rows) {
    const row = doc.createElement('div');
    row.className = 'live-panel__setting';

    const id = `match-setting-${key}`;
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      onChange();
    });

    const text = doc.createElement('label');
    text.htmlFor = id;
    text.textContent = label;

    row.append(input, text);
    group.appendChild(row);
  }

  group.appendChild(cameraMotionRow(doc, settings, onChange));
  return group;
}

/**
 * The camera-motion control (T-12.7): a real `<select>` with three named options, not a checkbox.
 *
 * Three because there are three answers, and the middle one is the useful one — "follows the play,
 * but calmly" is what most people who dislike a moving camera actually want, and a checkbox forces
 * them to choose between that and a pitch they cannot read. Each option says what it does rather
 * than what it is called, because "Reduced" tells a player nothing about what they will see.
 */
function cameraMotionRow(
  doc: Document,
  settings: MatchSettings,
  onChange: () => void,
): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'live-panel__setting live-panel__setting--wide';

  const id = 'match-setting-cameraMotion';
  const label = doc.createElement('label');
  label.htmlFor = id;
  label.textContent = 'Camera';

  const select = doc.createElement('select');
  select.id = id;

  const choices: readonly [CameraMotion, string][] = [
    ['full', 'Follows the play'],
    ['reduced', 'Follows calmly — no zooming'],
    ['fixed', 'Fixed — whole field, small players'],
  ];
  for (const [value, text] of choices) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = settings.cameraMotion === value;
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    settings.cameraMotion = select.value as CameraMotion;
    onChange();
  });

  row.append(label, select);
  return row;
}

/** The post-match summary (`06` §4). Coins, XP, and achievements arrive with Phase 8. */
export function summaryPanel(doc: Document, match: LiveMatch, onDone: () => void): HTMLElement {
  const panel = doc.createElement('section');
  panel.className = 'live-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Full time');

  const view = match.view();
  const heading = doc.createElement('h2');
  heading.textContent = 'Full time';

  const score = doc.createElement('p');
  score.className = 'live-panel__score';
  score.textContent = `${view.score[0]} – ${view.score[1]}`;

  const result = doc.createElement('p');
  result.className = 'live-panel__result';
  result.textContent = resultText(view.score[0], view.score[1], view.playerSide);

  const actions = doc.createElement('div');
  actions.className = 'live-panel__actions';
  actions.append(action(doc, 'Done', 'primary', onDone));

  panel.append(heading, score, result, boxTable(doc, match), actions);
  return panel;
}

/** Says what happened in words, not only in numbers — the score alone is not a result. */
export function resultText(home: number, away: number, playerSide: Side): string {
  if (home === away) return 'Tied.';
  const homeWon = home > away;
  if (playerSide === -1) return homeWon ? 'Home win.' : 'Away win.';
  const won = (playerSide === 0) === homeWon;
  return won ? 'You win.' : 'You lose.';
}

/** The box score, as a real table so a screen reader can navigate it (`10` §6). */
export function boxTable(doc: Document, match: LiveMatch): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.className = 'live-panel__box';

  for (const side of [0, 1] as const) {
    const table = doc.createElement('table');
    const caption = doc.createElement('caption');
    const totals = teamLine(match.box, side);
    caption.textContent = `${side === 0 ? 'Home' : 'Away'} — ${totals.points}`;

    const head = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    for (const label of ['Athlete', 'PTS', 'FG', 'REB', 'AST']) {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);

    const body = doc.createElement('tbody');
    for (const row of boxRows(match.view(), side)) {
      const tr = doc.createElement('tr');
      const label = doc.createElement('th');
      label.scope = 'row';
      label.textContent = row.label;
      tr.appendChild(label);
      for (const value of [row.points, row.shooting, row.rebounds, row.assists]) {
        const td = doc.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }

    table.append(caption, head, body);
    wrapper.appendChild(table);
  }

  return wrapper;
}

function action(
  doc: Document,
  label: string,
  variant: string,
  onClick: () => void,
): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = `button button--${variant}`;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

/** An off-screen canvas for the renderer's static layer. */
function offscreen(doc: Document, width: number, height: number): OffscreenLayer {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    canvas,
    ctx: canvas.getContext('2d') as unknown as Canvas2D,
    width,
    height,
  };
}
