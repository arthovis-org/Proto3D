// connection3d.js — Connection3D: a tube along a routed cubic Bezier from an output port to an
// input port. Direction is shown by one continuous flow: a long, soft sinusoidal brightness
// crest travelling along the tube at constant velocity (plus a faint stream of soft dashes).
// Looks are derived from data: inactive (carries nothing) is thin and dim, active (value
// changed within ~1.5 s) is thicker and brighter, invalid (type mismatch) is red and dashed.
// Hovering another connection dims this one to ~25 % so a single path can be followed.
import * as THREE from 'three';
import { portTypes, states, sizes, onThemeChange } from './theme.js';
import { compatible } from './core/types.js';
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

export class Connection3D extends THREE.Group {
  /**
   * @param {object} from  a port record (dir 'out')
   * @param {object|THREE.Vector3} to  a port record (dir 'in') or a free point (preview)
   */
  constructor(from, to, opts = {}) {
    super();
    this.kind = 'connection';
    this.uid = opts.uid || `c${Math.random().toString(36).slice(2, 8)}`;
    this.from = from;
    this.to = to && to.isVector3 ? null : to;
    this.toPoint = to && to.isVector3 ? to.clone() : null;
    this.type = from.type;
    this.compat = this.to ? compatible(from.type, this.to.type) : 'ok';
    this.valid = this.compat !== 'invalid';
    this.derivedState = this.valid ? 'inactive' : 'invalid';
    this.hovered = false;
    this.selected = false;
    this.dimmed = false;
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

    this.outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: states.selected, transparent: true, opacity: 0.45, side: THREE.BackSide, depthWrite: false,
    }));
    this.outline.visible = false;
    this.add(this.outline);

    const ringMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.9 });
    this.rings = [new THREE.Mesh(ringGeo, ringMat), new THREE.Mesh(ringGeo, ringMat)];
    this.rings.forEach((r) => { r.userData.connection = this; this.add(r); });

    // token bursts: a bright bead runs the length of an event link whenever a pulse passes
    this.bursts = [];
    this._seenPulseAt = from.lastPulseAt ?? -1;
    this._p0 = new THREE.Vector3(); this._p3 = new THREE.Vector3();
    this._radius = 0;
    this._layoutVersion = -1;
    this.rebuild(true);
    this._applyLook();
    this._offTheme = onThemeChange(() => this.refreshTheme());
  }

  _typeColor() {
    // a coerced link (number → text) is drawn in the destination's colour: that is what arrives
    const t = this.compat === 'coerce' && this.to ? this.to.type : this.type;
    return (portTypes[t] || portTypes.any).color;
  }

  setPreviewTarget(point) { this.toPoint = point.clone(); this.to = null; this.compat = 'ok'; this.rebuild(true); }
  setTargetPort(port) { this.to = port; this.toPoint = null; this.compat = compatible(this.from.type, port.type); this.rebuild(true); }

  _endpoints() {
    this.from.getWorldPosition(_a);
    if (this.to) this.to.getWorldPosition(_b); else _b.copy(this.toPoint);
    return [_a, _b];
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
    const skip = new Set([this.from.owner, this.to?.owner].filter(Boolean));
    const curve = routeCurve(p0, p3, {
      lanes: world && this.to ? laneInfo(this, world.connections) : null,
      obstacles: world ? world.nodes : [],
      skip,
    });
    this.curve = curve;
    const dist = p0.distanceTo(p3);
    const segs = Math.max(24, Math.min(110, Math.round(dist * 4)));
    this.tube.geometry.dispose();
    this.tube.geometry = new THREE.TubeGeometry(curve, segs, r, 8, false);
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.TubeGeometry(curve, segs, r + 0.04, 8, false);
    this.uniforms.tubeLen.value = curve.getLength();

    const rs = r * sizes.connection.ringScale;
    const z = new THREE.Vector3(0, 0, 1);
    this.rings[0].position.copy(p0); this.rings[0].quaternion.setFromUnitVectors(z, curve.getTangent(0));
    this.rings[1].position.copy(p3); this.rings[1].quaternion.setFromUnitVectors(z, curve.getTangent(1));
    this.rings.forEach((rg) => rg.scale.setScalar(rs));
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
    this.velocity = s === 'active' ? 1.2 + Math.min(this.from.rate || 0, 10) * 0.45 : s === 'idle' ? 1.2 : 0.3;
    this._applyLook();
  }
  setSelected(on) { this.selected = on; this._applyLook(); }
  setHover(on) { this.hovered = on; this._applyLook(); }
  /** Hover isolation: other connections drop to ~25 %. */
  setDim(on) { this.dimmed = on; this.uniforms.dim.value = on ? 0.25 : 1; this.rings.forEach((rg) => { rg.material.opacity = on ? 0.2 : 0.9; }); }
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
    if (this.selected) u.baseAlpha.value = Math.max(u.baseAlpha.value, 0.6);
    this.outline.visible = this.selected || this.hovered;
    this.outline.material.color.setHex(this.selected ? states.selected : states.hover);
    this.rings.forEach((rg) => { rg.material.color.copy(u.color.value); rg.material.opacity = this.dimmed ? 0.2 : this.derivedState === 'inactive' ? 0.4 : 0.9; });
  }

  refreshTheme() { this._applyLook(); }

  update(dt) {
    if (flowEnabled) this.uniforms.travel.value += dt * this.velocity * flowSpeed;
    this.rebuild();
    this._updateBursts(dt);
  }
  /** Spawn a bead when the source port pulsed since we last looked; advance the beads along the curve. */
  _updateBursts(dt) {
    if (this.type === 'event' && this.to && this.valid) {
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
      b.core.material.opacity = 0.95 * fade * (this.dimmed ? 0.3 : 1); b.halo.material.opacity = 0.28 * fade * (this.dimmed ? 0.3 : 1);
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
    return { uid: this.uid, from: { node: this.from.owner.uid, port: this.from.key }, to: this.to ? { node: this.to.owner.uid, port: this.to.key } : null };
  }

  dispose() {
    this._offTheme?.();
    this.bursts.forEach((b) => { b.core.material.dispose(); b.halo.material.dispose(); }); this.bursts = [];
    this.tube.geometry.dispose(); this.outline.geometry.dispose();
    this.material.dispose(); this.outline.material.dispose();
    this.rings[0].material.dispose();
  }
}
