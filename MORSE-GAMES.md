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
  difficulty, and eventually the strategic view.
- **Messages from home (pacing & character).** Interleave personal letters between tense
  field missions — a **low-pressure, no-DF-timer, slower, warmer copy** that acts as a
  palate cleanser and honors the interruptibility pillar (a calm capsule you can always
  break out of). They build character and stakes (family, a sweetheart), pay off the
  "pining for home" beat, and carry the emotional reward that makes the danger *matter*.
  Occasionally two-way: copy a letter, key a short reply home.
- **Onboarding — a stateside training base as a real place with real stakes (Act 1).** Not
  skipped, but not a sterile HL1 *Hazard Course* either. The HL2 *Train Station* lesson is
  "no *sterile* place," not "no base" — so the base is a legitimate, dramatic first act.
  Key insight: **a training base *licenses* the repetition skill-building needs** — "of
  course you drill for weeks at boot camp" — so iteration feels *earned*, not grindy. This
  is the natural home for the **Koch ramp** (characters, prosigns, brevity codes, the
  send/receive loop). Two goals run in parallel and keep it from being an empty tutorial:
  1. **Primary — get shipped out:** reach the skill bar (the Koch / prosign / brevity-code
     mastery gate = the graduation mechanic). This is a **genuine competency gate** — say,
     *all characters + a ~5–7 WPM floor* (tunable) — not a formality: if you can't copy at a
     basic clip you genuinely aren't ready for the field, so the gate protects you from a
     deep end that wouldn't be fun, and it lets every field mission safely *assume* a
     baseline. The elegant part: it makes fiction and pedagogy the *same thing* — **"ready
     to ship out" literally means "able to copy CW."** No divergence between game goal and
     learning goal (the holy grail for edutainment).
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
  - The instructor — a *harried corporal* / mentor — lives here and carries the
    **coach/conductor persona** from PROJECT-PLAN. Reinforces the reluctant-hero *Father
    Goose* tone (a nobody who turns out to matter).
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
    callsign/pileup drill (PROJECT-PLAN mode 3), and steps toward the high-rank "coordinate a
    network" role.
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
- **Delivery caveats.** No flashback cutscenes (they break the single-room immersion and the
  show-don't-tell rule); keep the music metaphor as *flavor in his noticing*, not constant
  winking; let the deferred life live implicitly in the **letters from home** (a bandmate, a
  director, a scholarship held open).

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
  easter egg — no words required.
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
  at Saipan — *Central* Pacific) and **Rod Serling** (paratrooper in the Philippines —
  *Southwest* Pacific): great names, but keep them off a Solomons island.
- **Brass as flavor, not comrades.** A relayed order "from Admiral Halsey" (or Nimitz) is
  fine texture; too senior to be ancillary characters.

**Top picks to actually build in:** Michener (perfect meta-fit), the Code Talkers (thematic
heart), and Nixon-at-the-Snack-Shack (ties straight into a mission mechanic) — alongside
Jack as the in-world Kennedy anchor.

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
   (`GOOSE DE KEN ACFT NR 6 BOMBER HI CSE E K`); the report is validated against the facts and
   **HQ asks (directed) for anything missing/wrong** (`GOOSE DE KEN NR CSE K`) until every
   fact is right. Different every run. [morning]
3. **1030 sked — KEN heads-up (RECEIVE + ack).** *"ACFT EXPECTED MIDDAY — WATCH CLOSE."*
   Copy and `QSL`. A quiet inbound beat between sightings. [morning]
4. **1200 — the payload — a *generated* convoy (big report; light: harsh noon).** *"Four
   destroyers in the strait, running down the Slot."* High-value report; the power decision
   bites (crank up for a clean first copy — exactly what lights up the DF — vs. stay quiet
   and risk a fill). Get every fact right (`GOOSE DE KEN CONVOY 4 DD CSE SE K`). [noon]
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

- **Campaign structure** — the *shape* now exists (rank arc, the element kit, the
  *Father Goose* plot direction). Still to work out: how missions string into an arc, how
  difficulty *and* story escalate together, and what a single 5-minute capsule looks like
  beat-by-beat.
- **Paper prototype of one mission** — *done:* see **Worked example — "Kolombangara"** above.
  Next step is to build/playtest that lean demo and find out if the loop is actually fun.
  Things it can't answer on paper: does the one-time tune feel satisfying or trivial, is
  HQ's answer-back the right cadence, and does the flash/bold cue read clearly.
- **Meta-progression detail** — direction settled (**rank**, with a role-shift to strategy
  at high ranks). Still to pin down: what rank gates, and whether WPM ceiling / brevity
  vocabulary / unlocked islands are separate tracks or all rolled into rank.
- **Setting** — leaning **Coastwatcher-first with islands-as-difficulty**; SOE stays a
  possible later skin over the same engine. Confirm before building.
- **Immersive UI language** — concrete visual direction for the radio-room aesthetic
  (period set vs. modern), and the "immersive mode" chrome-hiding flag on the mode
  contract.
- **Other capsule concepts** — Coast Station, Aldis Lamp, Rubble Rescue, SAR (from the
  PROJECT-PLAN anthology) can each get a deep-dive section here. *Relay Net now has a design*
  — see **Level type — the relay net** above.
