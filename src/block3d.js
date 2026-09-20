// block3d.js — Block3D: everything a node and a device share. A block is a registered
// component instance in the scene: definition, params, per-instance state, typed ports,
// a rim for hover / selected / error, a fake contact shadow, canvas labels, an optional live
// canvas face and level-of-detail blending. Node3D, Device3D and Shape3D only add geometry.
//
// Port anatomy (createPort): a short stem out of the side face + a typed pin.
//   • event ports are chevron pins pointing in the flow direction (+X): into the body on the
//     left (inputs), away from it on the right (outputs) — like exec pins in a node editor;
//   • data ports (number, text, boolean, data, media, any) are spheres;
//   • multi inputs (accept several cables) are vertical rounded rectangles — Blender's
//     multi-input socket: one slot per cable, stacked top to bottom in connection order, the
//     rectangle grows by a slot for every cable (hollow outline when empty, a filled bar per
//     connected slot, a spare slot with a "+" while a cable hovers) and the ports below shift
//     down (`relayoutPorts`); event multi inputs stack chevrons the same way;
//   • a connected port is filled and bright, an unconnected one is a hollow ring in the type
//     colour (dark core + coloured outline shell); optional ports are slightly smaller;
//   • a `data` port with a subtype (person, tasks, milestone…) takes the subtype's colour;
//   • emphasis: 'glow' (compatible target while hovering / dragging: pulsing rim), 'dim'
//     (incompatible: 35 %), 'reject' (red ring under the pointer);
//   • the name label sits just outside the body and is hidden by default: it fades in (~120 ms)
//     while the port or its cable is hovered, while it is a compatible target of a cable drag
//     (dimmed when incompatible) and while its block is selected (`nameMode`, `_fadeNames`);
//   • `alignPorts` places a side's pins level with the content they affect (`anchorY`) and
//     nudges colliding pins apart by the minimum gap; `stackPorts` is the centred fallback.
import * as THREE from 'three';
import {
  palette, states, sizes, materials, makeLabel, refreshLabel, setLabelText, makeShadowBlob, onThemeChange, portColorFor,
} from './theme.js';
import { panelGeometry } from './geometry.js';
import { portsVisibleFor, onWiringChange } from './wiring.js';
import { defaultParams, clone } from './core/component.js';
import { formatValue } from './core/types.js';
import { clear as clearFace } from './faces.js';
import { createSurface, baseFaceScale, fitTier } from './face-canvas.js';

let nextUid = 1;
export const genUid = () => `b${(nextUid++).toString(36)}${Date.now().toString(36).slice(-3)}`;
/** Keep uids unique after a load. */
export function bumpUidCounter(n) { nextUid = Math.max(nextUid, n + 1); }

const ballGeo = new THREE.SphereGeometry(sizes.port.radius, 20, 14);
const stemGeo = new THREE.CylinderGeometry(sizes.port.radius * 0.36, sizes.port.radius * 0.36, sizes.port.stem, 10);
/** Pentagon "exec pin" pointing +X, extruded in Z and centred. */
function makePinGeometry() {
  const { w, h, d } = sizes.port.pin;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w * 0.08, -h / 2); s.lineTo(w / 2, 0); s.lineTo(w * 0.08, h / 2); s.lineTo(-w / 2, h / 2); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  g.computeVertexNormals();
  return g;
}
const pinGeo = makePinGeometry();
const SLOT = sizes.port.slot;
const fillGeo = new THREE.BoxGeometry(SLOT.fillW, SLOT.fillH, SLOT.d + 0.02);
/** Multi-input rectangle for `n` slots (height = pad + slot height × n); `margin` grows it for the outline shell. */
export function makeSlotGeometry(n, margin = 0) {
  const h = SLOT.pad + SLOT.h * Math.max(1, n);
  const g = panelGeometry(SLOT.w + margin, h + margin, SLOT.d + margin, { radius: SLOT.radius + margin / 2, bevel: 0.012, curveSegments: 6 });
  g.type = 'SlotGeometry'; g.userData.slots = Math.max(1, n); g.userData.height = h;
  return g;
}
let portSeq = 1;
/** 'chevron' for events, 'slot' for multi inputs (a rectangle with one slot per cable), 'sphere' for every other value. */
export const portShapeFor = (type, multi = false, dir = 'in') => (type === 'event' ? 'chevron' : multi && dir === 'in' ? 'slot' : 'sphere');

