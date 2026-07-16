// Word source for Word Wrangler.
//
// At runtime we try to fetch a large `words.txt` (one word per line) served as
// a static asset — drop a SCRABBLE/ENABLE-style dictionary at `public/words.txt`
// to unlock the full list. If it isn't present we fall back to the bundled
// common-word list below so the mode always works.

/** Bundled fallback: common English words (2–8 letters). Uppercased on load. */
export const FALLBACK_WORDS: string[] = [
  // short, early-Koch friendly
  "eke", "emu", "rue", "rum", "reek", "meek", "mere", "murk", "mum", "ere",
  // a/n/s/p/t era and general common words
  "as", "at", "am", "an", "us", "up", "to", "me", "we", "be", "by", "do", "go",
  "he", "if", "in", "is", "it", "my", "no", "of", "on", "or", "so", "ace", "act",
  "add", "age", "ago", "aid", "aim", "air", "and", "ant", "any", "ape", "apt",
  "arc", "are", "ark", "arm", "art", "ash", "ask", "ate", "awe", "bad", "bag",
  "ban", "bar", "bat", "bay", "bed", "bee", "bet", "big", "bit", "boa", "bog",
  "bow", "box", "boy", "bug", "bun", "bus", "but", "buy", "cab", "can", "cap",
  "car", "cat", "cob", "cod", "cog", "cop", "cot", "cow", "cry", "cub", "cup",
  "cut", "dam", "day", "den", "dew", "did", "dig", "dim", "dip", "dog", "dot",
  "dry", "dub", "due", "dug", "ear", "eat", "egg", "ego", "elf", "elk", "elm",
  "end", "era", "eve", "eye", "fan", "far", "fat", "fed", "fee", "few", "fig",
  "fin", "fir", "fit", "fix", "fly", "fog", "for", "fox", "fry", "fun", "fur",
  "gap", "gas", "gem", "get", "gin", "gnu", "got", "gum", "gun", "gut", "guy",
  "ham", "has", "hat", "hay", "hem", "hen", "her", "hid", "him", "hip", "his",
  "hit", "hoe", "hog", "hop", "hot", "how", "hub", "hue", "hug", "hum", "hut",
  "ice", "ink", "inn", "ion", "irk", "ivy", "jab", "jam", "jar", "jaw", "jay",
  "jet", "job", "jog", "jot", "joy", "jug", "key", "kid", "kin", "kit", "lab",
  "lad", "lag", "lap", "law", "lay", "led", "leg", "let", "lid", "lie", "lip",
  "lit", "log", "lot", "low", "mad", "man", "map", "mat", "may", "men", "met",
  "mix", "mob", "mod", "mom", "mop", "mud", "mug", "nab", "nag", "nap", "net",
  "new", "nip", "nod", "nor", "not", "now", "nub", "nut", "oak", "oar", "odd",
  "off", "oil", "old", "one", "orb", "ore", "our", "out", "owl", "own", "pad",
  "pan", "par", "pat", "paw", "pay", "pea", "peg", "pen", "pet", "pie", "pig",
  "pin", "pit", "ply", "pod", "pop", "pot", "pry", "pub", "pug", "pun", "pup",
  "rag", "ram", "ran", "rap", "rat", "raw", "ray", "red", "rib", "rid", "rig",
  "rim", "rip", "rob", "rod", "rot", "row", "rub", "rug", "run", "rut", "sad",
  "sag", "sap", "sat", "saw", "say", "sea", "see", "set", "sew", "she", "shy",
  "sin", "sip", "sir", "sit", "six", "ski", "sky", "sly", "sob", "son", "sow",
  "soy", "spa", "spy", "sty", "sub", "sue", "sum", "sun", "tab", "tag", "tan",
  "tap", "tar", "tax", "tea", "ten", "the", "tie", "tin", "tip", "toe", "ton",
  "too", "top", "tow", "toy", "try", "tub", "tug", "two", "use", "van", "vat",
  "vet", "via", "vow", "wad", "wag", "war", "was", "wax", "way", "web", "wed",
  "wet", "who", "why", "wig", "win", "wit", "won", "wow", "yak", "yam", "yap",
  "yaw", "yes", "yet", "you", "zap", "zip", "zoo",
  // 4–7 letter common words
  "able", "acid", "aged", "also", "area", "army", "away", "baby", "back", "ball",
  "band", "bank", "base", "bath", "bear", "beat", "been", "beer", "bell", "belt",
  "bird", "blue", "boat", "body", "bone", "book", "born", "boss", "both", "bowl",
  "bulk", "burn", "bush", "busy", "cake", "call", "calm", "came", "camp", "card",
  "care", "case", "cash", "cast", "cell", "city", "club", "coal", "coat", "code",
  "cold", "come", "cook", "cool", "cope", "copy", "core", "corn", "cost", "crew",
  "crop", "dark", "data", "date", "dawn", "days", "dead", "deal", "dear", "debt",
  "deep", "deny", "desk", "dial", "diet", "dirt", "dish", "does", "done", "door",
  "down", "draw", "drew", "drop", "drug", "drum", "dual", "duck", "duke", "dust",
  "duty", "each", "earn", "east", "easy", "edge", "else", "even", "ever", "evil",
  "exit", "face", "fact", "fail", "fair", "fall", "farm", "fast", "fate", "fear",
  "feed", "feel", "feet", "fell", "felt", "file", "fill", "film", "find", "fine",
  "fire", "firm", "fish", "five", "flat", "flow", "food", "foot", "ford", "form",
  "fort", "four", "free", "from", "fuel", "full", "fund", "gain", "game", "gate",
  "gave", "gear", "gift", "girl", "give", "glad", "goal", "goes", "gold", "golf",
  "gone", "good", "gray", "grew", "grow", "hair", "half", "hall", "hand", "hang",
  "hard", "harm", "hate", "have", "head", "hear", "heat", "held", "hell", "help",
  "herb", "here", "hero", "hide", "high", "hill", "hint", "hire", "hold", "hole",
  "holy", "home", "hope", "horn", "host", "hour", "huge", "hung", "hunt", "hurt",
  "idea", "into", "iron", "item", "join", "joke", "jump", "june", "jury", "just",
  "keen", "keep", "kept", "kick", "kill", "kind", "king", "kiss", "knee", "knew",
  "know", "lack", "lady", "laid", "lake", "lamp", "land", "lane", "last", "late",
  "lawn", "lazy", "lead", "leaf", "lean", "left", "lend", "lens", "less", "life",
  "lift", "like", "line", "link", "lion", "list", "live", "load", "loan", "lock",
  "long", "look", "loop", "lord", "lose", "loss", "lost", "loud", "love", "luck",
  "made", "mail", "main", "make", "male", "mall", "many", "mark", "mask", "mass",
  "mate", "meal", "mean", "meat", "meet", "melt", "menu", "mere", "mild", "mile",
  "milk", "mill", "mind", "mine", "miss", "mode", "mood", "moon", "more", "most",
  "move", "much", "must", "name", "navy", "near", "neat", "neck", "need", "news",
  "next", "nice", "nine", "node", "none", "noon", "norm", "nose", "note", "noun",
  "okay", "once", "only", "onto", "open", "oral", "oven", "over", "pace", "pack",
  "page", "paid", "pain", "pair", "palm", "park", "part", "pass", "past", "path",
  "peak", "pear", "peer", "pick", "pile", "pine", "pink", "pipe", "plan", "play",
  "plot", "plus", "poem", "poet", "pole", "poll", "pond", "pool", "poor", "port",
  "post", "pour", "pray", "prep", "prey", "pull", "pump", "pure", "push", "quit",
  "race", "rail", "rain", "rank", "rare", "rate", "read", "real", "rear", "rely",
  "rent", "rest", "rice", "rich", "ride", "ring", "rise", "risk", "road", "roar",
  "rock", "role", "roll", "roof", "room", "root", "rope", "rose", "ruin", "rule",
  "rush", "safe", "said", "sail", "salt", "same", "sand", "save", "seal", "seat",
  "seed", "seek", "seem", "seen", "self", "sell", "send", "ship", "shoe", "shop",
  "shot", "show", "shut", "sick", "side", "sign", "silk", "sing", "sink", "site",
  "size", "skin", "slip", "slow", "snap", "snow", "soap", "sofa", "soft", "soil",
  "sold", "sole", "some", "song", "soon", "sort", "soul", "soup", "spin", "spot",
  "star", "stay", "stem", "step", "stir", "stop", "such", "suit", "sure", "swim",
  "tail", "take", "tale", "talk", "tall", "tank", "tape", "task", "team", "tear",
  "tell", "tend", "tent", "term", "test", "text", "than", "that", "them", "then",
  "they", "thin", "this", "thus", "tide", "tidy", "tile", "time", "tiny", "tire",
  "told", "toll", "tone", "took", "tool", "torn", "tour", "town", "trap", "tree",
  "trim", "trip", "true", "tube", "tune", "turn", "twin", "type", "ugly", "unit",
  "upon", "used", "user", "vary", "vast", "very", "view", "vote", "wage", "wait",
  "wake", "walk", "wall", "want", "ward", "warm", "warn", "wash", "wave", "ways",
  "weak", "wear", "week", "well", "went", "were", "west", "what", "when", "whom",
  "wide", "wife", "wild", "will", "wind", "wine", "wing", "wins", "wipe", "wire",
  "wise", "wish", "with", "wolf", "wood", "wool", "word", "wore", "work", "worm",
  "worn", "yard", "yarn", "yeah", "year", "your", "zero", "zone",
];

