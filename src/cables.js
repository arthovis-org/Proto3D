// cables.js — the global cable settings (View → Cables ▸, the Cables section of the Workspace
// panel, the command palette; localStorage["proto3d.cables.v1"], like the theme — never part of a
// document):
//   style          smooth (Bezier / spline), orthogonal (Manhattan: axis-aligned runs with 90° turns)
//                  or straight (direct segments); applies to every cable in 3D and 2D, to bundle
//                  trunks and to the preview while a cable is dragged
//   cornerRadius   0..1 units of rounding on orthogonal corners (0 = sharp)
//   thickness      thin | normal | thick — a multiplier on every cable radius
//   bundle         parallel cables that run close together merge into one neutral trunk (bundles.js)
//   bundleDistance how close (units) two cables must run, over at least 40 % of their length, to bundle
//   showWaypoints  always show the route handles (else on hover / selection only)
// `cables.version` bumps on every change so a cable can tell cheaply that it must re-route.
const KEY = 'proto3d.cables.v1';

/** [id, label, description] of the styles the menu, the panel and the palette offer. */
export const CABLE_STYLES = [
  ['smooth', 'Smooth', 'flowing curves that leave and enter the pins horizontally'],
  ['orthogonal', 'Orthogonal', 'axis-aligned runs with 90° turns, like a schematic'],
  ['straight', 'Straight', 'direct segments from pin to pin'],
];
/** [id, label, radius multiplier]. */
export const THICKNESSES = [['thin', 'Thin', 0.72], ['normal', 'Normal', 1], ['thick', 'Thick', 1.45]];
/** Presets the menus offer; the panel takes any value in range. */
export const CORNER_RADII = [0, 0.2, 0.35, 0.6, 1];
export const BUNDLE_DISTANCES = [0.6, 0.9, 1.2, 1.8, 2.5];
const CORNER_RANGE = [0, 1], DISTANCE_RANGE = [0.2, 4];
const DEFAULTS = { style: 'smooth', cornerRadius: 0.35, thickness: 'normal', bundle: true, bundleDistance: 1.2, showWaypoints: false };
const clamp = (v, [lo, hi]) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, +(+v).toFixed(3))) : null);

let state = { ...DEFAULTS };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s && typeof s === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (typeof s[k] === typeof DEFAULTS[k]) state[k] = s[k];
    if (!CABLE_STYLES.some(([id]) => id === state.style)) state.style = DEFAULTS.style;
    if (!THICKNESSES.some(([id]) => id === state.thickness)) state.thickness = DEFAULTS.thickness;
    state.cornerRadius = clamp(state.cornerRadius, CORNER_RANGE) ?? DEFAULTS.cornerRadius;
    state.bundleDistance = clamp(state.bundleDistance, DISTANCE_RANGE) ?? DEFAULTS.bundleDistance;
  }
} catch (_) { /* ignore */ }
let version = 1;
const listeners = new Set();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ } };
const notify = () => { version += 1; listeners.forEach((cb) => cb({ ...state })); };

export const cables = {
  get style() { return state.style; },
  get cornerRadius() { return state.cornerRadius; },
  get thickness() { return state.thickness; },
  /** The radius multiplier of the current thickness. */
  get thicknessScale() { return (THICKNESSES.find(([id]) => id === state.thickness) || THICKNESSES[1])[2]; },
  get bundle() { return state.bundle; },
  get bundleDistance() { return state.bundleDistance; },
  get showWaypoints() { return state.showWaypoints; },
  /** Bumps on every change (cables compare it to know they must re-route). */
  get version() { return version; },
  /** A copy of every setting (the panel, tests). */
  get state() { return { ...state }; },
  /** The label of the current style. */
  get styleLabel() { return (CABLE_STYLES.find(([id]) => id === state.style) || CABLE_STYLES[0])[1]; },
  /**
   * Change one setting: `style` (smooth | orthogonal | straight), `cornerRadius` (0..1), `thickness`
   * (thin | normal | thick), `bundle`, `bundleDistance` (0.2..4) or `showWaypoints`. Out-of-range
   * numbers are clamped, unknown values ignored.
   */
  setOption(key, v) {
    if (!(key in DEFAULTS)) return;
    if (key === 'style') { if (!CABLE_STYLES.some(([id]) => id === v)) return; }
    else if (key === 'thickness') { if (!THICKNESSES.some(([id]) => id === v)) return; }
    else if (key === 'cornerRadius' || key === 'bundleDistance') { v = clamp(+v, key === 'cornerRadius' ? CORNER_RANGE : DISTANCE_RANGE); if (v === null) return; }
    else v = !!v;
    if (v === state[key]) return;
    state[key] = v; persist(); notify();
  },
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  /** One line for tooltips and toasts: "Cables · orthogonal · corners 0.35 · bundled within 1.2". */
  summary() {
    const parts = [state.style];
    if (state.style === 'orthogonal') parts.push(`corners ${state.cornerRadius}`);
    if (state.thickness !== 'normal') parts.push(state.thickness);
    parts.push(state.bundle ? `bundled within ${state.bundleDistance}` : 'not bundled');
    if (state.showWaypoints) parts.push('waypoints shown');
    return `Cables · ${parts.join(' · ')}`;
  },
};
