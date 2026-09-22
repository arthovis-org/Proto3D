// plan.js — the 2D editing mode switch (the "plan view") and the grid-snapping setting.
//
// 2D mode is a *view* setting: the camera goes orthographic and top-down, every block lies flat
// (Block3D.applyPlan rotates it −90° about X so its front — title, face, ports — faces up: the
// same card, the same canvas, no re-render), cables become flat splines low over the floor
// (routing.js `planar`), LOD is off and the gizmo is hidden. Positions are shared with 3D: the
// plan's x / z are the room's x / z, y is left untouched. Nothing about it is saved in a document.
//
// Snapping is a separate, persisted group of settings (View → Snap ▸, the magnet toggle in the
// menu bar, the M key, localStorage["proto3d.snap.v1"]) that applies in 3D and 2D alike: a master (off by default for a new visitor; a stored record keeps the choice)
// switch plus independent toggles — grid (a dragged block's centre lands on `gridSize` units, Ctrl
// halves the pitch), objects (its edges / centres line up with neighbours', with guides, and win
// over the grid within their tolerance), ports (a pin lands level with the pin it is wired to so
// the cable runs straight), rotation (gizmo steps of `rotationStep` degrees, 15 by default) and
// scale (steps of `scaleStep`, 0.25 by default); both increments are editable (presets or any
// number) and persisted with the toggles. Shift held during a drag turns snapping off for that
// drag; everything off means free movement.
const SNAP_KEY = 'proto3d.snap.v1';

let planOn = false;
const planListeners = new Set();
export function isPlanOn() { return planOn; }
/** Turn the plan view on / off; listeners (blocks, groups, cables, the workspace, main.js) follow. */
export function setPlan(v) { v = !!v; if (v === planOn) return; planOn = v; planListeners.forEach((cb) => cb(planOn)); }
export function togglePlan() { setPlan(!planOn); return planOn; }
export function onPlanChange(cb) { planListeners.add(cb); return () => planListeners.delete(cb); }

/** Polar angle of the plan camera: not exactly 0 so `lookAt` keeps a stable up vector. */
export const PLAN_PHI = 0.004;
/** Height of a planar cable's body over the floor (its ends still rise to the ports). */
export const PLAN_CABLE_Y = 0.35;

