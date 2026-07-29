/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (each component ships with a states matrix), 12-quality-and-testing.md §1
 *
 * Purpose: `#/dev/ui` — every primitive in every state, on one page. `10` §5 makes this the
 * visual-regression target, so it must render deterministically: no random data, no clocks, no
 * animation that a screenshot could catch mid-flight.
 */
import './gallery.css';
import { el } from '../dom.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { button } from '../components/button.ts';
import { segmented, switchControl } from '../components/controls.ts';
import {
  coinPill,
  familiarityRing,
  progressBar,
  ratingBar,
  starRating,
} from '../components/meters.ts';
import { banner, sheet, toast } from '../components/feedback.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import { callSheet } from '../components/play-call.ts';

const ICON_PLAY = 'M8 5v14l11-7z';

function section(doc: Document, title: string, items: readonly [string, Node][]): HTMLElement {
  return el(doc, 'section', {
    class: 'gallery__section',
    children: [
      el(doc, 'h2', { class: 'gallery__heading', text: title }),
      el(doc, 'div', {
        class: 'gallery__grid',
        children: items.map(([label, node]) =>
          el(doc, 'figure', {
            class: 'gallery__item',
            children: [
              el(doc, 'div', { class: 'gallery__stage', children: [node] }),
              el(doc, 'figcaption', { class: 'gallery__caption', text: label }),
            ],
          }),
        ),
      }),
    ],
  });
}

export function galleryScreen(): Screen {
  return {
    mount({ host }: ScreenContext): void {
      const doc = host.ownerDocument;
      const noop = () => {};

      const buttons = section(doc, 'Buttons', [
        ['primary', button(doc, { label: 'Play', variant: 'primary' })],
        ['primary · large', button(doc, { label: 'Play', variant: 'primary', size: 'large' })],
        ['primary · icon', button(doc, { label: 'Play', variant: 'primary', icon: ICON_PLAY })],
        ['secondary', button(doc, { label: 'Cancel', variant: 'secondary' })],
        ['ghost', button(doc, { label: 'Later', variant: 'ghost' })],
        ['destructive', button(doc, { label: 'Erase data', variant: 'destructive' })],
        ['icon only', button(doc, { label: 'Play', variant: 'icon', icon: ICON_PLAY })],
        ['disabled', button(doc, { label: 'Play', disabled: true })],
        ['loading', button(doc, { label: 'Saving', loading: true })],
        ['link', button(doc, { label: 'Settings', variant: 'secondary', href: '#/settings' })],
      ]);

      const controls = section(doc, 'Controls', [
        [
          'segmented',
          segmented(doc, {
            legend: 'Difficulty',
            name: 'gallery-difficulty',
            value: 'pro',
            options: [
              { value: 'rookie', label: 'Rookie' },
              { value: 'pro', label: 'Pro' },
              { value: 'all-star', label: 'All-Star' },
              { value: 'legend', label: 'Legend', disabled: true },
            ],
          }),
        ],
        [
          'switch · on',
          switchControl(doc, {
            label: 'Auto-update',
            description: 'Applies updates when you are not mid-match.',
            checked: true,
            onChange: noop,
          }),
        ],
        ['switch · off', switchControl(doc, { label: 'Haptics', checked: false })],
        [
          'switch · disabled',
          switchControl(doc, { label: 'Vibration', checked: false, disabled: true }),
        ],
      ]);

      const meters = section(doc, 'Meters', [
        ['rating · strong', ratingBar(doc, { label: 'Shooting', value: 84, tone: 'strong' })],
        ['rating · neutral', ratingBar(doc, { label: 'Passing', value: 61 })],
        ['rating · weak', ratingBar(doc, { label: 'Handling', value: 32, tone: 'weak' })],
        ['progress', progressBar(doc, { label: 'Downloading game files', value: 0.82 })],
        [
          'progress · labelled',
          progressBar(doc, { label: 'Level 4', value: 0.34, valueText: '820 / 2,400 XP' }),
        ],
        ['progress · indeterminate', progressBar(doc, { label: 'Checking for updates' })],
        ['familiarity · natural', familiarityRing(doc, { value: 0.92, sport: 'Basketball' })],
        ['familiarity · novice', familiarityRing(doc, { value: 0.08, sport: 'Soccer' })],
        ['stars', starRating(doc, { value: 2 })],
        ['coins', coinPill(doc, { amount: 1250 })],
        ['coins · reward', coinPill(doc, { amount: 250, signed: true })],
        ['coins · cost', coinPill(doc, { amount: -400, signed: true })],
      ]);

      const feedback = section(doc, 'Feedback', [
        [
          'banner · update ready',
          banner(doc, {
            message: 'Update ready.',
            tone: 'success',
            actions: [
              { label: 'Update now', variant: 'primary', onSelect: noop },
              { label: 'Later', onSelect: noop },
            ],
          }),
        ],
        [
          'banner · offline',
          banner(doc, {
            message: 'Some game files are missing. They will be restored next time you are online.',
            tone: 'warning',
            actions: [{ label: 'Details', onSelect: noop }],
          }),
        ],
        ['toast', toast(doc, { message: 'Athlete saved.', tone: 'success' })],
        [
          'toast · action',
          toast(doc, {
            message: 'Athlete sold.',
            action: { label: 'Undo', onSelect: noop },
          }),
        ],
        [
          'sheet',
          sheet(doc, {
            title: 'Pick a sport',
            children: [el(doc, 'p', { text: 'Basketball or Soccer, to start.' })],
            onClose: noop,
          }),
        ],
      ]);

      const states = section(doc, 'States', [
        [
          'empty',
          emptyState(doc, {
            heading: 'No athletes yet',
            body: 'Create one and they will be playable in every sport.',
            action: { label: 'Create an athlete', href: '#/squad' },
          }),
        ],
        [
          'error',
          errorState(doc, {
            heading: "That backup didn't load",
            body: 'It was made by a newer version of the game. Update first, then try again.',
            action: { label: 'Check for update', onSelect: noop },
            detail: 'schemaVersion 9 > supported 7',
          }),
        ],
        ['skeleton', skeleton(doc, { lines: 3 })],
      ]);

      // `10` §5's inventory names the play-call card; the gallery is where it is looked at.
      const playbook = section(doc, 'Playbook', [
        [
          'call sheet',
          callSheet(doc, {
            calls: [
              {
                id: 'isolation',
                name: 'Isolation',
                side: 'offence',
                blurb: 'Best when you have a star mismatch.',
                keys: ['ballHandling', 'finishing'],
                targeted: true,
              },
              {
                id: 'motion',
                name: 'Motion',
                side: 'offence',
                blurb: 'Best with a balanced roster and no star.',
                keys: ['passing', 'awareness'],
              },
              {
                id: 'spot-up',
                name: 'Spot-Up / Three-Set',
                side: 'offence',
                blurb: 'Best with shooters, against a packed paint.',
                keys: ['threePoint', 'awareness'],
                targeted: true,
              },
            ],
            squad: [],
            opponentLastCall: '2-3 Zone',
            onChoose: noop,
          }).element,
        ],
      ]);

      host.replaceChildren(
        el(doc, 'div', {
          class: 'gallery',
          children: [
            el(doc, 'p', {
              class: 'gallery__note',
              text: 'Dev-only. This route is the visual-regression target for every primitive.',
            }),
            buttons,
            controls,
            meters,
            feedback,
            states,
            playbook,
          ],
        }),
      );
    },
  };
}
