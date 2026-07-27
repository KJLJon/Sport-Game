/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold, T-0.2 — Base path derived from the repository name
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §2 (hosting, base path, PWA scoping), §10 (build and CI/CD)
 * @invariant INV-4 (no literal repository path in src/)
 *
 * Purpose: the single place the deployed base path is decided. Everything downstream reads it
 * through `import.meta.env.BASE_URL`, so renaming the repository needs no code change.
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolveBasePath } from './tools/base-path.ts';
import { buildHash } from './tools/build-hash.ts';
import { pwaAssets } from './tools/vite-plugin-pwa-assets.ts';

const base = resolveBasePath(process.env);
const hash = buildHash(process.env);

export default defineConfig({
  base,
  plugins: [pwaAssets({ base })],
  define: {
    __BUILD_HASH__: JSON.stringify(hash),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    reportCompressedSize: true,
  },
  server: {
    host: true,
  },
});
