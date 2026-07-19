// Adventure mode (sketch): the "radio shack" set for the Morse Adventures game
// concept — see MORSE-GAMES.md. A first playable pass at the "Kolombangara" demo
// mission: the four-quadrant shack (briefing/notes, a copy notepad, the radio you
// tune, and your codebook) walked through a full day of operation.
//
// The day is an INTERLEAVED event timeline that alternates two kinds of beat, so
// it feels like a real watch rather than a spotter free-for-all:
//   • SKED  — HQ (KEN) calls you on a schedule with a directive; you copy it and
//             acknowledge (QSL). Inbound / RECEIVE.
//   • SPOT  — a scout runner posts a sighting; you encode it and report to HQ,
//             which asks (directed) for any fact still missing/wrong. Outbound / SEND.
//
// Spotter sightings are GENERATED (random category / count / type / altitude /
// heading), so no two runs are alike. Inbound HQ traffic is Morse you copy; runners
// arrive as text; your sends go out as Morse sidetone. Light walks dawn→dusk across
// the timeline. Retransmissions (AGN repeats, incomplete reports that need a second
// pass) bump a real retryCount-driven danger readout — see "Danger escalation" near
// the RELAY scenario below, where it's first wired up for real.
//
// First contact each day is CHALLENGED (AUTHENTICATE / I AUTHENTICATE — real WWII
// Signal Operating Instructions prowords). The briefing prints today's authenticator
// table, generated fresh per mission; KEN's 0600 orders carry a live challenge from
// that table, and your QSL must carry "I AUTHENTICATE <code>" in the same
// transmission before KEN will log it. See MORSE-GAMES.md's "Authenticator codes"
// note for the design rationale.

import { MorseEngine } from "../audio/morse-engine";
import { loadSettings, Settings } from "../stats/storage";
import { Rule, respond } from "../dialogue/engine";
import { tokenize, tokenizeWords, includesSequence } from "../dialogue/tokens";

const HQ_CALL = "KEN"; // net control (HQ)
const MY_CALL = "GOOSE"; // this station
const RELAY_CALL = "SKIP"; // a second coastwatcher post, out of KEN's direct reach
const FREQ_MIN = 4000;
const FREQ_MAX = 5200;
const ON_FREQ_KHZ = 5; // within this window, HQ is readable — one grid step, so the readout actually matches the briefing
const FREQ_SETTLE_MS = 700; // dwell time on a steady frequency before static/the sked fires
const CLOCK_TRANSITION_PAUSE_MS = 4000; // beat between events so the player notices the clock jump, not just a harried KEN
const OVERHEAR_PAUSE_MS = 2500; // how long "not for you" traffic lingers before the day moves on by itself

const SPOT_ACK = `${MY_CALL} DE ${HQ_CALL} QSL K`; // HQ's ack of a completed report

/** Today's sked frequency — generated fresh per mission, same SOI logic as the
 *  authenticator table (real Signal Operating Instructions bundled call signs,
 *  frequencies, and authentication together, and all changed periodically). A
 *  multiple of 5 kHz, comfortably inside the dial so the on-freq window never
 *  clips an edge. */
function makeHqFreqKhz(): number {
  const lo = 4200,
    hi = 5000;
  return lo + 5 * randInt(0, (hi - lo) / 5);
}

// ---- Sighting generator ---------------------------------------------------

interface Sighting {
  category: "ACFT" | "SHIP";
  count: number;
  type: string; // codebook code: FLOATPLANE/BOMBER/FIGHTER | DD/AK
  alt?: "HI" | "LO"; // aircraft only
  dir: string; // compass code
  prose: string; // what the runner says
}

const ACFT_TYPES = ["FLOATPLANE", "BOMBER", "FIGHTER"];
const SHIP_TYPES = ["DD", "AK"]; // kept to codebook entries so reports stay constructible
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const TYPE_NAME: Record<string, string> = {
  FLOATPLANE: "floatplane",
  BOMBER: "bomber",
  FIGHTER: "fighter",
  DD: "destroyer",
  AK: "transport",
  PT: "PT boat",
};
const DIR_WORD: Record<string, string> = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
};
const PLACES = ["the north point", "the headland", "off the reef", "the far shore"];

// Report fields required per sighting, and how HQ / the operator name them.
const PROWORD: Record<string, string> = { count: "NR", type: "TYPE", alt: "ALT", dir: "CSE" };
const FIELD_LABEL: Record<string, string> = {
  count: "number",
  type: "type",
  alt: "altitude",
  dir: "course",
};

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dirPhrase(dir: string): string {
  if (dir === "SE") return "running down the Slot";
  if (dir === "NW") return "coming up the Slot";
  return `heading ${DIR_WORD[dir]}`;
}

function makeAircraftSighting(): Sighting {
  const count = randInt(1, 6);
  const type = pick(ACFT_TYPES);
  const alt: "HI" | "LO" = Math.random() < 0.5 ? "HI" : "LO";
  const dir = pick(DIRS);
  const name = TYPE_NAME[type] + (count > 1 ? "s" : "");
  const prose = `${cap(pick(PLACES))}: ${count} ${name}, ${alt === "HI" ? "high" : "low"}, ${dirPhrase(dir)}.`;
  return { category: "ACFT", count, type, alt, dir, prose };
}

function makeShipSighting(): Sighting {
  const count = randInt(3, 6);
  const type = pick(SHIP_TYPES);
  const dir = pick(DIRS);
  const name = TYPE_NAME[type] + (count > 1 ? "s" : "");
  const prose = `${count} ${name} in the strait, ${dirPhrase(dir)}.`;
  return { category: "SHIP", count, type, dir, prose };
}

// ---- Authenticator table ---------------------------------------------------
// Real WWII Signal Operating Instructions issued authenticator tables that changed
// periodically; AUTHENTICATE / I AUTHENTICATE are the real prowords (the station
// challenged replies with the group paired to the one it was given). Demo
// simplification: one small table, generated fresh per mission, and only the day's
// first contact is challenged — real practice authenticated per contact, not per
// message. Letters avoid K/Q/R, which already mean something else in this net.

const AUTH_CHALLENGES = ["B", "D", "F", "H", "J", "L", "M", "N", "P", "S", "T", "V", "W", "X", "Y", "Z"];

interface AuthPair {
  challenge: string;
  response: string;
}

function makeAuthTable(): AuthPair[] {
  const letters = [...AUTH_CHALLENGES];
  const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const table: AuthPair[] = [];
  for (let i = 0; i < 3; i++) {
    const letterIdx = Math.floor(Math.random() * letters.length);
    const challenge = letters.splice(letterIdx, 1)[0];
    const digitIdx = Math.floor(Math.random() * digits.length);
    const response = digits.splice(digitIdx, 1)[0];
    table.push({ challenge, response });
  }
  return table;
}

function requiredFields(s: Sighting): string[] {
  return s.category === "ACFT" ? ["count", "type", "alt", "dir"] : ["count", "type", "dir"];
}
function fieldSatisfied(field: string, s: Sighting, tk: Set<string>): boolean {
  switch (field) {
    case "count":
      return tk.has(String(s.count));
    case "type":
      return tk.has(s.type) || [...tk].some((t) => t.startsWith(s.type));
    case "alt":
      return s.alt ? tk.has(s.alt) : true;
    case "dir":
      return tk.has(s.dir);
    default:
      return true;
  }
}

// ---- Day timeline ---------------------------------------------------------

type DayEvent =
  | { kind: "sked"; clock: string; light: string; msg: string; prompt: string; final?: boolean }
  | { kind: "spot"; clock: string; light: string; sighting: Sighting }
  // A third station (RELAY_CALL) has traffic for HQ that can't reach HQ directly —
  // copy it, acknowledge the sender, then re-address and forward to HQ. See
  // "Level type — the relay net" in MORSE-GAMES.md.
  | { kind: "relay"; clock: string; light: string; from: string; sighting: Sighting }
  // Traffic between two OTHER stations, overheard on the same frequency — nothing
  // to do but recognize it isn't for you and not answer it (monitoring discipline).
  | { kind: "overhear"; clock: string; light: string; from: string; to: string; msg: string };

