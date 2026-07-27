/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.6 — Service worker: atomic precache install, versioned caches
 * @story   US-1.2 — Play offline
 * @design  11-pwa-lifecycle.md §5.1, 04-architecture.md §10
 */
import { describe, expect, it } from 'vitest';
import { precacheUrls } from '../../../tools/vite-plugin-sw.ts';

const BASE = '/Sport-Game/';

describe('precacheUrls', () => {
  it('prefixes every asset with the base path', () => {
    const urls = precacheUrls(['assets/app-abc123.js', 'icons/icon-192.png'], BASE);
    expect(urls).toContain('/Sport-Game/assets/app-abc123.js');
    expect(urls).toContain('/Sport-Game/icons/icon-192.png');
  });

  it('always includes the document itself', () => {
    expect(precacheUrls([], BASE)).toContain(BASE);
  });

  it('excludes sourcemaps — they are megabytes nobody needs offline', () => {
    const urls = precacheUrls(['assets/app-abc.js', 'assets/app-abc.js.map'], BASE);
    expect(urls).toContain('/Sport-Game/assets/app-abc.js');
    expect(urls).not.toContain('/Sport-Game/assets/app-abc.js.map');
  });

  it('excludes the three network-first resources from `11` §2', () => {
    const urls = precacheUrls(['sw.js', 'version.json', 'manifest.webmanifest'], BASE);
    expect(urls).toEqual([BASE]);
  });

  it('deduplicates, so `addAll` cannot reject on a repeated request', () => {
    const urls = precacheUrls(['index.html', 'index.html'], BASE);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('is sorted, so the emitted worker only changes when the assets do', () => {
    const urls = precacheUrls(['assets/z.js', 'assets/a.js', 'icons/i.png'], BASE);
    expect(urls).toEqual([...urls].sort());
  });

  it('follows a repository rename', () => {
    expect(precacheUrls(['assets/app.js'], '/Renamed/')).toContain('/Renamed/assets/app.js');
    expect(precacheUrls(['assets/app.js'], '/')).toContain('/assets/app.js');
  });
});
