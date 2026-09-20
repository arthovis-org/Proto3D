// shape3d.js — Shape3D: a component instance whose body is custom 3D (a Kanban board with
// columns and cards, a Gantt timeline, flowchart shapes, a flag, a tilted sticky note) instead
// of the standard Node3D slab. The definition supplies `body3d`:
//
//   body3d: {
//     dims(defOrNode)                → { width, height, depth }  (toolbar ghost + this instance)
//     build(node, h)                 → adds meshes through the helpers `h` (part, label, sub, face)
//     ports?(node)                   → { in: [[x, y, z]], out: [[x, y, z]] }  (default: stacked on the left /
//                                      right edges, centred on the body — never above the content)
//     refresh?(node)                 → rebuild data-driven children (called when faceDirty is set:
//                                      param / state change, theme change, undo)
//     update?(node, time, dt)        → per-frame animation
//     applyLOD?(node, blend)         → far-LOD look (0 = near, 1 = far)
//     onSubPointer?(node, ev)        → pointer events on child pickables (cards, tiles, handles):
//                                      ev = { type: down | drag | drop | click | cancel, sub, point, ray, history, selection }
//     onSubHover?(node, sub | null)
//     titleAt?(node)                 → [x, y, z] for the title label (default: top front)
//   }
//
// Everything a block shares — uid, params, state, typed ports, rim, contact shadow, face canvas
// helpers, LOD blend, serialization — comes from Block3D. Child pickables are `subs`: meshes
// whose userData.sub = { block, kind, id, ... }; the interaction layer picks them right after
// ports, so a card on a board is clickable and draggable while the board itself still selects,
// moves, groups, duplicates and serializes like any other component.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { palette, categories, states, sizes, materials, makeLabel, setLabelText, makeShadowBlob, refreshLabel, alignLabelLeft } from './theme.js';
import { panelGeometry, slabGeometry, outlineGeometry } from './geometry.js';
import { Block3D, stackPorts } from './block3d.js';
import { clear as clearFace } from './faces.js';
import { createSurface } from './face-canvas.js';

/**
 * A canvas-backed plane (card face, bar face, flag face). `draw(g, w, h)` paints it in logical px
 * (`cw × ch`, 120 px / unit); the painter is kept so the plane can repaint itself when its owner's
 * resolution tier changes (Block3D.fitFaceResolution). Pass `owner` (the block) so a plane built in
 * `refresh` starts at the block's current tier.
 */
export function makeCanvasPlane(w, h, { emissive = 0.55, px = sizes.face.pxPerUnit, owner = null } = {}) {
  const surface = createSurface(w, h, { px, scale: owner?.faceScale });
  clearFace(surface.g, surface.cw, surface.ch, 'rgba(0,0,0,0)');
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials.face(surface.texture, { emissive, transparent: true }));   // alpha from the canvas: transparent pixels show the body behind
  mesh.renderOrder = 1;
  let painter = null;
  const plane = Object.assign(surface, {
    mesh,
    draw(fn) { painter = fn; fn(surface.g, surface.cw, surface.ch); surface.texture.needsUpdate = true; },
    dispose() { surface.texture.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); },
  });
  surface.redraw = () => { if (painter) plane.draw(painter); };
  return plane;
}
export function disposeObject(obj) {
  obj.traverse?.((o) => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.emissiveMap?.dispose?.(); o.material.dispose?.(); } });
}

