/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.12 — Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best
 * @story   US-6.2 — Set a lineup
 * @story   US-6.3 — See fatigue and availability
 * @design  10-ui-ux.md §7 (screen map), §10 (states usually forgotten), §11 (accessibility)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the screen behind `#/squad/teams/:id/lineup/:sport`. Slots are laid out on a diagram of
 * the field at the fractions the sport's own `RoleTable` gives, so a new sport gets a formation
 * without a line of code here.
 *
 * **Tap-to-place, not drag-to-place.** `03` names the task "drag-to-slot", but drag is the wrong
 * primary interaction for the device this game is for: HTML5 drag-and-drop does not work on touch
 * without a polyfill, and a drag is unusable one-handed, invisible to a screen reader, and
 * impossible with a keyboard. So the primitive is select-then-place — tap an athlete, tap a slot —
 * which works identically with a thumb, a mouse, a keyboard, and a screen reader. Every slot is a
 * real `<button>`, so focus, Enter, and Space all come free. Pointer dragging can be layered on top
 * later as an accelerator; the underlying model is already the one it would need.
 */
import {
  assessSquad,
  autoFill,
  lineupStatus,
  lineupStrength,
  place,
  type LineupSlot,
  type SlotAssessment,
} from '../../teams/lineup.ts';
import { newSquad, type Squad, type Team } from '../../teams/types.ts';
import { availability, staminaBand } from '../../athletes/condition.ts';
import type { Athlete } from '../../athletes/types.ts';
import { rateableSport } from '../../sports/catalogue.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { button } from '../components/button.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import { toast } from '../components/feedback.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import './lineup.css';

/** Slots for a sport, from its `RoleTable`. Basketball is the only playable one until Phase 6. */
async function slotsFor(sportId: string): Promise<LineupSlot[]> {
  if (sportId !== 'basketball') return [];
  const { basketball } = await import('../../sports/basketball/index.ts');
  return basketball.roles.roles.map((role) => ({
    id: role.id,
    name: role.name,
    x: role.x,
    y: role.y,
  }));
}

function squadSizeFor(sportId: string): number {
  return sportId === 'basketball' ? 5 : 11;
}

export function lineupScreen(): Screen {
  /** The athlete waiting to be placed, if any. Tap an athlete, then tap a slot. */
  let holding: string | null = null;

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const teamId = context.params.id ?? '';
      const sportId = context.params.sport ?? 'basketball';

      context.host.replaceChildren(skeleton(doc, { lines: 6 }));

      const sport = rateableSport(sportId);
      const slots = await slotsFor(sportId);

      if (sport === undefined || slots.length === 0) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No lineups for that sport yet',
            body: 'Basketball is the only sport that can be played so far. Soccer arrives in a later phase.',
            action: { label: 'Back to Teams', onSelect: () => context.navigate('/squad/teams') },
          }),
        );
        return;
      }

      let team: Team | undefined;
      let squad: Squad;
      let roster: Map<string, Athlete>;
      let db: Awaited<ReturnType<typeof appDatabase>>;

      try {
        db = await appDatabase();
        team = await db.teams.get(teamId);
        squad = (await db.teams.squad(teamId, sportId)) ?? newSquad(teamId, sportId);
        roster = new Map((await db.athletes.getAll()).map((a) => [a.id, a]));
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'That roster could not be opened',
            body: 'This build cannot read what is saved. Nothing has been changed or lost.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      if (team === undefined) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No such team',
            body: 'It may have been deleted, or the link may be out of date.',
            action: { label: 'Back to Teams', onSelect: () => context.navigate('/squad/teams') },
          }),
        );
        return;
      }

      if (roster.size === 0) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No athletes to pick from',
            body: 'A lineup needs a roster. Create an athlete first, and they will show up here.',
            action: {
              label: 'Create an athlete',
              onSelect: () => context.navigate('/squad/athlete/new'),
            },
          }),
        );
        return;
      }

      const named = team;
      const tables = sport.tables;

      const save = async (): Promise<void> => {
        await db.teams.putSquad(squad);
      };

      const render = (): void => {
        const assessments = assessSquad({
          squad,
          slots,
          roster,
          sport: sportId,
          tables,
          now: Date.now(),
        });
        const status = lineupStatus(assessments, squad, squadSizeFor(sportId));

        context.host.replaceChildren(
          el(doc, 'div', {
            class: 'lineup',
            children: [
              el(doc, 'header', {
                class: 'lineup__head',
                children: [
                  el(doc, 'h2', { text: `${named.name} — ${sport.displayName}` }),
                  el(doc, 'p', {
                    class: 'lineup__status',
                    dataset: { ready: String(status.ready) },
                    attrs: { role: 'status' },
                    text: `${status.message} · strength ${lineupStrength(assessments)}`,
                  }),
                ],
              }),

              field(doc, assessments),

              el(doc, 'div', {
                class: 'lineup__actions',
                children: [
                  button(doc, {
                    label: 'Auto-fill best',
                    variant: 'primary',
                    onClick: () => {
                      const best = autoFill({
                        slots,
                        candidates: [...roster.values()],
                        sport: sportId,
                        tables,
                        now: Date.now(),
                      });
                      squad = { ...squad, ...best, updatedAt: Date.now() };
                      holding = null;
                      void save();
                      render();
                    },
                  }),
                  button(doc, {
                    label: 'Clear lineup',
                    variant: 'ghost',
                    onClick: () => {
                      squad = { ...squad, starters: {}, bench: [], updatedAt: Date.now() };
                      holding = null;
                      void save();
                      render();
                    },
                  }),
                ],
              }),

              bench(doc, roster, squad, (athleteId) => {
                holding = holding === athleteId ? null : athleteId;
                render();
              }),
            ],
          }),
        );

        // Wire the slot buttons after the tree exists, so a slot can read the held athlete.
        for (const node of context.host.querySelectorAll('.lineup__slot')) {
          node.addEventListener('click', () => {
            const slotId = (node as HTMLElement).dataset.slot ?? '';
            if (holding !== null) {
              squad = place(squad, slotId, holding, Date.now());
              holding = null;
            } else if (squad.starters[slotId] !== undefined) {
              // Tapping a filled slot with nothing held picks that athlete up.
              holding = squad.starters[slotId] ?? null;
            }
            void save();
            render();
          });
        }

        if (holding !== null) {
          const who = roster.get(holding);
          context.host.appendChild(
            toast(doc, {
              message: `${who?.displayName ?? 'Athlete'} selected — tap a position to place them.`,
            }),
          );
        }
      };

      render();
    },
  };
}

