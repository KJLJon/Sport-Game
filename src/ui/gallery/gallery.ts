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
import { attributeRadar } from '../components/radar.ts';
import { statTable } from '../components/table.ts';
import { tabBar } from '../components/tab-bar.ts';
import { athleteRow } from '../components/athlete-row.ts';
import { coachMark } from '../components/coach-mark.ts';
import { dialog } from '../components/feedback.ts';
import {
  ATTRIBUTE_IDS,
  STARTING_FAMILIARITY,
  newSportSkill,
  type Athlete,
  type Attributes,
} from '../../athletes/types.ts';

const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_HOME = 'M12 3l9 8h-3v10h-5v-6H11v6H6V11H3z';
const ICON_SQUAD = 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9a8 8 0 0116 0z';
const ICON_STORE = 'M4 7h16l-1 13H5zM9 7a3 3 0 016 0';

const GALLERY_TABS = [
  { path: '/', label: 'Home', icon: ICON_HOME },
  { path: '/squad', label: 'Squad', icon: ICON_SQUAD },
  { path: '/store', label: 'Store', icon: ICON_STORE },
] as const;

/**
 * Fixed attribute sets for the radar. Hand-written rather than generated, because the gallery is
 * the visual-regression target: a shape that changes between runs is a snapshot that always fails.
 */
function radarSample(values: readonly number[]): Attributes {
  return Object.fromEntries(
    ATTRIBUTE_IDS.map((id, index) => [id, values[index % values.length] ?? 50]),
  ) as Attributes;
}

/**
 * One fixed athlete for the row. Written out here rather than read from storage for the same
 * reason as the radar's numbers: the gallery is a snapshot target, and a snapshot of whatever
 * happens to be in the database is a snapshot of nothing.
 */
function galleryAthlete(overrides: Partial<Athlete> = {}): Athlete {
  return {
    id: 'gallery-1',
    schemaVersion: 1,
    displayName: 'Ada Kovač',
    heightCm: 188,
    weightKg: 82,
    handedness: 'right',
    age: 24,
    primarySport: 'basketball',
    attributes: radarSample([88, 81, 74, 46, 69, 77, 62]),
    sportSkills: { basketball: newSportSkill(STARTING_FAMILIARITY.primary) },
    rarity: 'rare',
    traits: [],
    condition: { stamina: 100 },
    source: 'created',
    sandbox: false,
    custodyId: 'gallery-custody-1',
    createdAt: 0,
    editable: true,
    ...overrides,
  };
}

const DIALOG_SAMPLE = {
  title: 'Sell Ada Kovač?',
  body: 'She is in your starting five. Selling her leaves the slot empty.',
  actions: [
    { label: 'Sell for 900', variant: 'destructive' as const },
    { label: 'Keep her', variant: 'secondary' as const },
  ],
};

/**
 * Shows a `<dialog>` in the flow of the page rather than over it. `showModal()` would put one
 * example on top of every other, and the gallery's job is to show them side by side.
 */
function openDialog(node: HTMLDialogElement): HTMLDialogElement {
  node.open = true;
  return node;
}

