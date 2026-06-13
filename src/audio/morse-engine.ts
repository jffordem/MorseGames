// Morse tone + timing engine built on the Web Audio API.
//
// Implements ARRL-standard Farnsworth timing: characters are keyed at the
// character speed, while the spacing between characters/words is stretched so
// the overall "effective" speed is slower. This lets a learner hear real
// full-speed characters with comfortable gaps in between.

import { MORSE } from "../data/koch";

export interface EngineSettings {
  /** Character speed in WPM (how fast each character is keyed). */
  charWpm: number;
  /** Effective / Farnsworth speed in WPM (<= charWpm). */
  effectiveWpm: number;
  /** Sidetone frequency in Hz. */
  frequencyHz: number;
}

export interface Timing {
  /** Duration of a dit (and intra-character gap) in ms. */
  unitMs: number;
  ditMs: number;
  dahMs: number;
  /** Gap between elements within a character. */
  intraMs: number;
  /** Gap between characters (Farnsworth-stretched). */
  interCharMs: number;
  /** Gap between words (Farnsworth-stretched). */
  interWordMs: number;
}

/**
 * Compute element/gap durations from character + effective speed.
 *
 * A PARIS standard word = 50 units: 31 units of marks + intra-character gaps,
 * and 19 units of inter-character (4x3) + inter-word (7) spacing. We key the 31
 * element units at the character speed and distribute the remaining time across
 * the 19 spacing units to hit the effective speed.
 */
export function computeTiming(charWpm: number, effectiveWpm: number): Timing {
  const cWpm = Math.max(1, charWpm);
  const eWpm = Math.max(1, Math.min(effectiveWpm, cWpm));

  const unitMs = 1200 / cWpm; // dit at character speed

  // Total time per standard word at the effective speed.
  const wordMs = 60000 / eWpm;
  // Time spent on the 31 element units at character speed.
  const elementMs = 31 * unitMs;
  // Remaining time spread over the 19 standard spacing units.
  const farnsworthUnitMs = Math.max(unitMs, (wordMs - elementMs) / 19);

  return {
    unitMs,
    ditMs: unitMs,
    dahMs: unitMs * 3,
    intraMs: unitMs,
    interCharMs: farnsworthUnitMs * 3,
    interWordMs: farnsworthUnitMs * 7,
  };
}

/** Options for {@link MorseEngine.playString}. */
export interface PlayStringOptions {
  /** Index to begin playback from (for resume). Defaults to 0. */
  startIndex?: number;
  /** Called as each character (including spaces) begins, with its absolute index. */
  onCharStart?: (char: string, index: number) => void;
  /** Called once the string finishes playing (not called if cancelled). */
  onDone?: () => void;
  /** Polled between characters; while true, playback idles. */
  isPaused?: () => boolean;
  /** Polled between characters; once true, playback stops. */
  isCancelled?: () => boolean;
}

const ATTACK_S = 0.005; // 5 ms ramp to avoid clicks
const RELEASE_S = 0.005;
const WARMUP_MS = 400; // one-time delay to let a cold output device spin up