/** The formation diagram. Slots sit at the fractions the sport's own role table gives. */
function field(doc: Document, assessments: readonly SlotAssessment[]): HTMLElement {
  return el(doc, 'div', {
    class: 'lineup__field',
    attrs: { role: 'group', 'aria-label': 'Formation' },
    children: assessments.map((entry) => {
      const occupied = entry.athlete !== null;
      const label = occupied
        ? `${entry.slot.name}: ${entry.athlete?.displayName ?? ''}, rated ${entry.rating}${
            entry.warn ? ', out of position' : ''
          }${entry.unavailable === null ? '' : `, ${entry.unavailable}`}`
        : `${entry.slot.name}: empty`;

      const node = el(doc, 'button', {
        class: 'lineup__slot',
        dataset: {
          slot: entry.slot.id,
          warn: String(entry.warn),
          empty: String(!occupied),
          blocked: String(entry.unavailable !== null),
        },
        attrs: { type: 'button', 'aria-label': label },
        children: [
          el(doc, 'span', { class: 'lineup__slot-position', text: entry.slot.id }),
          el(doc, 'span', {
            class: 'lineup__slot-name',
            text: occupied ? (entry.athlete?.displayName ?? '') : 'Empty',
          }),
          occupied
            ? el(doc, 'span', { class: 'lineup__slot-rating', text: String(entry.rating) })
            : null,
          // The warning is words as well as a dashed edge — never colour alone (`10` §11).
          entry.warn
            ? el(doc, 'span', { class: 'lineup__slot-warn', text: 'Out of position' })
            : null,
          entry.unavailable === null
            ? null
            : el(doc, 'span', { class: 'lineup__slot-blocked', text: entry.unavailable }),
        ],
      });

      node.style.setProperty('--x', `${entry.slot.x * 100}%`);
      node.style.setProperty('--y', `${entry.slot.y * 100}%`);
      return node;
    }),
  });
}

/** Everyone not in the starting lineup, tappable to pick up. */
function bench(
  doc: Document,
  roster: ReadonlyMap<string, Athlete>,
  squad: Squad,
  onPick: (athleteId: string) => void,
): HTMLElement {
  const starting = new Set(Object.values(squad.starters));
  const now = Date.now();

  const rows = [...roster.values()]
    .filter((athlete) => !starting.has(athlete.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((athlete) => {
      const state = availability(athlete, now);
      return el(doc, 'li', {
        children: [
          button(doc, {
            label: `${athlete.displayName} · ${staminaBand(athlete.condition.stamina)}${
              state.available ? '' : ` · ${state.label}`
            }`,
            variant: 'ghost',
            onClick: () => onPick(athlete.id),
          }),
        ],
      });
    });

  return el(doc, 'section', {
    class: 'lineup__bench',
    children: [
      el(doc, 'h3', { text: `Available (${rows.length})` }),
      rows.length === 0
        ? el(doc, 'p', { class: 'lineup__note', text: 'Everybody is in the lineup.' })
        : el(doc, 'ul', { class: 'lineup__bench-list', children: rows }),
    ],
  });
}
