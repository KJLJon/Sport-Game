/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  10-ui-ux.md §6 (the athlete card), §7 (screen map), §10 (states usually forgotten)
 *
 * Purpose: the screen behind `#/squad/athlete/:id`. It owns three things the card deliberately
 * does not: loading the athlete, holding which sport is selected, and the states `10` §10 says are
 * usually forgotten — loading, not-found, and a database this build cannot read.
 *
 * The card is re-rendered rather than mutated when the sport changes. `10` §6 asks for an animated
 * transition there; that lands with the motion pass in Phase 9, and a rebuild is the honest
 * intermediate — it is correct, it is cheap at this size, and it does not bake in a structure that
 * an animation would then have to fight.
 */
import { athleteCardFull } from '../components/athlete-card.ts';
import { errorState, emptyState, skeleton } from '../components/states.ts';
import { RATEABLE_SPORTS, sportsForAthlete } from '../../sports/catalogue.ts';
import { appDatabase } from '../../storage/app-db.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import '../components/athlete-card.css';
import './athlete.css';

export function athleteScreen(): Screen {
  let selectedSport: string | null = null;

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const id = context.params.id ?? '';

      context.host.replaceChildren(skeleton(doc, { lines: 6 }));

      let athlete: Athlete | undefined;
      try {
        athlete = await (await appDatabase()).athletes.get(id);
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

      if (athlete === undefined) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No such athlete',
            body: 'They may have been deleted, or the link may be out of date.',
            action: { label: 'Back to your squad', onSelect: () => context.navigate('/squad') },
          }),
        );
        return;
      }

      const found = athlete;
      const sports = sportsForAthlete(found.primarySport);
      // An athlete whose primary sport this build has no weights for still gets a card: they are
      // rated in everything the catalogue knows, and the switcher simply does not offer their own.
      const available = sports.length === 0 ? RATEABLE_SPORTS : sports;

      const render = (): void => {
        context.host.replaceChildren(
          el(doc, 'div', {
            class: 'athlete-screen',
            children: [
              el(doc, 'a', {
                class: 'athlete-screen__compare',
                attrs: { href: `#/squad/athlete/${found.id}/compare` },
                text: 'Compare across every sport',
              }),
              athleteCardFull(doc, {
                athlete: found,
                sports: available,
                ...(selectedSport === null ? {} : { sportId: selectedSport }),
                onSportChange: (sportId: string) => {
                  selectedSport = sportId;
                  render();
                },
              }),
            ],
          }),
        );
      };

      render();
    },
  };
}
