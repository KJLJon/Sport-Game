/// <reference types="vite/client" />

/**
 * Build identifier injected by Vite's `define`. Every cache name carries it, so activation can
 * delete exactly the caches belonging to previous builds of this app (`04` §3).
 */
declare const __BUILD_HASH__: string;
