// connection3d.js — Connection3D: a tube along a cubic Bezier from an output port to an
// input port, horizontal tangents (Blueprint-style splines, in 3D). Direction is shown by
// one continuous flow: a long, soft sinusoidal brightness crest travelling along the tube at
// constant velocity (plus a faint stream of soft dashes), with no hard edges or steps.
// Speed follows how often the carried value changes; a link carrying nothing is dimmed.
import * as THREE from 'three';
import { portTypes, states, sizes, onThemeChange } from './theme.js';

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
  uniform float baseAlpha; uniform float glow; uniform float dashed;
  varying vec2 vUv; varying vec3 vNormalW;
  const float TAU = 6.28318530718;
  void main() {
    // world-space distance along the tube; travel grows with time so the pattern slides
    // toward u = 1 (the input) at a constant velocity regardless of tube length
    float d = vUv.x * tubeLen - travel;
    // one long, soft crest per wavelength (cubed sine: narrow bright peak, wide dark trough)
    float band = 0.5 + 0.5 * sin(TAU * d / wavelength);
    band = band * band * band;
    // very soft short dashes streaming with the crest
    float dash = 0.5 + 0.5 * sin(TAU * d / (wavelength * 0.16));
    dash = smoothstep(0.3, 1.0, dash) * 0.16;
    float shade = 0.7 + 0.3 * clamp(dot(vNormalW, normalize(vec3(0.4, 1.0, 0.6))), 0.0, 1.0);
    vec3 c = color * (0.5 + (1.1 * band + dash) * glow) * shade;
    float a = baseAlpha + 0.3 * band * glow;
    if (dashed > 0.5) {
      // invalid link: static hard dashes, no flow
      float k = step(0.5, fract(vUv.x * tubeLen * 1.6));
      a = mix(0.12, baseAlpha, k); c = color * shade * 0.9;
    }
    gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Connection3D extends THREE.Group {
  /**
   * @param {object} from  a port record (dir 'out')
   * @param {object|THREE.Vector3} to  a port record (dir 'in') or a free point (preview)
   */
  constructor(from, to, opts = {}) {
    super();
    this.kind = 'connection';
    this.from = from;
    this.to = to && to.isVector3 ? null : to;
    this.toPoint = to && to.isVector3 ? to.clone() : null;
    this.state = 'idle';
    this.hovered = false;
    this.type = opts.type || from.type;
    this.color = new THREE.Color((portTypes[this.type] || portTypes.signal).color);
    /** Data annotations written by the graph engine. */
    this.value = undefined;
    this.hasValue = opts.hasValue ?? true;
    this.rate = 0;
    this.velocity = 1.2;

    this.uniforms = {
      color: { value: this.color.clone() },
      travel: { value: 0 },
      tubeLen: { value: 10 },
      wavelength: { value: sizes.connection.wavelength },
      baseAlpha: { value: 0.75 },
      glow: { value: 0.9 },
      dashed: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: true,
    });
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.tube.userData.connection = this;
    this.add(this.tube);

    // Selection outline: back-face shell around the tube
    this.outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: states.selected, transparent: true, opacity: 0.45, side: THREE.BackSide, depthWrite: false,
    }));
    this.outline.visible = false;
    this.add(this.outline);

    // Endpoint rings
    const ringGeo = new THREE.TorusGeometry(1, 0.22, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.9 });
    this.rings = [new THREE.Mesh(ringGeo, ringMat), new THREE.Mesh(ringGeo, ringMat)];
    this.rings.forEach((r) => { r.userData.connection = this; this.add(r); });

    this._p0 = new THREE.Vector3(); this._p3 = new THREE.Vector3();
    this.rebuild(true);
    this.setState(opts.state || 'idle');
    this._offTheme = onThemeChange(() => this.refreshTheme());
  }

  setPreviewTarget(point) { this.toPoint = point.clone(); this.to = null; this.rebuild(true); }
  setTargetPort(port) { this.to = port; this.toPoint = null; this.rebuild(true); }

  _endpoints() {
    this.from.getWorldPosition(_a);
    if (this.to) this.to.getWorldPosition(_b); else _b.copy(this.toPoint);
    return [_a, _b];
  }

  /** Rebuild the tube; skipped when endpoints have not moved unless forced. */
  rebuild(force = false) {
    const [p0, p3] = this._endpoints();
    if (!force && p0.distanceToSquared(this._p0) < 1e-8 && p3.distanceToSquared(this._p3) < 1e-8) return;
    this._p0.copy(p0); this._p3.copy(p3);

    const dist = p0.distanceTo(p3);
    const h = Math.max(sizes.connection.tangentMin, dist * sizes.connection.tangent);
    const curve = new THREE.CubicBezierCurve3(
      p0.clone(), p0.clone().add(new THREE.Vector3(h, 0, 0)),
      p3.clone().add(new THREE.Vector3(-h, 0, 0)), p3.clone());
    this.curve = curve;
    const r = this._radius();
    const segs = Math.max(24, Math.min(96, Math.round(dist * 4)));
    this.tube.geometry.dispose();
    this.tube.geometry = new THREE.TubeGeometry(curve, segs, r, 8, false);
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.TubeGeometry(curve, segs, r + 0.04, 8, false);
    this.uniforms.tubeLen.value = curve.getLength();

    // Rings sit on the endpoints, facing along the tangent
    const rs = r * sizes.connection.ringScale;
    const z = new THREE.Vector3(0, 0, 1);
    this.rings[0].position.copy(p0); this.rings[0].quaternion.setFromUnitVectors(z, curve.getTangent(0));
    this.rings[1].position.copy(p3); this.rings[1].quaternion.setFromUnitVectors(z, curve.getTangent(1));
    this.rings.forEach((rg) => rg.scale.setScalar(rs));
  }

  _radius() {
    const r = sizes.connection.radius;
    return this.state === 'selected' ? r.selected : this.state === 'active' ? r.active : r.idle;
  }

  /** States: idle | active | selected | invalid (hover is an overlay). active is derived by the graph. */
  setState(name) {
    const radiusChanged = this.state !== name;
    this.state = name;
    this._applyLook();
    if (radiusChanged) this.rebuild(true);
    this._applyHover();
  }

  /**
   * Data-driven look, written by the graph each evaluation:
   * hasValue → dimmed when false; rate (changes / s) → flow velocity.
   */
  setActivity({ hasValue = true, rate = 0 } = {}) {
    this.hasValue = hasValue; this.rate = rate;
    this.velocity = hasValue ? 1.2 + Math.min(rate, 10) * 0.45 : 0.3;
    this._applyLook();
  }

  _applyLook() {
    const u = this.uniforms;
    u.color.value.copy(this.color);
    u.dashed.value = 0;
    this.outline.visible = false;
    this.outline.material.color.setHex(states.selected);
    switch (this.state) {
      case 'active':   u.baseAlpha.value = 0.95; u.glow.value = 1.5; break;
      case 'selected': u.baseAlpha.value = 1.0; u.glow.value = 1.0; this.outline.visible = true; break;
      case 'invalid':  u.color.value.setHex(states.error); u.dashed.value = 1; u.baseAlpha.value = 0.9; u.glow.value = 0; break;
      default:         u.baseAlpha.value = 0.7; u.glow.value = 0.9;
    }
    if (!this.hasValue && this.state !== 'invalid') {
      // carrying nothing: dim, barely moving sheen
      u.baseAlpha.value = this.state === 'selected' ? 0.6 : 0.28;
      u.glow.value = 0.25;
    }
    this.rings.forEach((rg) => { rg.material.color.copy(u.color.value); rg.material.opacity = this.hasValue || this.state === 'invalid' ? 0.9 : 0.4; });
  }
  setHover(on) { this.hovered = on; this._applyHover(); }
  _applyHover() {
    if (this.state === 'selected') return;
    this.outline.visible = this.hovered;
    if (this.hovered) this.outline.material.color.setHex(states.hover);
  }

  refreshTheme() {
    this.color.setHex((portTypes[this.type] || portTypes.signal).color);
    this._applyLook();
    this._applyHover();
  }

  update(dt) {
    if (flowEnabled) this.uniforms.travel.value += dt * this.velocity * flowSpeed;
    this.rebuild();
  }

  dispose() {
    this._offTheme?.();
    this.tube.geometry.dispose(); this.outline.geometry.dispose();
    this.material.dispose(); this.outline.material.dispose();
    this.rings[0].geometry.dispose(); this.rings[0].material.dispose();
  }
}
