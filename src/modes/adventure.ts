// Adventure mode: the "radio shack" set for the Morse Adventures campaign — see
// MORSE-GAMES.md (its "Build status" note tracks which missions exist). Started
// as the "Kolombangara" demo mission; now runs every campaign day off one engine:
// the four-quadrant shack (briefing/notes, a copy notepad, the radio you tune,
// and your codebook) walked through a full day of operation, with each day
// defined as a Scenario in the SCENARIOS array below (in campaign order).
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
const NICK_CALL = "NICK"; // supply — the Request Supplies mission element's trading partner
const FREQ_MIN = 4000;
const FREQ_MAX = 5200;
const FREQ_STEP_KHZ = 5; // dial grid; HQ's sked frequency is always on it
const DIAL_START_KHZ = 4200; // where the dial sits at the start of each run — never HQ's frequency
const FREQ_SETTLE_MS = 700; // dwell time on a steady frequency before static/the sked fires
const CLOCK_TRANSITION_PAUSE_MS = 4000; // beat between events so the player notices the clock jump, not just a harried KEN
const OVERHEAR_PAUSE_MS = 2500; // how long "not for you" traffic lingers before the day moves on by itself
const SILENCE_LEAD_MS = 3000; // a silence beat: warning → KEN's unanswerable call
const SILENCE_HOLD_MS = 15000; // …then how long the patrol lingers before the all-clear
// No field mission runs below this effective speed — the training graduation
// gate, locked in MORSE-GAMES.md's "Speed as the difficulty gate". Later
// postings can set a higher floor per the posting-by-posting WPM curve.
const FIELD_MIN_WPM = 7.5;

const SPOT_ACK = `${MY_CALL} DE ${HQ_CALL} QSL K`; // HQ's ack of a completed report

/** Today's sked frequency — generated fresh per mission, same SOI logic as the
 *  authenticator table (real Signal Operating Instructions bundled call signs,
 *  frequencies, and authentication together, and all changed periodically). A
 *  dial-grid step, comfortably inside the dial, and never the dial's starting
 *  position (tuning in should always be the first task). */
function makeHqFreqKhz(): number {
  const lo = 4200,
    hi = 5000;
  let f: number;
  do f = lo + FREQ_STEP_KHZ * randInt(0, (hi - lo) / FREQ_STEP_KHZ);
  while (f === DIAL_START_KHZ);
  return f;
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
/** n distinct items, order randomized — used to vary which supplies/trade
 *  goods a haggle mission features each run (see MUNDA_DAY1). */
function pickN<T>(pool: readonly T[], n: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  }
  return out;
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
  | {
      kind: "sked";
      clock: string;
      light: string;
      msg: string;
      prompt: string;
      final?: boolean;
      // KEN asked a question (e.g. QRU?) — the player must answer with these
      // words, in order, instead of a plain QSL. `hint` is the nudge shown
      // when the answer is missing. Not used on first contact, whose reply is
      // already fixed as QSL + authenticator.
      reply?: { words: string[]; hint: string };
    }
  // `spotter` names who brings the sighting in (default: an unnamed runner,
  // "the boy" — Kolombangara's scouts); e.g. Aaron on Guadalcanal.
  | { kind: "spot"; clock: string; light: string; sighting: Sighting; spotter?: string }
  // A third station (RELAY_CALL) has traffic for HQ that can't reach HQ directly —
  // copy it, acknowledge the sender, then re-address and forward to HQ. See
  // "Level type — the relay net" in MORSE-GAMES.md.
  | { kind: "relay"; clock: string; light: string; from: string; sighting: Sighting }
  // Traffic between two OTHER stations, overheard on the same frequency — nothing
  // to do but recognize it isn't for you and not answer it (monitoring discipline).
  | { kind: "overhear"; clock: string; light: string; from: string; to: string; msg: string }
  // React to threats — go silent. A patrol is close: `spotter` brings the
  // `warning`, KEN's routine `call` comes in anyway, and the correct play is
  // NOT answering it (or anything). Transmitting isn't a hard fail — it bumps
  // danger and sets brokeSilence, which the outro can tell differently. The
  // beat ends on its own with the spotter's `allClear`.
  | {
      kind: "silence";
      clock: string;
      light: string;
      spotter: string;
      warning: string;
      call: string;
      allClear: string;
    }
  // Request Supplies kit element — a real back-and-forth negotiation over CW, not
  // a scripted exchange. `partner` haggles via the RULES table below (see "Nick's
  // dialogue rules") using a value-weighted engine with two INDEPENDENT
  // valuations (see GOOSE_VALUE / rollNickValues) — Nick's own sense of what
  // each good is worth, rolled fresh per run and never shown outright, is what
  // actually drives the negotiation; GOOSE's fixed sense of worth is used only
  // for the after-the-fact "what did that cost you" readout. Offering ANY
  // combination/quantity of goods knocks their Nick-value off his ask, so the
  // negotiation equalizes both sides rather than just decrementing a counter.
  // Both sides of the trade are real, possessable goods — `priceItem` is
  // something GOOSE actually has (see MUNDA_DAY1's trade pool), `rewardItem` is
  // something Nick actually stocks — never an abstract, ungrounded currency
  // (see MORSE-GAMES.md's "Request Supplies mission draft" for the design
  // rationale and why this replaced an earlier "cases of soap" placeholder).
  | {
      kind: "haggle";
      clock: string;
      light: string;
      partner: string;
      priceItem: string; // the trade good Nick's opening line names concretely
      tradeWords: string[]; // ALL of GOOSE's trade goods this run, priceItem included
      rewardItem: string; // the supply item Nick is actually offering
      rewardQty: number; // how many units of rewardItem the deal delivers
      nickValues: Record<string, number>; // Nick's own, hidden valuation — rolled once, never re-rolled
    };

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
  // Plain string for fixed-content missions; a function for a mission whose
  // flavor text needs to reflect this run's randomized DayEvents (e.g.
  // MUNDA_DAY1's trade goods) — called with the built day so it can inspect it.
  notes: string | ((day: DayEvent[]) => string);
  briefing(hqFreqKhz: number, day: DayEvent[]): string; // upper-left Briefing panel text
  buildTimeline(authChallenge: string): DayEvent[];
  outroCopy: string; // sentence appended after the day's tally on the outro card
  // Shown only on this scenario's outro — a payoff beat. A function when the
  // telling depends on how the day went (the outcome itself never does — see
  // MORSE-GAMES.md's "Avoid the escort-mission feel"); `retries` is the day's
  // retryCount (AGN repeats + incomplete-report resends); `brokeSilence` is
  // whether the player transmitted during a silence beat.
  outroAside?: string | ((run: { retries: number; brokeSilence: boolean }) => string);
  // Speed floor: HQ sends at no less than this effective WPM, even if the
  // player's trainer setting is slower (a faster setting is left alone).
  // Omitted for training, which runs at the player's own pace.
  minEffectiveWpm?: number;
}

const KOLOMBANGARA_DAY14: Scenario = {
  id: "kolombangara-14",
  dayTag: "Kolombangara · Day 14",
  minEffectiveWpm: FIELD_MIN_WPM,
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
  minEffectiveWpm: FIELD_MIN_WPM,
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
  minEffectiveWpm: FIELD_MIN_WPM,
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

// Request Supplies randomization pools (MUNDA_DAY1 only, so far). Both pools
// are generated once in buildTimeline() and read back by notes()/briefing()
// from the built day, never re-rolled independently — see the Scenario
// interface note on why `notes` accepts a function. This keeps every side of
// the trade grounded in something real: SUPPLY_TRADE_POOL is what GOOSE
// actually has on hand (the briefing's "HAVE TO TRADE" line), SUPPLY_REWARD_POOL
// is what Nick actually stocks (the briefing's "NEED" line is exactly what the
// deal delivers — no more haggling toward a goal that was never obtainable,
// which an earlier "cases of soap" abstraction did). Different pool sizes and
// randomized quantities so a run's whole trade genuinely varies — see
// MORSE-GAMES.md's "Request Supplies mission draft" for the design intent
// ("play poker with Nick whenever the urge strikes").
const SUPPLY_REWARD_POOL = ["BATTERIES", "QUININE", "BANDAGES", "FUEL"];
const SUPPLY_TRADE_POOL = ["SCOTCH", "TOBACCO", "COFFEE", "CIGARETTES", "CHOCOLATE"];
const TRADE_FLAVOR: Record<string, string> = {
  SCOTCH: "Bill's flask of scotch he swore he'd forgotten about",
  TOBACCO: "tobacco the scouts don't smoke",
  COFFEE: "a tin of coffee from the last care package",
  CIGARETTES: "a carton of cigarettes nobody's touched",
  CHOCOLATE: "a chocolate ration bar going soft in the heat",
};
// [singular, plural] — explicit rather than a "+S" rule, since BOX/POUCH need
// "-ES" and English pluralization bugs read as broken game text, not typos.
const ITEM_UNIT: Record<string, [string, string]> = {
  SCOTCH: ["CASE", "CASES"],
  TOBACCO: ["POUCH", "POUCHES"],
  COFFEE: ["TIN", "TINS"],
  CIGARETTES: ["CARTON", "CARTONS"],
  CHOCOLATE: ["BAR", "BARS"],
  BATTERIES: ["BOX", "BOXES"],
  QUININE: ["BOTTLE", "BOTTLES"],
  BANDAGES: ["ROLL", "ROLLS"],
  FUEL: ["CAN", "CANS"],
};
function unitFor(item: string, qty: number): string {
  const [singular, plural] = ITEM_UNIT[item] ?? ["UNIT", "UNITS"];
  return qty === 1 ? singular : plural;
}

// Two independent valuations, not one shared price list — the "theory of
// mind" half of the negotiation. GOOSE_VALUE is a fixed, personal sense of
// what each trade good is worth (used only for the after-the-fact "what did
// that cost you" readout in haggle-accept — never for the live math). Nick's
// own valuation is rolled fresh per run (rollNickValues, called from
// MUNDA_DAY1's buildTimeline) and is what actually drives the negotiation —
// it's never shown to the player directly, only implied by how enthusiastic
// his reaction is to a given offer (see nickReaction). The two can and do
// disagree: GOOSE might treasure the scotch while Nick barely wants it this
// trip, or vice versa — reading that gap *is* the game, not a UI you can
// just read off. See MORSE-GAMES.md's "Request Supplies mission draft".
const GOOSE_VALUE: Record<string, number> = {
  SCOTCH: 3,
  CIGARETTES: 2,
  COFFEE: 2,
  TOBACCO: 1,
  CHOCOLATE: 1,
};
function rollNickValues(items: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = randInt(1, 3);
  return out;
}
/** A soft tell, not a number — how enthusiastically Nick reacts hints at his
 *  (hidden) valuation without ever stating it outright. */
function nickReaction(value: number): string {
  if (value >= 3) return "OM NOW WERE TALKING";
  if (value === 2) return "OM THATLL DO";
  return "OM IF THATS ALL YOU GOT";
}

/** Extract {item, qty} pairs from a haggle message — token-based, not natural
 *  language (per dialogue/tokens.ts's "flexible but not fuzzy" philosophy): a
 *  number token immediately before a known item sets its quantity, a bare
 *  item defaults to 1. Lets one message offer several different goods at once
 *  ("2 SCOTCH ES 2 CHOCOLATE"), each valued and summed on its own terms. */
function parseOffer(words: string[], knownItems: readonly string[]): { item: string; qty: number }[] {
  const out: { item: string; qty: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!knownItems.includes(w)) continue;
    const prev = words[i - 1];
    const qty = prev && /^[0-9]+$/.test(prev) ? Math.max(1, Number(prev)) : 1;
    out.push({ item: w, qty });
  }
  return out;
}

