/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.10 — Match state machine + `SportEvent` bus
 * @story   US-2.4 — Play a match that feels like the sport
 * @design  04-architecture.md §5, §6, 09-modes-and-arcade.md §5
 * @invariant INV-9 (all three modes emit the same event shapes; no consumer branches on mode)
 *
 * Purpose: the one currency that flows out of a match. Stats, achievements, XP, and the economy
 * subscribe to this stream and never inspect sport internals — and, critically, never learn which
 * *mode* produced an event.
 *
 * That last part is enforced by omission: there is no `mode` field to branch on. A Live shot, a
 * Playbook resolution, and an arcade key moment all emit `shot`, and a consumer physically cannot
 * tell them apart. INV-9 is a shape decision, not a code-review rule.
 */
import type { EntityId } from '../world.ts';

/** Which side an event belongs to. `-1` for neutral events like a period ending. */
export type Side = 0 | 1 | -1;

/**
 * Event kinds shared by every sport. A sport adds its own with `sportKind`, keeping the envelope
 * identical so consumers that only understand the common set still work.
 */
export const EventKind = {
  MATCH_START: 'match.start',
  PERIOD_START: 'period.start',
  PERIOD_END: 'period.end',
  MATCH_END: 'match.end',
  POSSESSION: 'possession',
  SHOT: 'shot',
  SCORE: 'score',
  PASS: 'pass',
  TURNOVER: 'turnover',
  SAVE: 'save',
  FOUL: 'foul',
  REBOUND: 'rebound',
  STOPPAGE: 'stoppage',
  SUBSTITUTION: 'substitution',
  /** The escape hatch for sport-specific events; `sportKind` names it. */
  SPORT: 'sport',
} as const;
export type EventKindName = (typeof EventKind)[keyof typeof EventKind];

/**
 * One thing that happened. Flat and serialisable: it goes into replays, into stats aggregation,
 * across the P2P wire, and into achievement evaluation, and every one of those is easier when the
 * event is plain data.
 */
export interface SportEvent {
  readonly kind: EventKindName;
  /** For `kind: 'sport'` — the sport's own name for it, e.g. `'basketball.dunk'`. */
  readonly sportKind?: string;
  /** Simulation step the event occurred on. Not wall-clock: replays must line up exactly. */
  readonly step: number;
  readonly side: Side;
  /** Whoever caused it, if anyone. */
  readonly actor?: EntityId;
  /** Whoever it happened to — the defender contesting, the receiver of a pass. */
  readonly target?: EntityId;
  /** Points scored, distance in metres, probability… meaning is per kind. */
  readonly value?: number;
  /** Where on the field it happened. */
  readonly x?: number;
  readonly y?: number;
  /** Anything else. Kept small; large payloads belong in the sport's own state. */
  readonly detail?: Readonly<Record<string, number | string | boolean>>;
}

export type EventListener = (event: SportEvent) => void;

/**
 * Fan-out for match events, with a bounded history for replays and post-match summaries.
 *
 * Listeners are called synchronously, in subscription order, because an achievement that fires
 * "later" cannot be part of a deterministic replay. Errors from one listener are contained: a
 * broken achievement rule must not take a match down with it.
 */
export class EventBus {
  private readonly listeners: EventListener[] = [];
  private readonly log: SportEvent[] = [];
  private readonly limit: number;
  private dropped = 0;

  constructor(historyLimit = 4096) {
    this.limit = historyLimit;
  }

  /** Subscribes, returning the unsubscribe. */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  emit(event: SportEvent): void {
    this.log.push(event);
    if (this.log.length > this.limit) {
      this.log.shift();
      this.dropped++;
    }

    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A consumer's bug is not the match's problem. Reported, never rethrown.
        console.error('[events] listener failed', error);
      }
    }
  }

  /** Emits several in order. Convenience for `step()` returning a batch. */
  emitAll(events: readonly SportEvent[]): void {
    for (const event of events) this.emit(event);
  }

  /** Everything still in the history window, oldest first. */
  history(): readonly SportEvent[] {
    return this.log;
  }

  /** Events of one kind — what stats and achievements ask for. */
  filter(kind: EventKindName): SportEvent[] {
    return this.log.filter((event) => event.kind === kind);
  }

  /** How many events fell out of the history window. Non-zero means summaries may be incomplete. */
  get droppedCount(): number {
    return this.dropped;
  }

  clear(): void {
    this.log.length = 0;
    this.dropped = 0;
  }
}

/** Builds an event. A helper, so every emitter produces the same shape. */
export function event(
  kind: EventKindName,
  step: number,
  side: Side = -1,
  extras: Omit<SportEvent, 'kind' | 'step' | 'side'> = {},
): SportEvent {
  return { kind, step, side, ...extras };
}
