// Random Run mode: hear a character, type it. No time limit.
// Speed and Koch character set are adjustable; progress is by graduating levels.

import { MorseEngine } from "../audio/morse-engine";
import { KOCH_ORDER, MORSE, kochSet } from "../data/koch";
import {
  loadSettings,
  saveSettings,
  loadCharStats,
  recordResult,
  recordTiming,
  Settings,
} from "../stats/storage";

const GRADUATION_STEP = 5; // characters added per level-up
const GRADUATION_PER_CHAR = 20; // correct copies per active char to graduate
const RANDOM_PICK_FLOOR = 0.3; // fraction of picks that stay pure-random, so biasing stays quiet
const WARMUP_MS = 45000; // ignore latency data for this long after Start — settling-in jitter isn't real difficulty

interface SessionStats {
  score: number;
  attempts: number;
  correct: number;
  streak: number;
  bestStreak: number;
  replays: number;
  correctAtLevel: number;
  perChar: Record<string, { attempts: number; correct: number }>;
}

function freshSession(): SessionStats {
  return {
    score: 0,
    attempts: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    replays: 0,
    correctAtLevel: 0,
    perChar: {},
  };
}

export class RandomRunMode {
  private root: HTMLElement;
  private settings: Settings;
  private engine: MorseEngine;

  private running = false;
  private awaitingInput = false;
  private current = "";
  private recentPicks: string[] = [];
  private session: SessionStats = freshSession();

  // Recognition-latency capture — invisible to the player, feeds the same decaying
  // per-character difficulty score as Word Wrangler (see stats/storage.ts). Random Run
  // is strict call-and-response (one char, one keystroke), so this needs only a single
  // timestamp pair per round rather than Word Wrangler's per-position correlation.
  private charEndTime = 0;
  private timingReliable = false;
  private sessionStartTime = 0;
  private onVisibilityChange = (): void => {
    if (document.hidden && this.running) this.timingReliable = false;
  };

