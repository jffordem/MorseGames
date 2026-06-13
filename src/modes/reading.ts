// Reading mode: passive code practice. Play a public-domain work (or your own
// pasted text) as Morse at the chosen speed, optionally showing the text as it
// is sent. Resume where you left off.

import { MorseEngine } from "../audio/morse-engine";
import { WORKS, CORPORA, findCorpus, normalizeText, Chunk, Corpus, Work } from "../data/texts";
import {
  loadSettings,
  saveSettings,
  loadReadingPrefs,
  saveReadingPrefs,
  Settings,
  ReadingPrefs,
  DisplayMode,
  StartMode,
} from "../stats/storage";

const CUSTOM_ID = "__custom__";
const RANDOM_ID = "__random__";
const CORPUS_PREFIX = "corpus:";

const isCorpusSel = (v: string): boolean => v.startsWith(CORPUS_PREFIX);
const corpusIdOf = (v: string): string => v.slice(CORPUS_PREFIX.length);

/** Pause between fables when a corpus auto-advances, for an audiobook rhythm. */
const INTER_CHUNK_PAUSE_MS = 800;

export class ReadingMode {
  private root: HTMLElement;
  private settings: Settings;
  private prefs: ReadingPrefs;
  private engine: MorseEngine;

  private text = "";
  private workId = "";
  private index = 0;
  private playing = false;
  private paused = false;
  private cancelled = false;
  private spans: HTMLElement[] = [];

  // Corpus playback state (null when a single work / pasted text is selected).
  private corpus: Corpus | null = null;
  private chunkIndex = 0;
  private autoNextTimer: number | null = null;

