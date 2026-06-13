// Bundled public-domain practice texts (all pre-1929, clearly public domain).
// Adding more is just dropping another entry here, or use the "Paste your own"
// option in Reading mode.

import { MORSE } from "./koch";
import aesop from "./corpus/aesop.json";

export interface Work {
  id: string;
  title: string;
  author: string;
  text: string;
}

/** One self-contained passage within a corpus (e.g. a single fable). */
export interface Chunk {
  id: string;
  title: string;
  text: string;
}

/**
 * A collection of short, complete pieces generated at build time by
 * `scripts/build-corpus.mjs`. The Reader plays one chunk at a time, so every
 * passage begins and ends cleanly — no falling into the middle of a long work.
 */
export interface Corpus {
  id: string;
  title: string;
  author: string;
  chunks: Chunk[];
}

export const CORPORA: Corpus[] = [aesop as Corpus];

export function findCorpus(id: string): Corpus | undefined {
  return CORPORA.find((c) => c.id === id);
}

export const WORKS: Work[] = [
  // Aesop's "The North Wind and the Sun" lives in the bundled Aesop corpus
  // (src/data/corpus/aesop.json), so it's intentionally not duplicated here.
  {
    id: "gettysburg",
    title: "The Gettysburg Address",
    author: "Abraham Lincoln",
    text: `Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great battlefield of that war. We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that nation might live. It is altogether fitting and proper that we should do this.`,
  },
  {
    id: "alice",
    title: "Alice's Adventures in Wonderland (opening)",
    author: "Lewis Carroll",
    text: `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do. Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations. So she was considering in her own mind whether the pleasure of making a daisy chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.`,
  },
  {
    id: "scandal-bohemia",
    title: "A Scandal in Bohemia (opening)",
    author: "Arthur Conan Doyle",
    text: `To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex. It was not that he felt any emotion akin to love for Irene Adler. All emotions, and that one particularly, were abhorrent to his cold, precise but admirably balanced mind. He was, I take it, the most perfect reasoning and observing machine that the world has seen.`,
  },
];

/**
 * Normalize raw text into a sendable Morse stream: uppercase, collapse all
 * whitespace to single spaces, and keep only characters we have patterns for
 * (everything else — quotes, dashes, etc. — is dropped). The result is what
 * gets both displayed and played, so they stay in sync.
 */
export function normalizeText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, " ")
    .split("")
    .filter((c) => c === " " || c in MORSE)
    .join("")
    .trim();
}
