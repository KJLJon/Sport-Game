/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.16 — PWA lifecycle E2E suite: all sixteen scenarios in `11` §9
 * @story   US-1.2, US-1.4, US-1.8, US-1.9
 * @design  11-pwa-lifecycle.md §9, 04-architecture.md §2
 *
 * Purpose: serves the real build under the deployed base path, with control endpoints that let a
 * test deploy a second version, break an asset, or take the network down. Half of `11` §9 cannot
 * be tested without a server that can misbehave on demand.
 *
 * The "v2" build is the same bundle with its build hash rewritten. That is not a shortcut: the
 * hash is what names every cache and what `version.json` reports, so rewriting it produces
 * exactly the byte-level change the browser uses to detect a new worker.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const BASE = process.env['E2E_BASE'] ?? '/Sport-Game/';
const PORT = Number(process.env['E2E_PORT'] ?? 4173);

const V2_HASH = 'v2test0';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.map': 'application/json',
};

interface ControlState {
  /** Serve the rewritten build, so the browser sees a new worker. */
  deployed: 'v1' | 'v2';
  /** Paths that answer 404 — used to make a precache install fail as a unit (PWA-6). */
  broken: Set<string>;
  /** Refuse every connection, which is what being offline actually looks like. */
  offline: boolean;
  /** Overrides merged into `version.json`, for the forced-update scenario (PWA-12). */
  versionOverrides: Record<string, unknown>;
}

const state: ControlState = {
  deployed: 'v1',
  broken: new Set(),
  offline: false,
  versionOverrides: {},
};

/** Rewrites the build hash so v2 differs from v1 in exactly the way a real deploy does. */
function toV2(body: Uint8Array, originalHash: string): Uint8Array {
  const text = Buffer.from(body).toString('utf8');
  return Buffer.from(text.split(originalHash).join(V2_HASH), 'utf8');
}

async function readVersionHash(): Promise<string> {
  const raw = await readFile(join(DIST, 'version.json'), 'utf8');
  return (JSON.parse(raw) as { buildHash: string }).buildHash;
}

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Uint8Array,
  type: string,
): void {
  res.writeHead(status, {
    'Content-Type': type,
    // `11` §2 — the two unhashed resources that must never be served from a stale cache.
    'Cache-Control': type.includes('json') ? 'no-store' : 'public, max-age=0',
  });
  res.end(body);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    void handle(req, res);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  const path = decodeURIComponent(url.split('?')[0] ?? '/');

  // Control endpoints stay reachable while "offline", so a test can restore the network.
  if (path.startsWith('/__control/')) {
    handleControl(path, res);
    return;
  }

  if (state.offline) {
    req.socket.destroy();
    return;
  }

  if (!path.startsWith(BASE)) {
    send(res, 404, 'outside the app scope', 'text/plain');
    return;
  }

  // `normalize('')` is `'.'`, not `''`, so the empty case is handled before normalising.
  const requested = path.slice(BASE.length);
  const relative = requested === '' ? 'index.html' : normalize(requested);
  if (relative.startsWith('..')) {
    send(res, 403, 'no', 'text/plain');
    return;
  }

  if (state.broken.has(relative)) {
    send(res, 404, 'deliberately missing', 'text/plain');
    return;
  }

  const name = relative.endsWith('/') ? `${relative}index.html` : relative;

  try {
    let body: Uint8Array = await readFile(join(DIST, name));

    if (name === 'version.json') {
      const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
      if (state.deployed === 'v2') parsed['buildHash'] = V2_HASH;
      Object.assign(parsed, state.versionOverrides);
      body = Buffer.from(JSON.stringify(parsed), 'utf8');
    } else if (state.deployed === 'v2' && name === 'sw.js') {
      body = toV2(body, await readVersionHash());
    }

    send(res, 200, body, MIME[extname(name)] ?? 'application/octet-stream');
  } catch {
    // Pages has no rewrites, so an unknown path gets the 404.html copy of the shell (`04` §2).
    try {
      send(res, 404, await readFile(join(DIST, '404.html')), MIME['.html']!);
    } catch {
      send(res, 404, 'not found', 'text/plain');
    }
  }
}

function handleControl(path: string, res: http.ServerResponse): void {
  const [, , command, ...rest] = path.split('/');
  const argument = rest.join('/');

  switch (command) {
    case 'deploy':
      state.deployed = argument === 'v1' ? 'v1' : 'v2';
      break;
    case 'break':
      state.broken.add(argument);
      break;
    case 'fix':
      state.broken.delete(argument);
      break;
    case 'offline':
      state.offline = argument !== 'off';
      break;
    case 'version':
      state.versionOverrides = argument === '' ? {} : (JSON.parse(atob(argument)) as never);
      break;
    case 'reset':
      state.deployed = 'v1';
      state.broken.clear();
      state.offline = false;
      state.versionOverrides = {};
      break;
    default:
      send(res, 400, 'unknown command', 'text/plain');
      return;
  }

  send(
    res,
    200,
    JSON.stringify({ ok: true, state: { ...state, broken: [...state.broken] } }),
    MIME['.json']!,
  );
}

if (process.argv[1]?.endsWith('e2e-server.ts') === true) {
  createServer().listen(PORT, () => {
    console.log(`e2e server on http://localhost:${PORT}${BASE}`);
  });
}
