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

## Deployment & hosting

The app has zero server-side surface today (checked 2026-07-10: the only `fetch()` in
the codebase is a same-origin static asset, not an API call) — every deploy target is
just "serve a folder of static files over HTTPS." Given a small target audience (a
hobby/club-scale readership, not a public product launch), any option below comfortably
fits inside its free tier. Ranked by recommendation:

1. **GitHub Pages (recommended default).** Zero AWS/cloud account needed at all, truly
   free with no billing surface to monitor, and the repo is already on GitHub. Deploy is
   a `vite build` + push of `dist/` (or a GitHub Actions workflow). *Con:* no custom
   server config if that's ever needed (it won't be, per the point above); a
   `username.github.io`-style URL unless a custom domain is attached (free either way).
2. **Cloudflare Pages / Netlify (tied with GitHub Pages).** Same free-and-simple shape —
   git-connected auto-deploy, generous free tiers, no billing-alarm vigilance required in
   practice. *Con:* another third-party account to hold, no meaningful upside over GitHub
   Pages for this project's needs.
3. **AWS S3 + CloudFront.** The AWS-native equivalent, worth it only if there's a
   specific reason to be on AWS (e.g. learning AWS, or folding this into other AWS
   infrastructure). CloudFront's free tier (1 TB/month transfer, 10M requests/month) is
   an *always-free* allowance, not a 12-month trial — S3 storage/requests for a
   few-MB static site are negligible even past any trial period. *Con:* real setup
   (bucket policy, origin access control, cache invalidation on deploy) versus a git
   push; **requires a billing alarm/budget before publishing a link anywhere**, since AWS
   free tier is "free up to a threshold, then billed," not a hard cap.
4. **AWS Amplify Hosting.** A managed middle ground on AWS — git-push-to-deploy with
   CI/CD, still has its own free tier. *Con:* still an AWS account with the same
   billing-alarm caveat as #3, for a smaller convenience win than GitHub Pages already
   provides for free.
5. **Self-hosted Docker/nginx (not recommended for public hosting).** This is what
   `docker compose up` already gives us for local dev/demo — good for that, but a public
   deploy this way means a VPS with an ongoing cost and real maintenance burden (patching,
   uptime) for a static site that doesn't need a server at all. Keep this as the local/dev
   path, not the public one.

**Standing guidance — deployability is a design constraint, not an afterthought.** Any
future change that would require paid infrastructure, a persistent server process, or
anything beyond static-file hosting to run (a real backend, a managed database, a paid
third-party API the app depends on at runtime) is a **significant architectural
decision** and should be flagged and discussed explicitly before being built — it's not
something to slide in as an implementation detail of an otherwise-unrelated feature.
Reading mode's "fetch remote texts" idea above is exactly the kind of thing to keep
pre-bundled/static rather than reaching for a server, for this reason.

**Standing guidance — no end-user data collection.** Don't add accounts, logins,
server-side analytics/telemetry, session tracking, or any third-party script that
reports on user behavior. The goal is a clean, simple claim: *this app does not collect
or manage any end-user data*, full stop — aside from the hosting provider's own
incidental, standard web-server access logs (outside the app's control, inherent to any
static host, and not something the app itself generates or has access to).
`localStorage` data (settings, stats, progress) never leaves the user's browser, and
that should stay true for any new persistence need — if something ever seems to need
server-side storage, that's a sign to reconsider the feature, not to add a backend.

