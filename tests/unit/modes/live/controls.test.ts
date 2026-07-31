/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.29 — Draw the touch buttons' captions from `SportHudSpec.buttonLabels`
 * @story   US-2.6 — Control the game with my thumbs
 * @design  06-game-design.md §2 (context-sensitive button labels)
 * @invariant INV-11 (no information by colour alone)
 *
 * Purpose: that the two action buttons say what they currently do, in the sport's own words.
 *
 * **Why this file exists.** `buttonLabels` shipped with basketball in T-2.10 and with soccer in
 * T-6.10, carrying exactly the right words for both, and nothing ever read it — so the game drew
 * three unlabelled circles and the first person to play a deployed build could not work out how to
 * control it. Every test below fails against the code as it stood before T-6.29.
 */
import { describe, expect, it } from 'vitest';
import { LiveMatch } from '@/modes/live/match.ts';
import { buttonCaptions } from '@/modes/live/screen.ts';
import { basketball } from '@/sports/basketball/index.ts';
import { soccer } from '@/sports/soccer/index.ts';
import { TouchInput } from '@/engine/input/sources.ts';
import { defaultButtons, type ControlLayout } from '@/engine/input/joystick.ts';
import type { SportModule } from '@/sports/types.ts';
import type { MatchView } from '@/modes/live/match.ts';

const LAYOUT: ControlLayout = {
  width: 800,
  height: 400,
  radius: 56,
  leftHanded: false,
  deadzone: 0.15,
};

/** A view carrying nothing but the one field the captions depend on. */
function viewWith(context: string | undefined): MatchView {
  return { status: { buttonContext: context } } as unknown as MatchView;
}

describe('what the buttons say (T-6.29)', () => {
  it('names the sport′s own actions for the state the sport reports', () => {
    expect(buttonCaptions(basketball, viewWith('onBall'))).toEqual(['Shoot', 'Pass', 'Sprint']);
    expect(buttonCaptions(basketball, viewWith('defence'))).toEqual(['Steal', 'Block', 'Sprint']);
    expect(buttonCaptions(soccer, viewWith('defence'))).toEqual(['Tackle', 'Slide', 'Sprint']);
  });

  it('gives the two sports different words for the same state', () => {
    // The whole point of the seam: "Steal/Block" is basketball defending, "Tackle/Slide" is soccer.
    expect(buttonCaptions(basketball, viewWith('defence'))).not.toEqual(
      buttonCaptions(soccer, viewWith('defence')),
    );
  });

  it('keeps Sprint out of the sport′s hands, because it never changes', () => {
    for (const context of ['onBall', 'offBall', 'defence']) {
      expect(buttonCaptions(soccer, viewWith(context))[2]).toBe('Sprint');
    }
  });

  it('draws no caption rather than a wrong one when the sport reports no context', () => {
    // A Phase-1 test fixture, or any sport that has not opted in.
    expect(buttonCaptions(basketball, viewWith(undefined))).toEqual(['', '', 'Sprint']);
  });

  it('draws no caption for a context the sport has no labels for', () => {
    expect(buttonCaptions(basketball, viewWith('faceoff'))).toEqual(['', '', 'Sprint']);
  });

  it('asks the sport, not the mode — a sport with its own states is honoured', () => {
    const invented = {
      hud: { showShotClock: false, buttonLabels: { serving: ['Serve', 'Lob'] } },
    } as unknown as SportModule;
    expect(buttonCaptions(invented, viewWith('serving'))).toEqual(['Serve', 'Lob', 'Sprint']);
  });
});

describe('the state each sport reports (T-6.29)', () => {
  /** Steps a real match until the reported context is one we want to assert on. */
  function contextsSeen(sport: SportModule, steps: number): Set<string> {
    const match = new LiveMatch({ seed: 'captions', sport, playerSide: 0 });
    const seen = new Set<string>();
    for (let i = 0; i < steps; i++) {
      match.step();
      const context = match.view().status.buttonContext;
      if (context !== undefined) seen.add(context);
    }
    return seen;
  }

  it('reports a context basketball has labels for, every step of a real match', () => {
    for (const context of contextsSeen(basketball, 1200)) {
      expect(basketball.hud.buttonLabels[context], `no labels for "${context}"`).toBeDefined();
    }
  });

  it('reports a context soccer has labels for, every step of a real match', () => {
    for (const context of contextsSeen(soccer, 1200)) {
      expect(soccer.hud.buttonLabels[context], `no labels for "${context}"`).toBeDefined();
    }
  });

  it('actually changes as possession does, rather than being one constant', () => {
    // A context that never moved would satisfy every assertion above and tell the player nothing.
    expect(contextsSeen(basketball, 3000).size).toBeGreaterThan(1);
  });
});

describe('which button is down', () => {
  it('reports held state per button, not just as a mask', () => {
    const touch = new TouchInput(LAYOUT, defaultButtons(LAYOUT));
    const [a, b] = defaultButtons(LAYOUT);

    expect(touch.isHeld(a!.id)).toBe(false);
    touch.pointerDown(1, a!.x, a!.y);
    expect(touch.isHeld(a!.id)).toBe(true);
    expect(touch.isHeld(b!.id)).toBe(false);

    touch.pointerUp(1);
    expect(touch.isHeld(a!.id)).toBe(false);
  });

  it('lets go of everything when a gesture is cancelled', () => {
    const touch = new TouchInput(LAYOUT, defaultButtons(LAYOUT));
    const [a] = defaultButtons(LAYOUT);
    touch.pointerDown(1, a!.x, a!.y);
    touch.cancelAll();
    expect(touch.isHeld(a!.id)).toBe(false);
  });
});