/** Pins a transient state on for the matrix. See the `data-force` note in `components.css`. */
function forced(node: HTMLElement, state: 'pressed' | 'focus'): HTMLElement {
  node.dataset.force = state;
  return node;
}

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

      // `10` §5 asks each component for default/pressed/disabled/loading/error/focus. Two of those
      // are transient and a screenshot cannot produce them, so `forced()` sets the same
      // declarations through an attribute (see the `data-force` note in `components.css`).
      const buttonStates = section(doc, 'Buttons · states', [
        ['default', button(doc, { label: 'Play', variant: 'primary' })],
        ['pressed', forced(button(doc, { label: 'Play', variant: 'primary' }), 'pressed')],
        ['focus', forced(button(doc, { label: 'Play', variant: 'primary' }), 'focus')],
        ['disabled', button(doc, { label: 'Play', variant: 'primary', disabled: true })],
        ['loading', button(doc, { label: 'Play', variant: 'primary', loading: true })],
        ['error · destructive', button(doc, { label: 'Delete athlete', variant: 'destructive' })],
        [
          'secondary · pressed',
          forced(button(doc, { label: 'Cancel', variant: 'secondary' }), 'pressed'),
        ],
        [
          'secondary · focus',
          forced(button(doc, { label: 'Cancel', variant: 'secondary' }), 'focus'),
        ],
        ['ghost · disabled', button(doc, { label: 'Later', variant: 'ghost', disabled: true })],
        [
          'icon · focus',
          forced(button(doc, { label: 'Play', variant: 'icon', icon: ICON_PLAY }), 'focus'),
        ],
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
          'sheet · half',
          sheet(doc, {
            title: 'Pick a sport',
            children: [el(doc, 'p', { text: 'Basketball or Soccer, to start.' })],
            onClose: noop,
          }),
        ],
        [
          'sheet · full',
          sheet(doc, {
            title: 'Choose a play',
            height: 'full',
            children: [el(doc, 'p', { text: 'Every call your squad knows.' })],
            onClose: noop,
          }),
        ],
        // `10` §5's inventory names the dialog, and the gallery had never shown one. Rendered
        // inline rather than modally: `showModal()` in a page of examples would cover the rest.
        ['dialog', openDialog(dialog(doc, DIALOG_SAMPLE))],
        [
          'dialog · forced',
          openDialog(
            dialog(doc, {
              title: 'Update required',
              body: 'This version can no longer play online. Update to carry on.',
              actions: [{ label: 'Update now', variant: 'primary' }],
              dismissible: false,
            }),
          ),
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

      // The data primitives (T-9.1). Both carry numbers, so both are shown holding real ones.
      const data = section(doc, 'Data', [
        [
          'attribute radar',
          attributeRadar(doc, {
            series: [{ label: 'Ada K.', attributes: radarSample([88, 81, 74, 46, 69, 77, 62]) }],
          }),
        ],
        [
          'attribute radar · compare',
          attributeRadar(doc, {
            series: [
              { label: 'Ada K.', attributes: radarSample([88, 81, 74, 46, 69, 77, 62]) },
              { label: 'Bo R.', attributes: radarSample([54, 61, 58, 91, 44, 66, 83]) },
            ],
            hideValues: true,
          }),
        ],
        [
          'stat table',
          statTable(doc, {
            caption: 'Home — 88',
            rowHeaderLabel: 'Athlete',
            columns: [
              { key: 'points', label: 'PTS', description: 'Points' },
              { key: 'shooting', label: 'FG', description: 'Field goals made of attempted' },
              { key: 'rebounds', label: 'REB', description: 'Rebounds' },
              { key: 'assists', label: 'AST', description: 'Assists' },
            ],
            rows: [
              {
                header: 'Ada K.',
                values: { points: 24, shooting: '9-17', rebounds: 7, assists: 5 },
                emphasis: true,
              },
              {
                header: 'Bo R.',
                values: { points: 18, shooting: '7-13', rebounds: 3, assists: 9 },
              },
              { header: 'Cy M.', values: { points: 4, shooting: '2-6', rebounds: 11 } },
            ],
            totals: {
              header: 'Team',
              values: { points: 88, shooting: '34-71', rebounds: 41, assists: 22 },
            },
          }),
        ],
        [
          'stat table · empty',
          statTable(doc, {
            caption: 'Career — Soccer',
            rowHeaderLabel: 'Season',
            columns: [
              { key: 'apps', label: 'APP', description: 'Appearances' },
              { key: 'goals', label: 'G', description: 'Goals' },
            ],
            rows: [],
            emptyText: 'No matches played in this sport yet.',
          }),
        ],
      ]);

      // Navigation (T-9.1). Three states, because the current tab is the whole point of the bar.
      const navigation = section(doc, 'Navigation', [
        ['tab bar · home', tabBar(doc, { tabs: GALLERY_TABS, currentPath: '/' })],
        [
          'tab bar · deep path marks its parent',
          tabBar(doc, { tabs: GALLERY_TABS, currentPath: '/squad/athlete/7' }),
        ],
        [
          'tab bar · off-tab route',
          tabBar(doc, { tabs: GALLERY_TABS, currentPath: '/settings/display' }),
        ],
      ]);

      // The athlete list row (T-9.1), through its states matrix.
      const athletes = section(doc, 'Athletes', [
        [
          'row',
          athleteRow(doc, {
            athlete: galleryAthlete(),
            as: 'div',
            meta: 'Basketball · rare',
            position: 'PG',
            overall: 78,
            href: '#/squad',
          }),
        ],
        [
          'row · selected',
          athleteRow(doc, {
            athlete: galleryAthlete({ displayName: 'Bo Ramirez', rarity: 'legendary' }),
            as: 'div',
            meta: 'Soccer · legendary',
            position: 'ST',
            overall: 91,
            selected: true,
          }),
        ],
        [
          'row · blocked',
          athleteRow(doc, {
            athlete: galleryAthlete({ displayName: 'Cy Mensah', rarity: 'common' }),
            as: 'div',
            meta: 'Basketball · common',
            overall: 54,
            disabled: true,
            warning: 'In your starting five.',
          }),
        ],
        [
          'row · with actions',
          athleteRow(doc, {
            athlete: galleryAthlete({ displayName: 'Dee Ito', rarity: 'epic' }),
            as: 'div',
            meta: 'Basketball · epic · worth 1,800',
            trailing: [
              coinPill(doc, { amount: 900 }),
              button(doc, { label: 'Sell', variant: 'secondary' }),
            ],
          }),
        ],
        ['row · bare', athleteRow(doc, { athlete: galleryAthlete(), as: 'div' })],
      ]);

      // Onboarding (T-9.1). T-9.3 builds the first-launch flow on this.
      const onboarding = section(doc, 'Onboarding', [
        [
          'coach-mark',
          coachMark(doc, { body: 'Tap here to start a match with your last setup.' }).element,
        ],
        [
          'coach-mark · step, above',
          coachMark(doc, {
            title: 'Your squad',
            body: 'Everyone you own lives here, in every sport they can play.',
            placement: 'above',
            step: { index: 2, total: 4 },
            dismissLabel: 'Next',
          }).element,
        ],
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
            buttonStates,
            controls,
            meters,
            feedback,
            states,
            data,
            navigation,
            athletes,
            onboarding,
            playbook,
          ],
        }),
      );
    },
  };
}
