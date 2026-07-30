/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.1 (one line of narration, not a wall of text)
 * @invariant INV-5 (no sport branching outside the sport module)
 *
 * Purpose: the one line the turn screen shows for a soccer phase turn.
 *
 * **T-6.21 owns narration and deepens this.** What is here is the honest minimum a mandatory
 * adapter member needs: every outcome names the athlete it was about and carries a tone, and no
 * outcome falls through to a status code. What T-6.21 adds is variety — several lines per outcome,
 * picked seeded — and the animated pitch diagram beside them. The line *shape* is settled here so
 * that adding variants is adding strings.
 */
import type {
  NarrationLine,
  NarrationTone,
  PlaybookAthlete,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { phaseName, type SoccerPhase } from './phases.ts';
import type { SoccerPlaybookState } from './resolution.ts';

/** How each outcome reads. `big` is reserved for the ball hitting the net. */
const TONES: Readonly<Record<string, NarrationTone>> = {
  goal: 'big',
  chance: 'good',
  advance: 'neutral',
  corner: 'good',
  saved: 'neutral',
  'off-target': 'neutral',
  blocked: 'neutral',
  lost: 'bad',
};

function nameOf(state: PlaybookState<SoccerPlaybookState>, id: number | undefined): string {
  if (id === undefined) return 'The move';
  for (const squad of state.squads) {
    const found = squad.players.find((player: PlaybookAthlete) => player.id === id);
    if (found !== undefined) return found.athlete.displayName;
  }
  return 'The move';
}

export function narrateTurn(
  state: PlaybookState<SoccerPlaybookState>,
  resolution: TurnResolution,
): NarrationLine {
  const who = nameOf(state, resolution.actor);
  const against = nameOf(state, resolution.target);
  const phase = state.detail.phase;
  const tone = TONES[resolution.outcome] ?? 'neutral';

  return { text: line(resolution.outcome, phase, who, against), tone };
}

function line(outcome: string, phase: SoccerPhase, who: string, against: string): string {
  switch (outcome) {
    case 'goal':
      return `${who} scores!`;
    case 'saved':
      return `${who} forces the save out of ${against}.`;
    case 'off-target':
      return `${who} gets the shot away and drags it wide.`;
    case 'blocked':
      return `${who}'s shot is blocked on its way through.`;
    case 'corner':
      return `${who} wins a corner.`;
    case 'chance':
      return `${who} works an opening.`;
    case 'advance':
      return phase === 'buildUp'
        ? `${who} plays out of the back.`
        : `${who} carries it into the final third.`;
    case 'lost':
      return `${against} wins it back off ${who}.`;
    default:
      // A phase name is a poor line and a much better one than an outcome id the player never
      // chose to see. Unreachable while `TURN_OUTCOMES` and this switch agree, which a test checks.
      return `${phaseName(phase, true)}: ${who} against ${against}.`;
  }
}
