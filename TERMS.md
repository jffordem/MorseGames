# Morse Games — Terms of Use & Disclaimer

**Status: DRAFT — pending legal review. Wired into the app (2026-07-16)** as a
first-visit modal (`src/terms.ts`, gated on `localStorage["morse-games.termsAcknowledged"]`),
a "Send Feedback" `mailto:` link + caption, and a "Terms & Disclaimer" button — both in
`index.html`'s footer (moved there from the header the same day) — that reopens the
same modal on demand, jumping straight to the full text via `openTermsModal()`, for
anyone who wants to review it again later. Two things still need a real decision
before public launch:
- The feedback address is currently a placeholder (`feedback@example.com`, marked
  with a `TODO` comment in `index.html`) — swap in the real dedicated address.
- §8 (governing law) is still blank, as originally noted below.

This is a two-part draft: a short version meant for a first-visit popup, and a fuller
version that popup would link to. Written for a free, no-login, no-data-collection hobby
project — see `PROJECT-PLAN.md`'s "Deployment & hosting" section for the underlying
architecture/privacy constraints this text is describing.

---

## Part 1 — First-visit modal (short version)

**Before you start**

Morse Games is a free, hobby ham-radio training tool. By continuing, you agree to the
following:

- This app is provided "as is," with no warranties of any kind, and used at your own risk.
- No account, no login, no personal information is collected — nothing you do here is
  sent anywhere. All settings and progress are stored only in your own browser.
- Some training modes ("Adventure") include fictionalized WWII-era historical content —
  nothing graphic, but it does reference wartime events.
- If you have photosensitive epilepsy, consult a physician before use.

*[Read the full Terms & Disclaimer]* · **[I Understand — Continue]**

---

## Part 2 — Full Terms & Disclaimer (linked from the modal)

**1. No warranty; use at your own risk.**
Morse Games ("the app") is provided free of charge, "as is" and "as available," without
warranties or guarantees of any kind, express or implied, including but not limited to
accuracy, fitness for a particular purpose, or uninterrupted availability. You use the
app entirely at your own risk. The app's creator is not liable for any damages, direct
or indirect, arising from use of, or inability to use, the app.

**2. No data collection.**
The app has no server-side backend, no user accounts, and no login. It does not
automatically collect, store, transmit, or share any personal information about you or
your usage. Settings, statistics, and progress are stored only in your own browser's
local storage and never leave your device. The app does not use cookies, analytics, or
tracking of any kind. (The hosting provider serving these files may keep its own
standard, incidental web server access logs — that's outside the app's control and not
something the app itself generates or can access.)

**3. Feedback (opt-in).**
The "Send Feedback" link is entirely optional and voluntary — the app never prompts,
tracks, or collects anything on its own. Clicking it opens your own email app, where
*you* compose and send the message yourself — the app does not transmit anything on
your behalf. Because of that, sending feedback this way will reveal your email address
to us as the sender, the same as emailing anyone else directly; there's no anonymous
form involved. If you'd rather not share your email address, simply don't use this
link. If you do send feedback, we may keep it to help improve the app. Please don't
include sensitive personal information in it. This is a deliberate carve-out from §2
above: §2 is about what the app does automatically; this section is about what you
choose to send us yourself, which is a different thing.

**4. Content notice.**
Some training modes are built around fictionalized narrative scenarios set during World
War II (the "Adventure" mode). These are written with care and restraint — the intent is
respectful, non-graphic historical fiction, not violence for its own sake — but they do
reference wartime danger and real historical events. If wartime themes are not something
you want to engage with, we'd recommend skipping those modes.

Separately, contest-style training modes (e.g. "Field Day") generate **random,
fictional callsigns** for practice contacts, following real amateur-radio callsign
formats for realism. These are randomly generated for gameplay purposes only and are
not intended to identify, depict, or refer to any real person, station, or
organization — any resemblance to an actual callsign is coincidental, the same way a
film disclaims its characters' names. If a generated callsign happens to match your
own, it's chance, not reference.

**5. Health notice.**
The app includes brief animated visual effects (e.g. glowing/pulsing UI elements) and
audio tones. These are designed to be gentle, low-contrast, and slow (well under
typical flash-rate thresholds) — not intended to flash or flicker rapidly. If you have
photosensitive epilepsy or any condition that could be affected by on-screen animation
or audio, please consult a physician before use.

**6. Not professional instruction.**
This app is an informal training tool for practicing Morse code (CW) and related ham
radio skills. It is not a substitute for official licensing study materials, an
accredited course, or guidance from a licensed instructor or examiner.

**7. Changes.**
These terms may be updated as the app changes. Continued use after an update
constitutes acceptance of the revised terms.

**8. Governing law.** *[placeholder — worth having your lawyer friend pick a
jurisdiction/venue here if he thinks it's warranted for something this low-stakes; left
blank rather than guessing]*

---

## Notes for implementation (done 2026-07-16 — kept for rationale)

- Gate the modal on a single `localStorage` flag (e.g. `morse-games.termsAcknowledged`)
  so it only shows once per browser — no server round-trip, consistent with the
  no-data-collection stance above. **Done** — `src/terms.ts`.
- Reuse the existing full-viewport overlay pattern already used elsewhere (see
  `MORSE-GAMES.md`'s note on the `Modal` class / `.modal-overlay`). **Done** — the
  modal starts on the short Part 1 text with a "Read Full Terms & Disclaimer" button
  that swaps in the Part 2 text in place, plus "I Understand — Continue".
- The short modal text should stay short (a glance, not a wall of text) — the full
  version above is what actually carries the substantive disclaimer, and only needs to
  be read by someone who clicks through.
- **Feedback link (2026-07-10 decision):** label it **"Send Feedback"** — the label
  itself signals the opt-in nature described in §3, no separate confirmation needed.
  Place it in a persistent element in `index.html` (outside `#mode-root`, so it's
  present on every tab and never touches Adventure mode's immersive shack). Mechanism:
  a plain `mailto:` link to a **dedicated "feedback" address, not a personal one** —
  cheap insurance against spam/abuse (easy to rotate without disrupting anything
  personal), keeps the app at zero backend/zero new hosting, and keeps §3's disclosure
  simple (no third-party form processor to name). **Done, with a placeholder address**
  (`feedback@example.com`) until a real one is picked — see the status note at the top
  of this file. **Moved to a footer below `<main>` (2026-07-16)** — originally in the
  header, relocated so it reads as a quiet, low-emphasis afterthought rather than
  competing with the app's title for attention.
- **In-context caption, next to the link itself (not just in §3):** a small, persistent
  line of muted text — e.g. *"Opens your email app — sending reveals your email
  address to us, the same as emailing anyone directly."* Reinforces §3 at the actual
  point of action rather than relying on a first-visit modal most people won't reread,
  and doubles as a light, honest deterrent for drive-by negativity: knowing the message
  isn't anonymous tends to raise the bar on what people are willing to send. **Done.**
