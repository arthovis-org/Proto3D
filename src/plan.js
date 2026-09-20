// plan.js — the 2D editing mode switch (the "plan view") and the grid-snapping setting.
//
// 2D mode is a *view* setting: the camera goes orthographic and top-down, every block lies flat
// (Block3D.applyPlan rotates it −90° about X so its front — title, face, ports — faces up: the
// same card, the same canvas, no re-render), cables become flat splines low over the floor
// (routing.js `planar`), LOD is off and the gizmo is hidden. Positions are shared with 3D: the
// plan's x / z are the room's x / z, y is left untouched. Nothing about it is saved in a document.
//
// Snapping is a separate, persisted setting (View → Snap to grid, localStorage["proto3d.snap.v1"])
// that also applies in 3D when on: a dragged block's position lands on the grid pitch (`size`,
// 1 unit; Ctrl while dragging uses `fine`, 0.5; Shift disables snapping for that drag) and on
// the edges / centres of neighbouring blocks (alignment guides, interaction.js).
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

let snapState = { on: true, size: 1, fine: 0.5 };
try { const s = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); if (s && typeof s.on === 'boolean') snapState = { ...snapState, ...s }; } catch (_) { /* ignore */ }
const snapListeners = new Set();
function persistSnap() { try { localStorage.setItem(SNAP_KEY, JSON.stringify(snapState)); } catch (_) { /* private mode */ } }
export const snap = {
  get on() { return snapState.on; },
  get size() { return snapState.size; },
  get fine() { return snapState.fine; },
  set(on) { on = !!on; if (on === snapState.on) return; snapState.on = on; persistSnap(); snapListeners.forEach((cb) => cb(on)); },
  toggle() { snap.set(!snapState.on); return snapState.on; },
  onChange(cb) { snapListeners.add(cb); return () => snapListeners.delete(cb); },
  /** Snap a coordinate to the pitch (`fine` = the finer grid). */
  value(v, fine = false) { const p = fine ? snapState.fine : snapState.size; return Math.round(v / p) * p; },
};
