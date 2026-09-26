// ui/ui-prefs.js — interface preferences: the UI scale and the sizes of the resizable regions
// (the Add rail, its flyout, the properties panel and the Help drawer at the panel's foot),
// persisted in localStorage["proto3d.ui.v1"] and applied as CSS custom properties on :root.
//
// How the scale works: every piece of chrome that is a direct child of <body> is drawn with CSS
// `zoom: var(--ui-scale)` (styles.css); the 3D viewport and the overlays that are pinned to things
// in the scene (the field editor, cable labels, the marquee, guides, tooltips on blocks, choosers)
// are left at 1 so the 3D view keeps its own pixels and projections stay exact. Region sizes are
// stored in unscaled CSS px — what the zoomed chrome lays itself out in — and the viewport's edges
// are those sizes times the scale. Code that places a zoomed element at a screen position (menus,
// the mini toolbar, the date picker) divides by `uiScale()`; `offsetWidth` of a zoomed element is
// unscaled, `getBoundingClientRect()` is on screen.
//
// Resizing (`attachResizer`): a thin handle on a region's edge, Blender style — drag to resize, the
// content reflows through container queries (styles.css), double-click resets that region, the
// arrow keys nudge it when the handle has focus.
const KEY = 'proto3d.ui.v1';
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const SCALE_RANGE = [0.75, 2];
/** Region sizes (unscaled px): default and bounds. */
export const REGIONS = {
  rail: { label: 'Add toolbar', def: 60, min: 44, max: 240, css: '--rail-w' },
  fly: { label: 'Add list', def: 300, min: 240, max: 640, css: '--fly-w' },
  panel: { label: 'Properties panel', def: 300, min: 240, max: 720, css: '--panel-w' },
  help: { label: 'Help drawer', def: 0, min: 120, max: 2000, css: '--help-h' },   // 0 = natural height (the drawer grows with its content)
};
const DEFAULTS = { scale: 1, rail: 60, fly: 300, panel: 300, help: 0 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let state = { ...DEFAULTS };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s && typeof s === 'object') for (const k of Object.keys(DEFAULTS)) if (Number.isFinite(s[k])) state[k] = s[k];
} catch (_) { /* private mode */ }
state.scale = clamp(state.scale, ...SCALE_RANGE);
for (const [k, R] of Object.entries(REGIONS)) if (!(k === 'help' && state.help === 0)) state[k] = clamp(state[k], R.min, R.max);

const listeners = new Set();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ } }

/** The current UI scale (1 = 100 %). */
export const uiScale = () => state.scale;
/** Screen px → the unscaled px a zoomed element is positioned in. */
export const toUi = (px) => px / state.scale;

/** The viewport always keeps at least this much of the window (screen px): wide regions give way on a small window. */
export const MIN_VIEWPORT = 320;
/**
 * The sizes actually drawn (unscaled px): the stored ones, shrunk when the rail and the panel would
 * leave the viewport under MIN_VIEWPORT (the panel gives way first, then the rail); the list never
 * runs past the window. The stored values are kept, so a larger window gets them back.
 */
export function effectiveSizes(s = state, width = typeof window !== 'undefined' ? window.innerWidth : 1600) {
  const W = width / s.scale, room = Math.max(0, W - MIN_VIEWPORT / s.scale);
  const panelShown = typeof document === 'undefined' || !document.body?.classList.contains('panel-hidden');
  let rail = s.rail, panel = s.panel;
  if (panelShown && rail + panel > room) panel = Math.max(REGIONS.panel.min, room - rail);
  if (rail + (panelShown ? panel : 0) > room) rail = Math.max(REGIONS.rail.min, room - (panelShown ? panel : 0));
  const fly = Math.max(REGIONS.fly.min, Math.min(s.fly, W - rail - 24));
  return { rail, panel, fly, help: s.help };
}
/** Write the custom properties and the rail's width classes. */
function apply() {
  const root = document.documentElement.style;
  const eff = effectiveSizes();
  root.setProperty('--ui-scale', String(state.scale));
  for (const [k, R] of Object.entries(REGIONS)) {
    if (k === 'help') root.setProperty(R.css, state.help ? `${Math.round(state.help)}px` : 'auto');
    else root.setProperty(R.css, `${Math.round(eff[k])}px`);
  }
  const b = document.body; if (!b) return;
  // the rail's content: icons only · icon over label · icon beside label
  b.classList.toggle('rail-icons', eff.rail < 56);
  b.classList.toggle('rail-wide', eff.rail >= 104);
  b.classList.toggle('help-sized', !!state.help);
}