**Standing guidance — clear the working titles before public launch.** Before hosting
this anywhere public, confirm the app's name ("Morse Games") and the game-mode brand
name ("Morse Adventures," per `MORSE-GAMES.md`) aren't already registered trademarks for
a similar product — a name collision is a trademark question, separate from the
copyright/IP due-diligence already done on the *content* (see the 2026-07-10 session:
checked against existing Morse-themed games like Submorse and the upcoming Morse Depths:
WWII — no meaningful overlap found there, since neither shares this project's setting,
cast, or campaign structure). This is a cheap, do-it-yourself check, not something that
needs a lawyer unless a real conflict turns up:
- **USPTO TESS** (the US trademark database, [tmsearch.uspto.gov](https://tmsearch.uspto.gov))
  — search the exact phrase and close variants ("Morse Games," "MorseGames," "Morse
  Adventures," "Morse Adventure").
- **A plain marketplace/web sweep** — Steam, the App Store, Google Play, and a general
  web search for the exact name plus "game" — catches an unregistered-but-actively-used
  name a formal trademark search alone might miss.
- If either name is already taken (registered or in active confusing use), don't ship
  under it — come back and brainstorm alternatives together rather than risk a rename
  after the fact.

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
- **Adaptive difficulty in Word Wrangler (weak-character biasing) — phase 1 shipped
  2026-07-10, extended beyond the original design.** Quietly track which characters
  trip you up and bias the next word toward them, so practice self-targets your weak
  spots without any manual setup. **Implemented differently than first sketched below:**
  rather than substitution-based confusion tracking, the shipped version drives the
  decaying score off **recognition latency** — the delay between a character's sound
  ending and the corresponding keystroke, right or wrong (`recordTiming()` in
  `src/stats/storage.ts`; capture logic in `src/modes/word-wrangler.ts` and
  `src/modes/random-run.ts`; `charDurationMs()` extracted to `src/audio/morse-engine.ts`
  as the shared timing source of truth). Distraction/noise handling: any single latency
  sample is capped (2500ms) rather than trying to classify *why* a gap is long; a tab
  hidden mid-attempt (Page Visibility API), an edit (backspace/paste) mid-word, a replay,
  or the first ~45s of a session (settling-in jitter) all discard that measurement's
  latency data — scoring/streak/attempts are never affected, only the difficulty signal.
  `pick()` in both modes weights by `1 + Σ difficulty` with the ~30% pure-random floor
  described below. **Shipped to both Word Wrangler and Random Run** (Random Run's
  strict call-and-response shape made it the cleaner of the two to instrument, despite
  Word Wrangler shipping first) — a broader character set (punctuation/numbers/prosigns)
  feeds the same shared difficulty pool. **Not yet built:** the substitution confusion
  matrix (`confusions[heard][typed]`) and minimal-pair drilling described below — still
  a legitimate phase 2, now layered on top of a working latency signal rather than
  instead of one. Original design notes preserved below for that follow-on work:
  - **Localize the error, don't just flag the whole word.** Replays are a weak, diffuse
    signal (you replay the entire word). Misses are far sharper *if* you diff the guess
    against the target: typing `FEAF` for `LEAF` says you substituted **F for L** at a
    specific position — a *directional* confusion, not just "L is hard." Use a cheap
    edit-distance alignment on submit to attribute the error to the right character(s).
  - **Model it as a confusion matrix, not a difficulty scalar.** `confusions[heard][typed]`
    carries strictly more information than a per-char score and enables drilling the
    *pair*. Notably, the operator's own trouble pairs — **L/F, Q/Y, W/G** — are all Morse
    **reversal pairs** (`·—··`↔`··—·`, `——·—`↔`—·——`, `·——`↔`——·`): the ear grabs the
    right dots/dashes but scrambles their order. A classic failure mode worth targeting
    directly. Ties into the existing [Confusion pairs](#stats--scoring-philosophy) idea.
  - **Decaying score (EWMA), not raw counts** — so a character you've since conquered
    fades out and stops being over-drilled. Recovery matters as much as detection; the
    bias should self-heal.
  - **Soft, weighted selection.** In `pick()`, weight each candidate word by
    `1 + Σ(problem-score of its letters)` and sample weighted-random. Problematic words
    float toward the top of the draw but everything stays reachable, so variety survives
    and it never becomes a monotonous "LFLF" grind. Cap the multiplier; keep a floor of
    ~30% pure-random draws so it stays *quiet*, as intended.
  - **Confusion-pair payoff:** once L↔F is known, the highest-value words to serve are
    **minimal pairs** where mishearing still spells a plausible word, forcing you to
    actually resolve the pattern — a targeted drill a generic difficulty score can't
    produce.
  - **Optional gentle readout** in the session summary ("your ear is mixing L↔F") — turns
    invisible adaptation into visible progress. Could be a toggle.
  - **Build in two phases:** (1) persist Word Wrangler results into `CharStats`
    (plumbing already exists but is unused by this mode — only Random Run writes to it),
    add a decaying difficulty score, and weight `pick()`; (2) add the confusion matrix +
    minimal-pair drilling. **Design the phase-1 storage schema up front to hold the
    confusion matrix** so phase 2 needs no migration.
- **Build the "music sense" of Morse (fluency over lookup-table decoding).** A club
  elmer describes Morse as *music* — the fast path is letting sounds become words
  (gestalt rhythm recognition), the dead-end is picturing dits/dahs and matching a
  lookup table (serial decoding, hard ceiling ~15–20 WPM). These enhancements are all
  aimed at killing the lookup habit and rewarding the reflex that replaces it:
  - **Recognition latency as a first-class metric (the keystone).** Accuracy can't tell
    the two paths apart — you can be 100% accurate and still be *slowly* looking each
    letter up. Latency exposes it: a lookup delay grows with character complexity (you
    hesitate on Q/Z, breeze through E/T); fluency is flat and fast regardless. Timestamp
    end-of-sound → keypress, surface **median recognition time** in the HUD next to
    accuracy, and keep a **per-character latency profile**. Characters that are
    *slow-but-accurate* are the ones still trapped in the lookup table — invisible to the
    accuracy heatmap. Also feeds the parked adaptive-biasing feature a second signal
    (bias toward slow-but-correct, not just missed).
    - **Reflex mode (optional):** a response window a beat or two after the sound — answer
      in time or it's a miss. Nothing kills counting faster than having no time to count.
  - **Rhythm call-and-response (tap it back).** Play a character; instead of typing the
    letter, the user **taps its rhythm on the spacebar** (short = dit, long = dah), scored
    against the engine's dit/dah/spacing model. It's "clap back the rhythm" from a music
    classroom: trains the internal rhythmic template directly, has *nothing* to do with
    letter names (so the lookup table can't game it), and sits on top of the parked
    keyer-input work as zero-hardware sending practice.
  - **Learn phrases as licks, not spellings.** Extend Word Wrangler's word-gestalt idea to
    ham radio's high-frequency fixed phrases — `CQ`, `DE`, `73`, `599`, `TU`, `ES`, `RST`,
    `QRZ`, common call-sign fragments — drilled as single sound units. A fluent op hears
    these as one sound, never as letters. Builds a vocabulary of instantly-recognized
    phrases (the CW equivalent of a musician's licks) that leads into head-copy (mode 5),
    the "playing by ear" endgame. Could ship as a Word Wrangler word-list. **Confirmed as
    a real priority (2026-07-13)** — of everything bounced around in that session's
    brainstorm, this is the one the user specifically wants kept on the list, with
    **Q-codes and common RST numbers** named as the priority content to cover first
    (over the fuller CQ/DE/73/callsign-fragment set above). Cheapest possible version:
    just a new word-list text file — no new mode, no new engine work, reuses the
    adaptive-difficulty tracking Word Wrangler already has.
  - **Kill the dit-dah crutch (app-wide principle).** Never present dots-and-dashes as the
    *primary* representation — every rendered `·—··` reinforces the lookup table. Represent
    characters by **sound** and by **letter**, not by symbol. Musician-friendly exception:
    where a reference is genuinely needed (post-miss reveal, cheat sheet), render the
    character in **rhythmic notation** — dit as an eighth note, dah as a dotted quarter
    (the 3:1 ratio is exact), beamed into the character's shape. Reframes the mental model
    from "code to decrypt" to "rhythm to feel."
  - **Timing tactics that force the musical mode.**
    - **Character-speed floor** — counting is only *possible* below ~15 WPM char speed.
      Nudge/gently-lock char speed high while Farnsworth spacing carries the comfort, with
      a one-line explanation. The engine's dual-speed model already supports this.
    - **Progressive compression toward prosody** — as accuracy holds, quietly shrink
      Farnsworth spacing (not char speed) so letters flow into words and words into
      phrases. The "music" emerges as inter-character gaps tighten toward speech-like
      phrasing.
    - **Optional metronome priming** — a faint underlying pulse the Morse rides on, so
      spacing is perceived as musical beats. Easy to A/B.
  - **Suggested sequencing:** latency tracking first (small; upgrades every existing mode
    and the adaptive feature), then rhythm tap-back (boldest new mode), with the
    dit-dah/rhythm-notation principle adopted as a cheap guardrail throughout.
- **Create RPG-style eagerness to practice (fighting the "peripheral hobby" problem).**
  Adult hobbyists have free time in *minutes, not hours*, and self-paced practice loses
  the four things that made immersive learning (e.g. high-school music) work: **massed
  time**, **legible progress**, **an ensemble**, and **a conductor** ("no — back to
  measure 40!"). RPGs create quest-to-quest eagerness precisely by nailing all four: the
  next step is always smaller than your appetite for it, progress is a bar that visibly
  fills, a party is counting on you, and a quest log removes the burden of deciding what
  to do next. Reframe worth holding onto: the scattered-minutes condition isn't a
  handicap — **spaced repetition beats massed practice for retention**, so well-delivered
  daily minutes build CW *faster* than a monthly grind. Design to the periphery instead of
  fighting it.
  - **An assigning coach — the "conductor" (keystone).** The biggest tax on an adult
    hobbyist isn't the practice, it's *deciding what to do with 7 free minutes* — decision
    fatigue kills the session before it starts. Build an opinionated coach that, on open,
    diagnoses from the latency + confusion data (see the two features above) and assigns a
    concrete, bite-sized objective: "Your L/F confusion crept back and your Q is
    slow-but-accurate — 4-minute drill, go." And the "back to measure 40" part: on a flub
    it **loops you back immediately** (redo it now, N clean reps, *then* release) —
    deliberate practice, not passive exposure. Solitary self-pacing can never provide this
    itself. **This is only as good as its diagnostics — it, the adaptive biasing, and the
    latency metric are really one system.**
  - **Atomic unit = minutes, not sessions.** Ship the **Daily Set**: a 3–5 minute,
    fully-completable, always-different assignment with a clear finish line and a reward.
    Completable-in-one-sitting is the whole point — it fits real free time and it *ends*,
    which is what makes you willing to start. Then weaponize the unschedulable minutes:
    **micro-drills / ambient practice** (a one-word widget; a notification that *is* a
    30-second drill), and **the appointment** — a fixed-time daily challenge gives a reason
    to open the app *today specifically*, the thing self-paced activity fatally lacks.
  - **Make progress legible — a character sheet.** Diffuse progress is invisible progress.
    **Speed-at-90% is your level** (already the honest headline number — surface it with a
    climbing graph). **Retiring a weakness is a defeated enemy** — "you now own the letter
    Q," celebrated, made earnable by the confusion/latency data. **Always show the
    almost-full bar** — the next unlock and how close it is (Koch levels are already an XP
    track; dress them as one).
  - **Manufacture the ensemble — via the club (HPBARC).** Can't recreate a band room solo,
    but the club is a real band. Beyond the parked shared-seed daily challenge: **co-op,
    not just leaderboard** — a club **Field Day total** everyone contributes QSOs toward, a
    shared bar the group fills (your reps matter to the group = the marching-band feeling);
    **shared daily seed** compared at the meeting (bounded, social, high-visibility — fits
    the club energy rubric); **the elmer as conductor** — a mentor sees your dashboard and
    lobs a challenge (the human "back to measure 40," lands harder than any algorithm);
    **VBand as the live gig** (already the parked graduation target — the performance the
    practice is *for*).
  - **The eagerness layer (RPG spice on top).** Once the structure exists, cheap tricks
    manufacture anticipation: **cliffhangers** (end a QSO-sim/IF session mid-story so you
    want to come back), **variable rewards, tastefully** (a rare special caller — a famous
    call, a Pacific DXpedition — surfaces occasionally), and **skill-gated unlocks** (new
    contest, band, or cosmetic "rig" earned by hitting a speed; curiosity as fuel).
  - **Suggested keystone:** the assigning coach + the 3-minute Daily Set are the pair that
    converts "ugh, what do I even do" into "the app already knows, go." Everything else
    amplifies those two.
- **Morse-driven adventures / mission campaign (games where copying *matters*).** Inspired
  by Steam's *Sub Morse* but not sniping its IP — build adventures where the player must
  decode a message, understand it, and take the right action toward a mission goal. The
  worry that "realistic scenarios feel limited" is backwards: the scarce resource isn't
  scenarios, it's **diegetic reasons Morse is the only channel** — and once catalogued,
  the level space explodes (history supplies a dozen; sci-fi adds more).
  - **The "why is Morse forced?" generator (this *is* the level generator):**
    1. **Equipment failure** — voice radio dead, but CW / a bare wire punches through
       ("when all else fails, CW" — slow reliable mode beats noise and low power).
    2. **Forced silence** — POW tap code, resistance cells, a sub rigged for silent running.
    3. **Light-only** — Aldis lamp, aircraft nav lights, lighthouse, heliograph / signal
       mirror. *Visual* Morse — a genuinely different skill from audio copy.
    4. **Sound-through-a-medium** — tapping on a hull, pipe, prison wall, earthquake rubble.
    5. **Covert / low-bandwidth** — a beacon, numbers-station transmission, a probe that
       only speaks Morse.
    6. **Distance & power** — weak-signal survival where only slow CW survives the fade.
  - **What makes it a game, not a drill (three mechanics):**
    - **Bidirectional** — don't just copy, *send back correctly* (reuses the planned
      sidetone/keyer echo; "decode the order, key the right acknowledgment").
    - **Semantic consequence** — message content must change what you *do*. Reusable
      action-verbs: **plot** (coordinates → mark a chart), **route** (damage report → send
      the right crew), **choose** (intel → pick a branch), **relay** (copy then re-key
      onward exactly; errors compound), **authenticate** (challenge → correct counter-sign).
      Mis-copy should **fail forward** (wrong action + visible consequence), not hard-wall.
    - **A diegetic clock** — contest-mode speed/accuracy tension wrapped in story stakes:
      the signal is *fading*, the search plane's *pass window* closes, air is *running
      out*, the DF truck is *triangulating you*. This is the RPG-eagerness hook made
      dramatic.
  - **Concept anthology (cheapest-first; all pure browser + Web Audio, no backend):**
    - **Coast station / lighthouse keeper** — ships call in distress; copy position + nature
      of emergency, plot it, dispatch rescue, warn of hazards. *Contest mode reskinned with
      stakes* — escalating traffic = free rate pressure. Cheapest first build (engine
      already exists). Titanic-operator resonance.
    - **Rubble rescue (tap code)** — decode knocks through debris (survivors, injuries, air
      left) → triage and allocate; tap back reassurance. Audio is just *knocks* (trivial,
      evocative); air supply = natural clock.
    - **Aldis lamp at night (visual Morse)** — ship-to-ship under radio silence; the
      **screen flashes** the message, you read *light* Morse and flash back. One-line
      brightness pulse to render, but a *fresh skill* nothing else trains and visually
      striking — a real differentiator vs. audio-only trainers and *Sub Morse*.
    - **Clandestine operator** — best tension mechanic (DF-truck countdown), campaign-ready.
      Full design deep-dive lives in [MORSE-GAMES.md](MORSE-GAMES.md).
    - **Downed aircraft / SAR** — pilot flashes a signal mirror / nav lights to a search
      plane before it passes, or SAR coordinator coaxes a fading beacon for position +
      medical status. Clean time-pressure loop from either seat.
    - **Relay net** — you're the operator *in the middle*: copy inbound, re-key onward
      exactly; fidelity is the game. Natural bridge to a **club co-op** mode (a real relay
      net passing a message down a human chain).
  - **Recommended shape:** an **anthology campaign on one engine** — loop is always
    *receive → comprehend → act → consequence*; each mission swaps a forced-Morse reason, an
    action-verb, and a clock. Cheapest path to lots of content; reuses the parked IF /
    AI-narrator ideas (an LLM could generate mission text and grade freeform actions, but
    scripted vignettes work without it). First three to prototype: **Coast Station**
    (proves the semantic loop on the existing engine), **Aldis Lamp** (cheap *wow*, new
    visual skill), **Clandestine** (best tension, campaign template). Differentiate from
    *Sub Morse* by leaning into coordination/rescue and the visual/light channel rather than
    combat.
- **Strict scoring mode** — real-ARRL-style penalties for busted QSOs, as a toggle.
- **Club angle** — shared daily-challenge seed; compare scores at a meeting.
  Fits the "social, bounded, high-visibility" energy rubric.
- **Challenge mode: confusion-pair & digraph drills, with badges that "look as real as
  they feel" (2026-07-13).** Surfaced by a user noticing Word Wrangler serves very few
  "qu" words — turned out to be plain letter-frequency rarity (~1% of the word list),
  not a bug, which led to a real idea: a dedicated drill mode targeting the specific
  letter combinations that actually trip people up, with milestone badges to match.
  Explicit tone constraint from the user: **"not trying to turn it into Beat Saber" —
  a little gamification, not an arcade layer.** That constraint actually points at the
  right answer: the most on-brand "gamification" here is borrowing *real* ham culture
  (paper certificates, QSL cards, award nets), which is already understated, rather than
  inventing flashy game chrome — consistent with "ham-centric, not a kids' typing game"
  above.
  - **Two different drills, because they're two different skills.** Don't lump them
    together:
    - **Reversal-pair discrimination.** `G/W`, `L/F`, `Q/Y` (as the user named them) are
      the exact three genuine Morse **reversal pairs** already identified under
      Adaptive difficulty above — the pattern read backward *is* the other letter
      (L `.-..` reversed is F's `..-.`; Q `--.-` reversed is Y's `-.--`; W `.--`
      reversed is G's `--.`). A challenge built around *one named pair at a time* — a
      focused stream of just those two characters (and words containing them) — turns
      "the ear grabs the right dots/dashes but scrambles their order" from a diagnosed
      weakness into a nameable, beatable opponent. The per-character difficulty data
      already shipped (`recordTiming()`'s `CharStat.difficulty`, Word Wrangler + Random
      Run) already knows which pair is live-confusing a given player right now — the
      parked "assigning coach" idea could recommend the right challenge directly
      ("your L/F confusion crept back — try the L/F Buster").
    - **Digraph chunking — QU, CK, and similar.** Not a confusion pair at all (Q and U
      don't sound alike or invert into each other) — it's a spelling regularity (Q is
      almost always followed by U in English; CK is a common word-final pair). The goal
      here is chunking, not discrimination: hearing "QU" or "CK" as one fluent unit
      instead of two separately-decoded letters — the same "phrases as licks" idea
      already parked for prosigns/callsigns, applied to ordinary spelling patterns.
  - **Badges modeled on real ham awards, not generic game badges.** A few ideas, all
    aimed at "this represents something a real operator would recognize," not a
    points-and-confetti layer:
    - **License-class WPM milestones.** The campaign's own WPM curve is already
      anchored to real license speeds (5=Novice, 13=General, 20=Extra — see
      `MORSE-GAMES.md`'s "Speed as the difficulty gate"). The *same* real milestones
      apply to the base trainer directly — hitting 10 WPM (a real, respected
      "everyday working speed," per that section) is worth a concrete, named
      acknowledgment in Random Run/Word Wrangler too, not just in-fiction. This is the
      cheapest, most honest badge to build first, and it's already backed by real
      numbers rather than invented thresholds.
    - **A QSL-card-styled certificate as the actual visual form factor, specifically
      for Contest mode (flagged 2026-07-13 to think through more later — not designed
      yet).** Real hams collect QSL cards (confirmation postcards) as physical proof of
      contacts — a milestone "badge" designed to look like one (a small card-style
      graphic, not an icon or a progress-bar pop-up) would carry the "looks as real as
      it feels" feeling directly, and it's a cheap, static asset to design once and
      stamp with whatever the milestone is. Adventure mode's equivalent signifier would
      be **rank badges** instead (period insignia, not a QSL card) — see the new note
      under `MORSE-GAMES.md`'s Meta-progression detail. **Risk noted (2026-07-13):** a
      QSL card is a very specific, recognizable real object — a mediocre facsimile risks
      reading as kitsch rather than authentic, which would undermine the exact goal it's
      meant to serve, and there's no in-house art budget to guarantee it looks right.
    - **Lower-risk alternative: a lifetime QSO-count milestone (10 / 100 / 1,000 /
      ...), no artwork required.** Sidesteps the facsimile-risk above entirely while
      staying just as grounded in real ham culture — a running lifetime contact count is
      a genuine, tracked bragging-rights number for real operators (the same instinct as
      a birder's life list). Just needs a persisted running total + a threshold check,
      no visual asset to get right or wrong. Worth treating as the safer default and the
      QSL card as the stretch/nice-to-have on top, not the other way around.
    - **A "Worked All ___" style collection badge for Contest mode**, echoing the real
      ARRL "Worked All States" award — Field Day already tracks unique sections worked
      as its multiplier; surfacing "X of Y sections worked" as a genuine collection
      goal (not just a score multiplier) reuses data that already exists.
    - **A contest-certificate summary for a strong Field Day session** — real contests
      issue certificates/plaques; a session summary styled the same way (rather than
      just numbers in a modal) would be a cheap, authentic payoff for a good run.
    - **Retiring a confusion pair earns its own small badge** — "you now own L and F"
      (already the RPG-eagerness section's phrasing above), specifically tied to
      clearing the reversal-pair challenge described above, not just general accuracy.
  - **Restraint note, given the Beat Saber caveat:** keep the *frequency* of badges low
    and the *meaning* high — a handful of real, well-earned milestones (WPM classes, a
    couple of named confusion pairs, one contest certificate) beats a long checklist of
    minor achievements. The goal is confidence at a few real moments (like the user's
    own "just hit 10 WPM, feels like a milestone"), not a constant drip of dopamine
    pings.

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
