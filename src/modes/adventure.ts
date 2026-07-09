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
// the timeline. Retransmissions bump a danger readout, kept LOW this mission.
//
// First contact each day is CHALLENGED (AUTHENTICATE / I AUTHENTICATE — real WWII
// Signal Operating Instructions prowords). The briefing prints today's authenticator
// table, generated fresh per mission; KEN's 0600 orders carry a live challenge from
// that table, and your QSL must carry "I AUTHENTICATE <code>" in the same
// transmission before KEN will log it. See MORSE-GAMES.md's "Authenticator codes"
// note for the design rationale.

import { MorseEngine } from "../audio/morse-engine";
import { loadSettings, Settings } from "../stats/storage";

const HQ_CALL = "KEN"; // net control (HQ)
const MY_CALL = "GOOSE"; // this station
const FREQ_MIN = 4000;
const FREQ_MAX = 5200;
const ON_FREQ_KHZ = 15; // within this window, HQ is readable
const FREQ_SETTLE_MS = 700; // dwell time on a steady frequency before static/the sked fires

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

// Exact demo text — see the "Kolombangara" worked example in MORSE-GAMES.md.
function briefingText(hqFreqKhz: number): string {
  return (
    "STATION GOOSE — Kolombangara. Put ashore by the Minnow before dawn. OP on the " +
    "summit; watch Blackett Strait and the Slot. Report shipping and aircraft to HQ " +
    `(KEN) on ${hqFreqKhz} kHz; skeds 0600 / 1200 / 1800. Minimum power — there's a DF launch ` +
    "working these islands."
  );
}
const NOTES =
  "Day 14. The set weighs a hundred pounds and I didn't carry it. The scouts did — " +
  "up the mountain track in the dark, barefoot, while I looked after the chronometer " +
  'and the coffee. HQ calls them "the boys" and settles up in twist tobacco and ' +
  "promises. They work the far coast, where a man who's caught gets what they gave " +
  "Vouza, and they go anyway — and come morning they grin at me like I'm the one " +
  "doing them the favor. I've taken to writing their names in the log. The log " +
  "doesn't ask.";

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
  const table: AuthPair[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * letters.length);
    const challenge = letters.splice(idx, 1)[0];
    table.push({ challenge, response: String(randInt(0, 9)) });
  }
  return table;
}

function requiredFields(s: Sighting): string[] {
  return s.category === "ACFT" ? ["count", "type", "alt", "dir"] : ["count", "type", "dir"];
}
function tokenize(msg: string): Set<string> {
  return new Set(tokenizeWords(msg));
}
/** Ordered words, for phrase/sequence checks (unlike the Set above, order survives). */
function tokenizeWords(msg: string): string[] {
  return msg.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}
/** Rule-based "flexible but not fuzzy" phrase match: true if `seq` appears as
 *  consecutive words anywhere in `tokens` — tolerates extra spacing, surrounding
 *  prowords, and position in the message without needing an exact substring or
 *  any AI judgment call. */
