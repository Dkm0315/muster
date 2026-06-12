/**
 * Terminal replica line-reveal. When the macOS Terminal window scrolls into view
 * (IntersectionObserver, once), it reveals the pre-rendered session line by line —
 * like watching someone run Muster live — with command lines "typed" a touch
 * slower than output. A blinking block cursor lives in the final prompt (CSS).
 *
 * Reduced-motion: skip the reveal entirely and show the full session statically
 * (the CSS reduced-motion block keeps every line visible and stills the cursor).
 * If JS never runs at all, the lines are visible by default (the .revealing class
 * — which hides them — is only ever added by this module).
 */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Per-line pacing (ms). Output lines tick fast; command lines get a beat so the
// "$ muster …" reads as if it were typed. The banner block reveals quickly as a
// group so it lands like a splash, not a slow crawl.
const OUTPUT_MS = 55;
const COMMAND_MS = 320;
const BANNER_MS = 22;

export function initTerminal(): void {
  const out = document.getElementById("term-out");
  if (!out) return;

  const lines = Array.from(out.querySelectorAll<HTMLElement>(".t-line"));
  if (!lines.length) return;

  if (REDUCED) return; // CSS already shows everything; nothing to animate.

  // Switch into "revealing" mode (CSS now hides un-.shown lines) and play once.
  let started = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || started) continue;
        started = true;
        observer.disconnect();
        play(out, lines);
      }
    },
    { threshold: 0.25 },
  );
  observer.observe(out);
}

function play(out: HTMLElement, lines: HTMLElement[]): void {
  out.classList.add("revealing");

  let index = 0;
  const next = (): void => {
    if (index >= lines.length) return;
    const line = lines[index];
    if (!line) return;
    line.classList.add("shown");

    const isBanner = line.classList.contains("term-banner");
    const isCommand = line.querySelector(".t-cmd") !== null;
    const delay = isCommand ? COMMAND_MS : isBanner ? BANNER_MS : OUTPUT_MS;

    index += 1;
    window.setTimeout(next, delay);
  };
  next();
}
