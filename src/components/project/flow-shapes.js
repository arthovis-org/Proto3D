// Process-flow shapes that execute: Flow Terminal (start / end, a stadium), Flow Step (a rounded
// process box with an optional delay) and Flow Decision (a diamond routing yes / no). They carry
// the platform's `event` type unchanged (payload included), so a board's `done` pulse can run
// through a flow into Actions and devices. Visually they are flowchart shapes tinted with the
// Project category colour, not header-banded slabs, but the port anatomy is the same. Tokens are
// visible: every event link grows a bright bead that runs from source to destination when a
// pulse passes (Connection3D.burst), and each shape flashes as the token goes through it.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { states, setLabelText } from '../../theme.js';
import { pick, compareValues, OPS, parseLiteral } from '../util.js';

const DEPTH = 0.5;
const tint = (node) => node.headerColor();

/** Extruded flowchart outline (stadium, diamond) with a small bevel. */
function extrude(shape, depth = DEPTH) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: depth - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2 + 0.04);
  return geo;
}
function stadium(w, h) {
  const s = new THREE.Shape(); const r = h / 2;
  s.moveTo(-w / 2 + r, -r); s.lineTo(w / 2 - r, -r); s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, r); s.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  return s;
}
function diamond(w, h) {
  const s = new THREE.Shape(); const k = 0.18;   // slightly rounded tips
  s.moveTo(-w / 2, 0); s.quadraticCurveTo(-w / 2 + k * 0.2, k * 0.6, -w / 2 + k, h / 2 * (1 - 2 * k / w) + 0);
  s.lineTo(-k, h / 2); s.quadraticCurveTo(0, h / 2 + 0.02, k, h / 2); s.lineTo(w / 2 - k, k * 0.6);
  s.quadraticCurveTo(w / 2, 0, w / 2 - k, -k * 0.6); s.lineTo(k, -h / 2); s.quadraticCurveTo(0, -h / 2 - 0.02, -k, -h / 2);
  s.lineTo(-w / 2 + k, -k * 0.6); s.quadraticCurveTo(-w / 2, 0, -w / 2, 0);
  return s;
}
/** Shared flash: brighten the body for ~0.5 s after a token passed. */
function flash(node, time) {
  const at = node.state.lastAt ?? -1e9;
  const k = Math.max(0, 1 - (time - at) / 0.6);
  node.shape.material.emissiveIntensity = 0.05 + 0.9 * k * k;
  if (node.glow) { node.glow.material.opacity = 0.55 * k; node.glow.visible = k > 0.01; }
}
function commonBuild(node, h, geo) {
  node.shape = h.part(geo, new THREE.MeshStandardMaterial({ color: tint(node), emissive: states.active, emissiveIntensity: 0.05, roughness: 0.5, metalness: 0.05 }), { theme: () => tint(node) });
  node.glow = new THREE.Mesh(geo.clone().scale(1.06, 1.08, 1.15), new THREE.MeshBasicMaterial({ color: states.active, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false }));
  node.glow.visible = false; node.add(node.glow);
  node.rim = h.rim(geo.clone().scale(1.04, 1.06, 1.1));
}
const stepText = (node) => (node.params.duration > 0 ? `${node.params.duration} ms` : 'instant');

