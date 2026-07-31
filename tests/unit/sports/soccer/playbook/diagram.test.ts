/**
 * T-6.21 — soccer's animated pitch diagram.
 *
 * The diagram is a pure function of a resolved turn, so everything worth asserting about the
 * animation is assertable without a canvas: that the attacking side always runs left-to-right,
 * that a phase moves the block up the pitch, that a shot is drawn from where the model actually
 * took it, and that nothing is drawn for something that did not happen.
 *
 * `modes/playbook/diagram.test.ts` owns the timeline and the drawing; this file owns the geometry
 * soccer supplies to them.
 */
import { describe, expect, it } from 'vitest';
import { diagramAt, finalFrame } from '../../../../../src/modes/playbook/diagram.ts';
import { simulatePlaybookMatch } from '../../../../../src/modes/playbook/match.ts';
import { PITCH } from '../../../../../src/sports/soccer/pitch.ts';
import { SOCCER_RULES } from '../../../../../src/sports/soccer/rules.ts';
import { soccerPlaybook } from '../../../../../src/sports/soccer/playbook/index.ts';
import {
  GOAL,
  ballLine,
  buildDiagram,
  pushed,
  rolePoint,
  toDiagram,
} from '../../../../../src/sports/soccer/playbook/diagram.ts';
import { SOCCER_PHASES } from '../../../../../src/sports/soccer/playbook/phases.ts';
import type { SoccerPlaybookState } from '../../../../../src/sports/soccer/playbook/resolution.ts';
import { soccerSquads } from '../../../../../src/sports/soccer/playbook/squad.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';

function eleven(prefix: string): ReturnType<typeof athlete>[] {
  return Array.from({ length: 11 }, (_, index) =>
    athlete({
      id: `${prefix}-${index}`,
      displayName: `${prefix} Player${index}`,
      primarySport: 'soccer',
      heightCm: 180,
      weightKg: 76,
      attributes: attributes(58),
      sportSkills: { soccer: newSportSkill(72) },
    }),
  );
}

function simulate(seed: string): ReturnType<typeof simulatePlaybookMatch<SoccerPlaybookState>> {
  return simulatePlaybookMatch<SoccerPlaybookState>({
    seed,
    adapter: soccerPlaybook,
    sport: 'soccer',
    rules: SOCCER_RULES,
    squads: soccerSquads(eleven('home'), eleven('away')),
    playerSide: -1,
  });
}

describe('soccer pitch diagram — geometry', () => {
  it('reads the shape from the formations rather than a table of its own', () => {
    // A centre back plays deep and a striker high, in every formation that names them.
    expect(rolePoint('lcb').x).toBeLessThan(0.25);
    expect(rolePoint('gk').x).toBeLessThan(0.06);
    expect(rolePoint('ls').x).toBeGreaterThan(0.6);
    // A role no formation names is not a crash.
    expect(rolePoint('nonsense')).toEqual({ x: 0.5, y: 0.5 });
  });

  it('walks the ball up the pitch, phase by phase', () => {
    const lines = SOCCER_PHASES.map((phase) => ballLine(phase));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(lines[0]).toBeLessThan(0.25);
    expect(lines.at(-1)).toBeGreaterThan(0.85);
  });

  it('mirrors side 1 so the attacking side always runs left-to-right', () => {
    const nearOwnGoal = toDiagram(10, 20, 0);
    expect(nearOwnGoal.x).toBeCloseTo(10 / PITCH.length, 6);

    // The same metres, attacked from the other end, are the same fraction from the diagram's left.
    const mirrored = toDiagram(PITCH.length - 10, PITCH.width - 20, 1);
    expect(mirrored.x).toBeCloseTo(nearOwnGoal.x, 6);
    expect(mirrored.y).toBeCloseTo(nearOwnGoal.y, 6);
  });

  it('follows the ball with the front of the block harder than the back of it', () => {
    const line = ballLine('chance');
    const backBase = 0.16;
    const frontBase = 0.72;
    const back = pushed({ x: backBase, y: 0.38 }, line, 1);
    const front = pushed({ x: frontBase, y: 0.4 }, line, 1);

    // The *share* of the distance closed is what stretches the shape — the striker is already near
    // the ball, so a larger share is a smaller number of metres.
    const share = (at: number, base: number): number => (at - base) / (line - base);
    expect(share(front.x, frontBase)).toBeGreaterThan(share(back.x, backBase));

    // And the shape survives: the striker stays in front of the centre back, short of the ball.
    expect(front.x).toBeGreaterThan(back.x);
    expect(front.x).toBeLessThan(line);
  });

  it('drops the strikers in for a build-up and pushes the defence up for a chance', () => {
    const striker = { x: 0.72, y: 0.4 };
    const centreBack = { x: 0.16, y: 0.38 };
    expect(pushed(striker, ballLine('buildUp'), 1).x).toBeLessThan(striker.x);
    expect(pushed(centreBack, ballLine('chance'), 1).x).toBeGreaterThan(centreBack.x);
  });

  it('spreads the shape for a wide intent and squeezes it for a narrow one', () => {
    const wing = { x: 0.45, y: 0.14 };
    const wide = pushed(wing, 0.5, 1.2);
    const narrow = pushed(wing, 0.5, 0.78);
    expect(wide.y).toBeLessThan(narrow.y);
    // And nobody is drawn on the touchline itself.
    expect(pushed({ x: 0.45, y: 0 }, 0.5, 1.2).y).toBeGreaterThanOrEqual(0.05);
  });
});

