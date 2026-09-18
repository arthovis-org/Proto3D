// node3d.js — Node3D: a rounded slab with a header band, in-ports on the left face,
// out-ports on the right face, a title label and a live footer line (current output values).
// Also exports the shared port factory so devices use the exact same port anatomy.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  palette, categories, portTypes, states, sizes, materials, makeLabel, refreshLabel, setLabelText,
  makeShadowBlob, onThemeChange,
} from './theme.js';

let nextId = 1;
const ballGeo = new THREE.SphereGeometry(sizes.port.radius, 20, 14);
const stemGeo = new THREE.CylinderGeometry(sizes.port.radius * 0.45, sizes.port.radius * 0.45, sizes.port.stem, 10);

/**
 * Shared port anatomy: a short stem out of the face + a colored sphere.
 * `owner` is the Node3D / Device3D that hosts it. Returns a plain port record.
 * The graph engine annotates ports with `value`, `changedAt` and `rate`.
 */
export function createPort(owner, { name, type = 'signal', dir = 'in' }) {
  const sign = dir === 'in' ? -1 : 1;
  const group = new THREE.Group();
  const stem = new THREE.Mesh(stemGeo, materials.portStem());
  stem.rotation.z = Math.PI / 2;
  stem.position.x = sign * sizes.port.stem * 0.5;
  const ball = new THREE.Mesh(ballGeo, materials.port(type));
  ball.position.x = sign * sizes.port.stem;
  group.add(stem, ball);

  const port = {
    id: nextId++, owner, name, type, dir, group, mesh: ball, stem,
    color: (portTypes[type] || portTypes.signal).color,
    baseEmissive: 0.35,
    value: undefined, changedAt: -1, rate: 0, changes: 0,
    disabled: false,
    getWorldPosition(target = new THREE.Vector3()) { return ball.getWorldPosition(target); },
    /** Hover feedback: scale up + brighter. */
    setHover(on) {
      const s = on ? sizes.port.hoverScale : 1;
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
    /** Re-read the type colour from the live palette. */
    refreshTheme() {
      port.color = (portTypes[type] || portTypes.signal).color;
      stem.material.color.setHex(palette.portStem);
      port.setDisabled(port.disabled);
    },
  };
  ball.userData.port = port;
  stem.userData.port = port;
  return port;
}

export class Node3D extends THREE.Group {
  /**
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.typeId]   block type id from graph.js (drives evaluation)
   * @param {object} [o.params]   editable parameters (world model)
   * @param {string} [o.footer]   initial footer line; the graph overwrites it with live values
   * @param {'source'|'process'|'sink'} [o.category]
   * @param {{name:string,type:string}[]} [o.inputs]
   * @param {{name:string,type:string}[]} [o.outputs]
   * @param {number} [o.width] [o.height]
   */
  constructor(o = {}) {
    super();
    this.kind = 'node';
    this.uid = nextId++;
    this.title = o.title || 'Node';
    this.typeId = o.typeId || null;
    this.params = o.params || {};
    this.mode = o.mode || 'auto';        // auto | disabled | error (user override)
    this.memory = {};
    this.category = o.category || 'process';
    this.state = 'idle';
    this.hovered = false;
    this.inputs = [];
    this.outputs = [];
    this.labels = [];                    // every canvas label on this node (theme refresh)
    this.footerText = o.footer || '';

    const n = sizes.node;
    const rows = Math.max((o.inputs || []).length, (o.outputs || []).length, 1);
    this.width = o.width || n.width;
    this.height = o.height || Math.max(n.height, n.header + n.footer + rows * sizes.port.gap + 0.5);
    this.depth = n.depth;
    const w = this.width, h = this.height, d = this.depth;

    // Body slab
    this.body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, n.radius), materials.body());
    this.body.userData.block = this;
    this.add(this.body);

    // Header band: slightly proud of the body, carries the title
    const headerColor = (categories[this.category] || categories.process).header;
    this.header = new THREE.Mesh(
      new RoundedBoxGeometry(w - 0.16, n.header, d + 0.06, 3, 0.1), materials.header(headerColor));
    this.header.position.y = h / 2 - n.header / 2 - 0.08;
    this.header.userData.block = this;
    this.add(this.header);

    this.titleLabel = makeLabel(this.title, {
      size: sizes.label.title, color: 'textOnHeader', weight: 600, maxWidth: w - 0.6,
    });
    this.titleLabel.position.set(0, this.header.position.y, d / 2 + 0.04);
    this.add(this.titleLabel); this.labels.push(this.titleLabel);

    // Footer line (dim, small): live output values
    this.footerLabel = makeLabel(this.footerText, {
      size: sizes.label.small, color: 'textDim', weight: 500, maxWidth: w - 0.6,
    });
    this.footerLabel.position.set(0, -h / 2 + n.footer / 2, d / 2 + 0.01);
    this.add(this.footerLabel); this.labels.push(this.footerLabel);

    // Rim: an oversized back-face shell used for hover / selected / error edge glow
    this.rim = new THREE.Mesh(new RoundedBoxGeometry(w + 0.1, h + 0.1, d + 0.1, 3, n.radius + 0.05), materials.rim());
    this.rim.visible = false;
    this.add(this.rim);

    // Ports: top-down rows under the header, in on the left face, out on the right
    const y0 = h / 2 - n.header - 0.45;
    (o.inputs || []).forEach((p, i) => this._addPort({ ...p, dir: 'in' }, -w / 2, y0 - i * sizes.port.gap));
    (o.outputs || []).forEach((p, i) => this._addPort({ ...p, dir: 'out' }, w / 2, y0 - i * sizes.port.gap));

    // Fake contact shadow on the floor (kept under the node as it moves)
    this.shadow = makeShadowBlob(w, d);
    this.add(this.shadow);

    this.applyVisual();
    this._offTheme = onThemeChange(() => this.refreshTheme());
  }

  get ports() { return [...this.inputs, ...this.outputs]; }

  _addPort(spec, x, y) {
    const port = createPort(this, spec);
    port.group.position.set(x, y, 0);
    this.add(port.group);
    (spec.dir === 'in' ? this.inputs : this.outputs).push(port);
    // Port name on the front face, hugging the matching edge
    const label = makeLabel(spec.name, { size: sizes.label.port, color: 'textDim', weight: 500 });
    const inset = 0.22 + label.userData.worldW / 2;
    label.position.set(spec.dir === 'in' ? x + inset : x - inset, y, this.depth / 2 + 0.01);
    this.add(label); this.labels.push(label);
    port.label = label;
    return port;
  }

  /** Rename (panel). */
  setTitle(text) { this.title = String(text); setLabelText(this.titleLabel, this.title); }
  /** Live footer (graph engine). Only redraws when the text changes. */
  setFooter(text) { this.footerText = String(text ?? ''); setLabelText(this.footerLabel, this.footerText); }

  /** States: idle | hover (transient) | selected | active | error | disabled */
  setState(name) { this.state = name; this.applyVisual(); }
  setHover(on) { this.hovered = on; this.applyVisual(); }

  applyVisual() {
    const s = this.state;
    const bodyMat = this.body.material;
    const disabled = s === 'disabled';
    bodyMat.color.setHex(disabled ? palette.bodyDisabled : palette.body);
    bodyMat.emissive.setHex(states.active);
    bodyMat.emissiveIntensity = 0;
    this.header.material.color.setHex(disabled ? states.disabled : (categories[this.category] || categories.process).header);
    this.titleLabel.material.opacity = disabled ? 0.45 : 1;
    this.footerLabel.material.opacity = disabled ? 0.4 : 1;
    this.ports.forEach((p) => p.setDisabled(disabled));

    // Rim color/priority: error > selected > hover
    let rim = null, opacity = 0.35;
    if (s === 'error') { rim = states.error; opacity = 0.6; }
    else if (s === 'selected') { rim = states.selected; opacity = 0.55; }
    else if (this.hovered && !disabled) { rim = states.hover; opacity = 0.3; }
    else if (s === 'active') { rim = states.active; opacity = 0.2; }
    this.rim.visible = rim !== null;
    if (rim !== null) { this.rim.material.color.setHex(rim); this.rim.material.opacity = opacity; }
  }

  /** Theme switch: recolor materials, regenerate every label texture. */
  refreshTheme() {
    this.ports.forEach((p) => p.refreshTheme());
    this.labels.forEach((l) => refreshLabel(l));
    this.shadow.material.opacity = palette.shadowAlpha;
    this.applyVisual();
  }

  /** Per-frame: active pulse + keep the shadow on the floor. */
  update(time) {
    if (this.state === 'active') {
      // Active: gentle emissive breath on the body + pulsing rim, never a flat flood of color
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
      this.body.material.emissiveIntensity = 0.03 + 0.09 * pulse;
      if (!this.hovered) this.rim.material.opacity = 0.12 + 0.25 * pulse;
    }
    // shadow stays on the floor whatever the node's height / rotation / scale
    const sy = this.scale.y || 1;
    this.shadow.position.y = -this.position.y / sy + 0.005;
    this.shadow.quaternion.copy(this.quaternion).invert();
    this.shadow.rotateX(-Math.PI / 2);
    const fade = THREE.MathUtils.clamp(1 - this.position.y / 12, 0.25, 1) * palette.shadowAlpha;
    this.shadow.material.opacity = fade;
    this.shadow.scale.setScalar(1 + this.position.y * 0.06);
  }

  dispose() {
    this._offTheme?.();
    this.traverse((obj) => {
      if (obj.geometry && obj !== this.body && obj !== this.header) obj.geometry.dispose?.();
      if (obj.material && obj.material.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose?.();
    });
    this.body.geometry.dispose(); this.header.geometry.dispose();
  }
}
