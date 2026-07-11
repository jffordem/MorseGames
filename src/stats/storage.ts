// Persistence for user settings and cumulative per-character stats (localStorage).

export interface Settings {
  charWpm: number;
  effectiveWpm: number;
  frequencyHz: number;
  /** Number of active Koch characters (the current level). */
  kochLevel: number;
  /** Word Wrangler word-list choice (id from WORD_LISTS). */
  wordListId: string;
}

export interface CharStat {
  attempts: number;
  correct: number;
  /** Decaying EWMA "problem score" — wrongness plus normalized recognition latency,
   *  roughly 0 (instant + correct) to 2 (wrong + maxed-out slow). Only populated by
   *  modes that track timing (Word Wrangler, via recordTiming()) — undefined otherwise.
   *  Higher means more practice needed; drives Word Wrangler's word-selection bias. */
  difficulty?: number;
}

/** Cumulative attempts/correct (+ optional decaying difficulty) per character, across
 *  all sessions. */
export type CharStats = Record<string, CharStat>;

const SETTINGS_KEY = "morse-games.settings";
const STATS_KEY = "morse-games.charStats";
const LATENCY_CAP_MS = 2500; // real lookup delays top out well under this; caps outlier damage from undetectable distraction
const DIFFICULTY_EWMA_ALPHA = 0.25; // recent samples weigh more — matches the "self-heals" decaying-score design intent

export const DEFAULT_SETTINGS: Settings = {
  charWpm: 20,
  effectiveWpm: 10,
  frequencyHz: 600,
  kochLevel: 5,
  wordListId: "full",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota/availability errors */
  }
}

export function loadCharStats(): CharStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? (JSON.parse(raw) as CharStats) : {};
  } catch {
    return {};
  }
}

// ---- Reading mode preferences & bookmarks ---------------------------------

export type DisplayMode = "hidden" | "read-along" | "reveal";
export type StartMode = "beginning" | "resume" | "random";

export interface ReadingPrefs {
  displayMode: DisplayMode;
  startMode: StartMode;
  lastWorkId: string;
  /** Resume position (character index) per work id. */
  bookmarks: Record<string, number>;
  /** Last chunk index played, per corpus id (for resume within a collection). */
  corpusChunk: Record<string, number>;
}

const READING_KEY = "morse-games.reading";

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  displayMode: "hidden",
  startMode: "resume",
  lastWorkId: "gettysburg",
  bookmarks: {},
  corpusChunk: {},
};

export function loadReadingPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(READING_KEY);
    if (!raw) return { ...DEFAULT_READING_PREFS };
    return { ...DEFAULT_READING_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_READING_PREFS };
  }
}

export function saveReadingPrefs(p: ReadingPrefs): void {
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function recordResult(char: string, correct: boolean): void {
  const stats = loadCharStats();
  const entry = stats[char] ?? { attempts: 0, correct: 0 };
  entry.attempts += 1;
  if (correct) entry.correct += 1;
  stats[char] = entry;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

/** Like recordResult(), but also folds recognition latency (ms between a character's
 *  sound ending and the corresponding keystroke, right or wrong) into a decaying
 *  difficulty score used to bias word selection. See Word Wrangler's timing capture
 *  for how latencyMs is measured. */
export function recordTiming(char: string, correct: boolean, latencyMs: number): void {
  const stats = loadCharStats();
  const entry = stats[char] ?? { attempts: 0, correct: 0 };
  entry.attempts += 1;
  if (correct) entry.correct += 1;
  const ratio = Math.min(Math.max(latencyMs, 0), LATENCY_CAP_MS) / LATENCY_CAP_MS;
  const sample = (correct ? 0 : 1) + ratio;
  entry.difficulty = DIFFICULTY_EWMA_ALPHA * sample + (1 - DIFFICULTY_EWMA_ALPHA) * (entry.difficulty ?? sample);
  stats[char] = entry;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}