/** A selectable word source. `file` is a static asset under `public/`. */
export interface WordListOption {
  id: string;
  label: string;
  file: string;
}

export const WORD_LISTS: WordListOption[] = [
  { id: "scrabble", label: "Scrabble Words", file: "words.txt" },
  { id: "simple", label: "Simple (3,000 words)", file: "words-3000.txt" },
  { id: "full", label: "Full (10,000 words)", file: "words-10000.txt" },
];

export const DEFAULT_WORD_LIST_ID = "full";

// Ham-vocabulary bonus content (Q-codes, common RST reports) — folded into every
// dictionary rather than offered as its own selectable list, so it's always in the
// random mix instead of requiring the player to opt in. Gated the same way as any
// other word: formableWords() only surfaces QRZ/599/etc. once the active Koch set
// covers all of its characters.
const BONUS_FILE = "words-qcodes-rst.txt";

export function wordListById(id: string): WordListOption {
  return WORD_LISTS.find((w) => w.id === id) ?? WORD_LISTS[0];
}

const cache = new Map<string, string[]>();

/**
 * Fetch a static word-list asset (one word per line, uppercased). Returns null if
 * it's missing, empty, or the fetch fails (offline) rather than throwing.
 */
async function fetchWordFile(file: string): Promise<string[] | null> {
  try {
    const res = await fetch(file, { cache: "force-cache" });
    if (res.ok) {
      const words = (await res.text())
        .split(/\r?\n/)
        .map((w) => w.trim().toUpperCase())
        .filter((w) => /^[A-Z0-9]+$/.test(w)); // digits allowed for RST reports (e.g. 599)
      if (words.length > 0) return words;
    }
  } catch {
    /* not present / offline */
  }
  return null;
}

/**
 * Load a word list (cached per selected list id), with the ham-vocabulary bonus
 * words always appended. Falls back to the bundled common-word list if the
 * selected dictionary is missing/empty/offline, so the mode always works.
 */
export async function loadWordList(id: string = DEFAULT_WORD_LIST_ID): Promise<string[]> {
  const { file } = wordListById(id);
  const cached = cache.get(file);
  if (cached) return cached;
  const primary = (await fetchWordFile(file)) ?? FALLBACK_WORDS.map((w) => w.toUpperCase());
  const bonus = (await fetchWordFile(BONUS_FILE)) ?? [];
  const combined = [...new Set([...primary, ...bonus])];
  cache.set(file, combined);
  return combined;
}

/** Words whose every letter is in `activeSet`, within the length bounds. */
export function formableWords(
  words: string[],
  activeSet: string[],
  minLen: number,
  maxLen: number
): string[] {
  const set = new Set(activeSet);
  return words.filter(
    (w) =>
      w.length >= minLen &&
      w.length <= maxLen &&
      [...w].every((c) => set.has(c))
  );
}
