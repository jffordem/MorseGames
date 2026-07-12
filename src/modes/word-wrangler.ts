// Word Wrangler mode: like Random Run, but the unit of play is a whole word.
// Words are drawn from the dictionary but filtered to those formable with the
// current Koch character set (and capped in length to keep the pace up). You
// hear the word, type it (as you go), and press Enter to submit.

import { MorseEngine, charDurationMs } from "../audio/morse-engine";
import { KOCH_ORDER, kochSet, MORSE } from "../data/koch";
import { loadWordList, formableWords, WORD_LISTS } from "../data/words";
import { loadSettings, saveSettings, loadCharStats, recordTiming, Settings } from "../stats/storage";

const GRADUATION_STEP = 5; // Koch characters added per level-up
const WORDS_PER_CHAR = 5; // correct words per active char to graduate
const MIN_WORD_LEN = 2;
const MAX_WORD_LEN = 7; // cap length to keep the game moving
const LEAD_IN_MS = 300; // inaudible primer window before a word so the first symbol isn't clipped
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
  missed: string[];
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
    missed: [],
  };
}

export class WordWranglerMode {
  private root: HTMLElement;
  private settings: Settings;
  private engine: MorseEngine;

  private dictionary: string[] = [];
  private pool: string[] = [];
  private ready = false;

  private running = false;
  private evaluating = false;
  private playing = false;
  private current = "";
  private lastWord = "";
  private session: SessionStats = freshSession();

  // Recognition-latency capture for the current word attempt — invisible to the
  // player, feeds the decaying per-character difficulty score (see submit()).
  private charEndTimes: number[] = []; // charEndTimes[i] = wall-clock time character i's sound finished
  private keystrokeTimes: number[] = []; // keystrokeTimes[i] = wall-clock time the i-th letter was typed
  private timingReliable = false; // false once an edit (backspace/paste) or a tab-hide happens mid-attempt
  private sessionStartTime = 0;
  private onVisibilityChange = (): void => {
    if (document.hidden && this.running) this.timingReliable = false;
  };

