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

import { MorseEngine } from "../audio/morse-engine";
import { loadSettings, Settings } from "../stats/storage";

const HQ_CALL = "KEN"; // net control (HQ)
const MY_CALL = "GOOSE"; // this station
const HQ_FREQ_KHZ = 4610; // the sked frequency that raises HQ
const FREQ_MIN = 4000;
const FREQ_MAX = 5200;
const ON_FREQ_KHZ = 15; // within this window, HQ is readable

const ORDERS = `${MY_CALL} DE ${HQ_CALL} WATCH SLOT RPT ALL SHIPPING ES ACFT K`;
const SPOT_ACK = `${MY_CALL} DE ${HQ_CALL} QSL K`; // HQ's ack of a completed report

// Exact demo text — see the "Kolombangara" worked example in MORSE-GAMES.md.
const BRIEFING =
  "STATION GOOSE — Kolombangara. Put ashore by the Minnow before dawn. OP on the " +
  "summit; watch Blackett Strait and the Slot. Report shipping and aircraft to HQ " +
  "(KEN) on 4610 kHz; skeds 0600 / 1200 / 1800. Minimum power — there's a DF launch " +
  "working these islands.";
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

function requiredFields(s: Sighting): string[] {
  return s.category === "ACFT" ? ["count", "type", "alt", "dir"] : ["count", "type", "dir"];
}
function tokenize(msg: string): Set<string> {
  return new Set(msg.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
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

function buildDay(): DayEvent[] {
  return [
    {
      kind: "sked",
      clock: "0600",
      light: "dawn",
      msg: ORDERS,
      prompt: "Copy your orders, then acknowledge (QSL) — or AGN? to hear them again.",
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
  private power = 3; // 1..10; low = quiet/faint, high = strong/exposed
  private txCount = 0;
  private showText = false; // "plot mode": reveal inbound HQ traffic as text
  private clock = "—";
  private traffic: { who: "ken" | "you" | "run" | "log"; msg: string; clock: string }[] = [];
  private day: DayEvent[] = [];
  private evtIx = 0;
  private need: string[] = []; // report fields still outstanding for the current spot

  // element refs
  private elShack!: HTMLElement;
  private elStatus!: HTMLElement;
  private elDay!: HTMLElement;
  private elFreqOut!: HTMLElement;
  private elPowerOut!: HTMLElement;
  private elNotesFeed!: HTMLElement;
  private elTraffic!: HTMLElement;
  private elDanger!: HTMLElement;
  private elStartBtn!: HTMLButtonElement;
  private elSkedBtn!: HTMLButtonElement;
  private elShowTextBtn!: HTMLButtonElement;
  private elTxRow!: HTMLElement;
  private elTxInput!: HTMLInputElement;
  private elTxBtn!: HTMLButtonElement;
  private elAgnBtn!: HTMLButtonElement;
  private elQslBtn!: HTMLButtonElement;

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
    this.root.innerHTML = "";
    this.day = buildDay(); // this run's mix of skeds + generated sightings
    this.elShack = el("section", "adventure dawn");
    this.elShack.append(
      this.buildBriefing(),
      this.buildNotepad(),
      this.buildRadio(),
      this.buildCodebook()
    );
    this.root.appendChild(this.elShack);
    this.refresh();
  }

  unmount(): void {
    this.engine.stop();
  }

  // ---- Quadrants ----------------------------------------------------------

  private buildBriefing(): HTMLElement {
    const panel = el("div", "shack-panel shack-briefing");
    panel.appendChild(text("h2", "shack-title", "Station GOOSE — Kolombangara"));
    panel.appendChild(text("div", "shack-label", "Briefing"));
    panel.appendChild(text("p", "brief", BRIEFING));
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

    // Frequency dial
    const freqRow = el("div", "dial-row");
    freqRow.appendChild(text("span", "dial-name", "Frequency"));
    const freq = rangeInput(FREQ_MIN, FREQ_MAX, 5, this.freqKhz, (v) => {
      this.freqKhz = v;
      this.refresh();
    });
    this.elFreqOut = text("span", "dial-value", "");
    freqRow.append(freq, this.elFreqOut);
    panel.appendChild(freqRow);

    // Power dial
    const powRow = el("div", "dial-row");
    powRow.appendChild(text("span", "dial-name", "Power"));
    const pow = rangeInput(1, 10, 1, this.power, (v) => {
      this.power = v;
      this.refresh();
    });
    this.elPowerOut = text("span", "dial-value", "");
    powRow.append(pow, this.elPowerOut);
    panel.appendChild(powRow);

    // Controls
    const controls = el("div", "shack-controls");
    this.elStartBtn = button("⏻ Warm up the set", "btn primary", () => void this.start());
    this.elSkedBtn = button("♪ Take the 0600 sked", "btn", () => void this.receiveSked());
    this.elSkedBtn.disabled = true;
    this.elShowTextBtn = button("Show Text: Off", "btn ghost", () => this.toggleText());
    controls.append(this.elStartBtn, this.elSkedBtn, this.elShowTextBtn);
    panel.appendChild(controls);

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
        void this.transmit(this.elTxInput.value);
      }
    });
    this.elTxBtn = button("▶ Transmit", "btn", () => void this.transmit(this.elTxInput.value));
    this.elAgnBtn = button("AGN?", "btn ghost", () => void this.transmit("AGN?"));
    this.elQslBtn = button("QSL", "btn ghost", () => void this.transmit("QSL"));
    this.elTxRow.append(this.elTxInput, this.elTxBtn, this.elAgnBtn, this.elQslBtn);
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

    const groups: { title: string; entries: [string, string][] }[] = [
      {
        title: "Callsigns & dial",
        entries: [
          ["4610", `${HQ_CALL} — day sked (kHz)`],
          [HQ_CALL, "HQ / net control"],
          [MY_CALL, "you (this station)"],
        ],
      },
      {
        title: "Prowords",
        entries: [
          ["DE", "this is / from"],
          ["K", "over / go ahead"],
          ["RPT", "report"],
          ["ES", "and"],
          ["AGN", "say again"],
          ["QSL", "acknowledged"],
          ["QRT", "shut down / go silent"],
          ["QRU", "nothing heard / anything for me?"],
          ["TU", "thanks"],
          ["GN", "good night"],
        ],
      },
      {
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

    for (const g of groups) {
      panel.appendChild(text("div", "code-group", g.title));
      const grid = el("div", "codebook");
      for (const [k, v] of g.entries) {
        const row = el("div", "codebook-row");
        row.append(text("span", "code-k", k), text("span", "code-v", v));
        grid.appendChild(row);
      }
      panel.appendChild(grid);
    }
    return panel;
  }

  // ---- Beat driver --------------------------------------------------------

  private get onFreq(): boolean {
    return Math.abs(this.freqKhz - HQ_FREQ_KHZ) <= ON_FREQ_KHZ;
  }

  private async start(): Promise<void> {
    await this.engine.resume();
    this.elStartBtn.disabled = true;
    this.elStartBtn.textContent = "⏻ Set warmed up";
    this.setStatus("The set hums to life…");
    await this.engine.playPowerHum();
    this.phase = "onair";
    this.setScene("dawn", "0600");
    this.setStatus(`Set's warm. Tune to ${HQ_CALL} on ${HQ_FREQ_KHZ} kHz, then take the 0600 sked.`);
    this.refresh();
  }

  /** The player deliberately guards the 0600 sked (event 0) after tuning. */
  private async receiveSked(): Promise<void> {
    if (this.phase !== "onair" || this.evtIx !== 0 || this.playing) return;
    const e = this.day[0];
    if (e.kind !== "sked") return;
    this.setScene(e.light, e.clock);
    // No "on frequency" hint: the briefing says 4610. Off the dial you get static
    // and stay put; tune it right and the sked comes through.
    if (await this.hqSend(e.msg)) {
      this.phase = "sked";
      this.setStatus(e.prompt);
    }
    this.refresh();
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

    if (this.phase === "sked" && e.kind === "sked") {
      if (isAgn) await this.hqSend(e.msg);
      else if (msg.includes("QSL") || msg === "R") {
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

  /** Play an inbound HQ message — but only if the dial is actually on 4610.
   *  Off frequency you get static and a nudge back to the briefing; recover by
   *  tuning correctly and sending AGN?. Returns whether it came through. */
  private async hqSend(msg: string): Promise<boolean> {
    if (!this.onFreq) {
      this.playing = true;
      this.addTraffic("log", "static — off frequency");
      this.setStatus(`Only static on ${this.freqKhz} kHz — nothing readable. Check the briefing and set the dial.`);
      this.refresh();
      await this.engine.playStatic(900);
      this.playing = false;
      this.refresh();
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

  private setStatus(s: string): void {
    this.elStatus.textContent = s;
  }

  private refresh(): void {
    this.elFreqOut.textContent = `${this.freqKhz} kHz`;
    this.elPowerOut.textContent =
      this.power <= 3
        ? `${this.power} — faint, but quiet`
        : this.power >= 8
          ? `${this.power} — strong, but the DF will hear you`
          : `${this.power}`;

    this.elSkedBtn.disabled = !(this.phase === "onair" && this.evtIx === 0 && !this.playing);

    const tx = this.txEnabled;
    this.elTxInput.disabled = !tx;
    this.elTxBtn.disabled = !tx;
    this.elAgnBtn.disabled = !tx;
    this.elQslBtn.disabled = !tx;
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

function rangeInput(
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => onInput(Number(input.value)));
  return input;
}
