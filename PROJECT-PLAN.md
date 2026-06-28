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

- Your callsign and/or club callsign (e.g. `W7XYZ`)
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
`CQ TEST W7XYZ` keys out `-.-. --.- / - . ... - / .-- --... -..- -.-- --..` in your ear.
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

- **Real keyer / straight key as game input.** Connecting actual hardware unlocks two
  things at once: *sending practice* (finally tactile and real) and *full game input* —
  every mode that currently accepts keystrokes could accept keyed Morse instead. That's
  the bigger prize: you're practicing copy *and* sending in every session, the way real
  CW operators work. Hardware paths:
  - **Web Serial API** — K1EL **WinKeyer** and **Mortty** (open-source Arduino keyer kit)
    both enumerate as USB serial (CDC). WinKeyer is the de-facto standard driven by N1MM
    and most logging software; Mortty is a buildable open-source alternative. Either sends
    decoded characters over serial, so the app reads text, not raw paddle state.
  - **WebUSB/HID** — raw key-to-USB adapters (no keyer chip) appear as HID devices.
    More direct, but the app must implement iambic squeeze logic in JavaScript.
  - **Audio-in decoding** — detect the sidetone from any code-practice oscillator via
    `getUserMedia` + Web Audio analyser → decode in-browser. No special hardware at all;
    works with a straight key into any oscillator. Latency is the main risk.
  - Once any of these input paths exists, the keyer-as-keyboard concept follows: you could
    key your way through *all* text input in the app — answers in Random Run, callsign
    fields in contest mode, etc. That's a significant training mode in itself: operating
    the whole app in CW, the way a real radio sounds and feels.
  - **Sending feedback loop**: if the app can hear or read what you sent, it can compare
    it against what it asked for and show timing errors (dit/dah ratio, spacing) —
    something no keyboard simulation can do. High value, requires audio-in or HID path.

- **Text adventure / Interactive Fiction in CW (the Zork idea).** Hear the room
  description as Morse, key your command back, advance the story. The game *motivates
  copying* — you want to know what's in the room, so you focus harder than you would on
  a drill. Two flavors worth exploring:
  - **Classic IF (Zork, Adventure/Colossal Cave):** Zork I is legally available in many
    forms; Inform / Frotz can run in the browser via WebAssembly. Pipe its output through
    the Morse engine; accept keyed or typed input. Even just piping Zork through CW
    would be a genuinely fun training tool.
  - **Ham-radio-themed custom IF:** a short adventure set in a shack or DXpedition —
    "You are in a cramped tent on a Pacific atoll. To the north, a KX3 and a log. To the
    south, a dipole that needs trimming. The cluster shows a new multiplier on 17m." The
    game world rewards ham knowledge (proper prosigns, band plans, contest protocol) and
    the copy skill simultaneously. Could be built with a minimal custom IF engine rather
    than a full interpreter.
  - **Parser over keyer**: the command parser can be lenient — `N` for `NORTH`, `GET`
    for `TAKE`, etc. — so abbreviating like a ham feels natural rather than like a bug.
  - See also: [AI-powered IF engine](#ai-chatbot--dynamic-qso-simulator) below — an LLM
    as the IF narrator is an obvious and exciting mashup.

- **AI chatbot / dynamic QSO simulator.** Mode 4 (QSO Simulator) is planned with a
  scripted bot. Replacing the script with an LLM call makes every ragchew unique and
  genuinely conversational — the AI plays a ham with a callsign, location, rig, antenna,
  and opinions. Design notes:
  - The AI's *output* is piped through the Morse engine just like any other text source.
    From the audio engine's perspective, nothing changes.
  - The AI should stay in character: use proper ham prosigns (`BT`, `AR`, `KN`, `SK`,
    `=`), realistic Q-codes, and plausible signal reports. A well-written system prompt
    plus a few example exchanges should get this right.
  - **Difficulty control via persona**: a slow ragchewer ("hi om, first time on 40m, just
    got my ticket") vs. a fast contester ("5NN ID TU") gives a natural difficulty axis
    without touching the WPM setting.
  - **AI as contest opponent**: the same idea applies to contest mode — instead of a
    fixed caller pool, an LLM generates callsigns, sections, and exchange variations
    dynamically, making the contest feel less predictable after many repetitions.
  - **AI + IF mashup**: use an LLM as the IF engine for the text adventure mode above —
    prompt it to run a ham-radio adventure, respond to your keyed commands in CW, and
    maintain a consistent game world. No Zork interpreter needed; the AI improvises.
  - Privacy / cost note: LLM calls require an API key and network access, breaking the
    "no backend" constraint. The cleanest path is a user-supplied API key stored in
    `localStorage` — keeps the app serverless, puts the cost on the operator. Fallback to
    scripted mode when no key is configured.
- **VBand integration / interoperability.** [VBand](https://hamradio.solutions/vband/) is
  a browser-based live CW platform — users send Morse via keyboard or USB keyer to shared
  channels and hear other operators in real time. It has a QSOBot for solo practice and
  supports public/private channels. There's no public API, so deep integration isn't on
  the table, but several meaningful touchpoints are realistic:
  - **Shared keyer hardware (most valuable, zero API needed).** VBand uses the same USB
    keyer hardware (WinKeyer, Mortty, straight-key-via-TRS adapters) that MorseGames
    wants to support. If both apps support Web Serial, a user can train in MorseGames and
    then plug the same key into VBand without rewiring anything. Keyer support in
    MorseGames becomes a force multiplier: it unlocks VBand, N1MM, and real radio use
    simultaneously.
  - **"Ready for VBand" progression milestone.** MorseGames trains copy; VBand is where
    you practice live sending with real humans. That's a natural pipeline. At a
    meaningful Koch level (e.g. full alphabet + numbers at 15 WPM effective), surface a
    prompt: "You're ready to try a live QSO — open VBand's practice channel." Frames
    VBand as the *graduation target*, not a competitor.
  - **VBand-speed presets.** VBand exchanges happen at real-world speeds (typically
    15–25 WPM). Expose named difficulty presets in MorseGames settings keyed to VBand
    readiness: "VBand casual (15 WPM)", "VBand contest (20 WPM)", "VBand fast (25 WPM)".
    Gives beginners a concrete target to aim for.
  - **Club warm-up mode.** Before a scheduled club VBand session, run a timed MorseGames
    warm-up: 10 minutes of Random Run or Word Wrangler, then a "your session starts in X
    minutes" countdown with a link to the club's private VBand channel. Prep tool, not
    an integration.
  - **Browser companion extension (longer term).** A lightweight browser extension
    injected into a VBand session could add: copy-assist scrollback (full decoded text
    history beyond what VBand shows), per-character miss tracking, and a post-session
    accuracy summary — all reading VBand's own decoded-text DOM, no API required. The
    extension would be a separate project but shares MorseGames' stats schema so progress
    rolls up in one place.
  - **What VBand already does well (don't duplicate).** Live multi-user channels, real
    human QSOs, QSOBot, the social/club layer. MorseGames should position itself as the
    *trainer* you use before VBand, not a replacement for live on-air practice.

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
- **Club angle** — shared daily-challenge seed; compare scores at a meeting.
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