function haggleEventOf(day: DayEvent[]): Extract<DayEvent, { kind: "haggle" }> | undefined {
  const e = day[0];
  return e?.kind === "haggle" ? e : undefined;
}

/** Guadalcanal Day 1 — the first field day (see MORSE-GAMES.md's mission
 *  allocation table: "Cold open — first sked, still shaky"). Tune in and
 *  decode only; no spot reports yet (the first sighting report is Day 3's
 *  job). Plants two things later days lean on: Aaron, the Guadalcanal-posting
 *  friendship the rest of the campaign's field companions are measured against,
 *  and the Minnow, so Munda Day 1's "put you ashore in the dark again" pays
 *  off. SKIP's overheard traffic introduces his call here, well before
 *  Kolombangara makes GOOSE his relay. The "KEN doesn't slow down" feeling is
 *  real, not just prose: FIELD_MIN_WPM applies from here on. */
const GUADALCANAL_DAY1: Scenario = {
  id: "guadalcanal-1",
  dayTag: "Guadalcanal · Day 1",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "Cactus",
  introCopy:
    "Weeks on a troopship out of San Francisco, sick for the first nine days of it, " +
    "the sun off the water too painful to look at and too bright to ignore. Then a " +
    "transfer in the dark to a little boat the crew called the Minnow, a beach you " +
    "couldn't see, and a man waiting at the tree line who said his name was Aaron and " +
    "took the heavy end of the set without being asked.",
  notes:
    "Day 1 on Cactus — that's what everybody calls this island, even on the air. Aaron " +
    "walked the set up the ridge trail like it weighed nothing and told me the names of " +
    "three trees on the way. I remembered all three, and his. The surf down there keeps " +
    "a rhythm like a clave, two-and-three, and I caught myself tapping it on the log " +
    "before I'd noticed one thing a coastwatcher is supposed to notice. KEN's fist is " +
    "quicker than Andy's ever was. Nobody out here is slowing down for me.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. Put ashore overnight on the northwest coast, behind " +
    "the enemy's lines; OP on the ridge, watching the Slot. Skeds with HQ (KEN, at " +
    `Lunga) on ${hqFreqKhz} kHz: 0600 / 1030 / 1800. Authenticate first contact. Other ` +
    "stations share this frequency — answer only traffic addressed to GOOSE.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} WELCOME TO CACTUS AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} WATCH SLOT FOR DD ES AK RPT ALL ACFT K`,
      prompt: "Copy your orders, then acknowledge (QSL). AGN? if it got away from you.",
    },
    {
      kind: "overhear",
      clock: "1300",
      light: "noon",
      from: RELAY_CALL,
      to: HQ_CALL,
      msg: `${HQ_CALL} DE ${RELAY_CALL} QRU K`,
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} GOOD FIRST DAY QRT GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "First day on Cactus, logged. Messier than any drill — and you got through it anyway.",
  outroAside:
    "Aaron sat with you while the light went, not saying much. He didn't ask how it " +
    "went and didn't seem worried about it either, and somewhere around the first stars " +
    "you realized that was exactly what you'd needed from somebody all day.",
};

/** Guadalcanal Day 2 — "Decode / Send, routine": the daily rhythm sets in,
 *  with the Cactus Air Force overhead as ambient flavor (MORSE-GAMES.md's
 *  mission allocation table). First real SEND beyond a QSL: KEN's QRU? has to
 *  be answered (sked `reply`), bookending the day morning and evening, so
 *  "nothing to report is still a report" becomes habit before Day 3's first
 *  sighting. The noon sked tells GOOSE not to report friendly aircraft,
 *  which is both the Cactus flavor beat and a setup for Day 3. Tagged Day 5,
 *  not Day 2: calendar-as-montage, and a rhythm needs a few days to form. */
const GUADALCANAL_DAY2: Scenario = {
  id: "guadalcanal-2",
  dayTag: "Guadalcanal · Day 5",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "The Rhythm",
  introCopy:
    "Five days on the ridge and the day has a shape now: skeds at six and nine and " +
    "noon and six, coffee in between, the Slot empty and blue. Mid-morning the engines " +
    "come — Wildcats and dive-bombers climbing out of Henderson, the whole island " +
    "droning like one long bass note — and then they're gone northwest and it's quiet again.",
  notes:
    "Day 5. Aaron's sister sings in the mission choir down the coast. He hummed me a " +
    "hymn while we waited on the noon sked, and I kept time on my knee without " +
    "thinking — first music I've made since the train. He laughed and said I'd drag " +
    "the tempo in church. He's right; I would. KEN asks QRU? morning and evening now, " +
    "like a clock chiming the hour. Nothing to report is still a report. You answer it.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. OP on the northwest ridge, watching the Slot. Skeds " +
    `with HQ (KEN) on ${hqFreqKhz} kHz: 0600 / 0900 / 1200 / 1800. Authenticate first ` +
    "contact. When KEN asks QRU? he wants an answer, not a QSL — send QRU if you have " +
    "nothing for him. Our own aircraft out of Henderson work this sky; don't report friendlies.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} GM AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "0900",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} QRU? K`,
      prompt: "KEN's asking if you have anything for him. Answer it — or AGN? for a repeat.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — a QSL doesn't answer it. Send QRU: nothing for you.",
      },
    },
    {
      kind: "sked",
      clock: "1200",
      light: "noon",
      msg: `${MY_CALL} DE ${HQ_CALL} FRIENDLY ACFT OUTBOUND NW NO RPT K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} QRU? QRT GN K`,
      prompt: "Last sked of the day. Answer KEN's QRU? before he shuts down.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — answer QRU before signing off.",
      },
      final: true,
    },
  ],
  outroCopy: "A quiet day, and quiet is the job. The Slot stays empty until it doesn't.",
  outroAside:
    "Late in the afternoon the engines came back down the Slot, fewer than went up. " +
    "You counted without meaning to. Aaron didn't ask what the number was.",
};

/** Guadalcanal Day 3 — "Send reports (spot)": the first real sighting reports.
 *  A morning floatplane as the warm-up, then the day's reason for being: the
 *  Tokyo Express (real — Japanese destroyer runs down the Slot to the
 *  island's northwest end, timed for darkness), which passes right under a
 *  northwest-coast OP. Type and course are fixed (destroyers, down the Slot
 *  = SE) because that's what the Express was; the count varies per run so
 *  the report still has to be copied, not remembered. Aaron is the spotter
 *  (see the spot event's `spotter`). Forrest Gump restraint on the payoff:
 *  GOOSE only sees distant flashes that night and never learns what they were. */
function makeGuadalcanalFloatplane(): Sighting {
  const alt: "HI" | "LO" = Math.random() < 0.5 ? "HI" : "LO";
  const dir = pick(DIRS);
  return {
    category: "ACFT",
    count: 1,
    type: "FLOATPLANE",
    alt,
    dir,
    prose:
      `One floatplane, ${alt === "HI" ? "high" : "low"}, ${dirPhrase(dir)}. Enemy scout — ` +
      "they come most mornings, looking for exactly what you are.",
  };
}

function makeTokyoExpress(): Sighting {
  const count = randInt(3, 6);
  return {
    category: "SHIP",
    count,
    type: "DD",
    dir: "SE",
    prose:
      `${count} destroyers running down the Slot, fast and in line, bows throwing white. ` +
      "The Express — and early.",
  };
}

