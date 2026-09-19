// Timeline — a standing 3D Gantt. Time runs along X (day ticks and week labels on a low rail),
// every task is a bar in its own row, coloured by assignee, priority or column, with its title on
// the bar face; milestones are small flags on the rail; a translucent "today" plane cuts the
// chart. Feed it a board's `tasks` output (cards with due dates / estimates become bars) or edit
// its own task list in the panel; dragging a bar's right-hand handle in 3D changes its due date.
import * as THREE from 'three';
import { registry } from '../../core/registry.js';
import { icons } from '../../icons.js';
import { palette, states } from '../../theme.js';
import { font } from '../../faces.js';
import { toTasks, daysUntil, addDays, isoDate, fmtDate, PRIORITY_COLOURS } from '../../pm/model.js';
import { buildTimelinePanel } from '../../pm/panel-pm.js';
import { makeCanvasPlane } from '../../shape3d.js';
const clone = (v) => JSON.parse(JSON.stringify(v));

const W = 16, H = 7.2, DEPTH = 0.5, TOP = 1.0, RAIL = 0.9, MARGIN = 0.8;
const CHART_W = W - 2 * MARGIN, CHART_TOP = H / 2 - TOP - 0.2, CHART_H = H - TOP - 0.2 - RAIL - 0.4;

