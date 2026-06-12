/**
 * Subtle 3D tilt for glass cards. On hover, a card rotates toward the cursor in
 * perspective and a specular sheen tracks the tilt; on leave it springs back.
 *
 *  - DOM-only, no dependencies. One rAF spring per active card.
 *  - Composes with the card's CSS hover-lift by baking a translateY into the
 *    inline transform (so we don't clobber the :hover translate), then clearing
 *    the inline transform on leave to hand control back to CSS.
 *  - Disabled entirely on touch / coarse pointers and under reduced motion —
 *    a tilt that can't release feels broken on touch.
 */

const MAX_DEG = 7;        // peak rotation at the card corners
const LIFT_PX = 6;        // translateY kept while tilting (matches the CSS lift)
const STIFFNESS = 0.16;   // spring approach rate toward the target
const REST = 0.0006;      // settle threshold (deg/px) before we stop the rAF

interface TiltState {
  el: HTMLElement;
  rx: number; ry: number; // current rotation
  trx: number; try_: number; // target rotation
  sx: number; sy: number; // current sheen position (%)
  tsx: number; tsy: number; // target sheen position
  lift: number; tlift: number; // current/target lift
  raf: number;
  active: boolean;
}

export function initCardTilt(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Coarse pointer (touch) or no hover capability: skip entirely.
  if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;

  const cards = document.querySelectorAll<HTMLElement>(
    ".card, .glass-card, .eco-card",
  );
  for (const el of cards) attach(el);
}

function attach(el: HTMLElement): void {
  el.classList.add("tilt");
  const state: TiltState = {
    el,
    rx: 0, ry: 0, trx: 0, try_: 0,
    sx: 50, sy: 0, tsx: 50, tsy: 0,
    lift: 0, tlift: 0,
    raf: 0, active: false,
  };

  const step = (): void => {
    state.rx += (state.trx - state.rx) * STIFFNESS;
    state.ry += (state.try_ - state.ry) * STIFFNESS;
    state.sx += (state.tsx - state.sx) * STIFFNESS;
    state.sy += (state.tsy - state.sy) * STIFFNESS;
    state.lift += (state.tlift - state.lift) * STIFFNESS;

    el.style.transform =
      `perspective(800px) rotateX(${state.rx.toFixed(3)}deg) ` +
      `rotateY(${state.ry.toFixed(3)}deg) translateY(${state.lift.toFixed(2)}px)`;
    el.style.setProperty("--sheen-x", `${state.sx.toFixed(1)}%`);
    el.style.setProperty("--sheen-y", `${state.sy.toFixed(1)}%`);

    const settled =
      Math.abs(state.trx - state.rx) < REST &&
      Math.abs(state.try_ - state.ry) < REST &&
      Math.abs(state.tlift - state.lift) < REST;
    if (settled && !state.active) {
      // Fully returned to rest — hand the transform back to CSS :hover/idle.
      el.style.transform = "";
      el.style.removeProperty("--sheen-x");
      el.style.removeProperty("--sheen-y");
      el.classList.remove("tilting");
      state.raf = 0;
      return;
    }
    state.raf = requestAnimationFrame(step);
  };

  const ensureLoop = (): void => {
    if (!state.raf) state.raf = requestAnimationFrame(step);
  };

  const onMove = (event: PointerEvent): void => {
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;  // 0..1
    const py = (event.clientY - rect.top) / rect.height;  // 0..1
    // Cursor right -> rotateY positive; cursor up -> rotateX positive.
    state.try_ = (px - 0.5) * 2 * MAX_DEG;
    state.trx = -(py - 0.5) * 2 * MAX_DEG;
    state.tsx = px * 100;
    state.tsy = py * 100;
    ensureLoop();
  };

  const onEnter = (): void => {
    state.active = true;
    state.tlift = -LIFT_PX;
    el.classList.add("tilting");
    ensureLoop();
  };

  const onLeave = (): void => {
    state.active = false;
    state.trx = 0;
    state.try_ = 0;
    state.tlift = 0;
    state.tsx = 50;
    state.tsy = 0;
    ensureLoop();
  };

  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointermove", onMove, { passive: true });
  el.addEventListener("pointerleave", onLeave);
}
