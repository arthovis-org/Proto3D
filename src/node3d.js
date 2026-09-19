// node3d.js — Node3D: a rounded slab built from a component definition. Header band (category
// tint) with the title, in-ports on the left face, out-ports on the right face, an optional
// live canvas face below the port rows (Text, Display, Log, Input, Dashboard) and a dim
// footer line with the current output value(s).
//
//   ┌──────────────────────────┐  header (category tint)
//   │          Title           │
// ●─┤ in                  out  ├─●  port rows
// ●─┤ in                       │
//   │ ┌──────────────────────┐ │
//   │ │        face          │ │  optional live canvas (size M / L)
//   │ └──────────────────────┘ │
//   │        footer value      │
//   └──────────────────────────┘
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { palette, categories, states, sizes, materials, makeLabel, setLabelText, makeShadowBlob } from './theme.js';
import { Block3D } from './block3d.js';

/** Footprint of a definition before it is instantiated (toolbar ghost, free-slot search). */
export function nodeDimensions(def) {
  if (def.body3d) { const d = def.body3d.dims(def); return { width: d.width, height: d.height, depth: d.depth, faceH: 0, rows: 0 }; }
  const n = sizes.node;
  const sz = sizes.nodeSize[def.size] || sizes.nodeSize.S;
  const rows = Math.max(def.inputs.length, def.outputs.length, 1);
  const faceH = def.face ? (sz.faceH || sizes.nodeSize.M.faceH) : 0;
  const height = Math.max(n.minHeight, n.header + n.portTop + rows * sizes.port.gap + (faceH ? faceH + n.faceGap * 2 : 0.1) + n.footer);
  return { width: sz.width, height, depth: n.depth, faceH, rows };
}

