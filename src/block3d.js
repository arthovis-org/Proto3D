// block3d.js — Block3D: everything a node and a device share. A block is a registered
// component instance in the scene: definition, params, per-instance state, typed ports,
// a rim for hover / selected / error, a fake contact shadow, canvas labels, an optional live
// canvas face and level-of-detail blending. Node3D and Device3D only add geometry.
import * as THREE from 'three';
import {
  palette, portTypes, states, sizes, materials, makeLabel, refreshLabel, setLabelText, makeShadowBlob, onThemeChange,
} from './theme.js';
import { defaultParams, clone } from './core/component.js';
import { formatValue } from './core/types.js';
import { clear as clearFace } from './faces.js';

let nextUid = 1;
export const genUid = () => `b${(nextUid++).toString(36)}${Date.now().toString(36).slice(-3)}`;
/** Keep uids unique after a load. */
export function bumpUidCounter(n) { nextUid = Math.max(nextUid, n + 1); }

const ballGeo = new THREE.SphereGeometry(sizes.port.radius, 20, 14);
const stemGeo = new THREE.CylinderGeometry(sizes.port.radius * 0.45, sizes.port.radius * 0.45, sizes.port.stem, 10);
let portSeq = 1;

/**
 * Shared port anatomy: a short stem out of the face + a colored sphere.
 * `owner` is the block (or a collapsed group) hosting it. Returns a plain port record that the
 * engine annotates with `value`, `changedAt`, `pulse`, `rate`.
 */
export function createPort(owner, { key, label, type = 'any', dir = 'in', multi = false, optional = false }) {
  const sign = dir === 'in' ? -1 : 1;
  const group = new THREE.Group();
  const stem = new THREE.Mesh(stemGeo, materials.portStem());
  stem.rotation.z = Math.PI / 2;
  stem.position.x = sign * sizes.port.stem * 0.5;
  const ball = new THREE.Mesh(ballGeo, materials.port(type));
  ball.position.x = sign * sizes.port.stem;
  if (multi) ball.scale.set(1.15, 1.15, 1.15);
  group.add(stem, ball);
  const port = {
    id: portSeq++, owner, key, label: label || key, name: label || key, type, dir, multi, optional, group, mesh: ball, stem,
    color: (portTypes[type] || portTypes.any).color,
    baseEmissive: 0.35,
    value: undefined, changedAt: -1, lastPulseAt: -1, pulse: null, rate: 0, changes: 0,
    disabled: false, hovered: false,
    proxy: null,   // set while the owner sits in a collapsed group: connections attach to the proxy
    getWorldPosition(target = new THREE.Vector3()) {
      if (port.proxy) return port.proxy.getWorldPosition(target);
      return ball.getWorldPosition(target);
    },
    setHover(on) {
      port.hovered = on;
      const s = (on ? sizes.port.hoverScale : 1) * (multi ? 1.15 : 1);
      ball.scale.setScalar(s);
      ball.material.emissiveIntensity = on ? 1.2 : port.baseEmissive;
    },
    setDisabled(on) {
      port.disabled = on;
      const c = on ? states.disabled : port.color;
      ball.material.color.setHex(c);
      ball.material.emissive.setHex(c);
      ball.material.emissiveIntensity = on ? 0.05 : port.baseEmissive;
    },
    refreshTheme() {
      port.color = (portTypes[type] || portTypes.any).color;
      stem.material.color.setHex(palette.portStem);
      port.setDisabled(port.disabled);
    },
  };
  ball.userData.port = port;
  stem.userData.port = port;
  return port;
}

export class Block3D extends THREE.Group {
  /**
   * @param {object} def   registered component definition
   * @param {object} [o]   { uid, title, params, state, enabled }
   */
  constructor(def, o = {}) {
    super();
    this.def = def;
    this.typeId = def.id;
    this.kind = def.device ? 'device' : 'node';
    this.uid = o.uid || genUid();
    this.title = o.title || def.label;
    this.params = { ...defaultParams(def), ...(o.params ? clone(o.params) : {}) };
    this.state = o.state ? clone(o.state) : {};
    this.enabled = o.enabled !== false;
    this.derivedState = 'idle';
    this.hovered = false;
    this.selected = false;
    this.inputs = [];
    this.outputs = [];
    this.labels = [];        // every canvas label (theme refresh)
    this.detailLabels = [];  // labels hidden at the far LOD
    this.rt = {};            // engine runtime annotations
    this.group = null;       // Group3D membership
    this.lod = 0;            // 0 = full detail, 1 = far
    this.lodBlend = 0;       // animated 0..1
    this.face = null;
    this.faceDirty = true;
    this.subSelection = null;  // { kind, id } — a child pickable (card, column, item) the panel edits
    this.world = null;
    this._offTheme = onThemeChange(() => this.refreshTheme());
  }