export class Shape3D extends Block3D {
  constructor(def, o = {}) {
    super(def, o);
    this.category = def.category;
    this.meshes = [];       // pickable body parts (select / drag the whole block)
    this.subs = [];         // child pickables: userData.sub = { block, kind, id }
    this.themed = [];       // [mesh, () => hex] recoloured on theme change
    this.children3d = new THREE.Group();   // data-driven children rebuilt by body3d.refresh
    this.add(this.children3d);
    this.hoveredSub = null;
    const B = def.body3d;
    const dims = B.dims(this);
    this.width = dims.width; this.height = dims.height; this.depth = dims.depth;
    this.headerColor = () => (categories[this.category] || { header: palette.headerDefault }).header;

    B.build(this, this._helpers());

    // Title: on the body front, near the top unless the body says otherwise
    const at = B.titleAt ? B.titleAt(this) : [0, this.height / 2 - 0.45, this.depth / 2 + 0.04];
    this.titleLabel = makeLabel(this.title, { size: B.titleSize || sizes.label.title, color: B.titleColor || 'text', weight: 600, maxWidth: this.width - 0.8 });
    if (B.titleAlign === 'left') alignLabelLeft(this.titleLabel, at[0], at[1], at[2]); else this.titleLabel.position.set(...at);
    this._titleX = this.titleLabel.position.x;
    this.add(this.titleLabel); this.labels.push(this.titleLabel);
    this._titleY = at[1]; this._titleZ = at[2];

    // Ports: same anatomy as nodes (stem + typed pin + label), positions from the body, or stacked
    // beside the content on the left / right edges (centred on the body, inset from the corners)
    const P = B.ports ? B.ports(this) : null;
    const edgeTop = this.height / 2 - 0.45, edgeBottom = -this.height / 2 + 0.45;
    const stacked = { in: stackPorts(def.inputs, edgeTop, edgeBottom).ys, out: stackPorts(def.outputs, edgeTop, edgeBottom).ys };
    def.inputs.forEach((p, i) => this._addLabelledPort(p, ...(P?.in?.[i] || [-this.width / 2, stacked.in[i], 0])));
    def.outputs.forEach((p, i) => this._addLabelledPort(p, ...(P?.out?.[i] || [this.width / 2, stacked.out[i], 0])));

    if (!this.rim) {
      this.rim = new THREE.Mesh(outlineGeometry(this.width, this.height, this.depth, sizes.outline.grow, { radius: 0.3 }), materials.rim());
      this.rim.visible = false;
      this.add(this.rim);
    }
    this.shadow = makeShadowBlob(this.width, this.depth);
    this.add(this.shadow);
    this._wiringOn = this.portsVisible;
    this.applyWiring();
    this.applyVisual();
    if (B.refresh) { B.refresh(this); this.faceDirty = false; }
    def.onCreate?.(this);
  }

  /* ---------- helpers handed to body3d.build ---------- */
  _helpers() {
    const node = this;
    return {
      THREE, RoundedBoxGeometry, materials, palette, states, sizes,
      /** The platform body shape: an extruded rounded rectangle with a tiny bevel (geometry.js). */
      panelGeometry, slabGeometry, outlineGeometry, alignLabelLeft,
      /** A pickable body part; `theme` is a () => hex recoloured on theme change. */
      part(geo, mat, { pick = true, theme = null, parent = node } = {}) {
        const m = new THREE.Mesh(geo, mat);
        if (pick) { m.userData.block = node; node.meshes.push(m); }
        if (theme) node.themed.push([m, theme]);
        parent.add(m);
        return m;
      },
      label(text, opts = {}, pos = [0, 0, 0], { detail = false, parent = node } = {}) {
        const l = makeLabel(text, { size: sizes.label.small, color: 'textDim', weight: 500, ...opts });
        l.position.set(...pos);
        parent.add(l); node.labels.push(l);
        if (detail) node.detailLabels.push(l);
        return l;
      },
      /** A child pickable: clicks / drags reach body3d.onSubPointer with `sub`. */
      sub(mesh, sub, parent = node.children3d) { mesh.userData.sub = { block: node, ...sub }; node.subs.push(mesh); parent.add(mesh); return mesh; },
      canvasPlane: (w, h, opts = {}) => makeCanvasPlane(w, h, { owner: node, ...opts }),
      /** The component's live face (def.face) placed by the body. */
      face(w, h, pos = [0, 0, node.depth / 2 + 0.012], opts = {}) { const plane = node._initFace(w, h, opts); plane.position.set(...pos); node.add(plane); return plane; },
      rim(geo) { node.rim = new THREE.Mesh(geo, materials.rim()); node.rim.visible = false; node.add(node.rim); return node.rim; },
    };
  }
  _addLabelledPort(spec, x, y, z) { return super._addLabelledPort(spec, x, y, z, Math.max(z, 0) + this.depth / 2 + 0.01); }
  /** Drop every data-driven child (subs, labels inside children3d) before a rebuild. */
  clearChildren() {
    const kept = new Set();
    this.children3d.traverse((o) => { if (o !== this.children3d) kept.add(o); });
    this.subs = this.subs.filter((m) => !kept.has(m));
    this.labels = this.labels.filter((m) => !kept.has(m));
    this.detailLabels = this.detailLabels.filter((m) => !kept.has(m));
    this.themed = this.themed.filter(([m]) => !kept.has(m));
    disposeObject(this.children3d);
    this.children3d.clear();
    if (this.hoveredSub && kept.has(this.hoveredSub.mesh)) this.hoveredSub = null;
  }
  /** Label helper usable inside refresh (goes into children3d, cleared on rebuild). */
  childLabel(text, opts = {}, pos = [0, 0, 0], detail = false) {
    const l = makeLabel(text, { size: sizes.label.small, color: 'textDim', weight: 500, ...opts });
    l.position.set(...pos);
    this.children3d.add(l); this.labels.push(l);
    if (detail) this.detailLabels.push(l);
    return l;
  }
  childSub(mesh, sub) { mesh.userData.sub = { block: this, ...sub }; this.subs.push(mesh); this.children3d.add(mesh); return mesh; }

