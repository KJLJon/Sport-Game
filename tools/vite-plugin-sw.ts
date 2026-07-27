/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.6 — Service worker: per-class cache strategies, atomic precache, versioned caches
 * @story   US-1.2 — Play offline, US-1.6 — Reliable updates
 * @design  04-architecture.md §10 (build and CI/CD), 11-pwa-lifecycle.md §5.1
 *
 * Purpose: builds `sw.js` after the main bundle, injecting the precache manifest generated from
 * the emitted asset list. The worker is emitted unhashed at the base root — its URL must be
 * stable for the browser to re-check it, and its directory is what scopes it (`04` §2).
 */
import { build, type Plugin, type Rollup } from 'vite';
import { fileURLToPath } from 'node:url';

export interface ServiceWorkerOptions {
  readonly base: string;
  readonly buildHash: string;
}

/** Assets excluded from the precache: sourcemaps, and the three network-first resources. */
const EXCLUDED = [/\.map$/, /^sw\.js$/, /^version\.json$/, /^manifest\.webmanifest$/];

/** Builds the precache URL list from an emitted bundle. Exported for testing. */
export function precacheUrls(fileNames: readonly string[], base: string): string[] {
  const urls = fileNames
    .filter((name) => !EXCLUDED.some((pattern) => pattern.test(name)))
    .map((name) => `${base}${name}`);

  // The document itself, addressed as the base path — the same key the worker's shell uses.
  return [...new Set([base, ...urls])].sort();
}

export function serviceWorker(options: ServiceWorkerOptions): Plugin {
  const { base, buildHash } = options;
  let outDir = 'dist';

  return {
    name: 'sport-game:service-worker',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      outDir = config.build.outDir;
    },

    // `writeBundle` runs after the main output exists, so the manifest reflects what shipped.
    async writeBundle(_outputOptions, bundle: Rollup.OutputBundle) {
      const urls = precacheUrls(Object.keys(bundle), base);

      await build({
        configFile: false,
        // Not `base`: this inner build emits one file and must not re-run our plugins.
        logLevel: 'warn',
        define: {
          __PRECACHE_MANIFEST__: JSON.stringify(urls),
          __BASE_PATH__: JSON.stringify(base),
          __BUILD_HASH__: JSON.stringify(buildHash),
          'import.meta.env.BASE_URL': JSON.stringify(base),
        },
        build: {
          outDir,
          emptyOutDir: false,
          target: 'es2022',
          minify: true,
          sourcemap: false,
          rollupOptions: {
            input: fileURLToPath(new URL('../src/pwa/sw.ts', import.meta.url)),
            output: {
              // IIFE, not ESM: module workers still need a registration option Safari only
              // gained recently, and this file has no reason to be a module.
              format: 'iife',
              entryFileNames: 'sw.js',
              // Nothing else may be emitted here, or it would overwrite the main build.
              inlineDynamicImports: true,
            },
          },
        },
      });
    },
  };
}