  // Cached element refs
  private elDisplay!: HTMLElement;
  private elDisplaySub!: HTMLElement;
  private elScore!: HTMLElement;
  private elAccuracy!: HTMLElement;
  private elStreak!: HTMLElement;
  private elBest!: HTMLElement;
  private elLevel!: HTMLElement;
  private elProgress!: HTMLElement;
  private elProgressBar!: HTMLElement;
  private elStartBtn!: HTMLButtonElement;
  private elKochSlider!: HTMLInputElement;
  private elKochLabel!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.engine = new MorseEngine({
      charWpm: this.settings.charWpm,
      effectiveWpm: this.settings.effectiveWpm,
      frequencyHz: this.settings.frequencyHz,
    });
  }

  private get activeChars(): string[] {
    return kochSet(this.settings.kochLevel);
  }

  private get threshold(): number {
    return this.activeChars.length * GRADUATION_PER_CHAR;
  }

  mount(): void {
    this.root.innerHTML = "";
    this.root.appendChild(this.buildSettingsPanel());
    this.root.appendChild(this.buildHud());
    this.root.appendChild(this.buildStage());
    this.root.appendChild(this.buildControls());
    this.refreshHud();
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  unmount(): void {
    this.stop();
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  // ---- DOM construction ---------------------------------------------------

  private buildSettingsPanel(): HTMLElement {
    const panel = el("section", "settings");

    const charWpm = this.numberField(
      "Character speed (WPM)",
      this.settings.charWpm,
      10,
      40,
      (v) => {
        this.settings.charWpm = v;
        if (this.settings.effectiveWpm > v) this.settings.effectiveWpm = v;
        this.applySettings();
      }
    );
    const effWpm = this.numberField(
      "Effective / Farnsworth (WPM)",
      this.settings.effectiveWpm,
      5,
      40,
      (v) => {
        this.settings.effectiveWpm = Math.min(v, this.settings.charWpm);
        this.applySettings();
      }
    );
    const freq = this.numberField(
      "Tone (Hz)",
      this.settings.frequencyHz,
      400,
      1000,
      (v) => {
        this.settings.frequencyHz = v;
        this.applySettings();
      }
    );

    // Koch level slider
    const levelWrap = el("label", "field");
    levelWrap.appendChild(text("span", "field-label", "Koch level (active characters)"));
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "2";
    slider.max = String(KOCH_ORDER.length);
    slider.value = String(this.settings.kochLevel);
    const levelView = text("span", "field-value", this.kochLevelLabel());
    slider.addEventListener("input", () => {
      this.settings.kochLevel = Number(slider.value);
      levelView.textContent = this.kochLevelLabel();
      this.applySettings();
    });
    this.elKochSlider = slider;
    this.elKochLabel = levelView;
    levelWrap.appendChild(slider);
    levelWrap.appendChild(levelView);

    panel.append(charWpm, effWpm, freq, levelWrap);
    return panel;
  }

  private kochLevelLabel(): string {
    const chars = this.activeChars;
    return `${chars.length}: ${chars.join(" ")}`;
  }

  private numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void
  ): HTMLElement {
    const wrap = el("label", "field");
    wrap.appendChild(text("span", "field-label", label));
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener("change", () => {
      let v = Number(input.value);
      if (Number.isNaN(v)) v = value;
      v = Math.max(min, Math.min(max, v));
      input.value = String(v);
      onChange(v);
    });
    wrap.appendChild(input);
    return wrap;
  }

  private buildHud(): HTMLElement {
    const hud = el("section", "hud");
    this.elScore = stat(hud, "Score", "0");
    this.elAccuracy = stat(hud, "Accuracy", "—");
    this.elStreak = stat(hud, "Streak", "0");
    this.elBest = stat(hud, "Best", "0");
    this.elLevel = stat(hud, "Level", "0");
    return hud;
  }

  private buildStage(): HTMLElement {
    const stage = el("section", "stage");
    this.elDisplay = el("div", "display");
    this.elDisplay.textContent = "▶";
    this.elDisplaySub = el("div", "display-sub");
    this.elDisplaySub.textContent = "Press Start, then type the character you hear";

    const progressWrap = el("div", "progress");
    this.elProgressBar = el("div", "progress-bar");
    progressWrap.appendChild(this.elProgressBar);
    this.elProgress = el("div", "progress-label");

    stage.append(this.elDisplay, this.elDisplaySub, progressWrap, this.elProgress);
    return stage;
  }

  private buildControls(): HTMLElement {
    const bar = el("section", "controls");
    this.elStartBtn = document.createElement("button");
    this.elStartBtn.className = "btn primary";
    this.elStartBtn.textContent = "▶ Start";
    this.elStartBtn.addEventListener("click", () => {
      if (this.running) this.stop();
      else void this.start();
    });

    const hint = text(
      "p",
      "hint",
      "Space = replay · Esc = end session · type the letter you hear"
    );

    bar.append(this.elStartBtn, hint);
    return bar;
  }

  // ---- Session control ----------------------------------------------------

  private applySettings(): void {
    this.engine.settings = {
      charWpm: this.settings.charWpm,
      effectiveWpm: this.settings.effectiveWpm,
      frequencyHz: this.settings.frequencyHz,
    };
    saveSettings(this.settings);
    this.refreshHud();
  }

  private async start(): Promise<void> {
    await this.engine.resume();
    this.session = freshSession();
    this.recentPicks = [];
    this.sessionStartTime = performance.now();
    this.running = true;
    this.elStartBtn.textContent = "⏹ Stop";
    this.refreshHud();
    void this.nextChar();
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.awaitingInput = false;
    this.engine.stop();
    this.elStartBtn.textContent = "▶ Start";
    this.showSummary();
  }

  /** Mostly weights toward characters with a high decaying difficulty score (see
   *  stats/storage.ts's recordTiming()), but a fixed fraction of picks stay
   *  pure-random so biasing stays quiet rather than becoming a repetitive grind. */
  private pick(): string {
    const chars = this.activeChars;
    let candidates = chars;
    // No character three times in a row (doubles allowed).
    if (
      this.recentPicks.length >= 2 &&
      this.recentPicks[0] === this.recentPicks[1]
    ) {
      const banned = this.recentPicks[0];
      candidates = chars.filter((c) => c !== banned);
      if (candidates.length === 0) candidates = chars;
    }
    if (Math.random() < RANDOM_PICK_FLOOR) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    const stats = loadCharStats();
    const weights = candidates.map((c) => 1 + (stats[c]?.difficulty ?? 0));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1]; // float-rounding fallback
  }

  private async nextChar(): Promise<void> {
    if (!this.running) return;
    this.current = this.pick();
    this.recentPicks.unshift(this.current);
    this.recentPicks = this.recentPicks.slice(0, 2);
    this.timingReliable = true; // reset each round; only an event (replay, tab-hide) knocks this false

    this.setDisplay("♪", "listening", "Listening…");
    this.awaitingInput = false;
    await this.engine.playChar(this.current);
    if (!this.running) return;
    this.charEndTime = performance.now();
    this.awaitingInput = true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.running) return;

    if (e.key === "Escape") {
      e.preventDefault();
      this.stop();
      return;
    }
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (this.awaitingInput) {
        this.session.replays += 1;
        // Replaying restarts the audio schedule, so any latency measured against the
        // original charEndTime would no longer be meaningful — drop it for this round.
        this.timingReliable = false;
        void this.engine.playChar(this.current);
      }
      return;
    }

    if (!this.awaitingInput) return;
    if (e.key.length !== 1) return;
    const guess = e.key.toUpperCase();
    if (!(guess in MORSE)) return;
    // Keys outside the active set are ignored entirely.
    if (!this.activeChars.includes(guess)) return;

    e.preventDefault();
    this.awaitingInput = false;
    const latencyMs = performance.now() - this.charEndTime;
    void this.evaluate(guess, latencyMs);
  };

  private async evaluate(guess: string, latencyMs: number): Promise<void> {
    const correct = guess === this.current;
    this.session.attempts += 1;
    const pc = this.session.perChar[this.current] ?? { attempts: 0, correct: 0 };
    pc.attempts += 1;
    if (correct) pc.correct += 1;
    this.session.perChar[this.current] = pc;
    // Fold recognition latency into the decaying difficulty score when it's
    // trustworthy — no replay/tab-hide since the sound finished, and the session has
    // settled in past its warm-up window (checked fresh here, not cached at round
    // start, so a long pause mid-round still crosses the threshold correctly).
    // Otherwise fall back to the plain attempts/correct update so lifetime stats are
    // never skipped.
    const pastWarmup = performance.now() - this.sessionStartTime >= WARMUP_MS;
    if (this.timingReliable && pastWarmup) recordTiming(this.current, correct, latencyMs);
    else recordResult(this.current, correct);

    if (correct) {
      this.session.score += 1;
      this.session.correct += 1;
      this.session.streak += 1;
      this.session.bestStreak = Math.max(
        this.session.bestStreak,
        this.session.streak
      );
      this.session.correctAtLevel += 1;
      this.setDisplay(this.current, "correct", "✓");
      this.refreshHud();
      if (
        this.session.streak > 0 &&
        [10, 25, 50, 100].includes(this.session.streak)
      ) {
        this.elDisplaySub.textContent = `🔥 ${this.session.streak} streak!`;
      }
      await delay(180);
      if (this.session.correctAtLevel >= this.threshold) {
        this.offerGraduation();
        return;
      }
      void this.nextChar();
    } else {
      this.session.streak = 0;
      // Show the correct letter in red + a quick "klunk"; no morse replay
      // (mistypes/mispicks just need a fast nudge, not a re-teach).
      this.setDisplay(this.current, "wrong", `✗ was ${this.current}`);
      this.refreshHud();
      this.engine.playError();
      await delay(450);
      if (!this.running) return;
      void this.nextChar();
    }
  }

  // ---- Graduation & summary ----------------------------------------------

  private offerGraduation(): void {
    this.awaitingInput = false;
    const atMax = this.settings.kochLevel >= KOCH_ORDER.length;
    const nextLevel = Math.min(
      this.settings.kochLevel + GRADUATION_STEP,
      KOCH_ORDER.length
    );
    const newChars = KOCH_ORDER.slice(this.settings.kochLevel, nextLevel);

    const body = atMax
      ? `You've mastered all ${KOCH_ORDER.length} characters at this level — outstanding!`
      : `You've made ${this.threshold} correct copies at ${this.activeChars.length} characters!\n\n` +
        `Graduate to ${nextLevel} characters? New: ${newChars.join(" ")}`;

    const modal = new Modal("🎉 Congratulations!", body);
    if (!atMax) {
      modal.addButton("Graduate", "primary", () => {
        modal.close();
        // Advance the level, reset session stats, and keep running.
        this.settings.kochLevel = nextLevel;
        saveSettings(this.settings);
        this.syncKochControl();
        this.session = freshSession();
        this.recentPicks = [];
        this.refreshHud();
        void this.nextChar();
      });
    }
    modal.addButton(atMax ? "Keep going" : "Stay at this level", "", () => {
      modal.close();
      // Stay put; re-offer after another threshold's worth of correct copies.
      this.session.correctAtLevel = 0;
      this.refreshHud();
      void this.nextChar();
    });
    modal.open();
  }

  /** Reflect the current Koch level in the settings slider + label. */
  private syncKochControl(): void {
    if (this.elKochSlider) this.elKochSlider.value = String(this.settings.kochLevel);
    if (this.elKochLabel) this.elKochLabel.textContent = this.kochLevelLabel();
  }

  private showSummary(): void {
    const s = this.session;
    const acc =
      s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0;
    const modal = new Modal("Session summary", "");
    const body = el("div", "summary");
    body.appendChild(summaryRow("Score", String(s.score)));
    body.appendChild(summaryRow("Accuracy", `${acc}%  (${s.correct}/${s.attempts})`));
    body.appendChild(summaryRow("Best streak", String(s.bestStreak)));
    body.appendChild(summaryRow("Replays used", String(s.replays)));

    const heat = el("div", "heatmap");
    heat.appendChild(text("div", "heatmap-title", "Per-character accuracy"));
    const grid = el("div", "heatmap-grid");
    for (const ch of this.activeChars) {
      const pc = s.perChar[ch];
      const cell = el("div", "heat-cell");
      const pct = pc && pc.attempts > 0 ? Math.round((pc.correct / pc.attempts) * 100) : -1;
      if (pct < 0) {
        cell.classList.add("empty");
        cell.title = `${ch}: no attempts`;
      } else {
        cell.style.background = heatColor(pct);
        cell.title = `${ch}: ${pct}% (${pc.correct}/${pc.attempts})`;
      }
      cell.textContent = ch;
      grid.appendChild(cell);
    }
    heat.appendChild(grid);
    body.appendChild(heat);

    modal.setBodyNode(body);
    modal.addButton("Close", "primary", () => modal.close());
    modal.open();
  }

  // ---- HUD / display helpers ---------------------------------------------

  private setDisplay(main: string, cls: string, sub: string): void {
    this.elDisplay.textContent = main;
    this.elDisplay.className = `display ${cls}`;
    this.elDisplaySub.textContent = sub;
  }

  private refreshHud(): void {
    const s = this.session;
    const acc = s.attempts > 0 ? `${Math.round((s.correct / s.attempts) * 100)}%` : "—";
    this.elScore.textContent = String(s.score);
    this.elAccuracy.textContent = acc;
    this.elStreak.textContent = String(s.streak);
    this.elBest.textContent = String(s.bestStreak);
    this.elLevel.textContent = String(this.activeChars.length);

    const pct = Math.min(100, Math.round((s.correctAtLevel / this.threshold) * 100));
    this.elProgressBar.style.width = `${pct}%`;
    this.elProgress.textContent = `${s.correctAtLevel} / ${this.threshold} to next level`;
  }
}