export class Node3D extends Block3D {
  constructor(def, o = {}) {
    super(def, o);
    const n = sizes.node;
    const dims = nodeDimensions(def);
    this.width = dims.width; this.height = dims.height; this.depth = dims.depth;
    const { width: w, height: h, depth: d } = this;
    this.category = def.category;

    // Body slab
    this.body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, n.radius), materials.body());
    this.body.userData.block = this;
    this.add(this.body);

    // Header band: slightly proud of the body, carries the title
    const headerColor = (categories[this.category] || { header: palette.headerDefault }).header;
    this.header = new THREE.Mesh(new RoundedBoxGeometry(w - 0.16, n.header, d + 0.06, 3, 0.1), materials.header(headerColor));
    this.header.position.y = h / 2 - n.header / 2 - 0.08;
    this.header.userData.block = this;
    this.add(this.header);

    this.titleLabel = makeLabel(this.title, { size: sizes.label.title, color: 'textOnHeader', weight: 600, maxWidth: w - 0.6 });
    this.titleLabel.position.set(0, this.header.position.y, d / 2 + 0.04);
    this.add(this.titleLabel); this.labels.push(this.titleLabel);
    this._titleY = this.header.position.y;

    // Footer line (dim, small): live output values
    this.footerText = '';
    this.footerLabel = makeLabel(' ', { size: sizes.label.small, color: 'textDim', weight: 500, maxWidth: w - 0.6 });
    this.footerLabel.position.set(0, -h / 2 + n.footer / 2, d / 2 + 0.01);
    this.add(this.footerLabel); this.labels.push(this.footerLabel); this.detailLabels.push(this.footerLabel);

    // Rim: an oversized back-face shell used for hover / selected / error edge glow
    this.rim = new THREE.Mesh(new RoundedBoxGeometry(w + 0.1, h + 0.1, d + 0.1, 3, n.radius + 0.05), materials.rim());
    this.rim.visible = false;
    this.add(this.rim);

    // Ports: rows under the header, in on the left face, out on the right
    const y0 = h / 2 - n.header - n.portTop - 0.2;
    def.inputs.forEach((p, i) => this._addNodePort(p, -w / 2, y0 - i * sizes.port.gap));
    def.outputs.forEach((p, i) => this._addNodePort(p, w / 2, y0 - i * sizes.port.gap));

    // Face: below the port rows, full width minus margins
    if (def.face && dims.faceH) {
      const faceTop = y0 - (dims.rows - 1) * sizes.port.gap - sizes.port.gap / 2 - n.faceGap;
      const fw = w - 0.4, fh = dims.faceH;
      const plane = this._initFace(fw, fh);
      plane.position.set(0, faceTop - fh / 2, d / 2 + 0.012);
      this.add(plane);
    }

    // Fake contact shadow on the floor (kept under the node as it moves)
    this.shadow = makeShadowBlob(w, d);
    this.add(this.shadow);
    this._h0 = h;
    this._faceY0 = this.face?.mesh ? this.face.mesh.position.y : 0;

    this.applyVisual();
    def.onCreate?.(this);
  }

  _addNodePort(spec, x, y) { return this._addLabelledPort(spec, x, y, 0, this.depth / 2 + 0.01); }
  /** Multi inputs grew: the slab extends downward (header stays), face and footer move with it. */
  _onPortsGrow(extra) {
    const n = sizes.node, w = this.width, d = this.depth, h = this._h0 + extra;
    this.body.geometry.dispose(); this.body.geometry = new RoundedBoxGeometry(w, h, d, 4, n.radius);
    this.rim.geometry.dispose(); this.rim.geometry = new RoundedBoxGeometry(w + 0.1, h + 0.1, d + 0.1, 3, n.radius + 0.05);
    this.body.position.y = -extra / 2; this.rim.position.y = -extra / 2;
    this.height = h; this.bodyOffsetY = -extra / 2;
    this.footerLabel.position.y = -this._h0 / 2 - extra + n.footer / 2;
    if (this.face?.mesh) this.face.mesh.position.y = this._faceY0 - extra;
    // never sink under the floor while growing
    const bottom = this.position.y - this._h0 / 2 - extra;
    if (this.world && bottom < 0.2) this.position.y += 0.2 - bottom;
  }

  /** Live footer (engine). Only redraws when the text changes. */
  setFooter(text) { this.footerText = String(text ?? ''); setLabelText(this.footerLabel, this.footerText || ' '); }

  applyVisual() {
    const disabled = this.derivedState === 'disabled';
    const bodyMat = this.body.material;
    bodyMat.color.setHex(disabled ? palette.bodyDisabled : palette.body);
    bodyMat.emissive.setHex(states.active);
    bodyMat.emissiveIntensity = 0;
    this.header.material.color.setHex(disabled ? states.disabled : (categories[this.category] || { header: palette.headerDefault }).header);
    this.titleLabel.material.opacity = disabled ? 0.45 : 1;
    this.footerLabel.material.opacity = disabled ? 0.4 : 1 - this.lodBlend;
    if (this.face?.mesh) this.face.mesh.material.emissiveIntensity = disabled ? 0.15 : 0.55;
    super.applyVisual();
  }

  /** Far LOD: detail labels fade, the title grows and slides to the body centre. */
  _applyLOD() {
    super._applyLOD();
    const k = this.lodBlend;
    // far: the title lifts above the slab and grows with distance (map-label rule) so the
    // overview reads as labelled blocks; near: it sits in the header at 1×
    const far = this._farTitleScale();
    const s = 1 + (far - 1) * k;
    this.titleLabel.scale.setScalar(s);
    const farY = this.height / 2 + 0.3 + this.titleLabel.userData.worldH * far * 0.5;
    this.titleLabel.position.y = this._titleY + (farY - this._titleY) * k;
    this.titleLabel.position.z = this.depth / 2 + 0.04 + 0.03 * k;
    if (this.face?.mesh) this.face.mesh.material.emissiveIntensity = 0.55 + 0.2 * k;
  }

  /** Per-frame: active pulse, LOD blend, shadow on the floor. */
  update(time, dt) {
    if (this.derivedState === 'active') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
      this.body.material.emissiveIntensity = 0.03 + 0.09 * pulse;
      if (!this.hovered && !this.selected) this.rim.material.opacity = 0.12 + 0.25 * pulse;
    }
    this._updateLOD(dt);
    this._updateShadow();
  }

  refreshTheme() {
    super.refreshTheme();
    this.shadow.material.opacity = palette.shadowAlpha;
  }
}
