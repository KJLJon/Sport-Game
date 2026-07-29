/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.9 — Playbook hot-seat: pass-the-device screens, hidden calls, local player names
 * @story   US-17.1 — Play against someone else on one device
 * @design  09-modes-and-arcade.md §4 (hot-seat local multiplayer), §2.1, 10-ui-ux.md §8.4
 * @invariant INV-5 (nothing sport-specific here)
 *
 * Purpose: two people, one phone, one match. Both sides call every turn in Playbook, so hot seat is
 * a sequence: one player calls, the device is handed over behind a curtain, the other calls, and
 * only then does the turn resolve.
 *
 * **The curtain is the feature.** `09` §4 asks for "a clear 'pass the phone to <name>' screen
 * between turns, with an optional hide-my-calls curtain". The hand-over is not a transition
 * animation — it is the thing that makes the mode fair, because a call the other player saw is not
 * a call. So the curtain is a distinct phase that only a deliberate tap leaves, and the second
 * player's sheet cannot be reached without passing through it.
 *
 * **Names, not seats.** `09` §4 is explicit that the screens say "Dad" and "Ana". Names come from
 * `modes/local-players.ts`, which Phase 4 already built for arcade party rounds — the same list,
 * so a household names its people once.
 *
 * **The curtain is optional, and off is a real choice.** Two people playing on the sofa who do not
 * care about hiding calls should not have to tap through a screen twice a possession, 210 times.
 * With it off the hand-over still happens; it just does not conceal anything.
 */
import type { Side } from '../../engine/match/events.ts';
import type { LocalPlayer } from '../local-players.ts';

export const HOT_SEAT_PHASES = ['handover', 'calling', 'ready'] as const;
export type HotSeatPhase = (typeof HOT_SEAT_PHASES)[number];

export interface HotSeatSeat {
  readonly side: Side;
  readonly player: LocalPlayer;
}

export interface HotSeatOptions {
  /** Exactly two, one per side. `09` §4's 2–4 is arcade's party range; a match has two teams. */
  readonly seats: readonly [HotSeatSeat, HotSeatSeat];
  /** Whether calls are concealed during the hand-over. Default on. */
  readonly curtain?: boolean;
  /** Which side calls first each turn. Defaults to whoever has the ball. */
  readonly firstSide?: Side;
}

export interface HotSeatView {
  readonly phase: HotSeatPhase;
  /** Whose turn it is to call, or `null` once both have. */
  readonly side: Side | null;
  readonly name: string;
  /** "Pass the phone to Ana" — the line the hand-over screen shows. */
  readonly prompt: string;
  /** True while the other player's already-made call must stay hidden. */
  readonly concealing: boolean;
  /** How many of the two have called this turn. */
  readonly called: number;
}

/**
 * The hand-over state machine for one turn. Construct per turn, or call `nextTurn()` — it holds no
 * match state of its own, which is what keeps it testable with no match in sight.
 */
export class HotSeat {
  private readonly seats: readonly [HotSeatSeat, HotSeatSeat];
  private readonly curtainOn: boolean;
  private order: Side[] = [];
  private index = 0;
  private phaseName: HotSeatPhase = 'handover';

  constructor(options: HotSeatOptions) {
    this.seats = options.seats;
    this.curtainOn = options.curtain ?? true;
    this.beginTurn(options.firstSide ?? options.seats[0].side);
  }

  /** Starts a new turn's hand-over sequence, with `first` calling first. */
  nextTurn(first: Side): void {
    this.beginTurn(first);
  }

  private beginTurn(first: Side): void {
    const other = this.seats.find((seat) => seat.side !== first)?.side;
    this.order = other === undefined ? [first] : [first, other];
    this.index = 0;
    // The first hand-over of a turn is skippable when nothing is being hidden: with the curtain off
    // there is nothing to pass *behind*, and a screen that only says "your turn" is a tap tax.
    this.phaseName = this.curtainOn ? 'handover' : 'calling';
  }

  get phase(): HotSeatPhase {
    return this.phaseName;
  }

  /** Whose turn it is to call, or `null` once both have. */
  get side(): Side | null {
    return this.index < this.order.length ? (this.order[this.index] as Side) : null;
  }

  get seat(): HotSeatSeat | undefined {
    const side = this.side;
    return side === null ? undefined : this.seats.find((candidate) => candidate.side === side);
  }

  /** Leaves the hand-over screen. The only way into `calling`, deliberately. */
  ready(): void {
    if (this.phaseName !== 'handover') return;
    this.phaseName = 'calling';
  }

  /**
   * Records that the current player has called. Moves to the next hand-over, or to `ready` once
   * both have — at which point the turn may resolve.
   */
  submitted(): void {
    if (this.phaseName !== 'calling') return;
    this.index += 1;
    if (this.index >= this.order.length) {
      this.phaseName = 'ready';
      return;
    }
    this.phaseName = this.curtainOn ? 'handover' : 'calling';
  }

  /** True while a call already made must stay off the screen. */
  get concealing(): boolean {
    return this.curtainOn && this.phaseName === 'handover';
  }

  get called(): number {
    return this.index;
  }

  view(): HotSeatView {
    const seat = this.seat;
    const name = seat?.player.name ?? '';
    return {
      phase: this.phaseName,
      side: this.side,
      name,
      prompt: promptFor(this.phaseName, name),
      concealing: this.concealing,
      called: this.index,
    };
  }
}

/** The one line each phase shows. Names, never seat numbers (`09` §4). */
export function promptFor(phase: HotSeatPhase, name: string): string {
  if (phase === 'handover') return name === '' ? 'Pass the phone.' : `Pass the phone to ${name}.`;
  if (phase === 'calling') return name === '' ? 'Make your call.' : `${name}, make your call.`;
  return 'Both calls are in.';
}

/** Builds the two seats from a local-player list, in side order. */
export function seatsFor(
  players: readonly LocalPlayer[],
): readonly [HotSeatSeat, HotSeatSeat] | null {
  const home = players[0];
  const away = players[1];
  if (home === undefined || away === undefined) return null;
  return [
    { side: 0, player: home },
    { side: 1, player: away },
  ];
}