/** Built once per transmit() call and handed to the dialogue engine's rule table. */
interface DialogueInput {
  msg: string; // trimmed, uppercased raw transmission
  words: string[]; // tokenizeWords(msg)
  isAgn: boolean; // msg.includes("AGN") — a raw substring check, not token-based (see below)
  tk: Set<string>; // tokenize(msg)
}

// ---- Scenarios --------------------------------------------------------
// A Scenario bundles everything about one playable "day" — cold-open copy,
// briefing/notes text, and the event timeline — so AdventureMode can run any
// of them off the same engine.
//
// INTENT (2026-07-09, revisit before reaching for JSON/YAML or a macro
// language here): stay hand-authored TypeScript — a Scenario is a plain
// object, its dynamic bits are plain functions/closures (briefing(),
// buildTimeline(), the sighting generators) — not a generic mission DSL with
// externalized data and a template/expression interpreter. The campaign's
// planned scope is small and enumerable (~20-25 missions total, including
// training, per MORSE-GAMES.md's mission-allocation draft), so the content
// doesn't need an engine that outlives what we hand-write for it. Templating
// this too early risks solving a "parse -> compute -> parse" problem we don't
// have yet, at the cost of a rigid schema that can't express whatever the
// next mission actually needs — i.e. painting ourselves into a corner on
// mission variability by templatizing too early. TypeScript functions already
// give real tooling (type-checking, autocomplete, refactors) that a string-
// keyed data format would have to reinvent. Reconsider only if the scope
// changes to something genuinely open-ended (a Zork-style engine meant to
// outlive any specific authored content) rather than a bounded campaign.
interface Scenario {
  id: string;
  dayTag: string; // e.g. "Kolombangara · Day 14" — shown on both transition cards
  introTitle: string; // h2 on the cold-open card
  introCopy: string;
  notes: string; // upper-left Notes panel text
  briefing(hqFreqKhz: number): string; // upper-left Briefing panel text
  buildTimeline(authChallenge: string): DayEvent[];
  outroCopy: string; // sentence appended after the day's tally on the outro card
  outroAside?: string; // shown only on this scenario's outro — a payoff beat
}

const KOLOMBANGARA_DAY14: Scenario = {
  id: "kolombangara-14",
  dayTag: "Kolombangara · Day 14",
  introTitle: "Station GOOSE",
  introCopy:
    "Before dawn the Minnow put you ashore below the summit and slipped back " +
    "out into the dark. The scouts had the set up the mountain track before " +
    "your boots were dry. Another day on the ridge, watching the Slot.",
  notes:
    "Day 14. The set weighs a hundred pounds and I didn't carry it. The scouts did — " +
    "up the mountain track in the dark, barefoot, while I looked after the chronometer " +
    'and the coffee. HQ calls them "the boys" and settles up in twist tobacco and ' +
    "promises. They work the far coast, where a man who's caught gets what they gave " +
    "Vouza, and they go anyway — and come morning they grin at me like I'm the one " +
    "doing them the favor. I've taken to writing their names in the log. The log " +
    "doesn't ask.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Kolombangara. Put ashore by the Minnow before dawn. OP on the " +
    "summit; watch Blackett Strait and the Slot. Report shipping and aircraft to HQ " +
    `(KEN) on ${hqFreqKhz} kHz; skeds 0600 / 1200 / 1800. Minimum power — there's a DF launch ` +
    "working these islands.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} WATCH SLOT RPT ALL SHIPPING ES ACFT AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0800", light: "morning", sighting: makeAircraftSighting() },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} ACFT EXPECTED MIDDAY WATCH CLOSE K`,
      prompt: "Copy KEN's heads-up, then acknowledge (QSL).",
    },
    { kind: "spot", clock: "1200", light: "noon", sighting: makeShipSighting() },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} QSL CONVOY TU MAINTAIN WATCH K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} QRT AT DUSK GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "Another day on the ridge, logged and quiet. Tomorrow the Slot will be watching back.",
};

/** The day's centerpiece — scripted, not generated, so the real hull number
 *  lands the same way every run (see MORSE-GAMES.md's PT-109 note). The
 *  report grades through the same requiredFields()/fieldSatisfied() path as
 *  any other ship sighting; no new mechanic. */
const PT109_SIGHTING: Sighting = {
  category: "SHIP",
  count: 1,
  type: "PT",
  dir: "SE",
  prose:
    "The boy is out of breath: wreckage off the reef, cut clean in two — a small one, " +
    "hull number still showing through the char. One-oh-nine. Survivors, he thinks — " +
    "washed up along the reef to the southeast.",
};

const KOLOMBANGARA_DAY3: Scenario = {
  id: "kolombangara-3",
  dayTag: "Kolombangara · Day 17",
  introTitle: "Station GOOSE",
  introCopy:
    "Three quiet days since the last convoy report — routine skeds, routine light. Then, " +
    "somewhere out past the point last night: a flash on the water, gone before the sound " +
    "of it caught up. Nobody in the shack knows what it was yet.",
  notes:
    "Day 17. The boy came up the track before first light, quieter than usual. Something " +
    "happened out past the reef last night — a flash, no gunfire after — but the coast " +
    "hadn't sent word yet. Whatever it was, HQ will want to know the moment anyone does.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Kolombangara. Same OP, same watch: Blackett Strait and the Slot. " +
    `Report shipping and aircraft to HQ (KEN) on ${hqFreqKhz} kHz; skeds 0600 / 1200 / 1800. ` +
    "Minimum power — the DF launch hasn't gone anywhere.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} WATCH SLOT RPT ALL SHIPPING ES ACFT AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0800", light: "morning", sighting: makeAircraftSighting() },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} RPT ANY WRECKAGE OR SURVIVORS STRAIT K`,
      prompt: "Copy KEN's heads-up, then acknowledge (QSL).",
    },
    { kind: "spot", clock: "1200", light: "noon", sighting: PT109_SIGHTING },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} QSL RPT LOGGED MAINTAIN WATCH K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} QRT AT DUSK GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "Another day on the ridge, logged and quiet. Whatever happened out past the reef, it's someone else's watch now.",
  outroAside:
    "Weeks later, word came down the net: a coconut shell, carved in a hand not much " +
    'older than yours — "11 ALIVE NATIVE KNOWS POSIT & REEF NARU ISLAND KENNEDY." ' +
    "Rendova got the message.",
};

/** A different game feel from the first two days: most of the mechanics are
 *  reused (skeds, a spot report, the authenticator), but the centerpiece is a
 *  relay beat — SKIP, a second post further up the strait, can't reach KEN
 *  directly, so GOOSE copies SKIP's traffic, acknowledges SKIP, and forwards a
 *  fact-complete report to KEN. Get the forward wrong and KEN — who caught
 *  fragments of SKIP's own weak signal too, just not enough to act on alone —
 *  flags the mismatch rather than silently failing. A "not for you" exchange
 *  right after tests whether the player has learned to tell the two apart.
 *  See MORSE-GAMES.md's "Level type — the relay net". */
const KOLOMBANGARA_DAY_RELAY: Scenario = {
  id: "kolombangara-relay",
  dayTag: "Kolombangara · Day 23",
  introTitle: "Station GOOSE",
  introCopy:
    "Six days since the boy brought the news about the wreckage. Today HQ's added a " +
    "wrinkle to the watch: a second post further up the strait, SKIP, whose signal " +
    "barely clears the reef most mornings. When it doesn't reach KEN, it reaches you " +
    "instead.",
  notes:
    "Day 23. There's another set up the coast — SKIP, on the net — too far from KEN's " +
    "ears and too proud to say so outright. When SKIP's traffic won't carry, it lands " +
    "on me: copy it, tell SKIP I've got it, then say it again, addressed right, for " +
    "KEN. Get it wrong and it's not just static — it's a report that never arrives.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Kolombangara. Same OP, same watch: Blackett Strait and the Slot. " +
    `Report shipping and aircraft to HQ (KEN) on ${hqFreqKhz} kHz; skeds 0600 / 1200 / 1800. ` +
    `A second post, ${RELAY_CALL}, works the coast north of you — out of KEN's reach most ` +
    `days. When ${RELAY_CALL} calls, copy it, acknowledge ${RELAY_CALL}, then forward it to ` +
    "KEN, addressed right. Minimum power — the DF launch hasn't gone anywhere.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} WATCH SLOT RPT ALL SHIPPING ES ACFT AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0800", light: "morning", sighting: makeAircraftSighting() },
    { kind: "relay", clock: "1030", light: "morning", from: RELAY_CALL, sighting: makeShipSighting() },
    {
      kind: "overhear",
      clock: "1200",
      light: "noon",
      from: RELAY_CALL,
      to: HQ_CALL,
      msg: `${HQ_CALL} DE ${RELAY_CALL} QRU K`,
    },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} QSL RELAY LOGGED MAINTAIN WATCH K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} QRT AT DUSK GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "Another day on the ridge — and one more voice on the net you can now put a name to.",
};

