// Rule-based "flexible but not fuzzy" message parsing — no AI, no backend, just
// tokenizing free-typed player text and matching on tokens instead of raw
// substrings. See MORSE-GAMES.md's "Rule-based flexible parsing, not AI" note
// for the design rationale. Mission-agnostic: no knowledge of any mode's
// content lives here.

export function tokenize(msg: string): Set<string> {
  return new Set(tokenizeWords(msg));
}

/** Ordered words, for phrase/sequence checks (unlike the Set above, order survives). */
export function tokenizeWords(msg: string): string[] {
  return msg.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

/** True if `seq` appears as consecutive words anywhere in `tokens` — tolerates
 *  extra spacing, surrounding prowords, and position in the message without
 *  needing an exact substring or any AI judgment call. */
export function includesSequence(tokens: string[], seq: string[]): boolean {
  outer: for (let i = 0; i <= tokens.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}
