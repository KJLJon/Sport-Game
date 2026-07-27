/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.5 — Web app manifest with base-path id/scope/start_url
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §2 (manifest), 10-ui-ux.md §3.1 (palette), §4 (layout)
 * @invariant INV-4 (no literal repository path)
 *
 * Purpose: builds the web app manifest from the resolved base path. Because `id` is the base
 * path, the installed app is a distinct app from any other PWA published on the same
 * `github.io` account — which is the whole point of `04` §2.
 */
import { ICON_SIZES, MASKABLE_SIZES } from './icons.ts';

export interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

export interface WebAppManifest {
  readonly id: string;
  readonly scope: string;
  readonly start_url: string;
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly display: string;
  readonly display_override: readonly string[];
  readonly orientation: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly categories: readonly string[];
  readonly icons: readonly ManifestIcon[];
  readonly shortcuts: readonly {
    name: string;
    short_name: string;
    url: string;
    description: string;
  }[];
}

export const MANIFEST_FILE_NAME = 'manifest.webmanifest';

/**
 * @param base The resolved base path, with leading and trailing slashes.
 */
export function buildManifest(base: string): WebAppManifest {
  const icons: ManifestIcon[] = [
    ...ICON_SIZES.map((size) => ({
      src: `${base}icons/icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any',
    })),
    ...MASKABLE_SIZES.map((size) => ({
      src: `${base}icons/maskable-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'maskable',
    })),
  ];

  return {
    // Identity is the path, so this install is distinct from any sibling PWA on the account.
    id: base,
    scope: base,
    start_url: base,
    name: 'Sport-Game',
    short_name: 'Sport-Game',
    description:
      'Build athletes once and play them across every sport. Installs, then works offline.',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    // `04` §2 — matches request a landscape lock themselves rather than forcing it app-wide.
    orientation: 'any',
    background_color: '#0B0F14',
    theme_color: '#0B0F14',
    categories: ['games', 'sports'],
    icons,
    shortcuts: [
      {
        name: 'Quick Play',
        short_name: 'Play',
        url: `${base}#/play`,
        description: 'Jump into a match with your last setup.',
      },
      {
        name: 'Squad',
        short_name: 'Squad',
        url: `${base}#/squad`,
        description: 'Your athletes, teams, and lineups.',
      },
    ],
  };
}

/** Serialised form. Pretty-printed: it is small, and a readable manifest is easier to debug. */
export function serialiseManifest(base: string): string {
  return `${JSON.stringify(buildManifest(base), null, 2)}\n`;
}