const GUADALCANAL_DAY3: Scenario = {
  id: "guadalcanal-3",
  dayTag: "Guadalcanal · Day 9",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "The Express",
  introCopy:
    "Nine days, and nothing on the Slot worth a word to KEN. Aaron says that won't " +
    "last. The Express runs when the moon is dark, and the moon's been thinning all week.",
  notes:
    "Day 9. Aaron's teaching me to see the water — how a wake sits different from a " +
    "wave, how a ship shows up as a smudge of smoke long before it's a ship. I nearly " +
    "called in our own Wildcats twice. KEN says a report is a handful of words, sent " +
    "clean the first time. Andy used to say the same thing, slower.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. OP on the northwest ridge, over the Slot. Skeds with " +
    `HQ (KEN) on ${hqFreqKhz} kHz: 0600 / 1300 / 1800; report sightings as they come ` +
    "in. Enemy contacts only: NR, TYPE, ALT (aircraft), CSE — addressed KEN DE GOOSE. " +
    "Authenticate first contact.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} GM AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0930", light: "morning", sighting: makeGuadalcanalFloatplane(), spotter: "Aaron" },
    {
      kind: "sked",
      clock: "1300",
      light: "noon",
      msg: `${MY_CALL} DE ${HQ_CALL} WATCH SLOT CLOSE TONIGHT K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    { kind: "spot", clock: "1630", light: "afternoon", sighting: makeTokyoExpress(), spotter: "Aaron" },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} TU GOOD RPT QRT GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "Two reports, sent clean. The first ones that were ever really yours.",
  outroAside:
    "Near midnight the horizon to the southeast lit up in soundless flickers, far down " +
    "the Slot. You never learned what they were. You logged the time anyway, and Aaron " +
    "sat up with you until they stopped.",
};

/** Guadalcanal Day 4 — the posting's milestone ("Decode + React to threats":
 *  a warning, and the Cactus fighters get up in time). Grounded in the real
 *  coastwatcher raid warnings that bought Henderson Field its minutes — most
 *  famously from Bougainville ("…headed yours"), relayed down the chain.
 *  Forrest Gump restraint: GOOSE is the *last* link, not the source — KEN
 *  passes the upstream warning, GOOSE confirms the formation as it passes his
 *  ridge, then goes quiet while the escorts sweep low. The historical outcome
 *  is fixed (they scramble in time either way); only the telling on the outro
 *  shifts with how cleanly the day was copied. Deliberately not a relay beat:
 *  Kolombangara's relay mission introduces relaying as new, so it stays there. */
function makeRaidFormation(): Sighting {
  const count = randInt(18, 27); // period-typical raid strength (the real warnings ran "twenty-odd" to "forty")
  return {
    category: "ACFT",
    count,
    type: "BOMBER",
    alt: "HI",
    dir: "SE",
    prose:
      "Engines first — a drone that fills the whole sky — then the formation, glinting in " +
      `the sun: ${count} bombers, high, running down the Slot. No mistaking these for ours.`,
  };
}

const GUADALCANAL_DAY4: Scenario = {
  id: "guadalcanal-4",
  dayTag: "Guadalcanal · Day 12",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "Headed Yours",
  introCopy:
    "The warnings come down the Slot like a bucket brigade. A man on an island three " +
    "hundred miles north sees the raid form up and keys it out; someone passes it on; " +
    "KEN hears it at Lunga. Every station on the chain buys Henderson a few more " +
    "minutes. Today you're the last one.",
  notes:
    "Day 12. KEN's fist was different on the morning sked — tighter, no swing in it at " +
    "all. Aaron noticed me noticing. \"Big day,\" he said, and went down to the point " +
    "without being asked. The Wildcats didn't go out this morning. They're sitting on " +
    "the strip waiting, and what they're waiting for is a word from somebody like me.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. OP on the northwest ridge, over the Slot. Raid expected: " +
    "upstream stations will report it forming. When it passes this ridge, report it to " +
    `HQ (KEN) at once — NR, TYPE, ALT, CSE. Skeds on ${hqFreqKhz} kHz: 0600 / 1030 / ` +
    "1500 / 1800. If KEN orders QRT, go silent: escorts fly low.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} GM RAID LIKELY TODAY AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} UPSTREAM RPTS BOMBERS HEADED CACTUS RPT WHEN THEY PASS K`,
      prompt: "Copy the warning, then acknowledge (QSL).",
    },
    { kind: "spot", clock: "1150", light: "noon", sighting: makeRaidFormation(), spotter: "Aaron" },
    {
      kind: "sked",
      clock: "1155",
      light: "noon",
      msg: `${MY_CALL} DE ${HQ_CALL} TU CACTUS SCRAMBLING QRT ESCORT LOW K`,
      prompt: "KEN's ordering you off the air — acknowledge (QSL), then stay quiet.",
    },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} ALL CLEAR QRU? K`,
      prompt: "Back on the air. Answer KEN's QRU? — or AGN? for a repeat.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — a QSL doesn't answer it. Send QRU: nothing for you.",
      },
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} TU GOOSE QRT GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "The raid came and went. Henderson is still there tonight.",
  outroAside: ({ retries }) =>
    retries <= 1
      ? "Word came up the net after dark: the Wildcats were already at altitude when the " +
        "bombers reached Lunga, sun at their backs and height to spare. Yours wasn't the " +
        "only warning — it started three hundred miles up the Slot and passed through a " +
        "lot of hands — but yours was the last one, and it went out clean. KEN's GN came " +
        "a beat slower than usual, like a man finally sitting down."
      : "Word came up the net after dark: the Wildcats got up in time, clawing for " +
        "altitude as the bombers came over — closer than anyone liked, but in time. " +
        "Yours wasn't the only warning; it started three hundred miles up the Slot and " +
        "passed through a lot of hands. You were the last pair. You lay awake a while " +
        "going over every AGN, and resolved there'd be fewer next time.",
};

/** Guadalcanal Day 5 — "Messages from home": the first letter, a breather
 *  (MORSE-GAMES.md's mission allocation table and "Messages from home" note).
 *  The letter comes by mail on the Minnow, not over the air — personal traffic
 *  on the net would break the airtime discipline the whole game teaches (and
 *  "a KEN beat that breaks radio format once" is being saved for later). So
 *  the letter lives in the Notes panel, the diary-voice channel, and the radio
 *  day is deliberately short and gentle. Opens Evelyn's arc at full strength
 *  (it's meant to peter out later — see her Cast entry). Period details are
 *  dated to late 1942: V-mail (from June 1942), "White Christmas" (the fall
 *  1942 hit), the Cardinals over the Yankees (October 1942 World Series). */
const GUADALCANAL_DAY5: Scenario = {
  id: "guadalcanal-5",
  dayTag: "Guadalcanal · Day 16",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "Mail Call",
  introCopy:
    "The Minnow came in after midnight with stores, a fresh battery, and a canvas sack " +
    "that had been chasing you across the Pacific for two months. One envelope in it " +
    "with your name. You didn't open it until there was light enough to read it " +
    "properly, which meant four hours lying awake, holding it.",
  notes:
    "Day 16. V-mail from Evelyn, shrunk so small I read it with my nose on the page. " +
    "She says my letter from the ship came with the middle cut out by the censor, so " +
    "she's decided I'm somewhere warm and eating well, and I'm not allowed to argue. " +
    "Everybody at home is singing that Bing Crosby song about the snow. She sings it " +
    "too, she says, but it drags without somebody keeping time. My kid brother wants me " +
    "to know the Cardinals beat the Yankees, like the news might not reach me. Mr. Hale " +
    "at the school says the scholarship will keep. I've read it six times. The seventh " +
    "time I just looked at her handwriting.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. OP on the northwest ridge. Quiet stretch: the Slot's " +
    `been empty for days. Skeds with HQ (KEN) on ${hqFreqKhz} kHz: 0600 / 0900 / 1400 / ` +
    "1800. Authenticate first contact; answer QRU? with QRU.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} GM QUIET DAY AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "0900",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} QRU? K`,
      prompt: "KEN's asking if you have anything for him. Answer it — or AGN? for a repeat.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — a QSL doesn't answer it. Send QRU: nothing for you.",
      },
    },
    {
      kind: "sked",
      clock: "1400",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} MINNOW BACK SAFE K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} QRU? HOPE MAIL WAS GOOD GN K`,
      prompt: "Last sked of the day. Answer KEN's QRU? before he signs off.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — answer QRU before signing off.",
      },
      final: true,
    },
  ],
  outroCopy:
    "A quiet day. The Slot stayed empty and nobody needed you for anything, which " +
    "turned out to be its own kind of hard.",
  outroAside:
    "You wrote back by lamplight, three pages. You kept it to the weather and the food " +
    "so the censor would leave it whole — and then at the bottom, before you could stop " +
    "yourself, a short line of dots and dashes she'd never be able to read. The censor " +
    "cut it out, of course. You'd have cut it too.",
};

/** Guadalcanal Day 6 — "React to threats": the first real scare, a patrol
 *  close call, survivable (MORSE-GAMES.md's mission allocation table). The
 *  react is going silent: a `silence` beat where KEN's routine noon call
 *  comes in while the patrol is on the trail below, and the right play is to
 *  let it go unanswered. KEN's follow-up then asks after GOOSE — a missed
 *  sked is survivable, a heard one might not be. Grounded in real coastwatcher
 *  practice: the charging engine's noise was a genuine giveaway, and posts
 *  behind the lines lived by going quiet when patrols came near. */
const GUADALCANAL_DAY6: Scenario = {
  id: "guadalcanal-6",
  dayTag: "Guadalcanal · Day 21",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "Close",
  introCopy:
    "Patrols have been moving in the hills all week — Aaron hears about them from the " +
    "villages before anyone else does. This morning he moved the set deeper into the " +
    "trees and had you practice shutting it down in the dark, twice, without a word.",
  notes:
    "Day 21. The charging engine is the loudest thing on this ridge. Never noticed until " +
    "Aaron walked me down the trail to listen for it — a putt-putt you could set a " +
    "metronome by. Now I can't stop hearing it. KEN says a missed sked happens and " +
    "nobody hangs you for one. I'm choosing to believe him.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. OP on the northwest ridge, behind the enemy's lines. " +
    `Skeds with HQ (KEN) on ${hqFreqKhz} kHz: 0600 / 0900 / 1200 / 1300 / 1800. Enemy ` +
    "patrols reported in the hills. If one comes near: no transmissions, no answers — " +
    "not even to KEN. A missed sked is survivable. A heard one may not be.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} GM AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "0900",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} QRU? K`,
      prompt: "KEN's asking if you have anything for him. Answer it — or AGN? for a repeat.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — a QSL doesn't answer it. Send QRU: nothing for you.",
      },
    },
    {
      kind: "silence",
      clock: "1155",
      light: "noon",
      spotter: "Aaron",
      warning:
        "In from the lookout, low and fast, a finger to his lips. A patrol on the trail " +
        "below the ridge — six, maybe eight. He's already killed the charging engine.",
      call: `${MY_CALL} DE ${HQ_CALL} QRU? K`,
      allClear:
        "Gone — down toward the river. He doesn't let go of your sleeve for another minute.",
    },
    {
      kind: "sked",
      clock: "1300",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} MISSED SKED ARE YOU OK? K`,
      prompt: "KEN's worried about the missed sked. Tell him you're all right.",
      reply: {
        words: ["OK"],
        hint: "KEN wants to know you're all right — tell him OK.",
      },
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} GLAD UR OK QRT GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "The patrol passed. The set's still here, and so are you.",
  outroAside: ({ brokeSilence }) =>
    brokeSilence
      ? "You'd both heard it — the voices below going quiet, the long minute of " +
        "listening. Then they moved on, and Aaron let out a breath he'd been holding " +
        "since your hand went to the key. He didn't say anything about it. He didn't have to."
      : "Afterward your hands wouldn't stop shaking, so Aaron put a pencil in one and " +
        "had you drum it on the log until they did. Two-and-three, the surf's rhythm. " +
        "He'd remembered.",
};

/** Guadalcanal Day 7 — the posting's sign-off: promotion by Bill, and the boat
 *  to New Georgia (MORSE-GAMES.md's mission allocation table). Anchored to the
 *  campaign's real end, 9 Feb 1943, when the Army commander reported to Halsey
 *  that the "Tokyo Express no longer has terminus on Guadalcanal" — KEN passes
 *  it on, a callback to Day 3's Express, with GOOSE only copying it (Forrest
 *  Gump restraint; brass as flavor, unnamed). The Express's last runs were the
 *  real Japanese evacuation, not yet understood as such at the time, so Aaron
 *  only guesses at it. Promotion is Technician Fifth Grade (T/5) — the first
 *  step on the doc's Technician track (T/5 → T/4 → T/3 at the later sign-offs);
 *  two chevrons over a "T", the insignia since Sept. 1942. Aaron comes along to
 *  New Georgia, matching MUNDA_DAY1 (he's there before the first sked). */
const GUADALCANAL_DAY7: Scenario = {
  id: "guadalcanal-7",
  dayTag: "Guadalcanal · Day 68",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "Terminus",
  introCopy:
    "The Express ran all week, but not the way it used to. Destroyers down the Slot " +
    "after dark, three nights running, and back up again before dawn, riding low in the " +
    "water. Nobody on the net will say what it means. Aaron thinks they're taking men " +
    "off, not putting them on.",
  notes:
    "Day 68. I keep counting days without meaning to. Sixty-eight, and I could name " +
    "something Aaron taught me for nearly every one of them — three trees, how a wake " +
    "sits, how to shut the set down in the dark without a sound. KEN's been saying " +
    "\"stand by\" all week in a voice I haven't heard from him before. Not worried. " +
    "Something else.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Guadalcanal. OP on the northwest ridge. Enemy destroyer traffic " +
    `in the Slot all week, pattern changed. Skeds with HQ (KEN) on ${hqFreqKhz} kHz: ` +
    "0600 / 0900 / 1300 / 1700 / 1800. Authenticate first contact; answer QRU? with QRU.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} GM AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy KEN and the authenticator challenge. Check today's table, then send " +
        "QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "0900",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} QRU? K`,
      prompt: "KEN's asking if you have anything for him. Answer it — or AGN? for a repeat.",
      reply: {
        words: ["QRU"],
        hint: "KEN asked QRU? — a QSL doesn't answer it. Send QRU: nothing for you.",
      },
    },
    {
      kind: "sked",
      clock: "1300",
      light: "noon",
      msg: `${MY_CALL} DE ${HQ_CALL} STAND BY FOR ORDERS TONIGHT K`,
      prompt: "Copy KEN, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1700",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} TOKYO EXPRESS NO LONGER HAS TERMINUS ON CACTUS K`,
      prompt: "Word from the top, passed down the net. This one's worth copying clean — then QSL.",
    },
    {
      kind: "sked",
      clock: "1800",
      light: "dusk",
      msg: `${MY_CALL} DE ${HQ_CALL} BILL ON MINNOW TONIGHT QRT GN K`,
      prompt: "Your last sign-off on Cactus. Acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy: "Your last watch on Cactus, logged. The Slot is just water now.",
  outroAside:
    "Bill came up the ridge after dark, a harried sergeant sweating through his shirt, " +
    "carrying a canvas bag of other people's problems. He handed you two stripes with a " +
    "little T stitched under them and waved off whatever you were about to say. " +
    "\"Technician Fifth Grade,\" he said, like an apology — corporal's pay, not a " +
    "corporal. \"New Georgia. Boat at first light. Your scout's coming too; I asked.\" " +
    "Then three days on a tug under a skipper you privately named Captain Bligh, " +
    "squinting at the sun. You hope he doesn't forget where he's put you.",
};

/** New Georgia/Munda Day 1 — the Request Supplies kit element's first outing. A
 *  single haggle beat, no sked/authenticator ceremony (this post isn't being
 *  watched today — see the notes), so the whole day is the negotiation with
 *  NICK. DF danger is naturally low here: haggling never bumps retryCount, so
 *  dangerLabel stays "low" the entire mission on purpose — this level is meant
 *  to let the player focus entirely on the trade, not a DF/timer threat. Both
 *  Nick's opening ask and which trade goods are on hand are randomized fresh
 *  per run (see buildTimeline()) — replaying isn't just re-running a script,
 *  it's a genuinely different negotiation. See MORSE-GAMES.md's "Request
 *  Supplies mission draft" for the full design note. */
const MUNDA_DAY1: Scenario = {
  id: "munda-1",
  dayTag: "New Georgia · Munda, Day 1",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "Landfall — New Georgia",
  introCopy:
    "The Minnow put you ashore in the dark again, but this beach is different — jerry " +
    "cans stacked at the tideline, a hacked path already climbing into the trees. Scouts " +
    "work this stretch of coast now too. Your shoulders are still sore from the last of " +
    "the cans.",
  notes: (day) => {
    const e = haggleEventOf(day);
    const goods = e ? e.tradeWords.map((w) => TRADE_FLAVOR[w]).join(", ") : "whatever's left in my pack";
    // GOOSE's own ranking, by GOOSE_VALUE — a personal opinion, not a promise
    // about what Nick actually wants (that's rolled independently — see
    // rollNickValues). Deliberately offered as a guess GOOSE could be wrong
    // about, since the two valuations aren't guaranteed to agree.
    const ranked = e ? [...e.tradeWords].sort((a, b) => GOOSE_VALUE[b] - GOOSE_VALUE[a]) : [];
    const opinion =
      ranked.length > 0
        ? ` If it were up to me I'd part with the ${ranked[ranked.length - 1].toLowerCase()} first and keep the ` +
          `${ranked[0].toLowerCase()} — but Nick's never once wanted what I expected him to.`
        : "";
    return (
      "Day 1 at Munda. Aaron caught me before the sked. \"Don't take his first number,\" " +
      "he said. \"Nick respects a fella who pushes back — bores him if you don't. Man " +
      "once talked him down on a full case of Spam using nothing but a harmonica and a " +
      `bad attitude.\" I don't have a harmonica — but I've got ${goods}.${opinion} No DF ` +
      "launch working this stretch today, they say — for once, nobody's listening in but Nick."
    );
  },
  briefing: (hqFreqKhz, day) => {
    const e = haggleEventOf(day);
    const trade = e ? e.tradeWords.join(", ") : "whatever's on hand";
    const need = e ? e.rewardItem : "supplies";
    return (
      `STATION GOOSE — New Georgia. Ashore at Munda, hacking a path up from the beach. ` +
      `Raise ${NICK_CALL} (supply) on ${hqFreqKhz} kHz before dusk. ` +
      `NEED: ${need} — that's genuinely what he's got. HAVE TO TRADE: ${trade} — mix and ` +
      "match what you send; what it's worth to him is his call, not yours. Minimum " +
      "ceremony, maximum nerve."
    );
  },
  buildTimeline: () => {
    const tradeWords = pickN(SUPPLY_TRADE_POOL, 3);
    const rewardItem = pick(SUPPLY_REWARD_POOL);
    return [
      {
        kind: "haggle",
        clock: "1000",
        light: "morning",
        partner: NICK_CALL,
        priceItem: tradeWords[0],
        tradeWords,
        rewardItem,
        rewardQty: randInt(1, 2),
        nickValues: rollNickValues([...tradeWords, rewardItem]),
      },
    ];
  },
  outroCopy: "Whatever Nick sends, it beats hauling it up that path by hand.",
  outroAside: "Somewhere down the coast, the Seabees are already at work — you just don't know it yet.",
};

