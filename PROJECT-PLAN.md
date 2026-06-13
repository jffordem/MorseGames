# Morse Games — Project Plan

A browser-based, ham-centric Morse Code training app. The goal: learn CW, build
copying speed, and have genuine fun by practicing **realistic ham radio activities**
— not abstract drills.

This doc captures the design decided during brainstorming. See [README.md](README.md)
for the original concept.

## Guiding principles

- **Ham-centric, not a kids' typing game.** The fun comes from realism and the
  speed-vs-accuracy tension, not gimmicks.
- **Fun over hardcore.** Default scoring is friendly — busted contacts simply don't
  count; no penalties or NIL-shaming. A strict mode can be a later toggle.
- **Browser-first, no backend required for the core.** Ship as a static site
  (Vite build → optionally nginx in Docker). Progress lives in `localStorage`.
- **One engine, many modes.** Get the tone + timing engine right and every mode
  inherits it.

## Tech stack

- **Vite + TypeScript** — static SPA, tabs for modes.
- **Web Audio API** — tones generated programmatically: an `OscillatorNode`
  (sine, ~600–700 Hz) gated by a `GainNode` envelope. No audio files; exact timing.
- **localStorage** — stats, progress, station profile. No database.
- **Docker/nginx** (optional) — thin static-file wrapper for "via docker" deployment.
- Only thing that may want a server later: fetching Gutenberg texts for Reading mode.
  Pre-bundle a few works so the core stays serverless and offline-capable.

## The timing engine (foundation — everything depends on it)

This is the single most important pedagogical decision and must be right from day one:

- **Koch method** — start at full target *character* speed with just a few characters;
  unlock the next character only when accuracy holds (~90%). Trains sound-recognition
  reflex instead of counting dits.
- **Farnsworth timing** — characters sent fast, extra space *between* them. The engine
  tracks **two speeds**: character WPM and effective WPM.
- **Band conditions as a difficulty axis** (Web Audio noise buffer + gain modulation):
  - **QRN** — static crashes
  - **QRM** — a second station drifting in
  - **QSB** — signal fading in/out
  - slight frequency drift

## Station profile (small, but everything downstream reads it)

Entered once, stored in `localStorage`. Makes every exchange *yours*:

- Your callsign and/or club callsign (e.g. `W7HBC`)
- ARRL section (e.g. `ID`)
- Field Day class (e.g. `2A`)
- County (for state QSO parties, e.g. `ADA`)

## Game modes

### 1. Random Run mode (the foundation training mode)
Hear a character, type it. **No time limit** — you wait indefinitely for a keypress,
so you can start slow and build accuracy without pressure. Speed and character set
are manually adjustable; progression is by *graduating* Koch levels, not auto-speed.

**The loop:**
1. Play a random character from the active set.
2. Wait indefinitely for a keypress (no timeout).
3. Evaluate:
   - **Correct** → +1 point, streak++, green flash, the typed letter shows, next char plays.
   - **Wrong** → streak resets to 0, red flash, **reveal the correct character** (big) and
     **replay its sound once**, then move on. (Reveal-and-replay = friendly + educational.)

**Randomization:** uniform random, but **never the same character three times in a row**
(doubles are fine and realistic — `GOOD`, `PIZZA`; triples are not). Exclude a character
from the candidates only if it was the last *two* picks. (Weighting toward weak characters
is a later enhancement once the heatmap exists.)