/**
 * Distribute one side's ports along a body edge, beside the content band `top..bottom`: the
 * ungrown stack sits centred in the band at `gap` pitch, compressing to `minGap` when the band
 * is short. Grown multi-input slots (`extraHeight`) push the ports below them down; the stack
 * first slides up along the edge to stay inside the band and reports as `overflow` only what
 * still does not fit, so the owner extends its body by that much (and no more). `list` may be
 * port records or bare specs (no `extraHeight`). Returns `{ ys, gap, overflow }`.
 */
export function stackPorts(list, top, bottom, { gap = sizes.port.gap, minGap = sizes.port.minGap, pad = sizes.port.pad } = {}) {
  const n = list.length;
  if (!n) return { ys: [], gap, overflow: 0 };
  const extras = list.map((p) => p.extraHeight || 0);
  const grown = extras.reduce((a, b) => a + b, 0);
  const avail = Math.max(0, top - bottom - 2 * pad);
  let g = gap;
  if (n > 1 && (n - 1) * gap + grown > avail) g = Math.max(minGap, Math.min(gap, (avail - grown) / (n - 1)));
  const stack = (n - 1) * g + grown;
  let first = (top + bottom) / 2 + (n - 1) * g / 2;
  const room = first - stack - pad - bottom;
  if (room < 0) first = Math.min(first - room, top - pad);
  const overflow = Math.max(0, bottom - (first - stack - pad));
  const ys = []; let acc = 0;
  for (let i = 0; i < n; i++) { ys.push(first - i * g - acc); acc += extras[i]; }
  return { ys, gap: g, overflow };
}

/**
 * Place one side's ports at the content they affect. `anchors` maps a port key to the local y of
 * its face region (a component hint, §7c); a port without an anchor takes its `stackPorts`
 * position. Ports are then sorted top to bottom by that target and pushed apart to at least
 * `minGap` (a grown multi-input slot counts its extra height below it), kept inside
 * `bottom + pad .. top - pad`; when the set no longer fits, the whole stack keeps its top and
 * `overflow` reports how far it runs past `bottom` (the owner may extend its body). Each port
 * record receives `anchorY` (the target it was aimed at, or null). Returns `{ ys, overflow }`
 * in the list's order.
 */
export function alignPorts(list, anchors, top, bottom, { minGap = sizes.port.minGap, pad = sizes.port.pad, gap = sizes.port.gap } = {}) {
  const base = stackPorts(list, top, bottom, { gap, minGap, pad });
  const has = anchors && list.some((p) => Number.isFinite(anchors[p.key]));
  for (const p of list) p.anchorY = has && Number.isFinite(anchors[p.key]) ? anchors[p.key] : null;
  if (!has) return { ys: base.ys, overflow: base.overflow };
  const n = list.length;
  const want = list.map((p, i) => (p.anchorY !== null ? p.anchorY : base.ys[i]));
  const extra = list.map((p) => p.extraHeight || 0);
  const order = list.map((_, i) => i).sort((a, b) => (want[b] - want[a]) || (a - b));   // top first, definition order on ties
  const hi = top - pad, lo = bottom + pad;
  const ys = order.map((i) => Math.min(hi, want[i]));
  for (let k = 1; k < n; k++) ys[k] = Math.min(ys[k], ys[k - 1] - extra[order[k - 1]] - minGap);
  ys[n - 1] = Math.max(ys[n - 1], lo + extra[order[n - 1]]);
  for (let k = n - 2; k >= 0; k--) ys[k] = Math.max(ys[k], ys[k + 1] + extra[order[k]] + minGap);
  let overflow = 0;
  if (ys[0] > hi) { overflow = ys[0] - hi; for (let k = 0; k < n; k++) ys[k] -= overflow; }
  const out = new Array(n);
  order.forEach((i, k) => { out[i] = ys[k]; });
  return { ys: out, overflow };
}
/** A component's anchor hint may be flat (`{ key: y }`, both sides) or split (`{ in: {…}, out: {…} }`). */
export function splitAnchors(a) {
  if (!a || typeof a !== 'object') return { in: null, out: null };
  if (a.in || a.out) return { in: a.in || null, out: a.out || null };
  return { in: a, out: a };
}
/** How long a port name takes to fade in or out (s). */
export const NAME_FADE = 0.12;