/** New Georgia/Munda Day 2 — the Decode (HQ's ask) beat: an ambiguous KEN order
 *  builds the airstrip misconception that Day 3 pays off (see MORSE-GAMES.md's
 *  "Milestone mission seed — protecting the Munda Seabees"). Same sked/spot
 *  rhythm as the Kolombangara demo — no new mechanic, just Munda's voice and a
 *  joke GOOSE doesn't know he's telling on himself. */
const MUNDA_DAY2: Scenario = {
  id: "munda-2",
  dayTag: "New Georgia · Munda, Day 2",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "The Ask",
  introCopy:
    "Nick's supplies came up the path by scout relay overnight. Back on the ordinary " +
    "watch this morning — except KEN's 0600 traffic has a line in it nobody bothered " +
    "to explain.",
  notes:
    "Day 2. KEN wants the strip \"prepped\" and us \"standing by to assist " +
    "construction.\" Construction of what, he doesn't say — and there's exactly one " +
    "strip anyone means out here. The boys looked at me like I'd tell them different. " +
    "I didn't. How much chopping does THAT take, with two machetes and whatever's " +
    "left of my back after the jerry cans? Didn't sleep much on that one.",
  briefing: (hqFreqKhz) =>
    `STATION GOOSE — New Georgia. Same stretch of coast at Munda. Report to HQ (KEN) ` +
    `on ${hqFreqKhz} kHz; skeds 0600 / 1030 / 1200 / 1500 / 1800. Minimum power — a DF ` +
    "launch has started working this coast again.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} PREP STRIP SOONEST ES STAND BY TO ASSIST CONSTRUCTION AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0800", light: "morning", sighting: makeAircraftSighting() },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} STRIP PARTY ARRIVES TOMORROW BE READY K`,
      prompt: "Copy KEN's heads-up, then acknowledge (QSL).",
    },
    { kind: "spot", clock: "1200", light: "noon", sighting: makeShipSighting() },
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
  outroCopy: "Whatever's coming with the \"strip party,\" it's got top billing on my dread list now.",
  outroAside:
    "The boys had their own theory — \"maybe it means the OTHER strip.\" There is no " +
    "other strip.",
};

/** New Georgia/Munda Day 3 — the milestone: the Seabees reveal. GOOSE arrives
 *  braced for manual labor and finds the 47th/63rd Naval Construction Battalions
 *  already tearing through the jungle with heavy equipment — his real job was
 *  always watching the sky over their exposed, half-built strip, not swinging a
 *  machete. Same "Milestone: Decode + React to threats" shape as Guadalcanal's
 *  Day 4 (warning → the defense scrambles in time because of you), built on the
 *  existing spot/sked rhythm — no new mechanic. See MORSE-GAMES.md's "Milestone
 *  mission seed — protecting the Munda Seabees" and "Real history as milestone
 *  missions" for the design rationale and the Forrest Gump restraint it follows. */
const MUNDA_DAY3: Scenario = {
  id: "munda-3",
  dayTag: "New Georgia · Munda, Day 3",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "The Strip",
  introCopy:
    "You came up the track before dawn already sore in advance, machete borrowed and " +
    "dull, half-composing the complaint you'd write home about it — and stopped dead " +
    "at the tree line. Diesel engines. Real ones, dozens of them, chewing through " +
    "jungle wider and faster than any two men with machetes ever could. Whoever " +
    '"stand by to assist construction" meant, it plainly wasn\'t you.',
  notes:
    "Day 3. Bulldozers. Actual bulldozers, and men who clearly know how to run them, " +
    "and a strip taking shape in about the time it'd have taken me to clear the first " +
    'tree. "Seabees," KEN finally says outright — like I was supposed to know the word ' +
    "already. Feel a little foolish for the machete. Feel more foolish for how relieved " +
    "I am. My job, it turns out, was never the chopping. It's watching the sky over men " +
    "who can't look up while they work.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — New Georgia. Munda strip, mid-construction — badly exposed while " +
    `it's unfinished. Watch the sky over it; report anything inbound to HQ (KEN) on ` +
    `${hqFreqKhz} kHz, skeds 0600 / 1030 / 1200 / 1500 / 1800. Fast and clean matters ` +
    "more than usual today.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: `${MY_CALL} DE ${HQ_CALL} SEABEES ON THE STRIP ES EXPOSED WATCH THE SKY CLOSE AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0900", light: "morning", sighting: makeAircraftSighting() },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} QSL SCRAMBLED IN TIME TU K`,
      prompt: "Copy KEN's heads-up, then acknowledge (QSL).",
    },
    { kind: "spot", clock: "1200", light: "noon", sighting: makeAircraftSighting() },
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
  outroCopy: "Another section of strip poured before dark, and the sky stayed clear of anything you didn't call first.",
  outroAside:
    "Word came back, days later, third-hand: 47th and 63rd Battalion, five days start " +
    "to finish once they got moving. Nobody thanked GOOSE for it. Nobody needed to — " +
    "the planes that didn't get through were thanks enough.",
};

/** Scripted, not generated, so this run's reveal always reads the same way —
 *  same precedent as PT109_SIGHTING above. The "unmistakably Bill" detail rides
 *  in the prose, not the graded fields; the report itself grades exactly like
 *  any other ship relay. See MORSE-GAMES.md's "true finale — Magic Carpet
 *  coordination": the Easter egg that isn't a stretch. */
const BILL_SHIP_SIGHTING: Sighting = {
  category: "SHIP",
  count: 1,
  type: "AK",
  dir: "E",
  prose:
    "One transport standing out for open water, outbound at last. A manifest clerk's " +
    "gripe rides along with the passage request — something about working himself out " +
    "of one lousy job straight into a worse one. You'd know that line anywhere.",
};

/** The true finale — Operation Magic Carpet, the real 1945-46 mass repatriation
 *  (see MORSE-GAMES.md's "The true finale — Magic Carpet coordination"). A big
 *  calendar-as-montage skip from the Bougainville invasion. GOOSE's rank-driven
 *  coordinator shift, played for real: the same relay-net shape used for SKIP
 *  at Kolombangara, generalized to three field stations reporting up through
 *  him instead of one — "at scale" without a new mechanic. SKIP's own relay
 *  beat is a deliberate callback (same partner, same drill, headed home too);
 *  the TROOP relay's BILL_SHIP_SIGHTING is the closing Easter egg. Ships this
 *  version's scope only — genuine player-chosen prioritization among competing
 *  requests (the fuller "real scarcity" idea) is parked as a follow-up, not
 *  built here; every relay still resolves in the fixed timeline order. */
const MAGIC_CARPET_FINALE: Scenario = {
  id: "magic-carpet",
  dayTag: "Magic Carpet Coordination · Day 1",
  minEffectiveWpm: FIELD_MIN_WPM,
  introTitle: "The Priority Board",
  introCopy:
    "Two years gone in the space of a calendar page. The Slot is somebody else's watch " +
    "now; yours is a plywood desk in a rear-area commo shed, a chalkboard of ship names, " +
    "and headphones that never once make you flinch. The shooting's over. Getting " +
    "everybody home is its own kind of war room.",
  notes:
    "Twenty months since Bougainville, near enough. Andy drilled the alphabet into me " +
    "until I hated him for it; now I'm the one deciding whose message goes out first. " +
    "Three stations on the board today, and every one of them wants the same thing " +
    "everybody wants: a berth, and soon. There aren't enough hulls for all of it at " +
    "once — there never quite are — so the board is mine to run, and God help me if I " +
    "run it wrong.",
  briefing: (hqFreqKhz) =>
    "STATION GOOSE — Rear Area, Operation Magic Carpet. You're net control now: field " +
    "stations report ship movements and passage status; copy each, acknowledge the " +
    `sender, then forward anything complete to dispatch (KEN) on ${hqFreqKhz} kHz. Three ` +
    `stations on the board today — ${RELAY_CALL} (harbor watch), DEPOT (repair yard), ` +
    "TROOP (embarkation). Same drill as always, just more of it.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0900",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} PRIORITY BOARD OPEN 3 STATIONS TODAY AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "relay", clock: "1000", light: "morning", from: RELAY_CALL, sighting: makeShipSighting() },
    {
      kind: "overhear",
      clock: "1030",
      light: "morning",
      from: HQ_CALL,
      to: RELAY_CALL,
      msg: `${RELAY_CALL} DE ${HQ_CALL} QRU K`,
    },
    { kind: "relay", clock: "1200", light: "noon", from: "DEPOT", sighting: makeShipSighting() },
    { kind: "relay", clock: "1330", light: "afternoon", from: "TROOP", sighting: BILL_SHIP_SIGHTING },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} QSL BOARD CLOSED TU K`,
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
  outroCopy: "Board closed, clean. Whoever needed that berth will have it by morning.",
  outroAside:
    "Long after dusk, still logging, you caught up to the manifest note from the " +
    "afternoon relay: a sergeant, groused down the line word for word, about working " +
    "himself out of one lousy job straight into a worse one. You'd know that gripe " +
    "anywhere — it was practically your induction. Bill's headed home too, then. Small " +
    "world, wired together end to end. And somewhere in tonight's paperwork, without " +
    "asking for it, your own rating went up one more grade — the safe kind, the kind " +
    "that comes with nothing left to be modest about. Ceiling fans and beer, they used " +
    "to say, about men exactly like the one you've become.",
};