  // element refs
  private elDisplaySub!: HTMLElement;
  private elInput!: HTMLInputElement;
  private elScore!: HTMLElement;
  private elAccuracy!: HTMLElement;
  private elStreak!: HTMLElement;
  private elBest!: HTMLElement;
  private elLevel!: HTMLElement;
  private elProgress!: HTMLElement;
  private elProgressBar!: HTMLElement;
  private elPoolInfo!: HTMLElement;
  private elStartBtn!: HTMLButtonElement;
  private elReplayBtn!: HTMLButtonElement;
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
    return this.activeChars.length * WORDS_PER_CHAR;
  }

  mount(): void {
    this.root.innerHTML = "";
    this.root.appendChild(this.buildSettingsPanel());
    this.root.appendChild(this.buildHud());
    this.root.appendChild(this.buildStage());
    this.root.appendChild(this.buildControls());
    this.refreshHud();
    void this.loadDictionary();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  unmount(): void {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private async loadDictionary(): Promise<void> {
    this.ready = false;
    this.elDisplaySub.textContent = "Loading words…";
    this.elStartBtn.disabled = true;
    this.dictionary = await loadWordList(this.settings.wordListId);
    this.ready = true;
    this.rebuildPool();
    this.elStartBtn.disabled = false;
    this.elDisplaySub.textContent = "Press Start, then type the word you hear";
  }

  // ---- DOM construction ---------------------------------------------------

  private buildSettingsPanel(): HTMLElement {
    const panel = el("section", "settings");

    const charWpm = this.numberField("Character speed (WPM)", this.settings.charWpm, 10, 40, (v) => {
      this.settings.charWpm = v;
      if (this.settings.effectiveWpm > v) this.settings.effectiveWpm = v;
      this.applySettings();
    });
    const effWpm = this.numberField("Effective / Farnsworth (WPM)", this.settings.effectiveWpm, 5, 40, (v) => {
      this.settings.effectiveWpm = Math.min(v, this.settings.charWpm);
      this.applySettings();
    });
    const freq = this.numberField("Tone (Hz)", this.settings.frequencyHz, 400, 1000, (v) => {
      this.settings.frequencyHz = v;
      this.applySettings();
    });

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
      this.rebuildPool();
    });
    this.elKochSlider = slider;
    this.elKochLabel = levelView;
    levelWrap.appendChild(slider);
    levelWrap.appendChild(levelView);

    const listWrap = el("label", "field");
    listWrap.appendChild(text("span", "field-label", "Word list"));
    const listSelect = document.createElement("select");
    for (const opt of WORD_LISTS) {
      const option = document.createElement("option");
      option.value = opt.id;
      option.textContent = opt.label;
      if (opt.id === this.settings.wordListId) option.selected = true;
      listSelect.appendChild(option);
    }
    listSelect.addEventListener("change", () => {
      this.settings.wordListId = listSelect.value;
      saveSettings(this.settings);
      if (this.running) this.stop();
      void this.loadDictionary();
    });
    listWrap.appendChild(listSelect);

    panel.append(charWpm, effWpm, freq, levelWrap, listWrap);
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
    this.elDisplaySub = el("div", "display-sub");
    this.elDisplaySub.textContent = "Loading…";

    this.elInput = document.createElement("input");
    this.elInput.type = "text";
    this.elInput.className = "answer-input";
    this.elInput.autocomplete = "off";
    this.elInput.autocapitalize = "characters";
    this.elInput.spellcheck = false;
    this.elInput.placeholder = "type the word…";
    this.elInput.disabled = true;
    this.elInput.addEventListener("keydown", this.onInputKey);
    this.elInput.addEventListener("input", this.onInputChange);

    const progressWrap = el("div", "progress");
    this.elProgressBar = el("div", "progress-bar");
    progressWrap.appendChild(this.elProgressBar);
    this.elProgress = el("div", "progress-label");
    this.elPoolInfo = text("div", "pool-info", "");

    stage.append(this.elDisplaySub, this.elInput, progressWrap, this.elProgress, this.elPoolInfo);
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

    this.elReplayBtn = document.createElement("button");
    this.elReplayBtn.className = "btn";
    this.elReplayBtn.textContent = "⏪ Replay";
    this.elReplayBtn.disabled = true;
    this.elReplayBtn.addEventListener("click", () => this.replay());

    const hint = text(
      "p",
      "hint",
      "Enter = submit · Space / empty Enter / Replay = hear it again · Esc = end session"
    );

    bar.append(this.elStartBtn, this.elReplayBtn, hint);
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

  private rebuildPool(): void {
    if (!this.ready) return;
    this.pool = formableWords(this.dictionary, this.activeChars, MIN_WORD_LEN, MAX_WORD_LEN);
    this.elPoolInfo.textContent = `${this.pool.length} words formable at this level (≤${MAX_WORD_LEN} letters)`;
  }

  private async start(): Promise<void> {
    if (!this.ready) return;
    this.rebuildPool();
    if (this.pool.length === 0) {
      this.elDisplaySub.textContent = "No words at this level — raise the Koch level.";
      return;
    }
    await this.engine.resume();
    this.session = freshSession();
    this.lastWord = "";
    this.sessionStartTime = performance.now();
    this.running = true;
    this.elStartBtn.textContent = "⏹ Stop";
    this.elReplayBtn.disabled = false;
    this.elInput.disabled = false;
    this.refreshHud();
    void this.nextWord();
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.evaluating = false;
    this.playing = false;
    this.engine.stop();
    this.elReplayBtn.disabled = true;
    this.elInput.disabled = true;
    this.elInput.value = "";
    this.elStartBtn.textContent = "▶ Start";
    this.showSummary();
  }

  /** Mostly weights toward words containing weak characters (per-character decaying
   *  difficulty score from recognition latency + wrongness — see recordTiming()), but
   *  a fixed fraction of picks stay pure-random so biasing stays quiet rather than
   *  becoming a repetitive grind on the same few letters. */
  private pick(): string {
    let candidates = this.pool;
    if (this.lastWord && this.pool.length > 1) {
      candidates = this.pool.filter((w) => w !== this.lastWord);
    }
    if (Math.random() < RANDOM_PICK_FLOOR) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    const stats = loadCharStats();
    const weights = candidates.map((w) => {
      let weight = 1;
      for (const ch of w) weight += stats[ch]?.difficulty ?? 0;
      return weight;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1]; // float-rounding fallback
  }

  private async nextWord(): Promise<void> {
    if (!this.running) return;
    this.current = this.pick();
    this.lastWord = this.current;
    this.evaluating = false;
    this.elInput.value = "";
    this.elInput.className = "answer-input";
    this.elInput.disabled = false;
    this.elInput.focus();
    this.elDisplaySub.textContent = "♪ Listening… (type as you go)";
    this.charEndTimes = [];
    this.keystrokeTimes = [];
    this.timingReliable = true; // reset each word; only an event (edit, tab-hide, replay) knocks this false
    await this.playCurrent();
  }

  /**
   * Play the current word, gated so it can't overlap itself. A short lead-in
   * keeps the audio device awake before the first symbol so it isn't clipped,
   * and the Replay control is disabled for the duration.
   */
  private async playCurrent(): Promise<void> {
    if (!this.current || this.playing) return;
    this.playing = true;
    this.elReplayBtn.disabled = true;
    try {
      // Inaudible primer (not a silent wait) so a parked output endpoint
      // finishes re-acquiring before the first symbol instead of clipping it.
      await this.engine.primeOutput(LEAD_IN_MS);
      if (!this.running) return;
      await this.engine.playString(this.current, {
        onCharStart: (char, index) => {
          const pattern = MORSE[char.toUpperCase()];
          if (!pattern) return;
          this.charEndTimes[index] = performance.now() + charDurationMs(pattern, this.engine.timing);
        },
      });
    } finally {
      this.playing = false;
      if (this.running) this.elReplayBtn.disabled = false;
    }
  }

  private onInputKey = (e: KeyboardEvent): void => {
    if (!this.running) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.stop();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.submit();
      return;
    }
    if (e.key === " " || e.code === "Space") {
      // Space never belongs in a word — repurpose it as "play it again",
      // keeping whatever letters have been typed so far.
      e.preventDefault();
      this.replay();
    }
  };

  /** Recognition-latency capture: a keystroke that grows the input by exactly one
   *  character is timestamped at its position. Any other edit (backspace, paste) means
   *  position-correlation with charEndTimes is no longer meaningful, so the whole
   *  attempt's timing data is dropped — scoring/streak are unaffected either way. */
  private onInputChange = (): void => {
    const len = this.elInput.value.length;
    if (len === this.keystrokeTimes.length + 1) {
      this.keystrokeTimes.push(performance.now());
    } else if (len !== this.keystrokeTimes.length) {
      this.timingReliable = false;
    }
  };

  private replay(): void {
    if (!this.running || !this.current || this.playing) return;
    this.session.replays += 1;
    // A replay restarts the audio schedule but keeps already-typed letters, so any
    // keystroke timestamps already captured no longer line up with the new
    // charEndTimes schedule about to be recorded — drop this attempt's timing data.
    this.timingReliable = false;
    this.elInput.focus();
    void this.playCurrent();
  }

  private submit(): void {
    if (!this.running || this.evaluating) return;
    const guess = this.elInput.value.trim().toUpperCase();
    if (guess === "") {
      this.replay(); // empty submit = hear it again
      return;
    }
    this.evaluating = true;
    const correct = guess === this.current;
    this.session.attempts += 1;

    // Fold per-character recognition latency into the decaying difficulty score, if
    // this attempt's timing data is still trustworthy (no edits, no tab-hide, no
    // mid-attempt replay) and the session has settled in past its warm-up window
    // (checked fresh here, not cached at word start, so a long pause before typing
    // still crosses the threshold correctly). Purely a background signal — never
    // shown to the player.
    if (this.timingReliable && performance.now() - this.sessionStartTime >= WARMUP_MS) {
      const n = Math.min(this.charEndTimes.length, this.keystrokeTimes.length, this.current.length);
      for (let i = 0; i < n; i++) {
        recordTiming(this.current[i], guess[i] === this.current[i], this.keystrokeTimes[i] - this.charEndTimes[i]);
      }
    }

    if (correct) {
      this.session.score += 1;
      this.session.correct += 1;
      this.session.streak += 1;
      this.session.bestStreak = Math.max(this.session.bestStreak, this.session.streak);
      this.session.correctAtLevel += 1;
      this.elInput.className = "answer-input correct";
      this.elDisplaySub.textContent = "✓";
      this.refreshHud();
      if ([10, 25, 50, 100].includes(this.session.streak)) {
        this.elDisplaySub.textContent = `🔥 ${this.session.streak} streak!`;
      }
      window.setTimeout(() => {
        if (!this.running) return;
        if (this.session.correctAtLevel >= this.threshold) this.offerGraduation();
        else void this.nextWord();
      }, 220);
    } else {
      this.session.streak = 0;
      if (!this.session.missed.includes(this.current)) this.session.missed.push(this.current);
      this.engine.playError();
      this.elInput.className = "answer-input wrong";
      this.elDisplaySub.textContent = `✗ ${this.current}`;
      this.refreshHud();
      window.setTimeout(() => {
        if (!this.running) return;
        void this.nextWord();
      }, 800);
    }
  }

  // ---- Graduation & summary ----------------------------------------------

  private offerGraduation(): void {
    const atMax = this.settings.kochLevel >= KOCH_ORDER.length;
    const nextLevel = Math.min(this.settings.kochLevel + GRADUATION_STEP, KOCH_ORDER.length);
    const newChars = KOCH_ORDER.slice(this.settings.kochLevel, nextLevel);

    const body = atMax
      ? `You've mastered words across all ${KOCH_ORDER.length} characters — outstanding!`
      : `You've wrangled ${this.threshold} words at ${this.activeChars.length} characters!\n\n` +
        `Graduate to ${nextLevel} characters? New: ${newChars.join(" ")}`;

    const modal = new Modal("🎉 Congratulations!", body);
    if (!atMax) {
      modal.addButton("Graduate", "primary", () => {
        modal.close();
        this.settings.kochLevel = nextLevel;
        saveSettings(this.settings);
        this.syncKochControl();
        this.rebuildPool();
        this.session = freshSession();
        this.lastWord = "";
        this.refreshHud();
        void this.nextWord();
      });
    }
    modal.addButton(atMax ? "Keep going" : "Stay at this level", "", () => {
      modal.close();
      this.session.correctAtLevel = 0;
      this.refreshHud();
      void this.nextWord();
    });
    modal.open();
  }

  private syncKochControl(): void {
    if (this.elKochSlider) this.elKochSlider.value = String(this.settings.kochLevel);
    if (this.elKochLabel) this.elKochLabel.textContent = this.kochLevelLabel();
  }

  private showSummary(): void {
    const s = this.session;
    const acc = s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0;
    const modal = new Modal("Session summary", "");
    const body = el("div", "summary");
    body.appendChild(summaryRow("Score", String(s.score)));
    body.appendChild(summaryRow("Accuracy", `${acc}%  (${s.correct}/${s.attempts})`));
    body.appendChild(summaryRow("Best streak", String(s.bestStreak)));
    body.appendChild(summaryRow("Replays used", String(s.replays)));

    if (s.missed.length) {
      const wrap = el("div", "heatmap");
      wrap.appendChild(text("div", "heatmap-title", "Words that got away"));
      const list = el("div", "missed-words");
      list.textContent = s.missed.join("  ·  ");
      wrap.appendChild(list);
      body.appendChild(wrap);
    }

    modal.setBodyNode(body);
    modal.addButton("Close", "primary", () => modal.close());
    modal.open();
  }

  // ---- HUD ----------------------------------------------------------------

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
    this.elProgress.textContent = `${s.correctAtLevel} / ${this.threshold} words to next level`;
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