function colourFor(task, mode, node) {
  if (mode === 'priority') return PRIORITY_COLOURS[task.priority] || PRIORITY_COLOURS.medium;
  if (mode === 'column') { let h = 0; for (const ch of String(task.column || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h}, 50%, 52%)`; }
  const person = node.world?.nodes.find((n) => n.typeId === 'person' && String(n.params.name).trim().toLowerCase() === String(task.assignee || '').trim().toLowerCase());
  if (person) return person.params.colour;
  let h = 0; for (const ch of String(task.assignee || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return task.assignee ? `hsl(${h}, 55%, 55%)` : '#6f8bb0';
}
/** Rows for the chart: own tasks + everything arriving on `tasks` (arrays may be nested per link). */
function rows(node) {
  const own = Array.isArray(node.params.tasks) ? node.params.tasks.map((t) => ({ ...t, own: true })) : [];
  const fed = (node.rt?.inputs?.tasks || []).flat().filter(Boolean);
  const all = toTasks([...own, ...fed]);
  for (const t of own) { const r = all.find((x) => x.id === t.id); if (r) r.own = true; }
  all.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return all;
}
function range(list, node) {
  const today = isoDate();
  let start = today, end = addDays(today, 7);
  for (const t of list) { if (t.start < start) start = t.start; if (t.end > end) end = t.end; }
  start = addDays(start, -1); end = addDays(end, 1);
  let days = Math.max(3, daysUntil(end, new Date(start + 'T00:00:00Z')));
  const upd = +node.params.scale || 0;
  if (upd > 0) days = Math.max(days, Math.round(CHART_W / upd));
  return { start, end: addDays(start, days), days, upd: CHART_W / days };
}
const xOf = (R, iso) => -CHART_W / 2 + daysUntil(iso, new Date(R.start + 'T00:00:00Z')) * R.upd;

const body3d = {
  dims: () => ({ width: W, height: H, depth: DEPTH }),
  titleAt: () => [0, H / 2 - TOP / 2 - 0.08, DEPTH / 2 + 0.05],
  ports: (node) => ({ in: node.def.inputs.map((_, i) => [-W / 2, CHART_TOP - 0.5 - i * 0.55, 0]), out: node.def.outputs.map((_, i) => [W / 2, CHART_TOP - 0.5 - i * 0.55, 0]) }),
  build(node, h) {
    const back = h.part(new h.RoundedBoxGeometry(W, H, 0.3, 3, 0.16), h.materials.body(), { theme: () => palette.body });
    back.position.z = -0.15;
    const header = h.part(new h.RoundedBoxGeometry(W - 0.3, TOP - 0.2, 0.34, 3, 0.1), h.materials.header(node.headerColor()), { theme: node.headerColor });
    header.position.set(0, H / 2 - TOP / 2 - 0.08, 0.02);
    const rail = h.part(new h.RoundedBoxGeometry(W - 0.6, 0.14, 0.9, 2, 0.05), h.materials.body(), { theme: () => palette.pmRail });
    rail.position.set(0, -H / 2 + RAIL - 0.25, 0.25); rail.material.color.setHex(palette.pmRail);
    node.today = new THREE.Mesh(new THREE.BoxGeometry(0.06, CHART_H + 0.6, 0.35), new THREE.MeshBasicMaterial({ color: palette.pmToday, transparent: true, opacity: 0.55, depthWrite: false }));
    node.today.position.z = 0.15; node.add(node.today); node.themed.push([node.today, () => palette.pmToday]);
    node.todayLabel = h.label('today', { size: 0.2, color: 'text', weight: 600 }, [0, CHART_TOP + 0.12, 0.3]);
    node._rows = []; node._drag = null;
  },
  refresh(node) {
    node.clearChildren();
    const list = rows(node); node._rows = list;
    const R = range(list, node);
    const mode = node.params.colourBy;
    const sel = node.subSelection;
    // day ticks + week labels on the rail
    const railY = -H / 2 + RAIL - 0.25;
    for (let d = 0; d <= R.days; d++) {
      const iso = addDays(R.start, d); const x = xOf(R, iso);
      const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
      const major = dow === 1;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.03, major ? 0.32 : 0.14, 0.05), new THREE.MeshBasicMaterial({ color: major ? palette.text : palette.textDim }));
      tick.position.set(x, railY + 0.18, 0.66); node.children3d.add(tick);
      if (major || R.days <= 10) node.childLabel(major ? fmtDate(iso) : String(new Date(iso + 'T00:00:00Z').getUTCDate()), { size: major ? 0.19 : 0.15, color: major ? 'text' : 'textDim' }, [x, railY - 0.02, 0.7], !major);
      if (dow === 0 || dow === 6) { // weekend shading
        const shade = new THREE.Mesh(new THREE.PlaneGeometry(R.upd, CHART_H), new THREE.MeshBasicMaterial({ color: palette.textDim, transparent: true, opacity: 0.06, depthWrite: false }));
        shade.position.set(x + R.upd / 2, CHART_TOP - CHART_H / 2, 0.01); node.children3d.add(shade);
      }
    }
    // rows
    const n = list.length;
    const rowH = n ? Math.min(0.72, CHART_H / n) : 0.7;
    const barH = rowH * 0.66;
    list.forEach((t, i) => {
      const x0 = xOf(R, t.start), x1 = Math.max(x0 + 0.25, xOf(R, t.end));
      const y = CHART_TOP - 0.25 - rowH * i - rowH / 2;
      const len = x1 - x0;
      const col = colourFor(t, mode, node);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, barH, 0.14), new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.5, transparent: t.done, opacity: t.done ? 0.45 : 1 }));
      bar.position.set((x0 + x1) / 2, y, 0.16);
      const sub = { kind: 'task', id: t.id, own: !!t.own };
      node.childSub(bar, sub);
      if (sel?.kind === 'task' && sel.id === t.id) { bar.material.emissive = new THREE.Color(states.selected); bar.material.emissiveIntensity = 0.5; }
      if (t.overdue) { const edge = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, barH + 0.06, 0.02), new THREE.MeshBasicMaterial({ color: PRIORITY_COLOURS.urgent })); edge.position.set((x0 + x1) / 2, y, 0.08); node.children3d.add(edge); }
      // face with the title (only when the bar is long enough to read)
      const plane = makeCanvasPlane(len - 0.04, barH - 0.04, { emissive: 0.5 });
      plane.mesh.position.set((x0 + x1) / 2, y, 0.235);
      plane.draw((g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = 'rgba(0,0,0,0.001)'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff'; g.font = font(Math.min(h * 0.55, 30), 600); g.textBaseline = 'middle'; g.textAlign = 'left';
        let s = t.title; while (s.length > 1 && g.measureText(s).width > w - 20) s = s.slice(0, -1);
        if (w > 40) g.fillText(s === t.title ? s : s + '…', 10, h / 2);
        if (t.done) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, h / 2); g.lineTo(10 + g.measureText(s).width, h / 2); g.stroke(); }
      });
      plane.mesh.userData.sub = bar.userData.sub; node.subs.push(plane.mesh); node.children3d.add(plane.mesh);
      // row label on the left rail edge + right-hand drag handle for own tasks
      if (rowH >= 0.3) node.childLabel(t.assignee || t.column || '', { size: Math.min(0.17, rowH * 0.3), color: 'textDim' }, [x0 - 0.12 - 0.45, y, 0.2], true);
      if (t.own) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, barH + 0.1, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.4 }));
        handle.position.set(x1, y, 0.2);
        node.childSub(handle, { kind: 'handle', id: t.id });
      }
    });
    if (!n) node.childLabel('plug a board\'s tasks into the tasks slot, or add tasks in the panel', { size: 0.26, color: 'textDim' }, [0, CHART_TOP - CHART_H / 2, 0.2]);
    // milestones: flags on the rail
    const ms = (node.rt?.inputs?.milestones || []).flat().filter((m) => m && m.date);
    for (const m of ms) {
      const x = xOf(R, m.date); if (x < -CHART_W / 2 - 0.2 || x > CHART_W / 2 + 0.2) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8), new THREE.MeshBasicMaterial({ color: palette.text }));
      pole.position.set(x, railY + 0.6, 0.66); node.children3d.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.03), new THREE.MeshBasicMaterial({ color: m.reached ? PRIORITY_COLOURS.medium : palette.pmToday }));
      flag.position.set(x + 0.32, railY + 1.0, 0.66); node.children3d.add(flag);
      node.childLabel(m.title || 'milestone', { size: 0.16, color: 'text', weight: 600, maxWidth: 2 }, [x + 0.32, railY + 1.3, 0.7], true);
    }
    // today
    const tx = xOf(R, isoDate());
    node.today.position.set(tx, CHART_TOP - CHART_H / 2 - 0.1, 0.15);
    node.todayLabel.position.x = tx;
    node._range = R; node._rowH = rowH;
  },
  applyLOD(node, k) {
    const far = k >= 0.5;
    if (far === node._far) return; node._far = far;
    for (const l of node.labels) if (l.parent === node.children3d) l.visible = !far || l.userData.label.opts.size >= 0.19;
  },
  onSubPointer(node, ev) {
    const sub = ev.sub; if (!sub) return false;
    if (ev.type === 'down') { if (sub.kind === 'handle') node._drag = { id: sub.id, due: null, before: clone(node.params.tasks || []) }; return true; }
    if (ev.type === 'drag' && node._drag) {
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld);
      const origin = node.localToWorld(new THREE.Vector3(0, 0, 0.2));
      const hit = new THREE.Vector3();
      if (!ev.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), hit)) return true;
      const local = node.worldToLocal(hit);
      const R = node._range;
      const day = Math.round((local.x + CHART_W / 2) / R.upd);
      const t = (node.params.tasks || []).find((x) => x.id === node._drag.id); if (!t) return true;
      const minDay = daysUntil(t.start, new Date(R.start + 'T00:00:00Z')) + 1;
      const due = addDays(R.start, Math.max(minDay, day));
      if (due !== t.due) { node._drag.due = due; t.due = due; node.faceDirty = true; }   // live preview (restored on cancel)
      return true;
    }
    if (ev.type === 'drop' || ev.type === 'cancel') {
      const d = node._drag; node._drag = null;
      if (!d || !d.due) return true;
      if (ev.type === 'cancel') { node.params.tasks = d.before; node.faceDirty = true; return true; }
      const after = clone(node.params.tasks);
      const c = {
        label: 'Change due date',
        do: () => { node.params.tasks = clone(after); node.faceDirty = true; node.world?.changed('param'); },
        undo: () => { node.params.tasks = clone(d.before); node.faceDirty = true; node.world?.changed('param'); },
      };
      if (ev.history) ev.history.execute(c); else c.do();
      node.selectSub({ kind: 'task', id: d.id }, ev.selection);
      return true;
    }
    if (ev.type === 'click') { if (sub.kind === 'task' || sub.kind === 'handle') node.selectSub({ kind: 'task', id: sub.id }, ev.selection); return true; }
    return false;
  },
};

export default registry.register({
  id: 'timeline', category: 'project', label: 'Timeline', icon: icons.timeline, size: 'XL',
  description: 'A Gantt chart: one bar per task along a day axis, milestone flags and a today marker',
  inputs: [
    { key: 'tasks', label: 'tasks', type: 'data', subtype: 'tasks', multi: true, optional: true, loose: true },
    { key: 'milestones', label: 'milestones', type: 'data', subtype: 'milestone', multi: true, optional: true, loose: true },
  ],
  outputs: [{ key: 'overdue', label: 'overdue', type: 'data', subtype: 'tasks' }, { key: 'next', label: 'next milestone', type: 'data', subtype: 'milestone' }],
  params: [
    { key: 'tasks', label: 'tasks', type: 'json', default: [], hidden: true },
    { key: 'scale', label: 'units per day (0 = fit)', type: 'number', default: 0, min: 0, max: 4, step: 0.1 },
    { key: 'colourBy', label: 'colour by', type: 'select', options: ['assignee', 'priority', 'column'], default: 'assignee' },
  ],
  body3d,
  panel: buildTimelinePanel,
  evaluate({ inputs, state, instance }) {
    // rebuild when the fed data changed (cheap signature: ids + dates)
    const sig = JSON.stringify([(inputs.tasks || []).flat().map((t) => t && [t.id, t.title, t.due, t.start, t.estimate, t.done, t.assignee, t.column, t.priority]), (inputs.milestones || []).flat().map((m) => m && [m.title, m.date, m.reached]), isoDate()]);
    if (sig !== instance._sig) { instance._sig = sig; instance.faceDirty = true; }   // on the instance, not in saved state: a loaded timeline must rebuild its rows
    const list = instance._rows || [];
    const overdue = list.filter((t) => t.overdue).map((t) => ({ id: t.id, title: t.title, due: t.end, assignee: t.assignee }));
    const ms = (inputs.milestones || []).flat().filter((m) => m && m.date && daysUntil(m.date) >= 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    return { overdue, next: ms[0] ? { title: ms[0].title, date: ms[0].date, daysLeft: daysUntil(ms[0].date) } : undefined };
  },
});