export class MorseEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: { osc: OscillatorNode; gain: GainNode }[] = [];
  private keepAlive: { osc: OscillatorNode; gain: GainNode } | null = null;
  private warmedUp = false;
  settings: EngineSettings;

  constructor(settings: EngineSettings) {
    this.settings = settings;
  }

  /** Must be called from a user gesture before any audio can play. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    this.startKeepAlive();
    // First time only: give the just-woken output device a moment so the
    // opening symbols aren't clipped while it spins up.
    if (!this.warmedUp) {
      this.warmedUp = true;
      await delay(WARMUP_MS);
    }
  }

  /**
   * A continuous, effectively-silent subsonic tone that keeps the audio output
   * device awake so it never powers down between symbols/words (which would
   * otherwise drop the first samples of the next sound). Started once and left
   * running for the life of the context.
   */
  private startKeepAlive(): void {
    if (!this.ctx || this.keepAlive) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    // Low bass, below most laptop-speaker reproduction so it stays inaudible,
    // but NOT subsonic (drivers DC-block ~30 Hz down to nothing). The gain is
    // the important part: 0.0006 (~-64 dBFS) reads as digital silence to
    // Windows' audio power management, which then parks the output endpoint
    // between words — the un-park on the next word is what clips the opening
    // symbols. 0.02 clears that silence threshold while staying inaudible on
    // small speakers. (May be faintly audible on good headphones — tune here.)
    osc.frequency.value = 60;
    gain.gain.value = 0.02;
    osc.connect(gain);
    gain.connect(this.ctx.destination); // independent of master so stop() can't touch it
    osc.start();
    this.keepAlive = { osc, gain };
  }

  get timing(): Timing {
    return computeTiming(this.settings.charWpm, this.settings.effectiveWpm);
  }

  /** Stop any in-flight tones immediately. */
  stop(): void {
    for (const { osc, gain } of this.active) {
      try {
        gain.gain.cancelScheduledValues(this.now());
        gain.gain.setValueAtTime(0, this.now());
        osc.stop(this.now() + 0.02);
      } catch {
        /* already stopped */
      }
    }
    this.active = [];
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Play a single character's pattern. Resolves when the audio finishes.
   * Returns immediately (resolved) for unknown or whitespace characters.
   */
  async playChar(char: string): Promise<void> {
    await this.resume();
    if (!this.ctx || !this.master) return;

    const pattern = MORSE[char.toUpperCase()];
    if (!pattern) return;

    const t = this.timing;
    const startAt = this.ctx.currentTime + 0.05;
    let cursor = startAt;

    for (let i = 0; i < pattern.length; i++) {
      const on = pattern[i] === "-" ? t.dahMs : t.ditMs;
      this.scheduleTone(cursor, on / 1000);
      cursor += on / 1000;
      if (i < pattern.length - 1) {
        cursor += t.intraMs / 1000; // intra-character gap
      }
    }

    const totalMs = (cursor - startAt) * 1000 + 20;
    await delay(totalMs);
  }

  /**
   * Wake the output device with a brief inaudible tone before the real symbols
   * start. If Windows has parked the endpoint during a long idle gap (e.g. while
   * the player types a word), this feeds it flowing audio so the un-park
   * completes during the lead-in instead of clipping the first dit. Resolves
   * after `leadMs`, so callers can `await` it in place of a silent delay.
   */
  async primeOutput(leadMs: number): Promise<void> {
    await this.resume();
    if (!this.ctx || !this.master) return;

    const start = this.ctx.currentTime + 0.02;
    const durS = leadMs / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = this.settings.frequencyHz;
    osc.connect(gain);
    gain.connect(this.master);

    // ~-62 dBFS: real signal at the sidetone frequency (so the endpoint wakes),
    // but far below audibility. Ramped to avoid an attack click.
    const end = start + durS;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.0008, start + ATTACK_S);
    gain.gain.setValueAtTime(0.0008, Math.max(start + ATTACK_S, end - RELEASE_S));
    gain.gain.linearRampToValueAtTime(0, end);

    osc.start(start);
    osc.stop(end + 0.01);

    const entry = { osc, gain };
    this.active.push(entry);
    osc.onended = () => {
      this.active = this.active.filter((e) => e !== entry);
    };

    await delay(leadMs);
  }

  /**
   * Play a whole string as Morse with correct inter-character and inter-word
   * spacing. Drives playback character-by-character so it can be paused,
   * cancelled, and reported (for highlighting / reveal) at boundaries.
   */
  async playString(text: string, opts: PlayStringOptions = {}): Promise<void> {
    await this.resume();
    const start = opts.startIndex ?? 0;
    for (let i = start; i < text.length; i++) {
      if (opts.isCancelled?.()) return;
      while (opts.isPaused?.()) {
        if (opts.isCancelled?.()) return;
        await delay(80);
      }
      const ch = text[i];
      opts.onCharStart?.(ch, i);

      if (ch === " ") {
        await delay(this.timing.interWordMs);
        continue;
      }

      await this.playChar(ch);
      if (opts.isCancelled?.()) return;

      // Inter-character gap, unless a word gap follows (a space adds its own).
      const next = text[i + 1];
      if (next && next !== " ") {
        await delay(this.timing.interCharMs);
      }
    }
    opts.onDone?.();
  }

  /** Short, low, descending "klunk" to signal a wrong answer. */
  playError(): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + 0.01;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.16); // pitch drop = "klunk"
    osc.connect(gain);
    gain.connect(this.master);

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.35, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);

    osc.start(t0);
    osc.stop(t0 + 0.2);
    const entry = { osc, gain };
    this.active.push(entry);
    osc.onended = () => {
      this.active = this.active.filter((e) => e !== entry);
    };
  }

  /** Schedule one tone burst with click-free attack/release envelope. */
  private scheduleTone(startTime: number, durationS: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = this.settings.frequencyHz;
    osc.connect(gain);
    gain.connect(this.master);

    const end = startTime + durationS;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + ATTACK_S);
    gain.gain.setValueAtTime(1, Math.max(startTime + ATTACK_S, end - RELEASE_S));
    gain.gain.linearRampToValueAtTime(0, end);

    osc.start(startTime);
    osc.stop(end + 0.01);

    const entry = { osc, gain };
    this.active.push(entry);
    osc.onended = () => {
      this.active = this.active.filter((e) => e !== entry);
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
