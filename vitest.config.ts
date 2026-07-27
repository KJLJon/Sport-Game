/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold
 * @design  12-quality-and-testing.md §1 (test pyramid), §2 (coverage requirements)
 *
 * Purpose: unit, determinism, property, and integration test configuration, including the
 * per-area coverage thresholds from `12` §2. Thresholds may not be lowered to pass a build.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Tests run under a base path that is deliberately *not* this repository's name. Anything that
  // hardcodes the real one fails here rather than in production (INV-4).
  base: '/test-scope/',
  define: {
    __BUILD_HASH__: JSON.stringify('test'),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Node by default: most of this codebase is pure logic. DOM-dependent suites opt in with a
    // `@vitest-environment jsdom` docblock directive.
    environment: 'node',
    include: ['tests/{unit,sim,invariants,integration}/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/main.ts', 'src/pwa/sw.ts', 'src/ui/gallery/**'],
      // `12` §2 — enforced in CI; never lowered to make a build pass.
      thresholds: {
        'src/athletes/**': { lines: 95, functions: 95, branches: 85, statements: 95 },
        'src/economy/**': { lines: 95, functions: 95, branches: 85, statements: 95 },
        'src/achievements/**': { lines: 95, functions: 95, branches: 85, statements: 95 },
        'src/storage/**': { lines: 95, functions: 95, branches: 85, statements: 95 },
        'src/engine/**': { lines: 80, functions: 80, branches: 70, statements: 80 },
        'src/p2p/**': { lines: 85, functions: 85, branches: 75, statements: 85 },
        'src/ui/**': { lines: 70, functions: 70, branches: 60, statements: 70 },
      },
    },
  },
});
