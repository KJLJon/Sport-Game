/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.12 — Basketball art & audio pass
 * @story   US-13.3 — Control audio
 * @design  06-game-design.md §9 (art and audio direction), 10-ui-ux.md §11 (accessibility — no
 *          essential information by sound alone)
 * @invariant INV-9 (all three modes emit the same `SportEvent` shapes; this layer reads only the
 *            shared envelope and `basketball.controlSwitch`, never a mode), INV-14 (no runtime
 *            network request outside configured STUN — every sound here is synthesised, never
 *            fetched)
 *
 * Purpose: turns the match's `SportEvent` stream into sound. Every cue is oscillators and gain
 * envelopes, not a sample: there is no audio file anywhere in this module, which is what keeps it
 * inside CLAUDE.md §8.2's "no CDNs, no runtime network requests" without a licensing story to worry
 * about.
 *
 * **The `AudioContext` is never constructed here, and never at import time.** Browsers refuse to
 * run one until a user gesture, and constructing it early just means the first thing this module
 * would do is fail silently and confuse the caller about why nothing plays. Instead this module
 * takes an `AudioContextLike | null` from outside — the screen that owns the canvas is also the
 * thing that owns the user's first tap, so it constructs the real `AudioContext` there (a real one
 * satisfies `AudioContextLike` as-is; no adapter needed) and hands it in. `null` is a first-class,
 * permanent state, not a placeholder for "not ready yet": it is what makes this layer constructible
 * and testable with zero WebAudio in the room, and it is also what a browser with no WebAudio
 * support, or a user who has never interacted with the page, legitimately is.
 *
 * **Mute is not a volume of zero.** `settings.muted` (and a missing context) both take the fast path
 * out of `handleEvent` before any node is created — nothing is scheduled, nothing ticks silently in
 * the background waiting to be unmuted. `reducedAudio` (10 §11's "no essential information by sound
 * alone", mirrored from Reduced Motion) trims decoration rather than cutting output: the
 * controlled-athlete switch tick — pure flavour, already backed by the HUD and the ring marker in
 * `sports/basketball/art.ts` — drops out, and the remaining cues shorten instead of layering.
 */
import { EventKind, type SportEvent } from '../../engine/match/events.ts';
import { BasketballEvent } from '../../sports/basketball/rules.ts';

/** The oscillator waveform names every real and fake `OscillatorLike` shares. */
export type ToneType = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** The subset of `AudioParam` every tone in this file uses. Real `AudioParam`s satisfy it as-is. */
export interface AudioParamLike {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
}

export interface OscillatorLike extends AudioNodeLike {
  type: ToneType;
  readonly frequency: AudioParamLike;
  start(time: number): void;
  stop(time: number): void;
}

export interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** The subset of `AudioContext` this layer needs. Real `AudioContext` satisfies it as-is. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export interface AudioSettings {
  /** First-class silence. See header — not a synonym for `volume: 0`. */
  readonly muted: boolean;
  /** Drops decorative cues and shortens the rest, mirroring Reduced Motion (`10` §6). */
  readonly reducedAudio: boolean;
  /** Master gain applied to every cue, `0..1`. */
  readonly volume: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  reducedAudio: false,
  volume: 0.7,
};

/** One tone: a waveform, a pitch (optionally sweeping), a duration, and a peak loudness. */
interface ToneSpec {
  readonly type: ToneType;
  readonly startFreq: number;
  readonly endFreq?: number;
  readonly duration: number;
  readonly peakGain: number;
  readonly attack?: number;
  readonly delay?: number;
}

/**
 * Plays the basketball event stream. Owns no bus subscription itself — `attach()` is the
 * convenience wiring, `handleEvent()` is the whole contract, so a test can drive it one event at a
 * time without a real match running.
 */
export class BasketballAudio {
  private context: AudioContextLike | null;
  private settings: AudioSettings;

  constructor(context: AudioContextLike | null, settings: Partial<AudioSettings> = {}) {
    this.context = context;
    this.settings = { ...DEFAULT_AUDIO_SETTINGS, ...settings };
  }

  /** Swaps in the real `AudioContext` once the user's first gesture makes it legal to create one. */
  setContext(context: AudioContextLike | null): void {
    this.context = context;
  }

  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
  }

  setReducedAudio(reducedAudio: boolean): void {
    this.settings = { ...this.settings, reducedAudio };
  }

  setVolume(volume: number): void {
    this.settings = { ...this.settings, volume: clamp01(volume) };
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  get reducedAudio(): boolean {
    return this.settings.reducedAudio;
  }

  /** Subscribes to a bus, returning the unsubscribe. Convenience only — `handleEvent` does the work. */
  attach(bus: { on(listener: (event: SportEvent) => void): () => void }): () => void {
    return bus.on((event) => this.handleEvent(event));
  }

  /**
   * The whole event → sound mapping. Silent and side-effect-free (no node created, nothing
   * scheduled) whenever `canPlay()` is false — see header on why that is not "volume zero".
   */
  handleEvent(event: SportEvent): void {
    if (!this.canPlay()) return;

    switch (event.kind) {
      case EventKind.SHOT:
        this.playShotRelease();
        return;
      case EventKind.SCORE:
        this.playSwish();
        return;
      case EventKind.REBOUND:
        // @spec-ref 06-game-design.md §9 — "rim". There is no dedicated "miss" event on the bus
        // (`sports/basketball/rules.ts`'s `EventKind.SHOT` fires at release regardless of outcome,
        // and a make is `EventKind.SCORE`); a rebound only ever follows a miss
        // (`sports/basketball/index.ts`'s `takeLooseBall(..., rebound: true)` has exactly one call
        // site, reached only after `resolveFlight` finds `!shot.made`), so it is the one observable
        // proxy for "the shot missed" this stream offers. Resolved this way rather than adding a new
        // `SportEvent` kind, which is outside this task's file ownership (`engine/match/events.ts`).
        this.playRimMiss();
        return;
      case EventKind.FOUL:
        this.playWhistle();
        return;
      case EventKind.PERIOD_END:
      case EventKind.MATCH_END:
        this.playBuzzer();
        return;
      case EventKind.SPORT:
        if (event.sportKind === BasketballEvent.CONTROL_SWITCH) this.playControlTick();
        return;
      default:
        return;
    }
  }

  private canPlay(): boolean {
    return this.context !== null && !this.settings.muted;
  }

  /** A quick rising whoosh as the ball leaves the hand. */
  private playShotRelease(): void {
    this.play({ type: 'sine', startFreq: 260, endFreq: 520, duration: 0.12, peakGain: 0.16 });
  }

  /** A bright, fast-decaying chime — the one cue that should feel unambiguously good. */
  private playSwish(): void {
    this.play({ type: 'triangle', startFreq: 880, endFreq: 660, duration: 0.22, peakGain: 0.3 });
    this.play({ type: 'sine', startFreq: 1320, duration: 0.14, peakGain: 0.12, delay: 0.02 });
  }

  /** A dull, slightly detuned clank — two close pitches beating against each other reads as metal. */
  private playRimMiss(): void {
    this.play({ type: 'square', startFreq: 180, endFreq: 90, duration: 0.16, peakGain: 0.22 });
    this.play({ type: 'square', startFreq: 189, endFreq: 94, duration: 0.16, peakGain: 0.14 });
  }

  /** Two short high tones (one, under Reduced Audio) — a referee's whistle, not a siren. */
  private playWhistle(): void {
    const toot = { type: 'sine', startFreq: 2800, endFreq: 3100, peakGain: 0.2 } as const;
    if (this.settings.reducedAudio) {
      this.play({ ...toot, duration: 0.16 });
      return;
    }
    this.play({ ...toot, duration: 0.12 });
    this.play({ ...toot, duration: 0.12, delay: 0.15 });
  }

  /** A flat, sustained buzz at a period or match end. Shorter under Reduced Audio, never silent. */
  private playBuzzer(): void {
    const duration = this.settings.reducedAudio ? 0.32 : 0.6;
    this.play({ type: 'sawtooth', startFreq: 110, duration, peakGain: 0.32 });
  }

  /** A near-inaudible click for the controlled-athlete switch — decoration, so it is the one cue
   * Reduced Audio drops entirely rather than shortens (10 §11, §6). */
  private playControlTick(): void {
    if (this.settings.reducedAudio) return;
    this.play({ type: 'square', startFreq: 1200, duration: 0.03, peakGain: 0.1, attack: 0.001 });
  }

  private play(spec: ToneSpec): void {
    const ctx = this.context;
    if (ctx === null) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + (spec.delay ?? 0);
    const attack = spec.attack ?? 0.005;
    const peak = spec.peakGain * this.settings.volume;

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.startFreq, start);
    if (spec.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.endFreq), start + spec.duration);
    }

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    // Exponential ramps can't target zero, so the tail settles just above it rather than at it.
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + spec.duration + 0.02);
  }
}

/** Whether the platform has a usable WebAudio implementation, without constructing one. */
export function isAudioSupported(scope: typeof globalThis = globalThis): boolean {
  return typeof (scope as { AudioContext?: unknown }).AudioContext === 'function';
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
