// theme.js — single source of truth for the visual language.
// Design tokens (colors, sizes, spacing, type scale) + small factories (materials, labels, shadows).
// Two palettes (dark / light) live here; `palette`, `categories`, `portTypes` and `states`
// are mutated in place on theme change so every module keeps reading the same bindings.
//
// Look and feel (this round): bodies are extruded rounded rectangles with a tiny bevel
// (geometry.js) in a satin MeshPhysicalMaterial lit by a soft procedural environment; faces are
// flat, modern UI on canvas — a slim category accent line instead of a header band, Inter type,
// 8-pt spacing, thin dividers, chips and thin rounded bars. Dark = deep navy greys, light =
// warm off-white with soft shadows.
import * as THREE from 'three';

/** Scale: 1 scene unit = 10 cm. A small node is 36 cm wide. */
export const UNIT_CM = 10;

const CATEGORY_KEYS = ['media', 'text', 'data', 'input', 'logic', 'action', 'transform', 'layout', 'output', 'project', 'devices'];
const TYPE_KEYS = ['number', 'text', 'boolean', 'data', 'media', 'event', 'any'];
/** Project subtypes of `data`: their own hues so a person cable never looks like a stats cable. */
const SUBTYPE_KEYS = ['person', 'task', 'tasks', 'board', 'milestone', 'stats', 'layout'];