/** Grid pitches the size select offers (units). */
export const GRID_SIZES = [0.25, 0.5, 1, 2];
/** Default gizmo steps while rotation / scale snapping is on (rad, scale factor). */
export const ROTATION_STEP = Math.PI / 12, SCALE_STEP = 0.25;
/** Increment presets the menus and the panel offer (degrees, scale factor); any positive number can be typed instead. */
export const ROTATION_STEPS = [5, 10, 15, 30, 45, 90], SCALE_STEPS = [0.05, 0.1, 0.25, 0.5, 1];
/** Bounds of the free increments: rotation 0.5°..180°, scale 0.01..4 (the gizmo clamps a block's scale to 0.2..4). */
const ROTATION_RANGE = [0.5, 180], SCALE_RANGE = [0.01, 4];
const SNAP_DEFAULTS = { on: false, grid: true, gridSize: 1, objects: true, ports: true, rotation: true, scale: true, rotationStep: 15, scaleStep: 0.25 };
const clampStep = (v, [lo, hi]) => (Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, +(+v).toFixed(4))) : null);
/** "15°", "7.5°" — an increment in degrees for menus, tooltips and the summary. */
export const fmtDeg = (d) => `${+(+d).toFixed(2)}°`;
export const fmtScale = (s) => String(+(+s).toFixed(3));
/** The kinds a toggle exists for, with their labels (menus, panel, tooltip). */
export const SNAP_KINDS = [['grid', 'Grid'], ['objects', 'Objects'], ['ports', 'Ports'], ['rotation', 'Rotation'], ['scale', 'Scale']];
let snapState = { ...SNAP_DEFAULTS };
try {
  const s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
  if (s && typeof s === 'object') {
    if (Number.isFinite(s.size) && !('gridSize' in s)) s.gridSize = s.size;   // the round-4 shape { on, size, fine }
    for (const k of Object.keys(SNAP_DEFAULTS)) if (typeof s[k] === typeof SNAP_DEFAULTS[k]) snapState[k] = s[k];
    if (!GRID_SIZES.includes(snapState.gridSize)) snapState.gridSize = SNAP_DEFAULTS.gridSize;
    snapState.rotationStep = clampStep(snapState.rotationStep, ROTATION_RANGE) ?? SNAP_DEFAULTS.rotationStep;
    snapState.scaleStep = clampStep(snapState.scaleStep, SCALE_RANGE) ?? SNAP_DEFAULTS.scaleStep;
  }
} catch (_) { /* ignore */ }
const snapListeners = new Set();
function persistSnap() { try { localStorage.setItem(SNAP_KEY, JSON.stringify(snapState)); } catch (_) { /* private mode */ } }
function notifySnap() { snapListeners.forEach((cb) => cb(snapState.on, { ...snapState })); }
export const snap = {
  /** The master switch. */
  get on() { return snapState.on; },
  get grid() { return snapState.grid; },
  get gridSize() { return snapState.gridSize; },
  get objects() { return snapState.objects; },
  get ports() { return snapState.ports; },
  get rotation() { return snapState.rotation; },
  get scale() { return snapState.scale; },
  /** The rotation increment in degrees (15 by default) and in radians (what the gizmo takes). */
  get rotationStep() { return snapState.rotationStep; },
  get rotationStepRad() { return snapState.rotationStep * Math.PI / 180; },
  /** The scale increment (0.25 by default). */
  get scaleStep() { return snapState.scaleStep; },
  /** Older names: the grid pitch and the finer (Ctrl) pitch. */
  get size() { return snapState.gridSize; },
  get fine() { return snapState.gridSize / 2; },
  /** A copy of every setting (the panel, tests). */
  get state() { return { ...snapState }; },
  set(on) { on = !!on; if (on === snapState.on) return; snapState.on = on; persistSnap(); notifySnap(); },
  toggle() { snap.set(!snapState.on); return snapState.on; },
  /**
   * Change one toggle (`grid | objects | ports | rotation | scale`), `gridSize` (one of GRID_SIZES),
   * `rotationStep` (degrees, 0.5..180) or `scaleStep` (0.01..4). Out-of-range increments are clamped, non-numbers ignored.
   */
  setOption(key, v) {
    if (key === 'on') { snap.set(v); return; }
    if (key === 'gridSize') { v = +v; if (!GRID_SIZES.includes(v) || v === snapState.gridSize) return; }
    else if (key === 'rotationStep' || key === 'scaleStep') { v = clampStep(+v, key === 'rotationStep' ? ROTATION_RANGE : SCALE_RANGE); if (v === null || v === snapState[key]) return; }
    else if (!(key in SNAP_DEFAULTS)) return;
    else { v = !!v; if (v === snapState[key]) return; }
    snapState[key] = v; persistSnap(); notifySnap();
  },
  /** Whether a kind is in effect right now: the master switch and its own toggle are both on. */
  active(kind) { return snapState.on && !!snapState[kind]; },
  onChange(cb) { snapListeners.add(cb); return () => snapListeners.delete(cb); },
  /** Snap a coordinate to the grid pitch (`fine` = half of it, Ctrl while dragging). */
  value(v, fine = false) { const p = fine ? snapState.gridSize / 2 : snapState.gridSize; return Math.round(v / p) * p; },
  /** An angle (rad) on `rotationStep` steps when rotation snapping is in effect. */
  rotationValue(rad) { const st = snap.rotationStepRad; return snap.active('rotation') ? Math.round(rad / st) * st : rad; },
  /** A scale on `scaleStep` steps when scale snapping is in effect (never below one step). */
  scaleValue(s) { const st = snapState.scaleStep; return snap.active('scale') ? Math.max(st, Math.round(s / st) * st) : s; },
  /** One line saying what is on: "Snap · grid 1 · objects · ports · rotation 15° · scale 0.25", "Snap on · every kind off" or "Snap off". */
  summary() {
    if (!snapState.on) return 'Snap off';
    const parts = SNAP_KINDS.filter(([k]) => snapState[k]).map(([k, l]) => (k === 'grid' ? `grid ${snapState.gridSize}` : k === 'rotation' ? `rotation ${fmtDeg(snapState.rotationStep)}` : k === 'scale' ? `scale ${fmtScale(snapState.scaleStep)}` : l.toLowerCase()));
    return parts.length ? `Snap · ${parts.join(' · ')}` : 'Snap on · every kind off';
  },
};
