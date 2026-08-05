/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.4 — Match checkpointing and resume-after-kill, all three modes
 * @story   US-10.3 — Resume an interrupted match
 * @design  05-data-model.md §1, 10-ui-ux.md §10
 * @invariant INV-8 (a resumed match is still a deterministic one)
 *
 * Purpose: that an interrupted match comes back as the match it was, and that a checkpoint this
 * build does not understand is dropped rather than half-read.
 *
 * The failure this guards against is subtle: a resume that *almost* works — right score, wrong
 * period; or a stale record from an older build read as if it were current — is worse than no
 * resume, because the player cannot tell it went wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_VERSION,
  describeMatch,
  formatResume,
  isCurrentCheckpoint,
  parseResume,
  resumeHref,
  type MatchCheckpoint,
} from '@/modes/checkpoint.ts';
import { LiveMatch } from '@/modes/live/match.ts';
import { basketball } from '@/sports/basketball/index.ts';

const CHECKPOINT: MatchCheckpoint = {
  schemaVersion: CHECKPOINT_VERSION,
  mode: 'live',
  sport: 'basketball',
  href: '#/play/live/basketball?length=short',
  label: 'Basketball · Live',
  detail: '42–38, Quarter 3',
  savedAt: 1_700_000_000_000,
  resume: { score: [42, 38], period: 3, periodStep: 1200 },
};

describe('resume state on a link', () => {
  it('round-trips', () => {
    expect(parseResume(formatResume(CHECKPOINT.resume!))).toEqual(CHECKPOINT.resume);
  });

  it('reads as something a person could look at', () => {
    expect(formatResume({ score: [42, 38], period: 3, periodStep: 1200 })).toBe('42-38:3:1200');
  });

  it('rejects anything malformed rather than half-reading it', () => {
    // A bad link starts a fresh match, which is the only safe wrong answer.
    for (const bad of ['', '42-38', '42-38:3', 'a-b:3:4', '42-38:3:4:5', '-1-2:3:4']) {
      expect(parseResume(bad)).toBeUndefined();
    }
    expect(parseResume(undefined)).toBeUndefined();
  });

  it('appends to an href that already has a query, and to one that does not', () => {
    expect(resumeHref(CHECKPOINT)).toBe('#/play/live/basketball?length=short&resume=42-38:3:1200');
    expect(resumeHref({ ...CHECKPOINT, href: '#/play/live/basketball' })).toBe(
      '#/play/live/basketball?resume=42-38:3:1200',
    );
  });

  it('leaves a checkpoint with no resume state as a plain link', () => {
    // An arcade run: the card starts it again rather than pretending to resume it.
    const { resume: _resume, ...arcade } = CHECKPOINT;
    expect(resumeHref({ ...arcade, mode: 'arcade' })).toBe(CHECKPOINT.href);
  });
});

describe('reading a stored checkpoint', () => {
  it('accepts one this build wrote', () => {
    expect(isCurrentCheckpoint(CHECKPOINT)).toBe(true);
  });

  it('rejects one from a different schema version', () => {
    // Discarded rather than migrated: it describes a match at most one session old, and a wrong
    // resume is worse than no resume.
    expect(isCurrentCheckpoint({ ...CHECKPOINT, schemaVersion: CHECKPOINT_VERSION + 1 })).toBe(
      false,
    );
  });

  it('rejects junk, including the shapes a truncated write would leave', () => {
    for (const bad of [null, undefined, 42, 'checkpoint', {}, { schemaVersion: 1 }]) {
      expect(isCurrentCheckpoint(bad)).toBe(false);
    }
    const { label: _label, ...missingLabel } = CHECKPOINT;
    expect(isCurrentCheckpoint(missingLabel)).toBe(false);
  });

  it('rejects a mode this build does not have', () => {
    expect(isCurrentCheckpoint({ ...CHECKPOINT, mode: 'tournament' })).toBe(false);
  });
});

describe('resuming a live match', () => {
  it('starts on the scoreboard it was left on', () => {
    const match = new LiveMatch({
      sport: basketball,
      seed: 'resumed',
      playerSide: -1,
      resumeFrom: { score: [42, 38], period: 3, periodStep: 600 },
    });

    const view = match.view();
    expect(view.score).toEqual([42, 38]);
    expect(view.period).toBe(3);
  });

  it('starts at 0–0 in period 1 without one', () => {
    const match = new LiveMatch({ sport: basketball, seed: 'fresh', playerSide: -1 });
    expect(match.view().score).toEqual([0, 0]);
    expect(match.view().period).toBe(1);
  });

  it('does not restore the box score, and does not pretend to', () => {
    // The events that built the old one are gone. Inventing a plausible one would be a lie told
    // in numbers, so a resumed match starts with an empty box and the UI says so.
    const match = new LiveMatch({
      sport: basketball,
      seed: 'resumed',
      playerSide: -1,
      resumeFrom: { score: [42, 38], period: 3, periodStep: 600 },
    });
    expect(match.box.lines.size).toBe(0);
  });

  it('clamps a clock that no longer fits the period', () => {
    // T-8.2 lets a player change the match length between sessions, so a step count from a full
    // match can exceed a short period. Starting a period already expired would end it instantly.
    const short = { periodSteps: 100 };
    const match = new LiveMatch({
      sport: basketball,
      seed: 'clamped',
      playerSide: -1,
      rules: short,
      resumeFrom: { score: [10, 10], period: 2, periodStep: 99_999 },
    });

    expect(match.stepInPeriod).toBeLessThan(short.periodSteps);
    expect(match.finished).toBe(false);
  });

  it('is still deterministic (INV-8)', () => {
    const play = () => {
      const match = new LiveMatch({
        sport: basketball,
        seed: 'determinism',
        playerSide: -1,
        resumeFrom: { score: [20, 18], period: 2, periodStep: 300 },
      });
      for (let i = 0; i < 600; i++) match.step();
      return match.view().score;
    };
    expect(play()).toEqual(play());
  });
});

describe('how a resume reads', () => {
  it('leads with the score, then says how much is left', () => {
    expect(describeMatch([42, 38], 'Quarter', 3)).toBe('42–38, Quarter 3');
    expect(describeMatch([0, 0], 'Half', 1)).toBe('0–0, Half 1');
  });
});