// ---- Small DOM utilities --------------------------------------------------

function el(tag: string, className = ""): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}

function stat(parent: HTMLElement, label: string, value: string): HTMLElement {
  const wrap = el("div", "stat");
  wrap.appendChild(text("div", "stat-label", label));
  const v = text("div", "stat-value", value);
  wrap.appendChild(v);
  parent.appendChild(wrap);
  return v;
}

function summaryRow(label: string, value: string): HTMLElement {
  const row = el("div", "summary-row");
  row.appendChild(text("span", "summary-label", label));
  row.appendChild(text("span", "summary-value", value));
  return row;
}

/** Red (0%) → amber (50%) → green (100%). */
function heatColor(pct: number): string {
  const hue = Math.round((pct / 100) * 120); // 0=red, 120=green
  return `hsl(${hue}, 65%, 42%)`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Minimal modal --------------------------------------------------------

class Modal {
  private overlay: HTMLElement;
  private footer: HTMLElement;

  constructor(title: string, body: string) {
    this.overlay = el("div", "modal-overlay");
    const box = el("div", "modal");
    box.appendChild(text("h2", "modal-title", title));
    if (body) {
      const p = el("div", "modal-body");
      p.textContent = body;
      box.appendChild(p);
    }
    this.footer = el("div", "modal-footer");
    box.appendChild(this.footer);
    this.overlay.appendChild(box);
  }

  setBodyNode(node: HTMLElement): void {
    node.classList.add("modal-body");
    this.footer.before(node);
  }

  addButton(label: string, variant: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.className = `btn ${variant}`.trim();
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    this.footer.appendChild(btn);
  }

  open(): void {
    document.body.appendChild(this.overlay);
  }

  close(): void {
    this.overlay.remove();
  }
}
