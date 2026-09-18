// theme.js — single source of truth for the visual language.
// Design tokens (colors, sizes, spacing) + small factories (materials, labels, screens).
// Two palettes (dark / light) live here; `palette`, `categories`, `portTypes` and `states`
// are mutated in place on theme change so every module keeps reading the same bindings.
import * as THREE from 'three';

/** Scale: 1 scene unit = 10 cm. A default node is 40 cm wide. */
export const UNIT_CM = 10;

export const palettes = {
  dark: {
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
    screenMid: '#1c3a78',
    screenDeep: '#0f1f45',
    screenText: '#eaf1ff',
    deviceBody: 0x1c2333,
    deviceFrame: 0x2b3648,
    keyboard: 0x121824,
    portStem: 0x3a465c,
    skyLight: 0xb8c7e0,
    groundLight: 0x141a26,
    shadowAlpha: 1.0,
    text: '#e8eef8',
    textDim: '#93a0b6',
    textOnHeader: '#f3f6fb',
    categories: { source: 0x256b6d, process: 0x3a5382, sink: 0x5a4b91, device: 0x2a3446 },
    portTypes: { number: 0x2dd4bf, string: 0xf5b942, boolean: 0xe25aa6, signal: 0xf4f6fa, data: 0x8b7cf6 },
    states: { hover: 0x9fb3d1, selected: 0x5aa9ff, active: 0x5aa9ff, error: 0xff4d5e, disabled: 0x3a4252 },
  },
  light: {
    bg: 0xeef1f6,
    fog: 0xeef1f6,
    gridMajor: 0xb6c0d0,
    gridMinor: 0xd5dbe5,
    ground: 0xe1e6ee,
    body: 0xc9d1de,
    bodyDisabled: 0xd8dce3,
    headerDefault: 0xaeb9cc,
    screen: 0x16223a,
    screenGlow: 0x4d7fe0,
    screenMid: '#26468a',
    screenDeep: '#172a55',
    screenText: '#f2f6ff',
    deviceBody: 0x8b96a8,
    deviceFrame: 0x6b778b,
    keyboard: 0x55606f,
    portStem: 0x8390a5,
    skyLight: 0xffffff,
    groundLight: 0x8a94a6,
    shadowAlpha: 0.55,
    text: '#1b2230',
    textDim: '#4f5c70',
    textOnHeader: '#0f1620',
    categories: { source: 0x86cfcb, process: 0x9cb3e4, sink: 0xb7a8ea, device: 0xb0bbcd },
    portTypes: { number: 0x0f9f8f, string: 0xc07f0c, boolean: 0xc2388a, signal: 0x48556b, data: 0x6a5cd6 },
    states: { hover: 0x6f8bb0, selected: 0x2b7fe0, active: 0x2b7fe0, error: 0xd93848, disabled: 0xa2abb8 },
  },
};

/** Live tokens (mutated in place by setTheme). */
export const palette = {};
/** Header tints per node category (kept subtle: hue, not saturation). */
export const categories = { source: { header: 0 }, process: { header: 0 }, sink: { header: 0 }, device: { header: 0 } };
/** Port / connection types. One color each, used everywhere. */
export const portTypes = {
  number: { color: 0, label: 'number' },
  string: { color: 0, label: 'string' },
  boolean: { color: 0, label: 'boolean' },
  signal: { color: 0, label: 'signal' },
  data: { color: 0, label: 'data' },
};
/** State accent colors (nodes, devices, connections). */
export const states = { hover: 0, selected: 0, active: 0, error: 0, disabled: 0 };

const STORAGE_KEY = 'proto3d.theme';
let currentTheme = 'dark';
const listeners = new Set();

export function getTheme() { return currentTheme; }
/** Subscribe to theme changes: cb(themeName). Returns an unsubscribe function. */
export function onThemeChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** Switch palette. Mutates the live token objects, updates <html data-theme>, persists, notifies. */
export function setTheme(name, { persist = true } = {}) {
  const src = palettes[name] || palettes.dark;
  currentTheme = palettes[name] ? name : 'dark';
  for (const k of Object.keys(src)) if (!['categories', 'portTypes', 'states'].includes(k)) palette[k] = src[k];
  for (const k of Object.keys(categories)) categories[k].header = src.categories[k];
  for (const k of Object.keys(portTypes)) portTypes[k].color = src.portTypes[k];
  for (const k of Object.keys(states)) states[k] = src.states[k];
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = currentTheme;
  if (persist) { try { localStorage.setItem(STORAGE_KEY, currentTheme); } catch (_) { /* private mode */ } }
  listeners.forEach((cb) => cb(currentTheme));
  return currentTheme;
}
export function toggleTheme() { return setTheme(currentTheme === 'dark' ? 'light' : 'dark'); }
/** Read the persisted choice (falls back to dark) and apply it without notifying. */
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  const name = palettes[saved] ? saved : 'dark';
  const keep = new Set(listeners); listeners.clear();
  setTheme(name, { persist: false });
  keep.forEach((cb) => listeners.add(cb));
  return name;
}
initTheme();

