# Morse Adventures — Game Design & World-Building

A brainstorming / world-building space for **Morse-driven games** — immersive mission
capsules where copying and sending Morse *is* the gameplay, not a drill. This is
deliberately separate from [PROJECT-PLAN.md](PROJECT-PLAN.md): that doc is the base
training app (Random Run, Word Wrangler, contests, Reading…); this one is for game
concepts, narrative, and the more game-like interface they may need. Ideas here can
graduate into PROJECT-PLAN once they're concrete enough to build, or spin out entirely
if they outgrow the trainer.

## Design pillars — the "game-capsule"

The target experience: **jump in, play through, accumulate experience, jump out when
real-life responsibilities appear.** Everything below serves that.

- **Fast in.** No long setup or config wall. Pick a mission (or "continue campaign") and
  you're operating within seconds. The trainer's settings live elsewhere; a capsule
  inherits sane defaults and adapts difficulty automatically.
- **Bounded.** A capsule is short and finishable — a few minutes for a micro-beat, up to
  **~10 minutes for a full mission / "day"** (a tempo proven by Minecraft's ~10-min daylight
  and Stardew Valley's day clock; cf. the 3–5 min **Daily Set** in PROJECT-PLAN). Clear
  objective, clear finish line — so you're always willing to start, and short enough to stay
  interruptible.
- **Experience accumulates.** Progress persists across capsules (XP, campaign state,
  skill/speed growth, story flags) in `localStorage`, so short sessions compound into a
  long arc. The reward for a capsule is both *in-fiction* (mission outcome) and
  *meta* (you got faster / unlocked something).
- **Immersive.** Unlike the utilitarian trainer chrome, a capsule should *transport* you
  — full-viewport, themed, diegetic. The fiction is the motivation engine (you copy
  harder because you want to know what the message says).

### The interruptibility constraint (a first-class pillar)

This is the one that most shapes the design, and it's easy to underrate. A Steam game
assumes you commit an hour. A game-capsule must assume **a kid walks in mid-mission.**
So:

- **Interruptible without loss.** Either capsules are short enough that abandoning one
  costs little, or state checkpoints frequently (e.g. after each copied message) so you
  resume exactly where you were.
- **Diegetic pause.** Don't break immersion with a sterile "PAUSED" box — go to fiction:
  "signal lost — went to ground," "took cover," "battery conserved." Resume drops you
  back in-world.
- **Real-time tension needs a graceful freeze.** Mechanics like the DF-truck countdown
  (below) must pause cleanly and not punish a mid-mission interruption. The clock is a
  *game* clock, not a wall clock — it only advances while you're actually operating.
- **Roguelike "run" framing fits well.** Self-contained runs with permanent meta-progress
  match the jump-in/jump-out rhythm: lose a run, keep the experience.

## Architecture & look-and-feel: fit inside MorseGames, or fork?

The user's open question: keep the MorseGames look & feel for these modes, or — if
"Morse Adventures" is too different — build a whole new, more game-like interface.

**The key realization: the shared core is the *engine*, not the UI.** The hard,
valuable, correctness-critical asset is [`MorseEngine`](src/audio/morse-engine.ts)
(Web Audio, dual-speed Farnsworth, exact timing, `playString`) plus the stats/storage
spine. As long as a game consumes `MorseEngine`, its *visual* layer can diverge as far
as it likes without duplicating anything that's hard to get right. The look & feel
doesn't have to be a constraint on the game — only the engine contract does.

**Two existing facts make immersive modes cheap to bolt on:**
1. The **mode contract is trivial** — [`main.ts`](src/main.ts) just calls `mount()` /
   `unmount()` on a class that owns `#mode-root`. A game is "just another mode" as far
   as wiring goes.
2. There's already a **full-viewport overlay pattern** — the `Modal` class appends a
   `.modal-overlay` to `document.body` and covers the whole screen. A game capsule can do
   the same: paint a **fixed, full-viewport, independently-themed immersive layer** over
   the trainer chrome, with its own exit back to the hub. No need to fight the header /
   tabs / `max-width: 720px` shell — just cover it.

**Options, cheapest-first:**

- **A. Games as themed modes in the existing shell.** Each game is a mode class that
  brings its own scoped CSS. Simplest, but the trainer header/tabs leak into the frame
  and dilute immersion. Fine for a light game, weak for a "capsule."
- **B. An "Adventures" hub tab that launches full-bleed capsules (recommended).** One tab
  opens a mission-select / campaign map; launching a mission raises the full-viewport
  immersive overlay (per the Modal precedent), hides all trainer chrome, and runs the
  capsule in its own aesthetic. Exit returns to the hub. **Same codebase, same engine,
  same persisted stats — but a real visual "mode switch" into game-space.** Best
  balance of reuse and immersion.
- **C. Separate app (`MorseAdventures`).** Its own build, importing `MorseEngine` as a
  shared library. Total creative freedom, but duplicates plumbing, *splits progress
  across two apps* (losing the "one place my progress lives" benefit), and doubles
  maintenance. Only justified if the interaction model diverges so far that the shared
  shell becomes a straitjacket.

**Recommendation:** start with **B**. Keep engine + stats + storage as the shared core;
give the mode contract an optional "immersive" flag that hides chrome. Fork to **C**
only if a game's UX genuinely can't live in the same tree. Design so that decision stays
cheap to make later.

**Shared visual DNA (reassurance on look & feel).** The trainer aesthetic is already
"operator's equipment": dark panel (`#0f1419` / `#1a2330`), a glowing cyan **signal**
accent (`#4fc3f7`), letter-spaced header. That's a strong foundation for a *radio-room*
game look — the games can feel like a dressed-up, full-screen extension of the same
"operator's desk" vibe rather than a foreign object. Per-game skins can push further
(CRT/phosphor green or amber for a period set, teletype/monospace text, a chart/map, a
signal-strength meter) while inheriting the base palette variables, so nothing clashes.

## Game concept: Clandestine Operator (deep dive)

The first and most structurally elegant concept. A covert radio operator — behind enemy
lines or on a remote outpost — living by the key.

### The core insight: the three activities *are* the three Morse verbs

- **RECEIVE** — orders and warnings from HQ ("be given critical information," incl.
  *"they're on to you — RELOCATE!"*).
- **SEND** — your reports back to HQ ("pass along important messages").
- **INTERCEPT** — copying enemy traffic you were never meant to hear ("gather information
  from enemy transmissions").

Receive / send / intercept is the complete set — which is why this *one* game is a
complete trainer in disguise. Most Morse games only exercise receive; this has a
diegetic reason to drill all three, and the fiction makes each feel distinct.

### Structural model: the single-room set (*Papers, Please* + Hitchcock)

How do you keep one room compelling for hours? Two proven references (credit: a family
brainstorm). ***Papers, Please*** is the best structural template we've found — a
single-desk game where the world comes to *you* through documents — and the radio room
maps onto it almost one-for-one, then improves on it.

- **The P,P loop is our loop** — inspect-and-decide → **copy-and-act**. Near every P,P
  system has a radio-room twin:
  - **Growing rulebook = growing codebook.** New regulations each day → new prosigns,
    brevity codes, callsigns, message types. The expanding rulebook *is* the **Koch ramp**
    — difficulty delivered diegetically.
  - **Day-shift = the capsule.** P,P's bounded daily shift with an end-of-day tally is
    exactly our **jump-in-jump-out** unit (~10 min mission/"day"; see *Representing the
    passage of time* below). A "shift at the set" = a capsule.
  - **Family-survival economics = the battery/rations resource clock** — speed-vs-accuracy
    pressure with someone depending on your throughput.
  - **Moral branching via petitioners = act-on-it / relay-it choices** from intercepts and
    requests (act on questionable intel? relay a doubtful order? help a distressed station
    at your own risk?).
  - **Narrative-through-documents = narrative-through-traffic** (+ letters from home). No
    cutscenes — the story *is* the in-tray.
  - **Recurring faces = recurring callsigns / fists** — attachment built through regulars
    you know by their call and their fist (the cameo **Method** above).
- **Standout synthesis — the rulebook-under-pressure *is* the lookup-table → fluency arc.**
  In P,P you flip the rulebook to verify; here you'd consult a codebook / callsign roster /
  frequency schedule while the clock ticks — and **internalizing it so you stop flipping is
  the skill curve.** Early: flip constantly, slow. Late: it's in your head, fast. The
  visible rulebook-flip is the "lookup-table stage" from the music-sense brainstorm made
  *diegetic* — the game dramatizes the exact fluency journey the trainer teaches.
- **Why the radio room beats the passport booth** — confinement is *totally* justified (an
  operator really is chained to the set); the "document" must be decoded *by ear* (a real
  skill, not a visual compare); and the threat is **unseen**.
- **The Hitchcock layer (unseen menace in four walls).** *Rear Window*, *Lifeboat*, *Rope*:
  the danger is out there, felt but never shown. The DF truck you can *hear* closing but
  never see is pure Hitchcock dread — confinement heightens tension, single POV builds
  identification, dramatic irony (you know something dangerous) does the rest.
- **Tone caveat:** borrow P,P's *structure*, not its bleakness. The oppression of the booth
  is *its* theme; keep our warmer *Father Goose* tone.

### Representing the passage of time (light, not a stopwatch)

Orthogonal to the "day clock" is *how* time's passage is shown. Goal: **pull the player with
goals, don't push them with a ticking timer** — yet make the arc *felt*, so a midnight
climax feels earned. Two layers of time, deliberately different:

- **Acute tension clocks** (the DF triangulation, a patrol window) — sharp and
  real-time-ish, but *brief and local*, and diegetically pausable. These are the spikes of
  dread.
- **The ambient mission clock** — *soft* and **progress-coupled, not a countdown.** It
  advances as the player *achieves goals*, à la **HL2** (the day progresses as you move
  through the map). No punishment for dawdling; the pull is wanting the next objective, not
  fear of a timer.
- **Show time with color temperature (cheap and gorgeous).** Like **HL2 / Skyrim /
  Fallout 4**, let light carry it: the window, the oil lamp, the dial glow shift
  warm-afternoon → amber-dusk → cool-blue-night as mission beats complete. **In a single
  room the light *is* both the clock and the progress bar** — felt, never counted. Trivial
  in-browser (animate the palette variables / a gradient wash; rides on the per-game-skin
  note). Deeply *Rear Window*, too — Hitchcock told time and mood through the courtyard's
  changing light.
- **The felt climax.** Because time accumulated *through the light* as goals were hit,
  arriving at the end — a **midnight evacuation in a frighteningly small boat** — *feels
  like it happened*: earned and atmospheric, not arbitrary. Emotional pacing over stopwatch
  pacing.
- **Tempo.** ~10 minutes is a proven mission/"day" length (Minecraft's ~10-min daylight,
  Stardew's day clock). Sits above the 3–5 min micro-capsule and stays interruptible via
  checkpoints.

### The marquee mechanic: the direction-finder closing in

The best speed/accuracy tension in the anthology. Every second you transmit, enemy DF
stations triangulate you.

- **Render it literally** — bearing lines on a map converging toward your position, plus
  a "heat" gauge filling.
- **Sending errors are doubly punishing** — a garble forces a re-send → more airtime →
  bearings close faster. This fuses send-accuracy *and* send-speed into one pressure
  (the deliberate-practice squeeze a plain drill can't manufacture).
- **Brevity is survival** — real operators used Q-codes, prosigns, and brevity
  abbreviations to minimize airtime. Make it a mechanic: the better you know the codes,
  the shorter the transmission, the safer you are. (This weaponizes the "phrases as
  licks" idea — learning `QTH`, `QSY`, `AR`, `SK` keeps you alive.)
- **Relocation** — the escape valve. High heat (or a "RELOCATE" order) → pack up and
  move: resets the DF, costs time, may make you miss a scheduled contact.
- **Split transmissions (advanced)** — send a long report in bursts across windows to
  stay under the detection threshold.
- Ties into the interruptibility pillar: this clock is a **game clock**, advancing only
  while operating, and it freezes diegetically on pause.

### Two settings (same engine, different skin + one signature constraint)

- **Pacific coastwatcher (recommended default).** Real, underused, tonally clean — the
  Solomons Coastwatchers reported the "Tokyo Express," fed Guadalcanal, and rescued
  downed airmen (incl. a young JFK). A *heroic observer* fantasy, not combat.
  - **Observe → encode → report** — spot a fleet through the trees ("3 destroyers +
    1 carrier, NW, dawn"), encode a compact report, transmit before the daily enemy
    patrol sweeps the ridge. The observation puzzle adds a fresh verb.
  - **Battery / generator fuel as a resource clock** — a remote set runs on limited
    power; every transmission drains it, resupply is scarce. A second, slower clock under
    the DF timer.
- **SOE agent in occupied Europe (alternate flavor).** Urban, tenser, cloak-and-dagger:
  safe houses, curfews, the DF truck driving the streets on your map.
  - Signature real detail — the **BBC "personal messages":** copy an innocuous phrase off
    the nightly broadcast that's actually the go-signal for a parachute drop, then receive
    the drop's coordinates and time. Coordinating drops is a great **plot**-verb mission.

### What each verb trains (it's still a trainer)

- **RECEIVE** — copy from HQ under fade/noise at rising speed. Scheduled **"skeds"**
  (fixed time + frequency) are historically real *and* double as the daily-appointment
  eagerness hook. The "RELOCATE" warning is a copy-then-*act* moment.
- **SEND** — accuracy + speed under the DF gun. The best sending-practice pressure we can
  build.
- **INTERCEPT** — copy enemy traffic, often as **5-letter cipher groups** you don't
  understand. The purest fluency drill in the app: no meaning to guess from → no
  lookup-table crutch → you must copy the *sound*. Exactly the "music sense" goal. HQ
  "decrypts" it after; your job is faithful copy.

### Why this is the keystone that synthesizes the plan

Not just another mode — it *reuses almost everything parked in PROJECT-PLAN*:

- **Koch speed = difficulty** (HQ slow, enemy fast) — the dual-speed engine *is* the
  difficulty curve.
- **The frequency dial** (parked Search & Pounce mechanic) — tune across the band to
  *find* the enemy signal to intercept.
- **Sidetone / keyer** — the send loop; eventually a real key.
- **Relay net** — your "network" of agents/cells; passing messages between them, with
  captured contacts carrying story weight.
- **The coach / conductor** — frames and assigns missions; the campaign becomes the
  quest log.

### Tone

Keep it craft-focused and tasteful — the fantasy is the *operator's skill and nerve*
(copy clean, send fast, evade the DF), not violence. The Coastwatcher framing makes that
easy and even uplifting (you're saving airmen, not attacking anyone).

## Campaign, progression & world (Clandestine Operator)

Additional world-building — several of these resolve open threads.

- **Rank as levels — and rank changes the *role*.** Start at the lowest rank and climb,
  RPG-style. The important twist: rank shouldn't just mean "same loop, faster" — at high
  ranks the gameplay *shifts*. Low rank = you're the operator at the key (tactical copy /
  send / evade). High rank = you **receive reports from a network of operators and use
  them strategically** — prioritize, coordinate, make the call. The endgame becomes a
  strategy layer, echoing the coast-station coordinator role, and keeps the game evolving
  rather than grinding. Rank is the meta-progression currency: it gates missions,
  difficulty, and eventually the strategic view. **Concretely realized** as the Magic
  Carpet coordination finale — see **Mission allocation draft** below.
  - **Enlisted ceiling & the Technician track — grounded in research (2026-07-07).** The
    real WWII US Army enlisted ladder, ascending: Private → Private First Class → Corporal →
    Sergeant → Staff Sergeant → Technical Sergeant → First Sergeant / Master Sergeant (top,
    tied). Alongside it ran the **Technician grades** (T/5, T/4, T/3 — created Jan. 1942),
    paid at Corporal/Sergeant/Staff Sergeant rates but *without* command authority — real
    soldiers griped about the distinction (same pay, "not real stripes"; the insignia didn't
    even differ until Sept. 1942). **Adopted as GOOSE's advancement track**: fits a solo
    specialist better than command NCO ranks, and hands the humility theme to the rank
    system itself — not really a sergeant, just good with a key.
    - **Real precedent, same setting.** Corporal Frank Nash, on an Army Air Corps
      signals-construction detachment sent to Guadalcanal, volunteered to stay and operate
      solo for coastwatcher **Reg Evans** (see Easter eggs below) in the Blackett Strait /
      Kolombangara area — this demo's own setting. Not just plausible; it happened, in the
      same place, doing the same job.
    - **"No brass out here" is GI folklore, not literal setting fact.** The real Coastwatcher
      officers (Evans, Read, Mason, Clemens) held actual commissions and were
      forward-deployed themselves — the genuine exception that proves how dangerous the work
      was. Bill/KEN/GOOSE stay a simplified, fictionalized American chain rather than a model
      of the real joint Allied command structure, so the grumbling is honest soldier's-eye
      perception, not a rule the fiction has to defend. Sample line: *"We're sleeping on
      bug-infested cots while the brass is on the big island with ceiling fans and beer."*
    - Sources:
      [US Army enlisted rank insignia of WWII](https://en.wikipedia.org/wiki/United_States_Army_enlisted_rank_insignia_of_World_War_II),
      [Coast Watchers in the Solomons](https://warfarehistorynetwork.com/article/coast-watchers-in-the-solomons/).
- **Messages from home (pacing & character).** Interleave personal letters between tense
  field missions — a **low-pressure, no-DF-timer, slower, warmer copy** that acts as a
  palate cleanser and honors the interruptibility pillar (a calm capsule you can always
  break out of). They build character and stakes (family, a sweetheart), pay off the
  "pining for home" beat, and carry the emotional reward that makes the danger *matter*.
  Occasionally two-way: copy a letter, key a short reply home.
- **Period pop-culture texture — Americana flavor (2026-07-08).** As missions, notes, and
  backstory get written, feel free to sprinkle in real, dated-to-the-era Americana for
  immersion — Captain America comics, big-league baseball (teams, players, box scores),
  home-front brand names like Ovaltine, radio serials, swing bands. Cheap, evocative texture
  that costs nothing to add and makes the period feel lived-in rather than researched.
  - **Natural homes for it:** the letters-from-home beat above (a kid brother's comic-book
    haul, a box score clipped from the paper), the Notes panel's accretive backstory device
    (see **The operator**'s "reveal by noticing" — a rhythm/music-minded protagonist might
    notice a radio drummer or a ballpark organ before he notices anything tactical), and
    transition-screen diary asides.
  - **Lower stakes than the real-person Method.** The **Method** and **Real history as
    milestone missions** guardrails above exist because naming real people/units carries an
    ethics weight and demands verified accuracy. Products, comics, and ballclubs don't
    carry that same weight — use them freely as flavor, not as rare, careful cameos.
  - **One guardrail: keep it dated to the mission's actual moment.** The Solomons spine runs
    Aug 1942 → late 1943 (see **Campaign structure & pacing** below); a reference should be
    plausible for *that* month, not just "the '40s" in general (e.g. Captain America Comics
    launched March 1941, so it's fair game throughout, but a specific comic-book storyline
    or a specific pennant race should check its real date against the scene's).
- **Onboarding — a stateside training base as a real place with real stakes (Act 1).** Not
  skipped, but not a sterile HL1 *Hazard Course* either. The HL2 *Train Station* lesson is
  "no *sterile* place," not "no base" — so the base is a legitimate, dramatic first act.
  - **Location: Camp Murphy, Florida (2026-07-07).** A real WWII Signal Corps school,
    remote South Florida backcountry near Stuart/Jupiter (today's Jonathan Dickinson State
    Park) — genuinely about as alien to most inland trainees as anywhere stateside, so the
    "never traveled" induction shock starts before he ever reaches the Pacific. **One
    deliberate liberty:** the real Camp Murphy trained radar operators specifically, not
    general CW/radio operators (that was mainly Fort Monmouth, NJ — not Southern); using it
    here for a CW trainee is a small, acknowledged creative license for a real, atmospheric
    Southern setting, not a claim about its actual wartime curriculum.
  Key insight: **a training base *licenses* the repetition skill-building needs** — "of
  course you drill for weeks at boot camp" — so iteration feels *earned*, not grindy. Opens
  on the induction-shock beat — see **the operator**'s "never traveled" note below for the
  sample cold-open voice. This is the natural home for the **Koch ramp** (characters,
  prosigns, brevity codes, the send/receive loop) and for drilling in the **authenticator
  codes** (see **Level type — the relay net** below) early, as standing procedure rather
  than a late-game twist. Two goals run in parallel and keep it
  from being an empty tutorial:
  1. **Primary — get shipped out:** reach the skill bar (the Koch / prosign / brevity-code
     mastery gate = the graduation mechanic). This is a **genuine competency gate** — but
     revised 2026-07-10 (see **Training Day design** below for the full reasoning): rather
     than full Koch character set + prosigns, graduation gates on **7.5 WPM effective,
     sustained accuracy, at whatever Koch subset training actually covers** — favoring
     *speed* over *character-set completeness* as the pass criterion, since speed is
     already established as the game's real difficulty axis (see **Speed as the difficulty
     gate** below). Not a formality: if you can't copy at a basic clip you genuinely aren't
     ready for the field, so the gate protects you from a deep end that wouldn't be fun,
     and it lets every field mission safely *assume* a speed baseline (not a vocabulary
     baseline — see below for why full vocabulary coverage is neither achievable nor
     desirable from training alone). The elegant part still holds: it makes fiction and
     pedagogy the *same thing* — **"ready to ship out" literally means "able to copy CW at
     speed."** No divergence between game goal and learning goal (the holy grail for
     edutainment).
  2. **Optional — solve the intrigue:** a mystery/problem that emerges *during* training,
     giving real stakes early, for players who want to dig.
  - **The mystery earns its keep two ways:** it introduces mechanics *diegetically* and
    *foreshadows the field*. Hooks — a clandestine signal on the band during night drills
    you're "not supposed to hear" (introduces **INTERCEPT** before deployment); a saboteur
    leaking the training schedule; a coded practice message hiding a real clue. Optional to
    pursue (skippable if you just want to ship out), and it can thread into the enemy
    network faced overseas, connecting Act 1 to the campaign.
  - **Replay value — the mystery is a second-playthrough reward (layered design).** First
    time through you're cognitively saturated just learning to copy, so the intrigue stays
    subtle background. Once you're fluent (or on a fresh run) you have spare capacity to
    *notice and suss it out* — the same content rewarding mastery differently (you see new
    things once you're not fighting the controls). Make it **variable** — a whodunit with a
    randomized culprit / clue trail, or a bank of mystery templates — so replays stay fresh,
    feeding the roguelike-run / jump-in-jump-out pillar. One Act 1 then serves everyone:
    newcomers barely register the mystery, veterans blast the competency gate and focus on
    the puzzle.
  - The instructor — **Andy**, a *harried corporal* / mentor — lives here and carries the
    **coach/conductor persona** from PROJECT-PLAN's "assigning coach" idea: Andy's dialogue
    *is* the coach mechanic, diegetically — no dashboard, no meta-UI, just Andy voicing
    what the latency/difficulty data (shipped 2026-07-10 in `stats/storage.ts`) already
    knows ("your dah's dragging on M, one more pass"). Tone: tough-but-fair, brief — real
    drill instructors had hours; we have minutes, so Andy's toughness has to read as
    honesty and economy, not volume. Reinforces the reluctant-hero *Father Goose* tone (a
    nobody who turns out to matter).
  - **Training Day design (2026-07-10) — the first playable training level.** Sketched
    while validating the gating mechanics feel right, not yet built:
    - **Reuse Random Run, themed — don't invent a new mechanic.** Random Run's existing
      loop (Koch-gated character set, graduate via correct reps, free replay via Space, no
      penalty for wrong answers) already satisfies "replays aren't forced" — the training
      level is a cold-open card + Andy's framing wrapped around that mechanic, not a
      bespoke shack-style capsule. Prove the loop cheaply before dressing it up, same
      instinct that built the Kolombangara demo.
    - **Koch coverage is necessarily partial, and that's fine — checked against real data.**
      Adventure mode's actual vocabulary (every codebook word/proword/callsign) uses 24 of
      26 letters (only J and X never appear) — but the standard Koch order (`KOCH_ORDER`
      in `koch.ts`, the real LCWO/G4FON sequence) interleaves digits and punctuation with
      letters from very early on (the AR prosign at position 14, BT at 17) and doesn't
      complete the alphabet until its very last slot. The last letter Adventure needs (D)
      doesn't appear until position 38 of 41 — reaching it means picking up nearly all the
      digits/punctuation along the way regardless. **Decision: don't chase full coverage.**
      Freeze training's Koch level early (covers the common letters solid), and let the
      stragglers (the B/C/D/H/V/G/Q/Z-ish tail) get picked up ambiently during early field
      missions, not as a training pre-req.
    - **Graduation favors speed over Koch level (new mechanic, not yet built).** Today,
      *neither* Random Run nor Word Wrangler ties graduation to WPM at all — it's pure
      correct-rep volume at the current Koch level; speed is just a manual slider. Training
      Day should invert that emphasis: freeze the Koch subset per above, then the actual
      grind is effective WPM (Farnsworth spacing) creeping toward 7.5 as accuracy holds,
      with graduation as "N consecutive clean reps at the target speed," not a raw
      correct-count. Matches "speed is the real gate" directly.
    - **The "did I get enough training for this?!" beat (2026-07-10) — Full Metal Jacket +
      Old Man's War, composed.** The competency gate stays mechanically fair (never an
      unplayable field deep end — that promise doesn't change); what changes is that
      nothing *around* the gate should tell the player they're fully ready. Two registers,
      composed rather than competing:
      - **The personal register (FMJ).** Andy's send-off isn't triumphant — it carries
        honest doubt. Not "you've got this, kid" but closer to "it's not enough. It never
        is. It's what we had time for." He's not lying to GOOSE any more than a drill
        instructor lies about what's coming; he's just out of time.
      - **The institutional register (Old Man's War's "minimum bid").** The reason Andy's
        out of time isn't personal — it's procurement. The gate is calibrated to
        *deployable*, not *mastered*, by policy, from above Andy. **Bill** (already the one
        who promotes/reassigns) is the natural vessel for that pressure if voiced at all —
        the transport leaves Thursday, ready or not. This isn't a new theme grafted on: it's
        the same vein as the Technician-grade "no brass out here" grumbling already in the
        doc, just extended backward from rank to training. It's also historically honest,
        not just borrowed fiction — wartime training pipelines really were compressed under
        manpower pressure.
      - **Guadalcanal Day 1 cashes the feeling in.** The existing "cold open — first sked,
        still shaky" framing should lean into the gap: real static, a KEN who doesn't slow
        down the way Andy did, the first message landing messier than any drill — same fair
        7.5 WPM floor and forgiving AGN loop, just less hand-holding in the *framing*. The
        partial-Koch-coverage decision above stops being a mere technical concession here
        and becomes the mechanism for the feeling: GOOSE will genuinely hit a letter in the
        field he never quite drilled clean.
  - *Design note: a pure "no base, learn entirely in-world" approach was considered and
    rejected — keep the base, just make it compelling and consequential.*
- **The mission-element kit (the shack is the stage; assemble the beats).** The radio
  shack is the setting, but missions are built from a kit of reusable beats, so varied
  content stays cheap:
  - **Control frequency** — tune / find a signal (reuses the Search & Pounce dial).
  - **Decode messages** — receive from HQ / intercept the enemy.
  - **Send reports** — the DF-timer send loop.
  - **React to threats** — relocate, go silent, evade.
  - **Request supplies** — send a requisition; resource management (battery, food, parts).
    Signal Corps background pays off here (2026-07-07): the labor is physical, not just
    administrative — hacking a path up from the beach, hauling jerry cans, antenna work.
    Sample line: *"We hacked a path up from the beach, my shoulders still sore from jerry
    cans. How much gas do we need, anyway?!"* Closes the loop with Bill's own generator-fuel
    grumbling (see the enlisted-ceiling note above) — he worries about supply upstream,
    GOOSE does the hauling downstream.
  - **Messages from home / pining** — the emotional beats above.

  A mission = a sequence assembled from this kit + a clock + stakes. This *is* the
  capsule generator, specific to the shack.
- **A compelling overarching plot (tonal north star: *Father Goose*).** The reluctant,
  humble hero — a scruffy nobody who becomes vital — is the emotional engine, à la
  *Father Goose* (Cary Grant as a reluctant island coastwatcher): warm, wry, human,
  high-stakes-but-hopeful, romance and humor amid danger, **not** grimdark. Arc: arrive
  green → grow into an indispensable node in the network → your reports visibly turn the
  tide → personal relationships deepen (home letters, someone you shelter or help rescue).
  The plot is what pulls you capsule-to-capsule; it needs real forward momentum and
  payoffs, not just escalating difficulty.
- **Islands as selectable difficulty (the map *is* the difficulty menu).** Choose your
  posting: islands closer to enemy bases carry higher threat (faster, denser enemy
  traffic; more frequent patrols; quicker DF triangulation) but richer reward (more
  valuable intel, faster rank, bigger strategic payoff). Classic risk/reward geography,
  fully diegetic — and it maps straight onto the engine's speed knobs (closer island ⇒
  higher enemy WPM). Replaces an abstract difficulty slider with a choice that feels like
  the campaign map itself.
- **HQ signal reports + antenna realism (the honest other half of the power dial).** The
  power knob shouldn't map 1:1 to how well you get out — and the *only* honest measure of
  your signal is the **far end**. So HQ gives **signal reports** and directs power:
  `UR QSA2 QRO` (you're weak — more power), `UR QSA5 QRP` (you're loud — ease off). This
  finally gives the power dial a consequence, and it pairs with the DF as **two ends of one
  needle**: HQ's report is the readability **floor** (be strong enough to copy); the DF is
  the detectability **ceiling** (don't be so loud you're triangulated). Threading that is
  the skill.
  - **Core / early tier:** just the feedback loop — HQ says weak/loud, you adjust power. It
    also drills RST / QSA copy and adds real Q-codes to the codebook (`QRP` reduce power,
    `QRO` increase, `QSA` signal strength, `RST` report) — more "phrases as licks."
  - **Advanced tier (gated, later islands):** power is only one factor. A field-expedient
    **dipole in the trees on ladder line** can reflect most of your power back (high SWR);
    the old tube final doesn't complain — it just cooks the reflected power to **heat in the
    shack** — so *locally everything looks fine while you're barely getting out.* The fix
    isn't more watts, it's the **antenna/match**: re-rig higher, tune the feedline. Make it a
    *tactile* action (raise the dipole, adjust the tuner) with HQ's report as the payoff, and
    gate it to rougher postings so casual play isn't burdened. **Pedagogical gem: you can't
    judge your own signal from the shack — you have to be told.** Risk to manage: like the
    S&P frequency-dial, over-simulating RF physics can tip into fiddly — keep it tactile and
    legible, not a spreadsheet.
  - Ties to **islands-as-difficulty** (worse antenna situations on rougher postings) and to a
    possible dedicated mission ("your antenna came down in the storm — re-rig it").
- **Real history as milestone missions (gravitas).** Two tiers: everyday capsules are
  fictional/generated missions, but **high-profile milestone missions dramatize real
  events and inherit their weight** — the Guadalcanal air-raid warnings, the Bougainville
  Coastwatchers, a real operation running around you. Recognizable groups (**Black Sheep
  Squadron**, **Navajo Code Talkers**) elevate these beats, scaling the historical cameos
  from background flavor (everyday) to featured-with-dignity (milestones). Guardrails:
  - **Keep the player plausibly peripheral** — the "Forrest Gump" restraint. You *relayed
    the warning* that bought Guadalcanal precious minutes; you didn't win the battle. Real
    outcomes stay real; the operator is a believable small thread in them.
  - **The real Solomons timeline is the progression spine** — Guadalcanal (1942) → New
    Georgia / Munda → Bougainville (1943)… so islands-as-difficulty isn't arbitrary; it's
    the actual chronological/geographic march of the campaign, and climbing rank walks the
    player forward through history.
  - **Handle real loss with care** — dramatize the courage and the stakes, never
    trivialize the cost.
  - **Avoid the escort-mission feel — reality is already on our side (2026-07-07).** A
    protect/escort objective risks the classic frustration of a fragile, failable charge.
    Milestone missions dodge this for free: the historical outcome is fixed (Munda's strip
    really did get built), so there's no jeopardy to invent around whether the "escort"
    survives — failure can only ever be personal (a busted report, a close call, more risk
    to GOOSE), never the macro-outcome. Keep it that way deliberately: scope failure
    feedback to the player's own performance, and let the known-good ending carry the
    payoff ("we contributed, in some real way") instead of manufactured suspense. Applies
    to every milestone mission, not just this one.
  - **Milestone mission seed — protecting the Munda Seabees (2026-07-07).** The New
    Georgia / Munda posting's milestone beat. GOOSE misreads an HQ ask as "they want an
    airstrip" — exhausted, assuming he and the scouts are somehow expected to hack one out
    of the jungle by hand (see the "how much chopping does that take?!" line under the
    mission-element kit above). The reveal recontextualizes it: the real strip is already
    being built, fast and dangerous, by the 47th/63rd Naval Construction Battalions — the
    actual Munda airfield, built in roughly five days (Aug. 8–12, 1943) under continued
    risk. GOOSE's real job was never the chopping; it's watching the sky over a runway
    that's brutally exposed mid-construction — early warning for the Seabees' heroic,
    unglamorous work. The comedic misconception (personal labor) giving way to real awe
    (someone else's genuine feat, and a real reason his watch matters) is the beat — per
    the **Forrest Gump restraint** above, GOOSE supports and protects; the Seabees do the
    actual, heroic thing.
- **Level control — self-paced navigation (Portal-style, with one twist).** Missions are
  capsules, so let the player move through the plot at their own pace with simple
  **previous / replay / next** controls — the lightweight, in-context form of the islands
  **campaign map / hub** level-select (same system, two fidelities). The twist: unlike
  Portal, our skill *isn't* freely transferable — difficulty ramps via raw copy speed
  (islands-as-difficulty = rising WPM) behind the competency gate, so an unprepared jump to
  a far level is an unreadable wall, not fair-but-hard exploration. So:
  - **Backward + replay: unconditional.** Revisit or replay any *reached* level freely —
    practice at a comfortable level, speedrun, explore, or re-live a story beat. Because
    sightings + skeds are **generated**, every replay is a fresh instance, never a memorised
    rerun: replay masters the level's *difficulty*, not its script. Replayability is free.
  - **Forward: unlock-as-you-clear (which is what Portal actually does).** Its chapter
    select only lists chapters you've *reached*; "skip ahead" = replay unlocked ones, not
    teleport past unseen ones. Same here: `next` advances the story; roam freely among
    unlocked levels; the forward edge stays skill-bound. Honor agency with a *warned*
    "jump ahead" where it fits, but default to earn-it-forward so the WPM ramp and the plot
    both hold.
  - **Exposition fast-forward on replay.** Story frames are fixed per level; let repeat
    visits skip the briefing/notes so speedrunners/explorers aren't slowed — the tactical
    content is what varies.
  - **"Play with the physics" = the RF sandbox.** Our "physics" is frequency / power /
    (later) antenna-SWR; free navigation invites poking at it — off-freq for static, power
    vs. HQ's signal report, HQ's directed answer-back to a deliberately wrong report. Reward
    that curiosity.
  - **Meta-progression caveat.** It's a trainer, so practice should always "count" — but if
    rank/XP gates content, diminish or cap repeat-level rewards so replaying an easy day
    can't farm rank.
  - **UX/chrome:** prev/replay/next belong on a between-mission hub or a pause overlay, not
    the in-play shack — keeps the immersive capsule clean (ties to the full-viewport
    **option B**).
- **Level type — the relay net (addressing becomes a copy target).** In most beats the header
  (`GOOSE DE KEN`) is boilerplate you can skim. A relay-net level makes it **load-bearing**:
  the net has several stations (KEN, SKIP, a forward outpost…), senders vary, and you're the
  relay in the middle — so you *must* copy the **TO DE FROM** addressing and reproduce it
  correctly. Targets the single hardest, highest-value CW skill — **copying callsigns**
  (unguessable, no context) — inside a mission.
  - **The loop.** Inbound `GOOSE DE SKIP QTC KEN K` (SKIP has traffic for KEN) → copy sender +
    destination + body → **acknowledge the sender** (`SKIP DE GOOSE QSL K`) → **forward to the
    destination** (`KEN DE GOOSE {relayed body} K`) → KEN acks. Two correctly-addressed sends,
    right way round (TO DE FROM); swap the to/from and it's misrouted.
  - **Fidelity matters (errors compound).** The relayed body must match what you copied —
    garble it and it fails downstream. The classic relay-net lesson and a hard copy check.
  - **Make the header matter.** Vary senders; include some **not-for-you** traffic
    (`SKIP DE KEN …`) you must recognise and *not* answer — monitoring discipline. Confusable
    callsigns (SKIP/SLIP, KEN/KEM) force careful copy and tie into the confusion-pair /
    adaptive-difficulty idea.
  - **Prowords → codebook licks:** `QTC` (I have traffic for __), `QSP` (relay / I'll relay),
    `AR` (end of message), plus `QSL`/`R`. Grade on **routing (correct TO/FROM) + body
    fidelity**; fail forward with clear feedback (a misrouted message simply never reaches
    KEN). Realises the parked **Relay net** concept, is the mission-context form of the
  - **Authenticator codes — catching an impostor without touching the engine
    (2026-07-07).** Real and grounded on both sides: Japanese radio operators really did
    break onto Allied circuits to imitate friendly traffic ("KO" deception, used in the
    Solomons naval battles); the real Allied countermeasure was a paper authenticator
    table — a challenge/response codeword pair, changed periodically, that a genuine
    station knows and an impostor (or someone working from a stale/captured list) doesn't.
    Pure text and copy discipline — no audio "fist" simulation needed, which would have
    meant perturbing an engine whose whole design pillar is exact timing.
    - **Drilled in early, not sprung late — until it's reflex.** Goes into the codebook
      during **stateside training** (Andy drills it alongside prosigns and brevity codes —
      see Onboarding above and the mission-allocation table's training row 2), repeated
      enough in the training capsules that the player is **inured** to it by the time it
      matters: check the table, send QSL with the response in the same breath, don't think
      about it. Standing procedure by the field, not a twist mechanic bolted on.
    - **A hard rule, not flavor:** a message that fails the current authenticator — wrong
      code, or a stale one — must not be relayed or acted on, full stop. This is what
      "can't listen with half an ear" means mechanically: fluency lets you stop
      sounding-out letters, but it should never let you stop consciously checking trust.
    - **One combined transmission, not a round-trip (2026-07-07, implemented).** Dropping
      the proword would break the mechanism — "I AUTHENTICATE" is what makes the reply
      unambiguous as *the* authentication response rather than a stray digit — but nothing
      requires it to be its own separate exchange. `KEN DE GOOSE QSL I AUTHENTICATE 7 K`
      completes the sked in one transmission, the same way this net already stacks
      multiple prowords into a single message elsewhere. Real accuracy, minimum tedium.
    - **Delivered via the mission briefing, not a separate reference (2026-07-07).** The
      *current* valid code lives in the day's Briefing panel text (the existing upper-left
      panel in the shack — see the Kolombangara worked example above), issued as part of
      HQ's daily orders — plausible on its own terms, since real authenticator tables were
      genuinely distributed via periodic orders. The codebook holds the standing procedure
      (how authentication works, learned once); the briefing holds the day's specific
      instance (what the code actually is right now). This gives the "most players will
      skip ahead" overlap noted in **The transition screen** above real teeth: skipping the
      briefing isn't just redundant anymore, it's the one habit that gets you fooled.
    - **Must be generated, not fixed (2026-07-07) — same pattern as the spotter sightings.**
      If the code were static, a player replaying the level would already know it and the
      whole "you have to listen" point would evaporate on the second playthrough. Generate
      it fresh per mission instance, the same way sightings are randomized (see the
      Kolombangara worked example above) — so replay masters the *habit* of checking, not a
      memorized value, consistent with **Level control**'s "every replay is a fresh
      instance" rule above.
    - **Rule-based flexible parsing, not AI (2026-07-07) — a reusable pattern.** Grading
      free-typed player transmissions needs to feel forgiving without being fuzzy, and
      without reaching for an LLM call the "no backend" architecture doesn't want anyway.
      The answer that fell out of building this: **tokenize into words, then match on
      tokens, not raw substrings.** A bare `msg.includes("...")` is either too rigid
      (an exact-string check like `msg === "R"` rejects a perfectly realistic `KEN DE
      GOOSE R K`) or, for single letters, too loose (a naive `.includes("R")` would false-
      match inside any word containing the letter). Tokenizing first fixes both: checking
      `words.includes("R")` matches the whole word anywhere in the message; checking a
      **token sequence** (e.g., `["I", "AUTHENTICATE", code]` appearing consecutively)
      matches a multi-word phrase regardless of spacing or where it lands in the message.
      Fully deterministic, no judgment calls — just "do these words appear, in this order."
      Reuse this pattern anywhere else free-typed player text needs grading (relay-net
      copy fidelity, future report fields), rather than special-casing more exact-string
      checks or reaching for AI.
    - **The sked frequency is generated the same way (2026-07-07, implemented).** Real
      SOI documents bundled call signs, frequencies, *and* authentication into one
      periodically-changing package — so randomizing the target frequency per mission
      (a multiple of 5 kHz, comfortably inside the dial) isn't a new idea, it's the same
      one applied to the other value that document actually carried. Delivered the same
      way too: only the Briefing panel's prose states today's number — no status line or
      codebook entry gives it away, so tuning in requires reading it fresh every mission,
      same as the authenticator table.
    - **Possible tie to the decline arcs above:** a late-campaign near-miss — GOOSE, worn
      down by the field-companion and Evelyn declines, almost skips or fumbles a check he'd
      have caught clean back at Guadalcanal — would give that emotional exhaustion real
      operational stakes, not just social ones. Worth considering for a Bougainville
      posting specifically, given the danger already concentrated there; not committed.
    callsign/pileup drill (PROJECT-PLAN mode 3), and steps toward the high-rank "coordinate a
    network" role.
  - **QRZ — catching a dropped identification (2026-07-08, implemented).** A player
    note off the built Kolombangara demo: nothing currently stops a report going out
    without its addressing — e.g. `BOMBER NR 6 CSE NW` instead of `KEN DE GOOSE BOMBER NR 6
    CSE NW K`. Real net discipline has an exact answer for this: **QRZ** ("who is calling
    me?"), the real Q-code an operator sends back when a transmission arrives with no clear
    TO/DE/FROM. Same family as the authenticator-codes idea above — catch a specific,
    named net-discipline lapse mechanically, not just render the header as flavor text.
    - **The check:** before parsing an outbound transmission for its content (report
      fields, QSL, etc.), confirm it leads with `KEN DE GOOSE`. Missing it → KEN replies
      `QRZ K` instead of processing the message; the report isn't graded or acknowledged
      until the player resends properly addressed. A nudge, not a hard fail — same spirit
      as `AGN?` and the authenticator retry loop.
    - **Applies wherever the player transmits to KEN** — spot reports (the case that
      surfaced it) and sked acknowledgements alike, for the same reason the authenticator
      check landed on "first contact each day": one rule, applied consistently, beats a
      special case per message type.
    - **Add `QRZ` to the codebook's Prowords group**, alongside `AGN`/`QSL`/`QRT`/`QRU`.
    - **Implementation shape:** the same token-sequence pattern already used for the
      authenticator and report-field checks in `adventure.ts` —
      `includesSequence(words, [HQ_CALL, "DE", MY_CALL])` — gates the existing parsing in
      `transmit()`, so no new grading machinery is needed.
  - **Soft tells before the hard check — rogue-transmission suspicion (2026-07-08,
    brainstorm, not yet designed in detail).** The authenticator table above is the *hard*
    impostor check — deliberate, pass/fail, once per contact. This idea is the *soft* layer
    above it: narrative cues that let an attentive player suspect a transmission is bogus
    before (or instead of) a failed authenticator — catching an impostor by *paying
    attention*, not just by the mechanical gate.
    - **The status line as a suspicion meter.** The line above the transmit control that
      normally narrates mechanical state (`KEN is transmitting…`) gets repurposed, on a
      flagged rogue message, to voice the operator's unease instead — e.g. a transmission
      that abruptly demands GOOSE's position might read *"That didn't sound like KEN's
      fist, and how would he not know where I am? Should I reauthenticate?"* Same channel
      already used for status/flavor text; no new UI needed.
    - **Two independent tells, kept separate so detection is skill-based, not a coin
      flip:**
      - **The fist.** Reuses the recurring-station "fist" idea (see **The fist as a
        recurring clue** below) as an impersonation tell, not just a cameo Easter egg — an
        unfamiliar rhythm on a familiar call. **Stays textual/diegetic** — the operator's
        own noticing, voiced in the status line — rather than an actual audio-timing
        change, which preserves the exact reason the authenticator design avoided
        simulating fists in the first place (perturbing an engine whose whole pillar is
        exact timing; see **Authenticator codes** above).
      - **Content mismatches.** A request for information the real KEN would already have
        (GOOSE's position, already on file), an order that's tactically nonsensical or out
        of character, wrong prosign/word choice, misspellings, or a tone/mood that doesn't
        fit the situation (panic where routine is expected, or the reverse). Checkable the
        same rule-based way as the rest of net traffic — see **Rule-based flexible
        parsing, not AI** above — no AI judgment needed to flag a wrong prosign or a fact a
        genuine KEN wouldn't need to ask for.
    - **Player agency, real stakes.** A noticed tell should let the player *act* — challenge
      with a fresh `AUTHENTICATE` rather than trust the `QSL`, echoing the **moral
      branching via petitioners** P,P device above. Missing a rogue transmission (or
      over-trusting one) can escalate to a genuine mission-failure beat — a compromised
      position, a forced rescue — fitting the **roguelike "run" framing** pillar (lose the
      run, keep the accumulated experience, replay) rather than a soft fail state.
    - **Open:** how often a rogue transmission should appear (rare surprise vs. a
      recurring mechanic once introduced), whether it's tied to a specific posting/mission
      (a natural fit for a milestone or the Bougainville postings, given the rising-danger
      theme already established there), and the exact shape of the failure/rescue beat.
- **Progress persistence & recovery (durable save + admin controls).** Unlocking only means
  something if it survives a refresh, so unlocks, rank/XP, story flags, and per-level bests
  must persist — **versioned, namespaced `localStorage`** (`morse-games.*`), the version so
  the schema can migrate as the game grows. **Load defensively:** corrupt/absent → fall back
  to defaults, never brick (the base app's `loadSettings` / `loadCharStats` already model
  this try/catch → defaults pattern). Add an app-wide **Data / Admin** panel (whole app, not
  just the game): **Reset progress** and **Reset all data** behind a confirmation, plus
  **Export / Import save** (JSON) for backup and moving machines — the reset is the escape
  hatch when state gets weird. Keep any "jump to any level" as a **dev-only flag**, not a
  player button, or it quietly defeats the earned-forward gate (distinct from the deliberate,
  *warned* in-fiction "jump ahead").

## Campaign structure & pacing

How missions string into an arc — resolves the former "campaign structure" open thread.

- **Four tiers, one clock model promoted up at each level.** **Campaign** (the whole
  Father Goose arc) → **Posting** (an island — a chapter) → **Day** (a capsule, ~5–10
  min — the tier the Kolombangara demo proves) → **Beat** (a sked or generated event).
- **Scope target: ~20 missions across ~4–6 postings** (Portal-scale as a length
  reference only, not a mechanic — no "undo the campaign" twist). Roughly 3–5 days per
  posting.
- **Postings are authored mini-arcs**, not open-ended grinds: arrival → routine days →
  a milestone beat → a crisis / RELOCATE. Targeting 3–5 days keeps each one a real
  three-act shape rather than padding.
- **Two clocks, same trick as the single-day light model, one tier up.** Per-day **DF
  heat** resets each morning (diegetically: you went to ground overnight). Per-posting
  **suspicion** persists across the whole posting and moves slower. Play clean → you get
  the full authored arc (letters from home, the milestone beat, the works). Play
  loud/reckless → suspicion climbs faster → RELOCATE fires early → the arc compresses
  and you miss content. Skill directly shapes *pacing*, not just pass/fail.
- **Escalation on two axes, both diegetic, no arbitrary difficulty slider:**
  - *Within* a posting — enemy WPM, DF close-rate, and sked frequency creep day over
    day: "the net's hot, they've noticed you."
  - *Across* postings — the real Solomons geography supplies the big jumps (WPM floor,
    threat archetype, codebook chapter) for free; see the historical spine below.
- **Rank ties in only at posting transitions**, never mid-posting micro-leveling:
  promotion = new posting = next act of the Father Goose arc, one number doing three
  jobs. **Important causal split:** relocation-by-danger (the RELOCATE order — the
  historically honest reason a Coastwatcher moved) and promotion-by-merit (a game
  abstraction layered on top) are kept as *separate triggers*. Letting "you leveled up,
  here's a new island" cause the move would cheapen what was actually a survival story.
- **Calendar-as-montage — don't play every day.** A posting spans real months, but the
  player only plays the handful of days worth dramatizing. Date-stamp each mission like
  a diary entry ("Kolombangara — Day 14") and let the calendar skip irregular amounts
  between missions — weeks during a quiet stretch, dense during a historically hot one.
  Implies the routine missions happened off-screen without needing to build or play
  them; this is exactly how real Coastwatcher memoirs read (a highlight reel, not a log
  of every day), so it's free authenticity, not a shortcut that costs believability.
- **A loose historical spine (anchor, not a rigid schedule):** Guadalcanal (Aug 1942 –
  Feb 1943; air-raid warnings; Clemens/Vouza) → New Georgia / Munda (Jun–Aug 1943;
  milestone mission — protecting the Seabees building Munda airfield, see **Real history
  as milestone missions** below) → Kolombangara / Blackett Strait (Aug 1943; PT-109 — the
  existing demo's setting) →
  Bougainville (1943; Read & Mason's warnings and eventual compromise/evacuation) →
  the Bougainville invasion (Nov 1943) as a finale-adjacent beat. ~15 months of real
  chronology, compressed by the calendar device into ~20 capsules — selection, not
  invention.
- **Mission allocation draft (2026-07-07)** — a concrete first pass at distributing
  missions across the spine, following two principles: Guadalcanal runs long (stability,
  skill-building, promotion-driven exit) while Bougainville splits into two short,
  **relocate**-driven postings (frequent forced movement as danger rises) — so the *type*
  of transition (earned promotion vs. forced relocation) becomes a legible signal of rising
  danger on top of the WPM/DF numbers. The Yamamoto-shootdown scuttlebutt (see Easter eggs
  above) lives in the Feb–Jun 1943 gap between Guadalcanal and Munda as a transition-screen
  aside, not a mission of its own — chronologically it predates Munda. Training is a
  prologue outside the historical spine (see **Onboarding** above), not counted toward the
  field-mission total.

  | Posting | Day | Focus (kit emphasis) | Notes |
  |---|---|---|---|
  | Stateside training (prologue) | 1 | Induction shock | "Never traveled" cold open; Andy's first invective |
  | | 2 | Koch ramp grind | Sam's "it's like music, but I don't hear it" aside; FMJ echo; authenticator drills repeat until reflex |
  | | 3 | Graduation / orders | Competency gate cleared; Andy left behind for good; ship out |
  | Guadalcanal | 1 | Control frequency, Decode messages | Cold open — first sked, still shaky |
  | | 2 | Decode / Send, routine | Daily rhythm sets in; Cactus Air Force overhead as ambient flavor |
  | | 3 | Send reports (spot) | First real sighting report, drilled clean |
  | | 4 | **Milestone: Decode + React to threats** | Warning → the planes overhead scramble in time because of you |
  | | 5 | Messages from home | First letter — the pining beat, a breather |
  | | 6 | React to threats | First real scare — a patrol close call, survivable |
  | | 7 | Sign-off | **Promotion** (Bill); boat to New Georgia — "squinting at the sun" |
  | New Georgia / Munda | 1 | Request supplies | Arrival; jerry cans, hacked paths |
  | | 2 | Decode (HQ's ask) | Airstrip misconception builds |
  | | 3 | **Milestone: React to threats** | Reveal — Seabees are building it; real job is watching the sky |
  | | 4 | Sign-off | Strip finished; **Promotion** |
  | Kolombangara | 1 | Control frequency | Light arrival card — existing intro/cold-open |
  | | 2 | **Full worked example** | The built demo day |
  | | 3 | Decode (peripheral) | JFK/PT-109 rescue heard on the net |
  | | 4 | Sign-off | **Promotion** |
  | Bougainville (posting 1) | 1 | React to threats | Arrival already tense |
  | | 2 | React to threats | **Relocate** — forced |
  | Bougainville (posting 2) | 1 | React to threats | New spot, tenser still |
  | | 2 | React to threats / home | **Relocate** again — echoes Read & Mason |
  | Bougainville invasion | 1 | Decode | Last full field day |
  | | 2 | — | The invasion itself, Nov 1943 |
  | Magic Carpet coordination (true finale) | 1 | **Coordinator role — the relay net, at scale** | Big calendar skip (~20 months) to mid/late 1945; see below |

  25 missions total (3 training + 22 field) — a draft scaffold for future mission writing,
  not locked content.

  **The true finale — Magic Carpet coordination (2026-07-07).** Answers "what does the
  rank-driven coordinator role shift actually look like to play?" (see **Rank as levels**
  above) with a real historical anchor: **Operation Magic Carpet**, the real 1945–46 mass
  repatriation already used for Bill's epilogue arc. Reached by a large calendar-as-montage
  skip from the Bougainville invasion — no need to build out two more years of intervening
  content, the same device already justifies the gap.
  - **The payback structure.** GOOSE left home a green kid who needed Andy to drill him,
    Aaron/Pita/Tione to keep him alive, and Bill to promote and reassign him. This mission
    inverts it: GOOSE is now the one running a **relay net at scale** — the existing Relay
    Net level type (TO DE FROM addressing, correct routing, body fidelity) reused for
    real, higher stakes — prioritizing and routing traffic for an operation defined by real
    scarcity (limited transport capacity, ships needing refurbishment, departures
    coordinated across scattered global locations). Arrived green, leaves making sure
    other soldiers get home safely — the same verb triad (receive/send/intercept),
    now aimed at care instead of survival.
  - **Honor history first, Easter eggs second — checked, and none forced.** Researched
    specifically for a credible real-person or unit tie-in to Magic Carpet's
    communications/coordination side; nothing documented enough turned up to cameo
    responsibly. Per the instruction that started this note, that's a reason to leave it
    alone rather than invent one — the real operation's scale and chaos carry the weight
    on their own.
  - **The Easter egg that isn't a stretch: Bill's own ship, in GOOSE's own traffic.** No
    external cameo needed — GOOSE, now coordinating, ends up routing a message that's
    unmistakably Bill's ship checking in. Closes the whole-game relationship arc (see the
    Bill ↔ KEN inversion above) by inverting it one more time: GOOSE now does for Bill what
    KEN's net once did for him.
  - **Mirrors Bill's own "brass only once it's safe" irony** (see the enlisted-ceiling note
    above): if GOOSE gets any final procedural bump — his highest Technician grade, say —
    it happens here, for the safe, homeward job, once there's no danger left to be modest
    about. **The concrete callback (2026-07-07):** reuse the exact "ceiling fans and beer"
    line from the enlisted-ceiling rule, now aimed at GOOSE himself — a quiet beat where he
    notices, without saying it to anyone, that he's become the guy with them. Subtle on
    purpose — most players won't clock it, and that's fine; the ones who do get a joke that
    plays across the whole timeline instead of a moment that has to explain itself.

## Speed as the difficulty gate — anti-frustration design across WPM transitions

(2026-07-09) Every mission is structurally the same shape (HQ skeds + spotter reports);
the thing that actually gates one level from the next is **copy speed**. That's already
the doc's core pillar ("Koch speed = difficulty," islands-as-difficulty ⇒ rising WPM),
but this section locks in the concrete decisions for how a WPM jump feels from the
inside, so a real skill wall never reads as an unfair one.

- **Field missions open at 7.5 WPM minimum, not a slow ramp-in (locked).** No field
  mission ever runs below 7.5 WPM — this is the graduation gate from **Onboarding**
  above, now a concrete number rather than the earlier "~5–7 WPM (tunable)." **Revised
  2026-07-10:** the gate is speed-first, not full-character-set-first (see **Training
  Day design** under Onboarding for why full Koch coverage isn't achievable — or
  desirable — from training alone). Two reasons the speed floor itself is load-bearing:
  **realism** (nobody ships an operative to the field who can't copy at a basic clip —
  that's a tutorial fiction leaking into the world) and **felt accomplishment** (jumping
  from the 5 WPM trainer baseline to 7.5 for the first field mission is itself a win the player can
  feel, not just a number going up). The training-base competency gate is what makes
  this honest rather than a difficulty cliff — see **Onboarding** above.
- **Rejected: a fading/partial Show Text reveal.** Considered as a way to wean players
  off plot-mode gradually across a transition — rejected as too easy; it would let a
  player limp through a speed tier by reading instead of actually copying it, which
  defeats the point of the gate. Show Text stays the binary on/off toggle it already is
  ("plot mode" for following along, not a scaffold).
- **The real anti-frustration tool is the notepad, not a text crutch.** The notepad
  already exists as a live scratchpad, separate from Show Text's full reveal. The design
  intent going forward: missions and HQ's framing should actively train players to
  *keep writing fragments as they catch them* rather than freezing up waiting for a
  clean full catch — a real technique working operators use ("copy behind," partial
  words, filling gaps from context after the fact). A player who falls behind at a new
  WPM tier should be able to catch a fragment, lose the thread, and pick back up
  mid-message from what's already on the page — the recovery path is a skill the game
  teaches, not a difficulty setting it lowers. Still TODO: the notepad isn't graded
  against the sighting/message yet (see the worked-example section's TODO list) — worth
  keeping in mind once it is, so grading rewards partial/fragmentary copy rather than
  demanding a clean transcript.
- **AGN cost scales with campaign progression, not just mission-to-mission
  escalation.** AGN (repeat) should never be capped — a player can always retry their
  way through a message they can't yet copy clean — but what it *costs* changes over the
  campaign: cheap early (a generous safe-transmission budget while the player is still
  finding their feet at a new tier), progressively more expensive later (the same
  "ask again" that was free on Guadalcanal measurably eats into the budget by
  Bougainville). This is a concrete tightening of the existing **two-clock model**
  above (per-day DF heat, per-posting suspicion): the *budget* itself — how much
  AGN/retransmission a posting can absorb before danger becomes real — should shrink
  posting over posting, so identical player behavior (same number of retries) reads as
  meaningfully riskier later in the campaign even though the player has gotten better.
  Rewards mastery (a skilled player needs fewer retries, so the shrinking budget rarely
  bites) without ever presenting a hard wall (the option to retry is always there, it
  just costs more). **Not yet built** — today's danger readout is a flavor stub
  (`Danger: low (this island)`, hardcoded regardless of `txCount`); this section is the
  target design for whenever that gets wired up for real, not a description of current
  behavior.
- **The posting-by-posting WPM curve, anchored to real license-class speeds
  (2026-07-10).** Escalation should step at posting transitions, not creep smoothly
  mission-to-mission (consistent with "rank ties in only at posting transitions" in
  Campaign structure & pacing above). Rather than pick arbitrary numbers, the curve maps
  onto the real pre-2000 FCC code-speed ladder — 5 WPM was Novice, 13 WPM was General, 20
  WPM was Extra — so the campaign's speed target is authentic ham history, not an
  invented game curve, and 20 WPM (the eventual ceiling) is a real, respected, achievable
  benchmark rather than a superhuman one:

  | Posting | Effective WPM | Real-world anchor |
  |---|---|---|
  | Training (prologue) | 5 → 7.5 | Novice floor, climbing to the graduation gate |
  | Guadalcanal | 7.5 (locked) | just past Novice — competent, still clearly green |
  | New Georgia / Munda | ~10 | everyday working/rag-chew speed |
  | Kolombangara | ~13 | the real General-class milestone — lands on the built demo |
  | Bougainville (both postings) | ~16–18 | approaching Extra, matches rising danger |
  | Bougainville invasion / finale | ~20 | the real Extra-class ceiling |

  Flat within a posting (only enemy WPM/DF/sked-frequency creep day-to-day per the
  existing two-axis escalation note); the player's own required floor only jumps at a
  posting transition, alongside the rank/promotion beat. Magic Carpet's finale doesn't
  need a higher number — its skill test shifts to coordination (the relay-net-at-scale
  role), not raw copy speed, so 20 WPM plateaus rather than climbing further.

## The transition screen

The between-capsule beat. It's where prev/replay/next live (per **Level control**
above), and — per a 2026-07-07 design session — where topical *and* emotional
stage-setting exposition happens before a mission's operational briefing.

- **Two weights, one component.** **Light flip** (day → day, same posting): fast — a
  tally, the light cue settling, then the controls. **Heavy beat** (posting →
  posting): slower and rarer — a calendar card (place, date), the promotion/relocation
  narrated in diary voice, a codebook-chapter tease. Same screen, content density
  scales with what actually changed.
- **Staging channel — reuse, don't invent.** Emotional staging rides the existing
  "reveal by noticing" diary-voice channel (the same one behind the Notes panel and the
  colonial-exposition technique) — demonstrated by this exchange's "Bill handed me
  Sergeant bars... I hope Captain Bligh doesn't forget where I am" vignette. Physical
  staging is a small wordless anchor (a map pin nudging, a light/season swatch) — the
  same "light is both clock and progress bar" trick, promoted a tier.
- **Skippability is free.** Follows the replay rule already specified for level
  control: first visit shows the transition in full; replaying a reached day/posting
  collapses it. No separate skip system needed.
- **Look & feel: UI overlay, not a literal diegetic object.** No rendered desk/map to
  click around — just the dark-panel/cyan palette reused so it reads as the same room.
  Cheapest option, deliberately chosen given solo-dev scope ("just you, me, and
  VS Code") — settles part of the **Immersive UI language** open thread below (the
  between-capsule chrome specifically; the in-play shack's own visual direction is
  still open).
- **Implemented in the demo.** `adventure.ts`'s `buildIntro()` / `beginShack()`: a
  light-flip cold-open card ("Station GOOSE — Kolombangara · Day 14" + a short
  scene-setting paragraph + "Begin the watch") shown before the four-quadrant shack,
  sharing the day/light-tint CSS classes (`.adventure-intro.dawn` etc.) with the shack
  so both views read as the same lit room. It deliberately overlaps in content with the
  shack's own Briefing panel — accepted on the theory that most players skip ahead to
  the operational detail anyway, and first-time redundancy reinforces rather than
  bores.
- **The loop now closes (2026-07-08, implemented).** `showOutro()` swaps the shack for a
  dusk-toned card in the same style as the intro (day tally + "Replay the day"), and
  `resetRun()` regenerates a fresh run — new sightings, authenticator table, and sked
  frequency, the same "every replay is a fresh instance" guarantee as **Level control**
  above — and returns to the intro card. End of day → transition screen → replay, the
  same beat the campaign's day-to-day flow will eventually use, proved out on this one
  mission.

## The operator (character design)

Design intent for the player-character — deliberately light on hard biography so the player
can *inhabit* him, but specific in **sensibility**.

- **The concept: a deferred musician.** Fresh out of high school and college-bound on a
  **percussion scholarship**, who signs up to serve instead. The road not taken (music,
  college, a life on hold) is a quiet emotional thread — never a monologue.
- **Why percussion pays double — theme *and* mechanic.** A drummer's ear for rhythm is
  exactly the faculty CW rewards: the "let the sound become the word" music-sense, the
  distinctive **fist**, the tap-back drills. His gift is the diegetic reason the key clicks
  for him — it can justify a recognisable fist (cf. the cameo **Method**) and make the rhythm
  exercises feel in-character. The protagonist is married to the app's core pedagogy.
- **Reveal by *noticing*, never exposition.** Same craft as the colonial-exploitation
  exposition — **same channel (the Notes panel), same technique.** The man is revealed by
  what he attends to and what he misses: a drummer notices *rhythm* — the limp in KEN's fist
  ("like a dragging triplet"), the clave of the surf, the metronome of the generator, a
  scout's chant, the syncopation of AA fire — and may *not* notice what another character
  would (tactics, politics). That noticing-profile **is** the characterization, and it
  reinforces the music theme (he hears the world rhythmically). Backstory **accretes** from
  small, consistent details across missions and letters home — assembled by the player the
  way the intrigue is, rewarding attention (and replay).
- **Everyman-specific.** A specific *sensibility* (rhythmic, observant, quietly homesick for
  the music he set down), light on hard facts — so the player inhabits him while still feeling
  a person. Fits the reluctant-hero *Father Goose* tone.
- **Never traveled — the induction shock (a concrete biographical anchor).** One hard fact
  layered onto the otherwise-light biography: he'd never left home before. Boot camp, then
  specialist (radio) school, drops him somewhere far away almost overnight — period-honest
  (most WWII draftees hadn't traveled) and it does double duty: the fish-out-of-water beat
  that opens Act 1, and the reluctant-hero anxiety planted in *his own voice* rather than
  narration. Sample register (2026-07-07): *"Never traveled, and suddenly I'm in another
  state entirely for training — boot camp, then specialist school. Like they can't wait to
  send me out there. Not so sure I'm ready."* This is the training base's natural cold-open
  voice — the Act 1 mirror of the Kolombangara intro card (see **The transition screen**
  above): same light-flip pattern, different door.
- **Travel telegraphs the landlubber — pace it by felt-time, not clock-time (2026-07-07).**
  Fast modern transport (a flight to Pearl Harbor) can compress to a line — long by his own
  reckoning, but over almost as soon as it registers, so it doesn't earn page-time. Slow
  transport (the interminable boat legs between postings) is where to dwell: seasickness,
  sun-glare "too painful to look at, too bright to ignore," a horizon that never moves. The
  asymmetry — the flight felt long, then paled next to one day on the water — *is* the
  characterization of a man who's never been anywhere, so prose should linger where his body
  does, not where the calendar does. Template register: the "three days of squinting at the
  sun" line from the Bill/tugboat transition vignette (see **The transition screen** above) —
  reuse that register for every slow-boat leg still to come.
- **Travel novelty decays with the arc — let the blur itself carry the growth
  (2026-07-07).** Early on, travel is novel, exciting, apprehensive, and earns the dwelling
  described above. By the back half of the campaign, the islands should start to blur for
  him — "aching white beaches and swaying palm trees," a fatigue-flattened sameness —
  because that numbing *is* the growth, shown rather than stated, per **reveal by
  noticing** below. Craft payoff: once his own travel-writing goes generic, the
  *differences* between postings (terrain, threat, real history) have to carry the signal
  instead — free motivation to keep those specific rather than padding with more scenery.
  Rough arc marker: the point his travel prose goes flat is about the point he's stopped
  being green.
- **Sea legs redirect the travel-focus: inward → outward and forward (2026-07-07).** Early
  boat travel is somatic and inward — his own body fills the frame (seasickness, sun-glare,
  misery, per above). Once he's got his "sea legs," the same slow ride frees up attention
  for two new things instead of just going blank: the *people* aboard — transient shipboard
  relationships, someone he shares a rail and a smoke with and never sees again, a different
  texture of connection than the *recurring* net regulars (KEN, a fist you'd know anywhere)
  he's building elsewhere — and *forward-looking practical competence*, small field wisdom
  accreting with experience. Sample line: *"I packed an extra pillow this time, instead of a
  towel. You're always damp, but waking with a crick in your neck is worse than sweat."*
  Works because it's concrete and un-narrated — the same "accretes from small, consistent
  details" technique the doc already uses for backstory, aimed at competence instead.
- **The invisibility test (a standing craft standard, 2026-07-07).** If a player notices the
  green-to-seasoned shift happening, that's a sign something overplayed its hand, not a job
  well done — per Coco Chanel's "dress shabbily and they notice the dress; dress
  impeccably and they notice the woman." Applies to every accreting-detail device on this
  page (backstory, competence, the colonial-exposition double-cringe, the travel arc above):
  the craft should disappear into the character, not announce itself. Where we can't be
  impeccable, at least be honest about the gap rather than papering over it with exposition.
- **Delivery caveats.** No flashback cutscenes (they break the single-room immersion and the
  show-don't-tell rule); keep the music metaphor as *flavor in his noticing*, not constant
  winking; let the deferred life live implicitly in the **letters from home** (a bandmate, a
  director, a scholarship held open).
- **A small vice arc: cigarettes (2026-07-08).** A three-beat character thread built on the
  ration economy that's already period-real and already touched on elsewhere in this doc
  (the shipboard "rail and a smoke" line above, the scouts' "twist tobacco" pay in the
  Kolombangara notes). **Deliberately narrative texture, not a gameplay system** — no
  stamina stat, no mission penalty tied to whether he smokes; it lives entirely in the
  accreting-detail channels already established (Notes panel asides, letters home,
  transition-screen diary voice), per **reveal by *noticing*** and the **invisibility
  test** above.
  - **Act 1 — indifferent, and a little pleased with himself.** He doesn't smoke, and
    treats his ration as a trade good — extra chocolate, a favor, a better bunk — small,
    period-honest camp economy that doubles as an early "sharper than he lets on" beat.
  - **A field beat — giving in.** Somewhere in the long, hot, empty hours of a shack with
    nothing to do (the same "waiting" texture the ambient mission clock already leans on),
    he starts smoking — no drama, just boredom and nerves finding an outlet, told in a
    single offhand diary line rather than announced.
  - **A later beat — quitting.** After enough marches up ridges with a heavy set on
    somebody's back, he notices how much harder the climbing has gotten and quits — a
    quiet, physical, non-preachy reason. The payoff is a noticing detail (winded on a slope
    he wouldn't have thought twice about before), never a stated moral or a mechanical
    penalty.
  - **Optional connective tissue:** the existing "shares a rail and a smoke with" shipboard
    line (see **Sea legs redirect the travel-focus** above) can double as the moment he
    first takes one up, giving the arc a concrete opening beat instead of an abstract one.
  - **Not gated to a specific posting.** Unlike the field-companion/Evelyn decline arcs,
    this doesn't need a fixed slot on the mission-allocation table — it can accrete across
    whichever Notes/letters beats get written, the same low-commitment way as the
    travel-competence details above.

## Cast of characters

A small, deliberately minimal roster (2026-07-07) — see **Cast of characters & locations**
in Open threads below for what's still unfilled (locations, and whether any other stateside
faces are worth naming).

- **Andy ("Handy Andy") — the stateside instructor.** Boot camp, then radio/specialist
  school; the one who drills the Koch ramp in. Appears across the **2–3 training-level
  transitions** that open the campaign (a deliberate *Full Metal Jacket* echo) via
  in-character invectives — see **the invisibility test** above: the repetition should
  feel earned, not narrated at the player. **Left behind for good once you ship out** — a
  clean one-act character, never recurs. Distinct from Bill below; don't conflate them.
- **Sam — a fellow trainee, deliberately throwaway.** No arc, just one or two memorable
  lines rather than a subplot — cheaper and truer to the vanity-project scope than a fuller
  foil would be. Carries the lookup-table-vs-music-sense theme (PROJECT-PLAN's "music
  sense" section) in a single aside instead of a subplot: *"He keeps saying it's like
  music, but I just don't hear it."* Whether Sam resurfaces later (a letter, a name that
  comes up) is open — fine to leave him behind entirely, in keeping with "throwaway."
- **Bill — KEN's boss at HQ.** Not the stateside instructor, not KEN itself — the harried
  senior NCO actually running the coastwatcher network's logistics (no brass — see the
  enlisted rank ceiling below; he's the top of who's actually out here), stretched too thin
  for any of this, who handles promotions and relocations personally anyway because the
  field operators are the reason the desk exists. Source of the earlier transition vignette
  ("Bill handed me Sergeant bars... I hope Captain Bligh doesn't forget where I am").
  **Recurs across the whole campaign** at posting transitions — see **The transition
  screen** above for where he shows up (the "heavy beat").
- **KEN — the net-control callsign, not necessarily a person.** The day-to-day voice on the
  key that GOOSE actually works skeds with; Bill sits above it, not behind it, so KEN can
  stay a generic station identity (plausibly rotating operators on a real net-control desk)
  without needing its own individuated character. **A "fist" was considered and dropped
  (2026-07-07)** for detecting an impostor on the net — it would mean deliberately
  perturbing the engine's exact-timing delivery, which fights the design pillar rather than
  serving it. See **Authenticator codes**, extending **Level type — the relay net** below,
  for the text-based answer instead.
- **Pita — the scout who actually keeps GOOSE alive and informed (2026-07-07).** Carries
  the set up the mountain track, barefoot, in the dark (see the Kolombangara NOTES text);
  brings runner reports; reads the coast — tide, reef break, wind — the way GOOSE reads
  rhythm. That parallel *is* the relationship, not a speech: two men who each hear
  something the other initially can't, recognizing a fellow professional once they notice
  it. Young (matching the real Gasa/Kumana precedent — teenagers and young men did this
  work), quick, wry, and unsettlingly unbothered by danger GOOSE still flinches from.
- **Tione — a second named scout, deliberately not a solo "chosen one."** Older, steadier;
  the one who actually handles the "twist tobacco and promises" settling-up with HQ, wry
  about the arrangement in a way he never says straight out. Naming two, not one, is
  deliberate — the point of "I write their names in the log" is that "the boys" was always
  a group of real individuals, not a single elevated exception standing in for the rest.
- **Distinct from the real cameos below.** Pita and Tione are fictional — not meant to be
  confused with or stand in for Jacob Vouza, Biuku Gasa, or Eroni Kumana (see Easter eggs
  below), who stay real, rare, and tied to their own specific documented events. This is
  exactly the "swap to a fictional name" allowance the cameo Method already makes for
  GOOSE's everyday scouts.
- **A concrete beat for "the log doesn't ask":** the moment GOOSE actually writes Pita's
  and Tione's names in the log, on the page, once — not narrated after the fact in the
  NOTES text but played as a real, small beat. Candidate placement: the Kolombangara
  sign-off/promotion transition, so leaving the island is also the first time their names
  appear anywhere but his own head.
- **The field-companion arc: starts strong, peters out — its own cringe (2026-07-07).** Not
  a flaw to fix but a deliberate structural mirror of GOOSE's slide into colonial habit and
  emotional exhaustion — a *third* layer of cringe stacked on the existing double-cringe (we
  don't just wince at the era; we wince watching a character we like fail a test he'd been
  quietly passing). Maps directly onto the mission-allocation table above:
  - **Guadalcanal (the long posting) — the gold standard.** Introduce **Aaron**, GOOSE's
    Guadalcanal-side scout/contact — a real friendship, properly earned, because for once
    there's *time*: Aaron teaches him the terrain and something of his own life, and GOOSE
    learns his name without having to try. This is the bar every later posting fails to
    clear, deliberately.
  - **Munda — the first crack, task-focused.** Attentive but transactional; the milestone
    crisis (protecting the Seabees) eats the bandwidth a real friendship would need. No
    fully realized companion needed here — the *absence* of one is the point.
  - **Kolombangara — the asymmetry.** Already written above, reframed rather than rewritten:
    Pita gets the full relationship (the tide/rhythm parallel); Tione is acknowledged but
    not fully *seen* — "the one who handles the settling-up," not someone GOOSE bonds with
    the way he does Pita. That existing asymmetry *is* the first real crack.
  - **Bougainville, posting 1 — the name he's not sure of.** Shorter posting, higher danger;
    GOOSE catches a name but isn't fully certain he's got it right, and it's never
    corrected on the page — no time, and if he's honest, not quite the will left either.
  - **Bougainville, posting 2 — no name at all.** The terminal point: GOOSE doesn't ask,
    defaults to "the boy" — the exact collective diminutive the whole thread had been
    quietly resisting since "the log doesn't ask." Play the regression as exhaustion, not
    malice — that's what makes it land as tragedy instead of villainy.
  - **Payoff for the epilogue's open scout-log thread:** this is what makes "leave it
    honestly unresolved" (see Epilogue above) the right call instead of a vague gesture —
    the log itself should read uneven on the page: Aaron's name full and easy, Pita's warm,
    Tione's correct but thin, one Bougainville name uncertain, one missing outright. GOOSE
    can *notice* this in the epilogue — a flicker of self-awareness, not a redemption arc —
    without the game resolving it for him.
- **Evelyn — the girl back home; starts strong, runs out of gas (2026-07-07).** Real effort
  at first: she works V-mail's standardized form and the officer-censor's blackout lines
  like a puzzle to keep him anywhere close to informed, chasing him across postings with
  letters that arrive weeks late and half cut. Ties to the deferred-musician backstory as
  a detail that accretes rather than gets stated outright — maybe she's the one who used
  to sing while he kept time. Then, over the campaign, she stops. **Deliberately never
  explained** — a fog-of-war ambiguity, not a plot point to resolve: did she meet someone
  else, get sick, just run out of whatever it takes to sustain a solo correspondence
  across years and an ocean? GOOSE never gets a clean answer, which is the honest version
  of what a lot of real wartime relationships actually did.
- **GOOSE doesn't know how to grieve it — so the game doesn't show him grieving it.** Per
  the invisibility test above, this isn't a dramatized breakdown scene. It shows up
  sideways: the **"Messages from home" kit element** (see the mission-element kit above)
  quietly stops delivering personal letters and starts filling the same slot with routine
  **wartime news bulletins from other theatres** instead — impersonal, mass-broadcast,
  addressed to no one. The player feels the substitution before GOOSE would ever say it
  out loud.
- **A second, matched decline — cross-reference the field-companion arc above.** Same
  emotional exhaustion, cutting the other direction: forward, into field companions he
  stops fully seeing; backward, into a home connection going quiet he can't process. GOOSE
  is hollowed out from both ends at once, and neither line is ever spoken aloud — it's
  just the "Messages from home" slot changing character and the scout log going uneven,
  side by side.
- **Reframes the Epilogue's "a few years and miles late" line** (see Epilogue above):
  "hopes of love" there isn't a reunion with Evelyn — it's GOOSE having to start over,
  hopeful but a little unmoored, wondering who he'll even connect with back home after
  all this.
- **The Bill ↔ KEN inversion — a relationship arc, not just two characters (2026-07-07).**
  Early on, Bill feels like the one running things — he's the rank, the human voice behind
  orders — while KEN is just impersonal chatter you copy off the key. As the campaign goes
  on, that flips: KEN becomes the daily relationship, the fist you'd know anywhere (per the
  cameo **Method** below), while Bill recedes into unglamorous logistics — scrounging gas
  for the generators and toilet paper for the latrine, present but no longer the emotional
  center. Per **the invisibility test** above, play this through frequency and texture of
  contact, not narration: more daily KEN traffic carrying real character (fist quirks, small
  asides inside otherwise prosign-strict exchanges), Bill's appearances thinning to
  administrative, faintly absurd grumbling. The shift mirrors the operator's own arc — a
  green recruit is naturally awed by rank; a seasoned one bonds with whoever's actually on
  the line with him every day.

## Epilogue

The campaign's closing beat (2026-07-07). Per **the invisibility test** above: understate,
undercut with a joke, and leave at least one thread honestly unresolved rather than tying
everything off. Mechanically, this is where full backward traversal opens — every level
free to replay, no earn-it-forward gate left to defend (see **Level control** above).

- **GOOSE comes home — a few years and miles late.** College aspirations, hopes of love,
  life, and happiness — not picked back up where he left them (some of what he left, like
  Evelyn's letters, per **Cast of characters** above, simply isn't there to return to),
  but pursued fresh anyway. The **G.I. Bill**
  (Servicemen's Readjustment Act, 1944 — real, funded both tuition and zero-down home
  loans for returning veterans) reopens the door the deferred-musician backstory left
  ajar. Play his optimism wry, not solemn — the same hopeful naivety that got him through
  basic training, now aimed at paperwork instead of a codebook.
- **Bill doesn't get to go home yet.** He's the one ferrying everyone else back —
  **Operation Magic Carpet** (real: the 1945–46 mass repatriation, hundreds of Liberty and
  Victory ships and even converted carriers with tiered bunks welded into the hangar
  decks, badly overcrowded, running on canned food and hot-bunk schedules). Same job he's
  always had — other people's safety and comfort, never his own — just at the largest
  scale of the whole war.
- **The payoff for the enlisted-ceiling rule above:** the brass that stayed comfortable
  while Bill did the real work all campaign finally makes him an officer — but only now,
  for the safe, homeward-bound job, once there's no danger left to be modest about.
  Vindication and a small insult in the same gesture; play it dry, not triumphant.
- **Bill's actual ending: he retires and teaches Driver's Ed.** Drawn from a real family
  story — a great-uncle who served in the Navy, survived Pearl Harbor, ferried troops home
  after the war, was made an officer to keep him in it, and retired to teach high-school
  Driver's Ed. It's the whole character in miniature — patient, watchful, responsible for
  getting people where they're going safely, just at a much lower speed limit — and it's
  funny rather than solemn, which is exactly what keeps it from tipping into sap. Closing
  image: Bill, mild and unhurried, telling a bored teenager to check their mirrors.
- **Still open, not yet chosen:** a KEN beat that breaks radio format once; whether the
  scout-log thread ("I still write their names — the log still doesn't ask") gets an
  epilogue line at all, and if so, deliberately left unresolved rather than given false
  closure (see the colonial-exposition guardrails in the worked example above); a wry
  rank/mustering-out coda; and a tie-off (or deliberate non-tie-off) for the optional Act 1
  mystery thread. Whatever else lands here, **end on a callback joke, not the sentiment
  itself** — that's the actual mechanism that keeps this reading as warm rather than sappy.

## Easter eggs / historical cameos

Optional, non-required flavor: real people who served in the South Pacific, folded in so a
history buff gets a quiet thrill while everyone else just meets believable sailors.

**Guiding principle — treat these with all proper respect, given the gravity of their
service.** Represent people by **callsign** (on-air) or **first name / nickname** (in
person) — carried by contextual clues, never surnames, never required to enjoy the game. A
dignified hand for anyone who didn't come home, and for the Navajo Code Talkers especially
(an honor, not a gimmick). Keep the geography honest — mislabeling a man's theater is its
own disrespect.

**Method — represent on-air cameos by callsign + subtle clues (the elegant, medium-native
approach; credit: a family brainstorm).** Since stations identify by callsign, a real
person is best evoked as a *station*: a callsign plus subtle personal-detail clues that
most players glide past but a history aficionado recognizes. This is *more* authentic than
naming them — on CW you hear a call, never a first name — and it sidesteps the ethics trap:
you're not putting words in a named person's mouth, just building a plausible station whose
details happen to line up.
- **The fist as a recurring clue (deeply CW-native).** An operator's sending rhythm is
  individually recognizable — "I'd know his fist anywhere." A recurring station with a
  distinctive fist rewards the attentive player across missions and ties straight into the
  music-sense / rhythm-recognition thread in PROJECT-PLAN. A signature fist can *be* the
  easter egg — no words required. **Also reused as an impersonation tell** — see **Soft
  tells before the hard check** under Authenticator codes above.
- **Accuracy over cleverness (the non-negotiable).** Use real, documented callsigns where
  they exist; otherwise period-plausible ones. Only *verifiable* detail — **never fabricate
  quotes, actions, or history to make a cameo land, and never pander.** Keep them peripheral
  (the "Forrest Gump" restraint). The game never winks or confirms; recognition is its own
  reward. **If honoring someone would require bending the truth, leave them out.**
- In-person figures (a comrade on your island, the mentor) still use first-name / contextual
  clues; the callsign method covers everyone met *over the air* — i.e. most cameos.

**Roster vs. method:** the list below is the *who* (candidates, with the theater/role that
fits each); represent each one in-game per the **Method** above — a callsign + subtle clues
(and/or a signature fist) for on-air stations, first name only for a genuine in-person
figure. The names here are for our reference, not necessarily what the player ever sees.

- **The Kennedy brothers.**
  - **"Jack" (JFK)** — the anchor and a perfect fit: a lanky PT-boat skipper from
    Massachusetts with a bad back, rescued after his boat was cut in half; the coconut-shell
    message. In-world comrade.
  - **"Joe" (Joseph Jr.)** — real WW2 role but the *European/Atlantic* theater (Navy
    patrol-bomber pilot flying out of England), killed Aug 1944 volunteering for the
    explosive-drone mission Operation Anvil/Aphrodite. **Not** a Pacific comrade — best as a
    poignant **home-letter mention** ("my brother, flying something hush-hush over
    England"). Handle with a light, respectful touch given he was killed.
  - **"Bobby" (Robert)** — too young; enlisted 1944, his sea service came *postwar* aboard
    the destroyer named for his late brother, no combat. Doesn't fit as a wartime comrade;
    at most a deep-cut namesake-ship nod (with the postwar caveat).
  - Deep-cut tie for buffs: their father was **U.S. Ambassador to Britain** before the war —
    "the ambassador's boys" links them without a surname.
- **The authentic Coastwatchers (the real profession the game depicts — best comrades).**
  - **Jack Read** and **Paul Mason** — Bougainville Coastwatchers whose early-warning calls
    ("forty bombers headed yours") gave Guadalcanal precious minutes; Halsey credited them.
    Ideal distant-radio-voice comrades.
  - **Martin Clemens** — the celebrated Coastwatcher who stayed behind on Guadalcanal.
  - **Reg Evans** + island scouts **Biuku Gasa** and **Eroni Kumana** — the actual heroes of
    the JFK rescue (see the Kennedy note); the on-the-ground rescuers were the islander
    scouts, with Evans coordinating by radio.
  - **The bounty-and-loyalty dynamic — real and Solomons-specific (2026-07-07).** The
    Japanese put a real, documented $100 bounty on a coastwatcher known as "Snow"; a local
    chief, **Pellissi**, talked would-be bounty hunters out of collecting it. Solid grounding
    for a scout-loyalty beat ("they're offering good money for you — I don't need it that
    bad") without borrowing Tweed's story or Guam's geography at all. Treat GOOSE's own
    version as fictional (everyday tier, not a Method cameo) — too little verified detail on
    "Snow" himself to cameo him responsibly.
  - **Caution: Donald Kennedy (a real New Georgia coastwatcher) is not the Kennedy family.**
    Ran his own guerrilla operation and once arranged a single handoff of 20 Allied and 20
    Japanese pilots. Same surname, same general area as the Kennedy-brothers Easter egg
    above — easy to conflate by accident, so keep them clearly distinct in future writing.
    A real cameo candidate in his own right if wanted later.
- **The Navajo Code Talkers (thematic heart).** Marines who used spoken Navajo as an
  unbreakable code, first deployed at Guadalcanal and through the Solomons. Spoken, not
  Morse — but a game *about secure battlefield communication* honoring them is deeply
  resonant. Treat as a dignified appearance, never a novelty.
- **Famous names who genuinely served in the South Pacific.**
  - **James Michener** — a Navy officer roaming these islands, whose notes became *Tales of
    the South Pacific*. A meta-delight: a quiet lieutenant "writing a book about all this."
  - **"Pappy" Boyington** — the Black Sheep Squadron ace out of the Solomons, shot down near
    Rabaul and captured. A swaggering fighter jock who buzzes your island.
  - **Charles Lindbergh** — flew combat P-38 missions in the South Pacific in 1944 as a
    civilian advisor. A famously quiet flyer passing through.
  - **Richard Nixon** — a Navy supply officer in the South Pacific who ran a logistics-and-
    poker operation ("Nick's Snack Shack"). Folds neatly into the **request-supplies**
    mission element as a wry, card-playing supply officer named Dick.
- **Adjacent theaters — use only with correct geography.** **Lee Marvin** (Marine, wounded
  at Saipan — *Central* Pacific), **Rod Serling** (paratrooper in the Philippines —
  *Southwest* Pacific), and **George Tweed** (Navy radioman who evaded Japanese capture on
  Guam for ~2.5 years, sheltered by Chamorro islanders at real cost to them — *Marianas*,
  not Solomons; considered and set aside 2026-07-07): great, resonant stories — Tweed's
  especially, a real precedent for the "lone radio operator kept alive by islanders who pay
  for it" throughline — but keep them off a Solomons island. Worth revisiting only if the
  campaign's geography ever expands. **Holds even for an oblique, name-only mention** — "my
  buddy George" still places him in the Solomons, which he never was; use the dynamic he
  represents (see the bounty-and-loyalty note in Easter eggs below), not his name.
- **Brass as flavor, not comrades.** A relayed order "from Admiral Halsey" (or Nimitz) is
  fine texture; too senior to be ancillary characters.

**Top picks to actually build in:** Michener (perfect meta-fit), the Code Talkers (thematic
heart), and Nixon-at-the-Snack-Shack (ties straight into a mission mechanic) — alongside
Jack as the in-world Kennedy anchor.

**Candidate cameos — teed up, not committed (2026-07-07).** Researched and verified, but
deliberately not assigned to a specific mission — per the "don't be heavy-handed" note, let
these fall into place if a beat naturally wants them, and skip them otherwise.

- **Operation Vengeance — the Yamamoto shootdown (18 Apr 1943, near Bougainville).** The
  single best thematic fit in this list: US radio-intercept sites copied a Japanese naval
  message (JN-25 cipher) giving Admiral Yamamoto's exact flight itinerary; codebreakers
  decoded it, and 339th Fighter Squadron P-38s shot his flight down near Kahili,
  Bougainville. It's a real, spectacular proof that radio interception decides outcomes —
  the whole game's thesis, dramatized at the highest level. **Keep GOOSE radically
  peripheral** — the actual codebreaking was classified work far above a lone coastwatcher;
  this plays best as background scuttlebutt ("did you hear what they did to Yamamoto?")
  reaching him well after the fact, not a mission he touches. Falls chronologically *before*
  New Georgia/Munda in the spine — a transition-screen aside is a more natural home than a
  mission of its own.
- **The Cactus Air Force & Joe Foss (Guadalcanal, Aug–Dec 1942).** The celebrated air
  defense of Henderson Field; Foss became the top-scoring Marine ace of the war (26 kills)
  flying from it. Good "recognizable group" flavor for the Guadalcanal posting, the same
  register as Black Sheep Squadron/Boyington later — a plane overhead, a name on the net,
  never more than that.
- **John Basilone (Guadalcanal, 25–26 Oct 1942).** Medal of Honor machine-gunner who held
  the line at the Battle for Henderson Field; killed later at Iwo Jima (1945), outside this
  story's window. Extremely well-documented and moving, but handle with the same care as
  any real-loss beat — a namedrop should honor the record, not decorate it.

Sources:
[Operation Vengeance – H-Gram 018-2, Naval History and Heritage Command](https://www.history.navy.mil/about-us/leadership/director/directors-corner/h-grams/h-gram-018/h-018-2.html),
[Cactus Air Force – Wikipedia](https://en.wikipedia.org/wiki/Cactus_Air_Force),
[Joe Foss – Wikipedia](https://en.wikipedia.org/wiki/Joe_Foss).

## Worked example — the demo mission ("Kolombangara")

A lean, buildable **demo** of the Clandestine Operator loop (a mid-game, single-day
Coastwatcher mission, ~5–8 min). Deliberately simple: if it works, it becomes the demo. It
still exercises the real spine — tune, copy, encode, send, answer-back, tension, payoff —
with the light running **dawn → noon → dusk** (progress-coupled, per *Representing the
passage of time*).

**Screen (the always-present four quadrants):** upper-left = **mission briefing + notes**
(exposition, and where spotter calls appear); upper-right = **notepad** (live copy);
middle = **the radio** (tune to HQ); bottom = **the codebook** (accumulated since
bootcamp — flip if needed).

**Demo simplifications (locked):**
- **Radio: frequency + power, both live** (mid-game, so both are familiar and their
  penalties understood — no hand-holding). *Frequency* is set once to HQ's sked freq
  (off-freq = no contact / raising static); it stays put after check-in. *Power* is a managed
  risk lever: **too low** → HQ copies you weakly → `AGN?` fills → *more* airtime and
  exposure; **too high** → strong clean copy but the DF hears you sooner and closes faster;
  **the sweet spot** → enough to be copied the *first time* (short airtime) without lighting
  up the DF. So the DF closes on *airtime + accuracy + power* together, and the skill is:
  right power, sent clean and fast.
- **HQ is engaging, not naggy.** 1–2 *reasonable* operational follow-ups per report
  (`TYPE? COURSE? SPEED?`), framed as HQ doing its job. Doubles as natural copy + send
  practice ("good code practice"). Capped so it never grates.
- **Spotter events → mission-notes + a cue.** The scout's call appears in the upper-left
  notes; the relevant control **bolds/flashes** to draw the eye. Keeps it audio-first and
  uncluttered. **Sightings are generated** (random category / count / type / altitude /
  heading), so no two runs match and the report can't be memorised.
- **Intercept deferred.** The enemy-cipher intercept beat needs a second frequency, which
  fights "radio is one-time" — cut from the demo, kept for full missions.

**Naming & the Gilligan wink.** Missions are named for **real islands** (here
**Kolombangara** — a volcanic cone with one dominant summit = "the tallest hill" literally,
overlooking Blackett Strait and the Slot; also the PT-109 water, so the Kennedy easter egg
can share the geography). The drop-off vessel is the **Minnow** — the Gilligan's Island nod
buried where only a fan catches it.

**Representation (non-negotiable, even in the demo).** The spotters are **named Islander
scouts with agency** — the people who actually hauled the 100 lbs up the mountain and read
the strait better than the operator — not "minions." The colonial exploitation folds
**seamlessly and implicitly into the exposition**: never named, never a speech — it lives in
period-normal detail the narrator doesn't flinch at, so the modern player flinches for him.
The target feeling is **unjust necessity that rankles in hindsight** — the point is that
*today* we cringe, and we **cringe twice**: once for ourselves, and again for *them* — that
the people of the time didn't see it the way we now do. That double-cringe is the whole
effect; it only lands if the narrator stays period-normal and unaware. Load-bearing devices:
a diminutive said as normal ("the boys"), unequal pay ("twist tobacco and promises"), the
labor/risk asymmetry (they carry the set barefoot / range the far coast; he minds the
coffee), an inverted savior framing (they thank *him*), and the system's erasure met by a
small wordless dignity ("I write their names in the log; the log doesn't ask" — the
callsign-and-names principle in miniature). Real models to honor (per the cameo Method):
**Jacob Vouza**, Biuku Gasa, Eroni Kumana — kept grave and rare, never casual (a swap to a
fictional scout name is fine if placing a real man in a fictional day feels off). Keep the
anachronistic winks (the Minnow; "I looked after the coffee") to **low-stakes** beats; play
the scouts' courage and any loss completely straight.

**Exposition (sample of the upper-left panel):**

> **Briefing.** STATION GOOSE — Kolombangara. Put ashore by the *Minnow* before dawn. OP on
> the summit; watch Blackett Strait and the Slot. Report shipping and aircraft to HQ (KEN) on
> 4610 kHz; skeds 0600 / 1200 / 1800. Minimum power — there's a DF launch working these
> islands.
>
> **Notes.** Day 14. The set weighs a hundred pounds and I didn't carry it. The scouts did —
> up the mountain track in the dark, barefoot, while I looked after the chronometer and the
> coffee. HQ calls them "the boys" and settles up in twist tobacco and promises. They work
> the far coast, where a man who's caught gets what they gave Vouza, and they go anyway — and
> come morning they grin at me like I'm the one doing them the favor. I've taken to writing
> their names in the log. The log doesn't ask.

**Beats — an interleaved timeline of HQ skeds (copy + ack) and spotter reports (encode +
send), so a real watch-rhythm emerges and the briefing's 0600/1200/1800 skeds are actually
felt:**
0. **Cold open (dawn).** Put ashore by the *Minnow*; the upper-left briefing + notes set
   place, stakes, and the minimum-power rule — and carry the exploitation *implicitly* (see
   the Exposition sample above).
1. **0600 sked — orders (RECEIVE + ack).** Tune to 4610 and take the sked; copy KEN's watch
   orders (`GOOSE DE KEN WATCH SLOT RPT ALL SHIPPING ES ACFT K`), acknowledge with `QSL`
   (or `AGN?` to hear it again). [dawn]
2. **Runner — a *generated* aircraft sighting (OBSERVE → ENCODE → SEND + directed
   answer-back).** The call appears in the notes and the transmit control flashes — e.g.
   *"The headland: six bombers, high, heading east."* Encode from the codebook
   (`KEN DE GOOSE ACFT NR 6 BOMBER HI CSE E K`); the report is validated against the facts and
   **HQ asks (directed) for anything missing/wrong** (`GOOSE DE KEN NR CSE K`) until every
   fact is right. Different every run. [morning]
3. **1030 sked — KEN heads-up (RECEIVE + ack).** *"ACFT EXPECTED MIDDAY — WATCH CLOSE."*
   Copy and `QSL`. A quiet inbound beat between sightings. [morning]
4. **1200 — the payload — a *generated* convoy (big report; light: harsh noon).** *"Four
   destroyers in the strait, running down the Slot."* High-value report; the power decision
   bites (crank up for a clean first copy — exactly what lights up the DF — vs. stay quiet
   and risk a fill). Get every fact right (`KEN DE GOOSE CONVOY 4 DD CSE SE K`). [noon]
5. **1500 sked — KEN acknowledges the convoy (RECEIVE + ack).** *"QSL CONVOY TU — MAINTAIN
   WATCH."* Ties the sked back to what you reported. Copy and `QSL`. [afternoon]
6. **1800 sked — sign-off (RECEIVE + ack → end of day).** *"QRT AT DUSK GN."* Copy, `QSL`,
   and the set goes down. End-of-day tally. Light fades to night. [dusk]

*Not yet wired (design intent): **HQ signal reports** (`QSA`/`QRP`/`QRO`) as the power
dial's first real consequence — the simplest way to make power matter (see the design note
above); the full DF/power squeeze biting on the convoy; a payoff beat (the scramble on your
report); and the wind-down character beat / midnight-boat hook.*

**What the demo proves:** that the loop has a real arc (warm-up → escalate → peak → payoff →
breather) inside one room, a two-knob radio (frequency + power), and ~5–8 minutes, with
light doing the timekeeping, the power/DF squeeze carrying the tension, and HQ's answer-back
carrying the copy practice.

**Code sketch (exists):** the **Adventure** tab (`src/modes/adventure.ts`) plays a full
day of operation — tune to HQ (4610) → copy the 0600 sked orders → acknowledge (or `AGN?`
for a repeat) → a **generated** spotter sighting (random category / count / type / altitude /
heading) posts to the notes and flashes the transmit control → you encode + report it, and
**HQ's directed answer-back** asks for any fact still missing or wrong until the report is
complete → a second generated sighting (the convoy) → HQ `QSL`/`QRT` → dusk. Inbound HQ
traffic is Morse you copy; runners arrive as text; your reports go out as Morse sidetone via
a transmit box (free text + quick `AGN?`/`QSL`); a traffic log records the exchange; the
light walks dawn→morning→noon→dusk across beats; retransmits bump a **danger** readout kept
low this mission. Off-frequency reception is real **static** (filtered noise) and the set
**hums to life** on power-up. A **Show Text** toggle ("plot mode", à la Reading mode) unmasks
inbound HQ traffic for players who'd rather follow along than copy by ear; by default you
make a real copy attempt in the notepad. Every contact word a sighting can generate and every
detail word HQ can request lives in the **codebook** (grouped *contacts* vs *report details*),
so any report — and any HQ follow-up — is constructible from it. This is architecture
**option A** (a themed mode in the existing shell) as a stepping stone; the full-viewport **option B** hub is the eventual
target. Still TODO: notepad-copy grading (the transmitted *report* is validated against the
sighting; the typed copy isn't yet), a real DF timer, the power-vs-detection bite, and
persistence. Build & run via Docker (`docker compose up --build`, served on :4080).

## Open threads / to brainstorm next

- **Campaign structure** — *done:* see **Campaign structure & pacing** above (postings as
  authored 3–5 day arcs, the heat/suspicion two-clock model, calendar-as-montage, rank tied
  to posting transitions, a ~20-mission / ~4–6-posting scope target, and a loose historical
  spine).
- **Paper prototype of one mission** — *done:* see **Worked example — "Kolombangara"** above.
  Next step is to build/playtest that lean demo and find out if the loop is actually fun.
  Things it can't answer on paper: does the one-time tune feel satisfying or trivial, is
  HQ's answer-back the right cadence, and does the flash/bold cue read clearly.
- **The transition screen** — *done:* see **The transition screen** above (light flip vs.
  heavy beat, UI-overlay look, diary-voice staging, implemented as the demo's intro card).
- **Cast of characters & locations (NPC roster)** — *in progress:* see **Cast of
  characters** above for the stateside trio (Andy, Sam, Bill), KEN's clarified status,
  **Pita and Tione** (Kolombangara), **Aaron** (Guadalcanal), the field-companion decline
  arc, and now **Evelyn** (the girl back home) with its matched home-front decline arc.
  Still needed: whether Sam also writes/resurfaces as a correspondent (open — Evelyn's
  arc doesn't resolve this), a one-scene face for the Munda Seabees, voices for the
  endgame coordinator role, named recurring stations and their fists (per the **Method**
  in Easter eggs below), and named locations along the historical spine above.
- **Meta-progression detail** — direction settled (**rank**, with a role-shift to strategy
  at high ranks; now also tied to posting transitions per Campaign structure above). Still
  to pin down: what rank gates, and whether WPM ceiling / brevity vocabulary / unlocked
  islands are separate tracks or all rolled into rank.
- **Rank badges — a visual signifier for promotion, not yet designed (2026-07-13, note
  for later).** The Technician-grade rank ladder above (T/5→T/4→T/3, tied to posting
  transitions) has no visual representation yet — just a narrative beat. Worth
  designing actual insignia-style badges for each promotion, mirrors the QSL-card idea
  parked for Contest mode in `PROJECT-PLAN.md`'s "Challenge mode" note: a real,
  period-appropriate visual form (WWII Technician-grade chevrons, not a generic game
  icon) so a promotion *looks* like the milestone it narratively is.
- **Setting** — leaning **Coastwatcher-first with islands-as-difficulty**; SOE stays a
  possible later skin over the same engine. Confirm before building.
- **Immersive UI language** — the transition screen settled its own chrome (UI overlay, not
  diegetic). Still open: concrete visual direction for the *in-play shack* itself (period set
  vs. modern), and the "immersive mode" chrome-hiding flag on the mode contract.
- **Other capsule concepts** — Coast Station, Aldis Lamp, Rubble Rescue, SAR (from the
  PROJECT-PLAN anthology) can each get a deep-dive section here. *Relay Net now has a design*
  — see **Level type — the relay net** above.
