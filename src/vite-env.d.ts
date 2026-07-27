/// <reference types="vite/client" />

/**
 * Build identifier injected by Vite's `define`. Every cache name carries it, so activation can
 * delete exactly the caches belonging to previous builds of this app (`04` §3).
 */
declare const __BUILD_HASH__: string;

/**
 * Semantic version from `package.json`, injected by Vite's `define`. Compared against
 * `minSupportedVersion` from `version.json` to decide whether an update is forced (`11` §4).
 */
declare const __APP_VERSION__: string;