export const palettes = {
  dark: {
    bg: 0x0b0f17,
    fog: 0x0b0f17,
    gridMajor: 0x27354c,
    gridMinor: 0x18202f,
    ground: 0x111827,
    body: 0x1a2231,          // node / board / device body panels
    bodyDisabled: 0x171b23,
    headerDefault: 0x2c3a52,
    screen: 0x0f1626,
    screenGlow: 0x3f6fd6,
    deviceBody: 0x1f2736,
    deviceFrame: 0x2a3446,
    keyboard: 0x141a26,
    portStem: 0x3a465c,
    skyLight: 0xb8c7e0,
    groundLight: 0x141a26,
    shadowAlpha: 0.9,
    groupFill: 0x5aa9ff,
    groupFillAlpha: 0.06,
    groupEdge: 0x5aa9ff,
    text: '#e8eef8',
    textDim: '#8e9bb1',
    textOnHeader: '#eef3fb',
    // 2D faces drawn on node bodies and device screens
    faceBg: '#161d2a',           // the face card (sits a touch lighter than the body)
    faceCard: '#1f2838',         // inner sections / tiles
    faceLine: 'rgba(255,255,255,0.08)',
    faceText: '#eaf1ff',
    faceDim: '#8b9ab5',
    faceAccent: '#5aa9ff',
    faceGrid: 'rgba(255,255,255,0.06)',
    faceGood: '#34c99a', faceWarn: '#f5b942', faceBad: '#ff5c6c',
    // project-management surfaces: frosted column panels, card slabs, rail, today marker
    pmColumn: 0x22304a, pmColumnAlpha: 0.42, pmCard: 0x27334a, pmCardText: '#eaf1ff', pmCardDim: '#8b9ab5', pmRail: 0x2a3a52, pmToday: 0x5aa9ff,
    screenTop: '#182643', screenBottom: '#0f1a30',
    env: ['#4a5c80', '#1c2536', '#0a0d14'],   // environment gradient: sky, horizon, ground
    categories: {
      media: 0xff8a5b, text: 0xf5b942, data: 0x8b7cf6, input: 0x34c99a, logic: 0x5aa9ff,
      action: 0xe25aa6, transform: 0x7d9cc6, layout: 0xb59cf5, output: 0x9aa7bb, project: 0x2dd4bf, devices: 0x6f8bb0,
    },
    portTypes: { number: 0x2dd4bf, text: 0xf5b942, boolean: 0xe25aa6, data: 0x8b7cf6, media: 0xff8a5b, event: 0xf4f6fa, any: 0x9aa7bb },
    subtypes: { person: 0xff8fa3, task: 0x34c99a, tasks: 0x34c99a, board: 0x6d7cff, milestone: 0xffd36b, stats: 0x7d9cc6, layout: 0xb59cf5 },
    states: { hover: 0x9fb3d1, selected: 0x5aa9ff, active: 0x5aa9ff, error: 0xff4d5e, disabled: 0x3a4252 },
  },
  light: {
    bg: 0xf1eee8,
    fog: 0xf1eee8,
    gridMajor: 0xc8c3ba,
    gridMinor: 0xdedad2,
    ground: 0xe8e4dc,
    body: 0xfbfaf7,
    bodyDisabled: 0xe6e3dd,
    headerDefault: 0xd9d4cb,
    screen: 0x16223a,
    screenGlow: 0x4d7fe0,
    deviceBody: 0xcfcac1,
    deviceFrame: 0x6b727e,
    keyboard: 0x8a909b,
    portStem: 0x9a9fa8,
    skyLight: 0xffffff,
    groundLight: 0x9a958c,
    shadowAlpha: 0.5,
    groupFill: 0x2b7fe0,
    groupFillAlpha: 0.07,
    groupEdge: 0x2b7fe0,
    text: '#1c2130',
    textDim: '#6a7180',
    textOnHeader: '#1c2130',
    faceBg: '#ffffff',
    faceCard: '#f1efe9',
    faceLine: 'rgba(28,33,48,0.10)',
    faceText: '#1c2130',
    faceDim: '#6a7180',
    faceAccent: '#2b7fe0',
    faceGrid: 'rgba(0,0,0,0.06)',
    faceGood: '#13906a', faceWarn: '#b8830c', faceBad: '#d93848',
    pmColumn: 0xe9e5dd, pmColumnAlpha: 0.75, pmCard: 0xffffff, pmCardText: '#1c2130', pmCardDim: '#6a7180', pmRail: 0xcfc9bf, pmToday: 0x2b7fe0,
    screenTop: '#26468a', screenBottom: '#172a55',
    env: ['#ffffff', '#e3ded4', '#8f8a80'],
    categories: {
      media: 0xd9633a, text: 0xc07f0c, data: 0x6a5cd6, input: 0x13906a, logic: 0x2b7fe0,
      action: 0xc2388a, transform: 0x4d6a94, layout: 0x7a5fd0, output: 0x6b7788, project: 0x0f9f8f, devices: 0x556a8a,
    },
    portTypes: { number: 0x0f9f8f, text: 0xc07f0c, boolean: 0xc2388a, data: 0x6a5cd6, media: 0xd9633a, event: 0x48556b, any: 0x6b7788 },
    subtypes: { person: 0xd6456a, task: 0x13906a, tasks: 0x13906a, board: 0x4655d6, milestone: 0xb88a12, stats: 0x4d6a94, layout: 0x7a5fd0 },
    states: { hover: 0x6f8bb0, selected: 0x2b7fe0, active: 0x2b7fe0, error: 0xd93848, disabled: 0xa2abb8 },
  },
};

