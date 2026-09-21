// controls/navigation.js — the camera controller and the preset state behind it.
//
// `Navigator` replaces OrbitControls with the same surface the rest of the app relies on
// (`target`, `update()`, `enabled`, `minDistance`, `maxDistance`, `maxPolarAngle`, damping,
// 'start' / 'end' events) but reads its bindings from the active navigation preset
// (controls/presets.js): which mouse button + modifiers orbit, pan, dolly or turn the camera,
// what the wheel does with Shift / Ctrl, whether right-drag + WASD flies (Unreal), and the
// keyboard views (numpad front / right / top, orthographic toggle, 15° steps). The controller
// only ever moves the camera: selection, marquee and block drags stay in interaction.js, which
// asks the same preset (`nav.resolveMouse(e)`, `nav.keyAction(e)`, `nav.isAddModifier(e)`) so
// the two never disagree about what a press means.
//
// The preset and its per-preset settings (invert orbit / zoom, sensitivities, zoom to cursor,
// fly speed) persist in localStorage["proto3d.nav.v1"], with two flags: `chosen` (the person picked
// a preset in some UI, so auto-detection stays quiet) and `asked` (the trackpad suggestion was
// dismissed once and never comes back).
//
// Trackpads: a wheel event with ctrlKey set while no physical Control key is down is a pinch
// (macOS / Windows / Linux browsers all report it that way); it dollies towards the cursor in every
// preset, scaled by its magnitude. Safari's gesturestart / gesturechange events (scale) do the
// same and suppress the Ctrl-wheel path while they run. Wheel deltas are normalised to pixels
// (deltaMode lines / pages) and clamped per event so a flick never spins the camera. The two-axis
// wheel actions `orbit` and `pan` (the Trackpad preset) read deltaX and deltaY. Trackpad-like
// wheel events (non-integer deltas, horizontal deltas without Shift, a pinch) are counted; after
// a few the controller dispatches one 'trackpad' event that ui/nav-hint.js turns into a suggestion.
//
// 2D editing mode (plan.js): `planMode` remaps the preset — orbit and turn are off (a middle or
// right button that would orbit pans instead, a left button that would orbit does nothing so the
// interaction layer can box-select), Space + left-drag pans, the wheel always zooms about the
// cursor (the preset's invert settings still apply) and the numpad views / steps are ignored.
// With `planLock` the camera is held top-down (theta 0, phi PLAN_PHI) every frame; the workspace
// flies the camera there first and locks afterwards.
import * as THREE from 'three';
import { PRESETS, DEFAULT_PRESET, presetSheet, bindingFor } from './presets.js';
import { PLAN_PHI } from '../plan.js';

const KEY = 'proto3d.nav.v1';
const CAMERA_ACTIONS = new Set(['orbit', 'pan', 'dolly', 'turn']);
const listeners = new Set();
let state = { preset: DEFAULT_PRESET, settings: {}, chosen: false, asked: false };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && PRESETS[s.preset]) state = { preset: s.preset, settings: s.settings || {}, chosen: !!s.chosen, asked: !!s.asked }; } catch (_) { /* ignore */ }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ } }
const modsMatch = (row, e) => {
  const m = row.mods || {};
  return !!m.shift === !!e.shiftKey && !!m.ctrl === !!(e.ctrlKey || e.metaKey) && !!m.alt === !!e.altKey;
};

