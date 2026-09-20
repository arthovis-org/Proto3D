// node3d.js — Node3D: a thin extruded card built from a component definition. A slim accent
// line in the category colour runs along the top edge, the title sits left-aligned under it with
// the component kind in small caps at the right, then the content band — an optional live canvas
// face — and a dim footer line with the current output value(s). The ports sit on the left and
// right edges *beside* the content band (in-ports left, out-ports right): level with the face
// region each one affects when the face declares `portAnchors` (a Display's pin points at the
// value, a Prompt's inputs at the prompt text), stacked and centred on the band otherwise. The
// card is the same size with wiring on or off: the switch only shows and hides the pins; their
// names ride the wire just outside the body and appear on hover, cable drag or selection.
//
//   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━  accent line (category colour)
//   │ Title              KIND  │
//   │ ┌──────────────────────┐ │
// ●─┤ │                      │ ├─●  ports beside the content (wiring on)
// ●─┤ │        face          │ │    optional live canvas (size M / L)
//   │ │                      │ ├─●
//   │ └──────────────────────┘ │
//   │ footer value             │
//   └──────────────────────────┘
import * as THREE from 'three';
import { palette, categories, states, sizes, materials, makeLabel, setLabelText, makeShadowBlob, alignLabelLeft, alignLabelRight } from './theme.js';
import { panelGeometry, outlineGeometry } from './geometry.js';
import { Block3D, alignPorts, splitAnchors } from './block3d.js';

/**
 * Footprint of a definition before it is instantiated (toolbar ghost, free-slot search). The
 * height is header + content band + footer: the band holds the face with its margins, or, on a
 * card whose busier side has more pins than fit beside it at the compressed pitch, the pin stack.
 * It does not depend on the wiring switch.
 */
export function nodeDimensions(def) {
  if (def.body3d) { const d = def.body3d.dims(def); return { width: d.width, height: d.height, depth: d.depth, faceH: 0, rows: 0 }; }
  const n = sizes.node, P = sizes.port;
  const sz = sizes.nodeSize[def.size] || sizes.nodeSize.S;
  const rows = Math.max(def.inputs.length, def.outputs.length, 0);
  const faceH = def.face ? (sz.faceH || sizes.nodeSize.M.faceH) : 0;
  const faceBand = faceH ? faceH + n.faceGap * 2 : 0.1;
  const portBand = rows ? (rows - 1) * P.minGap + 2 * P.pad : 0;
  const height = Math.max(n.minHeight, n.header + Math.max(faceBand, portBand) + n.footer);
  return { width: sz.width, height, depth: n.depth, faceH, rows };
}

