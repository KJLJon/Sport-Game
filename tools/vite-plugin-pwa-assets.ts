/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.5 — Web app manifest and full icon set including maskable
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §2, §10 (build and CI/CD)
 * @invariant INV-4
 *
 * Purpose: emits the manifest, the icon set, and the `404.html` SPA fallback, all derived from
 * the resolved base path. Serving the same bytes in dev as in the build is what keeps base-path
 * and install bugs from only appearing after a deploy.
 */
import type { Plugin } from 'vite';
import { generateIcons } from './icons.ts';
import { MANIFEST_FILE_NAME, serialiseManifest } from './manifest.ts';

export interface PwaAssetsOptions {
  /** The resolved base path, with leading and trailing slashes. */
  readonly base: string;
}

export function pwaAssets(options: PwaAssetsOptions): Plugin {
  const { base } = options;
  const icons = generateIcons();

  /** Path a request should match, e.g. `/Sport-Game/icons/icon-192.png` → `icons/icon-192.png`. */
  const strip = (url: string): string => {
    const path = url.split('?')[0] ?? '';
    return path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '');
  };

  return {
    name: 'sport-game:pwa-assets',

    // Dev serves exactly what the build emits, so `#/` install testing works from `pnpm dev`.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requested = strip(req.url ?? '');

        if (requested === MANIFEST_FILE_NAME) {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(serialiseManifest(base));
          return;
        }

        const icon = icons.find((candidate) => candidate.fileName === requested);
        if (icon) {
          res.setHeader('Content-Type', 'image/png');
          res.end(icon.source);
          return;
        }

        next();
      });
    },

    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE_NAME,
        source: serialiseManifest(base),
      });

      for (const icon of icons) {
        this.emitFile({ type: 'asset', fileName: icon.fileName, source: icon.source });
      }
    },

    // `04` §2 — Pages has no rewrite rules, so a copy of index.html answers deep links as 404.
    async writeBundle(outputOptions, bundle) {
      const html = bundle['index.html'];
      if (html === undefined || html.type !== 'asset') return;

      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const dir = outputOptions.dir ?? 'dist';
      await writeFile(join(dir, '404.html'), html.source);
    },
  };
}
