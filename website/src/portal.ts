import "./portal.css";

// muster-view strip collapse/expand
const toggle = document.getElementById("muster-view-toggle");
const view = document.getElementById("muster-view");
toggle?.addEventListener("click", () => {
  const collapsed = view?.classList.toggle("collapsed") ?? false;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.textContent = collapsed ? "muster view ▸" : "muster view ▾";
});

// SMIL pulses cannot be paused from CSS — remove them under reduced motion
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  for (const node of document.querySelectorAll("animateMotion")) node.remove();
}