/** Live tokens (mutated in place by setTheme). */
export const palette = {};
/** Accent colour per component category (the slim line on top of a node). */
export const categories = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, { header: 0 }]));
/** Port / connection types. One color each, used everywhere. */
export const portTypes = Object.fromEntries(TYPE_KEYS.map((k) => [k, { color: 0, label: k }]));
/** Project subtypes (person, tasks, board, milestone, stats, layout): a colour each, falling back to `data`. */
export const subtypes = Object.fromEntries(SUBTYPE_KEYS.map((k) => [k, { color: 0, label: k }]));
/** The colour of a port: its subtype's hue when it has one, else its base type's. */
export const portColorFor = (type, subtype) => (subtype && subtypes[subtype] ? subtypes[subtype].color : (portTypes[type] || portTypes.any).color);
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
  for (const k of Object.keys(src)) if (!['categories', 'portTypes', 'subtypes', 'states'].includes(k)) palette[k] = src[k];
  for (const k of Object.keys(categories)) categories[k].header = src.categories[k] ?? src.headerDefault;
  for (const k of Object.keys(portTypes)) portTypes[k].color = src.portTypes[k];
  for (const k of Object.keys(subtypes)) subtypes[k].color = src.subtypes?.[k] ?? src.portTypes.data;
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
  nodeSize: { S: { width: 3.6, faceH: 0 }, M: { width: 4.6, faceH: 2.4 }, L: { width: 6.4, faceH: 3.6 }, XL: { width: 9, faceH: 4.6 } },
  /** Node body: a thin extruded card. `header` is the title row, `pad` the 8-pt-grid margin (0.24 = ~29 px on the face). */
  node: { depth: 0.16, radius: 0.32, header: 0.78, footer: 0.44, portTop: 0.22, faceGap: 0.12, pad: 0.28, minHeight: 1.7, accent: 0.045, bevel: 0.02 },
  port: {
    radius: 0.095, stem: 0.24, gap: 0.55, hoverScale: 1.5,
    pin: { w: 0.24, h: 0.18, d: 0.09 },   // event pins: pentagon chevron pointing in the flow direction (+X)
    shellScale: 1.3,                     // hollow outline around an unconnected / highlighted port
    optionalScale: 0.85,
    /** Multi inputs: a vertical rounded rectangle with one slot per cable (Blender multi-input style). */
    slot: { w: 0.18, h: 0.3, pad: 0.14, d: 0.14, fillW: 0.09, fillH: 0.15, margin: 0.05, hoverScale: 1.1, radius: 0.035 },
  },
  connection: {
    radius: { inactive: 0.022, idle: 0.032, active: 0.046, selected: 0.056, invalid: 0.032 },
    ringScale: 3.0,
    grabReach: 0.9,      // world units from either end that act as a grab handle (re-route / disconnect)
    snapReach: 1.2,      // magnetic snap distance while dragging a cable
    tangent: 0.45,       // handle length as a fraction of endpoint distance
    tangentMin: 1.5,
    wavelength: 7,       // world units per brightness crest of the flow sheen
    lane: 0.2,           // vertical fan-out per lane for connections sharing a port
  },
  label: { title: 0.4, small: 0.2, port: 0.165, caption: 0.15 },
  /** Layout rule: pitch between node origins on the loose grid. */
  spacing: { minGapFactor: 1.5, pitchX: 10, pitchZ: 6.5 },
  device: {
    phone:   { w: 1.6, h: 3.3, d: 0.14, radius: 0.24, bezel: 0.07 },
    tablet:  { w: 3.4, h: 2.5, d: 0.14, radius: 0.18, bezel: 0.1 },
    laptop:  { w: 4.2, h: 2.8, d: 0.1, baseDepth: 3, radius: 0.1, bezel: 0.1 },
    monitor: { w: 5.4, h: 3.1, d: 0.12, standH: 1.2, radius: 0.1, bezel: 0.1 },
  },
  face: { pxPerUnit: 120 },
  /** Selection / hover outline: how much larger the shell is than the body (thin = 0.04 per side). */
  outline: { grow: 0.08 },
  lod: { far: 110, hysteresis: 10 },
};

/** Type: Inter with a system fallback stack (index.html loads Inter from Google Fonts when online). */
export const typography = {
  family: '"Inter", "SF Pro Text", "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  /** Face type scale in canvas px (120 px / unit): title 600, label 500, value 400; small caps carry letter-spacing. */
  scale: { title: 30, subtitle: 18, label: 17, value: 17, small: 14, caps: 12, big: 44 },
  weight: { title: 600, label: 500, value: 400, caps: 600 },
  capsSpacing: 0.08,   // em
};