const SCENARIOS: Scenario[] = [KOLOMBANGARA_DAY14, KOLOMBANGARA_DAY3, KOLOMBANGARA_DAY_RELAY];

type Phase = "cold" | "onair" | "sked" | "spot" | "relay" | "overhear" | "done";

export class AdventureMode {
  private root: HTMLElement;
  private settings: Settings;
  private engine: MorseEngine;

  private scenario: Scenario = SCENARIOS[0];
  private phase: Phase = "cold";
  private radioOn = false; // distinct from phase: lets the player kill power mid-day by mistake without ending the run
  private playing = false;
  private freqKhz = 4200; // start off-frequency so tuning is the first task
  private power = 10; // watts, 0..100; low = quiet/faint, high = strong/exposed
  private txCount = 0;
  private showText = false; // "plot mode": reveal inbound HQ traffic as text
  private clock = "—";
  // tag overrides the displayed sender for "ken"-tagged (inbound-Morse) entries —
  // the relay mission's SKIP traffic reuses the same masked-until-Show-Text path
  // as HQ traffic, just under a different callsign.
  private traffic: { who: "ken" | "you" | "run" | "log"; msg: string; clock: string; tag?: string }[] = [];
  private day: DayEvent[] = [];
  private evtIx = 0;
  private need: string[] = []; // report fields still outstanding for the current spot/relay-forward
  private relayAcked = false; // acknowledged the relay sender (e.g. SKIP) this beat
  private relayForwardDone = false; // forwarded a complete report to HQ this beat
  private retryCount = 0; // AGN repeats + incomplete-report resends this run — drives dangerLabel
  private authTable: AuthPair[] = []; // today's authenticator table
  private liveAuthIdx = 0; // which row of authTable KEN actually challenges with, randomized per run
  private hqFreqKhz = 0; // today's sked frequency, generated fresh in mount()
  private freqSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private freqSettleMissed = false; // a knob change landed while audio was playing and got dropped; re-check once it ends

