// connection3d.js — Connection3D: a tube along a cubic Bezier from an output port to an
// input port, horizontal tangents (Blueprint-style splines, in 3D). Direction is shown by
// bright "packets" travelling along the tube (shader on the tube's U coordinate).
import * as THREE from 'three';
import { portTypes, states, sizes } from './theme.js';

let flowEnabled = true;
/** Global toggle for the flow animation (toolbar). */
export function setFlowEnabled(on) { flowEnabled = on; }
export function isFlowEnabled() { return flowEnabled; }

const VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 color; uniform float time; uniform float speed; uniform float packets;
  uniform float baseAlpha; uniform float glow; uniform float dashed; uniform float length;
  varying vec2 vUv; varying vec3 vNormalW;
  void main() {
    float u = vUv.x;
    // packet head at f == 0, exponential tail behind it; heads move toward u = 1 (the input)
    float f = fract(u * packets - time * speed);
    float p = exp(-f * 7.0) * glow;
    float shade = 0.7 + 0.3 * clamp(dot(vNormalW, normalize(vec3(0.4, 1.0, 0.6))), 0.0, 1.0);
    vec3 c = color * (0.55 + p) * shade;
    float a = baseAlpha + 0.45 * p;
    if (dashed > 0.5) {
      float d = step(0.5, fract(u * length * 1.6));
      a = mix(0.12, baseAlpha, d); c = color * shade * 0.9;
    }
    gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
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

    this.uniforms = {
      color: { value: this.color.clone() },
      time: { value: 0 },
      speed: { value: 0.6 },
      packets: { value: 3 },
      baseAlpha: { value: 0.75 },
      glow: { value: 0.9 },
      dashed: { value: 0 },
      length: { value: 10 },
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
    this.uniforms.length.value = dist;
    this.uniforms.packets.value = Math.max(1, Math.round(dist / 4));

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

  /** States: idle | active | selected | invalid (hover is an overlay) */
  setState(name) {
    this.state = name;
    const u = this.uniforms;
    u.color.value.copy(this.color);
    u.dashed.value = 0;
    this.outline.visible = false;
    this.outline.material.color.setHex(states.selected);
    switch (name) {
      case 'active':   u.speed.value = 1.6; u.baseAlpha.value = 0.95; u.glow.value = 1.6; break;
      case 'selected': u.speed.value = 0.7; u.baseAlpha.value = 1.0; u.glow.value = 1.0; this.outline.visible = true; break;
      case 'invalid':  u.color.value.setHex(states.error); u.dashed.value = 1; u.baseAlpha.value = 0.9; u.glow.value = 0; break;
      default:         u.speed.value = 0.6; u.baseAlpha.value = 0.7; u.glow.value = 0.9;
    }
    this.rings.forEach((rg) => rg.material.color.copy(u.color.value));
    this.rebuild(true);
    this._applyHover();
  }
  setHover(on) { this.hovered = on; this._applyHover(); }
  _applyHover() {
    if (this.state === 'selected') return;
    this.outline.visible = this.hovered;
    if (this.hovered) this.outline.material.color.setHex(states.hover);
  }

  update(dt) {
    if (flowEnabled) this.uniforms.time.value += dt;
    this.rebuild();
  }

  dispose() {
    this.tube.geometry.dispose(); this.outline.geometry.dispose();
    this.material.dispose(); this.outline.material.dispose();
    this.rings[0].geometry.dispose(); this.rings[0].material.dispose();
  }
}
