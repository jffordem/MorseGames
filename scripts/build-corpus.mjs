// Build-time corpus generator for Reading mode.
//
// Downloads a public-domain source that is *natively a list of short, complete
// pieces* and splits it into self-contained chunks, so the Reader always starts
// and ends a passage cleanly (no falling into the middle of a novel). The output
// is a small JSON bundled into the app — the core stays serverless and offline.
//
// Run with:  npm run build:corpus
//
// Adding another source = add an entry to SOURCES with a parser and re-run.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "corpus");

const SOURCES = [
  {
    file: "aesop.json",
    id: "aesop",
    title: "Aesop's Fables",
    author: "Aesop (Æsop for Children, 1919)",
    // Project Gutenberg #19994 — "The Æsop for Children". Clean prose, each
    // fable a complete arc of ~60–300 words: ideal session length.
    url: "https://www.gutenberg.org/cache/epub/19994/pg19994.txt",
    parse: parseAesopForChildren,
  },
];

/**
 * Parser for the "Æsop for Children" Gutenberg edition.
 * Fables are delimited by ALL-CAPS title lines; morals are _italicized_;
 * [Illustration] markers and the PG header/footer are noise to strip.
 */
function parseAesopForChildren(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const header = "THE ÆSOP FOR CHILDREN";
  // Body starts at the *second* occurrence of the book header (the first is the
  // title page); content ends at the Gutenberg end-marker.
  const firstHeader = text.indexOf(header);
  const bodyStart = text.indexOf(header, firstHeader + header.length);
  const bodyEnd = text.indexOf("*** END OF THE PROJECT GUTENBERG");
  const body = text.slice(bodyStart + header.length, bodyEnd);

  const isTitle = (line) =>
    /^[A-ZÆ][A-ZÆ ,.'’-]+$/.test(line) && line.length <= 60 && line !== header;

  const fables = [];
  let current = null;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("[")) continue; // [Illustration ...]
    if (isTitle(line)) {
      if (current) fables.push(current);
      current = { title: titleCase(line), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) fables.push(current);

  const usedIds = new Set();
  return fables
    .map((f) => {
      const text = f.lines
        .join(" ")
        .replace(/_/g, "") // drop italic markers around morals
        .replace(/\s+/g, " ")
        .trim();
      return { id: uniqueId(slug(f.title), usedIds), title: f.title, text };
    })
    .filter((f) => f.text.length >= 60); // guard against stray fragments
}

function titleCase(s) {
  const small = new Set(["and", "the", "a", "an", "of", "or", "in", "his", "her", "to"]);
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) =>
      i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(base, used) {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const src of SOURCES) {
    process.stdout.write(`Fetching ${src.title} … `);
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${src.url} → HTTP ${res.status}`);
    const raw = await res.text();
    const chunks = src.parse(raw);
    const out = { id: src.id, title: src.title, author: src.author, chunks };
    const path = join(OUT_DIR, src.file);
    await writeFile(path, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`${chunks.length} chunks → ${path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
