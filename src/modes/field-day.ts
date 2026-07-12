// Field Day contest mode: a compressed "Run" style contest — call CQ, work
// callers, copy their exchange, log it. See PROJECT-PLAN.md's "Real contest mode"
// section for the full design; this is the first prototype (Field Day only, no
// Search & Pounce dial-hunting or waterfall yet — see the plan this was built from).
//
// Deliberately reuses Adventure mode's infrastructure rather than inventing new
// mechanics: the dialogue engine (src/dialogue/) for grading exchanges, and the
// same "play your own transmission back as sidetone, then process it" pattern as
// adventure.ts's transmit()/playSelf(). One real difference from Adventure: there's
// no single fixed correspondent — a new caller is generated every QSO, so "current
// caller" lives in mutable Ctx state rather than a module constant.

import { MorseEngine } from "../audio/morse-engine";
import { loadSettings, saveSettings, Settings } from "../stats/storage";
import { Rule, respond } from "../dialogue/engine";
import { tokenizeWords } from "../dialogue/tokens";

// ---- Station identity (hardcoded for this prototype — seeds the real Station
// Profile feature described in PROJECT-PLAN.md without building it yet) ----------
const MY_CALL = "AB7HP";
const MY_CLASS = "3A";
const MY_SECTION = "ID";

const CALLER_DELAY_MS = 1400; // beat before a caller answers CQ / sends their exchange
const LEAD_IN_MS = 300;

// Frequency dial — real controls, same tuning mechanic as Adventure mode (a fixed
// target + an on-frequency window; off-frequency reads as static). No Search & Pounce
// hunting-across-the-band yet — that's still explicitly deferred — this just gates
// "did you find the available frequency," checked once per CQ. Field Day doesn't
// hand out assigned frequencies the way a formal band plan does — you just find a
// clear spot and operate there — so it's framed as "available," not "assigned."
//
// Range is the real 20m CW/data sub-band shared by General/Advanced/Extra
// (14.000-14.025 is Extra-exclusive — camping there would shut out General-class
// callers, so a frequency meant to work anyone starts above it) up to where phone
// (voice) takes over at 14.150, which a CW station would never operate in.
const FREQ_MIN = 14025;
const FREQ_MAX = 14150;
const ON_FREQ_KHZ = 5;

// ---- Callsign / exchange generators ----------------------------------------

const PREFIX_FIRST = ["A", "K", "N", "W"]; // the entire real US allocation
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FIELD_DAY_CLASS_LETTERS = ["A", "B", "C", "D", "E", "F"];
// A representative subset of real ARRL/RAC sections, not the full official ~80.
const ARRL_SECTIONS = [
  "ID", "OR", "WA", "MT", "WY", "CO", "UT", "NV", "AZ", "NM",
  "CA", "TX", "OK", "KS", "NE", "MN", "WI", "IL", "OH", "GA",
  "NC", "VA", "PA", "NY", "MA", "ME",
];

