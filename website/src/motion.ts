/**
 * Silk-smooth, DOM-only motion layer. No dependencies.
 *  - scroll-progress bar (amber, top edge), rAF-throttled
 *  - IntersectionObserver section reveals with staggered children, fired once
 *  - smooth anchor scrolling for in-page links
 *  - magnetic / glow-lift hover on the primary CTA + feature cards
 * ALL behaviour is gated behind prefers-reduced-motion: when reduced, content is
 * left fully visible (CSS handles that) and no transforms are ever applied.
 */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Per-child stagger inside a revealed section. */
const STAGGER_MS = 90;

export function initMotion(): void {
  initScrollProgress();
  if (REDUCED) {
    // Reveal targets are kept visible by CSS; only wire instant anchor jumps.
    initAnchorScroll(false);
    return;
  }
  initReveals();
  initAnchorScroll(true);
  initMagnetic();
}

/* ---------- scroll-progress bar ---------- */
function initScrollProgress(): void {
  const bar = document.getElementById("scroll-progress");
  if (!bar) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
    bar.style.transform = `scaleX(${ratio})`;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
}

/* ---------- section reveals with staggered children ---------- */
function initReveals(): void {
  const sections = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!sections.length) return;

  // Pre-stamp each child's stagger delay so the CSS transition fans out.
  for (const section of sections) {
    const children = section.querySelectorAll<HTMLElement>(".reveal-child");
    children.forEach((child, index) => {
      child.style.setProperty("--reveal-delay", `${index * STAGGER_MS}ms`);
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target); // fire once
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
  );

  for (const section of sections) {
    // Already on-screen at load (e.g. very tall viewport): reveal immediately.
    if (section.getBoundingClientRect().top < window.innerHeight * 0.92) {
      section.classList.add("is-revealed");
    } else {
      observer.observe(section);
    }
  }
}

/* ---------- smooth anchor scrolling ---------- */
function initAnchorScroll(smooth: boolean): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      // keep the URL hash + focus in sync for keyboard users
      history.pushState(null, "", id);
      (target as HTMLElement).setAttribute("tabindex", "-1");
      (target as HTMLElement).focus({ preventScroll: true });
    });
  }
}

/* ---------- magnetic / glow-lift hover ---------- */
function initMagnetic(): void {
  const targets = document.querySelectorAll<HTMLElement>(".install, .card, .pillar");
  // Skip on touch / coarse pointers — a magnet that never releases feels broken.
  if (window.matchMedia("(hover: none)").matches) return;

  for (const el of targets) {
    const strength = el.classList.contains("install") ? 0.22 : 0.1;
    let raf = 0;
    let tx = 0;
    let ty = 0;

    const apply = () => {
      raf = 0;
      el.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
    };
    const onMove = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      tx = (event.clientX - (rect.left + rect.width / 2)) * strength;
      ty = (event.clientY - (rect.top + rect.height / 2)) * strength;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      tx = 0;
      ty = 0;
      el.style.transform = "";
    };
    el.addEventListener("mousemove", onMove, { passive: true });
    el.addEventListener("mouseleave", onLeave, { passive: true });
  }
}
