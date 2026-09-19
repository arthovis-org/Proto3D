// theme.js — single source of truth for the visual language.
// Design tokens (colors, sizes, spacing) + small factories (materials, labels, shadows).
// Two palettes (dark / light) live here; `palette`, `categories`, `portTypes` and `states`
// are mutated in place on theme change so every module keeps reading the same bindings.
import * as THREE from 'three';

/** Scale: 1 scene unit = 10 cm. A small node is 36 cm wide. */
export const UNIT_CM = 10;

const CATEGORY_KEYS = ['media', 'text', 'data', 'input', 'logic', 'action', 'transform', 'layout', 'output', 'project', 'devices'];
const TYPE_KEYS = ['number', 'text', 'boolean', 'data', 'media', 'event', 'any'];

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
    deviceBody: 0x1c2333,
    deviceFrame: 0x2b3648,
    keyboard: 0x121824,
    portStem: 0x3a465c,
    skyLight: 0xb8c7e0,
    groundLight: 0x141a26,
    shadowAlpha: 1.0,
    groupFill: 0x5aa9ff,
    groupFillAlpha: 0.07,
    groupEdge: 0x5aa9ff,
    text: '#e8eef8',
    textDim: '#93a0b6',
    textOnHeader: '#f3f6fb',
    // 2D faces drawn on node bodies and device screens
    faceBg: '#0f1626',
    faceCard: '#182236',
    faceText: '#eaf1ff',
    faceDim: '#8b9ab5',
    faceAccent: '#5aa9ff',
    faceGrid: 'rgba(255,255,255,0.08)',
    // project-management surfaces: translucent column panels, card slabs, sticky default
    pmColumn: 0x1a2a3d, pmColumnAlpha: 0.55, pmCard: 0x243149, pmCardText: '#eaf1ff', pmCardDim: '#8b9ab5', pmRail: 0x2a3a52, pmToday: 0x5aa9ff,
    screenTop: '#1c3a78',
    screenBottom: '#0f1f45',
    categories: {
      media: 0x6b3a2c, text: 0x6b5726, data: 0x4a3f7e, input: 0x2b6b4a, logic: 0x2a587e,
      action: 0x7a3a5a, transform: 0x3a5382, layout: 0x465a6e, output: 0x5a4b91, project: 0x2a6a63, devices: 0x2a3446,
    },
    portTypes: { number: 0x2dd4bf, text: 0xf5b942, boolean: 0xe25aa6, data: 0x8b7cf6, media: 0xff8a5b, event: 0xf4f6fa, any: 0x9aa7bb },
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
    deviceBody: 0x8b96a8,
    deviceFrame: 0x6b778b,
    keyboard: 0x55606f,
    portStem: 0x8390a5,
    skyLight: 0xffffff,
    groundLight: 0x8a94a6,
    shadowAlpha: 0.55,
    groupFill: 0x2b7fe0,
    groupFillAlpha: 0.08,
    groupEdge: 0x2b7fe0,
    text: '#1b2230',
    textDim: '#4f5c70',
    textOnHeader: '#0f1620',
    faceBg: '#f7f9fd',
    faceCard: '#e6ebf3',
    faceText: '#1b2230',
    faceDim: '#5d6b82',
    faceAccent: '#2b7fe0',
    faceGrid: 'rgba(0,0,0,0.08)',
    pmColumn: 0xd8dfea, pmColumnAlpha: 0.7, pmCard: 0xffffff, pmCardText: '#1b2230', pmCardDim: '#5d6b82', pmRail: 0xb9c3d3, pmToday: 0x2b7fe0,
    screenTop: '#26468a',
    screenBottom: '#172a55',
    categories: {
      media: 0xe0a68f, text: 0xdcc088, data: 0xb7a8ea, input: 0x8fd1ad, logic: 0x93bde0,
      action: 0xdd9dbb, transform: 0x9cb3e4, layout: 0xa9bccb, output: 0xb7a8ea, project: 0x8fd0c8, devices: 0xb0bbcd,
    },
    portTypes: { number: 0x0f9f8f, text: 0xc07f0c, boolean: 0xc2388a, data: 0x6a5cd6, media: 0xd9633a, event: 0x48556b, any: 0x6b7788 },
    states: { hover: 0x6f8bb0, selected: 0x2b7fe0, active: 0x2b7fe0, error: 0xd93848, disabled: 0xa2abb8 },
  },
};