/** Stateside training — Camp Murphy, Florida (see MORSE-GAMES.md's "Onboarding").
 *  SCOPE NOTE (2026-08-02, deliberate): the design doc calls for training to
 *  "reuse Random Run, themed" with a new graduate-on-speed mechanic (freeze the
 *  Koch subset, ramp effective WPM to 7.5, graduate on N clean reps) — a real
 *  UI integration between AdventureMode and RandomRunMode that doesn't exist
 *  yet. Decided tonight to ship the lighter version instead: three ordinary
 *  shack-engine Scenarios, same sked/spot rhythm as every other mission, using
 *  KEN as Andy's training-desk callsign (the codebook already treats KEN as a
 *  role, "not necessarily a person" — Andy keying as KEN here is in-universe
 *  consistent, not a retcon) with Andy's actual personality carried entirely in
 *  prose (introCopy/notes/outroAside), the same way Aaron and Bill's voices
 *  work elsewhere. The real Koch-ramp/graduate-on-speed mechanic, and folding
 *  this into a true Random-Run wrapper, are parked follow-ups, not built here.
 *  SCENARIOS ordering note: these are prepended to index 0 (deliberately,
 *  unlike Munda's days 2-3 and Magic Carpet, which were appended) because
 *  training is the campaign's true prologue — appending it after Magic
 *  Carpet's finale would put the beginning after the ending in prev/next
 *  order, which is worse than the alternative below. Consequence: the demo's
 *  default mission on load (`SCENARIOS[0]` in mount()) changes from
 *  Kolombangara to Training Day 1. (The array now follows the historical
 *  spine throughout — Munda was moved ahead of Kolombangara on 2026-09-22,
 *  alongside Guadalcanal Day 1.) */
