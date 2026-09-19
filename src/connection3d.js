// connection3d.js — Connection3D: a tube along a routed cubic Bezier from an output port to an
// input port. Direction is shown by one continuous flow: a long, soft sinusoidal brightness
// crest travelling along the tube at constant velocity (plus a faint stream of soft dashes).
// Looks are derived from data: inactive (carries nothing) is thin and dim, active (value
// changed within ~1.5 s) is thicker and brighter, invalid (type mismatch) is red and dashed.
// Hovering another connection dims this one to ~25 %; selecting a block dims every cable that
// does not touch it to 40 %.
//
// Either end may be a free point instead of a port: that is the preview while a cable is being
// dragged (from an output forwards, or from an input backwards). Both ends of a real link are
// grab handles: the tube within `sizes.connection.grabReach` of an end (and the end ring) picks
// as a "connection end" so the interaction layer can detach and re-route it.
import * as THREE from 'three';
import { portTypes, states, sizes, onThemeChange, portColorFor } from './theme.js';
import { compatiblePorts } from './core/types.js';
import { cableVisibleFor } from './wiring.js';
import { routeCurve, laneInfo } from './routing.js';

let flowEnabled = true;
let flowSpeed = 1;
/** Global toggle / multiplier for the flow animation (toolbar, panel). */
export function setFlowEnabled(on) { flowEnabled = on; }
export function isFlowEnabled() { return flowEnabled; }
export function setFlowSpeed(v) { flowSpeed = Math.max(0, v); }
export function getFlowSpeed() { return flowSpeed; }

const VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 color; uniform float travel; uniform float tubeLen; uniform float wavelength;
  uniform float baseAlpha; uniform float glow; uniform float dashed; uniform float dim;
  varying vec2 vUv; varying vec3 vNormalW;
  const float TAU = 6.28318530718;
  void main() {
    float d = vUv.x * tubeLen - travel;
    float band = 0.5 + 0.5 * sin(TAU * d / wavelength);
    band = band * band * band;
    float dash = 0.5 + 0.5 * sin(TAU * d / (wavelength * 0.16));
    dash = smoothstep(0.3, 1.0, dash) * 0.16;
    float shade = 0.7 + 0.3 * clamp(dot(vNormalW, normalize(vec3(0.4, 1.0, 0.6))), 0.0, 1.0);
    vec3 c = color * (0.5 + (1.1 * band + dash) * glow) * shade;
    float a = baseAlpha + 0.3 * band * glow;
    if (dashed > 0.5) {
      float k = step(0.5, fract(vUv.x * tubeLen * 1.6));
      a = mix(0.12, baseAlpha, k); c = color * shade * 0.9;
    }
    gl_FragColor = vec4(c, clamp(a * dim, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const ringGeo = new THREE.TorusGeometry(1, 0.22, 8, 24);
const burstGeo = new THREE.SphereGeometry(1, 12, 10);
const MAX_BURSTS = 6;
const isPort = (x) => !!(x && x.kind === 'port');

export class Connection3D extends THREE.Group {
  /**
   * @param {object|THREE.Vector3} from  a port record (dir 'out') or a free point (preview dragged backwards)
   * @param {object|THREE.Vector3} to    a port record (dir 'in') or a free point (preview)
   */
  constructor(from, to, opts = {}) {
    super();
    this.kind = 'connection';
    this.uid = opts.uid || `c${Math.random().toString(36).slice(2, 8)}`;
    this.from = isPort(from) ? from : null;
    this.fromPoint = isPort(from) ? null : from.clone();
    this.to = isPort(to) ? to : null;
    this.toPoint = isPort(to) ? null : to.clone();
    this.type = (this.from || this.to).type;
    this.subtype = (this.from || this.to).subtype || null;
    this.compat = this.from && this.to ? compatiblePorts(this.from, this.to) : 'ok';
    this.valid = this.compat !== 'invalid';
    this.derivedState = this.valid ? 'inactive' : 'invalid';
    this.hovered = false;
    this.hoveredEnd = null;   // 'from' | 'to' while the pointer is over a grab handle
    this.selected = false;
    this.dimHover = false;    // another connection is hovered
    this.dimSelect = false;   // a block that this link does not touch is selected
    this.far = false;
    this.value = undefined;
    this.velocity = 1.2;
    this.world = opts.world || null;
    this.color = new THREE.Color(this._typeColor());

    this.uniforms = {
      color: { value: this.color.clone() },
      travel: { value: 0 },
      tubeLen: { value: 10 },
      wavelength: { value: sizes.connection.wavelength },
      baseAlpha: { value: 0.75 },
      glow: { value: 0.9 },
      dashed: { value: 0 },
      dim: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true });
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.tube.userData.connection = this;
    this.add(this.tube);

    // a fat invisible tube makes the thin cable easy to hover and grab (raycast ignores visibility)
    this.pickTube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
    this.pickTube.userData.connection = this;
    this.pickTube.visible = false;
    this.add(this.pickTube);

    this.outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: states.selected, transparent: true, opacity: 0.45, side: THREE.BackSide, depthWrite: false,
    }));
    this.outline.visible = false;
    this.add(this.outline);

    // end caps: rings at both ends double as grab handles
    this.rings = [0, 1].map((end) => {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.9 }));
      r.userData.connection = this; r.userData.end = end === 0 ? 'from' : 'to';
      this.add(r);
      return r;
    });

    // token bursts: a bright bead runs the length of an event link whenever a pulse passes
    this.bursts = [];
    this._seenPulseAt = this.from?.lastPulseAt ?? -1;
    this._p0 = new THREE.Vector3(); this._p3 = new THREE.Vector3();
    this._radius = 0;
    this._layoutVersion = -1;
    this.rebuild(true);
    this._applyLook();
    this._offTheme = onThemeChange(() => this.refreshTheme());
  }

  /** True for a real link (both ends are ports). */
  get complete() { return !!(this.from && this.to); }
  /**
   * Visibility = what the owner asked for (collapsed groups hide internal links) AND the wiring
   * switch (wiring.js): with wiring off a cable shows only when both of its blocks show their ports.
   */
  get visible() { return this._vis !== false && cableVisibleFor(this); }
  set visible(v) { this._vis = !!v; }
  get dimmed() { return this.dimHover || this.dimSelect; }

  _typeColor() {
    // a coerced link (number → text) is drawn in the destination's colour: that is what arrives;
    // a subtyped port (person, tasks…) lends the cable its own hue
    const p = this.compat === 'coerce' && this.to ? this.to : (this.from || this.to);
    return p ? portColorFor(p.type, p.subtype) : portTypes.any.color;
  }
  /** Which slot of a multi input this cable ends in: its order among the cables into that port; a preview takes the next free one. */
  slotIndex() {
    const to = this.to;
    if (!to || !to.multi) return -1;
    const i = this.world ? this.world.linkIndex(this) : -1;
    return i >= 0 ? i : (to.links || 0);
  }

  /* ---------- preview endpoints ---------- */
  /** Move the free end (`side` = 'from' | 'to') to a point. */
  setPreviewPoint(side, point) {
    if (side === 'from') { this.fromPoint = point.clone(); this.from = null; } else { this.toPoint = point.clone(); this.to = null; }
    this.compat = 'ok'; this.rebuild(true);
  }
  /** Attach the free end to a port (snap). */
  setPreviewPort(side, port) {
    if (side === 'from') { this.from = port; this.fromPoint = null; } else { this.to = port; this.toPoint = null; }
    this.compat = this.from && this.to ? compatiblePorts(this.from, this.to) : 'ok';
    this.rebuild(true);
  }
  /** Legacy helpers (forward preview). */
  setPreviewTarget(point) { this.setPreviewPoint('to', point); }
  setTargetPort(port) { this.setPreviewPort('to', port); }

  _endpoints() {
    if (this.from) this.from.getWorldPosition(_a); else _a.copy(this.fromPoint);
    if (this.to) this.to.getWorldPosition(_b, this.slotIndex()); else _b.copy(this.toPoint);
    return [_a, _b];
  }
  /** World position of one end ('from' | 'to'). */
  endPosition(side, target = new THREE.Vector3()) { return target.copy(side === 'from' ? this._p0 : this._p3); }
  /** Which end (if any) a world point is close enough to grab; null in the middle of the cable. */
  endNear(point, reach = sizes.connection.grabReach) {
    const d0 = point.distanceTo(this._p0), d3 = point.distanceTo(this._p3);
    if (d0 > reach && d3 > reach) return null;
    return d0 <= d3 ? 'from' : 'to';
  }

  /** Rebuild the tube when endpoints moved, the world layout changed or when forced. */
  rebuild(force = false) {
    const [p0, p3] = this._endpoints();
    const lv = this.world ? this.world.layoutVersion : 0;
    const r = this._targetRadius();
    if (!force && lv === this._layoutVersion && Math.abs(r - this._radius) < 1e-6
      && p0.distanceToSquared(this._p0) < 1e-8 && p3.distanceToSquared(this._p3) < 1e-8) return;
    this._p0.copy(p0); this._p3.copy(p3); this._layoutVersion = lv; this._radius = r;

    const world = this.world;
    const skip = new Set([this.from?.owner, this.to?.owner].filter(Boolean));
    const curve = routeCurve(p0, p3, {
      lanes: world && this.complete ? laneInfo(this, world.connections) : null,
      obstacles: world ? world.nodes : [],
      skip,
    });
    this.curve = curve;
    const dist = p0.distanceTo(p3);
    const segs = Math.max(24, Math.min(110, Math.round(dist * 4)));
    this.tube.geometry.dispose();
    this.tube.geometry = new THREE.TubeGeometry(curve, segs, r, 8, false);
    this.pickTube.geometry.dispose();
    this.pickTube.geometry = new THREE.TubeGeometry(curve, Math.max(12, Math.round(segs / 2)), Math.max(r * 3, 0.16), 6, false);
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.TubeGeometry(curve, segs, r + 0.04, 8, false);
    this.uniforms.tubeLen.value = curve.getLength();

    const z = new THREE.Vector3(0, 0, 1);
    this.rings[0].position.copy(p0); this.rings[0].quaternion.setFromUnitVectors(z, curve.getTangent(0));
    this.rings[1].position.copy(p3); this.rings[1].quaternion.setFromUnitVectors(z, curve.getTangent(1));
    this._scaleRings();
  }
  _scaleRings() {
    const rs = this._radius * sizes.connection.ringScale;
    this.rings.forEach((rg) => rg.scale.setScalar(rs * (this.hoveredEnd === rg.userData.end ? 1.7 : 1)));
  }

  /** Point at the middle of the path (hover label anchor). */
  midpoint(target = new THREE.Vector3()) { return this.curve ? this.curve.getPoint(0.5, target) : target.copy(this._p0).lerp(this._p3, 0.5); }

  _targetRadius() {
    const r = sizes.connection.radius;
    let v = this.selected ? r.selected : this.derivedState === 'active' ? r.active : this.derivedState === 'inactive' ? r.inactive : r.idle;
    if (this.far) v *= 0.8;
    return v;
  }

  /** Engine writes the derived state: inactive | idle | active | invalid. */
  setDerivedState(s) {
    if (this.derivedState === s) return;
    this.derivedState = s;
    this.valid = s !== 'invalid';
    this.velocity = s === 'active' ? 1.2 + Math.min(this.from?.rate || 0, 10) * 0.45 : s === 'idle' ? 1.2 : 0.3;
    this._applyLook();
  }
  setSelected(on) { this.selected = on; this._applyLook(); }
  setHover(on) { this.hovered = on; if (!on) this.hoveredEnd = null; this._applyLook(); this._scaleRings(); }
  /** Pointer over a grab handle: enlarge that end's ring. */
  setEndHover(end) { if (this.hoveredEnd !== end) { this.hoveredEnd = end; this._scaleRings(); this._applyLook(); } }
  /** Hover isolation: other connections drop to ~25 % (legacy signature kept). */
  setDim(on) { this.dimHover = !!on; this._applyDim(); }
  /** Selection focus: cables not touching the selected block drop to 40 %. */
  setDimSelect(on) { this.dimSelect = !!on; this._applyDim(); }
  _applyDim() {
    const dim = this.dimHover ? 0.25 : this.dimSelect ? 0.4 : 1;
    this.uniforms.dim.value = dim;
    this.rings.forEach((rg) => { rg.material.opacity = (this.derivedState === 'inactive' ? 0.4 : 0.9) * (dim === 1 ? 1 : dim * 0.9); });
  }
  setFar(on) { if (this.far !== on) { this.far = on; } }

  _applyLook() {
    const u = this.uniforms;
    this.color.setHex(this._typeColor());
    u.color.value.copy(this.color);
    u.dashed.value = 0;
    switch (this.derivedState) {
      case 'active':   u.baseAlpha.value = 0.95; u.glow.value = 1.5; break;
      case 'invalid':  u.color.value.setHex(states.error); u.dashed.value = 1; u.baseAlpha.value = 0.9; u.glow.value = 0; break;
      case 'inactive': u.baseAlpha.value = 0.3; u.glow.value = 0.25; break;
      default:         u.baseAlpha.value = 0.7; u.glow.value = 0.9;
    }
    if (this.selected || this.hovered) u.baseAlpha.value = Math.max(u.baseAlpha.value, 0.75);
    this.outline.visible = this.selected || this.hovered;
    this.outline.material.color.setHex(this.selected ? states.selected : states.hover);
    this.rings.forEach((rg) => { rg.material.color.copy(this.hoveredEnd === rg.userData.end ? new THREE.Color(states.hover) : u.color.value); });
    this._applyDim();
  }

  refreshTheme() { this._applyLook(); }

  update(dt) {
    if (flowEnabled) this.uniforms.travel.value += dt * this.velocity * flowSpeed;
    this.rebuild();
    this._updateBursts(dt);
  }
  /** Spawn a bead when the source port pulsed since we last looked; advance the beads along the curve. */
  _updateBursts(dt) {
    if (this.type === 'event' && this.complete && this.valid) {
      const lp = this.from.lastPulseAt ?? -1;
      if (lp > this._seenPulseAt) { this._seenPulseAt = lp; if (this.visible) this.burst(); }
    }
    if (!this.bursts.length || !this.curve) return;
    const len = this.uniforms.tubeLen.value || 10;
    const dur = THREE.MathUtils.clamp(len / 28, 0.35, 1.1);
    for (const b of [...this.bursts]) {
      b.k += dt / dur;
      if (b.k >= 1) { this.remove(b.core, b.halo); b.core.material.dispose(); b.halo.material.dispose(); this.bursts.splice(this.bursts.indexOf(b), 1); continue; }
      this.curve.getPoint(b.k, b.core.position); b.halo.position.copy(b.core.position);
      const fade = b.k < 0.15 ? b.k / 0.15 : b.k > 0.8 ? (1 - b.k) / 0.2 : 1;
      const r = this._radius * 3.2;
      b.core.scale.setScalar(r); b.halo.scale.setScalar(r * 2.2 * (0.8 + 0.2 * Math.sin(b.k * 20)));
      const dimK = this.dimmed ? 0.3 : 1;
      b.core.material.opacity = 0.95 * fade * dimK; b.halo.material.opacity = 0.28 * fade * dimK;
    }
  }
  /** Visible token: white-hot core + type-coloured halo travelling from `from` to `to`. */
  burst() {
    if (this.bursts.length >= MAX_BURSTS) return;
    const core = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    const halo = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color: this.color.clone().lerp(new THREE.Color(0xffffff), 0.3), transparent: true, opacity: 0, depthWrite: false }));
    core.renderOrder = 3; halo.renderOrder = 3;
    this.add(core, halo);
    this.bursts.push({ k: 0, core, halo });
  }

  serialize() {
    return { uid: this.uid, from: this.from ? { node: this.from.owner.uid, port: this.from.key } : null, to: this.to ? { node: this.to.owner.uid, port: this.to.key } : null };
  }

  dispose() {
    this._offTheme?.();
    this.bursts.forEach((b) => { b.core.material.dispose(); b.halo.material.dispose(); }); this.bursts = [];
    this.tube.geometry.dispose(); this.outline.geometry.dispose(); this.pickTube.geometry.dispose();
    this.material.dispose(); this.outline.material.dispose(); this.pickTube.material.dispose();
    this.rings.forEach((r) => r.material.dispose());
  }
}
