/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1 (the diagram carries what happened, the line how it felt)
 * @invariant INV-9 (one event stream, read rather than duplicated)
 *
 * Purpose: what actually happened in a phase turn, read back off the turn's own events.
 *
 * **Why read the events rather than widen `TurnResolution`.** Everything narration and the diagram
 * want — which phase it was, how the ball was moved, where the shot was taken from, whether the
 * actor was being marked — is already on the stream `resolve()` emitted, because the box score needs
 * it there anyway (INV-9). Adding a parallel copy to the resolution would mean two descriptions of
 * one turn that a future change could put out of step, and the stream is the one that is checked.
 *
 * **And why not read the state.** `PlaybookState.detail.phase` is the phase the *next* turn will be
 * played in: the turn engine commits, calls `apply()`, and only then is the screen asked to narrate.
 * The `possession` event carries the phase the turn was actually played in, which is the one the
 * player watched.
 */
import { EventKind, type SportEvent } from '../../../engine/match/events.ts';
import type { TurnResolution } from '../../../modes/playbook/types.ts';
import type { PassKind } from '../passing.ts';
import { SoccerEvent } from '../rules.ts';
import { OPENING_PHASE, SOCCER_PHASES, type SoccerPhase } from './phases.ts';

/** One attempt at goal, in the terms the diagram draws and narration mentions. */
export interface ShotFact {
  /** Pitch metres, as the shot model set them up. */
  readonly x: number;
  readonly y: number;
  readonly made: boolean;
  readonly onTarget: boolean;
  /** Metres from goal. */
  readonly distance: number;
  /** The attempt's own xG, `0–1`. */
  readonly chance: number;
}

/** The ball being moved: what kind of pass, and how many of them. */
export interface PassFact {
  readonly kind: PassKind;
  readonly count: number;
}

export interface TurnFacts {
  readonly phase: SoccerPhase;
  /** True when the defending side had named this actor as the athlete to follow (T-6.19's focus). */
  readonly marked: boolean;
  readonly tempo: string;
  readonly width: string;
  readonly press: string;
  readonly pass: PassFact | null;
  /** In the order they were taken. A phase of pressure is several attempts, not one. */
  readonly shots: readonly ShotFact[];
  /** True when the turn ended with a corner being awarded. */
  readonly corner: boolean;
}

const PASS_KINDS: readonly PassKind[] = ['short', 'through', 'lofted', 'cross'];

function text(event: SportEvent | undefined, key: string, fallback: string): string {
  const value = event?.detail?.[key];
  return typeof value === 'string' ? value : fallback;
}

function number(event: SportEvent, key: string, fallback: number): number {
  const value = event.detail?.[key];
  return typeof value === 'number' ? value : fallback;
}

function flag(event: SportEvent, key: string): boolean {
  return event.detail?.[key] === true;
}

/**
 * Reads one resolved turn. Total: a turn whose events a future change reshapes still produces a
 * usable set of facts rather than throwing, because narration failing is worse than narration being
 * vague — the screen has nothing else to show.
 */
export function turnFacts(resolution: TurnResolution): TurnFacts {
  const possession = resolution.events.find((entry) => entry.kind === EventKind.POSSESSION);
  const passEvent = resolution.events.find((entry) => entry.kind === EventKind.PASS);
  const shotEvents = resolution.events.filter((entry) => entry.kind === EventKind.SHOT);

  const phaseId = text(possession, 'phase', OPENING_PHASE);
  const phase = (SOCCER_PHASES as readonly string[]).includes(phaseId)
    ? (phaseId as SoccerPhase)
    : OPENING_PHASE;

  const passKind = text(passEvent, 'kind', 'short');

  return {
    phase,
    marked: possession !== undefined && flag(possession, 'marked'),
    tempo: text(possession, 'tempo', 'balanced-tempo'),
    width: text(possession, 'width', 'balanced-width'),
    press: text(possession, 'press', 'mid'),
    pass:
      passEvent === undefined
        ? null
        : {
            kind: PASS_KINDS.includes(passKind as PassKind) ? (passKind as PassKind) : 'short',
            count: Math.max(1, Math.round(number(passEvent, 'passes', 1))),
          },
    shots: shotEvents.map((entry) => ({
      x: entry.x ?? 0,
      y: entry.y ?? 0,
      made: flag(entry, 'made'),
      onTarget: flag(entry, 'onTarget'),
      distance: number(entry, 'distance', 0),
      chance: number(entry, 'chance', 0),
    })),
    corner: resolution.events.some(
      (entry) => entry.kind === EventKind.SPORT && entry.sportKind === SoccerEvent.RESTART,
    ),
  };
}

/** The attempt worth talking about: the one that went in, or the best one that did not. */
export function keyShot(facts: TurnFacts): ShotFact | null {
  if (facts.shots.length === 0) return null;
  const scored = facts.shots.find((shot) => shot.made);
  if (scored !== undefined) return scored;
  return facts.shots.reduce((best, shot) => (shot.chance > best.chance ? shot : best));
}