  // element refs
  private elShack!: HTMLElement;
  private elStatus!: HTMLElement;
  private elDay!: HTMLElement;
  private elFreqOut!: HTMLElement;
  private elPowerOut!: HTMLElement;
  private elDials!: HTMLElement;
  private setKnobDisabled!: (disabled: boolean) => void;
  private setPowerKnobDisabled!: (disabled: boolean) => void;
  private elNotesFeed!: HTMLElement;
  private elTraffic!: HTMLElement;
  private elDanger!: HTMLElement;
  private elStartBtn!: HTMLButtonElement;
  private elShowTextBtn!: HTMLButtonElement;
  private elTxRow!: HTMLElement;
  private elTxInput!: HTMLInputElement;
  private elTxBtn!: HTMLButtonElement;
  private elNotepad!: HTMLTextAreaElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.engine = new MorseEngine({
      charWpm: this.settings.charWpm,
      effectiveWpm: this.settings.effectiveWpm,
      frequencyHz: this.settings.frequencyHz,
    });
  }

  mount(): void {
    this.resetRun();
  }

  unmount(): void {
    this.engine.stop();
    this.clearFreqSettle();
  }

  /** (Re)start a fresh run: reset all per-day state, generate a new day (new
   *  sightings, authenticator table, sked frequency), and return to the intro
   *  card. Used by mount(), by "Replay the day" on the outro screen, and by
   *  the mission picker to switch scenarios — see the transition-screen /
   *  Replay discussion in MORSE-GAMES.md. */
  private resetRun(scenario: Scenario = this.scenario): void {
    this.scenario = scenario;
    this.clearFreqSettle();
    this.freqSettleMissed = false;
    this.phase = "cold";
    this.radioOn = false;
    this.playing = false;
    this.freqKhz = 4200;
    this.power = 10;
    this.txCount = 0;
    this.showText = false;
    this.clock = "—";
    this.traffic = [];
    this.evtIx = 0;
    this.need = [];
    this.relayAcked = false;
    this.relayForwardDone = false;
    this.retryCount = 0;
    this.authTable = makeAuthTable(); // generated fresh — see the authenticator note above
    this.liveAuthIdx = randInt(0, this.authTable.length - 1); // which row KEN actually challenges with
    this.hqFreqKhz = makeHqFreqKhz(); // generated fresh — same SOI logic as the auth table
    this.day = scenario.buildTimeline(this.authTable[this.liveAuthIdx].challenge); // this run's mix of skeds + generated sightings
    this.root.innerHTML = "";
    this.root.appendChild(this.buildIntro());
  }

  // ---- Intro / transition --------------------------------------------------

  /** The "light flip" cold-open card: sets up the character and place before
   *  the operational briefing appears. Its own view, swapped for the shack on
   *  "Begin the watch" — see the transition-screen discussion in MORSE-GAMES.md. */
  private buildIntro(): HTMLElement {
    const view = el("section", "adventure-intro dawn");
    const card = el("div", "intro-card");
    card.appendChild(text("div", "intro-tag", this.scenario.dayTag));
    card.appendChild(text("h2", "intro-title", this.scenario.introTitle));
    card.appendChild(text("p", "intro-copy", this.scenario.introCopy));
    card.appendChild(this.buildTransitionRow("Begin the watch", () => this.beginShack()));
    view.appendChild(card);
    return view;
  }

  /** Three fixed slots below a transition card's exposition — left/center/right,
   *  so the primary action ("Begin the watch" on the intro, "Replay the day" on
   *  the outro below) always sits dead center regardless of whether prev/next
   *  exist. Missing prev/next slots render as blank space, not a collapsed row,
   *  so the layout never shifts — the doc's sanctioned home for level-select
   *  chrome (it explicitly keeps this off the in-play shack). Every mission is
   *  unlocked for the demo, so "Next mission" is left wide open — the plan is
   *  to eventually gate it behind mission accomplishments. */
  private buildTransitionRow(primaryLabel: string, onPrimary: () => void): HTMLElement {
    const idx = SCENARIOS.findIndex((s) => s.id === this.scenario.id);
    const prev = idx > 0 ? SCENARIOS[idx - 1] : null;
    const next = idx < SCENARIOS.length - 1 ? SCENARIOS[idx + 1] : null;

    const row = el("div", "mission-nav");
    row.appendChild(
      prev
        ? button("Previous mission", "btn ghost mission-nav-slot", () => this.resetRun(prev))
        : el("span", "mission-nav-slot")
    );
    row.appendChild(button(primaryLabel, "btn primary mission-nav-slot", onPrimary));
    row.appendChild(
      next
        ? button("Next mission", "btn ghost mission-nav-slot", () => this.resetRun(next))
        : el("span", "mission-nav-slot")
    );
    return row;
  }

  /** Flip from the intro card into the radio shack. */
  private beginShack(): void {
    this.root.innerHTML = "";
    this.elShack = el("section", "adventure dawn");
    this.elShack.append(
      this.buildBriefing(),
      this.buildRadio(),
      this.buildNotepad(),
      this.buildCodebook()
    );
    this.root.appendChild(this.elShack);
    this.refresh();
  }

  // ---- Quadrants ----------------------------------------------------------

  private buildBriefing(): HTMLElement {
    const panel = el("div", "shack-panel shack-briefing");
    panel.appendChild(text("h2", "shack-title", "Station GOOSE — Kolombangara"));
    panel.appendChild(text("div", "shack-label", "Briefing"));
    panel.appendChild(text("p", "brief", this.scenario.briefing(this.hqFreqKhz)));
    panel.appendChild(text("div", "shack-label", "Authenticator (today) — SOI table"));
    const authGrid = el("div", "codebook codebook--single");
    for (const { challenge, response } of this.authTable) {
      const row = el("div", "codebook-row");
      row.append(text("span", "code-k", challenge), text("span", "code-v", `→ ${response}`));
      authGrid.appendChild(row);
    }
    panel.appendChild(authGrid);
    panel.appendChild(text("div", "shack-label", "Notes"));
    panel.appendChild(text("p", "notes", this.scenario.notes));
    this.elNotesFeed = el("div", "notes-feed"); // spotter runners land here
    panel.appendChild(this.elNotesFeed);
    return panel;
  }

  private buildNotepad(): HTMLElement {
    const panel = el("div", "shack-panel shack-notepad");
    panel.appendChild(text("div", "shack-label", "Notepad — copy as you go"));
    const ta = document.createElement("textarea");
    ta.className = "notepad";
    ta.rows = 8;
    ta.spellcheck = false;
    ta.placeholder = "type what you copy…";
    panel.appendChild(ta);
    this.elNotepad = ta;
    return panel;
  }

  private buildRadio(): HTMLElement {
    const panel = el("div", "shack-panel shack-radio");
    const head = el("div", "shack-label");
    head.textContent = "The set";
    this.elDay = text("span", "day-label", "— dawn —");
    head.appendChild(this.elDay);
    panel.appendChild(head);

    this.elStatus = text("div", "shack-status", "Warm up the set to begin.");
    panel.appendChild(this.elStatus);

    // Controls — Power comes first: it's the master switch, highlighted while
    // everything else is cold, and gates the dials below until warmed up.
    const controls = el("div", "shack-controls");
    this.elStartBtn = button("⏻", "btn primary btn-power power-glow", () => void this.togglePower());
    this.elStartBtn.setAttribute("aria-label", "Power");
    this.elStartBtn.title = "Power on the set";
    this.elShowTextBtn = button("Show Text: Off", "btn ghost", () => this.toggleText());
    controls.append(this.elStartBtn, this.elShowTextBtn);
    panel.appendChild(controls);

    // Dials — Frequency (big, left) and TX Power (small, right), side by
    // side like the tuning + volume knobs on a real set. Cold (dimmed,
    // unresponsive) until Power warms the set up; see refresh().
    this.elDials = el("div", "shack-dials cold");
    const dialsRow = el("div", "dials-row");

    const freqRow = el("div", "knob-row");
    const { el: freqKnobEl, setDisabled: setKnobDisabled } = buildKnob(
      FREQ_MIN,
      FREQ_MAX,
      5,
      this.freqKhz,
      (v) => {
        this.freqKhz = v;
        this.scheduleFreqSettle();
        this.refresh();
      },
      { size: "lg", ariaLabel: "Frequency" }
    );
    this.setKnobDisabled = setKnobDisabled;
    const freqReadout = el("div", "knob-readout");
    freqReadout.appendChild(text("span", "dial-name", "Frequency"));
    this.elFreqOut = text("div", "dial-value knob-value", "");
    freqReadout.appendChild(this.elFreqOut);
    freqRow.append(freqKnobEl, freqReadout);
    dialsRow.appendChild(freqRow);

    const powRow = el("div", "knob-row knob-row--sm");
    const { el: powKnobEl, setDisabled: setPowerKnobDisabled } = buildKnob(
      0,
      100,
      1,
      this.power,
      (v) => {
        this.power = v;
        const hint = this.powerHint(v);
        if (hint) this.setStatus(hint);
        this.refresh();
      },
      { size: "sm", ariaLabel: "TX Power" }
    );
    this.setPowerKnobDisabled = setPowerKnobDisabled;
    const powReadout = el("div", "knob-readout knob-readout--right");
    powReadout.appendChild(text("span", "dial-name", "TX Power"));
    this.elPowerOut = text("div", "dial-value knob-value", "");
    powReadout.appendChild(this.elPowerOut);
    powRow.append(powReadout, powKnobEl);
    dialsRow.appendChild(powRow);

    this.elDials.appendChild(dialsRow);
    panel.appendChild(this.elDials);

    // Transmit
    this.elTxRow = el("div", "tx-row");
    this.elTxInput = document.createElement("input");
    this.elTxInput.type = "text";
    this.elTxInput.className = "tx-input";
    this.elTxInput.spellcheck = false;
    this.elTxInput.placeholder = "key a message to KEN…";
    this.elTxInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const msg = this.elTxInput.value;
        this.focusNotepad();
        void this.transmit(msg);
      }
    });
    this.elTxBtn = button("▶ Transmit", "btn", () => {
      const msg = this.elTxInput.value;
      this.focusNotepad();
      void this.transmit(msg);
    });
    this.elTxRow.append(this.elTxInput, this.elTxBtn);
    panel.appendChild(this.elTxRow);

    this.elDanger = text("div", "danger", "");
    panel.appendChild(this.elDanger);

    this.elTraffic = el("div", "traffic");
    panel.appendChild(this.elTraffic);

    return panel;
  }

  private buildCodebook(): HTMLElement {
    const panel = el("div", "shack-panel shack-codebook");
    panel.appendChild(text("div", "shack-label", "Codebook (since bootcamp)"));

    const groups: { id: string; title: string; entries: [string, string][] }[] = [
      {
        id: "callsigns",
        title: "Callsigns & dial",
        entries: [
          ["sked freq", `${HQ_CALL}'s day sked (kHz) — today's is in the Briefing, not fixed`],
          [HQ_CALL, "HQ / net control"],
          [MY_CALL, "you (this station)"],
          [RELAY_CALL, "a second coastwatcher post — often can't reach HQ direct, relies on you"],
        ],
      },
      {
        id: "prowords",
        title: "Prowords",
        entries: [
          ["DE", "this is / from"],
          ["K", "over / go ahead"],
          ["RPT", "report"],
          ["ES", "and"],
          ["AGN", "say again"],
          ["QSL", "acknowledged"],
          ["QRZ", "who is calling me? — you dropped your ID"],
          ["QRT", "shut down / go silent"],
          ["QRU", "nothing heard / anything for me?"],
          ["QTC", "I have traffic for __"],
          ["QSP", "relay / I'll relay"],
          ["TU", "thanks"],
          ["GN", "good night"],
          ["AUTHENTICATE", "reply to the challenge that follows"],
          ["I AUTHENTICATE", "the group that follows is my reply"],
        ],
      },
      {
        id: "contacts",
        title: "Contacts (what you saw)",
        entries: [
          ["ACFT", "aircraft"],
          ["FLOATPLANE", "floatplane (recon, on floats)"],
          ["BOMBER", "bomber"],
          ["FIGHTER", "fighter"],
          ["CONVOY", "group of ships"],
          ["DD", "destroyer"],
          ["AK", "transport / cargo ship"],
          ["PT", 'PT boat — small, fast ("patrol torpedo boat")'],
        ],
      },
      {
        id: "report",
        title: "Report details (what HQ asks for)",
        entries: [
          ["NR", "number — how many"],
          ["TYPE", "class of contact — what kind"],
          ["ALT", "altitude — answer HI or LO"],
          ["HI / LO", "high / low"],
          ["CSE", "course — heading"],
          ["compass", "N NE E SE S SW W NW — the Slot runs NW–SE (“down” = SE)"],
        ],
      },
    ];

    // Quick-jump to a group — everything stays on the page (no tabs hiding
    // content), this just scrolls. Matters once more groups pile up.
    const nav = el("div", "codebook-nav");
    for (const g of groups) {
      const link = document.createElement("a");
      link.href = `#codebook-${g.id}`;
      link.className = "codebook-nav-link";
      link.textContent = g.title;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(`codebook-${g.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(link);
    }
    panel.appendChild(nav);

    // Live search — filters rows by code or meaning as the codebook grows,
    // instead of burying entries behind tabs.
    const searchRow = el("div", "codebook-search-row");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "codebook-search";
    search.spellcheck = false;
    search.placeholder = "Search codes or meanings…";
    const searchCount = text("span", "codebook-search-count", "");
    searchRow.append(search, searchCount);
    panel.appendChild(searchRow);

    const groupEls: { header: HTMLElement; grid: HTMLElement; rows: { row: HTMLElement; haystack: string }[] }[] = [];
    for (const g of groups) {
      const header = text("div", "code-group", g.title);
      header.id = `codebook-${g.id}`;
      panel.appendChild(header);
      const grid = el("div", "codebook");
      const rows: { row: HTMLElement; haystack: string }[] = [];
      for (const [k, v] of g.entries) {
        const row = el("div", "codebook-row");
        row.append(text("span", "code-k", k), text("span", "code-v", v));
        grid.appendChild(row);
        rows.push({ row, haystack: `${k} ${v}`.toLowerCase() });
      }
      panel.appendChild(grid);
      groupEls.push({ header, grid, rows });
    }

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      let visibleTotal = 0;
      for (const { header, grid, rows } of groupEls) {
        let visibleInGroup = 0;
        for (const { row, haystack } of rows) {
          const match = !q || haystack.includes(q);
          row.style.display = match ? "" : "none";
          if (match) visibleInGroup++;
        }
        header.style.display = visibleInGroup === 0 ? "none" : "";
        grid.style.display = visibleInGroup === 0 ? "none" : "";
        visibleTotal += visibleInGroup;
      }
      searchCount.textContent = q ? `${visibleTotal} match${visibleTotal === 1 ? "" : "es"}` : "";
    });

    return panel;
  }

  // ---- Beat driver --------------------------------------------------------

  private get onFreq(): boolean {
    return Math.abs(this.freqKhz - this.hqFreqKhz) <= ON_FREQ_KHZ;
  }

  /** Danger escalation — first wired up for real on the relay mission (see
   *  MORSE-GAMES.md's "Speed as the difficulty gate" section). retryCount only
   *  climbs on AGN repeats and incomplete-report resends, never on a clean
   *  first-try transmission, so a careful operator reads "low" the whole day. */
  private get dangerLabel(): string {
    if (this.retryCount >= 4) return "high — that's a lot of chatter on this frequency";
    if (this.retryCount >= 2) return "elevated — keep transmissions clean";
    return "low";
  }

  /** The power button doubles as the day's only "log off" control — see
   *  enterDone(). Tapping it cold starts the set; tapping it once the day's
   *  events are done closes the day; tapping it any other time is an
   *  accidental shutdown, so warn rather than silently killing the run. */
  private async togglePower(): Promise<void> {
    if (!this.radioOn) await this.powerOn();
    else this.powerOff();
  }

  private async powerOn(): Promise<void> {
    await this.engine.resume();
    this.radioOn = true;
    this.elStartBtn.classList.remove("power-glow");
    this.elStartBtn.classList.add("power-on");
    if (this.phase === "cold") {
      this.setStatus("The set hums to life…");
      await this.engine.playPowerHum();
      this.phase = "onair";
      this.setScene("dawn", "0600");
      this.setStatus("Set's warm — spin the dial to today's sked frequency (see the briefing).");
      this.scheduleFreqSettle();
    } else {
      this.setStatus("Set's back up — you're on the air again.");
      this.scheduleFreqSettle();
    }
    this.refresh();
  }

  private powerOff(): void {
    this.radioOn = false;
    this.clearFreqSettle();
    this.elStartBtn.classList.remove("power-on");
    if (this.phase === "done") {
      this.showOutro();
      return;
    }
    this.elStartBtn.classList.add("power-glow");
    this.setStatus("Your radio is off — you won't be able to receive directives from KEN!");
    this.refresh();
  }

  /** Fires once the dial has held still for FREQ_SETTLE_MS — see
   *  scheduleFreqSettle(). No "on frequency" hint: the briefing has today's
   *  frequency. Off the dial, dwelling gets you static; tune it right and,
   *  after a beat (like you sat down just as the traffic started), the 0600
   *  sked comes through on its own. */
  private async trySked0(): Promise<void> {
    if (this.phase !== "onair" || this.evtIx !== 0 || this.playing) return;
    const e = this.day[0];
    if (e.kind !== "sked") return;
    this.setScene(e.light, e.clock);
    if (this.onFreq) this.focusNotepad();
    if (await this.hqSend(e.msg)) {
      this.phase = "sked";
      this.setStatus(e.prompt);
    }
    this.refresh();
  }

  /** Debounce the frequency dial: only judge it once the player has left it
   *  alone for a moment, rather than reacting to every intermediate tick
   *  while they're actively spinning the knob. */
  private scheduleFreqSettle(): void {
    this.clearFreqSettle();
    if (this.phase !== "onair" || this.evtIx !== 0) return;
    if (this.playing) {
      // Audio's already mid-playback (from an earlier check) — a timer
      // scheduled now would just find `playing` still true and no-op when it
      // fires. Remember to re-check once that playback actually ends instead
      // of silently dropping this change.
      this.freqSettleMissed = true;
      return;
    }
    this.freqSettleTimer = setTimeout(() => {
      this.freqSettleTimer = null;
      void this.trySked0();
    }, FREQ_SETTLE_MS);
  }

  private clearFreqSettle(): void {
    if (this.freqSettleTimer !== null) {
      clearTimeout(this.freqSettleTimer);
      this.freqSettleTimer = null;
    }
  }

  /** Run the current timeline event: HQ calls (sked) or a runner arrives (spot). */
  private async runEvent(): Promise<void> {
    const e = this.day[this.evtIx];
    this.setScene(e.light, e.clock);
    // A beat between events — otherwise KEN jumps straight from one exchange to
    // the next and it reads as harried rather than as time having passed. Long
    // enough that the player looks at the clock, not so long it drags. Held via
    // `playing` so the tx row stays disabled — currentEvent already points at
    // the new event during this window, but phase/need don't until below.
    this.playing = true;
    this.refresh();
    await delay(CLOCK_TRANSITION_PAUSE_MS);
    this.playing = false;
    if (e.kind === "spot") {
      this.phase = "spot";
      this.need = requiredFields(e.sighting);
      this.addSpot(e.sighting.prose);
      this.setStatus(
        e.sighting.category === "SHIP"
          ? "This one matters — encode it and report to KEN, clean."
          : "Runner's in — encode it and report to KEN."
      );
    } else if (e.kind === "relay") {
      this.phase = "relay";
      this.need = requiredFields(e.sighting);
      this.relayAcked = false;
      this.relayForwardDone = false;
      const s = e.sighting;
      const fields = s.category === "SHIP" ? [s.count, s.type, s.dir] : [s.count, s.type, s.alt, s.dir];
      const skipMsg = `${MY_CALL} DE ${e.from} QTC ${HQ_CALL} BT ${fields.join(" ")} AR K`;
      if (await this.hqSend(skipMsg, e.from)) {
        this.setStatus(`Copy ${e.from}'s traffic, acknowledge ${e.from}, then forward it to ${HQ_CALL}.`);
      }
    } else if (e.kind === "overhear") {
      this.phase = "overhear";
      await this.hqSend(e.msg, e.from);
      this.setStatus("Not addressed to you — no need to answer. Keep listening.");
      this.refresh();
      await delay(OVERHEAR_PAUSE_MS);
      await this.advance();
      return;
    } else {
      this.phase = "sked";
      if (await this.hqSend(e.msg)) this.setStatus(e.prompt);
    }
    this.refresh();
  }

  private async advance(): Promise<void> {
    this.evtIx += 1;
    if (this.evtIx >= this.day.length) this.enterDone();
    else await this.runEvent();
  }

  private enterDone(): void {
    this.phase = "done";
    this.setScene("dusk", "1800");
    this.setStatus("Set's down for the night. Good day's work — tap Power to log off.");
    this.addTraffic("log", `End of day. Skeds & sightings ${this.day.length} · Sent ${this.txCount} · Danger ${this.dangerLabel}.`);
    this.elStartBtn.classList.add("power-glow");
    this.refresh();
  }

  /** Close the loop: swap the shack for a dusk-toned transition card — the same
   *  "light flip" beat as the intro, per MORSE-GAMES.md's transition-screen
   *  design — with the day's tally and a Replay control back into a fresh run. */
  private showOutro(): void {
    const tally = `Skeds & sightings: ${this.day.length} · Transmissions sent: ${this.txCount}.`;
    this.root.innerHTML = "";
    const view = el("section", "adventure-intro dusk");
    const card = el("div", "intro-card");
    card.appendChild(text("div", "intro-tag", `${this.scenario.dayTag} — complete`));
    card.appendChild(text("h2", "intro-title", "Set's down for the night"));
    card.appendChild(text("p", "intro-copy", `${tally} ${this.scenario.outroCopy}`));
    if (this.scenario.outroAside) {
      card.appendChild(text("p", "intro-copy intro-aside", this.scenario.outroAside));
    }
    card.appendChild(this.buildTransitionRow("Replay the day", () => this.resetRun()));
    view.appendChild(card);
    this.root.appendChild(view);
  }

  private setScene(light: string, clock: string): void {
    this.clock = clock;
    this.elShack.className = `adventure ${light}`;
    this.elDay.textContent = `— ${light} · ${clock} —`;
  }

  private get currentEvent(): DayEvent {
    return this.day[this.evtIx];
  }

  // ---- KEN's dialogue rules -------------------------------------------------
  // Ranked rules for the dialogue engine (src/dialogue/engine.ts) — array order
  // is priority order. Kolombangara-specific; see MORSE-GAMES.md and the plan
  // this was built from for why the shapes below (header-check, ack-or-repeat,
  // authenticator-gate, field-completion, fallback) are meant to generalize to
  // future missions even though only this one uses them today.

  private static isFirstContact(ctx: AdventureMode): boolean {
    return ctx.phase === "sked" && ctx.currentEvent.kind === "sked" && ctx.evtIx === 0;
  }
  private static isLaterSked(ctx: AdventureMode): boolean {
    return ctx.phase === "sked" && ctx.currentEvent.kind === "sked" && ctx.evtIx !== 0;
  }
  private static isSpot(ctx: AdventureMode): boolean {
    return ctx.phase === "spot" && ctx.currentEvent.kind === "spot";
  }
  private static isRelay(ctx: AdventureMode): boolean {
    return ctx.phase === "relay" && ctx.currentEvent.kind === "relay";
  }
  /** Token-based, not exact-string: tolerates real message variation (extra
   *  spacing, surrounding prowords, either order) without needing AI judgment. */
  private static authStatus(i: DialogueInput, ctx: AdventureMode): { hasQsl: boolean; hasAuth: boolean } {
    const live = ctx.authTable[ctx.liveAuthIdx];
    return {
      hasQsl: i.words.includes("QSL") || i.words.includes("R"),
      hasAuth: includesSequence(i.words, ["I", "AUTHENTICATE", live.response]),
    };
  }

  /** Who a transmission may legitimately be addressed to right now. Normally
   *  just HQ — but a relay beat adds the third station you're relaying for,
   *  since acknowledging *that* sender is a real, required step of the beat. */
  private validRecipients(): string[] {
    const e = this.currentEvent;
    if (this.phase === "relay" && e.kind === "relay") return [HQ_CALL, e.from];
    return [HQ_CALL];
  }

  private static readonly RULES: Rule<DialogueInput, AdventureMode>[] = [
    // Every transmission must lead with proper addressing (e.g. KEN DE GOOSE).
    // Drop it and the addressee doesn't know who's calling — real net discipline,
    // and a real Q-code for it: QRZ. Nudge, not a hard fail — resend with the
    // preamble. Skipped during "overhear": nothing there is addressed to you in
    // the first place, so that phase's own rule handles the messaging instead.
    {
      id: "header-check",
      when: (ctx) => ctx.phase !== "overhear",
      match: (i, ctx) => !ctx.validRecipients().some((call) => includesSequence(i.words, [call, "DE", MY_CALL])),
      act: async (_i, ctx) => {
        await ctx.hqSend(`${MY_CALL} DE ${HQ_CALL} QRZ K`);
        ctx.setStatus(`Lead with ${ctx.validRecipients().join(" or ")} DE ${MY_CALL}, depending who you're answering.`);
      },
    },
    // First contact of the day: QSL and the authenticator reply must arrive together.
    {
      id: "first-contact-repeat",
      when: AdventureMode.isFirstContact,
      match: (i) => i.isAgn,
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "sked") return;
        ctx.retryCount += 1;
        await ctx.hqSend(e.msg);
      },
    },
    {
      id: "first-contact-complete",
      when: AdventureMode.isFirstContact,
      match: (i, ctx) => {
        const { hasQsl, hasAuth } = AdventureMode.authStatus(i, ctx);
        return hasQsl && hasAuth;
      },
      act: async (_i, ctx) => {
        await ctx.advance();
      },
    },
    {
      id: "first-contact-auth-only",
      when: AdventureMode.isFirstContact,
      match: (i, ctx) => {
        const { hasQsl, hasAuth } = AdventureMode.authStatus(i, ctx);
        return hasAuth && !hasQsl;
      },
      act: (_i, ctx) => {
        ctx.setStatus("Authenticated — now add QSL to the same transmission to complete the sked.");
      },
    },
    {
      id: "first-contact-qsl-only",
      when: AdventureMode.isFirstContact,
      match: (i, ctx) => {
        const { hasQsl, hasAuth } = AdventureMode.authStatus(i, ctx);
        return hasQsl && !hasAuth;
      },
      act: async (_i, ctx) => {
        const live = ctx.authTable[ctx.liveAuthIdx];
        await ctx.hqSend(`${MY_CALL} DE ${HQ_CALL} AUTHENTICATE ${live.challenge} K`);
        ctx.setStatus(
          `${HQ_CALL} won't log that without authentication — send QSL I AUTHENTICATE <code>, together.`
        );
      },
    },
    {
      id: "first-contact-neither",
      when: AdventureMode.isFirstContact,
      match: () => true,
      act: (_i, ctx) => {
        ctx.setStatus("Check the authenticator table, then send QSL I AUTHENTICATE <code>, or AGN? for a repeat.");
      },
    },
    {
      id: "later-sked-repeat",
      when: AdventureMode.isLaterSked,
      match: (i) => i.isAgn,
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "sked") return;
        ctx.retryCount += 1;
        await ctx.hqSend(e.msg);
      },
    },
    {
      id: "later-sked-ack",
      when: AdventureMode.isLaterSked,
      match: (i) => i.words.includes("QSL") || i.words.includes("R"),
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "sked") return;
        if (e.final) ctx.enterDone();
        else await ctx.advance();
      },
    },
    {
      id: "later-sked-nudge",
      when: AdventureMode.isLaterSked,
      match: () => true,
      act: (_i, ctx) => {
        ctx.setStatus(`Send QSL to acknowledge ${HQ_CALL}, or AGN? for a repeat.`);
      },
    },
    {
      id: "spot-repeat",
      when: AdventureMode.isSpot,
      match: (i) => i.isAgn,
      act: (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "spot") return;
        ctx.retryCount += 1;
        ctx.addSpot(e.sighting.prose, "the boy repeats");
      },
    },
    {
      id: "spot-grade",
      when: AdventureMode.isSpot,
      match: () => true,
      act: async (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "spot") return;
        ctx.need = ctx.need.filter((f) => !fieldSatisfied(f, e.sighting, i.tk));
        if (ctx.need.length === 0) {
          await ctx.hqSend(SPOT_ACK);
          await ctx.advance();
        } else {
          // Directed answer-back: HQ asks for exactly what's still missing/wrong.
          ctx.retryCount += 1;
          await ctx.hqSend(`${MY_CALL} DE ${HQ_CALL} ${ctx.need.map((f) => PROWORD[f]).join(" ")} K`);
          ctx.setStatus(`${HQ_CALL} wants: ${ctx.need.map((f) => FIELD_LABEL[f]).join(", ")}. Send it.`);
        }
      },
    },
    // A relay beat needs TWO correctly-addressed sends to complete, in either
    // order: acknowledge the relay sender (e.g. SKIP), and forward a complete
    // report to HQ. Reuses the same requiredFields()/fieldSatisfied() grading
    // as a direct spot report — see MORSE-GAMES.md's "Level type — the relay
    // net". relayAcked/relayForwardDone track the two steps independently so
    // the beat only completes once both are done.
    {
      id: "relay-repeat",
      when: AdventureMode.isRelay,
      match: (i) => i.isAgn,
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "relay") return;
        ctx.retryCount += 1;
        const s = e.sighting;
        const fields = s.category === "SHIP" ? [s.count, s.type, s.dir] : [s.count, s.type, s.alt, s.dir];
        await ctx.hqSend(`${MY_CALL} DE ${e.from} QTC ${HQ_CALL} BT ${fields.join(" ")} AR K`, e.from);
      },
    },
    {
      id: "relay-ack",
      when: AdventureMode.isRelay,
      match: (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "relay") return false;
        return includesSequence(i.words, [e.from, "DE", MY_CALL]) && (i.words.includes("QSL") || i.words.includes("R"));
      },
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "relay") return;
        ctx.relayAcked = true;
        if (ctx.relayForwardDone) {
          await ctx.hqSend(SPOT_ACK);
          await ctx.advance();
        } else {
          ctx.setStatus(`${e.from} acknowledged — now forward the report to ${HQ_CALL}.`);
        }
      },
    },
    {
      id: "relay-forward",
      when: AdventureMode.isRelay,
      match: (i) => includesSequence(i.words, [HQ_CALL, "DE", MY_CALL]),
      act: async (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "relay") return;
        ctx.need = ctx.need.filter((f) => !fieldSatisfied(f, e.sighting, i.tk));
        if (ctx.need.length > 0) {
          // The "checksum": KEN also caught fragments of e.from's own weak
          // transmission — too garbled to act on alone (why the relay was
          // needed at all), but enough to flag a mismatch against your forward.
          ctx.retryCount += 1;
          await ctx.hqSend(
            `${MY_CALL} DE ${HQ_CALL} YR RPT VS WHAT I CAUGHT OF ${e.from} DISAGREES ${ctx.need.map((f) => PROWORD[f]).join(" ")} K`
          );
          ctx.setStatus(`${HQ_CALL} caught ${e.from} too, and it doesn't match: ${ctx.need.map((f) => FIELD_LABEL[f]).join(", ")}. Recheck and resend.`);
          return;
        }
        ctx.relayForwardDone = true;
        if (ctx.relayAcked) {
          await ctx.hqSend(SPOT_ACK);
          await ctx.advance();
        } else {
          ctx.setStatus(`Forwarded clean — now acknowledge ${e.from} to close out the relay.`);
        }
      },
    },
    {
      id: "relay-nudge",
      when: AdventureMode.isRelay,
      match: () => true,
      act: (_i, ctx) => {
        const e = ctx.currentEvent;
        const from = e.kind === "relay" ? e.from : RELAY_CALL;
        ctx.setStatus(`Acknowledge ${from} (${from} DE ${MY_CALL} QSL), and forward the report to ${HQ_CALL} (${HQ_CALL} DE ${MY_CALL} …).`);
      },
    },
    // Nothing here needs a reply — the correct play is recognizing the traffic
    // isn't yours and staying off the key. A nudge, not a penalty: no retryCount
    // bump, since declining to answer costs nothing and the day auto-advances
    // regardless (see runEvent()'s "overhear" branch).
    {
      id: "overhear-nudge",
      when: (ctx) => ctx.phase === "overhear",
      match: () => true,
      act: (_i, ctx) => {
        ctx.setStatus("That wasn't addressed to you — no need to answer. Keep listening.");
      },
    },
    // Safety net for states this mission never reaches (phase/event always stay
    // in lockstep — see runEvent()/advance()) but a future mission's content
    // might. Without this, an unanticipated state would go silent.
    {
      id: "fallback",
      match: () => true,
      act: async (_i, ctx) => {
        await ctx.hqSend(`${MY_CALL} DE ${HQ_CALL} AGN K`);
        ctx.setStatus(`${HQ_CALL} didn't copy that — resend, or check the codebook for the right prowords.`);
      },
    },
  ];

  /** Player keys a message: plays it as sidetone, bumps danger, then routes
   *  through the dialogue engine's rule table above. */
  private async transmit(raw: string): Promise<void> {
    const msg = raw.trim().toUpperCase();
    if (!msg || this.playing || !this.txEnabled) return;
    this.elTxInput.value = "";
    this.txCount += 1;
    await this.playSelf(msg);

    const input: DialogueInput = {
      msg,
      words: tokenizeWords(msg),
      isAgn: msg.includes("AGN"), // a raw substring check, not token-based — see DialogueInput
      tk: tokenize(msg),
    };
    await respond(AdventureMode.RULES, input, this);
    this.refresh();
  }

  private get txEnabled(): boolean {
    return (
      this.radioOn &&
      !this.playing &&
      (this.phase === "sked" || this.phase === "spot" || this.phase === "relay" || this.phase === "overhear")
    );
  }

  // ---- Audio + log helpers ------------------------------------------------

  /** Play an inbound message on the net frequency — but only if the dial is
   *  actually on today's freq. Off frequency before it even starts, you get
   *  one burst of static. Once it's underway, drifting off mutes it and
   *  retuning restarts it from the top (see the playback loop below) — the
   *  dial matters for the whole message, not just the moment it begins.
   *  `fromTag` labels the sender in the traffic feed — defaults to HQ_CALL,
   *  but the relay mission's SKIP traffic is real over-the-air Morse on the
   *  same frequency too, just from a different station. Returns whether it
   *  came through. */
  private async hqSend(msg: string, fromTag: string = HQ_CALL): Promise<boolean> {
    if (!this.onFreq) {
      this.playing = true;
      this.addTraffic("log", "static — off frequency");
      this.setStatus(`Only static on ${this.freqKhz} kHz — nothing readable. Check the briefing and set the dial.`);
      this.refresh();
      await this.engine.playStatic(900);
      this.playing = false;
      this.refresh();
      this.recheckIfFreqChangedWhilePlaying();
      return false;
    }
    this.playing = true;
    this.addTraffic("ken", msg, fromTag);
    await this.engine.primeOutput(300);

    // Live-monitored playback: drifting off frequency mid-message mutes it
    // immediately (a real signal doesn't wait for you to finish the word),
    // and retuning starts it over from the top rather than resuming mid-
    // character — you re-found the station, you didn't rewind it.
    for (;;) {
      this.setStatus(`♪ ${fromTag} is sending…`);
      this.refresh();
      let droppedOut = false;
      await this.engine.playString(msg, {
        isCancelled: () => {
          if (this.onFreq) return false;
          droppedOut = true;
          return true;
        },
      });
      if (!droppedOut) break;
      this.engine.stop();
      this.setStatus(`Signal's fading — you drifted off ${fromTag}'s frequency. Retune to pick it back up.`);
      this.refresh();
      await this.waitUntilOnFreq();
    }

    this.playing = false;
    this.refresh();
    this.recheckIfFreqChangedWhilePlaying();
    return true;
  }

  private waitUntilOnFreq(): Promise<void> {
    return new Promise((resolve) => {
      const poll = () => {
        if (this.onFreq) resolve();
        else setTimeout(poll, 150);
      };
      poll();
    });
  }

  /** A knob change that landed while this playback was running got dropped
   *  by scheduleFreqSettle()'s `playing` guard — pick it up now, rather than
   *  leaving the player tuned in (or out) with nothing ever re-checking it. */
  private recheckIfFreqChangedWhilePlaying(): void {
    if (this.freqSettleMissed) {
      this.freqSettleMissed = false;
      this.scheduleFreqSettle();
    }
  }

  private async playSelf(msg: string): Promise<void> {
    this.playing = true;
    this.refresh();
    this.addTraffic("you", msg);
    await this.engine.primeOutput(200);
    await this.engine.playString(msg);
    this.playing = false;
    this.refresh();
  }

  private addTraffic(who: "ken" | "you" | "run" | "log", msg: string, tag?: string): void {
    this.traffic.push({ who, msg, clock: this.clock, tag });
    this.renderTraffic();
  }

  /** Rebuild the traffic feed. Inbound HQ traffic is masked unless "Show Text"
   *  (plot mode) is on — your own sends and log lines are always visible. */
  private renderTraffic(): void {
    this.elTraffic.innerHTML = "";
    for (const e of this.traffic) {
      const row = el("div", "traffic-row");
      if (e.who === "log") {
        row.classList.add("who-log");
        row.textContent = `— ${e.msg} —`;
      } else {
        const tag = e.who === "ken" ? (e.tag ?? HQ_CALL) : e.who === "you" ? "YOU" : "RUNNER";
        row.append(text("span", `who-${e.who}`, `${e.clock} ${tag}: `));
        const masked = e.who === "ken" && !this.showText;
        row.appendChild(
          document.createTextNode(masked ? "♪ · — · ·  (Show Text to read it)" : e.msg)
        );
      }
      this.elTraffic.appendChild(row);
    }
    this.elTraffic.scrollTop = this.elTraffic.scrollHeight;
  }

  private toggleText(): void {
    this.showText = !this.showText;
    this.elShowTextBtn.textContent = `Show Text: ${this.showText ? "On" : "Off"}`;
    this.elShowTextBtn.classList.toggle("primary", this.showText);
    this.renderTraffic();
  }

  private addSpot(msg: string, prefix = "RUNNER"): void {
    const line = el("span", "spot");
    line.textContent = `▸ ${prefix}: ${msg}`;
    this.elNotesFeed.appendChild(line);
    this.elNotesFeed.scrollTop = this.elNotesFeed.scrollHeight;
  }

  private focusNotepad(): void {
    this.elNotepad.focus();
  }

  /** Live commentary on the current TX power, surfaced in the status bar as
   *  the player turns the knob — null in the unremarkable middle range, so
   *  routine adjustments don't stomp the current mission directive. */
  private powerHint(watts: number): string | null {
    if (watts <= 30) return "Faint, but quiet.";
    if (watts > 50) return "Dangerously high — likely to be triangulated.";
    return null;
  }

  private setStatus(s: string): void {
    this.elStatus.textContent = s;
    this.elStatus.classList.remove("pulse");
    void this.elStatus.offsetWidth; // restart the animation on repeated status changes
    this.elStatus.classList.add("pulse");
  }

  private refresh(): void {
    this.elFreqOut.textContent = `${this.freqKhz} kHz`;
    this.elPowerOut.textContent = `${this.power} W`;

    const cold = this.phase === "cold" || !this.radioOn;
    this.elDials.classList.toggle("cold", cold);
    this.setKnobDisabled(cold);
    this.setPowerKnobDisabled(cold);

    const tx = this.txEnabled;
    this.elTxInput.disabled = !tx;
    this.elTxBtn.disabled = !tx;
    this.elTxRow.classList.toggle("flash", tx);

    this.elDanger.textContent = this.txCount
      ? `Transmissions: ${this.txCount} · Danger: ${this.dangerLabel}`
      : "";
  }
}