/* ------------------------------------------------------------------ */
/* Materials factory                                                    */
/* ------------------------------------------------------------------ */
const SATIN = { roughness: 0.45, metalness: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.45 };
export const materials = {
  /** The body finish: satin physical material, low roughness on the bevel through the clearcoat, no gloss. */
  panel(color = palette.body, extra = {}) {
    return new THREE.MeshPhysicalMaterial({ color, ...SATIN, ...extra });
  },
  body(color = palette.body) { return materials.panel(color); },
  header(color = palette.headerDefault) { return materials.panel(color); },
  /** Flat unlit accent (category line, chips). */
  accent(color) { return new THREE.MeshBasicMaterial({ color }); },
  port(type = 'any', color = null) {
    const c = color ?? (portTypes[type] || portTypes.any).color;
    return new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 1, envMapIntensity: 0.3,
    });
  },
  /** Back-face outline shell around a port: the hollow ring of an unconnected port, the glow of a compatible target. */
  portShell(type = 'any', color = null) {
    const c = color ?? (portTypes[type] || portTypes.any).color;
    return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, side: THREE.BackSide, depthWrite: false });
  },
  portStem() {
    return new THREE.MeshStandardMaterial({ color: palette.portStem, roughness: 0.7 });
  },
  /** Thin outline used for hover / selected / error: a back-face shell 0.04 wider than the body. */
  rim(color = states.hover) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, side: THREE.BackSide, depthWrite: false,
    });
  },
  /** Face / screen material driven by a canvas texture; `transparent` lets a canvas keep rounded corners. */
  face(texture, { emissive = 0.55, transparent = true } = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: emissive,
      roughness: 0.6, metalness: 0.0, envMapIntensity: 0.15,
    });
    if (transparent) { m.map = texture; m.transparent = true; m.alphaTest = 0.02; }
    return m;
  },
  device(color = palette.deviceBody) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 0.6 });
  },
  /** Frosted translucent panel (board columns). */
  frosted(color = palette.pmColumn, opacity = palette.pmColumnAlpha) {
    return new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.85, metalness: 0, depthWrite: false, envMapIntensity: 0.2 });
  },
};

/* ------------------------------------------------------------------ */
/* Labels: canvas texture on a plane so text lives in 3D               */
/* ------------------------------------------------------------------ */
const FONT_PX = 96;
/** A color option may be a palette key ('text' | 'textDim' | 'textOnHeader') or a CSS color. */
const resolveColor = (c) => (typeof c === 'string' && palette[c] !== undefined ? palette[c] : c);

function drawLabelCanvas(canvas, text, { color, weight, caps = false, spacing = 0 }) {
  const ctx = canvas.getContext('2d');
  const t = caps ? String(text).toUpperCase() : text;
  ctx.font = `${weight} ${FONT_PX}px ${typography.family}`;
  const pad = FONT_PX * 0.3;
  const extra = spacing ? spacing * FONT_PX * Math.max(0, t.length - 1) : 0;
  const textW = Math.ceil(ctx.measureText(t).width + extra);
  canvas.width = Math.max(1, textW + pad * 2);
  canvas.height = Math.ceil(FONT_PX * 1.3);
  ctx.font = `${weight} ${FONT_PX}px ${typography.family}`;
  ctx.fillStyle = resolveColor(color);
  ctx.textBaseline = 'middle';
  if (spacing) {
    // letter-spaced small caps: draw glyph by glyph
    let x = pad;
    ctx.textAlign = 'left';
    for (const ch of t) { ctx.fillText(ch, x, canvas.height / 2 + FONT_PX * 0.04); x += ctx.measureText(ch).width + spacing * FONT_PX; }
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(t, canvas.width / 2, canvas.height / 2 + FONT_PX * 0.04);
  }
}

export function makeLabel(text, opts = {}) {
  const o = {
    size: sizes.label.title, color: 'text', weight: 600, align: 'center', maxWidth: Infinity, caps: false, spacing: 0, ...opts,
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
/** Place a label so its left edge sits at `x` (labels are centred planes). */
export function alignLabelLeft(mesh, x, y, z) { mesh.position.set(x + mesh.userData.worldW / 2, y, z); }
export function alignLabelRight(mesh, x, y, z) { mesh.position.set(x - mesh.userData.worldW / 2, y, z); }

/** Shared radial-gradient texture for soft fake contact shadows. */
let shadowTex = null;
export function makeShadowBlob(w, d) {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
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
