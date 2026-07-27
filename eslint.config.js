/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold, T-0.2 — Ban literal base paths
 * @design  04-architecture.md §3, 12-quality-and-testing.md §3
 * @invariant INV-2, INV-3, INV-4
 *
 * Purpose: the lint layer that enforces the non-negotiable constraints in CLAUDE.md §8 —
 * literal repository paths, `Math.random` in the simulation, and raw storage access.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** INV-4 — no literal repository path anywhere in src/. */
const LITERAL_BASE_PATH = String.raw`/Sport-Game/`;

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // ── INV-4: no literal repository path in src/ ──────────────────────────────
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${LITERAL_BASE_PATH.replace(/\//g, '\\/')}/]`,
          message:
            'INV-4: no literal repository path. Derive the base path from import.meta.env.BASE_URL.',
        },
        {
          selector: `TemplateElement[value.raw=/${LITERAL_BASE_PATH.replace(/\//g, '\\/')}/]`,
          message:
            'INV-4: no literal repository path. Derive the base path from import.meta.env.BASE_URL.',
        },
      ],
    },
  },

  // ── INV-3: raw storage access only inside src/storage/ ─────────────────────
  {
    files: ['src/**/*.ts'],
    ignores: ['src/storage/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message: 'INV-3: go through src/storage/ so the base-path namespace is applied.',
        },
        {
          name: 'localStorage',
          message: 'INV-3: go through src/storage/ so the base-path namespace is applied.',
        },
        {
          name: 'sessionStorage',
          message: 'INV-3: go through src/storage/ so the base-path namespace is applied.',
        },
        {
          name: 'caches',
          message: 'INV-3: go through src/storage/ so the base-path namespace is applied.',
        },
      ],
    },
  },

  // ── INV-2: no Math.random reachable from the simulation ────────────────────
  {
    files: ['src/engine/**/*.ts', 'src/sports/**/*.ts', 'src/modes/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'INV-2: the simulation is deterministic. Use the seeded PRNG from engine/rng.ts.',
        },
      ],
    },
  },

  // ── Node-side tooling ──────────────────────────────────────────────────────
  {
    files: ['tools/**/*.ts', '*.config.ts', '*.config.js', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // ── Service worker context ─────────────────────────────────────────────────
  {
    files: ['src/pwa/sw.ts', 'src/pwa/sw/**/*.ts'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
);