describe('soccer pitch diagram — a resolved turn', () => {
  it('draws ten outfielders and the defender the turn was resolved against', () => {
    const match = simulate('diagram-markers');
    const turn = match.turns[0];
    if (turn === undefined) throw new Error('no turns');

    const diagram = buildDiagram(match.state, turn);
    const attacking = diagram.markers.filter((marker) => marker.side === turn.attacking);
    const defending = diagram.markers.filter((marker) => marker.side !== turn.attacking);

    expect(attacking.length).toBe(10);
    expect(defending.length).toBe(1);
    expect(defending[0]?.id).toBe(turn.target);
    expect(diagram.markers.filter((marker) => marker.primary === true).length).toBe(1);
    expect(diagram.markers.every((marker) => marker.label.length > 0)).toBe(true);
  });

  it('puts the athlete the turn was about on the ball', () => {
    const match = simulate('diagram-actor');
    for (const turn of match.turns.slice(0, 8)) {
      const diagram = buildDiagram(match.state, turn);
      const primary = diagram.markers.find((marker) => marker.primary === true);
      expect(primary?.id).toBe(turn.actor);
    }
  });

  it('draws a shot from where the model took it, and none where there was no shot', () => {
    const match = simulate('diagram-shots');
    let checkedShot = false;
    let checkedQuiet = false;

    for (const turn of match.turns) {
      const diagram = buildDiagram(match.state, turn);
      const shots = diagram.shapes.filter((shape) => shape.kind === 'shot');
      const events = turn.events.filter((entry) => entry.kind === 'shot');

      expect(shots.length).toBe(Math.min(3, events.length));

      if (events.length > 0) {
        checkedShot = true;
        const first = events[0];
        const drawn = shots[0];
        if (first === undefined || drawn === undefined) throw new Error('unreachable');
        expect(drawn.from).toEqual(toDiagram(first.x ?? 0, first.y ?? 0, turn.attacking));
        expect(drawn.to).toEqual(GOAL);
        // A shot is taken in the attacking half, and its arc finishes at the goal.
        expect(drawn.from.x).toBeGreaterThan(0.5);
      } else {
        checkedQuiet = true;
      }

      if (turn.outcome === 'goal') {
        expect(shots.some((shape) => shape.made === true)).toBe(true);
      }
    }

    expect(checkedShot && checkedQuiet).toBe(true);
  });

  it('runs for four to eight seconds, as `09` §2.1 asks', () => {
    const match = simulate('diagram-seconds');
    for (const turn of match.turns) {
      const diagram = buildDiagram(match.state, turn);
      expect(diagram.seconds).toBeGreaterThanOrEqual(4);
      expect(diagram.seconds).toBeLessThanOrEqual(8);
    }
  });

  it('keeps every beat inside the run, in order, and every point on the pitch', () => {
    const match = simulate('diagram-bounds');
    for (const turn of match.turns) {
      const diagram = buildDiagram(match.state, turn);
      for (const shape of diagram.shapes) {
        expect(shape.at).toBeGreaterThanOrEqual(0);
        expect(shape.until).toBeGreaterThan(shape.at);
        expect(shape.until).toBeLessThanOrEqual(1);
      }
      for (const marker of diagram.markers) {
        for (const point of [marker.from, marker.to]) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(1);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('animates: nothing is drawn at zero, and everything has been by the end', () => {
    const match = simulate('diagram-animation');
    const turn = match.turns.find((entry) => entry.outcome === 'goal') ?? match.turns[0];
    if (turn === undefined) throw new Error('no turns');

    const diagram = buildDiagram(match.state, turn);
    expect(diagramAt(diagram, 0).shapes.length).toBe(0);

    const last = finalFrame(diagram);
    expect(last.finished).toBe(true);
    expect(last.shapes.length).toBe(diagram.shapes.length);
    expect(last.shapes.every((shape) => shape.progress === 1)).toBe(true);
    // Markers finish where the phase sent them, not part-way there.
    for (const marker of last.markers) {
      expect(marker.at.x).toBeCloseTo(marker.to.x, 6);
      expect(marker.at.y).toBeCloseTo(marker.to.y, 6);
    }
  });

  it('is the diagram the adapter hands the screen', () => {
    const match = simulate('diagram-adapter');
    const turn = match.turns[0];
    if (turn === undefined) throw new Error('no turns');
    expect(soccerPlaybook.diagram?.(match.state, turn)).toEqual(buildDiagram(match.state, turn));
  });

  it('says the same thing on a replay of the same seed', () => {
    const first = simulate('diagram-replay');
    const second = simulate('diagram-replay');
    expect(second.turns.map((turn) => buildDiagram(second.state, turn))).toEqual(
      first.turns.map((turn) => buildDiagram(first.state, turn)),
    );
  });
});
