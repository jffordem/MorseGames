// First-visit Terms & Disclaimer gate. See TERMS.md for the source text and the
// rationale behind each clause — keep this in sync with that file if it changes.
// Gated on a single localStorage flag so it only shows once per browser, no
// server round-trip, consistent with the app's no-data-collection stance.

const ACK_KEY = "morse-games.termsAcknowledged";

const SHORT_TEXT = `Morse Games is a free, hobby ham-radio training tool. By continuing, you agree to the following:

- This app is provided "as is," with no warranties of any kind, and used at your own risk.
- No account, no login, no personal information is collected — nothing you do here is sent anywhere. All settings and progress are stored only in your own browser.
- Some training modes ("Adventure") include fictionalized WWII-era historical content — nothing graphic, but it does reference wartime events.
- If you have photosensitive epilepsy, consult a physician before use.`;

const FULL_TEXT = `1. No warranty; use at your own risk.
Morse Games ("the app") is provided free of charge, "as is" and "as available," without warranties or guarantees of any kind, express or implied, including but not limited to accuracy, fitness for a particular purpose, or uninterrupted availability. You use the app entirely at your own risk. The app's creator is not liable for any damages, direct or indirect, arising from use of, or inability to use, the app.

2. No data collection.
The app has no server-side backend, no user accounts, and no login. It does not automatically collect, store, transmit, or share any personal information about you or your usage. Settings, statistics, and progress are stored only in your own browser's local storage and never leave your device. The app does not use cookies, analytics, or tracking of any kind. (The hosting provider serving these files may keep its own standard, incidental web server access logs — that's outside the app's control and not something the app itself generates or can access.)

3. Feedback (opt-in).
The "Send Feedback" link is entirely optional and voluntary — the app never prompts, tracks, or collects anything on its own. Clicking it opens your own email app, where you compose and send the message yourself — the app does not transmit anything on your behalf. Because of that, sending feedback this way will reveal your email address to us as the sender, the same as emailing anyone else directly; there's no anonymous form involved. If you'd rather not share your email address, simply don't use this link. If you do send feedback, we may keep it to help improve the app. Please don't include sensitive personal information in it.

4. Content notice.
Some training modes are built around fictionalized narrative scenarios set during World War II (the "Adventure" mode). These are written with care and restraint — the intent is respectful, non-graphic historical fiction, not violence for its own sake — but they do reference wartime danger and real historical events. If wartime themes are not something you want to engage with, we'd recommend skipping those modes.

Separately, contest-style training modes (e.g. "Field Day") generate random, fictional callsigns for practice contacts, following real amateur-radio callsign formats for realism. These are randomly generated for gameplay purposes only and are not intended to identify, depict, or refer to any real person, station, or organization — any resemblance to an actual callsign is coincidental, the same way a film disclaims its characters' names.

5. Health notice.
The app includes brief animated visual effects (e.g. glowing/pulsing UI elements) and audio tones. These are designed to be gentle, low-contrast, and slow (well under typical flash-rate thresholds) — not intended to flash or flicker rapidly. If you have photosensitive epilepsy or any condition that could be affected by on-screen animation or audio, please consult a physician before use.

6. Not professional instruction.
This app is an informal training tool for practicing Morse code (CW) and related ham radio skills. It is not a substitute for official licensing study materials, an accredited course, or guidance from a licensed instructor or examiner.

7. Changes.
These terms may be updated as the app changes. Continued use after an update constitutes acceptance of the revised terms.`;

/** Shown once per browser, on first visit, before anything else is usable. */
export function ensureTermsAcknowledged(): void {
  if (localStorage.getItem(ACK_KEY) === "1") return;
  showModal(false);
}

/** Reopens the terms on demand (footer link) — jumps straight to the full text
 *  since anyone clicking this deliberately wants to (re-)read it, not the glance
 *  version. */
export function openTermsModal(): void {
  showModal(true);
}

function showModal(startExpanded: boolean): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "modal terms-modal";

  const title = document.createElement("h2");
  title.className = "modal-title";

  const body = document.createElement("div");
  body.className = "modal-body terms-body";

  const footer = document.createElement("div");
  footer.className = "modal-footer";

  const continueBtn = document.createElement("button");
  continueBtn.className = "btn primary";
  continueBtn.addEventListener("click", () => {
    localStorage.setItem(ACK_KEY, "1");
    overlay.remove();
  });

  if (startExpanded) {
    title.textContent = "Terms & Disclaimer";
    body.textContent = FULL_TEXT;
    continueBtn.textContent = "Close";
    footer.append(continueBtn);
  } else {
    title.textContent = "Before you start";
    body.textContent = SHORT_TEXT;
    continueBtn.textContent = "I Understand — Continue";

    const readFullBtn = document.createElement("button");
    readFullBtn.className = "btn";
    readFullBtn.textContent = "Read Full Terms & Disclaimer";
    readFullBtn.addEventListener("click", () => {
      title.textContent = "Terms & Disclaimer";
      body.textContent = FULL_TEXT;
      readFullBtn.remove();
    });
    footer.append(readFullBtn, continueBtn);
  }

  box.append(title, body, footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