type CallFormat = "2x3" | "2x2" | "2x1" | "1x1";
// Weighted so entry-level (2x3) is common and special-event (1x1) is rare, matching
// how these formats actually distribute among real US amateur licensees.
const CALL_FORMAT_POOL: CallFormat[] = [
  "2x3", "2x3", "2x3", "2x3", "2x3",
  "2x2", "2x2", "2x2",
  "2x1", "2x1",
  "1x1",
];

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
function randLetter(): string {
  return LETTERS[randInt(0, 25)];
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCallsign(): string {
  const first = pick(PREFIX_FIRST);
  const digit = String(randInt(0, 9));
  switch (pick(CALL_FORMAT_POOL)) {
    case "1x1":
      return `${first}${digit}${randLetter()}`;
    case "2x1":
      return `${first}${randLetter()}${digit}${randLetter()}`;
    case "2x2":
      return `${first}${randLetter()}${digit}${randLetter()}${randLetter()}`;
    case "2x3":
      return `${first}${randLetter()}${digit}${randLetter()}${randLetter()}${randLetter()}`;
  }
}

function makeClass(): string {
  return `${randInt(1, 20)}${pick(FIELD_DAY_CLASS_LETTERS)}`;
}

interface Caller {
  callsign: string;
  cls: string;
  section: string;
}

function makeCaller(): Caller {
  return { callsign: makeCallsign(), cls: makeClass(), section: pick(ARRL_SECTIONS) };
}

interface LogEntry {
  callsign: string;
  cls: string;
  section: string;
  dupe: boolean;
}

// ---- Dialogue rules ---------------------------------------------------------

type Phase = "cq" | "logging";

interface FieldDayInput {
  msg: string;
  words: string[];
}

/** CQ opens a fresh calling period; QRZ solicits the next caller once you already
 *  hold the frequency. Both are valid ways to invite an answer — see the "cq" rule. */
function isSolicit(i: FieldDayInput): boolean {
  return i.words.includes("CQ") || i.words.includes("QRZ");
}

export class FieldDayMode {
  private root: HTMLElement;
  private settings: Settings;
  private engine: MorseEngine;

  private running = false;
  private sending = false; // your own transmission is playing back — input+button both locked
  private receiving = false; // a caller's transmission is playing — input stays open as a scratchpad, button locked
  private phase: Phase = "cq";
  private caller: Caller = makeCaller();

  private freqKhz = 14000; // dial position; starts off the contest frequency on purpose
  private contestFreqKhz = 14000; // generated fresh each session, like Adventure's hqFreqKhz
  private power = 50; // 0-100; flavor + a status hint for now, no scoring consequence yet

  private qsoCount = 0;
  private score = 0;
  private log: LogEntry[] = [];
  private workedCalls = new Set<string>();
  private workedSections = new Set<string>();
  private sessionStartAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // element refs
  private showText = false; // "plot mode" — same toggle/default as Adventure mode
  // `tag` is captured at send time (not derived from `this.caller` at render time) —
  // the caller changes every QSO, so a stale row must keep the callsign it was
  // actually sent under, not whoever's calling now.
  private traffic: { who: "you" | "caller" | "log"; msg: string; tag: string }[] = [];

  private elAvailableFreq!: HTMLElement;
  private elStatus!: HTMLElement;
  private elTxInput!: HTMLInputElement;
  private elTxBtn!: HTMLButtonElement;
  private elTraffic!: HTMLElement;
  private elShowTextBtn!: HTMLButtonElement;
  private elDials!: HTMLElement;
  private elFreqOut!: HTMLElement;
  private elPowerOut!: HTMLElement;
  private setKnobDisabled!: (disabled: boolean) => void;
  private setPowerKnobDisabled!: (disabled: boolean) => void;
  private elLogBody!: HTMLElement;
  private elScore!: HTMLElement;
  private elRate!: HTMLElement;
  private elQsos!: HTMLElement;
  private elMults!: HTMLElement;
  private elTimeElapsed!: HTMLElement;
  private elStartBtn!: HTMLButtonElement;

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
    this.root.appendChild(this.buildSettingsPanel());
    this.root.appendChild(this.buildHud());
    this.root.appendChild(this.buildRadio());
    this.root.appendChild(this.buildLog());
    this.refreshHud();
  }

  unmount(): void {
    this.stop();
  }

  // ---- DOM construction -----------------------------------------------------

  private buildSettingsPanel(): HTMLElement {
    const panel = el("section", "settings");
    const charWpm = this.numberField("Character speed (WPM)", this.settings.charWpm, 10, 40, (v) => {
      this.settings.charWpm = v;
      if (this.settings.effectiveWpm > v) this.settings.effectiveWpm = v;
      this.applySettings();
    });
    const effWpm = this.numberField("Effective / Farnsworth (WPM)", this.settings.effectiveWpm, 5, 40, (v) => {
      this.settings.effectiveWpm = Math.min(v, this.settings.charWpm);
      this.applySettings();
    });
    const freq = this.numberField("Tone (Hz)", this.settings.frequencyHz, 400, 1000, (v) => {
      this.settings.frequencyHz = v;
      this.applySettings();
    });
    panel.append(charWpm, effWpm, freq);
    return panel;
  }

  private numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void
  ): HTMLElement {
    const wrap = el("label", "field");
    wrap.appendChild(text("span", "field-label", label));
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener("change", () => {
      let v = Number(input.value);
      if (Number.isNaN(v)) v = value;
      v = Math.max(min, Math.min(max, v));
      input.value = String(v);
      onChange(v);
    });
    wrap.appendChild(input);
    return wrap;
  }

  private buildHud(): HTMLElement {
    const hud = el("section", "hud");
    this.elScore = stat(hud, "Score", "0");
    this.elRate = stat(hud, "Rate/hr", "—");
    this.elQsos = stat(hud, "QSOs", "0");
    this.elMults = stat(hud, "Mults", "0");
    this.elTimeElapsed = stat(hud, "Time elapsed", "0:00");
    return hud;
  }

  /** Same panel shape/interaction language as Adventure mode's buildRadio(): a
   *  labeled head, a status line as the "prompt," a controls row, the frequency +
   *  TX-power dials (the exact buildKnob() encoder component, copied verbatim —
   *  see the note above it), the transmit row, and the traffic feed. */
  private buildRadio(): HTMLElement {
    const panel = el("div", "shack-panel shack-radio");
    const head = el("div", "shack-label");
    head.textContent = "The rig";
    head.appendChild(text("span", "day-label", `${MY_CALL} ${MY_CLASS} ${MY_SECTION}`));
    panel.appendChild(head);

    // The whole point of Run-style contesting is that you pick an available
    // frequency and camp on it, not discover one by hunting (that's Search &
    // Pounce, still deferred) — so it has to be told to the player plainly, the
    // same way Adventure's Briefing panel states the sked frequency in text
    // rather than making you find it blind. Field Day doesn't hand out assigned
    // frequencies the way a formal band plan does, so "available," not "assigned."
    this.elAvailableFreq = text("div", "brief", "Available frequency: power up to get one.");
    panel.appendChild(this.elAvailableFreq);

    this.elStatus = text("div", "shack-status", "Power up, then send CQ.");
    panel.appendChild(this.elStatus);

    const controls = el("div", "shack-controls");
    // Same power-button mechanic as Adventure mode: a pulsing invite to power on,
    // solid when running, rather than a plain Start/Stop label.
    this.elStartBtn = button("⏻", "btn primary btn-power power-glow", () => {
      if (this.running) this.stop();
      else void this.start();
    });
    this.elStartBtn.setAttribute("aria-label", "Power");
    this.elStartBtn.title = "Power on the rig";
    this.elShowTextBtn = button("Show Text: Off", "btn ghost", () => this.toggleText());
    controls.append(this.elStartBtn, this.elShowTextBtn);
    panel.appendChild(controls);

    this.elDials = el("div", "shack-dials cold");
    // dials-row--spread: Contest's radio panel is a standalone, narrower panel (not
    // one of Adventure's wide 4-column quadrants), so the base .dials-row's fixed
    // gap leaves the power knob sitting wherever the frequency row's width happens
    // to end rather than anchored to anything — push it to the panel's right edge
    // instead, scoped here so Adventure's already-tuned layout is untouched.
    const dialsRow = el("div", "dials-row dials-row--spread");

    const freqRow = el("div", "knob-row");
    const { el: freqKnobEl, setDisabled: setKnobDisabled } = buildKnob(
      FREQ_MIN,
      FREQ_MAX,
      5,
      this.freqKhz,
      (v) => {
        this.freqKhz = v;
        this.refreshDialReadouts();
      },
      { size: "lg", ariaLabel: "Frequency" }
    );
    this.setKnobDisabled = setKnobDisabled;
    const freqReadout = el("div", "knob-readout");
    freqReadout.appendChild(text("span", "dial-name", "Frequency"));
    // Deliberately omitting the "dial-value" class here — it carries a fixed
    // width: 16rem left over from an older label+value+slider layout elsewhere,
    // which forces this readout far wider than "14,xxx kHz" needs and was what
    // pushed the power knob past the panel's edge. "knob-value" alone already
    // gives the right font styling with no forced width.
    this.elFreqOut = text("div", "knob-value", "");
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
        this.setStatus(this.powerHint(v));
        this.refreshDialReadouts();
      },
      { size: "sm", ariaLabel: "TX Power" }
    );
    this.setPowerKnobDisabled = setPowerKnobDisabled;
    const powReadout = el("div", "knob-readout knob-readout--right");
    powReadout.appendChild(text("span", "dial-name", "TX Power"));
    this.elPowerOut = text("div", "knob-value", "");
    powReadout.appendChild(this.elPowerOut);
    powRow.append(powReadout, powKnobEl);
    dialsRow.appendChild(powRow);

    this.elDials.appendChild(dialsRow);
    panel.appendChild(this.elDials);
    // Match the "cold" visual: keyboard focus/interaction disabled too, not just
    // dimmed — start()/stop() flip this as the session runs.
    this.setKnobDisabled(true);
    this.setPowerKnobDisabled(true);

    this.elTxInput = document.createElement("input");
    this.elTxInput.type = "text";
    this.elTxInput.className = "tx-input";
    this.elTxInput.spellcheck = false;
    this.elTxInput.placeholder = "key your transmission…";
    this.elTxInput.disabled = true;
    this.elTxInput.addEventListener("keydown", this.onInputKey);
    this.elTxBtn = button("▶ Transmit", "btn", () => void this.transmit(this.elTxInput.value));
    this.elTxBtn.disabled = true;
    const txRow = el("div", "tx-row");
    txRow.append(this.elTxInput, this.elTxBtn);
    panel.appendChild(txRow);

    panel.appendChild(text("p", "hint", "Enter = send/log · Esc = end session"));

    this.elTraffic = el("div", "traffic");
    panel.appendChild(this.elTraffic);

    this.refreshDialReadouts();
    return panel;
  }

  /** Live commentary on TX power — flavor + a hint for now, no scoring consequence
   *  (Field Day has no DF/stealth mechanic the way Adventure's power dial does). */
  private powerHint(watts: number): string {
    if (watts <= 20) return "Weak — the other station may need a repeat.";
    if (watts >= 85) return "Plenty of power — no need to run more for Field Day.";
    return "Good, solid copy.";
  }

  private refreshDialReadouts(): void {
    this.elFreqOut.textContent = `${this.freqKhz} kHz`;
    this.elPowerOut.textContent = `${this.power} W`;
  }

  private buildLog(): HTMLElement {
    const panel = el("section", "stage");
    panel.appendChild(text("div", "heatmap-title", "Log"));
    const table = el("div", "log-table");
    const head = el("div", "log-row log-row--head");
    head.append(text("span", "", "Call"), text("span", "", "Class"), text("span", "", "Section"));
    table.appendChild(head);
    this.elLogBody = el("div", "log-body");
    table.appendChild(this.elLogBody);
    panel.appendChild(table);
    return panel;
  }

  // ---- Session control --------------------------------------------------------

  private applySettings(): void {
    this.engine.settings = {
      charWpm: this.settings.charWpm,
      effectiveWpm: this.settings.effectiveWpm,
      frequencyHz: this.settings.frequencyHz,
    };
    saveSettings(this.settings);
  }

  private async start(): Promise<void> {
    await this.engine.resume();
    this.running = true;
    this.phase = "cq";
    this.caller = makeCaller();
    this.qsoCount = 0;
    this.score = 0;
    this.log = [];
    this.workedCalls.clear();
    this.workedSections.clear();
    this.traffic = [];
    // Generated fresh each session, like Adventure's hqFreqKhz — the dial starts off
    // this frequency on purpose, so finding it is the first thing you do.
    this.contestFreqKhz = FREQ_MIN + 5 * randInt(0, (FREQ_MAX - FREQ_MIN) / 5);
    this.freqKhz = FREQ_MIN;
    this.elAvailableFreq.textContent = `Available frequency: ${this.contestFreqKhz} kHz — tune the dial to it.`;
    this.sessionStartAt = performance.now();
    this.elStartBtn.classList.remove("power-glow");
    this.elStartBtn.classList.add("power-on");
    this.elDials.classList.remove("cold");
    this.setKnobDisabled(false);
    this.setPowerKnobDisabled(false);
    this.refreshDialReadouts();
    this.elTxInput.disabled = false;
    this.elTxInput.value = "";
    this.elTxInput.focus();
    this.elLogBody.innerHTML = "";
    this.renderTraffic();
    this.setStatus("On the air — tune to the available frequency, then send CQ.");
    this.refreshHud();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  private get onFreq(): boolean {
    return Math.abs(this.freqKhz - this.contestFreqKhz) <= ON_FREQ_KHZ;
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.sending = false;
    this.receiving = false;
    this.engine.stop();
    this.elDials.classList.add("cold");
    this.setKnobDisabled(true);
    this.setPowerKnobDisabled(true);
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.elStartBtn.classList.remove("power-on");
    this.elStartBtn.classList.add("power-glow");
    this.elTxInput.disabled = true;
    this.showSummary();
  }

  private tick(): void {
    if (!this.running) return;
    this.elTimeElapsed.textContent = formatClock(performance.now() - this.sessionStartAt);
  }

  private onInputKey = (e: KeyboardEvent): void => {
    if (!this.running) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.stop();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void this.transmit(this.elTxInput.value);
    }
  };

  /** Player keys a message: plays it as sidetone (same pattern as Adventure mode's
   *  transmit()/playSelf()), then routes it through the dialogue engine's rule table. */
  private async transmit(raw: string): Promise<void> {
    const msg = raw.trim().toUpperCase();
    if (!msg || this.sending || this.receiving || !this.running) return;
    this.elTxInput.value = "";
    this.addTraffic("you", msg);
    this.sending = true;
    this.refreshTxEnabled();
    await this.engine.primeOutput(LEAD_IN_MS);
    await this.engine.playString(msg);
    this.sending = false;
    this.refreshTxEnabled();

    const input: FieldDayInput = { msg, words: tokenizeWords(msg) };
    await respond(FieldDayMode.RULES, input, this);
  }

  /** Play a caller's transmission (their callsign, or their exchange) as audio.
   *  Keeps the TX input open the whole time — real operators copy onto paper
   *  while the code is still coming in, so it doubles as a scratchpad — but the
   *  Transmit button stays locked until the incoming signal actually finishes;
   *  keying over someone still sending isn't something a real radio lets you do
   *  cleanly either. */
  private async callerSend(msg: string): Promise<void> {
    this.addTraffic("caller", msg);
    this.receiving = true;
    this.refreshTxEnabled();
    await this.engine.primeOutput(300);
    await this.engine.playString(msg);
    this.receiving = false;
    this.refreshTxEnabled();
  }

  private refreshTxEnabled(): void {
    const inputEnabled = this.running && !this.sending;
    const txEnabled = this.running && !this.sending && !this.receiving;
    this.elTxInput.disabled = !inputEnabled;
    this.elTxBtn.disabled = !txEnabled;
    // Disabling an element steals its focus and re-enabling doesn't restore it —
    // reclaim it so the player can keep typing/pressing Escape without re-clicking.
    if (inputEnabled) this.elTxInput.focus();
  }

  // ---- Dialogue rules ---------------------------------------------------------

  private static isCq(ctx: FieldDayMode): boolean {
    return ctx.phase === "cq";
  }
  private static isLogging(ctx: FieldDayMode): boolean {
    return ctx.phase === "logging";
  }

  private static readonly RULES: Rule<FieldDayInput, FieldDayMode>[] = [
    {
      id: "cq-off-freq",
      when: FieldDayMode.isCq,
      match: (i, ctx) => isSolicit(i) && !ctx.onFreq,
      act: async (_i, ctx) => {
        ctx.setStatus(`Only static on ${ctx.freqKhz} kHz — no one's going to hear that. Find the available frequency.`);
        await ctx.engine.playStatic(700);
      },
    },
    {
      id: "cq",
      when: FieldDayMode.isCq,
      // CQ opens a fresh calling period; QRZ ("who's calling me?") is the real
      // convention for soliciting the next caller once you already hold the
      // frequency — both work here, matching how a real running station alternates
      // between them.
      match: (i) => isSolicit(i),
      act: async (_i, ctx) => {
        ctx.phase = "logging";
        ctx.setStatus("Someone's answering your CQ…");
        await delay(CALLER_DELAY_MS);
        if (!ctx.running) return;
        // Real Field Day convention: the caller gives their whole exchange
        // unprompted right after your CQ — callsign, class, section, one
        // transmission — not just their call first. See the plan this was
        // corrected from for the researched example this mirrors.
        await ctx.callerSend(`${ctx.caller.callsign} ${ctx.caller.cls} ${ctx.caller.section}`);
        if (!ctx.running) return;
        // Status only reveals the exchange in cleartext when Show Text is on —
        // same masking convention as the traffic feed; otherwise it'd leak the
        // answer regardless of the toggle.
        ctx.setStatus(
          ctx.showText
            ? `${ctx.caller.callsign} sent ${ctx.caller.cls} ${ctx.caller.section} — repeat their call, TU, and your exchange to log it.`
            : "Copy their call, class, and section, then repeat their call + TU + your exchange to log it."
        );
      },
    },
    {
      id: "cq-nudge",
      when: FieldDayMode.isCq,
      match: () => true,
      act: (_i, ctx) => ctx.setStatus("Send CQ (or QRZ) to solicit a caller."),
    },
    {
      id: "log-complete",
      when: FieldDayMode.isLogging,
      match: (i, ctx) =>
        i.words.includes(ctx.caller.callsign) &&
        i.words.includes(MY_CALL) &&
        i.words.includes(MY_CLASS) &&
        i.words.includes(MY_SECTION),
      act: async (_i, ctx) => {
        const workedCallsign = ctx.caller.callsign;
        ctx.logQso();
        await delay(300);
        if (!ctx.running) return;
        // Closing flourish, not graded — sent (and tagged in the traffic feed)
        // against the caller just worked, *before* rotating to the next one.
        await ctx.callerSend(`R ${workedCallsign} TU`);
        if (!ctx.running) return;
        ctx.phase = "cq";
        ctx.caller = makeCaller();
        ctx.setStatus("Send CQ for the next one.");
      },
    },
    {
      id: "log-missing",
      when: FieldDayMode.isLogging,
      match: () => true,
      act: (i, ctx) => {
        const missing: string[] = [];
        if (!i.words.includes(ctx.caller.callsign)) missing.push("their call");
        if (!i.words.includes(MY_CALL)) missing.push("your call");
        if (!i.words.includes(MY_CLASS)) missing.push("your class");
        if (!i.words.includes(MY_SECTION)) missing.push("your section");
        ctx.setStatus(`Still missing: ${missing.join(", ")}.`);
      },
    },
  ];

  /** Grade succeeded: log the QSO, score it (dupes log but score 0), reset for the
   *  next caller. This *is* the "log" action — there's no separate log form, sending
   *  back what you copied is what logs it, matching the single-TX-box interaction
   *  language the rest of the app already uses. */
  private logQso(): void {
    const dupe = this.workedCalls.has(this.caller.callsign);
    if (!dupe) {
      this.workedCalls.add(this.caller.callsign);
      this.workedSections.add(this.caller.section);
      this.qsoCount += 1;
      this.score = this.qsoCount * this.workedSections.size;
    }
    this.log.unshift({ callsign: this.caller.callsign, cls: this.caller.cls, section: this.caller.section, dupe });
    this.appendLogRow(this.log[0]);
    this.setStatus(
      dupe
        ? `Logged — DUPE, ${this.caller.callsign} already worked (no points).`
        : `Logged! ${this.caller.callsign} ${this.caller.cls} ${this.caller.section}.`
    );
    this.refreshHud();
    // Phase/caller rotation deliberately NOT done here — the "log-complete" rule
    // sends a closing flourish (tagged with *this* caller) before rotating to the
    // next one, so doing it here would relabel that flourish in the traffic feed.
  }

  private appendLogRow(entry: LogEntry): void {
    const row = el("div", `log-row${entry.dupe ? " log-row--dupe" : ""}`);
    row.append(
      text("span", "", entry.callsign),
      text("span", "", entry.cls),
      text("span", "", entry.section)
    );
    this.elLogBody.prepend(row);
  }

  private setStatus(s: string): void {
    this.elStatus.textContent = s;
  }

  private addTraffic(who: "you" | "caller" | "log", msg: string): void {
    const tag = who === "caller" ? this.caller.callsign : "YOU";
    this.traffic.push({ who, msg, tag });
    this.renderTraffic();
  }

  /** Rebuild the traffic feed. Inbound caller traffic is masked unless "Show Text"
   *  (plot mode) is on — same convention as Adventure mode — your own sends are
   *  always visible since you typed them yourself. */
  private renderTraffic(): void {
    this.elTraffic.innerHTML = "";
    for (const e of this.traffic) {
      const row = el("div", "traffic-row");
      if (e.who === "log") {
        row.classList.add("who-log");
        row.textContent = `— ${e.msg} —`;
      } else {
        row.append(text("span", e.who === "caller" ? "who-ken" : "who-you", `${e.tag}: `));
        const masked = e.who === "caller" && !this.showText;
        row.appendChild(document.createTextNode(masked ? "♪ · — · ·  (Show Text to read it)" : e.msg));
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

  private elapsedMinutes(): number {
    return (performance.now() - this.sessionStartAt) / 60000;
  }

  private refreshHud(): void {
    this.elScore.textContent = String(this.score);
    this.elQsos.textContent = String(this.qsoCount);
    this.elMults.textContent = String(this.workedSections.size);
    const elapsedMin = this.elapsedMinutes();
    this.elRate.textContent = elapsedMin > 0.05 ? String(Math.round(this.qsoCount / (elapsedMin / 60))) : "—";
  }

  private showSummary(): void {
    const modal = new Modal("Session summary", "");
    const body = el("div", "summary");
    const elapsedMin = this.elapsedMinutes();
    body.appendChild(summaryRow("Time on the air", formatClock(performance.now() - this.sessionStartAt)));
    body.appendChild(summaryRow("Final score", String(this.score)));
    body.appendChild(summaryRow("Score / minute", elapsedMin > 0.05 ? (this.score / elapsedMin).toFixed(1) : "—"));
    body.appendChild(summaryRow("QSOs worked", String(this.qsoCount)));
    body.appendChild(summaryRow("Section multipliers", String(this.workedSections.size)));
    const dupeCount = this.log.filter((e) => e.dupe).length;
    body.appendChild(summaryRow("Dupes logged", String(dupeCount)));
    modal.setBodyNode(body);
    modal.addButton("Close", "primary", () => modal.close());
    modal.open();
  }
}

// ---- Small DOM utilities ----------------------------------------------------

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

function stat(parent: HTMLElement, label: string, value: string): HTMLElement {
  const wrap = el("div", "stat");
  wrap.appendChild(text("div", "stat-label", label));
  const v = text("div", "stat-value", value);
  wrap.appendChild(v);
  parent.appendChild(wrap);
  return v;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---- Rotary knob (copied verbatim from adventure.ts's buildKnob() — same encoder
// feel, same code, kept as a per-file duplicate per this project's established
// small-duplication-over-shared-module convention for these mode files) -----------

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

function summaryRow(label: string, value: string): HTMLElement {
  const row = el("div", "summary-row");
  row.appendChild(text("span", "summary-label", label));
  row.appendChild(text("span", "summary-value", value));
  return row;
}

// ---- Minimal modal (same small local pattern as random-run.ts/word-wrangler.ts) --

class Modal {
  private overlay: HTMLElement;
  private footer: HTMLElement;

  constructor(title: string, body: string) {
    this.overlay = el("div", "modal-overlay");
    const box = el("div", "modal");
    box.appendChild(text("h2", "modal-title", title));
    if (body) {
      const p = el("div", "modal-body");
      p.textContent = body;
      box.appendChild(p);
    }
    this.footer = el("div", "modal-footer");
    box.appendChild(this.footer);
    this.overlay.appendChild(box);
  }

  setBodyNode(node: HTMLElement): void {
    node.classList.add("modal-body");
    this.footer.before(node);
  }

  addButton(label: string, variant: string, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.className = `btn ${variant}`.trim();
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    this.footer.appendChild(btn);
  }

  open(): void {
    document.body.appendChild(this.overlay);
  }

  close(): void {
    this.overlay.remove();
  }
}