// ---- Small DOM utilities --------------------------------------------------

function el(tag: string, className = ""): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

const DEG_PER_DETENT = 8; // rotation quantum for the encoder simulation below
const KEY_FLICK_DEG = 8; // cosmetic pointer nudge per keypress/wheel tick, independent of DEG_PER_DETENT
const BASE_UNIT_DIVISOR = 3; // each detent is worth step/3 at rest — several must accumulate to tick one grid step

/** Real VFO knobs are encoders, not potentiometers: they spin freely (no
 *  mechanical stop) and firmware accelerates the step size the faster you
 *  turn — a quick spin crosses the band in a couple of turns, a slow nudge
 *  moves one step at a time. `dtMs` is the time since the previous detent
 *  (drag), keypress, or wheel tick; shorter gaps mean faster input. */
function accelMultiplier(dtMs: number): number {
  if (dtMs > 220) return 1;
  if (dtMs > 100) return 1;
  if (dtMs > 45) return 2;
  return 5;
}

/** An encoder-style rotary knob — drag, arrow keys, or the wheel all turn
 *  it. The knob face spins freely and has no absolute position; `value`
 *  ([min, max], snapped to `step`) is a separate accumulator driven by how
 *  fast you're turning it, via accelMultiplier() above. */
function buildKnob(
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
  opts: { size?: "lg" | "sm"; ariaLabel?: string } = {}
): { el: HTMLElement; setDisabled: (disabled: boolean) => void } {
  let current = value;
  let raw = value; // continuous, unsnapped position — preserves sub-step progress between ticks
  let disabled = false;
  let visualDeg = 0; // cosmetic, unbounded — how far the knob has visually spun
  let lastActionTime = 0; // for accelMultiplier()
  const baseUnit = step / BASE_UNIT_DIVISOR; // value per detent at rest

  const wrap = el("div", "knob");
  const face = el("div", opts.size === "sm" ? "knob-face knob-face--sm" : "knob-face");
  face.tabIndex = 0;
  face.setAttribute("role", "slider");
  face.setAttribute("aria-label", opts.ariaLabel ?? "Value");
  face.setAttribute("aria-valuemin", String(min));
  face.setAttribute("aria-valuemax", String(max));
  const pointer = el("div", "knob-pointer");
  face.appendChild(pointer);
  wrap.appendChild(face);

  function renderPointer(): void {
    pointer.style.transform = `translate(-50%, -100%) rotate(${visualDeg}deg)`;
  }
  function applyDelta(rawDelta: number): void {
    raw = Math.min(max, Math.max(min, raw + rawDelta));
    const snapped = Math.round(raw / step) * step;
    if (snapped === current) return;
    current = snapped;
    face.setAttribute("aria-valuenow", String(current));
    onChange(current);
  }
  /** One discrete action (a detent, a keypress, a wheel tick) — looks up
   *  how long it's been since the last one to decide how big a jump this
   *  one is worth. Several slow detents accumulate (via `raw`) before the
   *  displayed value ticks over one grid step; fast ones cross several. */
  function act(direction: 1 | -1, steps: number): void {
    const now = performance.now();
    const dt = lastActionTime ? now - lastActionTime : Infinity;
    lastActionTime = now;
    applyDelta(direction * baseUnit * steps * accelMultiplier(dt));
  }
  function rawAngle(e: PointerEvent): number {
    const rect = face.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° = up, clockwise-positive
  }

  let lastAngle = 0;
  let pendingDeg = 0;
  face.addEventListener("pointerdown", (e) => {
    if (disabled) return;
    e.preventDefault();
    face.focus();
    face.setPointerCapture(e.pointerId);
    face.classList.add("dragging");
    lastAngle = rawAngle(e);
    pendingDeg = 0;
  });
  face.addEventListener("pointermove", (e) => {
    if (disabled || !face.classList.contains("dragging")) return;
    const angle = rawAngle(e);
    let dAngle = angle - lastAngle;
    while (dAngle > 180) dAngle -= 360;
    while (dAngle < -180) dAngle += 360;
    lastAngle = angle;

    visualDeg += dAngle;
    renderPointer();

    pendingDeg += dAngle;
    const detents = Math.trunc(pendingDeg / DEG_PER_DETENT);
    if (detents !== 0) {
      pendingDeg -= detents * DEG_PER_DETENT;
      act(detents > 0 ? 1 : -1, Math.abs(detents));
    }
  });
  const endDrag = (e: PointerEvent) => {
    face.classList.remove("dragging");
    if (face.hasPointerCapture(e.pointerId)) face.releasePointerCapture(e.pointerId);
  };
  face.addEventListener("pointerup", endDrag);
  face.addEventListener("pointercancel", endDrag);
  face.addEventListener("keydown", (e) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      visualDeg += KEY_FLICK_DEG;
      renderPointer();
      act(1, 1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      visualDeg -= KEY_FLICK_DEG;
      renderPointer();
      act(-1, 1);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      visualDeg += KEY_FLICK_DEG * 5;
      renderPointer();
      applyDelta(step * 10); // an explicit big jump, not accelerated
    } else if (e.key === "PageDown") {
      e.preventDefault();
      visualDeg -= KEY_FLICK_DEG * 5;
      renderPointer();
      applyDelta(-step * 10);
    }
  });
  face.addEventListener(
    "wheel",
    (e) => {
      if (disabled) return;
      e.preventDefault();
      visualDeg += e.deltaY < 0 ? KEY_FLICK_DEG : -KEY_FLICK_DEG;
      renderPointer();
      act(e.deltaY < 0 ? 1 : -1, 1);
    },
    { passive: false }
  );

  function setDisabled(d: boolean): void {
    disabled = d;
    face.tabIndex = d ? -1 : 0;
    face.classList.toggle("knob-disabled", d);
  }

  face.setAttribute("aria-valuenow", String(current));
  renderPointer();
  return { el: wrap, setDisabled };
}