const TRAINING_DAY1: Scenario = {
  id: "training-1",
  dayTag: "Camp Murphy · Day 1",
  introTitle: "The Train South",
  introCopy:
    "Window was dark all night. Just lights flashing by. Since sunup the window's " +
    "showing me states I can't name. Never traveled — not once — and now it's boot " +
    "camp, then specialist school, like they can't wait to get me out there. Not so " +
    "sure I'm ready.",
  notes:
    "Day 1. A corporal named Andy runs the key like he's been doing it since birth and " +
    "resents having to slow down for the rest of us. Everything sounds like noise. He " +
    "says it won't, eventually. I'm choosing to believe him because the alternative is " +
    "worse.",
  briefing: (hqFreqKhz) =>
    "TRAINEE GOOSE — Camp Murphy, Florida. Copy Corporal Andy on the training circuit " +
    `(KEN) at ${hqFreqKhz} kHz. First rule, first day: every station proves who it is. ` +
    "Check the authenticator table below before you answer anything.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0800",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} WELCOME TRAINEE COPY ES QSL AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Your very first sked. This is the authenticator table — the real trick a " +
        "station uses to prove it's who it says it is. Check today's table below, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? if you need it again.",
    },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} KEEP YOUR FIST STEADY ES TRY AGAIN K`,
      prompt: "Copy Andy's correction, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} SECURE FOR CHOW GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy:
    "First day down. Every letter still feels like translating a foreign language in " +
    "your head — but it's a language, and languages can be learned.",
  outroAside:
    "Andy caught you after chow. \"You flinched at your own key just now,\" he said. " +
    "\"Won't have time for that where you're going. Same time tomorrow — we do this " +
    "until it stops being a foreign language.\"",
};

const TRAINING_DAY2: Scenario = {
  id: "training-2",
  dayTag: "Camp Murphy · Day 2",
  introTitle: "Dots Into Music",
  introCopy:
    "Days blur now — reveille, drill, chow, the key, chow, drill, lights out. Andy " +
    "says the alphabet stops being letters if you drill it enough. Eight hours on the " +
    "key today, still counting dots, still waiting for them to turn into anything else.",
  notes:
    "Sam says Andy keeps telling them it's like music. Sam doesn't hear it yet — keeps " +
    "asking when the dots and dashes are supposed to turn into something else. I didn't " +
    "say anything. Didn't want to explain why I already do. Andy doesn't repeat himself " +
    "twice on anything — the authenticator table, the prosigns, the fist — you get it " +
    "once, clean, or you get it again tomorrow, same as today.",
  briefing: (hqFreqKhz) =>
    "TRAINEE GOOSE — Camp Murphy training circuit. Same drill, more of it: authenticate " +
    `first contact, copy Andy's traffic, acknowledge clean. KEN, ${hqFreqKhz} kHz, skeds ` +
    "0800 / 0930 / 1030 / 1500.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0800",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} DAY 2 SAME RULES AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    { kind: "spot", clock: "0930", light: "morning", sighting: makeAircraftSighting() },
    {
      kind: "sked",
      clock: "1030",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} BETTER ES TIGHTER K`,
      prompt: "Copy Andy, then acknowledge (QSL).",
    },
    {
      kind: "sked",
      clock: "1500",
      light: "afternoon",
      msg: `${MY_CALL} DE ${HQ_CALL} SECURE FOR CHOW GN K`,
      prompt: "Copy the sign-off, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy:
    "Another day of it. The alphabet still looks like alphabet. Andy says that's " +
    "exactly when it starts to change.",
  outroAside:
    "\"Chalkboard sighting's not a real ship,\" Andy said, watching you report it " +
    "anyway, \"but the hand that reports it is the same hand you'll use on a real one.\"",
};

const TRAINING_DAY3: Scenario = {
  id: "training-3",
  dayTag: "Camp Murphy · Day 3",
  introTitle: "Orders",
  introCopy:
    "Called to Andy's desk today, thought I was in trouble. Orders came down. He read " +
    "them out like they cost him something.",
  notes:
    "Day 3. Last one, apparently. Passed whatever it is you're supposed to pass — Andy " +
    "didn't make a ceremony of it, just said \"good enough\" the way a man says it when " +
    "he means it and doesn't like that he does.",
  briefing: (hqFreqKhz) =>
    "TRAINEE GOOSE — Camp Murphy, final day. One last sked with Andy (KEN) on " +
    `${hqFreqKhz} kHz before the transport. Authenticate first contact, same as every ` +
    "day — some habits you keep for good.",
  buildTimeline: (authChallenge) => [
    {
      kind: "sked",
      clock: "0800",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} LAST DAY GOOD ENOUGH AUTHENTICATE ${authChallenge} K`,
      prompt:
        "Copy your orders and the authenticator challenge. Check today's table, then " +
        "send QSL I AUTHENTICATE <code> together — or AGN? to hear it again.",
    },
    {
      kind: "sked",
      clock: "1000",
      light: "morning",
      msg: `${MY_CALL} DE ${HQ_CALL} REPORT TO TRANSPORT 1400 GN K`,
      prompt: "Copy your orders, then acknowledge (QSL).",
      final: true,
    },
  ],
  outroCopy:
    "Camp Murphy's gone before you're even off the truck. Everything after this, " +
    "you'll be doing for real.",
  outroAside:
    "Andy walked you to the truck, which he hadn't done for anyone else that cycle. " +
    "\"It's not enough,\" he said, not looking at you. \"It never is. It's what we had " +
    "time for.\" Somewhere above him, a transport manifest didn't care whether you " +
    "agreed — the boat left Thursday with or without you being ready. You were ready " +
    "enough. You'd find out exactly how ready, soon.",
};

const SCENARIOS: Scenario[] = [
  TRAINING_DAY1,
  TRAINING_DAY2,
  TRAINING_DAY3,
  GUADALCANAL_DAY1,
  GUADALCANAL_DAY2,
  GUADALCANAL_DAY3,
  GUADALCANAL_DAY4,
  GUADALCANAL_DAY5,
  GUADALCANAL_DAY6,
  GUADALCANAL_DAY7,
  MUNDA_DAY1,
  MUNDA_DAY2,
  MUNDA_DAY3,
  KOLOMBANGARA_DAY14,
  KOLOMBANGARA_DAY3,
  KOLOMBANGARA_DAY_RELAY,
  MAGIC_CARPET_FINALE,
];

type Phase = "cold" | "onair" | "sked" | "spot" | "relay" | "overhear" | "silence" | "haggle" | "done";

export class AdventureMode {
  private root: HTMLElement;
  private settings: Settings;
  private engine: MorseEngine;