  // element refs
  private elWorkSelect!: HTMLSelectElement;
  private elDisplayMode!: HTMLSelectElement;
  private elStartMode!: HTMLSelectElement;
  private elCustom!: HTMLTextAreaElement;
  private elCustomWrap!: HTMLElement;
  private elTextBox!: HTMLElement;
  private elProgressBar!: HTMLElement;
  private elProgressLabel!: HTMLElement;
  private elPlayPauseBtn!: HTMLButtonElement;
  private elResetBtn!: HTMLButtonElement;
  private elNextBtn!: HTMLButtonElement;
  private elChunkLabel!: HTMLElement;
  private lastSel = "";

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === " " || e.code === "Space") {
      // Don't hijack space while focused in a control (textarea, button, etc.).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault();
      this.togglePlayPause();
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.prefs = loadReadingPrefs();
    this.engine = new MorseEngine({
      charWpm: this.settings.charWpm,
      effectiveWpm: this.settings.effectiveWpm,
      frequencyHz: this.settings.frequencyHz,
    });
  }

  mount(): void {
    this.root.innerHTML = "";
    this.root.appendChild(this.buildSettings());
    this.root.appendChild(this.buildControls());
    this.root.appendChild(this.buildStage());
    this.loadWork(true);
    this.updateButtons();
    document.addEventListener("keydown", this.onKeyDown);
  }

  unmount(): void {
    this.clearAutoNext();
    this.cancelled = true;
    this.playing = false;
    this.saveBookmark(this.index);
    this.engine.stop();
    document.removeEventListener("keydown", this.onKeyDown);
  }

  // ---- DOM ---------------------------------------------------------------

  private buildSettings(): HTMLElement {
    const panel = el("section", "settings");

    // Work selector
    const workWrap = el("label", "field");
    workWrap.appendChild(text("span", "field-label", "Work"));
    this.elWorkSelect = document.createElement("select");
    for (const w of WORKS) {
      this.elWorkSelect.appendChild(option(w.id, `${w.title} — ${w.author}`));
    }
    for (const c of CORPORA) {
      this.elWorkSelect.appendChild(
        option(`${CORPUS_PREFIX}${c.id}`, `📚 ${c.title} (${c.chunks.length} passages)`)
      );
    }
    this.elWorkSelect.appendChild(option(RANDOM_ID, "🎲 Random work"));
    this.elWorkSelect.appendChild(option(CUSTOM_ID, "✏️ Paste your own…"));
    this.elWorkSelect.value = this.prefs.lastWorkId;
    this.elWorkSelect.addEventListener("change", () => {
      this.prefs.lastWorkId = this.elWorkSelect.value;
      saveReadingPrefs(this.prefs);
      this.updateCustomVisibility();
      this.clearAutoNext();
      this.cancelPlayback();
      this.loadWork(true);
      this.updateButtons();
    });
    workWrap.appendChild(this.elWorkSelect);

    // Display mode
    const dispWrap = el("label", "field");
    dispWrap.appendChild(text("span", "field-label", "Show text"));
    this.elDisplayMode = document.createElement("select");
    this.elDisplayMode.appendChild(option("hidden", "Hidden (pure listening)"));
    this.elDisplayMode.appendChild(option("read-along", "Read-along (highlight as sent)"));
    this.elDisplayMode.appendChild(option("reveal", "Reveal (appears as sent)"));
    this.elDisplayMode.value = this.prefs.displayMode;
    this.elDisplayMode.addEventListener("change", () => {
      this.prefs.displayMode = this.elDisplayMode.value as DisplayMode;
      saveReadingPrefs(this.prefs);
      if (!this.playing && this.text) this.renderText(this.prefs.displayMode, this.index);
    });
    dispWrap.appendChild(this.elDisplayMode);

    // Start position
    const startWrap = el("label", "field");
    startWrap.appendChild(text("span", "field-label", "Start from"));
    this.elStartMode = document.createElement("select");
    this.elStartMode.appendChild(option("beginning", "Beginning"));
    this.elStartMode.appendChild(option("resume", "Where I left off"));
    this.elStartMode.appendChild(option("random", "Random spot"));
    this.elStartMode.value = this.prefs.startMode;
    this.elStartMode.addEventListener("change", () => {
      this.prefs.startMode = this.elStartMode.value as StartMode;
      saveReadingPrefs(this.prefs);
      if (!this.playing && this.text) {
        this.index = this.startIndex();
        this.renderText(this.prefs.displayMode, this.index);
        this.updateProgress();
        this.updateButtons();
      }
    });
    startWrap.appendChild(this.elStartMode);

    // Speeds + tone
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

    panel.append(charWpm, effWpm, freq, workWrap, dispWrap, startWrap);

    // Paste-your-own textarea (hidden unless selected)
    this.elCustomWrap = el("div", "field custom-text");
    this.elCustomWrap.appendChild(text("span", "field-label", "Your text"));
    this.elCustom = document.createElement("textarea");
    this.elCustom.rows = 4;
    this.elCustom.placeholder = "Paste any text to hear it sent as Morse…";
    this.elCustomWrap.appendChild(this.elCustom);
    panel.appendChild(this.elCustomWrap);
    this.updateCustomVisibility();

    return panel;
  }

  /** Show + enable the paste box only when "Paste your own" is selected. */
  private updateCustomVisibility(): void {
    const show = this.elWorkSelect.value === CUSTOM_ID;
    this.elCustomWrap.style.display = show ? "flex" : "none";
    this.elCustom.disabled = !show;
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

  private buildControls(): HTMLElement {
    const bar = el("section", "controls");
    this.elPlayPauseBtn = button("▶ Play", "btn primary", () => this.togglePlayPause());
    this.elResetBtn = button("↺ Reset", "btn", () => this.reset());
    this.elNextBtn = button("⏭ Next", "btn", () => this.nextChunk());
    bar.append(this.elPlayPauseBtn, this.elResetBtn, this.elNextBtn);
    bar.append(
      text("p", "hint", "Spacebar = play/pause · Reset rewinds · Next skips to the next passage")
    );
    return bar;
  }

  private buildStage(): HTMLElement {
    const stage = el("section", "stage reading-stage");

    const progressWrap = el("div", "progress");
    this.elProgressBar = el("div", "progress-bar");
    progressWrap.appendChild(this.elProgressBar);
    this.elProgressLabel = text("div", "progress-label", "Ready");
    this.elChunkLabel = text("div", "chunk-label", "");
    this.elChunkLabel.hidden = true;

    this.elTextBox = el("div", "reading-text");
    this.elTextBox.textContent = "Choose a work and press Play.";

    stage.append(progressWrap, this.elProgressLabel, this.elChunkLabel, this.elTextBox);
    return stage;
  }

  // ---- Playback ----------------------------------------------------------

  private applySettings(): void {
    this.engine.settings = {
      charWpm: this.settings.charWpm,
      effectiveWpm: this.settings.effectiveWpm,
      frequencyHz: this.settings.frequencyHz,
    };
    saveSettings(this.settings);
  }

  private resolveWork(): Work | null {
    const sel = this.elWorkSelect.value;
    if (sel === CUSTOM_ID) {
      const raw = this.elCustom.value.trim();
      if (!raw) return null;
      return { id: CUSTOM_ID, title: "Pasted text", author: "you", text: raw };
    }
    if (sel === RANDOM_ID) {
      return WORKS[Math.floor(Math.random() * WORKS.length)];
    }
    return WORKS.find((w) => w.id === sel) ?? WORKS[0];
  }

  /** Resolve the selected work into a sendable string and render its ready state. */
  private loadWork(resetHead: boolean): void {
    this.lastSel = this.elWorkSelect.value;

    if (isCorpusSel(this.lastSel)) {
      this.loadCorpus(resetHead);
      return;
    }
    this.corpus = null;
    this.updateChunkLabel(null);

    const work = this.resolveWork();
    if (!work) {
      this.text = "";
      this.workId = this.elWorkSelect.value;
      this.spans = [];
      this.elTextBox.innerHTML = "";
      this.elTextBox.hidden = false;
      this.elTextBox.textContent = "Paste some text above, then press Play.";
      this.elProgressBar.style.width = "0%";
      this.elProgressLabel.textContent = "Ready";
      return;
    }
    this.workId = work.id;
    this.text = normalizeText(work.text);
    if (!this.text) {
      this.elTextBox.textContent = "Nothing sendable in that text.";
      return;
    }
    if (resetHead) this.index = this.startIndex();
    if (this.index >= this.text.length) this.index = 0;
    this.renderText(this.prefs.displayMode, this.index);
    this.updateProgress();
  }

  // ---- Corpus (collection of short, complete passages) -------------------

  /** Resolve the selected corpus + current chunk into a ready playback state. */
  private loadCorpus(resetHead: boolean): void {
    const corpus = findCorpus(corpusIdOf(this.lastSel));
    if (!corpus || corpus.chunks.length === 0) {
      this.corpus = null;
      this.text = "";
      this.updateChunkLabel(null);
      this.elTextBox.textContent = "This collection is empty.";
      this.elProgressBar.style.width = "0%";
      this.elProgressLabel.textContent = "Ready";
      return;
    }
    this.corpus = corpus;
    if (resetHead) this.chunkIndex = this.chooseChunkIndex(corpus);
    if (this.chunkIndex < 0 || this.chunkIndex >= corpus.chunks.length) this.chunkIndex = 0;

    const chunk = corpus.chunks[this.chunkIndex];
    this.workId = `${corpus.id}:${chunk.id}`;
    this.text = normalizeText(chunk.text);
    this.saveCorpusPos();
    if (resetHead) this.index = this.startIndex();
    if (this.index >= this.text.length) this.index = 0;
    this.renderText(this.prefs.displayMode, this.index);
    this.updateChunkLabel(chunk);
    this.updateProgress();
  }

  /** Which chunk to open when (re)entering a corpus, per the Start-from mode. */
  private chooseChunkIndex(corpus: Corpus): number {
    switch (this.prefs.startMode) {
      case "beginning":
        return 0;
      case "random":
        return Math.floor(Math.random() * corpus.chunks.length);
      case "resume":
      default:
        return this.prefs.corpusChunk[corpus.id] ?? 0;
    }
  }

  /** Skip to the next passage and play it (random when Start-from = random). */
  private nextChunk(): void {
    if (!this.corpus) return;
    this.clearAutoNext();
    this.cancelPlayback();
    const n = this.corpus.chunks.length;
    this.chunkIndex =
      this.prefs.startMode === "random"
        ? Math.floor(Math.random() * n)
        : (this.chunkIndex + 1) % n;
    this.index = 0;
    this.loadCorpus(false); // keep the chunk we just chose; render at its start
    void this.play();
  }

  private saveCorpusPos(): void {
    if (!this.corpus) return;
    this.prefs.corpusChunk[this.corpus.id] = this.chunkIndex;
    saveReadingPrefs(this.prefs);
  }

  private updateChunkLabel(chunk: Chunk | null): void {
    if (!chunk || !this.corpus) {
      this.elChunkLabel.hidden = true;
      this.elChunkLabel.textContent = "";
      return;
    }
    this.elChunkLabel.hidden = false;
    this.elChunkLabel.textContent =
      `${chunk.title} — ${this.chunkIndex + 1}/${this.corpus.chunks.length}`;
  }

  private clearAutoNext(): void {
    if (this.autoNextTimer !== null) {
      window.clearTimeout(this.autoNextTimer);
      this.autoNextTimer = null;
    }
  }

  /** Stop any in-flight playback without rewinding or saving. */
  private cancelPlayback(): void {
    if (this.playing) {
      this.cancelled = true;
      this.engine.stop();
      this.playing = false;
      this.paused = false;
    }
  }

  private async play(): Promise<void> {
    if (this.playing) return;
    // (Re)load if nothing is loaded, the selection changed, or it's pasted text
    // (so edits get picked up).
    if (this.text === "" || this.elWorkSelect.value !== this.lastSel || this.workId === CUSTOM_ID) {
      this.loadWork(true);
    }
    if (this.text === "") {
      this.elProgressLabel.textContent = "Paste some text first.";
      return;
    }
    await this.engine.resume();
    if (this.index >= this.text.length) this.index = 0; // at end → replay from start

    const mode = this.prefs.displayMode;
    this.renderText(mode, this.index);

    this.playing = true;
    this.paused = false;
    this.cancelled = false;
    this.updateButtons();

    await this.engine.playString(this.text, {
      startIndex: this.index,
      isPaused: () => this.paused,
      isCancelled: () => this.cancelled,
      onCharStart: (_ch, i) => this.onCharStart(mode, i),
      onDone: () => this.onDone(),
    });
  }

  private startIndex(): number {
    // For a corpus, "random" picks a whole fable (in chooseChunkIndex), so each
    // chosen passage still starts at its beginning. Only "resume" restores a
    // mid-passage character offset.
    if (this.corpus) {
      if (this.prefs.startMode === "resume") {
        const bm = this.prefs.bookmarks[this.workId] ?? 0;
        return bm < this.text.length ? bm : 0;
      }
      return 0;
    }
    switch (this.prefs.startMode) {
      case "beginning":
        return 0;
      case "random": {
        // Snap to a word boundary so we don't start mid-character.
        const at = Math.floor(Math.random() * this.text.length * 0.8);
        const sp = this.text.indexOf(" ", at);
        return sp >= 0 ? sp + 1 : 0;
      }
      case "resume":
      default: {
        const bm = this.prefs.bookmarks[this.workId] ?? 0;
        return bm < this.text.length ? bm : 0;
      }
    }
  }

  private renderText(mode: DisplayMode, from: number): void {
    this.elTextBox.innerHTML = "";
    this.spans = [];
    this.elTextBox.hidden = mode === "hidden";

    if (mode === "reveal") {
      // Characters are appended as they play; nothing shown ahead.
      return;
    }
    // read-along (and hidden, kept ready to reveal on stop): pre-render spans.
    for (let i = 0; i < this.text.length; i++) {
      const span = document.createElement("span");
      span.textContent = this.text[i];
      if (i < from) span.className = "done";
      this.spans.push(span);
      this.elTextBox.appendChild(span);
    }
  }

  private onCharStart(mode: DisplayMode, i: number): void {
    if (this.cancelled || !this.playing) return;
    this.index = i;
    this.updateProgress();

    if (mode === "hidden") return;

    if (mode === "reveal") {
      const prev = this.elTextBox.querySelector(".active");
      prev?.classList.replace("active", "done");
      const span = document.createElement("span");
      span.textContent = this.text[i];
      span.className = "active";
      this.elTextBox.appendChild(span);
      this.elTextBox.scrollTop = this.elTextBox.scrollHeight;
      return;
    }

    // read-along
    for (let j = 0; j < i; j++) this.spans[j]?.classList.add("done");
    this.spans[i]?.classList.remove("done");
    this.spans[i]?.classList.add("active");
    if (i > 0) this.spans[i - 1]?.classList.remove("active");
    this.spans[i]?.scrollIntoView({ block: "nearest" });
  }

  private updateProgress(): void {
    const pct = this.text.length ? Math.round((this.index / this.text.length) * 100) : 0;
    this.elProgressBar.style.width = `${pct}%`;
    const wordsDone = this.text.slice(0, this.index).split(" ").length;
    const wordsTotal = this.text.split(" ").length;
    const passage = this.corpus ? `passage ${this.chunkIndex + 1}/${this.corpus.chunks.length} · ` : "";
    this.elProgressLabel.textContent = `${passage}${pct}% · ~word ${wordsDone}/${wordsTotal}`;
  }

  private togglePlayPause(): void {
    if (this.playing) {
      this.paused = !this.paused;
      if (this.paused) this.saveBookmark(this.index);
      this.updateButtons();
    } else {
      this.clearAutoNext();
      void this.play();
    }
  }

  /** Stop playback and rewind to the beginning of the current passage. */
  private reset(): void {
    this.clearAutoNext();
    this.cancelled = true;
    this.engine.stop();
    this.playing = false;
    this.paused = false;
    this.index = 0;
    this.saveBookmark(0);
    if (this.text) this.renderText(this.prefs.displayMode, 0);
    this.elProgressBar.style.width = "0%";
    this.updateProgress();
    this.updateButtons();
  }

  private onDone(): void {
    this.playing = false;
    this.paused = false;
    this.index = this.text.length;
    this.saveBookmark(0); // finished — next resume starts over

    // In a corpus, roll straight into the next passage after a short beat —
    // an "audiobook of fables." A single work just finishes.
    if (this.corpus) {
      this.elProgressBar.style.width = "100%";
      this.elProgressLabel.textContent = "Next passage…";
      this.updateButtons();
      this.autoNextTimer = window.setTimeout(() => {
        this.autoNextTimer = null;
        this.nextChunk();
      }, INTER_CHUNK_PAUSE_MS);
      return;
    }

    // Reveal the whole text so you can check your copy.
    if (this.prefs.displayMode !== "read-along") {
      this.renderText("read-along", this.text.length);
      this.elTextBox.hidden = false;
    }
    this.elProgressBar.style.width = "100%";
    this.elProgressLabel.textContent = "Finished 🎉";
    this.updateButtons();
  }

  private saveBookmark(at: number): void {
    if (this.workId === CUSTOM_ID) return; // don't bookmark pasted text
    this.prefs.bookmarks[this.workId] = at;
    saveReadingPrefs(this.prefs);
  }

  private updateButtons(): void {
    this.elPlayPauseBtn.textContent =
      this.playing && !this.paused ? "⏸ Pause" : this.paused ? "▶ Resume" : "▶ Play";
    this.elResetBtn.disabled = !this.playing && this.index === 0;
    this.elNextBtn.hidden = !this.corpus;
  }
}

// ---- DOM utilities --------------------------------------------------------

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
function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}
function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
