/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @task    T-8.8 — Arcade unlock wiring: achievements gate arcade games, with a clear unlock moment
 * @task    T-8.9 — Achievement UI: gallery, filters, progress bars, in-match toast, post-match
 *          summary
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.2 — Browse my achievements
 * @design  10-ui-ux.md §11 (no information by colour alone), 05-data-model.md §6
 * @invariant INV-11 (locked and unlocked are said in words, not only shown in a tint)
 *
 * Purpose: the two ways an achievement is drawn — a row in the gallery, and the "just unlocked"
 * block on the post-match screen.
 *
 * **A hidden achievement is "???" only while it is locked.** `US-8.2` asks for the mystery; it also
 * asks for the unlock to mean something, and a row that stayed "???" after being earned would be
 * withholding the payoff rather than building to it.
 *
 * **Locked is a word.** The row carries `data-state`, which the stylesheet dims, and it also says
 * "Locked" or the date it was unlocked. Nothing here depends on noticing that a row is greyer than
 * its neighbours.
 */
import { el } from '../dom.ts';
import { coinPill } from './meters.ts';
import { progressFraction, progressText } from '../../achievements/tracker.ts';
import { unlocksGame } from '../../achievements/ids.ts';
import type {
  AchievementDef,
  AchievementRecord,
  AchievementUnlock,
} from '../../achievements/types.ts';

/** What a locked hidden achievement is called. */
export const HIDDEN_TITLE = '???';

export function displayTitle(def: AchievementDef, record: AchievementRecord): string {
  return def.hidden && record.unlockedAt === null ? HIDDEN_TITLE : def.title;
}

export function displayDescription(def: AchievementDef, record: AchievementRecord): string {
  return def.hidden && record.unlockedAt === null
    ? 'Hidden — you will know it when you do it.'
    : def.description;
}

/** "Unlocked 5 Aug 2026", or "Locked". Said in words for the reason INV-11 exists. */
export function statusText(record: AchievementRecord): string {
  if (record.unlockedAt === null) return 'Locked';
  return `Unlocked ${new Date(record.unlockedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function rewardNode(doc: Document, def: AchievementDef): HTMLElement {
  const parts: HTMLElement[] = [];
  if ((def.reward.coins ?? 0) > 0) parts.push(coinPill(doc, { amount: def.reward.coins ?? 0 }));
  if (def.reward.pack !== undefined) {
    parts.push(
      el(doc, 'span', {
        class: 'achievement__pack',
        text: `${def.reward.pack[0]?.toUpperCase()}${def.reward.pack.slice(1)} pack`,
      }),
    );
  }
  return el(doc, 'div', { class: 'achievement__reward', children: parts });
}

/** A progress bar, for a multi-step achievement that has not finished. */
function progressNode(
  doc: Document,
  def: AchievementDef,
  record: AchievementRecord,
): HTMLElement | null {
  const text = progressText(def, record);
  if (text === '' || record.unlockedAt !== null) return null;

  const fraction = progressFraction(def, record);
  return el(doc, 'div', {
    class: 'achievement__progress',
    attrs: {
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': String(def.target),
      'aria-valuenow': String(Math.min(record.progress, def.target)),
      'aria-label': `${def.title} progress`,
    },
    children: [
      el(doc, 'div', {
        class: 'achievement__progress-track',
        children: [
          el(doc, 'div', {
            class: 'achievement__progress-fill',
            // Inline width because the value is data, not a design decision; every other
            // dimension in the row is a token.
            attrs: { style: `width: ${Math.round(fraction * 100)}%` },
          }),
        ],
      }),
      // The numbers as well as the bar: a bar alone is information by width, which is no better
      // than information by colour for anybody who cannot see it.
      el(doc, 'span', { class: 'achievement__progress-text', text }),
    ],
  });
}

export interface AchievementRowOptions {
  readonly def: AchievementDef;
  readonly record: AchievementRecord;
}

export function achievementRow(doc: Document, options: AchievementRowOptions): HTMLElement {
  const { def, record } = options;
  const unlocked = record.unlockedAt !== null;

  return el(doc, 'li', {
    class: 'achievement',
    dataset: { state: unlocked ? 'unlocked' : 'locked', category: def.category },
    children: [
      el(doc, 'div', {
        class: 'achievement__text',
        children: [
          el(doc, 'p', { class: 'achievement__title', text: displayTitle(def, record) }),
          el(doc, 'p', {
            class: 'achievement__description',
            text: displayDescription(def, record),
          }),
          el(doc, 'p', { class: 'achievement__status', text: statusText(record) }),
          progressNode(doc, def, record),
        ],
      }),
      rewardNode(doc, def),
    ],
  });
}

/**
 * The "you just unlocked these" block on a post-match screen (`06` §4).
 *
 * Announced politely rather than assertively: the player is reading a summary they navigated to,
 * not being interrupted, and an assertive live region would talk over the score.
 */
export function unlockedPanel(doc: Document, unlocked: readonly AchievementUnlock[]): HTMLElement {
  return el(doc, 'section', {
    class: 'achievement-unlocks',
    attrs: { 'aria-live': 'polite' },
    children: [
      el(doc, 'h3', {
        class: 'achievement-unlocks__heading',
        text: unlocked.length === 1 ? 'Achievement unlocked' : 'Achievements unlocked',
      }),
      el(doc, 'ul', {
        class: 'achievement-unlocks__list',
        children: unlocked.map(({ def, record }) => achievementRow(doc, { def, record })),
      }),
      ...unlockNotes(doc, unlocked),
    ],
  });
}

/**
 * The arcade unlock moment (T-8.8).
 *
 * `09` §3.2 asks that the notification say "unlocked — you can practise this any time now", and it
 * is right to insist: five of these achievements exist *to* open a game, and an unlock the player
 * has to infer from a tile that stopped being grey is not a moment. The sentence names the game and
 * links straight to it, so the reward is one tap away from the screen that announced it.
 */
function unlockNotes(doc: Document, unlocked: readonly AchievementUnlock[]): HTMLElement[] {
  const notes: HTMLElement[] = [];
  for (const { def } of unlocked) {
    const game = unlocksGame(def.id);
    if (game === undefined) continue;
    notes.push(
      el(doc, 'p', {
        class: 'achievement-unlocks__game',
        text: `${game} unlocked — you can practise this any time now.`,
      }),
    );
  }
  return notes;
}