function includesSequence(tokens: string[], seq: string[]): boolean {
  outer: for (let i = 0; i <= tokens.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
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
  | { kind: "spot"; clock: string; light: string; sighting: Sighting };

function buildDay(authChallenge: string): DayEvent[] {
  return [
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
  ];
}

type Phase = "cold" | "onair" | "sked" | "spot" | "done";

export class AdventureMode {
  private root: HTMLElement;
  private settings: Settings;
  private engine: MorseEngine;

  private phase: Phase = "cold";
  private playing = false;
  private freqKhz = 4200; // start off-frequency so tuning is the first task
  private power = 10; // watts, 0..100; low = quiet/faint, high = strong/exposed
  private txCount = 0;
  private showText = false; // "plot mode": reveal inbound HQ traffic as text
  private clock = "—";
  private traffic: { who: "ken" | "you" | "run" | "log"; msg: string; clock: string }[] = [];
  private day: DayEvent[] = [];
  private evtIx = 0;
  private need: string[] = []; // report fields still outstanding for the current spot
  private authTable: AuthPair[] = []; // today's authenticator table
  private liveAuthIdx = 0; // which row of authTable KEN actually challenges with, randomized per run
  private hqFreqKhz = 0; // today's sked frequency, generated fresh in mount()
  private freqSettleTimer: ReturnType<typeof setTimeout> | null = null;

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
  private elContinueBtn!: HTMLButtonElement;
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
   *  card. Used both by mount() and by "Replay the day" on the outro screen —
   *  see the transition-screen / Replay discussion in MORSE-GAMES.md. */
  private resetRun(): void {
    this.clearFreqSettle();
    this.phase = "cold";
    this.playing = false;
    this.freqKhz = 4200;
    this.power = 10;
    this.txCount = 0;
    this.showText = false;
    this.clock = "—";
    this.traffic = [];
    this.evtIx = 0;
    this.need = [];
    this.authTable = makeAuthTable(); // generated fresh — see the authenticator note above
    this.liveAuthIdx = randInt(0, this.authTable.length - 1); // which row KEN actually challenges with
    this.hqFreqKhz = makeHqFreqKhz(); // generated fresh — same SOI logic as the auth table
    this.day = buildDay(this.authTable[this.liveAuthIdx].challenge); // this run's mix of skeds + generated sightings
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
    card.appendChild(text("div", "intro-tag", "Kolombangara · Day 14"));
    card.appendChild(text("h2", "intro-title", "Station GOOSE"));
    card.appendChild(
      text(
        "p",
        "intro-copy",
        "Before dawn the Minnow put you ashore below the summit and slipped back " +
          "out into the dark. The scouts had the set up the mountain track before " +
          "your boots were dry. Another day on the ridge, watching the Slot."
      )
    );
    card.appendChild(button("Begin the watch", "btn primary", () => this.beginShack()));
    view.appendChild(card);
    return view;
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
    panel.appendChild(text("p", "brief", briefingText(this.hqFreqKhz)));
    panel.appendChild(text("div", "shack-label", "Authenticator (today) — SOI table"));
    const authGrid = el("div", "codebook codebook--single");
    for (const { challenge, response } of this.authTable) {
      const row = el("div", "codebook-row");
      row.append(text("span", "code-k", challenge), text("span", "code-v", `→ ${response}`));
      authGrid.appendChild(row);
    }
    panel.appendChild(authGrid);
    panel.appendChild(text("div", "shack-label", "Notes"));
    panel.appendChild(text("p", "notes", NOTES));
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
    this.elStartBtn = button("⏻", "btn primary btn-power power-glow", () => void this.start());
    this.elStartBtn.setAttribute("aria-label", "Power");
    this.elStartBtn.title = "Power on the set";
    this.elShowTextBtn = button("Show Text: Off", "btn ghost", () => this.toggleText());
    this.elContinueBtn = button("→ Log off", "btn primary", () => this.showOutro());
    this.elContinueBtn.hidden = true;
    controls.append(this.elStartBtn, this.elShowTextBtn, this.elContinueBtn);
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

  private async start(): Promise<void> {
    await this.engine.resume();
    this.elStartBtn.disabled = true;
    this.elStartBtn.classList.remove("power-glow");
    this.elStartBtn.classList.add("power-on");
    this.setStatus("The set hums to life…");
    await this.engine.playPowerHum();
    this.phase = "onair";
    this.setScene("dawn", "0600");
    this.setStatus("Set's warm — spin the dial to today's sked frequency (see the briefing).");
    this.refresh();
    this.scheduleFreqSettle();
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
    if (this.phase !== "onair" || this.evtIx !== 0 || this.playing) return;
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
    if (e.kind === "spot") {
      this.phase = "spot";
      this.need = requiredFields(e.sighting);
      this.addSpot(e.sighting.prose);
      this.setStatus(
        e.sighting.category === "SHIP"
          ? "This one matters — encode it and report to KEN, clean."
          : "Runner's in — encode it and report to KEN."
      );
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
    this.setStatus("Set's down for the night. Good day's work.");
    this.addTraffic("log", `End of day. Skeds & sightings ${this.day.length} · Sent ${this.txCount} · Danger low.`);
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
    card.appendChild(text("div", "intro-tag", "Kolombangara · Day 14 — complete"));
    card.appendChild(text("h2", "intro-title", "Set's down for the night"));
    card.appendChild(
      text(
        "p",
        "intro-copy",
        `${tally} Another day on the ridge, logged and quiet. Tomorrow the Slot will be ` +
          "watching back."
      )
    );
    card.appendChild(button("Replay the day", "btn primary", () => this.resetRun()));
    view.appendChild(card);
    this.root.appendChild(view);
  }

  private setScene(light: string, clock: string): void {
    this.clock = clock;
    this.elShack.className = `adventure ${light}`;
    this.elDay.textContent = `— ${light} · ${clock} —`;
  }

  /** Player keys a message: plays it as sidetone, bumps danger, then routes. */
  private async transmit(raw: string): Promise<void> {
    const msg = raw.trim().toUpperCase();
    if (!msg || this.playing || !this.txEnabled) return;
    this.elTxInput.value = "";
    this.txCount += 1;
    await this.playSelf(msg);

    const isAgn = msg.includes("AGN");
    const e = this.day[this.evtIx];

    // Every transmission to KEN must lead with proper addressing (KEN DE GOOSE).
    // Drop it and KEN doesn't know who's calling — real net discipline, and a real
    // Q-code for it: QRZ. Nudge, not a hard fail — resend with the preamble.
    if (!includesSequence(tokenizeWords(msg), [HQ_CALL, "DE", MY_CALL])) {
      await this.hqSend(`${MY_CALL} DE ${HQ_CALL} QRZ K`);
      this.setStatus(`${HQ_CALL} doesn't know who that was — lead with ${HQ_CALL} DE ${MY_CALL}.`);
      this.refresh();
      return;
    }

    if (this.phase === "sked" && e.kind === "sked" && this.evtIx === 0) {
      // First contact of the day: QSL and the authenticator reply must arrive together.
      // Token-based, not exact-string: tolerates real message variation (extra
      // spacing, surrounding prowords, either order) without needing AI judgment.
      const live = this.authTable[this.liveAuthIdx];
      const words = tokenizeWords(msg);
      const hasQsl = words.includes("QSL") || words.includes("R");
      const hasAuth = includesSequence(words, ["I", "AUTHENTICATE", live.response]);
      if (isAgn) {
        await this.hqSend(e.msg);
      } else if (hasQsl && hasAuth) {
        await this.advance();
      } else if (hasAuth) {
        this.setStatus("Authenticated — now add QSL to the same transmission to complete the sked.");
      } else if (hasQsl) {
        await this.hqSend(`${MY_CALL} DE ${HQ_CALL} AUTHENTICATE ${live.challenge} K`);
        this.setStatus(
          `${HQ_CALL} won't log that without authentication — send QSL I AUTHENTICATE <code>, together.`
        );
      } else {
        this.setStatus("Check the authenticator table, then send QSL I AUTHENTICATE <code>, or AGN? for a repeat.");
      }
    } else if (this.phase === "sked" && e.kind === "sked") {
      const words = tokenizeWords(msg);
      if (isAgn) await this.hqSend(e.msg);
      else if (words.includes("QSL") || words.includes("R")) {
        if (e.final) this.enterDone();
        else await this.advance();
      } else this.setStatus(`Send QSL to acknowledge ${HQ_CALL}, or AGN? for a repeat.`);
    } else if (this.phase === "spot" && e.kind === "spot") {
      if (isAgn) {
        this.addSpot(e.sighting.prose, "the boy repeats");
      } else {
        const tk = tokenize(msg);
        this.need = this.need.filter((f) => !fieldSatisfied(f, e.sighting, tk));
        if (this.need.length === 0) {
          await this.hqSend(SPOT_ACK);
          await this.advance();
        } else {
          // Directed answer-back: HQ asks for exactly what's still missing/wrong.
          await this.hqSend(`${MY_CALL} DE ${HQ_CALL} ${this.need.map((f) => PROWORD[f]).join(" ")} K`);
          this.setStatus(`${HQ_CALL} wants: ${this.need.map((f) => FIELD_LABEL[f]).join(", ")}. Send it.`);
        }
      }
    }
    this.refresh();
  }

  private get txEnabled(): boolean {
    return !this.playing && (this.phase === "sked" || this.phase === "spot");
  }

  // ---- Audio + log helpers ------------------------------------------------

  /** Play an inbound HQ message — but only if the dial is actually on today's freq.
   *  Off frequency you get static and a nudge back to the briefing; recover by
   *  tuning correctly and sending AGN?. Returns whether it came through. */
  private async hqSend(msg: string): Promise<boolean> {
    if (!this.onFreq) {
      const dialedAt = this.freqKhz;
      this.playing = true;
      this.addTraffic("log", "static — off frequency");
      this.setStatus(`Only static on ${this.freqKhz} kHz — nothing readable. Check the briefing and set the dial.`);
      this.refresh();
      await this.engine.playStatic(900);
      this.playing = false;
      this.refresh();
      // If the player kept tuning during the static, re-judge the new spot;
      // otherwise leave it at one burst rather than looping forever.
      if (this.freqKhz !== dialedAt) this.scheduleFreqSettle();
      return false;
    }
    this.playing = true;
    this.setStatus(`♪ ${HQ_CALL} is sending…`);
    this.refresh();
    this.addTraffic("ken", msg);
    await this.engine.primeOutput(300);
    await this.engine.playString(msg);
    this.playing = false;
    this.refresh();
    return true;
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

  private addTraffic(who: "ken" | "you" | "run" | "log", msg: string): void {
    this.traffic.push({ who, msg, clock: this.clock });
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
        const tag = e.who === "ken" ? HQ_CALL : e.who === "you" ? "YOU" : "RUNNER";
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

    this.elContinueBtn.hidden = this.phase !== "done";

    const cold = this.phase === "cold";
    this.elDials.classList.toggle("cold", cold);
    this.setKnobDisabled(cold);
    this.setPowerKnobDisabled(cold);

    const tx = this.txEnabled;
    this.elTxInput.disabled = !tx;
    this.elTxBtn.disabled = !tx;
    this.elTxRow.classList.toggle("flash", tx);

    this.elDanger.textContent = this.txCount
      ? `Transmissions: ${this.txCount} · Danger: low (this island)`
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

/** A rotary knob — drag (or arrow keys / wheel) to sweep `value` across
 *  [min, max] over a 270° arc, like a control on a real set. Snaps to
 *  `step` and fires `onChange` only when the value actually moves. */
function buildKnob(
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (v: number) => void,
  opts: { size?: "lg" | "sm"; ariaLabel?: string } = {}
): { el: HTMLElement; setDisabled: (disabled: boolean) => void } {
  const arc = 270; // sweep from -135° (min) to +135° (max)
  const half = arc / 2;
  let current = value;
  let disabled = false;

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

  function angleFor(v: number): number {
    return -half + ((v - min) / (max - min)) * arc;
  }
  function render(): void {
    pointer.style.transform = `translate(-50%, -100%) rotate(${angleFor(current)}deg)`;
    face.setAttribute("aria-valuenow", String(current));
  }
  function commit(v: number): void {
    const snapped = Math.min(max, Math.max(min, Math.round(v / step) * step));
    if (snapped === current) return;
    current = snapped;
    render();
    onChange(current);
  }
  function angleFromPointer(e: PointerEvent): number {
    const rect = face.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° = up, clockwise-positive
    return Math.min(half, Math.max(-half, deg));
  }
  function valueFromAngle(deg: number): number {
    return min + ((deg + half) / arc) * (max - min);
  }

  face.addEventListener("pointerdown", (e) => {
    if (disabled) return;
    e.preventDefault();
    face.focus();
    face.setPointerCapture(e.pointerId);
    face.classList.add("dragging");
    commit(valueFromAngle(angleFromPointer(e)));
  });
  face.addEventListener("pointermove", (e) => {
    if (!disabled && face.classList.contains("dragging")) commit(valueFromAngle(angleFromPointer(e)));
  });
  const endDrag = (e: PointerEvent) => {
    face.classList.remove("dragging");
    if (face.hasPointerCapture(e.pointerId)) face.releasePointerCapture(e.pointerId);
  };
  face.addEventListener("pointerup", endDrag);
  face.addEventListener("pointercancel", endDrag);
  face.addEventListener("keydown", (e) => {
    if (disabled) return;
    const big = step * 10;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      commit(current + step);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      commit(current - step);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      commit(current + big);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      commit(current - big);
    }
  });
  face.addEventListener(
    "wheel",
    (e) => {
      if (disabled) return;
      e.preventDefault();
      commit(current + (e.deltaY < 0 ? step : -step));
    },
    { passive: false }
  );

  function setDisabled(d: boolean): void {
    disabled = d;
    face.tabIndex = d ? -1 : 0;
    face.classList.toggle("knob-disabled", d);
  }

  render();
  return { el: wrap, setDisabled };
}
