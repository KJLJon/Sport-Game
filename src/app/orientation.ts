/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-13.1 — The game works on my phone
 * @design  04-architecture.md §9 (mobile), 10-ui-ux.md §4 (layout)
 *
 * Purpose: reports the current orientation and requests a lock where the platform supports one.
 * iOS Safari does not implement `screen.orientation.lock`, so a rotate prompt is the fallback —
 * never an error, and never a blocked screen.
 */

export type Orientation = 'portrait' | 'landscape';

export type LockOutcome = 'locked' | 'unsupported' | 'rejected';

/** The slice of `screen` we depend on. Narrowed so tests can supply a fake. */
export interface OrientationTarget {
  readonly orientation?: {
    readonly type?: string;
    lock?(orientation: string): Promise<void>;
    unlock?(): void;
    addEventListener?(type: 'change', listener: () => void): void;
    removeEventListener?(type: 'change', listener: () => void): void;
  };
  readonly width?: number;
  readonly height?: number;
}

/**
 * Reads the current orientation. Prefers `screen.orientation.type`; falls back to comparing
 * dimensions, which is what iOS needs.
 */
export function readOrientation(
  target: OrientationTarget | undefined,
  viewport: { width: number; height: number },
): Orientation {
  const type = target?.orientation?.type;
  if (typeof type === 'string') {
    if (type.startsWith('portrait')) return 'portrait';
    if (type.startsWith('landscape')) return 'landscape';
  }
  return viewport.width > viewport.height ? 'landscape' : 'portrait';
}

/**
 * Asks the platform to lock orientation. Resolves with what actually happened rather than
 * throwing, because "this browser can't" is an expected, non-exceptional answer.
 */
export async function requestOrientationLock(
  orientation: Orientation,
  target: OrientationTarget | undefined,
): Promise<LockOutcome> {
  const screenOrientation = target?.orientation;
  const lock = screenOrientation?.lock;
  if (typeof lock !== 'function') return 'unsupported';

  try {
    await lock.call(screenOrientation, orientation);
    return 'locked';
  } catch {
    // Chrome rejects unless the document is fullscreen; that is a normal outcome, not a bug.
    return 'rejected';
  }
}

export function releaseOrientationLock(target: OrientationTarget | undefined): void {
  const screenOrientation = target?.orientation;
  const unlock = screenOrientation?.unlock;
  if (typeof unlock === 'function') {
    try {
      unlock.call(screenOrientation);
    } catch {
      // Nothing to do: an unlock that fails leaves us exactly where we already were.
    }
  }
}

/**
 * Decides whether to show the rotate prompt. A screen declaring `any` never prompts, and a match
 * that got its lock never prompts either.
 */
export function shouldPromptRotate(
  wanted: Orientation | 'any',
  actual: Orientation,
  lock: LockOutcome | null,
): boolean {
  if (wanted === 'any') return false;
  if (lock === 'locked') return false;
  return wanted !== actual;
}