/** Preset facade shared by the controller, the interaction layer, the panel and the help sheet. */
export const nav = {
  get preset() { return PRESETS[state.preset] || PRESETS[DEFAULT_PRESET]; },
  get presetId() { return this.preset.id; },
  /** Switch presets. Every caller is a UI the person used, so this also records `chosen` (auto-detection stays quiet from then on). */
  setPreset(id) { if (!PRESETS[id]) return; state.chosen = true; if (id === state.preset) { persist(); return; } state.preset = id; persist(); listeners.forEach((cb) => cb('preset', id)); },
  /** The person picked a preset explicitly at some point in this browser. */
  get chosen() { return !!state.chosen; },
  /** The trackpad suggestion was shown and dismissed; it never comes back. */
  get asked() { return !!state.asked; },
  markAsked() { state.asked = true; persist(); },
  /** Effective settings for the active preset (defaults overlaid with the user's changes). */
  get settings() { return { ...this.preset.settings, ...(state.settings[state.preset] || {}) }; },
  setSetting(key, value) { state.settings[state.preset] = { ...(state.settings[state.preset] || {}), [key]: value }; persist(); listeners.forEach((cb) => cb('setting', key)); },
  resetSettings() { delete state.settings[state.preset]; persist(); listeners.forEach((cb) => cb('setting', null)); },
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  /** What a pointer press means under the active preset: a camera action, marquee / marqueeAdd / contextSelect, or null. */
  resolveMouse(e) { const row = this.preset.mouse.find((r) => r.button === e.button && modsMatch(r, e)); return row ? row.action : null; },
  isCameraAction: (a) => CAMERA_ACTIONS.has(a),
  /** Shift+click (Blender, Maya, Simple) or Ctrl+click (Unreal) adds to the selection. */
  isAddModifier(e) { return this.preset.addModifier === 'ctrl' ? !!(e.ctrlKey || e.metaKey) : !!e.shiftKey; },
  /** The wheel action for a wheel event: dolly | panY | panX | orbit | pan | null. A pinch (`pinch: true`, decided by the controller) always dollies. */
  resolveWheel(e, { pinch = false } = {}) { if (pinch) return 'dolly'; const w = this.preset.wheel; return (e.shiftKey && w.shift) || ((e.ctrlKey || e.metaKey) && w.ctrl) || (!e.shiftKey && !e.ctrlKey && !e.metaKey && w.plain) || null; },
  /** The key action for a keydown, or null. Ctrl+Code also matches Meta. */
  keyAction(e) {
    for (const [action, codes] of Object.entries(this.preset.keys)) {
      for (const c of codes) {
        const parts = c.split('+'); const code = parts.pop();
        const want = { shift: parts.includes('Shift'), ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt') };
        if (e.code === code && !!e.shiftKey === want.shift && !!(e.ctrlKey || e.metaKey) === want.ctrl && !!e.altKey === want.alt) return action;
      }
    }
    return null;
  },
  sheet() { return presetSheet(this.preset); },
  binding(action) { return bindingFor(this.preset, action); },
  presets: PRESETS,
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _plane = new THREE.Plane(), _ray = new THREE.Raycaster();
const UP = new THREE.Vector3(0, 1, 0);
const EPS = 1e-6;
const WHEEL_LINE_PX = 16, WHEEL_CLAMP_PX = 80;      // deltaMode lines → pixels; per-event cap per axis for the two-axis wheel actions
const WHEEL_ORBIT = Math.PI / 1000;                 // radians per pixel of two-finger scroll: a swipe across a trackpad (~1000 px) is about half a turn
const PINCH_RATE = 0.01, PINCH_CLAMP_PX = 60;       // pinch dolly: scale = e^(deltaY × rate), deltaY capped
const TRACKPAD_EVENTS = 4;                          // trackpad-like wheel events before the 'trackpad' event fires

export class Navigator extends THREE.EventDispatcher {
  /** @param {THREE.PerspectiveCamera} camera  @param {HTMLElement} domElement  @param {object} o { onCameraSwap(camera) } */
  constructor(camera, domElement, { onCameraSwap = () => {} } = {}) {
    super();
    this.camera = camera; this.perspective = camera; this.ortho = null;
    this.domElement = domElement;
    this.onCameraSwap = onCameraSwap;
    this.target = new THREE.Vector3();
    this.enabled = true;
    this.enableDamping = true; this.dampingFactor = 0.1;
    this.minDistance = 3; this.maxDistance = 240;
    this.minPolarAngle = 0.02; this.maxPolarAngle = Math.PI * 0.495;
    this.spherical = new THREE.Spherical();
    this.sphericalDelta = new THREE.Spherical(0, 0, 0);
    this.turnDelta = { theta: 0, phi: 0 };
    this.panOffset = new THREE.Vector3();
    this.scale = 1;
    this.drag = null;          // { action, x, y, pointerId }
    this.flyKeys = new Set();
    this.flying = false;
    this.viewAnim = null;      // { t, d, theta0, theta1, phi0, phi1 }
    this.planMode = false;     // 2D editing mode: remapped mouse, no orbit (plan.js)
    this.planLock = false;     // hold the camera top-down (after the entry flight)
    this.spaceHeld = false;    // Space + left-drag pans in 2D
    this.ctrlHeld = false;     // a physical Control key is down (a Ctrl-wheel without it is a pinch)
    this.trackpadEvents = 0;   // trackpad-like wheel events seen (auto-detection; ui/nav-hint.js listens for 'trackpad')
    this.trackpadSeen = false; // the 'trackpad' event has fired
    this._gesture = null;      // Safari pinch: { scale } while a gesture runs (suppresses the Ctrl-wheel path)
    this._lastPointer = { x: 0, y: 0 };
    this._clock = performance.now();

    this._onDown = (e) => this.onPointerDown(e);
    this._onMove = (e) => this.onPointerMove(e);
    this._onUp = (e) => this.onPointerUp(e);
    this._onWheel = (e) => this.onWheel(e);
    this._onKeyDown = (e) => this.onKey(e, true);
    this._onKeyUp = (e) => this.onKey(e, false);
    domElement.addEventListener('pointerdown', this._onDown);
    domElement.addEventListener('pointermove', this._onMove);
    domElement.addEventListener('pointerup', this._onUp);
    domElement.addEventListener('pointercancel', this._onUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari reports a trackpad pinch as gesture events with a running `scale` (other browsers: a wheel with ctrlKey)
    this._onGesture = (e) => this.onGesture(e);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) domElement.addEventListener(t, this._onGesture, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => { this.flyKeys.clear(); this.spaceHeld = false; this.ctrlHeld = false; });
    this.update();
  }
  dispose() {
    const el = this.domElement;
    el.removeEventListener('pointerdown', this._onDown); el.removeEventListener('pointermove', this._onMove); el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointercancel', this._onUp); el.removeEventListener('wheel', this._onWheel);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) el.removeEventListener(t, this._onGesture);
    window.removeEventListener('keydown', this._onKeyDown); window.removeEventListener('keyup', this._onKeyUp);
  }

  get settings() { return nav.settings; }
  get distance() { return this.camera.position.distanceTo(this.target); }
  /** Current azimuth / polar angles of the camera around the target (radians). */
  get azimuth() { return Math.atan2(this.camera.position.x - this.target.x, this.camera.position.z - this.target.z); }
  get polar() { _v.copy(this.camera.position).sub(this.target); return Math.acos(THREE.MathUtils.clamp(_v.y / (_v.length() || 1), -1, 1)); }

  /* ---------- pointer ---------- */
  /** The preset's action under the 2D remap: no orbit / turn (middle / right → pan, left → nothing), Space + left → pan. */
  _planAction(action, e) {
    if (this.spaceHeld && e.button === 0) return 'pan';
    if (action === 'orbit' || action === 'turn') return e.button === 0 ? null : 'pan';
    return action;
  }
  /** What a press means for the camera right now (the interaction layer asks the same). */
  mouseAction(e) { const a = nav.resolveMouse(e); return this.planMode ? this._planAction(a, e) : a; }
  onPointerDown(e) {
    if (!this.enabled || this.drag) return;
    const action = this.mouseAction(e);
    if (!nav.isCameraAction(action)) return;
    this.drag = { action, x: e.clientX, y: e.clientY, pointerId: e.pointerId, button: e.button };
    this.flying = action === 'turn' && !!nav.preset.fly;
    try { this.domElement.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
    this.dispatchEvent({ type: 'start' });
  }
  onPointerMove(e) {
    this._lastPointer = { x: e.clientX, y: e.clientY };
    const d = this.drag; if (!d) return;
    if (!this.enabled) { this.drag = null; this.flying = false; return; }   // the interaction layer took the press (a block drag)
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    const s = this.settings, h = this.domElement.clientHeight || 1;
    const rot = (s.invertOrbit ? -1 : 1) * s.orbitSpeed * 2 * Math.PI / h;
    switch (d.action) {
      case 'orbit': this.sphericalDelta.theta -= dx * rot; this.sphericalDelta.phi -= dy * rot; break;
      case 'turn': this.turnDelta.theta -= dx * rot * 0.6; this.turnDelta.phi -= dy * rot * 0.6; break;
      case 'pan': this._panBy(dx, dy); break;
      case 'dolly': this.scale *= Math.pow(0.995, dy * (s.invertZoom ? -1 : 1) * 1.6); break;
      default: break;
    }
  }
  onPointerUp(e) {
    if (!this.drag) return;
    if (this.drag.pointerId === e.pointerId || e.type === 'pointercancel') {
      this.drag = null; this.flying = false;
      try { this.domElement.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.dispatchEvent({ type: 'end' });
    }
  }
  /** A wheel event that is really a pinch: ctrlKey without a physical Control key (and no Safari gesture running, which reports the same pinch itself). */
  isPinch(e) { return !!e.ctrlKey && !e.metaKey && !this.ctrlHeld && !this._gesture; }
  /** Wheel deltas in pixels (deltaMode lines / pages converted), each axis capped so a flick cannot spin the camera. */
  _wheelDeltas(e, cap = WHEEL_CLAMP_PX) {
    const k = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? (this.domElement.clientHeight || 600) : 1;
    const c = (v) => THREE.MathUtils.clamp(v * k, -cap, cap);
    return { dx: c(e.deltaX || 0), dy: c(e.deltaY || 0) };
  }
  /** Trackpad-like: a pinch, sideways scrolling without Shift, or small fractional pixel deltas. A mouse wheel (integer deltaY, no deltaX) never counts. */
  _noteTrackpad(e, pinch) {
    const like = pinch || (e.deltaX !== 0 && !e.shiftKey) || (e.deltaMode === 0 && e.deltaY !== 0 && Math.abs(e.deltaY) < 30 && !Number.isInteger(e.deltaY));
    if (!like || this.trackpadSeen) return;
    if (++this.trackpadEvents >= TRACKPAD_EVENTS) { this.trackpadSeen = true; this.dispatchEvent({ type: 'trackpad' }); }
  }
  onWheel(e) {
    if (!this.enabled) return;
    const pinch = this.isPinch(e);
    this._noteTrackpad(e, pinch);
    let action = nav.resolveWheel(e, { pinch });
    if (this.planMode && action === 'orbit') action = 'pan';   // 2D: a two-finger scroll pans (orbit is off)
    if (!action && !this.flying) return;
    e.preventDefault();
    const s = this.settings;
    const dir = (e.deltaY > 0 ? 1 : -1) * (s.invertZoom ? -1 : 1);
    if (this.flying) { nav.setSetting('flySpeed', THREE.MathUtils.clamp(s.flySpeed * (dir > 0 ? 0.8 : 1.25), 0.1, 10)); return; }
    if (action === 'dolly') {
      // a mouse wheel notch is one fixed step; a pinch scales with how far the fingers moved
      const k = pinch ? Math.exp(THREE.MathUtils.clamp(e.deltaY, -PINCH_CLAMP_PX, PINCH_CLAMP_PX) * PINCH_RATE * (s.invertZoom ? -1 : 1)) : Math.pow(0.95, -dir * 1.35);
      if (s.zoomToCursor || this.planMode) this._zoomTowards(e.clientX, e.clientY, k); else this.scale *= k;
      this.dispatchEvent({ type: 'start' });
    } else if (action === 'panY') this._panBy(0, -Math.sign(e.deltaY) * 40);
    else if (action === 'panX') this._panBy(-Math.sign(e.deltaY) * 40, 0);
    else if (action === 'orbit') {
      // two-finger scroll: the scene follows the fingers like a drag (natural scrolling reports the finger motion negated)
      const { dx, dy } = this._wheelDeltas(e);
      const rot = (s.invertOrbit ? -1 : 1) * s.orbitSpeed * WHEEL_ORBIT;
      this.sphericalDelta.theta += dx * rot; this.sphericalDelta.phi += dy * rot;
      this.dispatchEvent({ type: 'start' });
    } else if (action === 'pan') { const { dx, dy } = this._wheelDeltas(e); this._panBy(-dx, -dy); }
    this.dispatchEvent({ type: 'end' });
  }
  /** Safari trackpad pinch (gesturestart / gesturechange / gestureend): dolly towards the cursor by the scale ratio between events. */
  onGesture(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.type === 'gesturestart') { this._gesture = { scale: e.scale || 1 }; this._noteTrackpad({ deltaX: 0, deltaY: 0, deltaMode: 0 }, true); return; }
    if (e.type === 'gestureend') { this._gesture = null; this.dispatchEvent({ type: 'end' }); return; }
    if (!this._gesture || !e.scale) return;
    const s = this.settings;
    let k = this._gesture.scale / e.scale; this._gesture.scale = e.scale;
    if (s.invertZoom) k = 1 / k;
    k = THREE.MathUtils.clamp(k, 0.5, 2);
    if (s.zoomToCursor || this.planMode) this._zoomTowards(e.clientX, e.clientY, k); else this.scale *= k;
    this.dispatchEvent({ type: 'start' });
  }
  onKey(e, down) {
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.ctrlHeld = down;
    if (e.code === 'Space') {
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable || t.closest?.('.modal-backdrop'));
      if (!typing) { this.spaceHeld = down; if (this.planMode && down) e.preventDefault(); }
    }
    if (!nav.preset.fly) return;
    const code = e.code;
    if (!/^Key[WASDQE]$/.test(code)) return;
    if (!down) { this.flyKeys.delete(code); return; }
    if (!this.flying) return;
    this.flyKeys.add(code); e.preventDefault();
  }

  /* ---------- camera maths ---------- */
  /** Screen-space pan by pixels, scaled to world units at the target's distance (like OrbitControls). */
  _panBy(dx, dy) {
    const s = this.settings, el = this.domElement;
    const h = el.clientHeight || 1;
    let worldPerPx;
    if (this.camera.isOrthographicCamera) worldPerPx = (this.camera.top - this.camera.bottom) / this.camera.zoom / h;
    else worldPerPx = 2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov) / 2) / h;
    const k = worldPerPx * s.panSpeed;
    const m = this.camera.matrix;
    _v.setFromMatrixColumn(m, 0).multiplyScalar(-dx * k);   // camera X axis
    _v2.setFromMatrixColumn(m, 1).multiplyScalar(dy * k);   // camera Y axis
    this.panOffset.add(_v).add(_v2);
  }
  /** Dolly by `k` keeping the world point under the cursor fixed on screen. */
  _zoomTowards(cx, cy, k) {
    const r = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(ndc, this.camera);
    _v.copy(this.target).sub(this.camera.position).normalize();
    _plane.setFromNormalAndCoplanarPoint(_v, this.target);
    const P = _ray.ray.intersectPlane(_plane, _v2);
    if (P) this.panOffset.addScaledVector(P.sub(this.target), 1 - k);
    this.scale *= k;
  }
  /** Animate the camera to a spherical direction around the target (numpad views), radius kept. */
  viewTo(theta, phi, duration = 0.45) {
    if (this.planMode) return;   // the plan is always top-down
    const t0 = this.azimuth, p0 = THREE.MathUtils.clamp(this.polar, this.minPolarAngle, this.maxPolarAngle);
    let dt = theta - t0; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
    this.sphericalDelta.set(0, 0, 0);
    this.viewAnim = { t: 0, d: duration, theta0: t0, theta1: t0 + dt, phi0: p0, phi1: THREE.MathUtils.clamp(phi, this.minPolarAngle, this.maxPolarAngle) };
    this.dispatchEvent({ type: 'start' });
  }
  /** Orbit by a step (numpad 2 / 4 / 6 / 8). */
  rotateBy(dTheta, dPhi) { if (this.planMode) return; this.sphericalDelta.theta += dTheta; this.sphericalDelta.phi += dPhi; }
  /**
   * 2D editing mode. `on` remaps the mouse and lowers the polar clamp so the camera may go straight
   * down; `lock` (set by the workspace once its flight has landed) holds theta / phi every frame.
   */
  setPlanMode(on, { lock = false } = {}) {
    this.planMode = !!on;
    this.planLock = !!on && !!lock;
    this.minPolarAngle = on ? PLAN_PHI : 0.02;
    if (on) { this.sphericalDelta.set(0, 0, 0); this.turnDelta.theta = this.turnDelta.phi = 0; this.viewAnim = null; this.flying = false; }
  }
  /** Orthographic ↔ perspective, keeping the framing (the ortho frustum is derived from the distance). */
  setOrtho(on) {
    on = !!on;
    if (on === !!this.camera.isOrthographicCamera) return;
    const el = this.domElement, aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    if (on) {
      const halfH = this.distance * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov) / 2);
      this.ortho = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 600);
      this.ortho.position.copy(this.perspective.position); this.ortho.quaternion.copy(this.perspective.quaternion);
      this.camera = this.ortho;
    } else {
      this.perspective.position.copy(this.camera.position); this.perspective.quaternion.copy(this.camera.quaternion);
      this.camera = this.perspective; this.ortho = null;
    }
    this.onCameraSwap(this.camera);
    this.update();
  }
  get isOrtho() { return !!this.camera.isOrthographicCamera; }
  /** True while damping, a view animation or a fly key still moves the camera (tests wait on it). */
  get moving() { return !!this.viewAnim || Math.abs(this.sphericalDelta.theta) > 1e-5 || Math.abs(this.sphericalDelta.phi) > 1e-5 || Math.abs(this.scale - 1) > 1e-5 || this.panOffset.lengthSq() > 1e-10 || Math.abs(this.turnDelta.theta) > 1e-5 || Math.abs(this.turnDelta.phi) > 1e-5 || (this.flying && this.flyKeys.size > 0); }
  /** Keep aspect ratios in step with the viewport (called by the workspace on resize). */
  setAspect(aspect) { this.perspective.aspect = aspect; this.perspective.updateProjectionMatrix(); this._aspect = aspect; }

  /** Per frame: apply the damped deltas, fly, animate views, clamp, write the camera. */
  update() {
    const now = performance.now(); const dt = Math.min(0.1, (now - this._clock) / 1000); this._clock = now;
    const cam = this.camera, pos = cam.position;
    // frame-rate independent damping: dampingFactor is "per 60 Hz frame"
    const damp = this.enableDamping ? 1 - Math.pow(1 - this.dampingFactor, dt * 60) : 1;
    // fly: move camera and target together along the camera axes
    if (this.flying && this.flyKeys.size) {
      const sp = this.settings.flySpeed * Math.max(4, this.distance * 0.35) * dt;
      const m = cam.matrix;
      const move = new THREE.Vector3();
      if (this.flyKeys.has('KeyW')) move.add(_v.setFromMatrixColumn(m, 2).multiplyScalar(-sp));
      if (this.flyKeys.has('KeyS')) move.add(_v.setFromMatrixColumn(m, 2).multiplyScalar(sp));
      if (this.flyKeys.has('KeyA')) move.add(_v.setFromMatrixColumn(m, 0).multiplyScalar(-sp));
      if (this.flyKeys.has('KeyD')) move.add(_v.setFromMatrixColumn(m, 0).multiplyScalar(sp));
      if (this.flyKeys.has('KeyE')) move.y += sp;
      if (this.flyKeys.has('KeyQ')) move.y -= sp;
      pos.add(move); this.target.add(move);
    }
    // turn: rotate the view direction about the camera position (target swings around the camera)
    if (Math.abs(this.turnDelta.theta) > EPS || Math.abs(this.turnDelta.phi) > EPS) {
      const off = _v.copy(this.target).sub(pos);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta += this.turnDelta.theta * damp; sph.phi = THREE.MathUtils.clamp(sph.phi + this.turnDelta.phi * damp, 0.05, Math.PI - 0.05);
      off.setFromSpherical(sph);
      this.target.copy(pos).add(off);
      if (this.enableDamping) { this.turnDelta.theta *= 1 - damp; this.turnDelta.phi *= 1 - damp; } else this.turnDelta.theta = this.turnDelta.phi = 0;
      if (Math.abs(this.turnDelta.theta) < EPS) this.turnDelta.theta = 0; if (Math.abs(this.turnDelta.phi) < EPS) this.turnDelta.phi = 0;
    }
    const offset = _v.copy(pos).sub(this.target);
    this.spherical.setFromVector3(offset);
    if (this.viewAnim) {
      const a = this.viewAnim; a.t = Math.min(1, a.t + dt / a.d);
      const e = 1 - Math.pow(1 - a.t, 3);
      this.spherical.theta = a.theta0 + (a.theta1 - a.theta0) * e;
      this.spherical.phi = a.phi0 + (a.phi1 - a.phi0) * e;
      if (a.t >= 1) { this.viewAnim = null; this.dispatchEvent({ type: 'end' }); }
    } else {
      this.spherical.theta += this.sphericalDelta.theta * damp;
      this.spherical.phi += this.sphericalDelta.phi * damp;
    }
    if (this.planLock) { this.spherical.theta = 0; this.spherical.phi = PLAN_PHI; this.sphericalDelta.set(0, 0, 0); }
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, this.minPolarAngle, this.maxPolarAngle);
    this.spherical.makeSafe();
    this.spherical.radius = THREE.MathUtils.clamp(this.spherical.radius * (this.enableDamping ? Math.pow(this.scale, damp) : this.scale), this.minDistance, this.maxDistance);
    if (this.enableDamping) { this.target.addScaledVector(this.panOffset, damp); this.panOffset.multiplyScalar(1 - damp); }
    else { this.target.add(this.panOffset); this.panOffset.set(0, 0, 0); }
    if (this.target.y < 0) this.target.y = 0;   // never look under the floor
    offset.setFromSpherical(this.spherical);
    pos.copy(this.target).add(offset);
    cam.lookAt(this.target);
    if (this.enableDamping) {
      this.sphericalDelta.theta *= 1 - damp; this.sphericalDelta.phi *= 1 - damp; this.scale = 1 + (this.scale - 1) * (1 - damp);
      if (Math.abs(this.sphericalDelta.theta) < EPS) this.sphericalDelta.theta = 0; if (Math.abs(this.sphericalDelta.phi) < EPS) this.sphericalDelta.phi = 0;
      if (Math.abs(this.scale - 1) < EPS) this.scale = 1;
      if (this.panOffset.lengthSq() < EPS * EPS) this.panOffset.set(0, 0, 0);
    } else { this.sphericalDelta.set(0, 0, 0); this.scale = 1; }
    if (cam.isOrthographicCamera) {
      const el = this.domElement, aspect = this._aspect || (el.clientWidth || 1) / (el.clientHeight || 1);
      const halfH = this.spherical.radius * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov) / 2);
      cam.left = -halfH * aspect; cam.right = halfH * aspect; cam.top = halfH; cam.bottom = -halfH; cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    return true;
  }
}