  /* ---------- sub pickables ---------- */
  subMeshes() { return this.visible ? this.subs.filter((m) => m.visible && m.parent) : []; }
  onSubPointer(ev) { const B = this.def.body3d; return B.onSubPointer ? B.onSubPointer(this, ev) : false; }
  setSubHover(sub) {
    if (this.hoveredSub === sub) return;
    this.hoveredSub = sub;
    this.def.body3d.onSubHover?.(this, sub);
  }
  /** Set the sub-selection (a card, a column, a task) and tell the selection so the panel rebuilds. */
  selectSub(sub, selection) {
    this.subSelection = sub ? { kind: sub.kind, id: sub.id } : null;
    this.faceDirty = true;
    if (selection) { if (!selection.has(this)) selection.set([this]); else selection.refresh(); }
  }

  /* ---------- per frame ---------- */
  update(time, dt) {
    const B = this.def.body3d;
    if (this.faceDirty && !this.def.face) { B.refresh?.(this); this.faceDirty = false; }
    B.update?.(this, time, dt);
    if (this.derivedState === 'active' && this.rim && !this.hovered && !this.selected) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
      this.rim.material.opacity = 0.12 + 0.25 * pulse;
    }
    this._updateLOD(dt);
    this._updateShadow();
  }
  _applyLOD() {
    super._applyLOD();
    const k = this.lodBlend;
    const far = this._farTitleScale();
    this.titleLabel.scale.setScalar(1 + (far - 1) * k);
    const farY = this.height / 2 + (this.bodyOffsetY || 0) + 0.3 + this.titleLabel.userData.worldH * far * 0.5;
    this.titleLabel.position.y = this._titleY + (farY - this._titleY) * k;
    this.titleLabel.position.x = (this._titleX || 0) * (1 - k);
    this.titleLabel.position.z = this._titleZ + 0.03 * k;
    this.def.body3d.applyLOD?.(this, k);
  }
  applyVisual() {
    const disabled = this.derivedState === 'disabled';
    if (this.titleLabel) this.titleLabel.material.opacity = disabled ? 0.45 : 1;
    for (const m of this.meshes) if (m.material && m.material.color && m.userData.dimWhenDisabled !== false) m.material.opacity = m.material.transparent ? (disabled ? m.userData.baseOpacity * 0.5 : m.userData.baseOpacity ?? m.material.opacity) : 1;
    super.applyVisual();
  }
  refreshTheme() {
    for (const [m, fn] of this.themed) m.material.color.setHex(fn());
    super.refreshTheme();   // ports, labels, faceDirty = true → refresh() redraws children
    this.shadow.material.opacity = palette.shadowAlpha;
    this.def.body3d.refreshTheme?.(this);
  }
  /** Shapes with a live face: refresh the body together with the face redraw (same dirty flag). */
  renderFace(ctx, t) { if (this.faceDirty && this.def.body3d.refresh) this.def.body3d.refresh(this); super.renderFace(ctx, t); }
  setTitle(text) { super.setTitle(text); this.faceDirty = true; }
  dispose() { this.clearChildren(); super.dispose(); }
}
export { setLabelText, refreshLabel };