  private scenario: Scenario = SCENARIOS[0];
  private phase: Phase = "cold";
  private radioOn = false; // distinct from phase: lets the player kill power mid-day by mistake without ending the run
  private playing = false;
  private freqKhz = DIAL_START_KHZ; // start off-frequency so tuning is the first task
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
  // Haggle (Request Supplies) state — see beginHaggle() and the haggle-* RULES below.
  // Deliberately never touches retryCount: this mission's DF danger stays pegged low
  // by design (see MUNDA_DAY1), so haggling freely never reads as "risky."
  private haggleStage: "opening" | "negotiate" = "opening";
  private haggleAskValue = 0; // Nick's current ask, in ITEM_VALUE points — see haggle-counter
  private haggleOffered = new Map<string, number>(); // cumulative {item: qty} offered this run, for the deal-struck summary
  private haggleLastPlayerTokens: string[] = []; // detects an unchanged, stalled resend
  private haggleRounds = 0; // negotiate-stage player turns — no cap, just a replay-worthy stat (see haggle-accept)
  private retryCount = 0; // AGN repeats + incomplete-report resends this run — drives dangerLabel
  private brokeSilence = false; // transmitted during a silence beat this run
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
    this.freqKhz = DIAL_START_KHZ;
    this.power = 10;
    this.txCount = 0;
    this.showText = false;
    this.clock = "—";
    this.traffic = [];
    this.evtIx = 0;
    this.need = [];
    this.relayAcked = false;
    this.relayForwardDone = false;
    this.haggleStage = "opening";
    this.haggleAskValue = 0;
    this.haggleOffered = new Map();
    this.haggleLastPlayerTokens = [];
    this.haggleRounds = 0;
    this.retryCount = 0;
    this.brokeSilence = false;
    this.authTable = makeAuthTable(); // generated fresh — see the authenticator note above
    this.liveAuthIdx = randInt(0, this.authTable.length - 1); // which row KEN actually challenges with
    this.hqFreqKhz = makeHqFreqKhz(); // generated fresh — same SOI logic as the auth table
    this.day = scenario.buildTimeline(this.authTable[this.liveAuthIdx].challenge); // this run's mix of skeds + generated sightings
    const effectiveWpm = Math.max(this.settings.effectiveWpm, scenario.minEffectiveWpm ?? 0);
    this.engine.settings = {
      ...this.engine.settings,
      effectiveWpm,
      charWpm: Math.max(this.settings.charWpm, effectiveWpm), // Farnsworth: char speed never below effective
    };
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
    // Say so when the floor overrides the player's own setting, so a sudden
    // jump in speed reads as the posting, not a bug.
    const floor = this.scenario.minEffectiveWpm;
    if (floor !== undefined && floor > this.settings.effectiveWpm) {
      card.appendChild(
        text(
          "p",
          "intro-speed",
          `Field speed: KEN sends at ${floor} WPM here — faster than your ${this.settings.effectiveWpm} WPM setting.`
        )
      );
    }
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
    const place = this.scenario.dayTag.split(/[·,]/)[0].trim();
    panel.appendChild(text("h2", "shack-title", `Station GOOSE — ${place}`));
    panel.appendChild(text("div", "shack-label", "Briefing"));
    panel.appendChild(text("p", "brief", this.scenario.briefing(this.hqFreqKhz, this.day)));
    panel.appendChild(text("div", "shack-label", "Authenticator (today) — SOI table"));
    const authGrid = el("div", "codebook codebook--single");
    for (const { challenge, response } of this.authTable) {
      const row = el("div", "codebook-row");
      row.append(text("span", "code-k", challenge), text("span", "code-v", `→ ${response}`));
      authGrid.appendChild(row);
    }
    panel.appendChild(authGrid);
    panel.appendChild(text("div", "shack-label", "Notes"));
    const notesText = typeof this.scenario.notes === "function" ? this.scenario.notes(this.day) : this.scenario.notes;
    panel.appendChild(text("p", "notes", notesText));
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
    this.elStartBtn = button("", "btn primary btn-power power-glow", () => void this.togglePower());
    this.elStartBtn.innerHTML = POWER_ICON_SVG;
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
      FREQ_STEP_KHZ,
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
    const codebookLabel = this.scenario.id.startsWith("training-")
      ? "Codebook (from Andy)"
      : "Codebook (since bootcamp)";
    panel.appendChild(text("div", "shack-label", codebookLabel));

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
          ["QRU?", "have you anything for me? — answer QRU if not"],
          ["GM", "good morning"],
          ["QTC", "I have traffic for __"],
          ["QSP", "relay / I'll relay"],
          ["TU", "thanks"],
          ["GN", "good night"],
          ["UR", "your / you're"],
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
    // Exact match only: a CW signal is a few hundred Hz wide, so even one dial
    // step (5 kHz) off is well outside the receiver's passband.
    return this.freqKhz === this.hqFreqKhz;
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
   *  sked comes through on its own. Also the entry point for a day that opens
   *  on a haggle beat instead of a sked (MUNDA_DAY1) — spot/relay/overhear
   *  never open a day, so those fall through and do nothing, same as before. */
  private async trySked0(): Promise<void> {
    if (this.phase !== "onair" || this.evtIx !== 0 || this.playing) return;
    const e = this.day[0];
    if (e.kind !== "sked" && e.kind !== "haggle") return;
    this.setScene(e.light, e.clock);
    if (this.onFreq) this.focusNotepad();
    if (e.kind === "haggle") {
      await this.beginHaggle(e);
      this.refresh();
      return;
    }
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
      this.addSpot(e.sighting.prose, e.spotter?.toUpperCase());
      this.setStatus(
        e.sighting.category === "SHIP"
          ? "This one matters — encode it and report to KEN, clean."
          : `${e.spotter ?? "Runner"}'s in — encode it and report to KEN.`
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
    } else if (e.kind === "silence") {
      this.phase = "silence";
      this.addSpot(e.warning, e.spotter.toUpperCase());
      this.setStatus("Patrol below. Stay off the air — don't answer anyone, not even KEN.");
      this.refresh();
      await delay(SILENCE_LEAD_MS);
      if (await this.hqSend(e.call)) {
        this.setStatus("KEN's calling. Let it go — the patrol's still on the trail.");
      }
      this.refresh();
      await delay(SILENCE_HOLD_MS);
      this.addSpot(e.allClear, e.spotter.toUpperCase());
      await this.advance();
      return;
    } else if (e.kind === "haggle") {
      await this.beginHaggle(e);
    } else {
      this.phase = "sked";
      if (await this.hqSend(e.msg)) this.setStatus(e.prompt);
    }
    this.refresh();
  }

  /** Opens a haggle beat (Request Supplies): reset the negotiation state, then
   *  have `partner` open with an invitation to state what you need. Called from
   *  both trySked0() (haggle as the day's first event) and runEvent() (haggle
   *  at any later index), so the setup lives in one place. */
  private async beginHaggle(e: Extract<DayEvent, { kind: "haggle" }>): Promise<void> {
    this.phase = "haggle";
    this.haggleStage = "opening";
    this.haggleAskValue = 0; // set for real once negotiation opens — see haggle-opening
    this.haggleOffered = new Map();
    this.haggleLastPlayerTokens = [];
    this.haggleRounds = 0;
    if (await this.hqSend(`${MY_CALL} DE ${e.partner} HEARD YOU GOT A LIST FOR ME QRV K`, e.partner)) {
      this.setStatus(`State what you need, then haggle it out with ${e.partner}.`);
    }
  }

