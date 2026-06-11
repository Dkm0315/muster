import "./style.css";
import { initTerminal } from "./terminal";
import type { ConstellationHandle } from "./constellation";

// ---------- copy buttons ----------
for (const button of document.querySelectorAll<HTMLButtonElement>(".copy-btn")) {
  button.addEventListener("click", async () => {
    const text = button.dataset["copy"] ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "copied";
      button.classList.add("copied");
      setTimeout(() => {
        button.textContent = "copy";
        button.classList.remove("copied");
      }, 1600);
    } catch {
      /* clipboard unavailable (http, permissions) — leave the text selectable */
    }
  });
}

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// ---------- terminal demo ----------
initTerminal();

// ---------- constellation: DOM-first, lazy-init after first paint ----------
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage = document.getElementById("stage");
const canvas = document.getElementById("constellation") as HTMLCanvasElement | null;
const asciiPre = document.getElementById("ascii") as HTMLPreElement | null;
const toggle = document.getElementById("ascii-toggle");
const hero = document.getElementById("hero");

if (!reducedMotion && stage && canvas && asciiPre) {
  let handle: ConstellationHandle | null = null;
  let manualAscii = false;
  let pastHero = false;

  const applyMode = () => {
    const ascii = manualAscii || pastHero;
    stage.classList.toggle("ascii", ascii);
    stage.classList.toggle("behind-content", pastHero);
    handle?.setAscii(ascii);
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(manualAscii));
      const label = toggle.querySelector("span");
      if (label) label.textContent = manualAscii ? "ascii" : "3d";
    }
  };

  const boot = async () => {
    try {
      const { createConstellation } = await import("./constellation");
      handle = createConstellation(canvas, asciiPre);
      applyMode();
    } catch {
      /* WebGL unavailable — the CSS poster gradient remains */
    }
  };

  // two RAFs guarantee first paint happened; idle callback defers off the critical path
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(() => void boot(), { timeout: 1200 });
      } else {
        setTimeout(() => void boot(), 60);
      }
    });
  });

  toggle?.addEventListener("click", () => {
    manualAscii = !manualAscii;
    applyMode();
  });

  if (hero) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) pastHero = !entry.isIntersecting;
        applyMode();
      },
      { threshold: 0.08 },
    );
    observer.observe(hero);
  }
} else {
  toggle?.remove();
}
