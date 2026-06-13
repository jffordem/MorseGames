import "./styles.css";
import { RandomRunMode } from "./modes/random-run";
import { WordWranglerMode } from "./modes/word-wrangler";
import { ReadingMode } from "./modes/reading";

const root = document.getElementById("mode-root") as HTMLElement;
const tabs = document.getElementById("tabs") as HTMLElement;

let current: { unmount(): void } | null = null;

function activate(tab: string): void {
  current?.unmount();
  root.innerHTML = "";

  switch (tab) {
    case "random-run": {
      const mode = new RandomRunMode(root);
      mode.mount();
      current = mode;
      break;
    }
    case "word-wrangler": {
      const mode = new WordWranglerMode(root);
      mode.mount();
      current = mode;
      break;
    }
    case "reading": {
      const mode = new ReadingMode(root);
      mode.mount();
      current = mode;
      break;
    }
    default: {
      root.innerHTML = `<section class="placeholder">Coming soon.</section>`;
      current = null;
    }
  }
}

tabs.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button.tab") as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  for (const t of tabs.querySelectorAll(".tab")) t.classList.remove("active");
  btn.classList.add("active");
  activate(btn.dataset.tab ?? "random-run");
});

activate("random-run");