**Controls (all keyboard):**
- **Letter/number keys** — answer (case-insensitive). First keypress commits; single char, no backspace.
- **Spacebar** — replay current character before answering. Tracked separately, *not* counted
  as a miss (so it doesn't pollute accuracy, but you can see if you lean on it).
- **Esc** — pause / end session → summary screen.
- Keys *not* in the active set are **ignored** (a stray far-off key won't tank accuracy).

**Settings (persisted in localStorage):**
- **Character speed (WPM)** — default **20** (stays high even for beginners — Koch principle).
- **Effective / Farnsworth speed (WPM)** — ≤ character speed; default **~10**. The main comfort dial.
- **Koch level (active character set)** — slider for "first *N* Koch characters" using the order in
  Mode-list intro; sets your starting set. Optional custom multi-select for power users.
- **Tone frequency** — default ~600 Hz (low-priority nicety).

**Graduation (session progression):**
- Correct guesses at the current level accumulate toward a threshold of **(active char count) × 20**
  (5 chars → 100, 10 → 200, 15 → 300…).
- Hitting the threshold pauses and shows a **Congratulations!** popup offering to auto-advance.
  - **Graduate** → active set grows by **5 characters** (levels 5/10/15/20…); the per-level
    correct counter resets; practice continues with the larger set.
  - **Cancel** → stay at the current level and keep going; re-offer after another threshold's
    worth of correct copies (so it doesn't nag every keystroke).
- Ties the celebration to *mastery volume* — the Koch unlock moment, made explicit and opt-in.

**Scoring / HUD (always visible — sensing progress):**
- **Score** — running count of correct.
- **Accuracy %** — correct ÷ attempts, this session.
- **Current streak** + **best streak** — the number to chase. Small celebrations at 10/25/50.

**End-of-session summary (Esc):** final score, accuracy, best streak, characters attempted,
replays used, and a **per-character accuracy mini-heatmap** (which letters you nailed vs. fumbled).
That per-character data appends to cumulative localStorage stats → feeds the global heatmap.

**Architecture fit:** pure consumer of the timing engine — Random Run ≈ engine + random picker +
scoring HUD + graduation logic. Building it also builds the stats spine the other modes reuse.

### 2. Real contest mode (flagship)
The headline game. Run a contest, work stations, **and log them correctly** — that's
how you score. Copying is only half the job; getting it into the log right is the
other half (just like the real thing).

**Core loop (Run / "you CQ, they call you" — the v1 style):**

> CQ → station answers → copy call → app sends exchange → copy & log exchange →
> **Enter** to log → **QRZ?** (or **CQ**) → next station …

**Keyboard flow modeled on N1MM Logger+** (trains real contest-day muscle memory):
- **Spacebar** — advance Call → Exchange fields
- **Enter** — log the QSO and fire the next message
- **Esc** — clear a botched entry
- **CQ** / **QRZ?** message keys — choose how to solicit the next caller between
  contacts (free, no scoring impact; CQ when quiet, QRZ to pull the next from a pileup)
- **fill request** (e.g. `?`) — sends `AGN?`, station repeats, but the clock keeps
  ticking (costs rate, not points)

**Player keying echo (sidetone).** Just like a real logger feeding a keyer + rig:
everything *you* send is played back as audible Morse at the current speed, so typing
`CQ TEST KG7FVO` keys out `-.-. --.- / - . ... - / -.- --. --... ..-. ...- ---` in your ear.
- Typed characters drop into a **send buffer** and drain out as Morse with correct
  inter-character (and inter-word) spacing — type-ahead is fine; the buffer keeps up.
- After the buffer empties, a **realistic "thinking" pause** before the other party
  responds — the rhythm of a real exchange, not an instant reply.
- Doubles as sending practice for the *ear* (you learn what good sending sounds like)
  without needing a physical key yet. Engine addition: a `playString()` / send-queue
  that respects spacing and can be fed incrementally.

**Scoring (relaxed / fun default):**
- QSO points only when call + full exchange are logged correctly.
- Busted QSO = simply doesn't count (no penalty). Shown in the post-session summary
  for learning ("logged his section as OR, he sent ID").
- **Multipliers** — new section/county/zone multiplies score → reason to copy
  carefully on new mults, run fast on routine ones.
- **Dupes** — repeat callers; log flags them like real software. Awareness is a
  free skill the game teaches.
- **Rate meter** — QSOs/hour, live. The number contesters chase.
- **Accuracy %** — clean vs. busted log.
- The self-balancing tension: go faster ↔ stay clean.

**Difficulty knobs (all reuse the engine):** caller speed + spread, band conditions,
caller rate (trickle vs. overlapping pileup), curated caller pool with realistic
section distribution.

**Exchange templates (data, not code).** Each contest is a config:
`{ fields: [...], generator, grader, scoring }`. The log UI renders fields from the
template; the grader compares logged vs. sent. New contest = new file, no engine change.

- **Field Day** — `<call> <class> <section>` (e.g. `W7XYZ 2A ID`). Simplest exchange,
  fewest log fields → the **first contest to build**. Rate-meter run loop = max fun
  per line of code. Can be themed as a compressed "hour of Field Day."
- **State QSO Party** — `<call> 599 <county-or-state>` (e.g. `K7ID 599 ADA`). In-state
  send county (3-letter abbreviation drilling), out-of-state send their state.
- **DX contest** — `599 <zone/serial>`. Fast, repetitive, pure speed.
- **ARRL Sweepstakes** — `<serial> <precedence> <call> <check> <section>`
  (e.g. `123 A W7XYZ 72 ID`). The "boss fight" — hardest standard exchange.

### 3. Callsign / pileup drill
Generate valid callsign patterns (prefix + number + suffix); "pileup" sub-mode where
2–3 calls overlap and you pull out the strongest. Copying calls is the hardest
real-world skill and few apps train it well.

### 4. QSO simulator (ragchew / chat mode)
Bot runs an authentic exchange with proper prosigns (`AR`, `BT`, `KN`, `SK`, `=`);
you copy and respond. Teaches real on-air patterns, not just letters.

### 5. Head-copy challenge
Input locked until the word/sentence finishes, then type from memory. Trains the
holy grail of "head copy." Ladder up from 3-letter words.

### 6. Word practice
Frequency-ranked word lists, shortest first. Speed ladder auto-finds your edge.

### 7. Reading mode (Gutenberg)
"Audiobook in CW." Resume where you left off (`localStorage`). Pre-bundle 2–3
public-domain works for offline use; fetch more later. The long-game retention mode.

### 8. Daily challenge
One seeded run per day, shareable score (e.g. "Speed-at-90%: 18 WPM, best clean run: 34").
Cheap to build; social loop works even solo (post to the club).

## Stats & scoring philosophy

Score the way a contester thinks, not raw keystrokes:

- **Speed-at-90%** — effective WPM where accuracy holds at 90%. The honest headline
  number that climbs over weeks.
- **Best clean run** — longest zero-error streak at current speed. The number to chase.
- **Per-character error heatmap** — doubles as the progress dashboard *and* the data
  that drives Koch auto-unlocking. One structure, two payoffs.
- **Confusion pairs** — surface classic mixups (B/D, S/H/5, U/V): "you confuse F and L."

## Build sequence (walking skeleton first)

1. **Tone + timing engine** — Web Audio, dual-speed Farnsworth, Koch ordering, noise
   toggles. Everything depends on this.
2. **Station profile** — call / club call / section / class / county.
3. **Adaptive Koch/character mode** — proves the copy loop end-to-end.
4. **Stats + localStorage** — per-character accuracy heatmap (this *is* the Koch
   progression UI).
5. **Field Day contest mode** — caller generator + log UI + N1MM-style keyboard flow +
   CQ/QRZ + score/rate/busted-list summary. The first "real ham tool" milestone.
6. **More contests** — QSO Party → DX → Sweepstakes, as exchange-template configs.
7. Word → Reading → Callsign/pileup → QSO sim, in increasing complexity.

## Parked ideas / future upgrades

- **Sending practice — needs real hardware (low priority / skeptical).** Simulating a
  key with keyboard/mouse is probably a dead end: no spring tension or paddle throw, no
  tactile feel, and a clacking spacebar gets annoying fast. If sending is ever worth
  doing, the realistic path is *actual* hardware — a real straight key / iambic paddle
  read via Web Serial / WebUSB (a simple key-to-USB interface), or audio-in detecting the
  tone from a real code-practice oscillator. Until then, the keyboard **keying echo**
  above (type → hear perfect machine-sent Morse) covers the "hear what you send" benefit
  without pretending the keyboard is a key.
  - **Known keyer hardware to research:** K1EL **WinKeyer** (de facto USB CW keyer, driven
    by N1MM etc.) and **Mortty** (open-source Arduino-based USB keyer kit) — both enumerate
    as **USB serial (CDC)**, so the browser path is the **Web Serial API**. Raw-HID
    key-to-USB adapters would instead use **WebUSB/HID**. Either is reachable from the
    browser without a native app, keeping the serverless design intact.
- **Search & Pounce** contest style — Run is the v1 style; S&P comes later. The core
  mechanic is a **frequency dial across the 40m CW segment**: tuning shifts each station's
  audio pitch like a real receiver (so pitch becomes a *consequence* of where you're
  tuned, replacing the manual Tone setting), the CW filter acts as a passband you hunt
  within, and you zero-beat a caller before working it with the same log/grader machinery
  as Run mode. There's a fixed population on any given frequency, so roaming the dial
  finds new contacts. Open "realistic vs. actually fun" questions are collected under
  [Questions for Hams](#questions-for-hams) — to be settled with experienced operators
  before this is built.
- **Strict scoring mode** — real-ARRL-style penalties for busted QSOs, as a toggle.
- **Club angle (HPBARC)** — shared daily-challenge seed; compare scores at a meeting.
  Fits the "social, bounded, high-visibility" energy rubric.

## Questions for Hams

Open design questions to settle with experienced operators **before** building the
Search & Pounce / frequency-dial feature. The goal is to learn which bits of realism
are *fun* to simulate and which are tedious and should be faked or skipped. Take these
to the club / on-air friends and bring back gut reactions.

**The premise to explain first:** a browser CW trainer is adding a *Search & Pounce*
contest mode. You tune a dial across the 40m CW segment; as you tune, each station's
audio pitch slides up or down like a real receiver, and you have to find callers,
zero-beat them, and work them. We want it authentic enough to feel like 40m, but we'll
happily drop anything that's realistic-but-no-fun.

### Band layout & tuning feel
- How wide a slice should you tune across before it feels tedious — the full CW segment
  (7.000–7.125 MHz) or a tighter contest sub-band (e.g. 7.000–7.040)?
- In a real 40m CW contest, how densely are stations packed (roughly stations per kHz)?
  What spacing would feel authentic without being chaotic?
- Should a signal's pitch track tuning 1:1 (1 kHz of tuning = 1 kHz of pitch change)?
- What audio pitch do you personally tune CW signals to? (We'll use it as the default
  "zero-beat" target.)

### The tuning skill — satisfying or fiddly?
- Is zero-beating a station to your preferred pitch satisfying to do, or just an
  annoyance we should auto-snap?
- Should being off-frequency *degrade copy* (weaker / harder to read), or is "anywhere
  in the passband" good enough for a game?
- How much does CW filter width / selectivity matter to the experience — worth exposing
  as a difficulty knob, or invisible plumbing?
- Are RIT / XIT / split / dual-VFO worth modeling, or rabbit holes for a trainer?

### Band behavior over time
- After you work a station, what realistically happens — do they QSY, keep calling CQ
  (dupe bait), or go quiet? What mix feels true to a contest?
- Is it realistic (and fun, or just confusing) to hear stations mid-QSO with someone
  else that you *can't* work — purely as band texture?
- Pileups: how often do multiple stations land on/near one frequency, and is pulling one
  out of a pileup a fun part of S&P, or really a Run-mode thing?

### What actually makes S&P fun
- What's the genuinely satisfying loop in real Search & Pounce — the hunt, the quick
  exchange, the rate? What should the game reward?
- Run vs. S&P: which do you find more fun, and what would make a *simulation* of each
  worth playing?
- In real life, how much do you lean on a panadapter / waterfall vs. tuning by ear?
  Should the game offer a visual scope, or is ear-only the real skill?
- Which classic S&P annoyances should we deliberately leave **out** because they're
  tedious, not fun?

### Authenticity gut-check
- What would instantly make an experienced op roll their eyes — "that's not how it
  works"?
- What small touches would make you grin "yep, that's 40m"? (QSB fades, the swish of
  signals sweeping past as you tune, a ragchewer parked in the contest segment…)
