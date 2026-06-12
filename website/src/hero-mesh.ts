/**
 * Liquid Lavender hero — a full-viewport mesh-gradient shader plane.
 *
 * A single fullscreen triangle carries a ShaderMaterial whose fragment shader
 * blends four moving colour centres (lavender / cyan / peach / canvas) through
 * FBM simplex noise driven by uTime, with a damped uMouse uniform adding gentle
 * parallax displacement toward the cursor. No post-processing — one draw call.
 *
 * Raw three, no helpers. This is the only WebGL on the landing page.
 *  - rAF loop pauses on document.hidden (visibilitychange)
 *  - prefers-reduced-motion freezes on a single static frame
 *  - throws if WebGL is unavailable so the caller keeps the CSS poster gradient
 */
import * as THREE from "three";

export interface HeroMeshHandle {
  destroy(): void;
  /** Re-tune the aurora colour centres for light/dark without a reload. */
  setDark(dark: boolean): void;
}

// Vertex: emit a fullscreen triangle from gl_VertexID, pass through UV in [0,1].
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Fragment: FBM-warped blend of four colour centres that drift over time.
// Classic Ashima simplex noise (public domain) for the flow field.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uMouse;       // damped, normalised [-1,1]
  uniform vec2  uResolution;
  uniform float uMix;         // 0 = light palette, 1 = dark palette (animated)
  // light palette
  uniform vec3  uLavender;
  uniform vec3  uCyan;
  uniform vec3  uPeach;
  uniform vec3  uCanvas;
  // dark palette (deep plum canvas; aurora = lavender / cyan / indigo)
  uniform vec3  uLavenderD;
  uniform vec3  uCyanD;
  uniform vec3  uIndigoD;
  uniform vec3  uCanvasD;

  // --- Ashima simplex noise -------------------------------------------------
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fractal Brownian motion — four octaves of drifting simplex.
  float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * snoise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  // Soft radial weight around a moving colour centre.
  float centre(vec2 uv, vec2 pos, float radius){
    float d = distance(uv, pos);
    return smoothstep(radius, 0.0, d);
  }

  void main(){
    // Correct for aspect so circles stay round, not stretched.
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 auv = vec2(uv.x * aspect, uv.y);

    float t = uTime * 0.06;

    // Warp the field with FBM + a gentle pull toward the (damped) cursor.
    vec2 warp = vec2(
      fbm(auv * 1.4 + vec2(t, t * 0.6)),
      fbm(auv * 1.4 + vec2(-t * 0.7, t * 0.9) + 5.2)
    );
    vec2 mouse = uMouse * 0.5 + 0.5;        // [-1,1] -> [0,1]
    mouse.x *= aspect;
    vec2 puv = auv + warp * 0.22 + (mouse - auv) * 0.05;

    // Four slowly orbiting colour centres.
    vec2 c1 = vec2(0.30 * aspect + sin(t * 1.7) * 0.10, 0.34 + cos(t * 1.3) * 0.10);
    vec2 c2 = vec2(0.74 * aspect + cos(t * 1.1) * 0.12, 0.30 + sin(t * 1.5) * 0.09);
    vec2 c3 = vec2(0.58 * aspect + sin(t * 0.9) * 0.11, 0.74 + cos(t * 1.9) * 0.10);
    vec2 c4 = vec2(0.22 * aspect + cos(t * 1.4) * 0.09, 0.70 + sin(t * 1.0) * 0.11);

    float w1 = centre(puv, c1, 0.62);
    float w2 = centre(puv, c2, 0.58);
    float w3 = centre(puv, c3, 0.60);
    float w4 = centre(puv, c4, 0.66);

    // Resolve the active palette by interpolating light<->dark with uMix.
    vec3 canvasCol   = mix(uCanvas,   uCanvasD,   uMix);
    vec3 accentA     = mix(uLavender, uLavenderD, uMix);  // primary lavender
    vec3 accentB     = mix(uCyan,     uCyanD,     uMix);  // cyan
    vec3 accentC     = mix(uPeach,    uIndigoD,   uMix);  // peach (light) -> indigo (dark)
    // In dark mode the accents are bolder so the aurora reads on near-black.
    float gain = mix(1.0, 1.35, uMix);

    // Start from canvas, layer the three accents over it.
    vec3 col = canvasCol;
    col = mix(col, accentA, clamp(w1 * 0.92 * gain, 0.0, 1.0));
    col = mix(col, accentB, clamp(w2 * 0.62 * gain, 0.0, 1.0));
    col = mix(col, accentC, clamp(w3 * 0.45 * gain, 0.0, 1.0));
    col = mix(col, accentA, clamp(w4 * 0.55 * gain, 0.0, 1.0));

    // A faint grain of extra FBM keeps banding away; softer in dark.
    float sheen = fbm(auv * 3.0 + t) * mix(0.04, 0.02, uMix);
    col += sheen;

    // Vignette toward canvas at the edges so content stays readable.
    float vig = smoothstep(1.15, 0.25, distance(uv, vec2(0.5)));
    col = mix(canvasCol, col, 0.35 + vig * 0.65);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const COLORS = {
  // light palette — warm off-white canvas, lavender / cyan / peach aurora
  lavender: new THREE.Color("#A78BFA"),
  cyan: new THREE.Color("#06B6D4"),
  peach: new THREE.Color("#FFD9C2"),
  canvas: new THREE.Color("#F0EEE9"),
  // dark palette — deep plum-black canvas, brighter lavender / cyan / indigo
  lavenderD: new THREE.Color("#9B7BFF"),
  cyanD: new THREE.Color("#22C9E6"),
  indigoD: new THREE.Color("#6D4BD6"),
  canvasD: new THREE.Color("#0E0B1A"),
};

export function createHeroMesh(canvas: HTMLCanvasElement, startDark = false): HeroMeshHandle {
  // Probe WebGL on a throwaway canvas so the caller can keep its CSS poster.
  const probeCanvas = document.createElement("canvas");
  const probe =
    probeCanvas.getContext("webgl2") ??
    probeCanvas.getContext("webgl") ??
    probeCanvas.getContext("experimental-webgl");
  if (!probe) throw new Error("WebGL unavailable");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  const uniforms = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uMix: { value: startDark ? 1 : 0 },
    uLavender: { value: COLORS.lavender },
    uCyan: { value: COLORS.cyan },
    uPeach: { value: COLORS.peach },
    uCanvas: { value: COLORS.canvas },
    uLavenderD: { value: COLORS.lavenderD },
    uCyanD: { value: COLORS.cyanD },
    uIndigoD: { value: COLORS.indigoD },
    uCanvasD: { value: COLORS.canvasD },
  };

  // Target for uMix; the render loop eases the live value toward it so toggling
  // theme cross-fades the aurora instead of snapping.
  let mixTarget = startDark ? 1 : 0;

  // Fullscreen triangle: a 3-vertex geometry whose clip coords cover the screen.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 3, -1, 0, -1, 3, 0,
  ]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0, 2, 0, 0, 2,
  ]), 2));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(geo, material));

  // --- damped mouse (lerp toward raw target for silk smoothness) ---
  let targetX = 0;
  let targetY = 0;
  const onMouse = (event: MouseEvent) => {
    targetX = (event.clientX / window.innerWidth) * 2 - 1;
    targetY = -((event.clientY / window.innerHeight) * 2 - 1);
  };
  if (!reduced) window.addEventListener("mousemove", onMouse, { passive: true });

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(w, h);
  };
  window.addEventListener("resize", resize, { passive: true });
  resize();

  const clock = new THREE.Clock();
  let frameId = 0;
  let destroyed = false;
  let paused = false;
  let elapsed = 0;

  const render = () => {
    const m = uniforms.uMouse.value;
    m.x += (targetX - m.x) * 0.045;
    m.y += (targetY - m.y) * 0.045;
    // Ease the palette mix toward its target for a smooth theme cross-fade.
    uniforms.uMix.value += (mixTarget - uniforms.uMix.value) * 0.06;
    uniforms.uTime.value = elapsed;
    renderer.render(scene, camera);
  };

  // Re-tune colours on theme toggle. Under reduced motion (no rAF loop) we set
  // the mix directly and repaint the single frozen frame.
  const setDark = (dark: boolean): void => {
    mixTarget = dark ? 1 : 0;
    if (reduced) {
      uniforms.uMix.value = mixTarget;
      render();
    }
  };

  if (reduced) {
    // Freeze on a single representative frame; no rAF loop.
    elapsed = 8;
    render();
  } else {
    const frame = () => {
      if (destroyed) return;
      frameId = requestAnimationFrame(frame);
      elapsed += Math.min(clock.getDelta(), 0.05);
      render();
    };

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

    frame();

    // expose cleanup that also detaches the visibility listener
    return {
      setDark,
      destroy(): void {
        destroyed = true;
        cancelAnimationFrame(frameId);
        window.removeEventListener("mousemove", onMouse);
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibility);
        geo.dispose();
        material.dispose();
        renderer.dispose();
      },
    };
  }

  // reduced-motion cleanup (no loop / visibility listener attached)
  return {
    setDark,
    destroy(): void {
      destroyed = true;
      window.removeEventListener("resize", resize);
      geo.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