export class Node3D extends Block3D {
  constructor(def, o = {}) {
    super(def, o);
    const n = sizes.node;
    const full = nodeDimensions(def);
    this.width = full.width; this.height = full.height; this.depth = full.depth;
    this._h0 = full.height;     // reference height (no grown sockets): the origin is its centre
    this._faceH = full.faceH;
    const { width: w, depth: d } = this;
    this.category = def.category;
    this.accentColor = () => (categories[this.category] || { header: palette.headerDefault }).header;

    // Body: extruded rounded card
    this.body = new THREE.Mesh(panelGeometry(w, this._h0, d, { radius: n.radius, bevel: n.bevel }), materials.panel());
    this.body.userData.block = this;
    this.add(this.body);
    // Accent line along the top edge (category colour), just inside the rounded corners
    this.accent = new THREE.Mesh(new THREE.BoxGeometry(1, n.accent, 0.012), materials.accent(this.accentColor()));
    this.accent.scale.x = w - 2 * n.pad;
    this.accent.userData.block = this;
    this.add(this.accent);
    this.header = this.accent;   // kept for callers that expect a header mesh
    this.meshes = [this.body, this.accent];

    this.titleLabel = makeLabel(this.title, { size: sizes.label.title, color: 'text', weight: 600, maxWidth: w * 0.62 });
    this.add(this.titleLabel); this.labels.push(this.titleLabel);
    const kind = def.label === this.title ? def.category : def.label;
    this.kindLabel = makeLabel(kind, { size: sizes.label.caption, color: 'textDim', weight: 600, caps: true, spacing: 0.08, maxWidth: w * 0.3 });
    this.add(this.kindLabel); this.labels.push(this.kindLabel); this.detailLabels.push(this.kindLabel);

    // Footer line (dim, small): live output values
    this.footerText = '';
    this.footerLabel = makeLabel(' ', { size: sizes.label.small, color: 'textDim', weight: 500, maxWidth: w - 2 * n.pad });
    this.add(this.footerLabel); this.labels.push(this.footerLabel); this.detailLabels.push(this.footerLabel);

    // Thin outline shell for hover / selected / error
    this.rim = new THREE.Mesh(outlineGeometry(w, this._h0, d, sizes.outline.grow, { radius: n.radius }), materials.rim());
    this.rim.visible = false;
    this.add(this.rim);

    // Ports: in on the left edge, out on the right; _layout stacks them beside the content band
    def.inputs.forEach((p) => this._addNodePort(p, -w / 2, 0));
    def.outputs.forEach((p) => this._addNodePort(p, w / 2, 0));

    // Face: the content band, full width minus margins
    if (def.face && full.faceH) {
      const plane = this._initFace(w - 2 * n.pad, full.faceH);
      this.add(plane);
    }

    // Fake contact shadow on the floor (kept under the node as it moves)
    this.shadow = makeShadowBlob(w, Math.max(d, 0.5));
    this.add(this.shadow);
    this._layout();
    this._wiringOn = this.portsVisible;
    this.applyWiring();
    this.applyVisual();
    def.onCreate?.(this);
  }

  _addNodePort(spec, x, y) { return this._addLabelledPort(spec, x, y, 0, this.depth / 2 + 0.01); }
  /** A multi-input slot grew or shrank: re-stack that side along the edge (the card extends only when the stack no longer fits). */
  relayoutPorts() { this._layout(); }

  /**
   * Place everything for the current state. The top edge stays at +h0/2; the ports of each side
   * are stacked beside the content band (between header and footer) and only a stack that no
   * longer fits extends the card downward (`stackPorts` → `overflow`). The wiring switch never
   * changes the layout. `bodyOffsetY` keeps `getAABB` honest while the card is extended.
   */
  _layout() {
    const n = sizes.node, w = this.width, d = this.depth, h0 = this._h0;
    const top = h0 / 2;
    const bandTop = top - n.header, bandBottom = -h0 / 2 + n.footer;   // the content band of the reference card
    const anchors = this._portAnchors(bandTop, bandBottom);
    const stacks = [alignPorts(this.inputs, anchors.in, bandTop, bandBottom), alignPorts(this.outputs, anchors.out, bandTop, bandBottom)];
    const extra = Math.max(stacks[0].overflow, stacks[1].overflow);
    this._portsExtra = extra;
    const h = h0 + extra;
    const bottom = top - h;
    const centre = (top + bottom) / 2;
    if (Math.abs(h - (this._bodyH || 0)) > 1e-6) {
      this._bodyH = h;
      this.body.geometry.dispose(); this.body.geometry = panelGeometry(w, h, d, { radius: n.radius, bevel: n.bevel });
      this.rim.geometry.dispose(); this.rim.geometry = outlineGeometry(w, h, d, sizes.outline.grow, { radius: n.radius });
    }
    this.body.position.y = centre; this.rim.position.y = centre;
    this.height = h; this.bodyOffsetY = centre;
    const zf = d / 2 + 0.012;
    this.accent.position.set(0, top - 0.1, zf + 0.004);
    const titleY = top - n.header * 0.6;
    alignLabelLeft(this.titleLabel, -w / 2 + n.pad, titleY, zf + 0.03);
    alignLabelRight(this.kindLabel, w / 2 - n.pad, titleY + 0.01, zf + 0.02);
    this._titleY = titleY; this._titleX = this.titleLabel.position.x;
    [this.inputs, this.outputs].forEach((list, side) => list.forEach((p, i) => {
      p.basePos = [side ? w / 2 : -w / 2, stacks[side].ys[i], 0];
      p.group.position.set(...p.basePos);
      this._placePortLabel(p);
    }));
    if (this.face?.mesh) this.face.mesh.position.set(0, (bandTop + bandBottom) / 2, zf);
    this.footerLabel.position.set(0, bottom + n.footer / 2 + 0.02, zf + 0.01);
    // never sink under the floor while growing
    if (this.world) { const worldBottom = this.position.y + bottom; if (worldBottom < 0.2) this.position.y += 0.2 - worldBottom; }
    this.world?.bumpLayout();
  }

