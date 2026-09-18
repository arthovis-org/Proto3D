// theme.js — single source of truth for the visual language.
// Design tokens (colors, sizes, spacing) + small factories (materials, labels).
// Every other module reads from here; nothing else hard-codes a color or size.
import * as THREE from 'three';

/** Scale: 1 scene unit = 10 cm. A default node is 40 cm wide. */
export const UNIT_CM = 10;

export const palette = {
  bg: 0x0a0e15,
  fog: 0x0a0e15,
  gridMajor: 0x2c3c58,
  gridMinor: 0x1a2436,
  ground: 0x121a29,
  body: 0x1c2536,
  bodyDisabled: 0x1b1f27,
  headerDefault: 0x243147,
  screen: 0x0f1a2e,
  screenGlow: 0x3f6fd6,
  deviceBody: 0x1c2333,
  deviceFrame: 0x2b3648,
  portStem: 0x3a465c,
  text: '#e8eef8',
  textDim: '#93a0b6',
  textOnHeader: '#f3f6fb',
};

/** Header tints per node category (kept subtle: hue, not saturation). */
export const categories = {
  source:  { header: 0x256b6d },
  process: { header: 0x3a5382 },
  sink:    { header: 0x5a4b91 },
  device:  { header: 0x2a3446 },
};

/** Port / connection types. One color each, used everywhere. */
export const portTypes = {
  number:  { color: 0x2dd4bf, label: 'number' },   // teal
  string:  { color: 0xf5b942, label: 'string' },   // amber
  boolean: { color: 0xe25aa6, label: 'boolean' },  // magenta
  signal:  { color: 0xf4f6fa, label: 'signal' },   // white
  data:    { color: 0x8b7cf6, label: 'data' },     // violet
};

/** State accent colors (nodes, devices, connections). */
export const states = {
  hover: 0x9fb3d1,
  selected: 0x5aa9ff,
  active: 0x5aa9ff,
  error: 0xff4d5e,
  disabled: 0x3a4252,
};

export const sizes = {
  node: { width: 4, height: 2.4, depth: 0.5, radius: 0.14, header: 0.66, footer: 0.4 },
  port: { radius: 0.11, stem: 0.22, gap: 0.55, hoverScale: 1.5 },
  connection: {
    radius: { idle: 0.035, active: 0.05, selected: 0.06, invalid: 0.035 },
    ringScale: 2.4,
    tangent: 0.45,       // handle length as a fraction of endpoint distance
    tangentMin: 1.5,
  },
  label: { title: 0.46, small: 0.2, port: 0.17 },
  /** Layout rule: pitch between node origins on the loose demo grid. */
  spacing: { minGapFactor: 1.5, pitchX: 10, pitchZ: 6 },
  device: {
    phone:   { w: 1.6, h: 3.2, d: 0.18 },
    tablet:  { w: 3.4, h: 2.4, d: 0.2 },
    laptop:  { w: 4.2, h: 2.8, d: 0.16, baseDepth: 3 },
    desktop: { w: 5.2, h: 3.0, d: 0.3, standH: 1.2 },
  },
};

export const typography = {
  family: '"Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif',
};

/* ------------------------------------------------------------------ */
/* Materials factory                                                    */
/* ------------------------------------------------------------------ */
export const materials = {
  body(color = palette.body) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  },
  header(color = palette.headerDefault) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });
  },
  port(type = 'signal') {
    const c = (portTypes[type] || portTypes.signal).color;
    return new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.1,
    });
  },
  portStem() {
    return new THREE.MeshStandardMaterial({ color: palette.portStem, roughness: 0.7 });
  },
  /** Soft rim used for hover / selected / error edge glow. */
  rim(color = states.hover) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, side: THREE.BackSide, depthWrite: false,
    });
  },
  screen() {
    return new THREE.MeshStandardMaterial({
      color: palette.screen, emissive: 0xffffff, emissiveMap: screenTexture(), emissiveIntensity: 0.6,
      roughness: 0.25, metalness: 0.1,
    });
  },
  device(color = palette.deviceBody) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 });
  },
};

/* ------------------------------------------------------------------ */
/* Labels: canvas texture on a plane so text lives in 3D               */
/* ------------------------------------------------------------------ */
const FONT_PX = 96;
export function makeLabel(text, opts = {}) {
  const {
    size = sizes.label.title, color = palette.text, weight = 600,
    align = 'center', maxWidth = Infinity,
  } = opts;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${weight} ${FONT_PX}px ${typography.family}`;
  const pad = FONT_PX * 0.3;
  const textW = Math.ceil(ctx.measureText(text).width);
  canvas.width = textW + pad * 2;
  canvas.height = Math.ceil(FONT_PX * 1.3);
  ctx.font = `${weight} ${FONT_PX}px ${typography.family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + FONT_PX * 0.04);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;

  let worldH = size;
  let worldW = worldH * (canvas.width / canvas.height);
  if (worldW > maxWidth) { worldW = maxWidth; worldH = worldW * (canvas.height / canvas.width); }
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
  mesh.userData.align = align;
  mesh.userData.worldW = worldW;
  mesh.renderOrder = 2;
  return mesh;
}

/** Shared screen glow: a soft diagonal gradient so screens read as lit glass, not flat paint. */
let screenTex = null;
function screenTexture() {
  if (!screenTex) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 160);
    grad.addColorStop(0, hex(palette.screenGlow));
    grad.addColorStop(0.55, '#1c3a78');
    grad.addColorStop(1, '#0f1f45');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 4; i++) g.fillRect(24, 28 + i * 26, 120 - i * 22, 8); // abstract "UI" lines
    screenTex = new THREE.CanvasTexture(c);
    screenTex.colorSpace = THREE.SRGBColorSpace;
  }
  return screenTex;
}

/** Shared radial-gradient texture for soft fake contact shadows. */
let shadowTex = null;
export function makeShadowBlob(w, d) {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const mat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.4, d * 3.2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

export const hex = (c) => '#' + c.toString(16).padStart(6, '0');