  get ports() { return [...this.inputs, ...this.outputs]; }
  getPort(key, dir) { return (dir === 'in' ? this.inputs : dir === 'out' ? this.outputs : this.ports).find((p) => p.key === key) || null; }

  _addPort(spec, x, y, z = 0) {
    const port = createPort(this, spec);
    port.group.position.set(x, y, z);
    this.add(port.group);
    (spec.dir === 'in' ? this.inputs : this.outputs).push(port);
    return port;
  }

  /* ---------- face: a live canvas on the body ---------- */
  /** Create the face canvas + plane; the subclass positions the returned mesh. */
  _initFace(w, h, { emissive = 0.55, mesh = true } = {}) {
    const px = sizes.face.pxPerUnit;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * px); canvas.height = Math.round(h * px);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const g = canvas.getContext('2d');
    clearFace(g, canvas.width, canvas.height);
    const plane = mesh ? new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials.face(texture, { emissive })) : null;
    if (plane) { plane.userData.face = this; plane.userData.block = this; plane.renderOrder = 1; }
    this.face = { canvas, texture, g, mesh: plane, w, h, lastDrawAt: -1e9 };
    return plane;
  }
  /** Engine hook after each evaluation: refresh footer + face when the content changed. */
  afterEvaluate(ctx, t) {
    if (this.def.face && this.face) {
      const F = this.def.face;
      const changed = this.ports.some((p) => p.changedAt === t || p.lastPulseAt === t);
      const live = F.live && t - this.face.lastDrawAt >= 1 / (F.fps || 8);
      if (changed || live || this.faceDirty || this.face.lastDrawAt < 0) this.renderFace(ctx, t);
    }
    if (this.setFooter) {
      const text = this.enabled === false ? 'disabled' : this.def.footer ? this.def.footer(this._faceCtx(ctx)) : this._defaultFooter();
      this.setFooter(text);
    }
  }
  _faceCtx(ctx) { return { ...ctx, outputs: this.rt.outputs || {}, inputs: ctx?.inputs || this.rt.inputs || {}, params: this.params, state: this.state, instance: this, palette }; }
  _defaultFooter() {
    const outs = this.outputs.filter((p) => p.type !== 'event');
    if (outs.length) return outs.map((p) => `${outs.length > 1 ? p.label + ' ' : ''}${formatValue(p.value, 18)}`).join(' · ');
    return this.inputs.map((p) => formatValue(p.value, 18)).join(' · ');
  }
  renderFace(ctx, t = this.rt.ctx?.time ?? 0) {
    const F = this.def.face;
    if (!F || !this.face) return;
    const { canvas, g, texture } = this.face;
    try { F.render(g, canvas.width, canvas.height, this._faceCtx(ctx || this.rt.ctx || {})); }
    catch (e) { clearFace(g, canvas.width, canvas.height); this.rt.error = e.message; }
    texture.needsUpdate = true;
    this.face.lastDrawAt = t;
    this.faceDirty = false;
  }
  /** Pointer event on the face: ev = { type: 'down'|'up'|'click'|'move'|'drag', u, v, button }. */
  onFacePointer(ev) {
    const F = this.def.face;
    if (!F?.onPointer) return false;
    const handled = F.onPointer(this._faceCtx(this.rt.ctx), ev);
    if (handled) this.faceDirty = true;
    return handled !== false;
  }
  /** Emit a pulse on an output from outside evaluation (face click, key press, timer). */
  emit(key, payload) { return this.world?.engine ? this.world.engine.emit(this, key, payload) : false; }

  /* ---------- state / look ---------- */
  setTitle(text) { this.title = String(text); if (this.titleLabel) setLabelText(this.titleLabel, this.title); this.faceDirty = true; }
  setDerivedState(s) { if (this.derivedState !== s) { this.derivedState = s; this.applyVisual(); this.faceDirty = this.faceDirty || this.kind === 'device'; } }
  setHover(on) { if (this.hovered !== on) { this.hovered = on; this.applyVisual(); } }
  setSelected(on) { if (!on) this.subSelection = null; if (this.selected !== on) { this.selected = on; this.applyVisual(); } }
  /** Rim priority: error > selected > hover > active. Ports grey out when disabled. */
  _rimLook() {
    const s = this.derivedState;
    if (s === 'error') return [states.error, 0.6];
    if (this.selected) return [states.selected, 0.55];
    if (this.hovered && s !== 'disabled') return [states.hover, 0.3];
    if (s === 'active') return [states.active, 0.2];
    return [null, 0];
  }
  applyVisual() {
    const disabled = this.derivedState === 'disabled';
    this.ports.forEach((p) => p.setDisabled(disabled));
    const [rim, opacity] = this._rimLook();
    if (this.rim) {
      this.rim.visible = rim !== null;
      if (rim !== null) { this.rim.material.color.setHex(rim); this.rim.material.opacity = opacity; }
    }
  }
  setLOD(level, distance = 0) { this.lod = level; this.lodDistance = distance; }
  /** Map-label rule for far titles: grow with distance so they stay legible in the overview. */
  _farTitleScale() { return THREE.MathUtils.clamp((this.lodDistance || 0) / 50, 1.3, 3.6); }
  /** Per-frame LOD blend: detail labels fade with distance. Subclasses add their own. */
  _updateLOD(dt) {
    const target = this.lod ? 1 : 0;
    if (Math.abs(this.lodBlend - target) >= 0.002) this.lodBlend += (target - this.lodBlend) * Math.min(1, dt * 6);
    else this.lodBlend = target;
    this._applyLOD();
  }
  _applyLOD() {
    const a = 1 - this.lodBlend;
    for (const l of this.detailLabels) { l.material.opacity = a; l.visible = a > 0.02; }
  }
  _updateShadow() {
    const sy = this.scale.y || 1;
    this.shadow.position.y = -this.position.y / sy + 0.005;
    this.shadow.quaternion.copy(this.quaternion).invert();
    this.shadow.rotateX(-Math.PI / 2);
    const fade = THREE.MathUtils.clamp(1 - this.position.y / 12, 0.25, 1) * palette.shadowAlpha;
    this.shadow.material.opacity = fade;
    this.shadow.scale.setScalar(1 + this.position.y * 0.06);
  }
  refreshTheme() {
    this.ports.forEach((p) => p.refreshTheme());
    this.labels.forEach((l) => refreshLabel(l));
    this.faceDirty = true;
    this.applyVisual();
  }
  /** World-space AABB used by connection routing (rotation ignored on purpose: cheap and stable). */
  getAABB(box = new THREE.Box3()) {
    const s = this.scale.x || 1;
    const hw = this.width / 2 * s, hh = this.height / 2 * s, hd = Math.max(this.depth / 2, 0.4) * s;
    const cy = this.position.y + (this.kind === 'device' ? hh : 0);
    box.min.set(this.position.x - hw, cy - hh, this.position.z - hd);
    box.max.set(this.position.x + hw, cy + hh, this.position.z + hd);
    return box;
  }
  /** Ground-plane footprint (w × d) for group frames, ghosts and free-slot search. */
  footprint() { const s = this.scale.x || 1; return { w: this.width * s, d: Math.max(this.depth, this.kind === 'device' ? 2.6 : 0.5) * s }; }

  serialize() {
    let state = {};
    try { state = JSON.parse(JSON.stringify(this.state)); } catch (_) { state = {}; }
    return {
      uid: this.uid, type: this.typeId, title: this.title, params: clone(this.params), state, enabled: this.enabled,
      position: [+this.position.x.toFixed(3), +this.position.y.toFixed(3), +this.position.z.toFixed(3)],
      rotationY: +this.rotation.y.toFixed(4), scale: +this.scale.x.toFixed(3),
    };
  }

  dispose() {
    this._offTheme?.();
    this.def.onDestroy?.(this);
    this.traverse((obj) => {
      if (obj === this) return;
      obj.geometry?.dispose?.();
      if (obj.material) {
        obj.material.map?.dispose?.();
        obj.material.emissiveMap?.dispose?.();
        obj.material.dispose?.();
      }
    });
  }
}