  /**
   * Port anchors from the face (§7c): `def.face.portAnchors({ w, h, params, state, inputs, instance })`
   * returns face-logical y (px from the top of the face) per port key, flat or `{ in, out }`;
   * converted here to local units on the card. Null when the face gives none (stacked layout).
   */
  _portAnchors(bandTop, bandBottom) {
    const F = this.def.face;
    if (!F?.portAnchors || !this.face || !this._faceH) return { in: null, out: null };
    let a = null;
    try { a = F.portAnchors({ w: this.face.cw, h: this.face.ch, params: this.params, state: this.state, inputs: this.rt.inputs || {}, instance: this }); }
    catch (_) { a = null; }
    const cy = (bandTop + bandBottom) / 2, fh = this._faceH, px = sizes.face.pxPerUnit;
    const conv = (m) => { if (!m) return null; const out = {}; for (const [k, y] of Object.entries(m)) if (Number.isFinite(y)) out[k] = cy + fh / 2 - y / px; return out; };
    const s = splitAnchors(a);
    return { in: conv(s.in), out: conv(s.out) };
  }

  /** Live footer (engine). Only redraws when the text changes. */
  setFooter(text) { this.footerText = String(text ?? ''); setLabelText(this.footerLabel, this.footerText || ' '); }

  applyVisual() {
    const disabled = this.derivedState === 'disabled';
    const bodyMat = this.body.material;
    bodyMat.color.setHex(disabled ? palette.bodyDisabled : palette.body);
    bodyMat.emissive.setHex(states.active);
    bodyMat.emissiveIntensity = 0;
    this.accent.material.color.setHex(disabled ? states.disabled : this.accentColor());
    this.titleLabel.material.opacity = disabled ? 0.45 : 1;
    this.footerLabel.material.opacity = disabled ? 0.4 : 1 - this.lodBlend;
    if (this.face?.mesh) this.face.mesh.material.emissiveIntensity = (disabled ? 0.15 : 0.55) * (palette.faceBoost ?? 1);
    super.applyVisual();
  }

  /** Far LOD: detail labels fade, the title grows and lifts above the card. */
  _applyLOD() {
    super._applyLOD();
    const k = this.lodBlend;
    const far = this._farTitleScale();
    const s = 1 + (far - 1) * k;
    this.titleLabel.scale.setScalar(s);
    const farY = this._h0 / 2 + 0.3 + this.titleLabel.userData.worldH * far * 0.5;
    this.titleLabel.position.y = this._titleY + (farY - this._titleY) * k;
    this.titleLabel.position.x = this._titleX * (1 - k);
    this.titleLabel.position.z = this.depth / 2 + 0.04 + 0.03 * k;
    if (this.face?.mesh) this.face.mesh.material.emissiveIntensity = (0.55 + 0.2 * k) * (palette.faceBoost ?? 1);   // the light theme's face boost
  }

  /** Per-frame: active pulse, LOD blend, shadow on the floor. */
  update(time, dt) {
    if (this.derivedState === 'active') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
      this.body.material.emissiveIntensity = 0.02 + 0.06 * pulse;
      if (!this.hovered && !this.selected) this.rim.material.opacity = 0.2 + 0.4 * pulse;
    }
    this._updateLOD(dt);
    this._updateShadow();
  }

  refreshTheme() {
    super.refreshTheme();
    this.shadow.material.opacity = palette.shadowAlpha;
  }
}
