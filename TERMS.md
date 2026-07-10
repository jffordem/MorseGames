# Morse Games — Terms of Use & Disclaimer

**Status: DRAFT — pending legal review. Not yet wired into the app.**

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
collect, store, transmit, or share any personal information. Settings, statistics, and
progress are stored only in your own browser's local storage and never leave your
device. The app does not use cookies, analytics, or tracking of any kind. (The hosting
provider serving these files may keep its own standard, incidental web server access
logs — that's outside the app's control and not something the app itself generates or
can access.)

**3. Content notice.**
Some training modes are built around fictionalized narrative scenarios set during World
War II (the "Adventure" mode). These are written with care and restraint — the intent is
respectful, non-graphic historical fiction, not violence for its own sake — but they do
reference wartime danger and real historical events. If wartime themes are not something
you want to engage with, we'd recommend skipping those modes.

**4. Health notice.**
The app includes brief animated visual effects (e.g. glowing/pulsing UI elements) and
audio tones. These are designed to be gentle, low-contrast, and slow (well under
typical flash-rate thresholds) — not intended to flash or flicker rapidly. If you have
photosensitive epilepsy or any condition that could be affected by on-screen animation
or audio, please consult a physician before use.

**5. Not professional instruction.**
This app is an informal training tool for practicing Morse code (CW) and related ham
radio skills. It is not a substitute for official licensing study materials, an
accredited course, or guidance from a licensed instructor or examiner.

**6. Changes.**
These terms may be updated as the app changes. Continued use after an update
constitutes acceptance of the revised terms.

**7. Governing law.** *[placeholder — worth having your lawyer friend pick a
jurisdiction/venue here if he thinks it's warranted for something this low-stakes; left
blank rather than guessing]*

---

## Notes for implementation (once approved)

- Gate the modal on a single `localStorage` flag (e.g. `morse-games.termsAcknowledged`)
  so it only shows once per browser — no server round-trip, consistent with the
  no-data-collection stance above.
- Reuse the existing full-viewport overlay pattern already used elsewhere (see
  `MORSE-GAMES.md`'s note on the `Modal` class / `.modal-overlay`).
- The short modal text should stay short (a glance, not a wall of text) — the full
  version above is what actually carries the substantive disclaimer, and only needs to
  be read by someone who clicks through.
