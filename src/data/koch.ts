// International Morse code and the Koch learning order.

/** Morse patterns: '.' = dit, '-' = dah. */
export const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "/": "-..-.",
  "=": "-...-",
};

/**
 * Koch character introduction order (LCWO / G4FON convention).
 * Learners start with the first few and add more as they progress.
 */
export const KOCH_ORDER: string[] = [
  "K", "M", "U", "R", "E", "S", "N", "A", "P", "T",
  "L", "W", "I", ".", "J", "Z", "=", "F", "O", "Y",
  ",", "V", "G", "5", "/", "Q", "9", "2", "H", "3",
  "8", "B", "?", "4", "7", "C", "1", "D", "6", "0",
  "X",
];

/** The first `n` characters of the Koch order (clamped to valid range). */
export function kochSet(n: number): string[] {
  const count = Math.max(1, Math.min(n, KOCH_ORDER.length));
  return KOCH_ORDER.slice(0, count);
}
