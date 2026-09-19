// Milestone — a dated goal as a small flag on a pole. `milestone` carries { title, date,
// daysLeft, reached } (a board shows it in its header, a Timeline draws it on its axis, a
// Dashboard counts down to it); `when reached` pulses once when today reaches the date. The flag
// turns from accent to green when reached, red when it slipped.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, setLabelText } from '../../theme.js';
import { daysUntil, fmtDate, isoDate, DAY_MS } from '../../pm/model.js';

const W = 3.0, H = 3.2, D = 0.6;
const status = (node) => { const d = daysUntil(node.params.date); return Number.isNaN(d) ? 'undated' : d <= 0 ? 'reached' : d <= 3 ? 'soon' : 'ahead'; };
const flagColour = (node) => ({ reached: 0x2dd4bf, soon: 0xf5b942, ahead: palette.pmToday, undated: palette.portStem })[status(node)];
const dateText = (node) => { const d = daysUntil(node.params.date); return Number.isNaN(d) ? 'no date' : d === 0 ? `${fmtDate(node.params.date)} · today` : d > 0 ? `${fmtDate(node.params.date)} · in ${d} d` : `${fmtDate(node.params.date)} · ${-d} d ago`; };

export default registry.register({
  id: 'milestone', category: 'project', label: 'Milestone', icon: icons.milestone, size: 'S',
  description: 'A dated goal on a flag that boards, timelines and dashboards show and that fires once when the day comes',
  outputs: [{ key: 'reached', label: 'when reached', type: 'event' }, { key: 'milestone', label: 'milestone', type: 'data', subtype: 'milestone' }],
  params: [{ key: 'date', label: 'date (yyyy-mm-dd)', type: 'text', default: isoDate(new Date(Date.now() + 14 * DAY_MS)) }],
  body3d: {
    dims: () => ({ width: W, height: H, depth: D }),
    titleAt: () => [0.05, 0.94, 0.07], titleSize: 0.3, titleColor: '#ffffff',
    ports: () => ({ in: [], out: [[W / 2, 0.2, 0], [W / 2, -0.35, 0]] }),
    build(node, h) {
      const base = h.part(h.slabGeometry(2.0, 1.2, 0.2, { radius: 0.2, bevel: 0.015 }), h.materials.body(), { theme: () => palette.body });
      base.position.set(-0.6, -H / 2 + 0.12, 0);
      const pole = h.part(new THREE.CylinderGeometry(0.05, 0.06, H - 0.3, 12), h.materials.device(palette.deviceFrame), { theme: () => palette.deviceFrame });
      pole.position.set(-1.05, -0.03, 0);
      node.flag = h.part(h.panelGeometry(2.1, 1.1, 0.08, { radius: 0.14, bevel: 0.012 }), h.materials.panel(flagColour(node), { emissive: flagColour(node), emissiveIntensity: 0.2 }));
      node.flag.position.set(0.05, 0.75, 0);
      node.dateLabel = h.label(dateText(node), { size: 0.17, color: '#ffffff', weight: 500 }, [0.05, 0.56, 0.07], { detail: true });
      node.statusLabel = h.label('', { size: 0.15, color: 'textDim', weight: 600, caps: true, spacing: 0.08 }, [-0.4, -H / 2 + 0.55, 0.62], { detail: true });
      node.themed.push([node.flag, () => flagColour(node)]);
    },
    refresh(node) {
      const c = flagColour(node); node.flag.material.color.setHex(c); node.flag.material.emissive.setHex(c);
      setLabelText(node.dateLabel, dateText(node)); setLabelText(node.statusLabel, status(node));
    },
    update(node, time) {
      // the flag ripples a little; reached flags glow
      node.flag.rotation.y = Math.sin(time * 1.7 + node.position.x) * 0.06;
      node.flag.material.emissiveIntensity = status(node) === 'reached' ? 0.35 + 0.15 * Math.sin(time * 3) : 0.2;
      if (node._day !== isoDate()) { node._day = isoDate(); node.faceDirty = true; }
    },
  },
  evaluate({ params, state, instance, emit }) {
    const d = daysUntil(params.date);
    const reached = !Number.isNaN(d) && d <= 0;
    if (reached && state.firedFor !== params.date) { state.firedFor = params.date; emit('reached', { title: instance.title, date: params.date }); }
    if (!reached) state.firedFor = null;
    return { milestone: { title: instance.title, date: params.date, daysLeft: Number.isNaN(d) ? null : d, reached } };
  },
});