export const uiPrefs = {
  get scale() { return state.scale; },
  get state() { return { ...state }; },
  /** Region size in unscaled px (`help`: 0 while it follows its content). */
  size(region) { return state[region]; },
  /** Region size on screen (scaled px), as drawn (see `effectiveSizes`). */
  screenSize(region) { return (effectiveSizes()[region] ?? state[region]) * state.scale; },
  setScale(v) {
    v = clamp(+v, ...SCALE_RANGE); if (!Number.isFinite(v)) return;
    v = Math.round(v * 100) / 100; if (v === state.scale) return;
    state.scale = v; apply(); persist(); listeners.forEach((cb) => cb({ ...state }, 'scale'));
  },
  setSize(region, v, { save = true } = {}) {
    const R = REGIONS[region]; if (!R || !Number.isFinite(+v)) return;
    v = region === 'help' && +v === 0 ? 0 : clamp(Math.round(+v), R.min, R.max);
    if (v === state[region]) return;
    state[region] = v; apply(); if (save) persist(); listeners.forEach((cb) => cb({ ...state }, region));
  },
  resetSize(region) { uiPrefs.setSize(region, DEFAULTS[region]); },
  /** Every region back to its default size (the scale stays). */
  resetLayout() { for (const k of Object.keys(REGIONS)) uiPrefs.setSize(k, DEFAULTS[k]); },
  save: persist,
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  apply,
};

/** "125 %" */
export const fmtScale = (s) => `${Math.round(s * 100)} %`;

/**
 * A drag handle on a region's edge.
 * @param {HTMLElement} host   the element the handle is appended to (positioned by CSS: `.rz.rz-<edge>`)
 * @param {object} o { region, edge: 'right' | 'left' | 'top', measure(): number (the region's current unscaled size), title? }
 */
export function attachResizer(host, { region, edge, measure = () => state[region], title }) {
  const h = document.createElement('div');
  h.className = `rz rz-${edge}`; h.tabIndex = 0;
  h.setAttribute('role', 'separator');
  h.setAttribute('aria-orientation', edge === 'top' ? 'horizontal' : 'vertical');
  h.setAttribute('aria-label', `Resize the ${REGIONS[region].label.toLowerCase()}`);
  h.title = title || `Drag to resize the ${REGIONS[region].label.toLowerCase()} · double-click resets`;
  const axis = edge === 'top' ? 'clientY' : 'clientX';
  const sign = edge === 'right' ? 1 : -1;   // right edge: dragging right grows; left / top edges: dragging left / up grows
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    h.setPointerCapture(e.pointerId);
    const start = e[axis], base = measure();
    h.classList.add('dragging'); document.body.classList.add('resizing', `resizing-${edge === 'top' ? 'y' : 'x'}`);
    const move = (ev) => uiPrefs.setSize(region, base + sign * (ev[axis] - start) / state.scale, { save: false });
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      h.classList.remove('dragging'); document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
      persist();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  h.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); uiPrefs.resetSize(region); });
  h.addEventListener('keydown', (e) => {
    const grow = edge === 'top' ? { ArrowUp: 1, ArrowDown: -1 } : { ArrowRight: sign, ArrowLeft: -sign };
    const d = grow[e.key]; if (!d) return;
    e.preventDefault(); e.stopPropagation();
    uiPrefs.setSize(region, measure() + d * (e.shiftKey ? 40 : 10));
  });
  host.appendChild(h);
  return h;
}

apply();
if (!document.body) document.addEventListener('DOMContentLoaded', apply, { once: true });
window.addEventListener('resize', apply);