/**
 * Shared port anatomy. `owner` is the block (or a collapsed group) hosting it. Returns a plain
 * port record that the engine annotates with `value`, `changedAt`, `pulse`, `rate`.
 */
export function createPort(owner, { key, label, type = 'any', subtype = null, loose = false, dir = 'in', multi = false, optional = false }) {
  const sign = dir === 'in' ? -1 : 1;
  const color0 = portColorFor(type, subtype);
  const group = new THREE.Group();
  const stem = new THREE.Mesh(stemGeo, materials.portStem());
  stem.rotation.z = Math.PI / 2;
  stem.position.x = sign * sizes.port.stem * 0.5;
  const shape = portShapeFor(type, multi, dir);
  const stacked = multi && dir === 'in';                      // slot rectangle, or stacked chevrons for event multi inputs
  const geo = shape === 'chevron' ? pinGeo : shape === 'slot' ? makeSlotGeometry(1) : ballGeo;
  const mesh = new THREE.Mesh(geo, materials.port(type, color0));
  mesh.position.x = sign * sizes.port.stem;
  const shell = new THREE.Mesh(shape === 'slot' ? makeSlotGeometry(1, SLOT.margin) : geo, materials.portShell(type, color0));
  shell.position.copy(mesh.position);
  shell.renderOrder = 1;
  group.add(stem, mesh, shell);
  const baseScale = (multi && shape !== 'slot' ? 1.15 : 1) * (optional ? sizes.port.optionalScale : 1);
  const port = {
    kind: 'port',
    id: portSeq++, owner, key, label: label || key, name: label || key, type, subtype, loose, dir, multi, optional, shape, group, mesh, shell, stem,
    color: color0,
    baseScale,
    basePos: [0, 0, 0],       // where the owner placed the port; relayoutPorts() shifts it down under grown multi inputs
    links: 0,                 // cables ending here (multi inputs grow one slot per cable)
    slots: 1,                 // slots currently shown (links, plus a spare one while a cable hovers)
    spare: 0,                 // 1 while the spare slot (with the "+") is shown
    extraHeight: 0,           // how far this port pushes the ports below it down
    fills: [],                // per-slot filled bars (slot) or extra chevrons (event multi)
    pickMeshes: [mesh, shell],
    value: undefined, changedAt: -1, lastPulseAt: -1, pulse: null, rate: 0, changes: 0,
    disabled: false, hovered: false, connected: false, emphasis: null, pulsePhase: 0,
    proxy: null,   // set while the owner sits in a collapsed group: connections attach to the proxy
    labelMesh: null, glyphMesh: null,
    anchorY: null,            // the local y of the face region this port was aimed at (alignPorts), null when stacked
    nameMode: null,           // null | 'full' | 'dim' — asked for by the interaction layer (hover, cable drag, cable hover)
    nameAlpha: 0,             // animated 0..1 opacity of the name label (Block3D._fadeNames)
    /** Ask for the name label: 'full' (hovered, compatible target, its cable hovered), 'dim' (incompatible while a cable is dragged) or null. */
    setNameShown(mode) { port.nameMode = mode || null; },
    /** World position of the pin, or of slot `index` on a multi input (cables end in their own slot). */
    getWorldPosition(target = new THREE.Vector3(), index = -1) {
      if (port.proxy) return port.proxy.getWorldPosition(target, index);
      if (stacked && index >= 0) {
        target.set(mesh.position.x, -Math.min(index, port.slots - 1) * SLOT.h, 0);
        group.updateWorldMatrix(true, false);
        return group.localToWorld(target);
      }
      return mesh.getWorldPosition(target);
    },
    /** Direction the cable leaves / enters in world space (+X for outputs, −X for inputs, rotated with the owner). */
    getWorldDirection(target = new THREE.Vector3()) {
      target.set(sign, 0, 0);
      const o = port.proxy ? port.proxy.owner : owner;
      if (o && o.isObject3D) target.applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
      return target;
    },
    setHover(on) { port.hovered = on; port._layoutSlots(); port.applyLook(); },
    setConnected(on) { on = !!on; if (port.connected !== on) { port.connected = on; port.applyLook(); } },
    /** Number of cables ending on this input; a multi input grows a slot per cable. */
    setLinkCount(n) { n = Math.max(0, n | 0); if (port.links !== n) { port.links = n; port._layoutSlots(); port.applyLook(); } },
    /** null | 'glow' | 'dim' | 'reject' */
    setEmphasis(mode) { mode = mode || null; if (port.emphasis !== mode) { port.emphasis = mode; port._layoutSlots(); port.applyLook(); } },
    setDisabled(on) { port.disabled = on; port.applyLook(); },
    /** Per-frame pulse for 'glow' emphasis (called by the interaction layer). */
    pulseTick(t) {
      if (port.emphasis !== 'glow') return;
      const k = 0.5 + 0.5 * Math.sin(t * 6 + port.pulsePhase);
      shell.material.opacity = 0.45 + 0.5 * k;
      if (shape === 'slot') shell.scale.setScalar(1 + 0.1 * k);
      else shell.scale.setScalar(port.baseScale * (sizes.port.shellScale + 0.22 * k));
      mesh.material.emissiveIntensity = 0.7 + 0.6 * k;
    },
    /**
     * Multi inputs: show one slot per cable plus a spare slot with a "+" while a cable hovers
     * (hovered or a compatible target). Rebuilds the rectangle, moves the stem to its centre and
     * asks the owner to shift the ports below when the height changed.
     */
    _layoutSlots() {
      if (!stacked) return;
      const spare = shape === 'slot' && (port.hovered || port.emphasis === 'glow') ? 1 : 0;
      port.spare = spare;
      const slots = Math.max(1, port.links + spare);
      if (slots !== port.slots) {
        port.slots = slots;
        if (shape === 'slot') {
          mesh.geometry.dispose(); mesh.geometry = makeSlotGeometry(slots);
          shell.geometry.dispose(); shell.geometry = makeSlotGeometry(slots, SLOT.margin);
        }
        const cy = -(slots - 1) * SLOT.h / 2;
        mesh.position.y = cy; shell.position.y = cy; stem.position.y = cy;
      }
      // per-slot marks: filled bars inside the rectangle, or extra chevrons for event multi inputs
      while (port.fills.length < slots) {
        const i = port.fills.length;
        const f = shape === 'slot' ? new THREE.Mesh(fillGeo, materials.port(type, port.color)) : new THREE.Mesh(pinGeo, materials.port(type, port.color));
        f.position.set(mesh.position.x, -i * SLOT.h, 0);
        f.userData.port = port; f.renderOrder = 1;
        group.add(f); port.fills.push(f); port.pickMeshes.push(f);
      }
      port.fills.forEach((f, i) => { f.visible = shape === 'slot' ? i < port.links : i > 0 && i < slots; });
      if (port.glyphMesh) { port.glyphMesh.position.set(mesh.position.x, -port.links * SLOT.h, 0.14); port.glyphMesh.visible = spare > 0 && !port.disabled; }
      const extra = (slots - 1) * SLOT.h;
      if (extra !== port.extraHeight) { port.extraHeight = extra; owner.relayoutPorts?.(); }
    },
    /** Derive every material property from the state flags. */
    applyLook() {
      const c = port.color;
      const m = mesh.material, sm = shell.material;
      if (shape === 'slot') { port._applySlotLook(); return; }
      const s = port.baseScale * (port.hovered ? sizes.port.hoverScale : 1);
      mesh.scale.setScalar(s);
      shell.scale.setScalar(s * sizes.port.shellScale);
      m.opacity = 1; sm.opacity = 0.95;
      stem.material.opacity = 1;
      const fills = port.fills;
      if (port.disabled) {
        m.color.setHex(states.disabled); m.emissive.setHex(states.disabled); m.emissiveIntensity = 0.05;
        shell.visible = false;
        fills.forEach((f) => { f.material.color.setHex(states.disabled); f.material.emissive.setHex(states.disabled); });
        return;
      }
      if (port.connected || port.hovered) {
        // filled and bright
        m.color.setHex(c); m.emissive.setHex(c); m.emissiveIntensity = port.hovered ? 1.2 : 0.6;
        shell.visible = false;
      } else {
        // hollow: dark core with a coloured outline
        m.color.setHex(palette.body); m.emissive.setHex(c); m.emissiveIntensity = 0.1;
        shell.visible = true; sm.color.setHex(c); sm.opacity = 0.95;
      }
      fills.forEach((f) => { f.material.color.copy(m.color); f.material.emissive.copy(m.emissive); f.material.emissiveIntensity = m.emissiveIntensity; f.material.opacity = 1; f.scale.setScalar(s); });
      switch (port.emphasis) {
        case 'glow':
          shell.visible = true; sm.color.setHex(c); sm.opacity = 0.7;
          m.color.setHex(c); m.emissive.setHex(c); m.emissiveIntensity = 0.9;
          shell.scale.setScalar(port.baseScale * (sizes.port.shellScale + 0.1));
          break;
        case 'dim':
          m.opacity = 0.35; sm.opacity = 0.3; stem.material.opacity = 0.5;
          fills.forEach((f) => { f.material.opacity = 0.35; });
          break;
        case 'reject':
          shell.visible = true; sm.color.setHex(states.error); sm.opacity = 1;
          shell.scale.setScalar(port.baseScale * (sizes.port.shellScale + 0.3));
          m.color.setHex(states.error); m.emissive.setHex(states.error); m.emissiveIntensity = 0.8;
          break;
        default: break;
      }
    },
    /** Slot rectangle: dark core, coloured outline always on (it is a socket), a bright bar per cable. */
    _applySlotLook() {
      const c = port.color;
      const m = mesh.material, sm = shell.material;
      mesh.scale.setScalar(1);
      shell.scale.setScalar(port.hovered ? SLOT.hoverScale : 1);
      m.opacity = 1; stem.material.opacity = 1;
      if (port.disabled) {
        m.color.setHex(states.disabled); m.emissive.setHex(states.disabled); m.emissiveIntensity = 0.05;
        shell.visible = false; port.fills.forEach((f) => { f.visible = false; });
        if (port.glyphMesh) port.glyphMesh.visible = false;
        return;
      }
      const any = port.links > 0;
      m.color.setHex(palette.body); m.emissive.setHex(c); m.emissiveIntensity = port.hovered ? 0.35 : any ? 0.18 : 0.08;
      shell.visible = true; sm.color.setHex(c); sm.opacity = port.hovered ? 1 : any ? 0.95 : 0.8;
      port.fills.forEach((f, i) => { f.visible = i < port.links; f.material.color.setHex(c); f.material.emissive.setHex(c); f.material.emissiveIntensity = port.hovered ? 1.2 : 0.7; f.material.opacity = 1; });
      if (port.glyphMesh) port.glyphMesh.visible = !!port.spare;   // only while a cable hovers
      switch (port.emphasis) {
        case 'glow': sm.opacity = 0.7; m.emissive.setHex(c); m.emissiveIntensity = 0.5; break;
        case 'dim': m.opacity = 0.35; sm.opacity = 0.3; stem.material.opacity = 0.5; port.fills.forEach((f) => { f.material.opacity = 0.35; }); break;
        case 'reject': sm.color.setHex(states.error); sm.opacity = 1; shell.scale.setScalar(1.15); m.emissive.setHex(states.error); m.emissiveIntensity = 0.6; break;
        default: break;
      }
    },
    refreshTheme() {
      port.color = portColorFor(type, subtype);
      stem.material.color.setHex(palette.portStem);
      port.applyLook();
    },
  };
  stem.material.transparent = true;
  mesh.userData.port = port;
  shell.userData.port = port;
  stem.userData.port = port;
  port.applyLook();
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
    this.faceScale = baseFaceScale();   // backing-store tier of every canvas surface on this block (face-canvas.js)
    this.face = null;
    this.faceDirty = true;
    this.subSelection = null;  // { kind, id } — a child pickable (card, column, item) the panel edits
    this.world = null;
    this.portLabelSide = 'outside';  // port names ride the wire just outside the body; 'inside' for plain slabs with no content behind them
    this.dropTarget = false;         // a card is being dragged over this block (assign on drop)
    this.bodyOffsetY = 0;            // the body's centre relative to the origin when it grew (getAABB)
    this._portsExtra = 0;            // how much the tallest side of ports grew (multi-input slots)
    this.showPorts = o.showPorts === true || o.showPorts === false ? o.showPorts : null;   // per-component override of the global wiring flag
    this.wiringLabels = new Set();   // port names: hidden with the ports
    this._offTheme = onThemeChange(() => this.refreshTheme());
    this._offWiring = onWiringChange(() => this.applyWiring());
  }

  /** Whether this block shows its pins, labels and captions (its override, else the global wiring flag). */
  get portsVisible() { return portsVisibleFor(this); }
  /** Per-component override: true / false, or null to follow the global flag. */
  setShowPorts(v) { this.showPorts = v === true || v === false ? v : null; this.applyWiring(); this.world?.changed('wiring'); }
  /** Show / hide every port (names follow on their own fade). The body never changes size with the switch; subclasses may react through `_onWiringChange`. */
  applyWiring() {
    const on = this.portsVisible;
    for (const p of this.ports) { p.group.visible = on; if (!on && p.labelMesh) { p.labelMesh.visible = false; p.nameAlpha = 0; } }
    if (this._wiringOn !== on) { this._wiringOn = on; this._onWiringChange?.(on); }
    this.world?.bumpLayout();
  }
  /** Target opacity of a port's name right now: shown while the block is selected, the port is hovered or asked for ('full'), dimmed for an incompatible target during a cable drag. */
  _nameTarget(p) {
    if (!this.portsVisible || this.lodBlend > 0.98) return 0;
    if (this.selected || p.hovered || p.nameMode === 'full') return 1;
    if (p.nameMode === 'dim') return 0.4;
    return 0;
  }
  /** Per frame: fade every port name towards its target over NAME_FADE seconds (names are hidden by default and appear on hover, drag or selection). */
  _fadeNames(dt) {
    const lodA = 1 - this.lodBlend;
    for (const p of this.ports) {
      const l = p.labelMesh; if (!l) continue;
      const t = this._nameTarget(p);
      if (Math.abs(p.nameAlpha - t) < 1e-3) p.nameAlpha = t;
      else p.nameAlpha += Math.sign(t - p.nameAlpha) * Math.min(Math.abs(t - p.nameAlpha), dt / NAME_FADE);
      const a = p.nameAlpha * lodA * (l.userData.alpha ?? 1);
      l.material.opacity = a;
      l.visible = a > 0.02;
    }
  }

  get ports() { return [...this.inputs, ...this.outputs]; }
  getPort(key, dir) { return (dir === 'in' ? this.inputs : dir === 'out' ? this.outputs : this.ports).find((p) => p.key === key) || null; }

  _addPort(spec, x, y, z = 0) {
    const port = createPort(this, spec);
    port.basePos = [x, y, z];
    port.group.position.set(x, y, z);
    this.add(port.group);
    (spec.dir === 'in' ? this.inputs : this.outputs).push(port);
    if (spec.multi) {
      // "+" glyph: sits in the spare slot of a multi input while a cable hovers ("one more fits here")
      const g = makeLabel('+', { size: 0.16, color: 'text', weight: 700 });
      g.position.set(port.mesh.position.x, port.shape === 'slot' ? 0 : 0.19, 0.14);
      g.visible = port.shape !== 'slot';
      port.group.add(g); this.labels.push(g);
      if (port.shape !== 'slot') this.detailLabels.push(g);
      port.glyphMesh = g;
      port._layoutSlots();
    }
    return port;
  }
  /**
   * Re-place every port from its `basePos`, shifting the ports under a grown multi input down by
   * its extra height (Blender node behaviour); labels follow. Subclasses may grow their body
   * through `_onPortsGrow(extra)`. Node3D overrides this with its edge stacking (`stackPorts`).
   */
  relayoutPorts() {
    let most = 0;
    for (const list of [this.inputs, this.outputs]) {
      let acc = 0;
      for (const p of list) {
        const [x, y, z] = p.basePos;
        p.group.position.set(x, y - acc, z);
        this._placePortLabel(p);
        acc += p.extraHeight || 0;
      }
      most = Math.max(most, acc);
    }
    if (most !== this._portsExtra) { this._portsExtra = most; this._onPortsGrow?.(most); }
    this.world?.bumpLayout();
  }
  /**
   * A port with its name label. By default the name sits just outside the body, past the pin and
   * riding above where the wire leaves (`portLabelSide` 'outside'); 'inside' puts it on the body
   * front beside the pin (`zFront`) for slabs with nothing behind it. Names start hidden and fade
   * in on hover, cable drag or selection (`_fadeNames`).
   */
  _addLabelledPort(spec, x, y, z = 0, zFront = this.depth / 2 + 0.01) {
    const port = this._addPort(spec, x, y, z);
    const label = makeLabel(spec.label, { size: sizes.label.port, color: 'textDim', weight: 500, maxWidth: sizes.port.labelMax });
    label.userData.alpha = 0.85;
    this.add(label); this.labels.push(label); this.detailLabels.push(label); this.wiringLabels.add(label);
    port.labelMesh = label; port.labelZ = zFront;
    this._placePortLabel(port);
    port.group.visible = this.portsVisible;
    label.visible = false; label.material.opacity = 0;   // names appear on hover, cable drag or selection (_fadeNames)
    return port;
  }
  /** Put a port's name where its pin is now (outside: past the pin, lifted above the wire; inside: beside it on the body front). */
  _placePortLabel(port) {
    const l = port.labelMesh; if (!l) return;
    const P = sizes.port, { x, y, z } = port.group.position;
    const half = l.userData.worldW / 2;
    const inside = this.portLabelSide === 'inside';
    const dx = inside ? 0.22 + half : P.stem + P.labelGap + half;
    const towardsBody = (port.dir === 'in') === inside;   // inputs read into the body, outputs out of it — and the reverse outside
    l.position.set(towardsBody ? x + dx : x - dx, inside ? y - (port.extraHeight || 0) / 2 : y + P.labelLift, inside ? (port.labelZ ?? this.depth / 2 + 0.01) : z + 0.09);
  }

  /* ---------- face: a live canvas on the body ---------- */
  /** Create the face canvas + plane; the subclass positions the returned mesh. */
  _initFace(w, h, { emissive = 0.55, mesh = true, transparent = true } = {}) {
    // logical size cw × ch (120 px / unit) is what renderers and hit-testing use; the bitmap is cw × scale
    const surface = createSurface(w, h, { scale: this.faceScale });
    clearFace(surface.g, surface.cw, surface.ch);
    const plane = mesh ? new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials.face(surface.texture, { emissive, transparent })) : null;
    if (plane) { plane.userData.face = this; plane.userData.block = this; plane.renderOrder = 1; }
    this.face = Object.assign(surface, { mesh: plane, lastDrawAt: -1e9 });
    surface.redraw = () => this.renderFace();
    return plane;
  }
  /**
   * Backing-store resolution (called by the LOD pass). `ratio` = device pixels one logical face
   * pixel covers at this block's distance (1 = drawn at exactly its 120 px / unit density);
   * `allowance` caps the tier. On a tier change every canvas surface on the block (face, screen,
   * board cards, timeline bars) is resized and repainted once. Returns true when it re-baked.
   */
  fitFaceResolution(ratio, allowance) {
    const want = fitTier(this.faceScale, ratio, allowance);
    if (want === this.faceScale) return false;
    this.faceScale = want;
    const seen = new Set();
    this.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const s = m.map?.userData?.surface || m.emissiveMap?.userData?.surface;
        if (s && !seen.has(s)) { seen.add(s); if (s.setScale(want)) s.redraw?.(); }
      }
    });
    return true;
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
    const { g, texture, cw, ch } = this.face;
    try { F.render(g, cw, ch, this._faceCtx(ctx || this.rt.ctx || {})); }
    catch (e) { clearFace(g, cw, ch); this.rt.error = e.message; }
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
  /** A card (or another block) is being dragged over this block and will act on it when dropped. */
  setDropTarget(on) { on = !!on; if (this.dropTarget !== on) { this.dropTarget = on; this.applyVisual(); } }
  /** Rim priority: error > drop target > selected > hover > active. Ports grey out when disabled. */
  _rimLook() {
    const s = this.derivedState;
    if (s === 'error') return [states.error, 0.6];
    if (this.dropTarget) return [states.active, 0.75];
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
    this._fadeNames(dt);
  }
  _applyLOD() {
    const a = 1 - this.lodBlend;
    for (const l of this.detailLabels) { if (this.wiringLabels.has(l)) continue; l.material.opacity = a * (l.userData.alpha ?? 1); l.visible = a > 0.02; }   // port names: _fadeNames
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
    const cy = this.position.y + (this.kind === 'device' ? hh : 0) + (this.bodyOffsetY || 0) * s;
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
      ...(this.showPorts === null ? {} : { showPorts: this.showPorts }),
      position: [+this.position.x.toFixed(3), +this.position.y.toFixed(3), +this.position.z.toFixed(3)],
      rotationY: +this.rotation.y.toFixed(4), scale: +this.scale.x.toFixed(3),
    };
  }

  dispose() {
    this._offTheme?.();
    this._offWiring?.();
    this.def.onDestroy?.(this);
    this.traverse((obj) => {
      if (obj === this) return;
      if (obj.geometry === pinGeo || obj.geometry === ballGeo || obj.geometry === stemGeo || obj.geometry === fillGeo) { obj.material?.dispose?.(); return; }  // shared geometries
      obj.geometry?.dispose?.();
      if (obj.material) {
        obj.material.map?.dispose?.();
        obj.material.emissiveMap?.dispose?.();
        obj.material.dispose?.();
      }
    });
  }
}