/* ---------------- Flow Terminal ---------------- */
registry.register({
  id: 'flow-terminal', category: 'project', label: 'Flow Terminal', icon: icons['flow-terminal'], size: 'M',
  description: 'Where a flow starts (press Run or feed an event) or ends (counts arrivals)',
  inputs: [{ key: 'in', label: 'start', type: 'event', optional: true }],
  outputs: [{ key: 'out', label: 'next', type: 'event' }],
  params: [
    { key: 'mode', label: 'mode', type: 'select', options: ['start', 'end'], default: 'start' },
    { key: 'payload', label: 'payload (start, if no trigger)', type: 'text', default: 'go' },
  ],
  body3d: {
    dims: () => ({ width: 4.2, height: 1.5, depth: DEPTH }),
    titleAt: () => [-0.35, 0.02, DEPTH / 2 + 0.03],
    titleSize: 0.34, titleColor: 'textOnHeader',
    ports: () => ({ in: [[-2.1, 0, 0]], out: [[2.1, 0, 0]] }),
    build(node, h) {
      commonBuild(node, h, extrude(stadium(4.2, 1.5)));
      // Run button (start mode): a disc on the right end — a child pickable
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.4 }));
      btn.rotation.x = Math.PI / 2; btn.position.set(1.3, 0, DEPTH / 2 + 0.02);
      h.sub(btn, { kind: 'run' }, node);
      node.runBtn = btn;
      const tri = new THREE.Mesh(new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-0.1, -0.14); s.lineTo(0.16, 0); s.lineTo(-0.1, 0.14); s.closePath(); return s; })()), new THREE.MeshBasicMaterial({ color: tint(node) }));
      tri.position.set(1.32, 0, DEPTH / 2 + 0.09); node.add(tri); node.runTri = tri; node.themed.push([tri, () => tint(node)]);
      node.countLabel = h.label('', { size: 0.26, color: 'textOnHeader', weight: 600 }, [1.3, 0, DEPTH / 2 + 0.03]);
    },
    refresh(node) {
      const start = node.params.mode === 'start';
      node.runBtn.visible = start; node.runTri.visible = start;
      node.countLabel.visible = !start;
      if (!start) setLabelText(node.countLabel, `${node.state.arrivals || 0}×`);
    },
    update(node, time) {
      flash(node, time);
      if (node.params.mode === 'end') setLabelText(node.countLabel, `${node.state.arrivals || 0}×`);
      if (node.runBtn.visible) { const k = node.hoveredSub?.kind === 'run' ? 1.12 : 1; node.runBtn.scale.setScalar(k); node.runBtn.material.emissiveIntensity = node.hoveredSub?.kind === 'run' ? 0.6 : 0.25; }
    },
    onSubPointer(node, ev) {
      if (ev.type === 'click' && ev.sub?.kind === 'run') { node.state.runs = (node.state.runs || 0) + 1; node.state.lastAt = node.rt.ctx?.time ?? 0; node.emit('out', parseLiteral(node.params.payload)); return true; }
      return ev.type === 'down';
    },
  },
  evaluate({ inputs, params, state, time, emit }) {
    if (inputs.in) {
      state.lastAt = time;
      if (params.mode === 'start') emit('out', inputs.in.payload !== undefined ? inputs.in.payload : parseLiteral(params.payload));
      else { state.arrivals = (state.arrivals || 0) + 1; state.last = inputs.in.payload; }
    }
    return {};
  },
});