export const sizes = {
  node: { width: 4, height: 2.4, depth: 0.5, radius: 0.14, header: 0.66, footer: 0.4 },
  port: { radius: 0.11, stem: 0.22, gap: 0.55, hoverScale: 1.5 },
  connection: {
    radius: { idle: 0.035, active: 0.05, selected: 0.06, invalid: 0.035 },
    ringScale: 2.4,
    tangent: 0.45,       // handle length as a fraction of endpoint distance
    tangentMin: 1.5,
    wavelength: 7,       // world units per brightness crest of the flow sheen
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
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
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
  /** Screen material driven by a per-device canvas texture (see drawScreen). */
  screen(texture) {
    return new THREE.MeshStandardMaterial({
      color: palette.screen, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.6,
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
/** A color option may be a palette key ('text' | 'textDim' | 'textOnHeader') or a CSS color. */
const resolveColor = (c) => (typeof c === 'string' && palette[c] !== undefined ? palette[c] : c);

function drawLabelCanvas(canvas, text, { color, weight }) {
  const ctx = canvas.getContext('2d');
  ctx.font = `${weight} ${FONT_PX}px ${typography.family}`;
  const pad = FONT_PX * 0.3;
  const textW = Math.ceil(ctx.measureText(text).width);
  canvas.width = Math.max(1, textW + pad * 2);
  canvas.height = Math.ceil(FONT_PX * 1.3);
  ctx.font = `${weight} ${FONT_PX}px ${typography.family}`;
  ctx.fillStyle = resolveColor(color);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + FONT_PX * 0.04);
}

export function makeLabel(text, opts = {}) {
  const o = {
    size: sizes.label.title, color: 'text', weight: 600, align: 'center', maxWidth: Infinity, ...opts,
  };
  const canvas = document.createElement('canvas');
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  mesh.userData.label = { text: String(text ?? ''), opts: o, canvas };
  mesh.userData.align = o.align;
  mesh.renderOrder = 2;
  refreshLabel(mesh);
  return mesh;
}

/** Re-render a label (new text and/or current palette). Resizes the plane to the text. */
export function refreshLabel(mesh, text) {
  const L = mesh.userData.label;
  if (!L) return;
  if (text !== undefined) L.text = String(text ?? '');
  drawLabelCanvas(L.canvas, L.text, L.opts);
  const tex = new THREE.CanvasTexture(L.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  if (mesh.material.map) mesh.material.map.dispose();
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;

  let worldH = L.opts.size;
  let worldW = worldH * (L.canvas.width / L.canvas.height);
  if (worldW > L.opts.maxWidth) { worldW = L.opts.maxWidth; worldH = worldW * (L.canvas.height / L.canvas.width); }
  mesh.geometry.dispose();
  mesh.geometry = new THREE.PlaneGeometry(worldW, worldH);
  mesh.userData.worldW = worldW;
}
export function setLabelText(mesh, text) {
  if (mesh.userData.label && mesh.userData.label.text === String(text ?? '')) return;
  refreshLabel(mesh, text);
}

/* ------------------------------------------------------------------ */
/* Device screens: a canvas per device, lit-glass gradient + live text */
/* ------------------------------------------------------------------ */
export const SCREEN_W = 384, SCREEN_H = 240;
/**
 * Draw a device screen. `lines` is an array of strings (empty → abstract UI bars).
 * `accent` is a hex number used for the status dot / bars.
 */
export function drawScreen(canvas, { title = '', lines = [], accent = 0x8fb6ff } = {}) {
  canvas.width = SCREEN_W; canvas.height = SCREEN_H;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
  grad.addColorStop(0, hex(palette.screenGlow));
  grad.addColorStop(0.55, palette.screenMid);
  grad.addColorStop(1, palette.screenDeep);
  g.fillStyle = grad; g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  // status bar
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, SCREEN_W, 34);
  g.fillStyle = hex(accent); g.beginPath(); g.arc(22, 17, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = `600 17px ${typography.family}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(title, 38, 18);
  if (!lines.length) {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 4; i++) g.fillRect(28, 62 + i * 40, 200 - i * 34, 14);
    return;
  }
  g.fillStyle = palette.screenText;
  g.font = `500 24px ${typography.mono}`;
  const maxChars = 26;
  lines.slice(0, 5).forEach((ln, i) => {
    const s = String(ln); g.fillText(s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s, 28, 70 + i * 38);
  });
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
