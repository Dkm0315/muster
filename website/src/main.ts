import "./style.css";
import { initMotion } from "./motion";
import type { HeroMeshHandle } from "./hero-mesh";

// ---------- silk-smooth motion (reveals, scroll progress, magnetic hover, smooth anchors) ----------
initMotion();

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

// ---------- Liquid Lavender hero shader: DOM-first, lazy-init after first paint ----------
// The CSS poster mesh-gradient in #hero-stage paints immediately. We only mount
// the WebGL plane after first paint so it never blocks LCP text; if WebGL is
// unavailable the poster stays. Even under reduced-motion we mount a single
// frozen frame (still the same liquid look, just not animating).
const canvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;

if (canvas) {
  let handle: HeroMeshHandle | null = null;

  const boot = async () => {
    try {
      const { createHeroMesh } = await import("./hero-mesh");
      handle = createHeroMesh(canvas);
      canvas.classList.add("live"); // fade the shader in over the poster
    } catch {
      /* WebGL unavailable — the CSS poster gradient remains, never a blank area */
    }
    void handle; // retained for lifetime; explicit destroy not needed on a single-page site
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
}