  /** The current ask (in Nick's own value points — see rollNickValues),
   *  translated into a concrete count of `priceItem` so Nick always talks in
   *  tangible goods, never raw "points." Rounds up, so it never asks for less
   *  than covers the remaining value. */
  private haggleRemainingUnits(e: Extract<DayEvent, { kind: "haggle" }>): number {
    const priceVal = e.nickValues[e.priceItem] || 1;
    return Math.ceil(this.haggleAskValue / priceVal);
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
    const aside = this.scenario.outroAside;
    if (aside) {
      const copy =
        typeof aside === "function" ? aside({ retries: this.retryCount, brokeSilence: this.brokeSilence }) : aside;
      card.appendChild(text("p", "intro-copy intro-aside", copy));
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
  private static isHaggle(ctx: AdventureMode): boolean {
    return ctx.phase === "haggle" && ctx.currentEvent.kind === "haggle";
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
    if (this.phase === "haggle" && e.kind === "haggle") return [e.partner];
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
        // Reply as whoever you're actually supposed to be addressing — during a
        // haggle beat that's the trade partner, not HQ (previously hardcoded to
        // HQ_CALL, which was harmless while HQ was the only possible recipient).
        const recipient = ctx.validRecipients()[0];
        await ctx.hqSend(`${MY_CALL} DE ${recipient} QRZ K`, recipient);
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
      match: (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind === "sked" && e.reply) return includesSequence(i.words, e.reply.words);
        return i.words.includes("QSL") || i.words.includes("R");
      },
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
        const e = ctx.currentEvent;
        if (e.kind === "sked" && e.reply) ctx.setStatus(e.reply.hint);
        else ctx.setStatus(`Send QSL to acknowledge ${HQ_CALL}, or AGN? for a repeat.`);
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
        ctx.addSpot(e.sighting.prose, `${e.spotter ?? "the boy"} repeats`);
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
    // Haggle (Request Supplies) — see MUNDA_DAY1 and beginHaggle(). The "opening"
    // sub-stage just waits for the player to state their need (any properly-
    // addressed message advances it, ungraded — the negotiation is the point,
    // not this line); everything after is the real back-and-forth.
    {
      id: "haggle-opening",
      when: AdventureMode.isHaggle,
      match: (_i, ctx) => ctx.haggleStage === "opening",
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        ctx.haggleStage = "negotiate";
        // Nick opens inflated above his OWN sense of fair value (never GOOSE's —
        // see rollNickValues) — real negotiation posture, and room to work with.
        const targetValue = e.rewardQty * e.nickValues[e.rewardItem];
        const askValue = targetValue + randInt(2, 4);
        const priceVal = e.nickValues[e.priceItem];
        const startUnits = Math.max(1, Math.ceil(askValue / priceVal));
        ctx.haggleAskValue = startUnits * priceVal; // keep the stated line and the math exact
        const priceUnit = unitFor(e.priceItem, startUnits);
        const rewardUnit = unitFor(e.rewardItem, e.rewardQty);
        await ctx.hqSend(
          `${MY_CALL} DE ${e.partner} QRV OFFER ${e.rewardQty} ${rewardUnit} ${e.rewardItem} FOR ` +
            `${startUnits} ${priceUnit} ${e.priceItem} K`,
          e.partner
        );
        ctx.setStatus(
          `You need about ${startUnits} ${priceUnit.toLowerCase()} ${e.priceItem}'s worth to cover ` +
            `${e.rewardQty} ${rewardUnit.toLowerCase()} ${e.rewardItem} — you've got ${e.tradeWords.join(", ")} ` +
            "to work with. Offer any mix, counter with NEG <n>, or QSL once it's covered."
        );
      },
    },
    {
      id: "haggle-repeat",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: (i) => i.isAgn,
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        const units = ctx.haggleRemainingUnits(e);
        const priceUnit = unitFor(e.priceItem, units);
        await ctx.hqSend(`${MY_CALL} DE ${e.partner} SEND ${units} ${priceUnit} ${e.priceItem} K`, e.partner);
      },
    },
    {
      id: "haggle-accept",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: (i) => i.words.includes("QSL") || i.words.includes("OK") || i.words.includes("R"),
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        await ctx.hqSend(`${MY_CALL} DE ${e.partner} HI OK QSL WILL SEND SAT K`, e.partner);

        // Final price = whatever was already offered, plus enough priceItem to
        // cover what's left of the ask — same commitment QSL always implied.
        const finalOffered = new Map(ctx.haggleOffered);
        const remainingUnits = ctx.haggleRemainingUnits(e);
        if (remainingUnits > 0) {
          finalOffered.set(e.priceItem, (finalOffered.get(e.priceItem) ?? 0) + remainingUnits);
        }
        const tradedStr = [...finalOffered.entries()]
          .map(([item, qty]) => `${qty} ${unitFor(item, qty).toLowerCase()} ${item}`)
          .join(", ");

        // Two independent tallies of the SAME goods — Nick's real (hidden)
        // valuation vs. GOOSE's own fixed sense of worth. The gap between them
        // is the whole point (see GOOSE_VALUE / rollNickValues).
        let nickTotal = 0;
        let gooseTotal = 0;
        for (const [item, qty] of finalOffered) {
          nickTotal += e.nickValues[item] * qty;
          gooseTotal += (GOOSE_VALUE[item] ?? 1) * qty;
        }
        const readOut =
          gooseTotal < nickTotal
            ? "Good read — that cost you less than it was worth to him."
            : gooseTotal > nickTotal
              ? "He got the better end of that one — wasn't what he was really after."
              : "A fair trade, by anyone's reckoning.";

        ctx.addTraffic(
          "log",
          `Deal struck: ${tradedStr} for ${e.rewardQty} ${unitFor(e.rewardItem, e.rewardQty).toLowerCase()} ` +
            `${e.rewardItem}, ${ctx.haggleRounds} rounds of haggling. ${readOut}`
        );
        await ctx.advance();
      },
    },
    // A stalled, unchanged resend — "bores him if you don't" made mechanical:
    // repeating the exact same offer doesn't soften Nick, it stiffens him.
    // Checked before "haggle-counter" so a genuine repeat reads as stalling,
    // not (impossibly) as new value.
    {
      id: "haggle-stall",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: (i, ctx) =>
        ctx.haggleLastPlayerTokens.length > 0 && i.words.join(" ") === ctx.haggleLastPlayerTokens.join(" "),
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        ctx.haggleRounds += 1;
        const units = ctx.haggleRemainingUnits(e);
        const priceUnit = unitFor(e.priceItem, units);
        await ctx.hqSend(
          `${MY_CALL} DE ${e.partner} HO HUM SAME OFFER? SEND ${units} ${priceUnit} ${e.priceItem} ` +
            "OR SOMETHING NEW K",
          e.partner
        );
        ctx.setStatus("Repeating yourself doesn't move him — try offering something new instead.");
      },
    },
    // The real haggle — and the whole point of this redesign: a message can
    // name SEVERAL different goods at once, each valued by Nick's OWN (hidden,
    // per-run) valuation, not GOOSE's assumption — see rollNickValues. The
    // total knocks straight off the ask, so the engine genuinely weighs
    // combinations against Nick's price instead of counting mentions. NEG
    // alone (no goods) only works down to Nick's own fair value for the
    // reward — going below that takes real goods, not just pressure. His
    // reaction to each item offered is a soft tell for how much HE actually
    // wanted it (see nickReaction) — the only way to learn his real
    // preferences is to offer things and watch how he responds.
    {
      id: "haggle-counter",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return false;
        const hasOffer = parseOffer(i.words, e.tradeWords).length > 0;
        const hasCounter = i.words.includes("NEG") && i.words.some((w) => /^[0-9]+$/.test(w));
        return hasOffer || hasCounter;
      },
      act: async (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        ctx.haggleRounds += 1;
        ctx.haggleLastPlayerTokens = i.words;

        const offer = parseOffer(i.words, e.tradeWords);
        let offerValue = 0;
        let reaction = "OM TOUGH TRADER";
        for (const { item, qty } of offer) {
          offerValue += e.nickValues[item] * qty;
          ctx.haggleOffered.set(item, (ctx.haggleOffered.get(item) ?? 0) + qty);
          reaction = nickReaction(e.nickValues[item]); // last item mentioned wins, good enough for one line
        }

        let negNote = "";
        if (i.words.includes("NEG")) {
          const fairValue = e.rewardQty * e.nickValues[e.rewardItem];
          if (ctx.haggleAskValue > fairValue) {
            offerValue += e.nickValues[e.priceItem];
            reaction = offer.length > 0 ? reaction : "OM";
          } else {
            negNote = " ALREADY FAIR PRICE";
          }
        }

        ctx.haggleAskValue = Math.max(0, ctx.haggleAskValue - offerValue);
        const remainingUnits = ctx.haggleRemainingUnits(e);
        const priceUnit = unitFor(e.priceItem, remainingUnits);

        if (remainingUnits <= 0) {
          await ctx.hqSend(`${MY_CALL} DE ${e.partner} HI OK DEAL SEND QSL TO CLOSE IT K`, e.partner);
          ctx.setStatus("You've covered it — send QSL to close the deal, or keep pushing for something better.");
        } else {
          await ctx.hqSend(
            `${MY_CALL} DE ${e.partner} ${reaction}${negNote} SEND ${remainingUnits} ${priceUnit} ${e.priceItem} ` +
              "OR SOMETHING ELSE K",
            e.partner
          );
          ctx.setStatus(
            `You still owe about ${remainingUnits} ${priceUnit.toLowerCase()} ${e.priceItem}'s worth. ` +
              "Offer more goods, counter with NEG <n>, or QSL to accept."
          );
        }
      },
    },
    // "Got fuel?" — a direct question about the reward side of the trade, not
    // an offer. Confirms what's actually on the table when it's the item Nick's
    // already offering; if it names a *different* real supply item (from the
    // same pool, just not this run's pick), says so plainly instead of letting
    // the player fixate on something that was never obtainable this run — the
    // exact bug this whole redesign fixes. Ranked after haggle-counter so an
    // actual offer/counter always wins if a message somehow does both.
    {
      id: "haggle-reward-unavailable",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: (i, ctx) => {
        const e = ctx.currentEvent;
        return e.kind === "haggle" && SUPPLY_REWARD_POOL.some((w) => w !== e.rewardItem && i.tk.has(w));
      },
      act: async (i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        const asked = SUPPLY_REWARD_POOL.find((w) => w !== e.rewardItem && i.tk.has(w))!;
        await ctx.hqSend(`${MY_CALL} DE ${e.partner} NEG NO ${asked} TODAY GOT ${e.rewardItem} THOUGH K`, e.partner);
        ctx.setStatus(
          `No ${asked} today — you're negotiating for ${e.rewardItem}. Counter with NEG <n>, offer trade ` +
            "goods, or QSL to accept."
        );
      },
    },
    {
      id: "haggle-reward-query",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: (i, ctx) => {
        const e = ctx.currentEvent;
        return e.kind === "haggle" && i.tk.has(e.rewardItem);
      },
      act: async (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        const units = ctx.haggleRemainingUnits(e);
        const priceUnit = unitFor(e.priceItem, units);
        const rewardUnit = unitFor(e.rewardItem, e.rewardQty);
        await ctx.hqSend(
          `${MY_CALL} DE ${e.partner} AFFIRM GOT ${e.rewardQty} ${rewardUnit} ${e.rewardItem} FOR YOU ` +
            `SEND ${units} ${priceUnit} ${e.priceItem} K`,
          e.partner
        );
        ctx.setStatus(
          `That's the deal: ${e.rewardQty} ${rewardUnit.toLowerCase()} ${e.rewardItem} for about ${units} ` +
            `${priceUnit.toLowerCase()} ${e.priceItem} from you. Counter with NEG <n>, offer more goods, or ` +
            "QSL to accept."
        );
      },
    },
    // No round cap, on purpose — Nick doesn't get bored of the CLOCK, only of a
    // stalled offer (see haggle-stall above). A player can haggle as long as
    // they want, chasing a better price; haggleRounds is tracked purely as a
    // bragging-rights stat on the deal-struck log line (see haggle-accept), so
    // a replay has something concrete to try to beat.
    {
      id: "haggle-nudge",
      when: (ctx) => AdventureMode.isHaggle(ctx) && ctx.haggleStage === "negotiate",
      match: () => true,
      act: (_i, ctx) => {
        const e = ctx.currentEvent;
        if (e.kind !== "haggle") return;
        const units = ctx.haggleRemainingUnits(e);
        const priceUnit = unitFor(e.priceItem, units).toLowerCase();
        ctx.setStatus(
          `You still owe about ${units} ${priceUnit} ${e.priceItem}'s worth — offer any mix of your goods ` +
            `(${e.tradeWords.join(", ")}), counter with NEG <n>, or send QSL to accept.`
        );
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
    // Silence beat (patrol nearby): any transmission is the mistake, whatever it
    // says. Judged by the phase when keying *starts* and never routed to the
    // rules — the beat can end mid-send, and the message mustn't then count as
    // an answer to the next sked. Survivable: danger jumps, the outro remembers.
    if (this.phase === "silence") {
      this.retryCount += 2;
      this.brokeSilence = true;
      await this.playSelf(msg);
      if (this.phase === "silence") {
        this.setStatus("A hand clamps on your wrist. Below, the voices stop — a long minute of listening. Stay off the key.");
      }
      this.refresh();
      return;
    }
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
      (this.phase === "sked" ||
        this.phase === "spot" ||
        this.phase === "relay" ||
        this.phase === "overhear" ||
        this.phase === "silence" ||
        this.phase === "haggle")
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

    this.elTxInput.placeholder = `key a message to ${this.validRecipients()[0]}…`;
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

// Inline SVG instead of the Unicode "⏻" glyph (U+23FB) — that codepoint has
// spotty font coverage (e.g. missing on some Windows setups) and renders blank.
const POWER_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><path d="M12 2v8"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg>';

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
