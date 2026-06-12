/**
 * The Muster constellation: ~300 agent nodes scatter -> "muster" into formation
 * over ~3s, with pulse packets traveling along handoff edges. Mouse parallax.
 * Can re-render itself as ASCII by sampling a low-res render target into a <pre>.
 * Raw three, no helpers — this module is the only 3D code on the site.
 */
import * as THREE from "three";

export interface ConstellationHandle {
  setAscii(on: boolean): void;
  destroy(): void;
}

const NODE_COUNT = 300;
const GRID_COLS = 20;
const GRID_ROWS = 15;
const EDGE_LIMIT = 320;
const PULSE_COUNT = 22;
const MUSTER_SECONDS = 3;

// agents / surfaces / flows
const PALETTE = [new THREE.Color("#ffb000"), new THREE.Color("#e8e6e1"), new THREE.Color("#7d8aa0")];

const ASCII_COLS = 110;
const ASCII_ROWS = 48;
const ASCII_RAMP = " .,:;+*#@";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Soft radial-falloff sprite so points read as round glows instead of squares. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const cnv = document.createElement("canvas");
  cnv.width = cnv.height = size;
  const ctx = cnv.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  tex.needsUpdate = true;
  return tex;
}

export function createConstellation(canvas: HTMLCanvasElement, asciiPre: HTMLPreElement): ConstellationHandle {
  // Probe WebGL on a throwaway canvas first (never bind a context to the real
  // canvas — that could collide with the type three wants). If unavailable we
  // throw so main.ts keeps the CSS radial-gradient poster, not a blank canvas.
  const probeCanvas = document.createElement("canvas");
  const probe =
    probeCanvas.getContext("webgl2") ??
    probeCanvas.getContext("webgl") ??
    probeCanvas.getContext("experimental-webgl");
  if (!probe) throw new Error("WebGL unavailable");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 34);

  // --- node buffers: scatter -> formation ---
  const scatter = new Float32Array(NODE_COUNT * 3);
  const formation = new Float32Array(NODE_COUNT * 3);
  const positions = new Float32Array(NODE_COUNT * 3);
  const colors = new Float32Array(NODE_COUNT * 3);
  const phase = new Float32Array(NODE_COUNT);

  for (let i = 0; i < NODE_COUNT; i++) {
    // scatter: random shell
    const r = 26 + Math.random() * 22;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    scatter[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    scatter[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    scatter[i * 3 + 2] = r * Math.cos(phi) - 10;

    // formation: jittered phalanx grid
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS) % GRID_ROWS;
    formation[i * 3] = (col - (GRID_COLS - 1) / 2) * 2.5 + (Math.random() - 0.5) * 0.5;
    formation[i * 3 + 1] = (row - (GRID_ROWS - 1) / 2) * 1.85 + (Math.random() - 0.5) * 0.5;
    formation[i * 3 + 2] = (Math.random() - 0.5) * 5;

    const color = PALETTE[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0]!;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    phase[i] = Math.random() * Math.PI * 2;
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  nodeGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // Round, soft-edged sprite so additive nodes read as glowing dots, not squares.
  const nodeSprite = makeGlowTexture();
  // Crisp core.
  const nodeMat = new THREE.PointsMaterial({
    size: 2.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    map: nodeSprite,
    depthWrite: false,
  });
  scene.add(new THREE.Points(nodeGeo, nodeMat));

  // Wider additive halo around each node for the federation "glow" feel.
  const glowMat = new THREE.PointsMaterial({
    size: 9,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.16,
    map: nodeSprite,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  scene.add(new THREE.Points(nodeGeo, glowMat));

  // --- handoff edges between grid neighbours ---
  const edgePairs: Array<[number, number]> = [];
  for (let i = 0; i < NODE_COUNT && edgePairs.length < EDGE_LIMIT; i++) {
    const col = i % GRID_COLS;
    if (col < GRID_COLS - 1 && i + 1 < NODE_COUNT && Math.random() < 0.62) edgePairs.push([i, i + 1]);
    if (i + GRID_COLS < NODE_COUNT && Math.random() < 0.62) edgePairs.push([i, i + GRID_COLS]);
  }
  const edgePositions = new Float32Array(edgePairs.length * 6);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color("#3a4150"),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  scene.add(new THREE.LineSegments(edgeGeo, edgeMat));

  // --- pulses traveling along edges ---
  const pulseEdge = new Int32Array(PULSE_COUNT);
  const pulseSpeed = new Float32Array(PULSE_COUNT);
  const pulseOffset = new Float32Array(PULSE_COUNT);
  for (let p = 0; p < PULSE_COUNT; p++) {
    pulseEdge[p] = Math.floor(Math.random() * Math.max(edgePairs.length, 1));
    pulseSpeed[p] = 0.25 + Math.random() * 0.5;
    pulseOffset[p] = Math.random();
  }
  const pulsePositions = new Float32Array(PULSE_COUNT * 3);
  const pulseGeo = new THREE.BufferGeometry();
  pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePositions, 3));
  const pulseMat = new THREE.PointsMaterial({
    size: 4.5,
    sizeAttenuation: false,
    color: new THREE.Color("#ffb000"),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  scene.add(new THREE.Points(pulseGeo, pulseMat));

  // --- ascii sampling target ---
  const asciiTarget = new THREE.WebGLRenderTarget(ASCII_COLS, ASCII_ROWS);
  const asciiPixels = new Uint8Array(ASCII_COLS * ASCII_ROWS * 4);
  let asciiOn = false;
  let lastAscii = 0;

  // --- mouse parallax (two-stage damping: raw target -> smoothed -> camera) ---
  let targetX = 0; // where the pointer wants the camera
  let targetY = 0;
  let smoothX = 0; // critically-damped follower of the target (kills jitter)
  let smoothY = 0;
  const onMouse = (event: MouseEvent) => {
    targetX = (event.clientX / window.innerWidth) * 2 - 1;
    targetY = (event.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("mousemove", onMouse, { passive: true });
  // Touch drift: a faint parallax so phones don't feel dead, without hijacking scroll.
  const onTouch = (event: TouchEvent) => {
    const t = event.touches[0];
    if (!t) return;
    targetX = (t.clientX / window.innerWidth) * 2 - 1;
    targetY = (t.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("touchmove", onTouch, { passive: true });

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitAsciiFont();
  };
  window.addEventListener("resize", resize, { passive: true });

  function fitAsciiFont(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // monospace advance ≈ 0.602em; pick font-size so the grid fills the viewport
    const sizeByWidth = w / (ASCII_COLS * 0.602);
    const sizeByHeight = h / ASCII_ROWS;
    asciiPre.style.fontSize = `${Math.min(sizeByWidth, sizeByHeight).toFixed(2)}px`;
  }

  function updateGeometry(elapsed: number): void {
    const p = easeOutCubic(Math.min(1, elapsed / MUSTER_SECONDS));
    const settled = p >= 1;
    for (let i = 0; i < NODE_COUNT; i++) {
      const ph = phase[i]!;
      // Gentle continuous breathing once in formation: y-wobble + a slow z-depth
      // drift so the phalanx feels alive rather than frozen.
      const wobble = settled ? Math.sin(elapsed * 0.8 + ph) * 0.22 : 0;
      const zBreath = settled ? Math.sin(elapsed * 0.45 + ph * 1.7) * 0.9 : 0;
      positions[i * 3] = scatter[i * 3]! + (formation[i * 3]! - scatter[i * 3]!) * p;
      positions[i * 3 + 1] = scatter[i * 3 + 1]! + (formation[i * 3 + 1]! - scatter[i * 3 + 1]!) * p + wobble;
      positions[i * 3 + 2] = scatter[i * 3 + 2]! + (formation[i * 3 + 2]! - scatter[i * 3 + 2]!) * p + zBreath;
    }
    nodeGeo.attributes.position!.needsUpdate = true;

    for (let e = 0; e < edgePairs.length; e++) {
      const [a, b] = edgePairs[e]!;
      edgePositions[e * 6] = positions[a * 3]!;
      edgePositions[e * 6 + 1] = positions[a * 3 + 1]!;
      edgePositions[e * 6 + 2] = positions[a * 3 + 2]!;
      edgePositions[e * 6 + 3] = positions[b * 3]!;
      edgePositions[e * 6 + 4] = positions[b * 3 + 1]!;
      edgePositions[e * 6 + 5] = positions[b * 3 + 2]!;
    }
    edgeGeo.attributes.position!.needsUpdate = true;
    edgeMat.opacity = 0.5 * p;
    pulseMat.opacity = 0.9 * Math.max(0, p - 0.6) / 0.4;

    for (let q = 0; q < PULSE_COUNT; q++) {
      const [a, b] = edgePairs[pulseEdge[q]!] ?? [0, 0];
      const t = (elapsed * pulseSpeed[q]! + pulseOffset[q]!) % 1;
      pulsePositions[q * 3] = positions[a * 3]! + (positions[b * 3]! - positions[a * 3]!) * t;
      pulsePositions[q * 3 + 1] = positions[a * 3 + 1]! + (positions[b * 3 + 1]! - positions[a * 3 + 1]!) * t;
      pulsePositions[q * 3 + 2] = positions[a * 3 + 2]! + (positions[b * 3 + 2]! - positions[a * 3 + 2]!) * t;
    }
    pulseGeo.attributes.position!.needsUpdate = true;

    // Two-stage damping: smooth the raw pointer target, then ease the camera
    // toward it. Removes per-event jitter, no hard snapping.
    smoothX += (targetX - smoothX) * 0.08;
    smoothY += (targetY - smoothY) * 0.08;
    // A slow autonomous orbit so the scene drifts even when the mouse is still.
    const driftX = Math.sin(elapsed * 0.12) * 0.6;
    const driftY = Math.cos(elapsed * 0.09) * 0.4;
    camera.position.x += (smoothX * 2.4 + driftX - camera.position.x) * 0.05;
    camera.position.y += (-smoothY * 1.6 + driftY - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
  }

  function renderAscii(): void {
    renderer.setRenderTarget(asciiTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixels(asciiTarget, 0, 0, ASCII_COLS, ASCII_ROWS, asciiPixels);
    let text = "";
    for (let row = ASCII_ROWS - 1; row >= 0; row--) {
      for (let col = 0; col < ASCII_COLS; col++) {
        const offset = (row * ASCII_COLS + col) * 4;
        const lum =
          (asciiPixels[offset]! * 0.4 + asciiPixels[offset + 1]! * 0.45 + asciiPixels[offset + 2]! * 0.15) / 255;
        const index = Math.min(ASCII_RAMP.length - 1, Math.floor(lum * (ASCII_RAMP.length - 1) * 1.8));
        text += ASCII_RAMP[index];
      }
      text += "\n";
    }
    asciiPre.textContent = text;
  }

  const clock = new THREE.Clock();
  let frameId = 0;
  let destroyed = false;
  let paused = false;
  // Accumulate elapsed from clamped deltas so a hidden tab can't inject a huge
  // time jump on resume (which would snap the parallax / breathing).
  let elapsed = 0;

  function frame(): void {
    if (destroyed) return;
    frameId = requestAnimationFrame(frame);
    elapsed += Math.min(clock.getDelta(), 0.05); // clamp to ~20fps worst case
    updateGeometry(elapsed);
    if (asciiOn) {
      // ascii sampling is throttled to ~15fps; the WebGL canvas stays hidden
      const now = performance.now();
      if (now - lastAscii > 66) {
        lastAscii = now;
        renderAscii();
      }
    } else {
      renderer.render(scene, camera);
    }
  }

  // Pause the loop when the tab is hidden — saves battery, prevents wasted GPU.
  const onVisibility = () => {
    const hidden = document.hidden;
    if (hidden && !paused) {
      paused = true;
      cancelAnimationFrame(frameId);
    } else if (!hidden && paused) {
      paused = false;
      clock.getDelta(); // discard the long hidden interval
      frame();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  frame();
  canvas.classList.add("live");

  return {
    setAscii(on: boolean): void {
      asciiOn = on;
      if (!on) asciiPre.textContent = "";
    },
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      nodeGeo.dispose();
      edgeGeo.dispose();
      pulseGeo.dispose();
      nodeMat.dispose();
      glowMat.dispose();
      edgeMat.dispose();
      pulseMat.dispose();
      nodeSprite.dispose();
      asciiTarget.dispose();
      renderer.dispose();
    },
  };
}
