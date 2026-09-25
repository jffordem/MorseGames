# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MorseGames is a browser-based Morse code (CW) training app for amateur radio operators. Static SPA — no backend, no database. All persistence via `localStorage`. Audio via Web Audio API (no audio file dependencies).

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:4080 (hot reload)
npm run build        # TypeScript check + Vite production build → dist/
npm run preview      # Preview production build locally

docker compose up    # Build and serve at http://localhost:4080
docker compose up --build  # Force rebuild after source changes
```

Vite dev server runs on port 4080 (configured in [vite.config.ts](vite.config.ts)). Docker maps nginx:80 → host:4080.

## Architecture

**Entry:** `index.html` → [src/main.ts](src/main.ts) — mounts the tab router and boots the default mode (Random Run).

**Tab/Mode lifecycle:** Clicking a tab calls `activate(tabName)`, which calls `.unmount()` on the current mode, clears the DOM, then instantiates and calls `.mount()` on the new mode class. Each mode is self-contained: it builds its own DOM and registers/cleans up its own event listeners.

**Audio engine:** [src/audio/morse-engine.ts](src/audio/morse-engine.ts) — each mode constructs its own instance from the saved settings. Uses PARIS standard Farnsworth timing: characters play at `charWpm`, inter-character/word gaps are stretched to achieve a lower `effectiveWpm`. Generates sine waves (~600 Hz default) with attack/release envelopes to avoid clicks. Audio context requires a user gesture; modes call `engine.resume()` on first button press.

**Training modes** (each in [src/modes/](src/modes/)):
- **Random Run** — Hear a character, type it. Koch-method progression: unlock next character after ~90% accuracy on the current set.
- **Word Wrangler** — Hear a word, type it. Word list is filtered at runtime to only include words formable from the current Koch character set.
- **Reading** — Passive listening to public-domain texts (Gettysburg Address, Aesop, Alice). Bookmarks and resume position persisted to localStorage.
- **Contest** ([field-day.ts](src/modes/field-day.ts)) — Field Day contest prototype: call CQ, work callers, copy and log exchanges. Design paused pending outside review (see PROJECT-PLAN.md).
- **Adventure** ([adventure.ts](src/modes/adventure.ts)) — the WWII coastwatcher story campaign, the active development focus. Each mission is a hand-authored `Scenario` object (intro/notes/briefing copy plus a `buildTimeline()` of sked/spot/relay/overhear/silence/impostor/relocate/haggle events) listed in order in the `SCENARIOS` array, which follows the historical timeline. Player replies are graded by ranked rules through [src/dialogue/](src/dialogue/) (token matching, no AI). Field missions enforce a 7.5 WPM effective floor via `minEffectiveWpm`. The radio uses deliberately simple "game physics": tones at the player's chosen pitch, exact-match tuning.

**Data layer** ([src/data/](src/data/)):
- [koch.ts](src/data/koch.ts) — `MORSE` pattern map and `KOCH_ORDER` array (39 chars in LCWO order). `kochSet(n)` returns the active character set for a given Koch level.
- [words.ts](src/data/words.ts) — `FALLBACK_WORDS` bundle (~600 words); `loadWordList()` fetches `public/words.txt` at runtime. `formableWords()` filters by active Koch set.
- [texts.ts](src/data/texts.ts) — Bundled text corpus. `scripts/build-corpus.mjs` is a build-time tool for chunking large text collections into `src/data/corpus/*.json`.

**Persistence** ([src/stats/storage.ts](src/stats/storage.ts)) — Three localStorage keys:
- `morse-games.settings` → `{ charWpm, effectiveWpm, frequencyHz, kochLevel, wordListId }`
- `morse-games.charStats` → per-character `{ attempts, correct }` for accuracy heatmap
- `morse-games.reading` → display mode, start mode, bookmarks, corpus chunk index

## Adventure campaign docs

[MORSE-GAMES.md](MORSE-GAMES.md) is the design doc for the campaign. Its **Build status** note (under "Campaign structure & pacing", next to the mission allocation table) is the single source of truth for which missions are built and what's next. When a mission ships, update that note, and the Adventure blurb in [README.md](README.md) if the player-facing scope changed.

## Workflow

Pushing to `main` auto-deploys to the live site (GitHub Pages via [.github/workflows/deploy.yml](.github/workflows/deploy.yml)), which real players use. Commit and push all work on feature branches. Opening and merging the PR is the deploy gate. Only a critical hotfix goes straight to `main`.

## Key constraints

- **TypeScript strict mode** — `noUnusedLocals` and `noUnusedParameters` are enforced; unused variables break the build.
- **No backend** — Features must work with localStorage or bundled data. No server-side APIs.
- **Web Audio API user gesture requirement** — Audio context cannot start until a user interaction. Each mode handles this via `engine.resume()` on first click.
- **Koch ordering matters** — Characters must be introduced and filtered using `KOCH_ORDER` from [src/data/koch.ts](src/data/koch.ts), not alphabetically.
- **Farnsworth timing** — `charWpm` ≥ `effectiveWpm` always. The engine calculates dit/dah/gap durations from PARIS standard; don't hand-code timing values.

## Docker notes

The [Dockerfile](Dockerfile) is a two-stage build: Node 20-Alpine builds the app, Nginx Alpine serves the static output. The Nginx config is default (serves `index.html` for all routes). If adding client-side routing that needs fallback-to-index, a custom nginx.conf will be needed.