/** Live tokens (mutated in place by setTheme). */
export const palette = {};
/** Header tints per component category (kept subtle: hue, not saturation). */
export const categories = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, { header: 0 }]));
/** Port / connection types. One color each, used everywhere. */
export const portTypes = Object.fromEntries(TYPE_KEYS.map((k) => [k, { color: 0, label: k }]));
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
  for (const k of Object.keys(categories)) categories[k].header = src.categories[k] ?? src.headerDefault;
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
  /** Node footprints by size class: width and face height (0 = no face area). */
  nodeSize: { S: { width: 3.6, faceH: 0 }, M: { width: 4.6, faceH: 2.2 }, L: { width: 6.4, faceH: 3.4 }, XL: { width: 9, faceH: 4.6 } },
  node: { depth: 0.5, radius: 0.14, header: 0.66, footer: 0.42, portTop: 0.3, faceGap: 0.18, minHeight: 2.0 },
  port: {
    radius: 0.11, stem: 0.22, gap: 0.55, hoverScale: 1.5,
    pin: { w: 0.26, h: 0.2, d: 0.11 },   // event pins: pentagon chevron pointing in the flow direction (+X)
    shellScale: 1.32,                    // hollow outline around an unconnected / highlighted port
    optionalScale: 0.85,
  },
  connection: {
    radius: { inactive: 0.024, idle: 0.035, active: 0.05, selected: 0.06, invalid: 0.035 },
    ringScale: 3.0,
    grabReach: 0.9,      // world units from either end that act as a grab handle (re-route / disconnect)
    snapReach: 1.2,      // magnetic snap distance while dragging a cable

    tangent: 0.45,       // handle length as a fraction of endpoint distance
    tangentMin: 1.5,
    wavelength: 7,       // world units per brightness crest of the flow sheen
    lane: 0.2,           // vertical fan-out per lane for connections sharing a port
  },
  label: { title: 0.46, small: 0.2, port: 0.17 },
  /** Layout rule: pitch between node origins on the loose grid. */
  spacing: { minGapFactor: 1.5, pitchX: 10, pitchZ: 6.5 },
  device: {
    phone:   { w: 1.6, h: 3.2, d: 0.18 },
    tablet:  { w: 3.4, h: 2.4, d: 0.2 },
    laptop:  { w: 4.2, h: 2.8, d: 0.16, baseDepth: 3 },
    monitor: { w: 5.2, h: 3.0, d: 0.3, standH: 1.2 },
  },
  face: { pxPerUnit: 120 },
  lod: { far: 110, hysteresis: 10 },
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
  port(type = 'any') {
    const c = (portTypes[type] || portTypes.any).color;
    return new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 1,
    });
  },
  /** Back-face outline shell around a port: the hollow ring of an unconnected port, the glow of a compatible target. */
  portShell(type = 'any') {
    const c = (portTypes[type] || portTypes.any).color;
    return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, side: THREE.BackSide, depthWrite: false });
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
  /** Face / screen material driven by a canvas texture. */
  face(texture, { emissive = 0.55 } = {}) {
    return new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: emissive,
      roughness: 0.35, metalness: 0.05,
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
  drawLabelCanvas(L.canvas, L.text || ' ', L.opts);
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
  mesh.userData.worldH = worldH;
}
export function setLabelText(mesh, text) {
  if (mesh.userData.label && mesh.userData.label.text === String(text ?? '')) return;
  refreshLabel(mesh, text);
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