/* ---------------- Flow Step ---------------- */
registry.register({
  id: 'flow-step', category: 'project', label: 'Flow Step', icon: icons['flow-step'], size: 'M',
  description: 'One step of a flow that passes the token on, optionally after a delay',
  inputs: [{ key: 'in', label: 'start', type: 'event' }],
  outputs: [{ key: 'out', label: 'next', type: 'event' }],
  params: [{ key: 'duration', label: 'duration (ms)', type: 'number', default: 0, min: 0, max: 60000, step: 50 }],
  body3d: {
    dims: () => ({ width: 4.4, height: 1.7, depth: DEPTH }),
    titleAt: () => [0, 0.16, DEPTH / 2 + 0.03],
    titleSize: 0.36, titleColor: 'textOnHeader',
    ports: () => ({ in: [[-2.2, 0, 0]], out: [[2.2, 0, 0]] }),
    build(node, h) {
      commonBuild(node, h, new h.RoundedBoxGeometry(4.4, 1.7, DEPTH, 4, 0.22));
      node.subLabel = h.label(stepText(node), { size: 0.2, color: 'textOnHeader', weight: 500 }, [0, -0.35, DEPTH / 2 + 0.03], { detail: true });
      node.subLabel.material.opacity = 0.75;
      // progress bar while a delayed token is in flight
      node.bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: states.active }));
      node.bar.position.set(0, -0.68, DEPTH / 2 + 0.03); node.bar.visible = false; node.add(node.bar);
    },
    refresh(node) { setLabelText(node.subLabel, stepText(node)); },
    update(node, time) {
      flash(node, time);
      const q = node.state.queue || [];
      if (q.length && node.params.duration > 0) {
        const p = 1 - Math.max(0, (q[0].at - time) / (node.params.duration / 1000));
        node.bar.visible = true; node.bar.scale.x = Math.max(0.01, p * 3.6); node.bar.position.x = -1.8 + p * 1.8;
      } else node.bar.visible = false;
    },
  },
  evaluate({ inputs, params, state, time, emit }) {
    state.queue = state.queue || [];
    if (inputs.in) {
      state.count = (state.count || 0) + 1;
      if (params.duration > 0) state.queue.push({ at: time + params.duration / 1000, payload: inputs.in.payload });
      else { state.lastAt = time; emit('out', inputs.in.payload); }
    }
    while (state.queue.length && state.queue[0].at <= time) { state.lastAt = time; emit('out', state.queue.shift().payload); }
    return {};
  },
});

/* ---------------- Flow Decision ---------------- */
registry.register({
  id: 'flow-decision', category: 'project', label: 'Flow Decision', icon: icons['flow-decision'], size: 'M',
  description: 'A yes / no fork in a flow, decided by a condition input or a test on the token',
  inputs: [{ key: 'in', label: 'start', type: 'event' }, { key: 'condition', label: 'condition', type: 'boolean', optional: true }],
  outputs: [{ key: 'yes', label: 'yes', type: 'event' }, { key: 'no', label: 'no', type: 'event' }],
  params: [
    { key: 'field', label: 'payload field (empty = payload)', type: 'text', default: 'priority' },
    { key: 'op', label: 'op', type: 'select', options: OPS, default: '=' },
    { key: 'value', label: 'value', type: 'text', default: 'urgent' },
  ],
  body3d: {
    dims: () => ({ width: 4.8, height: 2.6, depth: DEPTH }),
    titleAt: () => [0, 0.18, DEPTH / 2 + 0.03],
    titleSize: 0.32, titleColor: 'textOnHeader',
    // inputs on the left edge (in at the tip, condition below it), outputs on the right edge (yes up, no down)
    ports: () => ({ in: [[-2.4, 0.0, 0], [-1.6, -0.45, 0]], out: [[1.6, 0.45, 0], [1.6, -0.45, 0]] }),
    build(node, h) {
      commonBuild(node, h, extrude(diamond(4.8, 2.6)));
      node.ruleLabel = h.label('', { size: 0.19, color: 'textOnHeader', weight: 500, maxWidth: 2.6 }, [0, -0.28, DEPTH / 2 + 0.03], { detail: true });
      node.ruleLabel.material.opacity = 0.75;
    },
    refresh(node) { const p = node.params; setLabelText(node.ruleLabel, `${p.field || 'payload'} ${p.op} ${p.value}`); },
    update(node, time) { flash(node, time); },
  },
  evaluate({ inputs, params, state, time, emit }) {
    if (!inputs.in) return {};
    state.lastAt = time;
    const payload = inputs.in.payload;
    let ok;
    if (inputs.condition !== undefined) ok = !!inputs.condition;
    else { const v = params.field ? pick(payload, params.field) : payload; ok = compareValues(v, parseLiteral(params.value), params.op); }
    state.last = ok;
    emit(ok ? 'yes' : 'no', payload);
    return {};
  },
  footer: ({ state }) => (state.last === undefined ? '' : state.last ? 'yes' : 'no'),
});

export const flowIds = ['flow-terminal', 'flow-step', 'flow-decision'];
